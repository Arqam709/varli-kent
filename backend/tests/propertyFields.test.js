// Donor-parity property fields: schema shape and route validation.
//
// The rule this suite exists to defend is that ABSENCE and FALSE are different
// facts. Every property already in the database predates these fields, so a
// schema default would silently assert "this listing has no sauna" about
// listings nobody has ever assessed. Absent must stay absent.
//
// Only MongoDB and JWT verification are replaced; the schema definition, the
// validation and the route wiring under test are all real.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

/* ── The signed-in actor ─────────────────────────────────────────────── */
let currentUser = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!currentUser) return res.status(401).json({ success: false, message: 'Not authenticated' })
      req.user = currentUser
      next()
    },
    userFromToken: async () => null,
  },
})

/* ── Scripted database ───────────────────────────────────────────────── */
const db = { findResult: [], findByIdResult: null, updateResult: null }
const calls = { create: [], findByIdAndUpdate: [] }

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
    find: () => makeQuery(db.findResult),
    findById: () => makeQuery(db.findByIdResult),
    aggregate: async () => [],
    create: async (data) => { calls.create.push(data); return { _id: 'p1', ...data } },
    findByIdAndUpdate: async (id, ops) => { calls.findByIdAndUpdate.push({ id, ops }); return db.updateResult },
    findByIdAndDelete: async () => null,
  },
})

mock.module('../models/User.js', { defaultExport: {} })

mock.module('../services/agentAssignment.js', {
  namedExports: {
    resolveAgentContact: async () => ({ ok: true, drop: [], changes: {} }),
    publicAgent: (a) => (a ? { _id: 'agent-id', name: 'Agent' } : null),
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

const { default: propertyRoutes, parseExtendedPropertyFields, EXTENDED_OWNED_FIELDS } = await import('../routes/properties.js')

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

beforeEach(() => {
  currentUser = null
  db.findResult = []
  db.findByIdResult = null
  db.updateResult = null
  calls.create.length = 0
  calls.findByIdAndUpdate.length = 0
})

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const owner = () => ({ _id: 'o', role: 'owner', permissions: [] })
const BASE = { title: 'T', listingType: 'Sale', price: 1, district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1 }

const created = () => calls.create[0]
const updateSet = () => calls.findByIdAndUpdate[0].ops.$set || {}

const NEW_BOOLEANS = ['sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement', 'withinSite', 'eligibleForCredit', 'exchange', 'hasVirtualTour']
const ALL_19 = [
  'netSqm', 'openAreaSqm', 'currency', 'floorLocation', 'coefficient', 'kitchenType',
  ...NEW_BOOLEANS.filter((f) => f !== 'hasVirtualTour'),
  'nearbyTransport', 'usageStatus', 'titleDeedStatus', 'hasVirtualTour', 'virtualTourUrl',
]

/* ══════════════════════ 1. Schema shape ═══════════════════════════════ */

test('all 19 donor-parity fields exist in the schema', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../models/Property.js', import.meta.url), 'utf8')
  assert.equal(ALL_19.length, 19)
  for (const field of ALL_19) {
    assert.match(src, new RegExp('^  ' + field + ':', 'm'), `${field} must be declared`)
  }
})

test('the new booleans carry NO default — absence must stay absence', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../models/Property.js', import.meta.url), 'utf8')

  for (const field of NEW_BOOLEANS) {
    const line = src.split('\n').find((l) => l.startsWith(`  ${field}:`))
    assert.ok(line, `${field} must be declared`)
    assert.equal(/default/.test(line), false,
      `${field} must not default — that would assert a fact about every legacy listing`)
  }
})

test('the five pre-existing booleans keep their default: false', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../models/Property.js', import.meta.url), 'utf8')
  for (const field of ['furnished', 'balcony', 'elevator', 'pool', 'garden']) {
    const line = src.split('\n').find((l) => l.startsWith(`  ${field}:`))
    assert.match(line, /default: false/, `${field} must be left exactly as it was`)
  }
})

test('nearbyTransport uses default: undefined so no legacy array is materialised', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../models/Property.js', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('  nearbyTransport:'), src.indexOf('  nearbyTransport:') + 300)
  assert.match(block, /default: undefined/)
})

test('existing enums and the rooms vocabulary are untouched', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../models/Property.js', import.meta.url), 'utf8')
  assert.match(src, /enum: \['Sale', 'Rent'\]/)
  assert.match(src, /'Apartment', 'Villa', 'Penthouse'/)
  assert.match(src, /enum: \['Available', 'Sold', 'Rented', 'Pending'\]/)
  // rooms / buildingAge / heating / parking remain free Strings, as before.
  assert.match(src, /^ {2}rooms: \{ type: String \},$/m)
  assert.match(src, /^ {2}heating: \{ type: String \},$/m)
  assert.match(src, /^ {2}parking: \{ type: String \},$/m)
  assert.match(src, /^ {2}buildingAge: \{ type: String \},$/m)
})

/* ══════════════════════ 2. Numbers ════════════════════════════════════ */

test('numeric fields accept numbers and numeric strings', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, netSqm: 95, openAreaSqm: '12.5', coefficient: 1.75,
  })
  assert.equal(res.status, 201)
  assert.equal(created().netSqm, 95)
  assert.equal(created().openAreaSqm, 12.5)
  assert.equal(created().coefficient, 1.75)
})

test('numeric zero is preserved, not treated as absent', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, netSqm: 0, openAreaSqm: 0 })
  assert.equal(res.status, 201)
  assert.equal(created().netSqm, 0)
  assert.equal(created().openAreaSqm, 0)
})

test('coefficient accepts negatives — the donor documents no bound', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, coefficient: -2.5 })
  assert.equal(res.status, 201)
  assert.equal(created().coefficient, -2.5)
})

const BAD_NUMBERS = [
  ['negative netSqm', { netSqm: -1 }],
  ['negative openAreaSqm', { openAreaSqm: -0.5 }],
  ['boolean false', { netSqm: false }],
  ['boolean true', { coefficient: true }],
  ['array', { netSqm: [] }],
  ['object', { netSqm: {} }],
  ['non-numeric string', { netSqm: 'big' }],
]

for (const [label, patch] of BAD_NUMBERS) {
  test(`numeric validation rejects ${label}`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, ...patch })
    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0, 'nothing may be written')
  })
}

test('NaN and Infinity are rejected by the parser', async () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(parseExtendedPropertyFields({ netSqm: bad }).ok, false)
    assert.equal(parseExtendedPropertyFields({ coefficient: bad }).ok, false)
  }
})

test('an empty numeric string is treated as absent, not as zero', async () => {
  const out = parseExtendedPropertyFields({ netSqm: '', coefficient: '   ' })
  assert.equal(out.ok, true)
  assert.equal('netSqm' in out.value, false)
  assert.equal('coefficient' in out.value, false)
})

/* ══════════════════════ 3. Booleans ═══════════════════════════════════ */

test('explicit true and false are both stored', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, sauna: true, jacuzzi: false, turkishBath: true, exchange: false,
  })
  assert.equal(res.status, 201)
  assert.equal(created().sauna, true)
  assert.equal(created().jacuzzi, false, 'an explicit false is a real fact and must survive')
  assert.equal(created().turkishBath, true)
  assert.equal(created().exchange, false)
})

test('omitted booleans stay absent — unknown is not false', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', BASE)
  assert.equal(res.status, 201)
  for (const field of NEW_BOOLEANS) {
    assert.equal(field in created(), false, `${field} must not be invented on create`)
  }
})

const BAD_BOOLEANS = [
  ["the string 'true'", { sauna: 'true' }],
  ["the string 'false'", { sauna: 'false' }],
  ['the number 1', { jacuzzi: 1 }],
  ['the number 0', { jacuzzi: 0 }],
  ['an object', { basement: {} }],
]

for (const [label, patch] of BAD_BOOLEANS) {
  test(`boolean validation rejects ${label}`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, ...patch })
    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0)
  })
}

/* ══════════════════════ 4. Enums ══════════════════════════════════════ */

const ENUM_CASES = {
  currency: ['TL', 'USD', 'EUR', 'GBP'],
  floorLocation: ['Ground floor', 'High Entrance', 'Penthouse', 'Duplex', 'Triplex'],
  kitchenType: ['Open (American)', 'Closed'],
  usageStatus: ['Empty', 'Tenant', 'Property Owner'],
  titleDeedStatus: [
    'Shared Title Deed', 'Independent Title Deed', 'Land with Title Deed',
    'Cooperative Share Title Deed', 'Established Usufruct Right',
  ],
}

for (const [field, values] of Object.entries(ENUM_CASES)) {
  test(`${field} accepts every allowed value`, async () => {
    currentUser = owner()
    for (const value of values) {
      calls.create.length = 0
      const res = await request('POST', '/api/properties', { ...BASE, [field]: value })
      assert.equal(res.status, 201, `${value} must be accepted`)
      assert.equal(created()[field], value)
    }
  })

  test(`${field} rejects a value outside the vocabulary`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, [field]: 'Something Else' })
    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0)
  })
}

test('donor vocabularies that CURRENT does not use are rejected', async () => {
  // The donor's own titleDeed/usage lists match, but its kitchen/floor wording
  // would arrive from a donor-shaped client; only CURRENT's values are valid.
  for (const patch of [{ kitchenType: 'Amerikan' }, { floorLocation: 'Bahçe katı' }, { currency: 'TRY' }]) {
    assert.equal(parseExtendedPropertyFields(patch).ok, false)
  }
})

/* ══════════════════════ 5. nearbyTransport ════════════════════════════ */

test('a valid transport array is stored', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, nearbyTransport: ['Metro', 'Ferry'] })
  assert.equal(res.status, 201)
  assert.deepEqual(created().nearbyTransport, ['Metro', 'Ferry'])
})

test('duplicates are deduped rather than rejected', async () => {
  const out = parseExtendedPropertyFields({ nearbyTransport: ['Metro', 'Metro', 'Bus', 'Metro'] })
  assert.equal(out.ok, true)
  assert.deepEqual(out.value.nearbyTransport, ['Metro', 'Bus'])
})

test('an empty transport array is allowed and means "none recorded"', async () => {
  const out = parseExtendedPropertyFields({ nearbyTransport: [] })
  assert.equal(out.ok, true)
  assert.deepEqual(out.value.nearbyTransport, [])
})

const BAD_TRANSPORT = [
  ['a non-array', 'Metro'],
  ['an object', { a: 1 }],
  ['an unknown value', ['Metro', 'Helicopter']],
  ['a non-string member', ['Metro', 7]],
  ['more entries than options exist', ['Metro', 'Bus', 'Ferry', 'Train', 'Tram', 'Metrobus', 'Highway Access', 'Metro']],
]

for (const [label, value] of BAD_TRANSPORT) {
  test(`nearbyTransport rejects ${label}`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, nearbyTransport: value })
    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0)
  })
}

/* ══════════════════════ 6. virtualTourUrl ═════════════════════════════ */

const GOOD_URLS = [
  'https://my.matterport.com/show/?m=abc123',
  'https://matterport.com/show/?m=abc',
  'https://kuula.co/share/collection/xyz',
  'https://www.youtube.com/watch?v=abc',
  'https://youtu.be/abc',
  'https://vimeo.com/123456',
]

for (const url of GOOD_URLS) {
  test(`virtualTourUrl accepts ${url}`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, virtualTourUrl: url })
    assert.equal(res.status, 201)
    assert.ok(created().virtualTourUrl.startsWith('https://'))
  })
}

const BAD_URLS = [
  ['plain http', 'http://my.matterport.com/show'],
  ['javascript:', 'javascript:alert(1)'],
  ['data:', 'data:text/html,<script>alert(1)</script>'],
  ['an unknown host', 'https://evil.example.com/tour'],
  ['a lookalike host', 'https://matterport.com.evil.test/tour'],
  ['a relative path', '/tours/123'],
  ['malformed text', 'not a url at all'],
  ['a non-string', 12345],
]

for (const [label, url] of BAD_URLS) {
  test(`virtualTourUrl rejects ${label}`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, virtualTourUrl: url })
    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0, 'an unsafe URL must never be stored')
  })
}

test('hasVirtualTour is independent of virtualTourUrl', async () => {
  // The donor treats the badge and the link separately; nothing is forced.
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, hasVirtualTour: true })
  assert.equal(res.status, 201)
  assert.equal(created().hasVirtualTour, true)
  assert.equal('virtualTourUrl' in created(), false)
})

/* ══════════════════════ 7. currency ↔ priceLabel ══════════════════════ */

test('currency alone derives the matching priceLabel', async () => {
  for (const [currency, symbol] of [['TL', '₺'], ['USD', '$'], ['EUR', '€'], ['GBP', '£']]) {
    const out = parseExtendedPropertyFields({ currency })
    assert.equal(out.ok, true)
    assert.equal(out.value.currency, currency)
    assert.equal(out.value.priceLabel, symbol)
  }
})

test('priceLabel alone derives the matching currency', async () => {
  for (const [label, currency] of [['₺', 'TL'], ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['TL', 'TL']]) {
    const out = parseExtendedPropertyFields({ priceLabel: label })
    assert.equal(out.value.currency, currency, `${label} should imply ${currency}`)
  }
})

test('an agreeing pair is left alone', async () => {
  const out = parseExtendedPropertyFields({ currency: 'EUR', priceLabel: '€' })
  assert.equal(out.ok, true)
  assert.equal(out.value.currency, 'EUR')
  assert.equal('priceLabel' in out.value, false, 'nothing needed rewriting')
})

test('a contradictory pair is refused rather than silently reconciled', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, currency: 'EUR', priceLabel: '$' })
  assert.equal(res.status, 400)
  assert.match(res.body.message, /does not match currency EUR/)
  assert.equal(calls.create.length, 0)
})

test('a custom priceLabel is preserved and neither derives nor contradicts', async () => {
  const out = parseExtendedPropertyFields({ currency: 'USD', priceLabel: 'Price on request' })
  assert.equal(out.ok, true, 'an unmappable label is not a contradiction')
  assert.equal('priceLabel' in out.value, false, 'the deliberate custom label must survive untouched')
})

test('a legacy body with neither field touches neither', async () => {
  const out = parseExtendedPropertyFields({ title: 'x' })
  assert.equal(out.ok, true)
  assert.equal('currency' in out.value, false)
  assert.equal('priceLabel' in out.value, false)
})

/* ══════════════════════ 8. Update semantics ═══════════════════════════ */

test('an update that omits the new fields leaves them alone', async () => {
  currentUser = owner()
  db.findByIdResult = { _id: 'p1', ...BASE, agent: null }
  db.updateResult = { _id: 'p1', ...BASE }

  const res = await request('PUT', '/api/properties/p1', { title: 'Renamed' })
  assert.equal(res.status, 200)
  const set = updateSet()
  for (const field of ALL_19) {
    if (field === 'currency' || field === 'priceLabel') continue
    assert.equal(field in set, false, `${field} must not be written by an unrelated edit`)
  }
})

test('an update can set a boolean to false explicitly', async () => {
  currentUser = owner()
  db.findByIdResult = { _id: 'p1', ...BASE, agent: null }
  db.updateResult = { _id: 'p1', ...BASE }

  const res = await request('PUT', '/api/properties/p1', { sauna: false })
  assert.equal(res.status, 200)
  assert.equal(updateSet().sauna, false)
})

test('an update can set a boolean to true', async () => {
  currentUser = owner()
  db.findByIdResult = { _id: 'p1', ...BASE, agent: null }
  db.updateResult = { _id: 'p1', ...BASE }

  const res = await request('PUT', '/api/properties/p1', { sauna: true })
  assert.equal(res.status, 200)
  assert.equal(updateSet().sauna, true)
})

test('an invalid new field fails the update atomically', async () => {
  currentUser = owner()
  db.findByIdResult = { _id: 'p1', ...BASE, agent: null }

  const res = await request('PUT', '/api/properties/p1', { title: 'Should not save', netSqm: -5 })
  assert.equal(res.status, 400)
  assert.equal(calls.findByIdAndUpdate.length, 0, 'no partial write')
})

/* ══════════════════════ 9. Legacy compatibility ═══════════════════════ */

test('a property with none of the 19 fields still creates', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', BASE)
  assert.equal(res.status, 201)
  assert.deepEqual(Object.keys(created()).sort(), Object.keys(BASE).sort())
})

test('a legacy stored property still lists and serialises', async () => {
  db.findResult = [{ _id: 'p1', ...BASE }]
  const res = await request('GET', '/api/properties')
  assert.equal(res.status, 200)
  assert.equal(res.body.properties.length, 1)
  assert.equal(res.body.properties[0].title, 'T')
})

test('a legacy stored property still opens on the detail route', async () => {
  db.findByIdResult = {
    _id: 'p1', ...BASE, agent: null,
    toObject() { return { _id: 'p1', ...BASE, agent: null } },
  }
  const res = await request('GET', '/api/properties/p1')
  assert.equal(res.status, 200)
  assert.equal(res.body.property.title, 'T')
})

/* ══════════════════════ 10. Wave 9 regression guards ══════════════════ */

test('approximate location is still redacted publicly', async () => {
  db.findResult = [{
    _id: 'p1', ...BASE, sauna: true,
    location: { lat: 41.0082, lng: 28.9784, isApproximate: true, approxRadiusKm: 8 },
  }]
  const res = await request('GET', '/api/properties')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.properties[0].location, { isApproximate: true, approxRadiusKm: 8 })
  assert.equal(JSON.stringify(res.body).includes('41.0082'), false,
    'adding fields must not weaken the Wave 9 privacy contract')
  assert.equal(res.body.properties[0].sauna, true, 'the new field still serialises')
})

test('exact location is still exposed publicly', async () => {
  db.findResult = [{
    _id: 'p1', ...BASE,
    location: { lat: 41.0082, lng: 28.9784, isApproximate: false, approxRadiusKm: 5 },
  }]
  const res = await request('GET', '/api/properties')
  assert.equal(res.body.properties[0].location.lat, 41.0082)
})

test('location validation still rejects a bad coordinate alongside new fields', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, sauna: true, location: { lat: 999, lng: 29 },
  })
  assert.equal(res.status, 400)
  assert.equal(calls.create.length, 0)
})

test('a new field cannot disturb the agent contract', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, sauna: true, jacuzzi: false })
  assert.equal(res.status, 201)
  assert.equal('agent' in created(), false, 'agent is decided by applyAgentContact, not by this wave')
})

test('the route imports no chatbot or embedding-mutating module for these fields', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../routes/properties.js', import.meta.url), 'utf8')
  const imported = [...src.matchAll(/^import[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
  for (const forbidden of ['chatFilters', 'chatMessageParsing', 'geminiPropertyParser', 'chatParsingVocabulary']) {
    assert.equal(imported.some((s) => s.includes(forbidden)), false, `must not import ${forbidden}`)
  }
})

/* ══════════════ 11. The parser OWNS the 19 fields ════════════════════ */
//
// These assert the actual database payload, not the parser return value. The
// gap between the two is where a skipped value could survive: the routes build
// their payload from req.body, so a raw '' or null reaches the write unless it
// is stripped. Testing parseExtendedPropertyFields alone would miss it entirely.

const SKIPPED_INPUTS = [
  ['empty numeric string', { netSqm: '' }, 'netSqm'],
  ['whitespace numeric string', { coefficient: '   ' }, 'coefficient'],
  ['empty currency', { currency: '' }, 'currency'],
  ['empty kitchenType', { kitchenType: '' }, 'kitchenType'],
  ['empty usageStatus', { usageStatus: '' }, 'usageStatus'],
  ['empty titleDeedStatus', { titleDeedStatus: '' }, 'titleDeedStatus'],
  ['empty floorLocation', { floorLocation: '' }, 'floorLocation'],
  ['null boolean', { sauna: null }, 'sauna'],
  ['null transport', { nearbyTransport: null }, 'nearbyTransport'],
  ['empty virtualTourUrl', { virtualTourUrl: '' }, 'virtualTourUrl'],
  ['null virtualTourUrl', { virtualTourUrl: null }, 'virtualTourUrl'],
  ['null numeric', { openAreaSqm: null }, 'openAreaSqm'],
]

for (const [label, patch, field] of SKIPPED_INPUTS) {
  test(`create: ${label} never reaches the write payload`, async () => {
    currentUser = owner()
    const res = await request('POST', '/api/properties', { ...BASE, ...patch })
    assert.equal(res.status, 201)
    assert.equal(field in created(), false,
      `${field} was skipped by the parser and must not survive from req.body`)
  })

  test(`update: ${label} is a true no-op`, async () => {
    currentUser = owner()
    db.findByIdResult = { _id: 'p1', ...BASE, agent: null }
    db.updateResult = { _id: 'p1', ...BASE }

    const res = await request('PUT', '/api/properties/p1', patch)
    assert.equal(res.status, 200)
    assert.equal(field in updateSet(), false,
      `${field} must not be written, so the stored value is preserved`)
  })
}

test('update: an empty numeric string preserves the stored value', async () => {
  currentUser = owner()
  // The property already has netSqm: 100. Blanking the input is a no-op for
  // this wave; explicit clearing is deliberately deferred to 10B2.
  db.findByIdResult = { _id: 'p1', ...BASE, netSqm: 100, agent: null }
  db.updateResult = { _id: 'p1', ...BASE, netSqm: 100 }

  const res = await request('PUT', '/api/properties/p1', { netSqm: '' })
  assert.equal(res.status, 200)
  const set = updateSet()
  assert.equal('netSqm' in set, false, 'the stored 100 must survive untouched')
})

test('a whole body of skipped values writes none of the 19', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE,
    netSqm: '', openAreaSqm: null, coefficient: '   ',
    currency: '', floorLocation: '', kitchenType: '', usageStatus: '', titleDeedStatus: '',
    sauna: null, jacuzzi: null, steamRoom: null, turkishBath: null, basement: null,
    withinSite: null, eligibleForCredit: null, exchange: null, hasVirtualTour: null,
    nearbyTransport: null, virtualTourUrl: '',
  })

  assert.equal(res.status, 201)
  for (const field of ALL_19) {
    assert.equal(field in created(), false, `${field} must be absent`)
  }
  assert.deepEqual(Object.keys(created()).sort(), Object.keys(BASE).sort())
})

/* ══════════════ 12. Normalised values DO reach the write ═════════════ */

test('a numeric string is stored as a real number, not a string', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, netSqm: '120.5', openAreaSqm: '30', coefficient: '1.75',
  })
  assert.equal(res.status, 201)
  assert.strictEqual(created().netSqm, 120.5)
  assert.strictEqual(created().openAreaSqm, 30)
  assert.strictEqual(created().coefficient, 1.75)
  assert.equal(typeof created().netSqm, 'number', 'must not arrive as a string')
})

test('a deduped transport array reaches the write payload', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, nearbyTransport: ['Metro', 'Metro', 'Bus', 'Metro'],
  })
  assert.equal(res.status, 201)
  assert.deepEqual(created().nearbyTransport, ['Metro', 'Bus'])
})

test('a derived priceLabel reaches the write payload alongside currency', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', { ...BASE, currency: 'EUR' })
  assert.equal(res.status, 201)
  assert.equal(created().currency, 'EUR')
  assert.equal(created().priceLabel, '€')
})

test('a custom priceLabel survives the strip — it is not an owned field', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, priceLabel: 'Price on request',
  })
  assert.equal(res.status, 201)
  assert.equal(created().priceLabel, 'Price on request',
    'priceLabel is not owned by the parser and must never be stripped')
})

test('a normalised virtual tour URL reaches the write payload', async () => {
  currentUser = owner()
  const res = await request('POST', '/api/properties', {
    ...BASE, virtualTourUrl: 'https://my.matterport.com/show/?m=abc',
  })
  assert.equal(res.status, 201)
  assert.equal(created().virtualTourUrl, 'https://my.matterport.com/show/?m=abc')
})

test('an update writes only the normalised owned fields it was given', async () => {
  currentUser = owner()
  db.findByIdResult = { _id: 'p1', ...BASE, agent: null }
  db.updateResult = { _id: 'p1', ...BASE }

  const res = await request('PUT', '/api/properties/p1', {
    netSqm: '88', sauna: false, nearbyTransport: ['Bus', 'Bus'],
  })
  assert.equal(res.status, 200)
  const set = updateSet()
  assert.strictEqual(set.netSqm, 88)
  assert.strictEqual(set.sauna, false)
  assert.deepEqual(set.nearbyTransport, ['Bus'])
  assert.equal('jacuzzi' in set, false, 'untouched amenities stay untouched')
})

test('EXTENDED_OWNED_FIELDS covers the 19 and excludes priceLabel', async () => {
  assert.equal(EXTENDED_OWNED_FIELDS.length, 19)
  assert.deepEqual([...EXTENDED_OWNED_FIELDS].sort(), [...ALL_19].sort())
  assert.equal(EXTENDED_OWNED_FIELDS.includes('priceLabel'), false)
  for (const untouchable of ['agent', 'location', 'status', 'featured', 'images', 'price']) {
    assert.equal(EXTENDED_OWNED_FIELDS.includes(untouchable), false,
      `${untouchable} must never be owned by this parser`)
  }
})

/* ══════════════ 13. Real Mongoose hydration ══════════════════════════ */
//
// The route tests above mock the model, so they can say nothing about what
// Mongoose itself does to a document. These use the REAL Property schema with
// no database connection, because a schema default applies on HYDRATION and
// would therefore rewrite history for every listing already stored.

// A query string gives a DIFFERENT module specifier, so mock.module above does
// not intercept it and the genuine Mongoose model is loaded. That is the whole
// point of this section: a schema default applies on hydration, and only the
// real schema can prove whether it does.
const { default: RealProperty } = await import('../models/Property.js?real=1')

const legacyDoc = (extra = {}) => RealProperty.hydrate({
  _id: '000000000000000000000001',
  title: 'Legacy', listingType: 'Sale', price: 100,
  district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1,
  ...extra,
})

test('a legacy document with no currency stays without one', async () => {
  const doc = legacyDoc({ priceLabel: '€' })
  assert.equal(doc.currency, undefined,
    'a schema default would invent a currency for every stored listing')
  assert.equal('currency' in doc.toObject(), false)
})

for (const label of ['€', '₺', '$', '£', 'Price on request']) {
  test(`a legacy document priced with "${label}" gains no contradictory currency`, async () => {
    const doc = legacyDoc({ priceLabel: label })
    assert.equal(doc.priceLabel, label, 'the stored label is untouched')
    assert.equal(doc.currency, undefined,
      `${label} must not silently become USD`)
  })
}

test('a new document gets no currency unless one is supplied', async () => {
  const doc = new RealProperty({
    title: 'N', listingType: 'Sale', price: 1,
    district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1,
  })
  assert.equal(doc.currency, undefined)
})

test('an explicitly supplied currency is kept', async () => {
  const doc = new RealProperty({
    title: 'N', listingType: 'Sale', price: 1, currency: 'EUR',
    district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1,
  })
  assert.equal(doc.currency, 'EUR')
})

test('hydration invents none of the new booleans or arrays either', async () => {
  const doc = legacyDoc()
  const obj = doc.toObject()
  for (const field of NEW_BOOLEANS) {
    assert.equal(obj[field], undefined, `${field} must stay unknown on a legacy listing`)
  }
  assert.equal(obj.nearbyTransport, undefined, 'no empty array may be materialised')
})

test('the five pre-existing booleans still default to false on a new document', async () => {
  const doc = new RealProperty({
    title: 'N', listingType: 'Sale', price: 1,
    district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1,
  })
  for (const field of ['furnished', 'balcony', 'elevator', 'pool', 'garden']) {
    assert.equal(doc[field], false, `${field} keeps its original behaviour`)
  }
})
