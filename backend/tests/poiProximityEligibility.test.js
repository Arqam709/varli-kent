// Wave 17 correction — the internal candidate-location read.
//
// Two defects, both in the one query Wave 17 added:
//
//   1. It is awaited with no fail-soft boundary, so a database hiccup during
//      the location read escapes runPropertySearch and can fail POST /api/chat
//      — for a search that had already succeeded.
//
//   2. Its result is only Map<id, coordinate>, so an id being absent is read
//      as "still public, just no publishable coordinate". It can equally mean
//      "no longer public" — sold, rented or deleted between the two reads —
//      and that listing then survives into a public reply. The status filter
//      is applied and its answer is thrown away.
//
// Absence has to distinguish those two, so the read reports eligibility as
// well as coordinates.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  runProximityPass,
  applyPoiProximity,
  loadPublicLocationState,
} from '../services/poiProximitySearch.js'

import { PROPERTY_SELECT } from '../services/chatPropertySearch.js'
import { publicLocation } from '../routes/properties.js'

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const METRO = { lat: 41.0, lon: 29.0, name: 'Kadıköy Metro' }

const PUBLISHED_NEAR = { lat: 41.0045, lng: 29.0, isApproximate: false, approxRadiusKm: 1 }
// Secret pin ~20 m from the metro. Never usable.
const SECRET_PIN = { lat: 41.00018, lng: 29.0, isApproximate: true, approxRadiusKm: 2 }

const row = (id, title, location, status = 'Available') => ({ _id: id, title, status, location })

const applyProjection = (doc, select) => {
  if (!select) return { ...doc }
  const projected = { _id: doc._id }
  for (const field of select.split(/\s+/).filter(Boolean)) {
    if (field in doc) projected[field] = doc[field]
  }
  return projected
}

/*
 * A model whose SECOND read can see different data from the first — which is
 * exactly what a race is. `mutate` runs once, immediately before the location
 * query resolves.
 */
const racingModel = (rows, { mutate = null, failLocationRead = false } = {}) => {
  const queries = []
  let mutated = false

  return {
    queries,
    find(filter) {
      const q = { filter, select: null, limit: null }
      queries.push(q)
      const isLocationRead = Boolean(filter?._id?.$in)

      const chain = {
        select(fields) { q.select = fields; return chain },
        limit(n) { q.limit = n; return chain },
        then(resolve, reject) {
          if (isLocationRead) {
            if (failLocationRead) {
              return Promise.reject(new Error('connection lost')).then(resolve, reject)
            }
            if (mutate && !mutated) { mutate(rows); mutated = true }
          }

          const ids = filter?._id?.$in?.map(String)
          const matched = rows.filter((d) => {
            if (filter.status !== undefined && d.status !== filter.status) return false
            if (ids && !ids.includes(String(d._id))) return false
            return true
          })

          return Promise.resolve(matched.map((d) => applyProjection(d, q.select))).then(resolve, reject)
        },
      }
      return chain
    },
  }
}

const poiFetch = (pois = [METRO]) => {
  const calls = []
  const fn = async (args) => { calls.push(args); return pois }
  fn.calls = calls
  return fn
}

const candidates = (rows) => rows.map((r) => applyProjection(r, PROPERTY_SELECT))

const NEAR_QUESTION = 'Find apartments near a metro station'

/* ═══════════ 1. The location read must never break the chat ═══════════ */

test('1a. a failing location read does not throw out of the proximity pass', async () => {
  const rows = [row('p1', 'Near Flat', PUBLISHED_NEAR)]
  const model = racingModel(rows, { failLocationRead: true })
  const fetchPois = poiFetch()

  let threw = false
  let result = null
  try {
    result = await runProximityPass({
      properties: candidates(rows),
      parsed: {},
      message: NEAR_QUESTION,
      filter: {},
      mustHaveFilter: {},
      PropertyModel: model,
      fetchPoisForCategoryFn: fetchPois,
      propertySelect: PROPERTY_SELECT,
    })
  } catch {
    threw = true
  }

  assert.equal(threw, false, 'a database hiccup during the location read escaped as an exception')
  assert.ok(result, 'no result was produced')
})

test('1b. a failing location read returns the ORIGINAL candidates, unverified', async () => {
  // The widened pool exists only to give ranking a fair chance. With no
  // ranking possible it is 300 listings the visitor never asked for.
  const rows = [
    row('p1', 'Original Flat', PUBLISHED_NEAR),
    row('p2', 'Widened Flat', PUBLISHED_NEAR),
    row('p3', 'Another Widened Flat', PUBLISHED_NEAR),
  ]
  const model = racingModel(rows, { failLocationRead: true })

  const result = await runProximityPass({
    properties: candidates([rows[0]]),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: model,
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  assert.equal(result.applied, true)
  assert.equal(result.verified, false, 'a failed location read was reported as verified')
  assert.deepEqual(result.properties.map((p) => p._id), ['p1'], 'the widened pool was returned after a failure')
  assert.ok(!result.properties.some((p) => p.poiProximity), 'a distance was fabricated after a failed read')
})

test('1c. no POI provider call is made once there is nothing to rank', async () => {
  const rows = [row('p1', 'Near Flat', PUBLISHED_NEAR)]
  const fetchPois = poiFetch()

  await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: racingModel(rows, { failLocationRead: true }),
    fetchPoisForCategoryFn: fetchPois,
    propertySelect: PROPERTY_SELECT,
  })

  assert.equal(fetchPois.calls.length, 0, 'Overpass was called with no coordinates to rank against')
})

/* ═══════════ 2. Public eligibility is re-established, not assumed ═══════════ */

test('2a. the read reports eligibility as well as coordinates', async () => {
  const rows = [
    row('public', 'Public Flat', PUBLISHED_NEAR),
    row('withheld', 'Withheld Flat', SECRET_PIN),
    row('nocoords', 'No Coordinates Flat', undefined),
    row('sold', 'Sold Flat', PUBLISHED_NEAR, 'Sold'),
  ]

  const state = await loadPublicLocationState(
    ['public', 'withheld', 'nocoords', 'sold', 'deleted'],
    racingModel(rows)
  )

  // Eligible: currently Available, whatever their location situation.
  assert.deepEqual([...state.eligibleIds].sort(), ['nocoords', 'public', 'withheld'])

  // Coordinates: only what publicLocation publishes.
  assert.deepEqual([...state.coordinates.keys()], ['public'])
  assert.ok(!state.coordinates.has('withheld'), 'a withheld coordinate entered the ranking map')
})

test('2b. a listing sold between the two reads is dropped, not kept unverified', async () => {
  const rows = [
    row('p1', 'Marina Flat', PUBLISHED_NEAR),
    row('p2', 'Still Available Flat', PUBLISHED_NEAR),
  ]

  const model = racingModel(rows, {
    // Sold after the search returned it, before the location read.
    mutate: (all) => { all[0].status = 'Sold' },
  })

  const result = await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: model,
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  const ids = result.properties.map((p) => p._id)
  assert.ok(!ids.includes('p1'), 'a listing that stopped being public survived into the results')
  assert.ok(ids.includes('p2'), 'a still-public listing was dropped')
})

test('2c. a listing rented between the two reads is dropped', async () => {
  const rows = [row('p1', 'Marina Flat', PUBLISHED_NEAR)]
  const model = racingModel(rows, { mutate: (all) => { all[0].status = 'Rented' } })

  const result = await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: model,
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  assert.deepEqual(result.properties.map((p) => p._id), [], 'a Rented listing survived')
})

test('2d. a listing deleted between the two reads is dropped', async () => {
  const rows = [
    row('p1', 'Marina Flat', PUBLISHED_NEAR),
    row('p2', 'Survivor Flat', PUBLISHED_NEAR),
  ]
  const model = racingModel(rows, { mutate: (all) => { all.splice(0, 1) } })

  const result = await runProximityPass({
    properties: candidates([{ _id: 'p1', title: 'Marina Flat', status: 'Available' }, rows[1]]),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: model,
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  const ids = result.properties.map((p) => p._id)
  assert.ok(!ids.includes('p1'), 'a deleted listing survived into the results')
  assert.ok(ids.includes('p2'))
})

test('2e. the rule applies to widened-pool candidates too', async () => {
  const rows = [
    row('original', 'Original Flat', PUBLISHED_NEAR),
    row('widened', 'Widened Flat', PUBLISHED_NEAR),
  ]
  const model = racingModel(rows, { mutate: (all) => { all[1].status = 'Sold' } })

  const result = await runProximityPass({
    properties: candidates([rows[0]]),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: model,
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  const ids = result.properties.map((p) => p._id)
  assert.ok(!ids.includes('widened'), 'a widened-pool listing that became non-public survived')
  assert.ok(ids.includes('original'))
})

/* ═══════════ 3. Non-public must not be confused with private ═══════════ */

test('3a. a still-public listing with a WITHHELD coordinate is kept, unverified', async () => {
  // The distinction the whole correction turns on: this listing is public and
  // must be shown; its coordinate is private and must not be used.
  assert.equal(publicLocation(SECRET_PIN).lat, undefined, 'publicLocation stopped withholding')

  const rows = [
    row('withheld', 'Withheld Flat', SECRET_PIN),
    row('public', 'Public Flat', PUBLISHED_NEAR),
  ]

  const result = await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: racingModel(rows),
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  const withheld = result.properties.find((p) => p._id === 'withheld')
  assert.ok(withheld, 'a public listing was dropped because its coordinate is private')
  assert.equal(withheld.poiProximity, undefined, 'a withheld listing acquired a measured distance')

  // Its secret pin is nearer than anything else, so first place is the tell.
  assert.equal(result.properties[0]._id, 'public', 'a secret coordinate was used for ranking')
  assert.ok(!JSON.stringify(result).includes('41.00018'), 'the secret coordinate leaked')
})

test('3b. a still-public listing with no location at all is kept, unverified', async () => {
  const rows = [
    row('nocoords', 'No Coordinates Flat', undefined),
    row('public', 'Public Flat', PUBLISHED_NEAR),
  ]

  const result = await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: racingModel(rows),
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  const ids = result.properties.map((p) => p._id)
  assert.ok(ids.includes('nocoords'), 'a listing with no coordinate was dropped')
  assert.equal(result.properties.find((p) => p._id === 'nocoords').poiProximity, undefined)
  assert.equal(ids[0], 'public', 'the ranked listing should lead')
})

test('3c. a still-public listing with a published coordinate ranks normally', async () => {
  const rows = [row('public', 'Public Flat', PUBLISHED_NEAR)]

  const result = await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: racingModel(rows),
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  assert.equal(result.verified, true)
  assert.ok(result.properties[0].poiProximity.distanceKm < 1)
})

/* ═══════════ 4. The query itself ═══════════ */

test('4. still exactly one status-checked, location-only batch read', async () => {
  const rows = [row('a', 'A', PUBLISHED_NEAR), row('b', 'B', PUBLISHED_NEAR)]
  const model = racingModel(rows)

  await runProximityPass({
    properties: candidates(rows),
    parsed: {},
    message: NEAR_QUESTION,
    filter: {},
    mustHaveFilter: {},
    PropertyModel: model,
    fetchPoisForCategoryFn: poiFetch(),
    propertySelect: PROPERTY_SELECT,
  })

  const locationReads = model.queries.filter((q) => q.select === '_id location')
  assert.equal(locationReads.length, 1, `expected 1 location read, got ${locationReads.length} (N+1?)`)
  assert.equal(locationReads[0].filter.status, 'Available', 'the location read stopped re-checking public status')
  assert.ok(Array.isArray(locationReads[0].filter._id.$in), 'the read is not scoped to candidate ids')
})

test('4b. applyPoiProximity drops a candidate absent from eligibleIds', async () => {
  // Asserted directly, so the rule is pinned at the unit level too.
  const properties = [
    { _id: 'gone', title: 'Gone Flat' },
    { _id: 'here', title: 'Here Flat' },
  ]

  const result = await applyPoiProximity({
    properties,
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds: new Set(['here']),
    coordinates: new Map(),
    fetchPoisForCategoryFn: poiFetch(),
  })

  assert.deepEqual(result.properties.map((p) => p._id), ['here'],
    'a candidate absent from the current eligible set survived')
})
