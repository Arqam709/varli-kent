// Wave 17 — geographic proximity in property search.
//
// The donor's version of this feature does not actually work: every property
// reaching its ranker came through a projection that omits `location`, so
// nothing was ever ranked, and its own test passes only because it states it
// "deliberately never touches Property.find()" and hand-builds fixtures
// carrying a location the real query never returns.
//
// So the fixtures here go through a projection-aware model, and the location
// arrives the way production makes it arrive. And the fixture that matters
// most is the one whose SECRET pin sits 20 m from a POI: if a stored private
// coordinate is ever used, that property jumps to the top and the test fails.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveNearPoi,
  extractNamedPlaceQuery,
  resolveNamedPlaceNearPoi,
  applyPoiProximity,
  loadPublicLocationState,
  runProximityPass,
  POI_PROXIMITY_THRESHOLD_KM,
} from '../services/poiProximitySearch.js'

import { PROPERTY_SELECT } from '../services/chatPropertySearch.js'
import { publicLocation } from '../routes/properties.js'
import { renderProximityClause, renderProximityUnverified } from '../services/chatReplyRenderer.js'

/* ── Geography ────────────────────────────────────────────────────────────
 * One metro station. Distances are real haversine values from it.
 */
const METRO = { lat: 41.0000, lon: 29.0000, name: 'Kadıköy Metro' }

const PUBLISHED_NEAR = { lat: 41.0045, lng: 29.0000, isApproximate: false, approxRadiusKm: 1 }  // ~0.5 km
const PUBLISHED_MID = { lat: 41.0180, lng: 29.0000, isApproximate: false, approxRadiusKm: 1 }  // ~2.0 km
const PUBLISHED_FAR = { lat: 41.0540, lng: 29.0000, isApproximate: false, approxRadiusKm: 1 }  // ~6.0 km

/*
 * The privacy fixture. Its SECRET pin is ~20 m from the metro — closer than
 * anything else here — and publicLocation withholds it. Any implementation
 * that reads the stored coordinate ranks this first and fails loudly.
 */
const SECRET_PIN = { lat: 41.00018, lng: 29.0000, isApproximate: true, approxRadiusKm: 2 }

const row = (id, title, location, extra = {}) => ({
  _id: id, title, status: 'Available', description: '', ...extra, location,
})

const INVENTORY = [
  row('near', 'Near Flat', PUBLISHED_NEAR),
  row('mid', 'Mid Flat', PUBLISHED_MID),
  row('far', 'Far Flat', PUBLISHED_FAR),
  row('nocoords', 'No Coordinates Flat', undefined),
  row('secret', 'Withheld Flat', SECRET_PIN),
]

/* ── A projection-aware, status-aware model ─────────────────────────────── */

const applyProjection = (doc, select) => {
  if (!select) return { ...doc }
  const projected = { _id: doc._id }
  for (const field of select.split(/\s+/).filter(Boolean)) {
    if (field in doc) projected[field] = doc[field]
  }
  return projected
}

const matchesFilter = (doc, filter = {}) => {
  if (filter.status !== undefined && doc.status !== filter.status) return false
  if (filter._id?.$in && !filter._id.$in.map(String).includes(String(doc._id))) return false
  return true
}

const model = (rows = INVENTORY) => {
  const queries = []
  return {
    queries,
    find(filter) {
      const q = { filter, select: null, limit: null }
      queries.push(q)
      const chain = {
        select(fields) { q.select = fields; return chain },
        limit(n) { q.limit = n; return chain },
        then: (resolve, reject) => Promise.resolve(
          rows.filter((d) => matchesFilter(d, filter)).map((d) => applyProjection(d, q.select))
        ).then(resolve, reject),
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

const geocodeStub = (result) => {
  const calls = []
  const fn = async (phrase) => { calls.push(phrase); return result }
  fn.calls = calls
  return fn
}

// The candidate list as production supplies it — already projected.
const projectedCandidates = (ids = ['near', 'mid', 'far', 'nocoords', 'secret']) =>
  INVENTORY.filter((r) => ids.includes(r._id)).map((r) => applyProjection(r, PROPERTY_SELECT))

/* ═══════════ 1. Intent resolution ═══════════ */

test('1a. a category proximity request resolves from raw text', () => {
  for (const [message, expected] of [
    ['Find apartments near a metro station', 'transit_station'],
    ['find villas near hospitals', 'hospital'],
    ['show me flats near schools', 'school'],
    ['metroya yakın daireler', 'transit_station'],
    ['شقق قريبة من المترو', 'transit_station'],
  ]) {
    assert.equal(resolveNearPoi({}, message)?.categoryId, expected, `bad category for: ${message}`)
  }
})

test('1b. a brand is carried through when the visitor names one', () => {
  const resolved = resolveNearPoi({}, 'Find apartments near BIM')
  assert.equal(resolved?.categoryId, 'supermarket')
  assert.equal(resolved?.brand, 'bim')
})

test('1c. the parser is only a fallback, and its category is validated', () => {
  // Raw text wins.
  assert.equal(resolveNearPoi({ nearPoi: { categoryId: 'hospital' } }, 'near a metro station').categoryId, 'transit_station')
  // Parser used when text says nothing.
  assert.equal(resolveNearPoi({ nearPoi: { categoryId: 'hospital' } }, 'find me something').categoryId, 'hospital')
  // A category outside the registry is refused, so it can never reach Overpass.
  assert.equal(resolveNearPoi({ nearPoi: { categoryId: '"];out;//' } }, 'find me something'), null)
})

test('1d. an ordinary search is not a proximity request', () => {
  for (const message of [
    'Find apartments in Kadıköy',
    'Show villas under 500000',
    '3 bedroom apartment with balcony',
    'show me more',
  ]) {
    assert.equal(resolveNearPoi({}, message), null, `wrongly treated as proximity: ${message}`)
    assert.equal(extractNamedPlaceQuery(message), null, `wrongly treated as a named place: ${message}`)
  }
})

test('1e. a named place is extracted only behind an explicit trigger', () => {
  assert.equal(extractNamedPlaceQuery('Find apartments near Taksim Square'), 'Taksim Square')
  assert.equal(extractNamedPlaceQuery('Show villas close to Galata Tower'), 'Galata Tower')
  assert.equal(extractNamedPlaceQuery('Taksim Meydanı yakınında daireler'), 'Taksim Meydanı')
  assert.equal(extractNamedPlaceQuery('شقق بالقرب من ميدان تقسيم'), 'ميدان تقسيم')

  // The donor additionally geocodes ANY message of six words or fewer that
  // has no trigger word — which would send an ordinary district search to
  // Nominatim. Deliberately not carried over.
  assert.equal(extractNamedPlaceQuery('Find apartments in Kadıköy'), null)
  assert.equal(extractNamedPlaceQuery('Paradise AVM'), null)
})

/* ═══════════ 2. The privacy boundary — the critical test ═══════════ */

test('2a. a listing whose pin is WITHHELD is never ranked, even 20 m from the POI', async () => {
  // publicLocation withholds this coordinate, so nothing may be derived from it.
  assert.equal(publicLocation(SECRET_PIN).lat, undefined, 'publicLocation stopped withholding')

  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'mid', 'far', 'nocoords', 'secret'], model())

  assert.ok(!coordinates.has('secret'), 'the withheld coordinate entered the ranking map')
  assert.ok(coordinates.has('near'), 'a published coordinate was dropped')

  const result = await applyPoiProximity({
    properties: projectedCandidates(),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: poiFetch(),
  })

  const secret = result.properties.find((p) => p._id === 'secret')
  assert.ok(secret, 'the withheld listing was dropped entirely — it should be kept, just unranked')
  assert.equal(secret.poiProximity, undefined, 'the withheld listing acquired a measured distance')

  // Its secret pin is the closest of all, so first place is the tell.
  assert.notEqual(result.properties[0]._id, 'secret', 'a secret coordinate was used for ranking')
  assert.equal(result.properties[0]._id, 'near', 'the nearest PUBLIC listing should lead')

  // And nothing derived from it appears anywhere.
  const serialized = JSON.stringify(result)
  assert.ok(!serialized.includes('41.00018'), 'the secret coordinate leaked')
  assert.ok(!serialized.includes('29.654321'))
})

test('2b. the location read is bounded, id-scoped and status-checked', async () => {
  const m = model()
  await loadPublicLocationState(['near', 'mid'], m)

  assert.equal(m.queries.length, 1, 'the location read is not a single batch query')
  const q = m.queries[0]
  assert.equal(q.select, '_id location', 'the location read asked for more than it needs')
  assert.equal(q.filter.status, 'Available', 'the location read does not re-check public status')
  assert.deepEqual(q.filter._id.$in, ['near', 'mid'], 'the read is not scoped to the resolved candidate ids')
})

test('2c. a sold listing contributes no coordinate', async () => {
  const sold = [{ ...row('near', 'Near Flat', PUBLISHED_NEAR), status: 'Sold' }]
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near'], model(sold))

  assert.equal(coordinates.size, 0, 'a non-public listing was given a coordinate')
})

test('2d. PROPERTY_SELECT still excludes location', () => {
  for (const field of ['location', 'lat', 'lng', 'descriptionEmbedding']) {
    assert.ok(!PROPERTY_SELECT.split(/\s+/).includes(field), `${field} was added to the public projection`)
  }
})

test('2e. no coordinate of any kind survives into the ranked output', async () => {
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'secret'], model())
  const result = await applyPoiProximity({
    properties: projectedCandidates(['near', 'secret']),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: poiFetch(),
  })

  const serialized = JSON.stringify(result.properties)
  assert.ok(!/"lat"|"lng"|"location"/.test(serialized), `a coordinate key survived: ${serialized}`)
})

/* ═══════════ 3. Real geography ═══════════ */

test('3a. published listings are filtered and ordered by actual distance', async () => {
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'mid', 'far', 'nocoords', 'secret'], model())

  const result = await applyPoiProximity({
    properties: projectedCandidates(),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: poiFetch(),
  })

  const ids = result.properties.map((p) => p._id)

  // Ranked first, nearest first.
  assert.equal(ids[0], 'near')
  assert.equal(ids[1], 'mid')

  // 6 km — the only bucket we can honestly exclude, because it is the only
  // one we actually measured.
  assert.ok(!ids.includes('far'), 'a listing measured beyond the threshold was kept')

  // Unmeasurable listings are kept, after the ranked ones, never claimed.
  assert.ok(ids.includes('nocoords') && ids.includes('secret'))
  assert.ok(ids.indexOf('nocoords') > ids.indexOf('mid'))

  assert.ok(result.properties[0].poiProximity.distanceKm < 1)
  assert.equal(result.properties[0].poiProximity.categoryId, 'transit_station')
})

test('3b. the donor threshold is preserved', async () => {
  assert.equal(POI_PROXIMITY_THRESHOLD_KM, 4)

  // A listing at ~2 km is in; ~6 km is out.
  const { eligibleIds, coordinates } = await loadPublicLocationState(['mid', 'far'], model())
  const result = await applyPoiProximity({
    properties: projectedCandidates(['mid', 'far']),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: poiFetch(),
  })

  assert.deepEqual(result.properties.map((p) => p._id), ['mid'])
})

test('3c. geography beats description text', async () => {
  /*
   * The case the whole wave exists for. A listing 500 m from the metro that
   * never says "metro" must outrank one 6 km away that does.
   */
  const rows = [
    row('near', 'Quiet Flat', PUBLISHED_NEAR, { description: 'A calm home with a garden.' }),
    row('far', 'Transit Flat', PUBLISHED_FAR, { description: 'Excellent access to the metro!' }),
  ]

  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'far'], model(rows))
  const result = await applyPoiProximity({
    properties: rows.map((r) => applyProjection(r, PROPERTY_SELECT)),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: poiFetch(),
  })

  assert.equal(result.properties[0]._id, 'near', 'description text outranked verified geography')
  assert.ok(
    !result.properties.some((p) => p._id === 'far'),
    'a listing that only TALKS about the metro survived a geographic filter'
  )
})

/* ═══════════ 4. Provider privacy and failure ═══════════ */

test('4a. Overpass receives a category and a brand — nothing else', async () => {
  const fetchPois = poiFetch()
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near'], model())

  await applyPoiProximity({
    properties: projectedCandidates(['near']),
    nearPoi: { categoryId: 'supermarket', brand: 'bim' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.deepEqual(Object.keys(fetchPois.calls[0]).sort(), ['brand', 'categoryId'])
  const sent = JSON.stringify(fetchPois.calls[0])
  for (const leak of ['41.0', '29.0', 'Near Flat', '_id', 'location']) {
    assert.ok(!sent.includes(leak), `'${leak}' was sent to the POI provider`)
  }
})

test('4b. a provider failure leaves the search intact and reports it unverified', async () => {
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'far'], model())

  const failing = await applyPoiProximity({
    properties: projectedCandidates(['near', 'far']),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: async () => { throw new Error('Overpass unreachable') },
  })

  assert.equal(failing.verified, false, 'a failed lookup was reported as verified')
  assert.equal(failing.properties.length, 2, 'a provider outage emptied the search')
  assert.ok(!failing.properties.some((p) => p.poiProximity), 'a distance was invented during an outage')
})

test('4c. an empty POI list is treated the same way — no silent emptying', async () => {
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'far'], model())

  const empty = await applyPoiProximity({
    properties: projectedCandidates(['near', 'far']),
    nearPoi: { categoryId: 'transit_station' },
    eligibleIds,
    coordinates,
    fetchPoisForCategoryFn: poiFetch([]),
  })

  assert.equal(empty.verified, false)
  assert.equal(empty.properties.length, 2)
})

/* ═══════════ 5. Named places ═══════════ */

test('5a. a landmark is geocoded through the hardened Wave 15B2 client', async () => {
  const geocode = geocodeStub({ status: 'resolved', place: { name: 'Taksim Meydanı', lat: 41.0, lon: 29.0 } })

  const nearPoi = await resolveNamedPlaceNearPoi('Find apartments near Taksim Square', geocode)

  assert.equal(nearPoi.categoryId, 'named_place')
  assert.equal(nearPoi.placeName, 'Taksim Meydanı')
  assert.deepEqual(geocode.calls, ['Taksim Square'], 'the geocoder got the wrong phrase')
})

test('5b. Nominatim receives a place phrase only', async () => {
  const geocode = geocodeStub({ status: 'resolved', place: { name: 'Taksim', lat: 41.0, lon: 29.0 } })
  await resolveNamedPlaceNearPoi('Find cheap apartments near Taksim Square', geocode)

  const sent = JSON.stringify(geocode.calls)
  for (const leak of ['41.0', '29.0', '_id', 'Near Flat', 'apartments']) {
    assert.ok(!sent.includes(leak), `'${leak}' reached the geocoder`)
  }
})

test('5c. a geocode failure or miss is inert', async () => {
  for (const outcome of [{ status: 'none' }, { status: 'error' }, null]) {
    assert.equal(await resolveNamedPlaceNearPoi('near Nowhere', geocodeStub(outcome)), null)
  }
  // A throwing geocoder is contained.
  assert.equal(await resolveNamedPlaceNearPoi('near X', async () => { throw new Error('boom') }), null)
})

test('5d. a landmark ranks properties through the same path as a category', async () => {
  const { eligibleIds, coordinates } = await loadPublicLocationState(['near', 'far'], model())

  const result = await applyPoiProximity({
    properties: projectedCandidates(['near', 'far']),
    nearPoi: { categoryId: 'named_place', lat: METRO.lat, lon: METRO.lon, placeName: 'Taksim Meydanı' },
    coordinates,
    // A named place needs no Overpass call at all.
    fetchPoisForCategoryFn: async () => { throw new Error('must not be called') },
  })

  assert.equal(result.verified, true)
  assert.deepEqual(result.properties.map((p) => p._id), ['near'])
  assert.equal(result.properties[0].poiProximity.placeName, 'Taksim Meydanı')
})

/* ═══════════ 6. The whole pass ═══════════ */

test('6a. an ordinary search costs nothing at all', async () => {
  const m = model()
  const fetchPois = poiFetch()
  const geocode = geocodeStub({ status: 'none' })

  const result = await runProximityPass({
    properties: projectedCandidates(['near']),
    parsed: {},
    message: 'Find apartments in Kadıköy',
    filter: {},
    mustHaveFilter: {},
    PropertyModel: m,
    fetchPoisForCategoryFn: fetchPois,
    geocodePlaceFn: geocode,
    propertySelect: PROPERTY_SELECT,
  })

  assert.equal(result.applied, false)
  assert.equal(m.queries.length, 0, 'an ordinary search read the database for locations')
  assert.equal(fetchPois.calls.length, 0, 'an ordinary search called Overpass')
  assert.equal(geocode.calls.length, 0, 'an ordinary search called Nominatim')
})

test('6b. a proximity search widens the pool and reads locations once', async () => {
  const m = model()
  const fetchPois = poiFetch()

  const result = await runProximityPass({
    properties: projectedCandidates(['far']),   // the waterfall found only the far one
    parsed: {},
    message: 'Find apartments near a metro station',
    filter: { district: 'Beşiktaş' },
    mustHaveFilter: {},
    PropertyModel: m,
    fetchPoisForCategoryFn: fetchPois,
    propertySelect: PROPERTY_SELECT,
  })

  assert.equal(result.applied, true)
  assert.equal(result.verified, true)

  // Widening let the genuinely nearest listing be considered at all.
  assert.equal(result.properties[0]._id, 'near', 'the widened pool did not surface the true nearest listing')

  // District is dropped from the widened filter — it is often a guess derived
  // from the same landmark being searched around.
  const widen = m.queries.find((q) => q.limit === 300)
  assert.ok(widen, 'the pool was not widened')
  assert.equal(widen.filter.district, undefined, 'the district guess constrained the proximity pool')
  assert.equal(widen.filter.status, 'Available')

  // Exactly one location read for the whole turn — no N+1.
  const locationReads = m.queries.filter((q) => q.select === '_id location')
  assert.equal(locationReads.length, 1, `expected 1 location read, got ${locationReads.length}`)
  assert.equal(fetchPois.calls.length, 1, 'Overpass was called more than once')
})

test('6c. an unverifiable pass returns the ORIGINAL candidates, not the widened pool', async () => {
  const m = model()

  const result = await runProximityPass({
    properties: projectedCandidates(['far']),
    parsed: {},
    message: 'Find apartments near a metro station',
    filter: {},
    mustHaveFilter: {},
    PropertyModel: m,
    fetchPoisForCategoryFn: async () => { throw new Error('down') },
    propertySelect: PROPERTY_SELECT,
  })

  assert.equal(result.verified, false)
  assert.deepEqual(result.properties.map((p) => p._id), ['far'],
    'an unverifiable pass returned an arbitrary widened pool the visitor never asked for')
})

/* ═══════════ 7. Reply honesty ═══════════ */

test('7a. a measured distance is phrased as approximate, in three languages', () => {
  const proximity = { distanceKm: 0.51, categoryId: 'transit_station', poiName: 'Kadıköy Metro' }

  assert.match(renderProximityClause(proximity, 'en'), /about 500 m from the nearest transit station/)
  assert.match(renderProximityClause(proximity, 'tr'), /yaklaşık 500 m/)
  assert.match(renderProximityClause(proximity, 'ar'), /[؀-ۿ]/)

  // Straight-line distance is never dressed up as a travel time.
  for (const lang of ['en', 'tr', 'ar']) {
    assert.ok(!/minute|walk|drive|dakika|دقيقة/i.test(renderProximityClause(proximity, lang)))
  }
})

test('7b. a named place is phrased by name', () => {
  const clause = renderProximityClause(
    { distanceKm: 2.1, categoryId: 'named_place', placeName: 'Taksim Meydanı' }, 'en'
  )
  assert.match(clause, /about 2\.1 km from Taksim Meydanı/)
})

test('7c. no proximity object means no claim', () => {
  assert.equal(renderProximityClause(null, 'en'), null)
  assert.equal(renderProximityClause({ distanceKm: NaN, categoryId: 'school' }, 'en'), null)
  assert.equal(renderProximityClause({ categoryId: 'named_place' }, 'en'), null)
})

test('7d. the unverified disclosure exists and claims nothing', () => {
  for (const lang of ['en', 'tr', 'ar']) {
    const text = renderProximityUnverified(lang)
    assert.ok(text && text.length > 10, `missing disclosure for ${lang}`)
  }
  assert.match(renderProximityUnverified('en'), /couldn't check how close/i)
})
