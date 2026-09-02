// Wave 15B — the POI provider layer and the geometry it feeds.
//
// No test here touches live OpenStreetMap infrastructure: every provider
// response is injected through fetchImpl. The properties under test are that
// an untrusted provider payload cannot crash or poison ranking, that user
// text can never reach Overpass QL, and that every request is bounded.

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchPoisForCategory,
  buildOverpassQuery,
  ISTANBUL_BBOX,
  __clearPoiCacheForTests,
} from '../services/poiSearch.js'

import { haversineKm, nearestNWithinRadius } from '../utils/geoDistance.js'
import {
  POI_CATEGORIES,
  CANONICAL_POI_CATEGORY_IDS,
  isValidPoiCategoryId,
  getCategoryRadiusKm,
  resolvePoiCategory,
} from '../utils/poiCategories.js'

beforeEach(() => __clearPoiCacheForTests())

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body })

const element = (lat, lon, name) => ({ type: 'node', lat, lon, tags: name ? { name } : {} })

const stubFetch = (body, { status = 200, ok = true } = {}) => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (!ok) return { ok: false, status, json: async () => ({}) }
    return okResponse(body)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/* ═══════════ 1. Category registry ═══════════ */

test('1a. every category has an id, an Overpass filter list and a radius', () => {
  assert.ok(POI_CATEGORIES.length > 0)

  for (const category of POI_CATEGORIES) {
    assert.ok(category.id, 'a category has no id')
    assert.ok(Array.isArray(category.overpassFilters) && category.overpassFilters.length > 0, `${category.id} has no filters`)
    assert.ok(Number.isFinite(category.defaultRadiusKm), `${category.id} has no radius`)
    assert.ok(category.defaultRadiusKm > 0 && category.defaultRadiusKm <= 10, `${category.id} radius is out of range`)
  }

  assert.equal(new Set(CANONICAL_POI_CATEGORY_IDS).size, CANONICAL_POI_CATEGORY_IDS.length, 'duplicate category id')
})

test('1b. Overpass filters are a fixed allowlist of tag fragments', () => {
  // Nothing here may be assembled from user text — every filter is a literal
  // tag comparison written in this repo.
  for (const category of POI_CATEGORIES) {
    for (const filter of category.overpassFilters) {
      assert.match(filter, /^\["[a-z_]+"="[a-z_]+"\]$/, `${category.id} has a filter that is not a plain tag match: ${filter}`)
    }
  }
})

test('1c. natural language resolves to canonical category ids', () => {
  const cases = [
    ['are there schools nearby', 'school'],
    ['what hospitals are close', 'hospital'],
    ['is there a metro station', 'transit_station'],
    ['any parks around', 'park'],
    ['nearest pharmacy', 'pharmacy'],
    ['okul var mı', 'school'],
    ['hastaneye yakın', 'hospital'],
    ['metroya yakın', 'transit_station'],
    ['مطعم', 'restaurant'],
  ]

  for (const [text, expected] of cases) {
    assert.equal(resolvePoiCategory(text)?.categoryId, expected, `bad category for: ${text}`)
  }

  assert.equal(resolvePoiCategory('what is near this listing'), null, 'a category was invented from nothing')
})

test('1d. unknown category ids are rejected and fall back to the default radius', () => {
  assert.equal(isValidPoiCategoryId('school'), true)
  assert.equal(isValidPoiCategoryId('nuclear_silo'), false)
  assert.equal(isValidPoiCategoryId('"];out;//'), false)

  assert.equal(getCategoryRadiusKm('school'), 3)
  assert.ok(Number.isFinite(getCategoryRadiusKm('nonexistent')))
})

/* ═══════════ 2. Query construction ═══════════ */

test('2a. the query is bounded to Istanbul and carries a server timeout', () => {
  const query = buildOverpassQuery(POI_CATEGORIES.find((c) => c.id === 'school'), null)

  assert.match(query, /\[out:json\]\[timeout:\d+\]/, 'the Overpass query has no server-side timeout')
  assert.ok(query.includes(ISTANBUL_BBOX), 'the query is not bounded to the Istanbul bbox')
  assert.match(query, /\["amenity"="school"\]/)

  // The bbox itself is four plain numbers.
  const bbox = ISTANBUL_BBOX.split(',').map(Number)
  assert.equal(bbox.length, 4)
  assert.ok(bbox.every(Number.isFinite), 'the Istanbul bbox is not numeric')
})

test('2b. no user text can reach the query — only registry values do', async () => {
  const hostile = '"];out count;node["amenity"="bank"](0,0,90,90);//'

  // An unknown category never produces a query at all.
  const fetchImpl = stubFetch({ elements: [] })
  const result = await fetchPoisForCategory({ categoryId: hostile, fetchImpl })

  assert.deepEqual(result, [], 'a hostile category id produced results')
  assert.equal(fetchImpl.calls.length, 0, 'a hostile category id reached the network')

  // And the brand clause only accepts the three registry brand keys.
  const supermarket = POI_CATEGORIES.find((c) => c.id === 'supermarket')
  const injected = buildOverpassQuery(supermarket, hostile)
  assert.ok(!injected.includes('out count'), 'a hostile brand key was interpolated into Overpass QL')
  assert.ok(!injected.includes(hostile), 'raw hostile text reached the query')
})

/* ═══════════ 3. Untrusted provider responses ═══════════ */

test('3a. a normal response is normalised to flat points', async () => {
  const fetchImpl = stubFetch({
    elements: [
      element(41.01, 29.01, 'Kadıköy School'),
      { type: 'way', center: { lat: 41.02, lon: 29.02 }, tags: { name: 'Way School' } },
    ],
  })

  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.equal(pois.length, 2)
  assert.deepEqual(pois[0], { lat: 41.01, lon: 29.01, name: 'Kadıköy School' })
  assert.equal(pois[1].name, 'Way School', 'a way with a computed centre was dropped')
})

test('3b. an unnamed POI survives with a null name rather than being dropped', async () => {
  const fetchImpl = stubFetch({ elements: [element(41.01, 29.01, null)] })

  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.equal(pois.length, 1)
  assert.equal(pois[0].name, null)
})

test('3c. malformed elements are skipped, never crashed on', async () => {
  const fetchImpl = stubFetch({
    elements: [
      element(41.01, 29.01, 'Good'),
      {},                                        // no coordinates at all
      { lat: 'x', lon: 'y' },                    // strings
      { lat: NaN, lon: 29 },                     // NaN is typeof 'number'
      { lat: Infinity, lon: 29 },
      { lat: 999, lon: 29 },                     // out of range
      { lat: 41, lon: 999 },
      null,
      element(41.02, 29.02, 'Also good'),
    ],
  })

  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.equal(pois.length, 2, 'malformed elements were not filtered')
  assert.deepEqual(pois.map((p) => p.name), ['Good', 'Also good'])
})

test('3d. a response that is not the documented shape yields nothing, not a throw', async () => {
  for (const body of [{}, { elements: null }, { elements: 'nope' }, [], null]) {
    const fetchImpl = stubFetch(body)
    const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })
    assert.deepEqual(pois, [], `threw or returned data for ${JSON.stringify(body)}`)
  }
})

test('3e. invalid JSON degrades to empty rather than throwing', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } })

  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })
  assert.deepEqual(pois, [])
})

/* ═══════════ 4. Provider failure ═══════════ */

test('4a. an HTTP error tries the mirror, then degrades to empty', async () => {
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    return { ok: false, status: 503, json: async () => ({}) }
  }

  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.deepEqual(pois, [], 'a 503 produced results')
  assert.equal(attempts, 2, 'the fallback mirror was not attempted')
})

test('4b. the mirror can rescue a failed primary', async () => {
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('ECONNRESET')
    return okResponse({ elements: [element(41.01, 29.01, 'Mirror School')] })
  }

  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.equal(pois.length, 1)
  assert.equal(pois[0].name, 'Mirror School')
})

test('4c. a hanging provider is abandoned, not awaited forever', async () => {
  // A request that never settles must not leave the chat route hanging. The
  // production path relies on AbortSignal.timeout; here the stub rejects the
  // way an aborted fetch does, and the contract asserted is that the call
  // still resolves.
  const fetchImpl = async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }) }

  const started = Date.now()
  const pois = await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.deepEqual(pois, [])
  assert.ok(Date.now() - started < 2000, 'the call did not resolve promptly')
})

test('4d. an unknown category never reaches the network', async () => {
  const fetchImpl = stubFetch({ elements: [] })

  assert.deepEqual(await fetchPoisForCategory({ categoryId: 'not_a_category', fetchImpl }), [])
  assert.deepEqual(await fetchPoisForCategory({ fetchImpl }), [])
  assert.equal(fetchImpl.calls.length, 0)
})

/* ═══════════ 5. Caching ═══════════ */

test('5. a repeated category is served from cache, sparing the public provider', async () => {
  const fetchImpl = stubFetch({ elements: [element(41.01, 29.01, 'School')] })

  await fetchPoisForCategory({ categoryId: 'school', fetchImpl })
  await fetchPoisForCategory({ categoryId: 'school', fetchImpl })
  await fetchPoisForCategory({ categoryId: 'school', fetchImpl })

  assert.equal(fetchImpl.calls.length, 1, 'the same category was fetched more than once')

  // A different category is a different key.
  await fetchPoisForCategory({ categoryId: 'hospital', fetchImpl })
  assert.equal(fetchImpl.calls.length, 2)
})

/* ═══════════ 6. Distance ═══════════ */

test('6a. haversine, not coordinate subtraction', () => {
  // One degree of latitude is ~111 km everywhere; one degree of longitude at
  // Istanbul's latitude is ~84 km. A naive sqrt of coordinate deltas would
  // make these equal, which is the bug this asserts against.
  const northSouth = haversineKm(41.0, 29.0, 42.0, 29.0)
  const eastWest = haversineKm(41.0, 29.0, 41.0, 30.0)

  assert.ok(Math.abs(northSouth - 111.2) < 1, `north-south degree measured ${northSouth}`)
  assert.ok(Math.abs(eastWest - 84.0) < 2, `east-west degree measured ${eastWest}`)
  assert.notEqual(Math.round(northSouth), Math.round(eastWest))

  assert.equal(haversineKm(41, 29, 41, 29), 0)
})

test('6b. ranking is nearest-first, bounded by radius and count', () => {
  const pois = [
    { lat: 41.05, lon: 29.0, name: 'Far' },
    { lat: 41.005, lon: 29.0, name: 'Near' },
    { lat: 41.02, lon: 29.0, name: 'Middle' },
  ]

  const ranked = nearestNWithinRadius(41.0, 29.0, pois, 10, 3)

  assert.deepEqual(ranked.map((r) => r.poi.name), ['Near', 'Middle', 'Far'])
  assert.ok(ranked[0].distanceKm < ranked[1].distanceKm)

  // The count limit holds.
  assert.equal(nearestNWithinRadius(41.0, 29.0, pois, 10, 2).length, 2)

  // The radius limit holds — only 'Near' is within 1 km.
  const tight = nearestNWithinRadius(41.0, 29.0, pois, 1, 3)
  assert.deepEqual(tight.map((r) => r.poi.name), ['Near'])
})

test('6c. invalid inputs rank to nothing rather than to NaN', () => {
  const pois = [{ lat: 41.005, lon: 29.0, name: 'Near' }]

  assert.deepEqual(nearestNWithinRadius(NaN, 29.0, pois, 5, 3), [])
  assert.deepEqual(nearestNWithinRadius('41', 29.0, pois, 5, 3), [])
  assert.deepEqual(nearestNWithinRadius(41.0, 29.0, [], 5, 3), [])
  assert.deepEqual(nearestNWithinRadius(41.0, 29.0, null, 5, 3), [])

  // A malformed POI inside an otherwise good list is skipped.
  const mixed = nearestNWithinRadius(41.0, 29.0, [{ lat: 'x', lon: 'y' }, ...pois], 5, 3)
  assert.equal(mixed.length, 1)
  assert.equal(mixed[0].poi.name, 'Near')
})
