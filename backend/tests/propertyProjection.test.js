// Wave 15B correction — the property-location projection boundary.
//
// The privacy suite next door proved the RULES. It could not prove the
// PLUMBING, because its fake model implemented `.select()` as a no-op chain
// link, so every fixture still carried `location` no matter what the
// production query asked for. Real MongoDB honours an inclusion projection
// and drops everything not listed.
//
// The fake below actually applies the projection, which is the whole point of
// this file: it models what the database really returns, so the difference
// between "we asked for location" and "we did not" becomes observable.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import Property from '../models/Property.js'
import { PROPERTY_SELECT } from '../services/chatPropertySearch.js'
import { resolvePropertyByPhrase } from '../services/propertyNameResolver.js'
import { buildAreaInfoAnswer } from '../services/areaInfoAnswer.js'
import { publicLocation } from '../routes/properties.js'

/* ── Fixtures, with deliberately distinct coordinates ───────────────────── */

const STORED_PUBLIC = { lat: 41.12, lng: 29.65, isApproximate: false, approxRadiusKm: 1 }
const STORED_PRIVATE = { lat: 41.123456, lng: 29.654321, isApproximate: true, approxRadiusKm: 2 }

const row = (id, title, location) => ({ _id: id, title, status: 'Available', location })

/*
 * A fake that behaves like MongoDB's projection does.
 *
 * `.select('a b c')` is an INCLUSION projection: the document comes back with
 * those fields and `_id`, and nothing else. Anything the caller did not name
 * — `location` among them — is simply absent. This fake applies that rule
 * rather than ignoring it, so a query that forgets to ask for a field cannot
 * accidentally receive it here and then fail in production.
 */
// Applies the same predicates the production query uses, so a document
// the real query would filter out cannot be returned here either.
const matchesFilter = (doc, filter = {}) => {
  if (filter._id !== undefined && String(doc._id) !== String(filter._id)) return false
  if (filter.status !== undefined && doc.status !== filter.status) return false
  if (filter.title instanceof RegExp && !filter.title.test(doc.title)) return false
  return true
}
const projectionAwareModel = (rows, { failOn = () => false } = {}) => {
  const queries = []

  const applyProjection = (doc, select) => {
    if (!select) return { ...doc }

    const fields = select.split(/\s+/).filter(Boolean)
    const projected = { _id: doc._id }
    for (const field of fields) {
      if (field in doc) projected[field] = doc[field]
    }
    return projected
  }

  const buildChain = (kind, filter, matcher) => {
    const query = { kind, filter, select: null, limit: null }
    queries.push(query)

    const chain = {
      select(fields) { query.select = fields; return chain },
      limit(n) { query.limit = n; return chain },
      then(resolve, reject) {
        if (failOn(query)) return Promise.reject(new Error('connection lost')).then(resolve, reject)

        const matched = rows.filter(matcher).map((doc) => applyProjection(doc, query.select))
        const result = kind === 'findOne' ? (matched[0] ?? null) : matched
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return chain
  }

  return {
    queries,
    find(filter) {
      return buildChain('find', filter, (doc) => matchesFilter(doc, filter))
    },
    findOne(filter) {
      return buildChain('findOne', filter, (doc) => matchesFilter(doc, filter))
    },
  }
}

const recordingPoiFetch = (pois = []) => {
  const calls = []
  const fn = async (args) => { calls.push(args); return pois }
  fn.calls = calls
  return fn
}

const SCHOOLS = [
  { lat: 41.121, lon: 29.651, name: 'Kadıköy Primary' },
  { lat: 41.125, lon: 29.655, name: 'Bosphorus College' },
]

/* ═══════════ 1. What real Mongoose actually sends ═══════════ */

test('1a. PROPERTY_SELECT is an inclusion projection that omits location', () => {
  // Built from the real model and the real constant — no fake involved.
  const projection = Property.find({ status: 'Available' }).select(PROPERTY_SELECT).projection()

  assert.ok(
    Object.values(projection).every((value) => value === 1),
    'PROPERTY_SELECT stopped being a pure inclusion projection'
  )
  assert.equal(projection.location, undefined, 'location was added to the public projection')

  // The rule this whole file exists to encode: under an inclusion projection,
  // a field that is not named is not returned.
  for (const field of ['location', 'descriptionEmbedding', 'embeddingUpdatedAt']) {
    assert.ok(!(field in projection), `${field} is now selectable through the public projection`)
  }
})

test('1b. the public projection strips location from a document that has one', () => {
  const projection = Property.find().select(PROPERTY_SELECT).projection()
  const full = new Property({ title: 'Marina Residence', status: 'Available', location: STORED_PUBLIC }).toObject()

  assert.deepEqual(full.location, STORED_PUBLIC, 'the fixture never had a location to begin with')

  const projected = Object.fromEntries(Object.entries(full).filter(([key]) => projection[key] === 1))
  assert.equal(projected.location, undefined, 'the projection did not strip location')
  assert.equal(projected.title, 'Marina Residence', 'the projection stripped a field it should keep')
})

/* ═══════════ 2. The default resolver contract ═══════════ */

test('2. resolvePropertyByPhrase still returns location-free data', async () => {
  const model = projectionAwareModel([row('p1', 'Marina Residence', STORED_PUBLIC)])

  const result = await resolvePropertyByPhrase('Marina Residence', model)

  assert.equal(result.status, 'resolved')
  assert.equal(result.property.title, 'Marina Residence')
  assert.equal(
    result.property.location, undefined,
    'the default resolver started returning a stored location — 15A responses would leak it'
  )

  for (const query of model.queries) {
    assert.equal(query.select, PROPERTY_SELECT, 'the default resolver changed its projection')
  }
})

/* ═══════════ 3. The 15B internal path — the bug this file was written for ═══ */

test('3a. a published exact location produces real POI results', async () => {
  // Under a projection-aware model this is the case that failed before the
  // fix: the resolver returned no location, so every nearby question answered
  // "we don't have enough location information", for every property.
  const model = projectionAwareModel([row('p1', 'Marina Residence', STORED_PUBLIC)])
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: model,
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'results', `expected results, got '${result.status}'`)
  assert.equal(result.matches.length, 2)
  assert.equal(result.matches[0].name, 'Kadıköy Primary')
  assert.equal(fetchPois.calls.length, 1)
})

test('3b. the location read is one bounded, location-only, still-public lookup', async () => {
  const model = projectionAwareModel([row('p1', 'Marina Residence', STORED_PUBLIC)])

  await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: model,
    fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
  })

  const locationQueries = model.queries.filter((query) => query.kind === 'findOne')
  assert.equal(locationQueries.length, 1, `expected exactly one location lookup, got ${locationQueries.length}`)

  // Projection: location and nothing else.
  assert.equal(locationQueries[0].select, 'location', 'the location lookup asked for more than location')

  // Filter: the resolved id AND the public status. The status predicate is
  // what closes the window between the two reads — see the race test below.
  assert.deepEqual(
    Object.keys(locationQueries[0].filter).sort(), ['_id', 'status'],
    'the location lookup does not constrain both id and status'
  )
  assert.equal(locationQueries[0].filter._id, 'p1')
  assert.equal(locationQueries[0].filter.status, 'Available', 'the location lookup does not require a public status')
})

test('3f. a listing that stops being public between the two reads is refused', async () => {
  /*
   * The TOCTOU window. Title resolution and the location read are two round
   * trips; a listing can be sold, rented or unpublished in between. This
   * fixture is Available for the first query and Sold by the second, which is
   * exactly what a real race looks like from the server's point of view.
   */
  const rows = [row('p1', 'Marina Residence', STORED_PUBLIC)]
  const model = projectionAwareModel(rows)
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const original = model.findOne.bind(model)
  model.findOne = (filter) => {
    rows[0].status = 'Sold'   // the state change lands before the second read
    return original(filter)
  }

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: model,
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'no-property', `a no-longer-public listing produced '${result.status}'`)
  assert.equal(fetchPois.calls.length, 0, 'a POI search ran for a listing that is no longer public')
  assert.ok(!JSON.stringify(result).includes('41.12'), 'the coordinate of an ineligible listing was used')

  // The reply is the same one an unknown name gets, so the response cannot be
  // used to learn that a non-public record exists.
  assert.equal(result.phrase, 'Marina Residence')
  assert.ok(!('title' in result), 'the ineligible listing was named back to the visitor')
})

test('3g. the same refusal covers a listing deleted between the two reads', async () => {
  const rows = [row('p1', 'Marina Residence', STORED_PUBLIC)]
  const model = projectionAwareModel(rows)
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const original = model.findOne.bind(model)
  model.findOne = (filter) => {
    rows.length = 0            // gone entirely by the time the location is read
    return original(filter)
  }

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: model,
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'no-property')
  assert.equal(fetchPois.calls.length, 0)
})

test('3c. an approximate listing still yields no coordinate and no provider call', async () => {
  const model = projectionAwareModel([row('p1', 'Marina Residence', STORED_PRIVATE)])
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: model,
    fetchPoisForCategoryFn: fetchPois,
  })

  // Reading the stored value server-side is fine; publishing anything derived
  // from it is not. publicLocation is what draws that line.
  assert.equal(publicLocation(STORED_PRIVATE).lat, undefined, 'publicLocation stopped withholding')
  assert.equal(result.status, 'no-location', 'a withheld coordinate produced distances')
  assert.equal(fetchPois.calls.length, 0, 'the provider was contacted for a withheld coordinate')

  assert.ok(
    !JSON.stringify(result).includes('41.123456'),
    'the withheld coordinate reached the result'
  )
})

test('3d. a listing that genuinely has no stored location is handled', async () => {
  for (const location of [undefined, null, {}, { lat: 41.1 }]) {
    const model = projectionAwareModel([row('p1', 'Marina Residence', location)])
    const fetchPois = recordingPoiFetch(SCHOOLS)

    const result = await buildAreaInfoAnswer({
      message: 'What schools are near Marina Residence?',
      PropertyModel: model,
      fetchPoisForCategoryFn: fetchPois,
    })

    assert.equal(result.status, 'no-location', `not handled: ${JSON.stringify(location)}`)
    assert.equal(fetchPois.calls.length, 0)
  }
})

test('3e. a failed location lookup is not reported as "no location"', async () => {
  // "We don't have location information for this listing" is a claim about our
  // data. It must not be made when the truth is that the query failed.
  const model = projectionAwareModel([row('p1', 'Marina Residence', STORED_PUBLIC)], {
    failOn: (query) => query.kind === 'findOne',
  })
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: model,
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'lookup-error', `a database failure was reported as '${result.status}'`)
  assert.notEqual(result.status, 'no-location')
  assert.equal(fetchPois.calls.length, 0)
})

/* ═══════════ 4. No extra lookup on any other path ═══════════ */

test('4a. an ambiguous or unknown target never reaches the location lookup', async () => {
  const ambiguous = projectionAwareModel([
    row('a', 'Bosphorus Residence A', STORED_PUBLIC),
    row('b', 'Bosphorus Residence B', STORED_PUBLIC),
  ])
  const ambiguousResult = await buildAreaInfoAnswer({
    message: 'What schools are near Bosphorus Residence?',
    PropertyModel: ambiguous,
    fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
  })

  assert.equal(ambiguousResult.status, 'ambiguous')
  assert.equal(ambiguous.queries.filter((q) => q.kind === 'findOne').length, 0, 'an ambiguous target paid for a location read')

  const missing = projectionAwareModel([])
  const missingResult = await buildAreaInfoAnswer({
    message: 'What schools are near Atlantis Palace?',
    PropertyModel: missing,
    fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
  })

  assert.equal(missingResult.status, 'no-property')
  assert.equal(missing.queries.filter((q) => q.kind === 'findOne').length, 0)
})

test('4b. an ordinary message costs no query at all', async () => {
  const model = projectionAwareModel([row('p1', 'Marina Residence', STORED_PUBLIC)])

  const result = await buildAreaInfoAnswer({
    message: 'Find apartments near schools',
    PropertyModel: model,
    fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
  })

  assert.equal(result.status, 'not-an-area-question')
  assert.equal(model.queries.length, 0, 'an ordinary search hit the database')
})

/* ═══════════ 5. Nothing leaks out ═══════════ */

test('5. no coordinate survives into a 15B result, under a real projection', async () => {
  for (const stored of [STORED_PUBLIC, STORED_PRIVATE]) {
    const model = projectionAwareModel([row('p1', 'Marina Residence', stored)])

    const result = await buildAreaInfoAnswer({
      message: 'What schools are near Marina Residence?',
      PropertyModel: model,
      fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
    })

    const serialized = JSON.stringify(result)
    assert.ok(!/"lat"|"lng"|"lon"|"location"/.test(serialized), `a coordinate key leaked: ${serialized}`)
    for (const value of ['41.12', '29.65', '41.123456', '29.654321']) {
      assert.ok(!serialized.includes(value), `the coordinate ${value} leaked: ${serialized}`)
    }
  }
})

test('6. mongoose is the real thing, not a stub', () => {
  // Guards against this file quietly testing nothing if the import changes.
  assert.equal(typeof mongoose.model, 'function')
  assert.equal(typeof Property.find, 'function')
})
