// Public extended property filters (Wave 10B4).
//
// These assert the MONGO FILTER the public list route builds, not the documents
// it returns. That is deliberate: with a scripted database, asserting on
// returned documents would only prove the stub echoed them back, whereas the
// filter object is the actual contract between the query string and the data.
//
// Two properties matter more than any individual filter here:
//
//   1. A request carrying none of the new parameters must build EXACTLY the
//      filter it built before this wave. The chatbot and the similar-properties
//      call both hit this route with only classic parameters, so a stray
//      always-on filter would silently shrink their results.
//
//   2. An optional boolean that was never recorded must never be matched by a
//      "no" search. Waves 10B1/10B2/10B3 kept unknown and false apart all the
//      way from the schema to the public page; a filter that treated absent as
//      false would undo that at the last step.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => res.status(401).json({ success: false, message: 'Not authenticated' }),
    userFromToken: async () => null,
  },
})

// Every filter this suite asserts on is captured here.
const calls = { find: [] }

const makeQuery = (result) => {
  const q = {
    select() { return q },
    sort() { return q },
    lean() { return q },
    populate() { return q },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
  }
  return q
}

mock.module('../models/Property.js', {
  defaultExport: {
    find: (filter) => { calls.find.push(filter); return makeQuery([]) },
    findById: () => makeQuery(null),
    aggregate: async () => [],
    create: async (data) => data,
    findByIdAndUpdate: async () => null,
    findByIdAndDelete: async () => null,
  },
})

mock.module('../models/User.js', { defaultExport: {} })

mock.module('../services/agentAssignment.js', {
  namedExports: {
    resolveAgentContact: async () => ({ ok: true, drop: [], changes: {} }),
    publicAgent: () => null,
    AGENT_POPULATE_FIELDS: 'name avatar role isActive',
  },
})

mock.module('../services/propertyEmbeddingService.js', {
  namedExports: {
    generatePropertyEmbedding: async () => null,
    embeddingSourceFieldsChanged: () => false,
  },
})

mock.module('../services/propertyMessaging.js', {
  namedExports: { handlePropertyAgentReassignment: async () => {} },
})

mock.module('../services/propertyCreatedPush.js', {
  namedExports: { notifyNewPropertyCreated: async () => {} },
})

const { default: propertyRoutes } = await import('../routes/properties.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/properties', propertyRoutes)
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message })
  })
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

beforeEach(() => { calls.find.length = 0 })

/** Issues a public search and returns the Mongo filter the route built. */
const filterFor = async (query = '') => {
  const res = await fetch(`${baseUrl}/api/properties${query}`)
  assert.equal(res.status, 200, `expected 200 for "${query}"`)
  assert.equal(calls.find.length, 1, 'the route must query exactly once')
  return calls.find[0]
}

/* ══════════════ 1. The default request is untouched ══════════════════ */

test('no query string builds an empty filter', async () => {
  assert.deepEqual(await filterFor(), {})
})

test('a classic-only request builds only classic keys', async () => {
  const filter = await filterFor('?listingType=Sale&district=Levent&propertyType=Villa&minPrice=100')
  assert.deepEqual(filter, {
    listingType: 'Sale',
    district: 'Levent',
    propertyType: 'Villa',
    price: { $gte: 100 },
  })
})

test('none of the 10B4 keys appear unless asked for', async () => {
  const filter = await filterFor('?listingType=Rent')
  for (const field of [
    'netSqm', 'openAreaSqm', 'coefficient', 'floorLocation', 'kitchenType',
    'usageStatus', 'titleDeedStatus', 'nearbyTransport', 'sauna', 'jacuzzi',
    'steamRoom', 'turkishBath', 'basement', 'withinSite', 'eligibleForCredit',
    'exchange', 'hasVirtualTour', 'createdAt',
  ]) {
    assert.equal(field in filter, false, `${field} must not be filtered by default`)
  }
})

/* ══════════════ 2. Classic filters still behave ══════════════════════ */

const CLASSIC = [
  ['?rooms=3%2B1', { rooms: '3+1' }],
  ['?heating=Central', { heating: 'Central' }],
  ['?parking=Open%20Parking', { parking: 'Open Parking' }],
  ['?buildingAge=6-10', { buildingAge: '6-10' }],
  ['?floor=3', { floor: 3 }],
  ['?totalFloors=12', { totalFloors: 12 }],
  ['?beds=2', { beds: 2 }],
  ['?featured=true', { featured: true }],
  ['?furnished=true', { furnished: true }],
  ['?balcony=true', { balcony: true }],
  ['?elevator=true', { elevator: true }],
  ['?pool=true', { pool: true }],
  ['?garden=true', { garden: true }],
  ['?minSqm=80&maxSqm=200', { sqm: { $gte: 80, $lte: 200 } }],
]

for (const [query, expected] of CLASSIC) {
  test(`classic filter unchanged: ${query}`, async () => {
    assert.deepEqual(await filterFor(query), expected)
  })
}

/* ══════════════ 3. baths — backend already supported it ══════════════ */

test('baths filters exactly', async () => {
  assert.deepEqual(await filterFor('?baths=2'), { baths: 2 })
})

/* ══════════════ 4. Numeric ranges ════════════════════════════════════ */

test('netSqm range', async () => {
  assert.deepEqual(await filterFor('?minNetSqm=90&maxNetSqm=150'), { netSqm: { $gte: 90, $lte: 150 } })
})

test('netSqm lower bound only', async () => {
  assert.deepEqual(await filterFor('?minNetSqm=90'), { netSqm: { $gte: 90 } })
})

test('openArea range maps to openAreaSqm', async () => {
  assert.deepEqual(await filterFor('?minOpenArea=10&maxOpenArea=40'), { openAreaSqm: { $gte: 10, $lte: 40 } })
})

test('coefficient range', async () => {
  assert.deepEqual(await filterFor('?minCoefficient=1.5&maxCoefficient=8'), { coefficient: { $gte: 1.5, $lte: 8 } })
})

test('zero is a real bound, not an absent one', async () => {
  assert.deepEqual(await filterFor('?minOpenArea=0'), { openAreaSqm: { $gte: 0 } })
})

test('a decimal bound survives', async () => {
  assert.deepEqual(await filterFor('?minNetSqm=90.5'), { netSqm: { $gte: 90.5 } })
})

const BAD_NUMBERS = ['', 'abc', '%20%20', 'NaN', 'Infinity', '1e', 'null', 'true']
for (const raw of BAD_NUMBERS) {
  test(`a non-numeric bound is ignored, never NaN: "${raw}"`, async () => {
    const filter = await filterFor(`?minNetSqm=${raw}`)
    assert.equal('netSqm' in filter, false, `"${raw}" must not reach Mongo`)
  })
}

test('a valid bound survives an invalid partner', async () => {
  assert.deepEqual(await filterFor('?minNetSqm=90&maxNetSqm=abc'), { netSqm: { $gte: 90 } })
})

/* ══════════════ 5. Enum filters, any-of ══════════════════════════════ */

const ENUMS = [
  ['floorLocation', 'Penthouse', 'Duplex'],
  ['kitchenType', 'Closed', 'Open (American)'],
  ['usageStatus', 'Empty', 'Tenant'],
  ['titleDeedStatus', 'Independent Title Deed', 'Shared Title Deed'],
  ['nearbyTransport', 'Metro', 'Ferry'],
]

for (const [field, one, two] of ENUMS) {
  test(`${field}: single value`, async () => {
    const filter = await filterFor(`?${field}=${encodeURIComponent(one)}`)
    assert.deepEqual(filter[field], { $in: [one] })
  })

  test(`${field}: repeated params become any-of`, async () => {
    const filter = await filterFor(`?${field}=${encodeURIComponent(one)}&${field}=${encodeURIComponent(two)}`)
    assert.deepEqual(filter[field], { $in: [one, two] })
  })

  test(`${field}: duplicates are collapsed`, async () => {
    const filter = await filterFor(`?${field}=${encodeURIComponent(one)}&${field}=${encodeURIComponent(one)}`)
    assert.deepEqual(filter[field], { $in: [one] })
  })

  test(`${field}: an unstorable value is dropped`, async () => {
    const filter = await filterFor(`?${field}=${encodeURIComponent(one)}&${field}=Nonsense`)
    assert.deepEqual(filter[field], { $in: [one] })
  })

  test(`${field}: all-invalid matches nothing rather than everything`, async () => {
    const filter = await filterFor(`?${field}=Nonsense`)
    assert.deepEqual(filter[field], { $in: [] },
      'silently widening the search would show listings the visitor did not ask for')
  })
}

/* ══════════════ 6. Tri-state booleans ════════════════════════════════ */

const TRI_STATE = [
  'sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement',
  'withinSite', 'eligibleForCredit', 'exchange', 'hasVirtualTour',
]

for (const field of TRI_STATE) {
  test(`${field}=true matches a stored true`, async () => {
    assert.deepEqual(await filterFor(`?${field}=true`), { [field]: true })
  })

  test(`${field}=false matches a stored false, NOT an absent value`, async () => {
    const filter = await filterFor(`?${field}=false`)
    assert.deepEqual(filter, { [field]: false },
      'an exact false must not be widened into "absent or false"')
  })

  test(`${field} omitted adds no filter`, async () => {
    const filter = await filterFor('?listingType=Sale')
    assert.equal(field in filter, false)
  })

  test(`${field}='' adds no filter (the "Any" option)`, async () => {
    const filter = await filterFor(`?${field}=`)
    assert.equal(field in filter, false)
  })

  for (const junk of ['1', '0', 'yes', 'no', 'TRUE', 'False', 'null']) {
    test(`${field}=${junk} is not accepted as a boolean`, async () => {
      const filter = await filterFor(`?${field}=${junk}`)
      assert.equal(field in filter, false, `"${junk}" must not be coerced`)
    })
  }
}

/* ══════════════ 7. listedSince ═══════════════════════════════════════ */

test('listedSince as a day count builds a createdAt lower bound', async () => {
  const before = Date.now() - 7 * 24 * 60 * 60 * 1000
  const filter = await filterFor('?listedSince=7')
  const after = Date.now() - 7 * 24 * 60 * 60 * 1000

  assert.ok(filter.createdAt.$gte instanceof Date)
  const ms = filter.createdAt.$gte.getTime()
  assert.ok(ms >= before - 1000 && ms <= after + 1000, 'cutoff must be seven days ago')
})

test('listedSince accepts the donor ISO contract too', async () => {
  const iso = '2026-01-15T00:00:00.000Z'
  const filter = await filterFor(`?listedSince=${encodeURIComponent(iso)}`)
  assert.equal(filter.createdAt.$gte.toISOString(), iso)
})

for (const bad of ['', 'soon', '0', '99999', '-5', 'null']) {
  test(`listedSince="${bad}" is ignored rather than producing an invalid date`, async () => {
    const filter = await filterFor(`?listedSince=${encodeURIComponent(bad)}`)
    assert.equal('createdAt' in filter, false)
  })
}

/* ══════════════ 8. Location privacy ══════════════════════════════════ */
//
// Wave 9 keeps an approximate listing's real coordinate off every public
// response. A bounding-box filter would hand it back anyway: a client that can
// ask "is this listing between these latitudes" can bisect its way to the exact
// point in a few dozen requests, without the coordinate ever being serialised.
// The donor route accepts minLat/maxLat/minLng/maxLng. This one must not.

const BBOX = ['minLat', 'maxLat', 'minLng', 'maxLng']

for (const param of BBOX) {
  test(`${param} is not an accepted public filter`, async () => {
    const filter = await filterFor(`?${param}=41.05`)
    assert.deepEqual(filter, {}, `${param} must build no filter at all`)
  })
}

test('a full bounding box is ignored entirely', async () => {
  const filter = await filterFor('?minLat=41.0&maxLat=41.1&minLng=29.0&maxLng=29.1')
  assert.deepEqual(filter, {})
  assert.equal(Object.keys(filter).some((k) => k.startsWith('location')), false)
})

test('no location key can be reached through any filter', async () => {
  const filter = await filterFor(
    '?minLat=41&location=x&location.lat=41&minNetSqm=90&sauna=true'
  )
  assert.deepEqual(filter, { netSqm: { $gte: 90 }, sauna: true })
})

/* ══════════════ 9. Deferred / excluded donor filters ═════════════════ */

test('hasVideo is not implemented — no field backs it', async () => {
  const filter = await filterFor('?hasVideo=true')
  assert.deepEqual(filter, {}, 'deferred until a canonical field exists')
})

test('min/maxBuildingAge are not implemented — buildingAge is bucketed text', async () => {
  const filter = await filterFor('?minBuildingAge=0&maxBuildingAge=10')
  assert.deepEqual(filter, {})
})

test('the bucketed buildingAge filter is the supported one', async () => {
  assert.deepEqual(await filterFor('?buildingAge=11-15'), { buildingAge: '11-15' })
})

/* ══════════════ 10. Everything at once ═══════════════════════════════ */

test('a full extended search composes into one coherent filter', async () => {
  const filter = await filterFor(
    '?listingType=Sale&district=Levent&minPrice=1000&baths=2' +
    '&minNetSqm=90&maxNetSqm=200&minOpenArea=5&minCoefficient=1' +
    '&floorLocation=Penthouse&kitchenType=Closed' +
    '&usageStatus=Empty&titleDeedStatus=Independent%20Title%20Deed' +
    '&nearbyTransport=Metro&nearbyTransport=Ferry' +
    '&sauna=true&basement=false&hasVirtualTour=true'
  )

  assert.deepEqual(filter, {
    listingType: 'Sale',
    district: 'Levent',
    baths: 2,
    price: { $gte: 1000 },
    netSqm: { $gte: 90, $lte: 200 },
    openAreaSqm: { $gte: 5 },
    coefficient: { $gte: 1 },
    floorLocation: { $in: ['Penthouse'] },
    kitchenType: { $in: ['Closed'] },
    usageStatus: { $in: ['Empty'] },
    titleDeedStatus: { $in: ['Independent Title Deed'] },
    nearbyTransport: { $in: ['Metro', 'Ferry'] },
    sauna: true,
    basement: false,
    hasVirtualTour: true,
  })
})

test('an unknown query parameter is ignored', async () => {
  assert.deepEqual(await filterFor('?somethingElse=1&__proto__=x&agent=abc'), {})
})
