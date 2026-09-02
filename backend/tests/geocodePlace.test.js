// Wave 15B2 — the Nominatim client.
//
// No test here touches live OpenStreetMap infrastructure: every response is
// injected through fetchImpl. The properties under test are that the request
// is bounded, encoded and Istanbul-scoped, that an untrusted response cannot
// produce a coordinate we would then measure distances from, and that "no
// such place" and "the provider is down" stay distinct.

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  geocodeIstanbulPlace,
  toNominatimViewbox,
  isWithinIstanbul,
  ISTANBUL_BOUNDS,
  MAX_PLACE_QUERY_LENGTH,
  __clearGeocodeCacheForTests,
  __setNominatimMinIntervalForTests,
} from '../services/geocodePlace.js'

import { ISTANBUL_BBOX } from '../services/poiSearch.js'

beforeEach(() => {
  __clearGeocodeCacheForTests()
  // The 1.1s politeness gate is real; shortened so the suite is not slow.
  __setNominatimMinIntervalForTests(0)
})

const stubFetch = (body, { ok = true, status = 200, throws = null } = {}) => {
  const calls = []
  const fn = async (url, options) => {
    calls.push({ url, options })
    if (throws) throw throws
    if (!ok) return { ok: false, status, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }
  fn.calls = calls
  return fn
}

const place = (lat, lon, displayName) => ({ lat: String(lat), lon: String(lon), display_name: displayName })

const TAKSIM = place(41.0370, 28.9850, 'Taksim Meydanı, Gümüşsuyu, Beyoğlu, İstanbul, 34437, Türkiye')

/* ═══════════ 1. The bbox conversion — the easy thing to get wrong ═══════════ */

test('1a. the Overpass bbox is reordered into Nominatim viewbox order', () => {
  // Overpass stores south,west,north,east. Nominatim's viewbox is
  // left,top,right,bottom = west,north,east,south. Passing one as the other
  // silently produces an empty box in the wrong hemisphere.
  const [south, west, north, east] = ISTANBUL_BBOX.split(',').map(Number)
  const viewbox = toNominatimViewbox().split(',').map(Number)

  assert.deepEqual(viewbox, [west, north, east, south], 'the viewbox is not west,north,east,south')

  // Stated concretely, so a future edit that "tidies" the order is caught.
  assert.equal(toNominatimViewbox('40.80,28.40,41.30,29.60'), '28.4,41.3,29.6,40.8')

  // And it is genuinely a reorder — the raw string would be wrong.
  assert.notEqual(toNominatimViewbox(), ISTANBUL_BBOX)
})

test('1b. one Istanbul definition, shared with the POI layer', () => {
  assert.deepEqual(
    ISTANBUL_BOUNDS,
    { south: 40.80, west: 28.40, north: 41.30, east: 29.60 },
    'the geocoder drifted from the Overpass bbox'
  )
  const [south, west, north, east] = ISTANBUL_BBOX.split(',').map(Number)
  assert.deepEqual(ISTANBUL_BOUNDS, { south, west, north, east })
})

test('1c. a malformed bbox yields no viewbox rather than a broken one', () => {
  for (const bad of ['', 'x,y,z,w', '1,2,3', '1,2,3,4,5', null]) {
    assert.equal(toNominatimViewbox(bad), null, `accepted a bad bbox: ${bad}`)
  }
})

test('1d. the bounds check accepts Istanbul and rejects elsewhere', () => {
  assert.equal(isWithinIstanbul(41.037, 28.985), true, 'Taksim was rejected')
  assert.equal(isWithinIstanbul(40.99, 29.03), true, 'Kadıköy was rejected')

  for (const [lat, lon, label] of [
    [39.933, 32.859, 'Ankara'],
    [52.520, 13.405, 'Berlin'],
    [40.713, -74.006, 'New York'],
    [NaN, 29.0, 'NaN latitude'],
    [41.0, Infinity, 'infinite longitude'],
  ]) {
    assert.equal(isWithinIstanbul(lat, lon), false, `${label} was accepted as Istanbul`)
  }
})

/* ═══════════ 2. The request ═══════════ */

test('2a. an Istanbul place resolves, with a short readable label', async () => {
  const fetchImpl = stubFetch([TAKSIM])

  const result = await geocodeIstanbulPlace('Taksim Square', { fetchImpl })

  assert.equal(result.status, 'resolved')
  assert.equal(result.place.lat, 41.0370)
  assert.equal(result.place.lon, 28.9850)
  // The leading segment only — not the full postal display_name.
  assert.equal(result.place.name, 'Taksim Meydanı')
})

test('2b. the query is encoded, scoped and bounded', async () => {
  const fetchImpl = stubFetch([TAKSIM])
  await geocodeIstanbulPlace('Taksim Square & Beyoğlu', { fetchImpl })

  const url = new URL(fetchImpl.calls[0].url)
  const params = url.searchParams

  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search')
  assert.equal(params.get('q'), 'Taksim Square & Beyoğlu', 'the place name was not encoded as one value')
  assert.equal(params.get('format'), 'json')
  assert.equal(params.get('countrycodes'), 'tr', 'the search is not restricted to Türkiye')
  assert.equal(params.get('bounded'), '1', 'the viewbox is not enforced')
  assert.equal(params.get('viewbox'), toNominatimViewbox())
  assert.ok(Number(params.get('limit')) > 0 && Number(params.get('limit')) <= 10)

  // An ampersand in the name must not have become another parameter.
  assert.equal(params.get('Beyoğlu'), null, 'user text was injected as a URL parameter')
})

test('2c. nothing about the visitor or our inventory is sent', async () => {
  const fetchImpl = stubFetch([TAKSIM])
  await geocodeIstanbulPlace('Taksim Square', { fetchImpl })

  const { url, options } = fetchImpl.calls[0]
  const everythingSent = url + JSON.stringify(options)

  // Note: the User-Agent does carry info@varlikent.com — Nominatim's usage
  // policy requires a contact point, and that is the address already published
  // site-wide. It is not visitor data, which is what this asserts about.
  for (const leak of ['41.12', '29.65', 'propertyId', '_id', 'conversation', 'token', 'Marina', 'Residence']) {
    assert.ok(!everythingSent.includes(leak), `'${leak}' was sent to the geocoder`)
  }

  // A descriptive User-Agent is required by Nominatim's policy; it carries no
  // visitor data.
  assert.match(options.headers['User-Agent'], /VarliKent/)
  assert.ok(options.signal, 'the request has no abort signal')
})

test('2d. input is length-bounded and empty input never reaches the network', async () => {
  const fetchImpl = stubFetch([TAKSIM])

  for (const input of ['', '   ', null, undefined, 42, 'x', 'a'.repeat(MAX_PLACE_QUERY_LENGTH + 1)]) {
    const result = await geocodeIstanbulPlace(input, { fetchImpl })
    assert.equal(result.status, 'none', `unexpected status for ${JSON.stringify(input)}`)
  }
  assert.equal(fetchImpl.calls.length, 0, 'unusable input was forwarded to a shared public service')

  // A name at the limit is fine.
  await geocodeIstanbulPlace('a'.repeat(MAX_PLACE_QUERY_LENGTH), { fetchImpl })
  assert.equal(fetchImpl.calls.length, 1)
})

/* ═══════════ 3. Untrusted provider responses ═══════════ */

test('3a. string coordinates are converted, and only when finite', async () => {
  const result = await geocodeIstanbulPlace('Taksim', { fetchImpl: stubFetch([TAKSIM]) })

  assert.equal(typeof result.place.lat, 'number')
  assert.equal(typeof result.place.lon, 'number')
})

test('3b. malformed rows are skipped individually, not fatally', async () => {
  const fetchImpl = stubFetch([
    null,
    'a string',
    {},
    { lat: '', lon: '' },                      // Number('') is 0 — off West Africa
    { lat: 'abc', lon: 'def' },
    { lat: '999', lon: '29.0' },               // out of range
    { lat: '41.0', lon: '999' },
    TAKSIM,                                    // the only good row
  ])

  const result = await geocodeIstanbulPlace('Taksim', { fetchImpl })

  assert.equal(result.status, 'resolved')
  assert.equal(result.place.lat, 41.0370, 'a malformed row was selected over the good one')
})

test('3c. an out-of-Istanbul result is rejected even if the provider returns it', async () => {
  // bounded=1 should prevent this, but the coordinate is about to be used for
  // distance ranking, so it is re-checked locally.
  const berlin = place(52.520, 13.405, 'Berlin, Deutschland')
  const ankara = place(39.933, 32.859, 'Ankara, Türkiye')

  const outOfScope = await geocodeIstanbulPlace('Berlin', { fetchImpl: stubFetch([berlin, ankara]) })
  assert.equal(outOfScope.status, 'none', 'a place outside Istanbul was accepted')

  // A valid Istanbul row further down the list is still found.
  const mixed = await geocodeIstanbulPlace('Taksim', { fetchImpl: stubFetch([berlin, TAKSIM]) })
  assert.equal(mixed.status, 'resolved')
  assert.equal(mixed.place.name, 'Taksim Meydanı')
})

test('3d. an empty or non-array body is "no match", not a crash', async () => {
  for (const body of [[], {}, null, 'nope', { results: [] }]) {
    const result = await geocodeIstanbulPlace('Nowhere', { fetchImpl: stubFetch(body) })
    assert.equal(result.status, 'none', `unexpected status for ${JSON.stringify(body)}`)
  }
})

test('3e. selection is deterministic when several Istanbul places match', async () => {
  // Nominatim orders by its own importance ranking; the first row that
  // survives validation wins, every time — never a random pick.
  const merkez = [
    place(41.01, 29.01, 'Merkez, Kadıköy, İstanbul'),
    place(41.05, 28.95, 'Merkez, Şişli, İstanbul'),
    place(41.09, 29.02, 'Merkez, Beşiktaş, İstanbul'),
  ]

  const first = await geocodeIstanbulPlace('Merkez', { fetchImpl: stubFetch(merkez) })
  __clearGeocodeCacheForTests()
  const second = await geocodeIstanbulPlace('Merkez', { fetchImpl: stubFetch(merkez) })

  assert.equal(first.status, 'resolved')
  assert.deepEqual(first.place, second.place, 'the same input chose a different place')
  assert.equal(first.place.lat, 41.01, 'the provider ranking was not respected')
})

/* ═══════════ 4. Failure is not absence ═══════════ */

test('4a. an HTTP error is an error, never "no such place"', async () => {
  for (const status of [429, 500, 503]) {
    const result = await geocodeIstanbulPlace('Taksim', { fetchImpl: stubFetch(null, { ok: false, status }) })
    assert.equal(result.status, 'error', `HTTP ${status} was reported as ${result.status}`)
  }
})

test('4b. a timeout or network failure is an error', async () => {
  const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })

  const started = Date.now()
  const result = await geocodeIstanbulPlace('Taksim', { fetchImpl: stubFetch(null, { throws: timeout }) })

  assert.equal(result.status, 'error')
  assert.ok(Date.now() - started < 2000, 'the call did not resolve promptly')
})

test('4c. invalid JSON is an error, not a missing place', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } })

  assert.equal((await geocodeIstanbulPlace('Taksim', { fetchImpl })).status, 'error')
})

test('4d. a failure is never cached — one outage must not deny a place all day', async () => {
  const failing = stubFetch(null, { ok: false, status: 503 })
  assert.equal((await geocodeIstanbulPlace('Taksim', { fetchImpl: failing })).status, 'error')

  // The provider recovers; the next lookup must actually try again.
  const working = stubFetch([TAKSIM])
  const result = await geocodeIstanbulPlace('Taksim', { fetchImpl: working })

  assert.equal(result.status, 'resolved', 'the outage was cached as a permanent answer')
  assert.equal(working.calls.length, 1)
})

/* ═══════════ 5. Cache ═══════════ */

test('5. a repeated place is served from cache, sparing a shared public service', async () => {
  const fetchImpl = stubFetch([TAKSIM])

  await geocodeIstanbulPlace('Taksim Square', { fetchImpl })
  await geocodeIstanbulPlace('Taksim Square', { fetchImpl })
  await geocodeIstanbulPlace('  taksim   square  ', { fetchImpl })   // same key

  assert.equal(fetchImpl.calls.length, 1, 'the same place was looked up more than once')

  await geocodeIstanbulPlace('Sultanahmet', { fetchImpl })
  assert.equal(fetchImpl.calls.length, 2, 'a different place shares a cache key')
})
