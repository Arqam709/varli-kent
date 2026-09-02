// Wave 15B2 — general public places, in the chat route.
//
// The unit tests next door prove the Nominatim client. What matters here is
// which of the three targets a message reaches, and — the part that carries
// real consequences — that a listing question NEVER falls through to the
// geocoder. The donor's version does exactly that, which is how a title we do
// not carry becomes a landmark answered with confident distances.
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
let geocodePhrases = []

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
    parsePropertyMessageWithGemini: async () => { calls.gemini += 1; return geminiResult },
  },
})

mock.module('../services/chatPropertySearch.js', {
  namedExports: {
    PROPERTY_SELECT: 'title price district status',
    runPropertySearch: async () => { calls.search += 1; return searchResult },
  },
})

// Projection-aware and status-aware, as the real queries are.
const applyProjection = (doc, select) => {
  if (!select) return { ...doc }
  const projected = { _id: doc._id }
  for (const field of select.split(/\s+/).filter(Boolean)) {
    if (field in doc) projected[field] = doc[field]
  }
  return projected
}

const matchesFilter = (doc, filter = {}) => {
  if (filter._id !== undefined && String(doc._id) !== String(filter._id)) return false
  if (filter.status !== undefined && doc.status !== filter.status) return false
  if (filter.title instanceof RegExp && !filter.title.test(doc.title)) return false
  return true
}

mock.module('../models/Property.js', {
  defaultExport: {
    find(filter) {
      calls.propertyFind += 1
      const query = { select: null }
      const chain = {
        select(fields) { query.select = fields; return chain },
        limit: () => chain,
        then: (resolve, reject) => Promise.resolve(
          propertyRows.filter((doc) => matchesFilter(doc, filter)).map((doc) => applyProjection(doc, query.select))
        ).then(resolve, reject),
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

// The 15B2 dependency. Every call is recorded, because "zero geocoder calls"
// is the assertion that carries the privacy and inventory guarantees.
mock.module('../services/geocodePlace.js', {
  namedExports: {
    geocodeIstanbulPlace: async (phrase) => {
      calls.geocode += 1
      geocodePhrases.push(phrase)
      if (geocodeResult instanceof Error) throw geocodeResult
      return geocodeResult
    },
    toNominatimViewbox: () => '28.4,41.3,29.6,40.8',
    isWithinIstanbul: () => true,
    ISTANBUL_BOUNDS: { south: 40.8, west: 28.4, north: 41.3, east: 29.6 },
    MIN_PLACE_QUERY_LENGTH: 2,
    MAX_PLACE_QUERY_LENGTH: 120,
    __clearGeocodeCacheForTests: () => {},
    __setNominatimMinIntervalForTests: () => {},
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

const PUBLISHED = { lat: 41.12, lng: 29.65, isApproximate: false, approxRadiusKm: 1 }
const WITHHELD = { lat: 41.123456, lng: 29.654321, isApproximate: true, approxRadiusKm: 2 }

const TAKSIM = { status: 'resolved', place: { name: 'Taksim Meydanı', lat: 41.0370, lon: 28.9850 } }

beforeEach(() => {
  for (const key of Object.keys(calls)) calls[key] = 0
  geocodePhrases = []
  geminiResult = { propertyType: null, district: null }
  knowledgeResult = null
  searchResult = emptySearchResult()
  poiThrows = false
  geocodeResult = TAKSIM
  poiResult = [
    { lat: 41.038, lon: 28.986, name: 'Taksim Primary School' },
    { lat: 41.040, lon: 28.988, name: 'Beyoğlu College' },
  ]
  propertyRows = [{ _id: 'p1', title: 'Marina Residence', status: 'Available', location: PUBLISHED }]
})

const ask = async (message, body = {}) => {
  const res = await fetch(baseUrl + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...body }),
  })
  return { status: res.status, body: await res.json() }
}

/* ═══════════ 1. A public place is answered ═══════════ */

test('1a. a landmark question geocodes once, then uses the existing POI engine', async () => {
  const res = await ask('What schools are near Taksim Square?')

  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(calls.geocode, 1, `expected one geocode, got ${calls.geocode}`)
  assert.equal(calls.poi, 1, 'the existing POI engine was not reused exactly once')
  assert.equal(calls.search, 0, 'a landmark question also ran a property search')

  assert.deepEqual(geocodePhrases, ['Taksim Square'])
  assert.match(res.body.reply, /Taksim Primary School/)
  // Named by what the provider actually found, not by the visitor's spelling.
  assert.match(res.body.reply, /Taksim Meydanı/)
  assert.match(res.body.reply, /about/i, 'the distance is not hedged')
})

test('1b. the response carries no coordinate from either provider', async () => {
  const res = await ask('What schools are near Taksim Square?')
  const serialized = JSON.stringify(res.body)

  for (const leak of ['"lat"', '"lng"', '"lon"', '41.037', '28.985', 'display_name', 'nominatim']) {
    assert.ok(!serialized.includes(leak), `${leak} reached the chat response`)
  }
  assert.deepEqual(res.body.properties, [], 'a listing card was returned for a landmark question')
})

test('1c. only the asked-for category comes back', async () => {
  poiResult = [{ lat: 41.038, lon: 28.986, name: 'Taksim Hospital' }]

  const res = await ask('What hospitals are near Sultanahmet?')

  assert.equal(calls.geocode, 1)
  assert.equal(calls.poi, 1)
  assert.match(res.body.reply, /hospital/i)
  assert.ok(!/school|park|restaurant/i.test(res.body.reply), 'unrelated categories were mixed in')
})

test('1d. a category-less landmark question asks first, and geocodes nothing', async () => {
  // Do not spend a shared public service's budget before knowing what for.
  const res = await ask("What's near Taksim Square?")

  assert.equal(calls.geocode, 0, 'the geocoder ran before the category was even known')
  assert.equal(calls.poi, 0)
  assert.match(res.body.reply, /which kind of place/i)
})

test('1e. Turkish and Arabic landmark questions answer in their own language', async () => {
  const turkish = await ask('Taksim Meydanı yakınında okul var mı?', { language: 'tr' })
  assert.equal(turkish.body.language, 'tr')
  assert.equal(calls.geocode, 1)
  assert.match(turkish.body.reply, /en yakın|Taksim Primary School/)

  const arabic = await ask('ما المدارس بالقرب من ميدان تقسيم؟', { language: 'ar' })
  assert.equal(arabic.body.language, 'ar')
  assert.match(arabic.body.reply, /[؀-ۿ]/, 'the Arabic reply is not in Arabic')
})

/* ═══════════ 2. Honest failures, kept apart ═══════════ */

test('2a. a place we cannot find is not invented', async () => {
  geocodeResult = { status: 'none' }

  const res = await ask('What schools are near Nowhereville?')

  assert.equal(calls.poi, 0, 'POIs were fetched around a place that was never located')
  assert.match(res.body.reply, /couldn't find a place called/i)
  assert.match(res.body.reply, /Nowhereville/)
})

test('2b. a geocoder outage is never phrased as "that place does not exist"', async () => {
  geocodeResult = { status: 'error' }

  const res = await ask('What schools are near Taksim Square?')

  assert.match(res.body.reply, /couldn't look that place up/i)
  assert.ok(!/couldn't find a place/i.test(res.body.reply), 'an outage was reported as a missing place')
  assert.equal(calls.poi, 0)
})

test('2c. a POI outage after a successful geocode blames the right provider', async () => {
  poiThrows = true

  const res = await ask('What schools are near Taksim Square?')

  assert.equal(calls.geocode, 1, 'the geocode did not happen')
  assert.match(res.body.reply, /couldn't check nearby places/i)
  assert.ok(!/place called|look that place up/i.test(res.body.reply), 'the geocoder was blamed for a POI failure')
})

test('2d. a geocoder that throws is contained, not a 500', async () => {
  geocodeResult = new Error('socket hang up')

  const res = await ask('What schools are near Taksim Square?')

  assert.equal(res.status, 200, 'a provider exception escaped as a server error')
})

/* ═══════════ 3. Listings never fall through to the geocoder ═══════════ */

test('3a. a resolved listing uses the database, and never the geocoder', async () => {
  const res = await ask('What schools are near Marina Residence?')

  assert.equal(calls.geocode, 0, 'a real listing was geocoded')
  assert.equal(calls.locationFind, 1, 'the internal property location read did not happen')
  assert.equal(calls.poi, 1)
  assert.match(res.body.reply, /Marina Residence/)
})

test('3b. property-specific phrasing for a listing we do not carry is NOT geocoded', async () => {
  /*
   * The donor's bug, asserted against. "the listing Atlantis Palace" claims we
   * carry it. If we do not, the answer is that we do not — geocoding the same
   * words and replying with real distances would tell the visitor a listing
   * exists when none does.
   */
  propertyRows = []

  for (const message of [
    'What schools are near the listing Atlantis Palace?',
    'What schools are near the Atlantis Palace property?',
  ]) {
    calls.geocode = 0
    calls.poi = 0

    const res = await ask(message)

    assert.equal(calls.geocode, 0, `a failed listing was geocoded: ${message}`)
    assert.equal(calls.poi, 0)
    assert.match(res.body.reply, /couldn't find a listing called/i)
  }
})

test('3c. a listing whose coordinate is withheld is never geocoded instead', async () => {
  // The privacy backdoor this must not open: geocoding the title would
  // reconstruct roughly the answer publicLocation just refused.
  propertyRows = [{ _id: 'p1', title: 'Marina Residence', status: 'Available', location: WITHHELD }]

  const res = await ask('What schools are near Marina Residence?')

  assert.equal(calls.geocode, 0, 'a withheld listing fell through to the geocoder')
  assert.equal(calls.poi, 0)
  assert.match(res.body.reply, /enough location information/i)
  assert.ok(!JSON.stringify(res.body).includes('41.123456'))
})

test('3d. a listing that stops being public mid-request is never geocoded instead', async () => {
  propertyRows = [{ _id: 'p1', title: 'Marina Residence', status: 'Available', location: PUBLISHED }]

  // Sold between the title resolution and the location read.
  const rows = propertyRows
  let firstRead = true
  const original = rows[0]
  Object.defineProperty(rows[0], 'status', {
    get() {
      if (firstRead) { firstRead = false; return 'Available' }
      return 'Sold'
    },
    configurable: true,
  })

  const res = await ask('What schools are near Marina Residence?')

  assert.equal(calls.geocode, 0, 'an unavailable listing fell through to the geocoder')
  assert.equal(calls.poi, 0)
  assert.ok(original, 'fixture sanity')
})

test('3e. an ambiguous listing clarifies, and geocodes nothing', async () => {
  propertyRows = [
    { _id: 'a', title: 'Bosphorus Residence A', status: 'Available', location: PUBLISHED },
    { _id: 'b', title: 'Bosphorus Residence B', status: 'Available', location: PUBLISHED },
  ]

  const res = await ask('What schools are near Bosphorus Residence?')

  assert.equal(calls.geocode, 0, 'an ambiguous target was geocoded')
  assert.equal(calls.poi, 0)
  assert.match(res.body.reply, /more than one listing/i)
})

/* ═══════════ 4. Everything else is untouched ═══════════ */

test('4a. a lifestyle property search reaches neither provider', async () => {
  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])

  for (const message of ['Find apartments near schools', 'find villas near metro']) {
    calls.geocode = 0
    calls.poi = 0
    calls.search = 0

    const res = await ask(message)

    assert.equal(calls.geocode, 0, `"${message}" hit the geocoder`)
    assert.equal(calls.poi, 0, `"${message}" hit the POI provider`)
    assert.equal(calls.search, 1, `"${message}" did not reach runPropertySearch`)
    assert.equal(res.body.properties.length, 1)
  }
})

test('4b. Show More continues the existing search', async () => {
  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])

  await ask('show me more', { shownPropertyIds: [], lastShownProperties: [] })

  assert.equal(calls.geocode, 0)
  assert.equal(calls.poi, 0)
  assert.equal(calls.search, 1)
})

test('4c. the 15A date/time shortcut stays free of every provider', async () => {
  const res = await ask('What time is it in Istanbul?')

  assert.equal(calls.gemini, 0)
  assert.equal(calls.geocode, 0)
  assert.equal(calls.poi, 0)
  assert.equal(calls.locationFind, 0)
  assert.match(res.body.reply, /in Istanbul/)
})

test('4d. Wave 11 knowledge answers before either provider is reached', async () => {
  geminiResult = { intentType: 'knowledge_question' }
  knowledgeResult = 'Property purchase tax in Turkey is ...'

  const res = await ask('What taxes apply when buying property in Istanbul?')

  assert.equal(res.body.reply, knowledgeResult)
  assert.equal(calls.geocode, 0, 'a knowledge question hit the geocoder')
  assert.equal(calls.poi, 0)
})

test('4e. Wave 11C service knowledge likewise', async () => {
  geminiResult = { intentType: 'knowledge_question' }
  knowledgeResult = 'Our renovation service covers ...'

  const res = await ask('What renovation services do you provide?', { pageKey: 'renovation' })

  assert.equal(res.body.reply, knowledgeResult)
  assert.equal(calls.geocode, 0)
  assert.equal(calls.poi, 0)
})

test('4f. the 15A "tell me about X" path is unchanged', async () => {
  const res = await ask('Tell me about Marina Residence')

  assert.equal(calls.geocode, 0)
  assert.equal(calls.poi, 0)
  assert.equal(calls.locationFind, 0, 'the 15A path read a stored location')
  assert.equal(res.body.properties.length, 1)
})

/* ═══════════ 5. OpenStreetMap attribution ═══════════ */

test('5a. a general-place result carries the OSM attribution', async () => {
  const res = await ask('What schools are near Taksim Square?')

  assert.match(res.body.reply, /© OpenStreetMap contributors/, 'the OSM attribution is missing')
  // The brand is a proper noun and stays as-is.
  assert.ok(!/OpenStreetHarita|خريطة الشارع المفتوح/.test(res.body.reply), 'the brand was translated')
})

test('5b. a property result carries it too, from the same renderer', async () => {
  // POIs placed near the LISTING's coordinate, not near Taksim — otherwise
  // they fall outside the 3km school radius and this is a no-results reply.
  poiResult = [{ lat: 41.121, lon: 29.651, name: 'Kadıköy Primary' }]

  const res = await ask('What schools are near Marina Residence?')

  assert.match(res.body.reply, /Kadıköy Primary/, 'the fixture did not produce a results reply')

  assert.match(res.body.reply, /© OpenStreetMap contributors/, '15B results lost the attribution')
})

test('5c. it appears in Turkish and Arabic replies as the canonical phrase', async () => {
  const turkish = await ask('Taksim Meydanı yakınında okul var mı?', { language: 'tr' })
  assert.match(turkish.body.reply, /© OpenStreetMap contributors/)

  const arabic = await ask('ما المدارس بالقرب من ميدان تقسيم؟', { language: 'ar' })
  assert.match(arabic.body.reply, /© OpenStreetMap contributors/)
})

test('5d. replies with no OSM data in them do not carry it', async () => {
  // Nothing was attributed, so there is nothing to attribute.
  geocodeResult = { status: 'none' }
  const notFound = await ask('What schools are near Nowhereville?')
  assert.ok(!/OpenStreetMap/.test(notFound.body.reply), 'a place-not-found reply carried attribution')

  geocodeResult = TAKSIM
  poiThrows = true
  const providerDown = await ask('What schools are near Taksim Square?')
  assert.ok(!/OpenStreetMap/.test(providerDown.body.reply), 'a provider error carried attribution')

  poiThrows = false
  poiResult = [{ lat: 40.9, lon: 28.5, name: 'Far Away School' }]
  const empty = await ask('What schools are near Taksim Square?')
  assert.ok(!/OpenStreetMap/.test(empty.body.reply), 'an empty radius carried attribution')
})

test('5e. unrelated chat replies are untouched', async () => {
  const time = await ask('What time is it in Istanbul?')
  assert.ok(!/OpenStreetMap/.test(time.body.reply), 'the date/time reply gained attribution')

  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])
  const search = await ask('Find apartments near schools')
  assert.ok(!/OpenStreetMap/.test(search.body.reply), 'a property search gained attribution')

  geminiResult = { intentType: 'knowledge_question' }
  knowledgeResult = 'Property purchase tax in Turkey is ...'
  const knowledge = await ask('What taxes apply when buying property in Istanbul?')
  assert.ok(!/OpenStreetMap/.test(knowledge.body.reply), 'a knowledge answer gained attribution')
})
