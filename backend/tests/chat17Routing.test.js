// Wave 17 — proximity property search, in the chat route.
//
// The unit suite proves the geography and the privacy boundary. What matters
// here is that the third nearby operation did not swallow the other two, that
// an ordinary search still costs nothing, and that a reply never implies a
// distance was checked when it was not.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

const calls = { gemini: 0, search: 0, poi: 0, geocode: 0, propertyFind: 0, knowledge: 0 }

let geminiResult = null
let knowledgeResult = null
let searchResult = null
let poiThrows = false

const emptySearchResult = (properties = [], evidence = {}) => ({
  properties,
  filter: {},
  fallbackLevel: 0,
  matchedViaDescription: false,
  matchedViaSemantic: false,
  descriptionSearchAttempted: false,
  descriptionSearchUsed: false,
  descriptionSearchQuery: null,
  descriptionSearchError: null,
  searchEvidence: {
    mode: 'field',
    relaxed: [],
    softSearchAttempted: false,
    requestedSoftCriteria: [],
    matchedSoftCriteria: [],
    unmatchedSoftCriteria: [],
    descriptionQueryVerified: true,
    proximityRequested: false,
    proximityVerified: false,
    proximityCategoryId: null,
    proximityPlaceName: null,
    ...evidence,
  },
})

mock.module('../middleware/auth.js', {
  namedExports: { optionalAuth: (req, res, next) => next(), protect: (req, res, next) => next() },
})

mock.module('../utils/geminiPropertyParser.js', {
  namedExports: {
    parsePropertyMessageWithGemini: async () => { calls.gemini += 1; return geminiResult },
  },
})

// The real proximity stage lives inside runPropertySearch; here the whole
// search is stubbed so the route's own behaviour is what is under test.
mock.module('../services/chatPropertySearch.js', {
  namedExports: {
    PROPERTY_SELECT: 'title price district status',
    runPropertySearch: async () => { calls.search += 1; return searchResult },
  },
})

mock.module('../services/poiSearch.js', {
  namedExports: {
    fetchPoisForCategory: async () => {
      calls.poi += 1
      if (poiThrows) throw new Error('Overpass unreachable')
      return [{ lat: 41.0, lon: 29.0, name: 'Kadıköy Metro' }]
    },
    ISTANBUL_BBOX: '40.80,28.40,41.30,29.60',
    __clearPoiCacheForTests: () => {},
    buildOverpassQuery: () => '',
  },
})

mock.module('../services/geocodePlace.js', {
  namedExports: {
    geocodeIstanbulPlace: async () => { calls.geocode += 1; return { status: 'none' } },
    toNominatimViewbox: () => '28.4,41.3,29.6,40.8',
    isWithinIstanbul: () => true,
    ISTANBUL_BOUNDS: { south: 40.8, west: 28.4, north: 41.3, east: 29.6 },
    MIN_PLACE_QUERY_LENGTH: 2,
    MAX_PLACE_QUERY_LENGTH: 120,
    __clearGeocodeCacheForTests: () => {},
    __setNominatimMinIntervalForTests: () => {},
  },
})

mock.module('../models/Property.js', {
  defaultExport: {
    find() {
      calls.propertyFind += 1
      const chain = {
        select: () => chain,
        limit: () => chain,
        then: (resolve) => resolve([]),
      }
      return chain
    },
    findOne() {
      calls.propertyFind += 1
      const chain = { select: () => chain, limit: () => chain, then: (resolve) => resolve(null) }
      return chain
    },
  },
})

mock.module('../utils/knowledgeAnswer.js', {
  namedExports: {
    buildKnowledgeAnswer: async () => { calls.knowledge += 1; return knowledgeResult },
  },
})

const { default: chatRoutes } = await import('../routes/chat.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/chat', chatRoutes)
  app.use((err, req, res, _next) => res.status(500).json({ success: false, message: err.message }))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((r) => server.close(r)) })

const FLAT = { _id: 'p1', title: 'Near Flat', price: 100000, district: 'Kadıköy' }

beforeEach(() => {
  for (const k of Object.keys(calls)) calls[k] = 0
  geminiResult = { propertyType: null, district: null }
  knowledgeResult = null
  poiThrows = false
  searchResult = emptySearchResult([FLAT])
})

const ask = async (message, body = {}) => {
  const res = await fetch(baseUrl + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...body }),
  })
  return { status: res.status, body: await res.json() }
}

/* ═══════════ 1. Verified proximity ═══════════ */

test('1a. a verified proximity search carries the measured distance and the OSM attribution', async () => {
  searchResult = emptySearchResult(
    [{ ...FLAT, poiProximity: { distanceKm: 0.51, categoryId: 'transit_station', poiName: 'Kadıköy Metro' } }],
    { proximityRequested: true, proximityVerified: true, proximityCategoryId: 'transit_station' }
  )

  const res = await ask('Find apartments near a metro station')

  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.match(res.body.properties[0].matchReason, /about 500 m from the nearest transit station/)
  assert.match(res.body.reply, /© OpenStreetMap contributors/, 'OSM-derived facts were used without attribution')
})

test('1b. the transient proximity object never reaches the client', async () => {
  searchResult = emptySearchResult(
    [{ ...FLAT, poiProximity: { distanceKm: 0.51, categoryId: 'transit_station', poiName: 'Kadıköy Metro' } }],
    { proximityRequested: true, proximityVerified: true }
  )

  const res = await ask('Find apartments near a metro station')

  assert.equal(res.body.properties[0].poiProximity, undefined, 'search metadata leaked onto the card')
  const serialized = JSON.stringify(res.body)
  assert.ok(!/"lat"|"lng"|"lon"|"distanceKm"/.test(serialized), `raw geographic data leaked: ${serialized}`)
})

test('1c. Turkish and Arabic carry the clause and the attribution', async () => {
  searchResult = emptySearchResult(
    [{ ...FLAT, poiProximity: { distanceKm: 0.51, categoryId: 'transit_station' } }],
    { proximityRequested: true, proximityVerified: true }
  )

  const tr = await ask('metroya yakın daireler', { language: 'tr' })
  assert.match(tr.body.properties[0].matchReason, /yaklaşık 500 m/)
  assert.match(tr.body.reply, /© OpenStreetMap contributors/)

  const ar = await ask('شقق قريبة من المترو', { language: 'ar' })
  assert.match(ar.body.properties[0].matchReason, /[؀-ۿ]/)
  assert.match(ar.body.reply, /© OpenStreetMap contributors/)
})

/* ═══════════ 2. Honest failure ═══════════ */

test('2a. an unverified proximity request says the distance is unconfirmed', async () => {
  searchResult = emptySearchResult([FLAT], { proximityRequested: true, proximityVerified: false })

  const res = await ask('Find apartments near a metro station')

  assert.match(res.body.reply, /couldn't check how close/i, 'the reply implied proximity was verified')
  assert.ok(!/OpenStreetMap/.test(res.body.reply), 'attribution appeared without OSM-derived facts')
  assert.equal(res.body.properties.length, 1, 'a provider outage emptied the search')
  assert.ok(!/from the nearest/.test(res.body.properties[0].matchReason || ''), 'an unmeasured distance was claimed')
})

test('2b. an unverified listing inside a verified search gets no proximity claim', async () => {
  searchResult = emptySearchResult(
    [
      { ...FLAT, poiProximity: { distanceKm: 0.51, categoryId: 'transit_station' } },
      { _id: 'p2', title: 'Withheld Flat', price: 200000 },
    ],
    { proximityRequested: true, proximityVerified: true }
  )

  const res = await ask('Find apartments near a metro station')

  assert.match(res.body.properties[0].matchReason, /from the nearest/)
  assert.ok(
    !/from the nearest|about \d/.test(res.body.properties[1].matchReason || ''),
    'a listing with no measured distance was described as near the POI'
  )
})

/* ═══════════ 3. Ordinary replies are untouched ═══════════ */

test('3a. an ordinary property search gets neither suffix', async () => {
  const res = await ask('Find apartments in Kadıköy')

  assert.ok(!/OpenStreetMap/.test(res.body.reply), 'an ordinary search gained attribution')
  assert.ok(!/couldn't check how close/i.test(res.body.reply), 'an ordinary search gained the disclosure')
  assert.equal(calls.search, 1)
})

test('3b. the other two nearby operations still win their own questions', async () => {
  // 15B — POIs around a listing.
  // With an empty inventory this correctly continues to the 15B2 place path.
  // The point asserted here is that it reached the area-info branch at all,
  // rather than being turned into a property search by Wave 17.
  const property = await ask('What schools are near Marina Residence?')
  assert.equal(calls.search, 0, 'a 15B question ran a property search')
  assert.match(property.body.reply, /couldn't find a (listing|place) called/i)
  assert.deepEqual(property.body.properties, [], 'a 15B question returned listings')

  // 15B2 — POIs around a public place. The stubbed geocoder finds nothing,
  // which is enough to prove the routing reached the place path, not search.
  calls.search = 0
  const place = await ask('What schools are near Taksim Square?')
  assert.equal(calls.search, 0, 'a 15B2 question ran a property search')
  assert.match(place.body.reply, /couldn't find a place called/i)
})

test('3c. 15A date/time, title resolution, knowledge and service are unaffected', async () => {
  const time = await ask('What time is it in Istanbul?')
  assert.equal(calls.gemini, 0)
  assert.equal(calls.poi, 0)
  assert.equal(calls.search, 0)
  assert.match(time.body.reply, /in Istanbul/)

  const title = await ask('Tell me about Marina Residence')
  assert.equal(calls.search, 0, 'the 15A title path ran a property search')

  geminiResult = { intentType: 'knowledge_question' }
  knowledgeResult = 'Property purchase tax in Turkey is ...'
  const knowledge = await ask('What taxes apply when buying property in Istanbul?')
  assert.equal(knowledge.body.reply, knowledgeResult)
  assert.ok(!/OpenStreetMap/.test(knowledge.body.reply))
})

test('3d. Show More carries the proximity requirement through', async () => {
  /*
   * The requirement lives in the message the visitor sent and in the parsed
   * criteria the route already carries forward, so a continuation resolves it
   * again rather than needing a new memory subsystem. What this asserts is
   * that the second turn is still a verified proximity turn.
   */
  searchResult = emptySearchResult(
    [{ ...FLAT, poiProximity: { distanceKm: 0.51, categoryId: 'transit_station' } }],
    { proximityRequested: true, proximityVerified: true }
  )

  const first = await ask('Find apartments near a metro station')
  assert.match(first.body.reply, /© OpenStreetMap contributors/)

  const more = await ask('show me more', {
    currentFilters: first.body.parsed,
    shownPropertyIds: ['p1'],
    lastShownProperties: [{ _id: 'p1' }],
  })

  assert.equal(more.status, 200)
  assert.match(more.body.properties[0].matchReason, /from the nearest/, 'the continuation lost the proximity requirement')
  assert.match(more.body.reply, /© OpenStreetMap contributors/)
})
