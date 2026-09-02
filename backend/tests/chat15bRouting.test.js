// Wave 15B — where the nearby branch sits in the chat route.
//
// The unit and privacy tests next door prove the feature works and stays
// inside the privacy line. What matters here is that adding it did not let it
// swallow anything: not a lifestyle property search, not Show More, not the
// date/time shortcut, not a Wave 11 knowledge answer — and that a genuine
// nearby question does reach the POI provider exactly once.
//
// Requires --experimental-test-module-mocks.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

const calls = { gemini: 0, search: 0, propertyFind: 0, locationFind: 0, knowledge: 0, poi: 0, geocode: 0 }

let geminiResult = null
let knowledgeResult = null
let propertyRows = []
let poiResult = []
let poiThrows = false
let geocodeResult = { status: 'none' }
let geocodeThrows = false

const emptySearchResult = (properties = []) => ({
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
    verifiedSoftCriteria: [],
    unverifiedSoftCriteria: [],
  },
})

let searchResult = emptySearchResult()

mock.module('../middleware/auth.js', {
  namedExports: { optionalAuth: (req, res, next) => next(), protect: (req, res, next) => next() },
})

mock.module('../utils/geminiPropertyParser.js', {
  namedExports: {
    parsePropertyMessageWithGemini: async () => {
      calls.gemini += 1
      return geminiResult
    },
  },
})

mock.module('../services/chatPropertySearch.js', {
  namedExports: {
    PROPERTY_SELECT: 'title price district status',
    runPropertySearch: async () => {
      calls.search += 1
      return searchResult
    },
  },
})

/*
 * Projection-aware: `.select()` really removes what it was not asked for, the
 * way MongoDB does. Without that, `location` reaches the resolver's result
 * even though the public projection excludes it, and the route appears to
 * work in tests while failing in production. `findOne` is here because the
 * coordinate is read through its own dedicated location-only lookup.
 */
// Applies the same predicates the production query uses, so a document
// the real query would filter out cannot be returned here either.
const matchesFilter = (doc, filter = {}) => {
  if (filter._id !== undefined && String(doc._id) !== String(filter._id)) return false
  if (filter.status !== undefined && doc.status !== filter.status) return false
  if (filter.title instanceof RegExp && !filter.title.test(doc.title)) return false
  return true
}
const applyProjection = (doc, select) => {
  if (!select) return { ...doc }

  const projected = { _id: doc._id }
  for (const field of select.split(/\s+/).filter(Boolean)) {
    if (field in doc) projected[field] = doc[field]
  }
  return projected
}

mock.module('../models/Property.js', {
  defaultExport: {
    find(filter) {
      calls.propertyFind += 1
      const query = { select: null }
      const chain = {
        select(fields) { query.select = fields; return chain },
        limit: () => chain,
        then: (resolve, reject) => {
          const rows = (filter.title instanceof RegExp
            ? propertyRows.filter((row) => filter.title.test(row.title))
            : propertyRows
          ).map((doc) => applyProjection(doc, query.select))
          return Promise.resolve(rows).then(resolve, reject)
        },
      }
      return chain
    },
    findOne(filter) {
      calls.locationFind += 1
      const query = { select: null }
      const chain = {
        select(fields) { query.select = fields; return chain },
        limit: () => chain,
        then: (resolve, reject) => {
          const doc = propertyRows.find((row) => matchesFilter(row, filter))
          return Promise.resolve(doc ? applyProjection(doc, query.select) : null).then(resolve, reject)
        },
      }
      return chain
    },
  },
})

// The one external dependency of this wave. Counting its calls is how "an
// ordinary search costs no POI request" is asserted.
mock.module('../services/poiSearch.js', {
  namedExports: {
    fetchPoisForCategory: async () => {
      calls.poi += 1
      if (poiThrows) throw new Error('Overpass unreachable')
      return poiResult
    },
    ISTANBUL_BBOX: '40.80,28.40,41.30,29.60',
    __clearPoiCacheForTests: () => {},
    buildOverpassQuery: () => '',
  },
})

/*
 * Wave 15B2. Mocked for two reasons: a test must never reach live Nominatim,
 * and counting these calls is how the property paths are proven never to fall
 * through to a landmark lookup.
 */
mock.module('../services/geocodePlace.js', {
  namedExports: {
    geocodeIstanbulPlace: async () => {
      calls.geocode += 1
      if (geocodeThrows) throw new Error('Nominatim unreachable')
      return geocodeResult
    },
    toNominatimViewbox: () => '28.4,41.3,29.6,40.8',
    isWithinIstanbul: () => true,
    MAX_PLACE_QUERY_LENGTH: 120,
    __clearGeocodeCacheForTests: () => {},
    __setNominatimMinIntervalForTests: () => {},
    ISTANBUL_BOUNDS: { south: 40.8, west: 28.4, north: 41.3, east: 29.6 },
  },
})

mock.module('../utils/knowledgeAnswer.js', {
  namedExports: {
    buildKnowledgeAnswer: async () => {
      calls.knowledge += 1
      return knowledgeResult
    },
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

const PUBLISHED = { lat: 41.12, lng: 29.65, isApproximate: false, approxRadiusKm: 1 }

beforeEach(() => {
  calls.gemini = 0
  calls.search = 0
  calls.propertyFind = 0
  calls.locationFind = 0
  calls.knowledge = 0
  calls.poi = 0
  calls.geocode = 0
  geocodeResult = { status: 'none' }
  geminiResult = { propertyType: null, district: null }
  knowledgeResult = null
  searchResult = emptySearchResult()
  poiThrows = false
  geocodeThrows = false
  poiResult = [
    { lat: 41.121, lon: 29.651, name: 'Kadıköy Primary' },
    { lat: 41.125, lon: 29.655, name: 'Bosphorus College' },
  ]
  propertyRows = [
    { _id: 'p1', title: 'Marina Residence', status: 'Available', location: PUBLISHED },
  ]
})

const ask = async (message, body = {}) => {
  const res = await fetch(baseUrl + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...body }),
  })
  return { status: res.status, body: await res.json() }
}

/* ═══════════ 1. A nearby question is answered ═══════════ */

test('1a. a category question about a named listing reaches the provider once', async () => {
  const res = await ask('What schools are near Marina Residence?')

  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(calls.poi, 1, `expected exactly one POI call, got ${calls.poi}`)
  assert.equal(calls.search, 0, 'a nearby question also ran a property search')

  assert.match(res.body.reply, /Kadıköy Primary/)
  assert.match(res.body.reply, /about/i, 'the distance is not hedged as approximate')
  assert.deepEqual(res.body.properties, [], 'a listing card was returned for an area question')
})

test('1b. the response carries no coordinate of any kind', async () => {
  const res = await ask('What schools are near Marina Residence?')
  const serialized = JSON.stringify(res.body)

  for (const leak of ['"lat"', '"lng"', '"lon"', '41.12', '29.65']) {
    assert.ok(!serialized.includes(leak), `${leak} reached the chat response`)
  }
})

test('1c. only the asked-for category comes back', async () => {
  const res = await ask('Are there hospitals near Marina Residence?')

  assert.equal(calls.poi, 1)
  assert.match(res.body.reply, /hospital/i)
  assert.ok(!/school|park|restaurant/i.test(res.body.reply), 'unrelated categories were mixed in')
})

test('1d. a bare "what is near X" asks which kind of place, without a provider call', async () => {
  const res = await ask("What's near Marina Residence?")

  assert.equal(calls.poi, 0, 'a category-less question queried the provider')
  assert.match(res.body.reply, /which kind of place/i)
})

test('1e. Turkish and Arabic questions are answered in their own language', async () => {
  const turkish = await ask('Marina Residence yakınında okul var mı?', { language: 'tr' })
  assert.equal(turkish.body.language, 'tr')
  assert.match(turkish.body.reply, /en yakın|Kadıköy Primary/)

  const arabic = await ask('ما المدارس بالقرب من Marina Residence؟', { language: 'ar' })
  assert.equal(arabic.body.language, 'ar')
  assert.match(arabic.body.reply, /[؀-ۿ]/, 'the Arabic reply is not in Arabic')
})

/* ═══════════ 2. Failure wording ═══════════ */

test('2a. a provider outage is not reported as "there are none"', async () => {
  poiThrows = true

  const res = await ask('What hospitals are near Marina Residence?')

  assert.match(res.body.reply, /couldn't check nearby places/i)
  assert.ok(!/no hospitals/i.test(res.body.reply))
})

test('2b. nothing within the radius names the radius', async () => {
  poiResult = [{ lat: 40.9, lon: 28.5, name: 'Far Away School' }]

  const res = await ask('What schools are near Marina Residence?')

  assert.match(res.body.reply, /within about 3 km/i)
  assert.ok(!res.body.reply.includes('Far Away School'), 'an out-of-radius POI was listed anyway')
})

test('2c. a listing whose coordinate is withheld says so, without a provider call', async () => {
  propertyRows = [{
    _id: 'p1', title: 'Marina Residence', status: 'Available',
    location: { lat: 41.123456, lng: 29.654321, isApproximate: true, approxRadiusKm: 2 },
  }]

  const res = await ask('What schools are near Marina Residence?')

  assert.equal(calls.locationFind, 1, 'the coordinate was not read through its own lookup')
  assert.equal(calls.poi, 0, 'a withheld coordinate was sent for a POI lookup')
  assert.match(res.body.reply, /enough location information/i)
  assert.ok(!JSON.stringify(res.body).includes('41.123456'), 'the withheld coordinate leaked')
})

test('2d. an ambiguous listing asks which one, with no provider call', async () => {
  propertyRows = [
    { _id: 'a', title: 'Bosphorus Residence A', status: 'Available', location: PUBLISHED },
    { _id: 'b', title: 'Bosphorus Residence B', status: 'Available', location: PUBLISHED },
  ]

  const res = await ask('What schools are near Bosphorus Residence?')

  assert.equal(calls.poi, 0)
  assert.match(res.body.reply, /more than one listing/i)
  assert.match(res.body.reply, /Bosphorus Residence A/)
})

test('2e. a listing we do not carry is reported honestly, with no provider call', async () => {
  propertyRows = []

  const res = await ask('What schools are near Atlantis Palace?')

  assert.equal(calls.poi, 0)
  assert.equal(calls.geocode, 1, 'a neutral unknown name did not try the public-place path')
  assert.match(res.body.reply, /couldn't find a place called/i)
})

/* ═══════════ 3. Nothing else was swallowed ═══════════ */

test('3a. a lifestyle property search still runs the ordinary search', async () => {
  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])

  for (const message of ['Find apartments near schools', 'find villas near metro']) {
    calls.poi = 0
    calls.search = 0
    calls.propertyFind = 0

    const res = await ask(message)

    assert.equal(calls.poi, 0, `"${message}" queried the POI provider`)
    assert.equal(calls.search, 1, `"${message}" did not reach runPropertySearch`)
    assert.equal(calls.propertyFind, 0, `"${message}" ran a listing-name lookup`)
    assert.equal(calls.locationFind, 0, `"${message}" read a stored property location`)
    assert.equal(res.body.properties.length, 1)
  }
})

test('3b. Show More still continues the existing search', async () => {
  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])

  await ask('show me more', { shownPropertyIds: [], lastShownProperties: [] })

  assert.equal(calls.poi, 0, 'Show More triggered a POI lookup')
  assert.equal(calls.propertyFind, 0, 'Show More triggered a listing-name lookup')
  assert.equal(calls.locationFind, 0, 'Show More read a stored property location')
  assert.equal(calls.search, 1)
})

test('3c. the 15A date/time shortcut is still pre-Gemini and POI-free', async () => {
  const res = await ask('What time is it in Istanbul?')

  assert.equal(calls.gemini, 0, 'the clock question reached Gemini')
  assert.equal(calls.poi, 0, 'the clock question reached the POI provider')
  assert.equal(calls.locationFind, 0, 'the clock question read a stored property location')
  assert.equal(calls.propertyFind, 0)
  assert.match(res.body.reply, /in Istanbul/)
})

test('3d. Wave 11 knowledge answers before the nearby branch', async () => {
  geminiResult = { intentType: 'knowledge_question' }
  knowledgeResult = 'Property purchase tax in Turkey is ...'

  const res = await ask('What are the best districts near schools in Istanbul?')

  assert.equal(res.body.reply, knowledgeResult)
  assert.equal(calls.knowledge, 1)
  assert.equal(calls.poi, 0, 'a knowledge question queried the POI provider')
  assert.equal(calls.locationFind, 0, 'a knowledge question read a stored property location')
  assert.equal(calls.propertyFind, 0)
})

test('3e. Wave 11C service knowledge is likewise untouched', async () => {
  geminiResult = { intentType: 'knowledge_question' }
  knowledgeResult = 'Our renovation service covers ...'

  const res = await ask('What renovation services do you offer near me?', { pageKey: 'renovation' })

  assert.equal(res.body.reply, knowledgeResult)
  assert.equal(calls.poi, 0)
})

test('3f. the 15A "tell me about X" resolver still wins its own question', async () => {
  const res = await ask('Tell me about Marina Residence')

  assert.equal(calls.poi, 0, 'a plain listing question queried the POI provider')
  assert.equal(calls.locationFind, 0, 'the 15A title path read a stored property location')
  assert.equal(res.body.properties.length, 1, 'the listing card was lost')
  assert.match(res.body.reply, /Marina Residence/)
})

test('3g. an empty message is still rejected before anything runs', async () => {
  const res = await ask('   ')

  assert.equal(res.status, 400)
  assert.equal(calls.poi, 0)
  assert.equal(calls.gemini, 0)
})
