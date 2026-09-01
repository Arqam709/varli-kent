// Wave 15A — how the two new capabilities sit inside the existing chat route.
//
// The unit tests next door prove each helper works. What matters here is
// precedence: a clock question must not reach Gemini, a knowledge question
// must not be swallowed by the title resolver, an ordinary search must reach
// the ordinary search, and none of it may disturb the search memory the
// visitor already built up.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

/* ── Recording stand-ins for everything the route reaches out to ── */

const calls = { gemini: 0, search: 0, propertyFind: 0, nonPropertyReply: 0 }

let geminiResult = null
let nonPropertyReplyResult = null
// The full shape runPropertySearch really returns — the route reads every one
// of these, so a thinner stub fails downstream for reasons unrelated to 15A.
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
let propertyRows = []

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

mock.module('../models/Property.js', {
  defaultExport: {
    find(filter) {
      calls.propertyFind += 1
      const chain = {
        select: () => chain,
        limit: () => chain,
        then: (resolve, reject) => {
          const rows = filter.title instanceof RegExp
            ? propertyRows.filter((row) => filter.title.test(row.title))
            : propertyRows
          return Promise.resolve(rows).then(resolve, reject)
        },
      }
      return chain
    },
  },
})

/*
 * chatReplyBuilder is deliberately NOT mocked. Other chat services import
 * other exports from it, and replacing the module wholesale breaks them —
 * so the real builder runs, and the knowledge/service branch is driven the
 * way the route really drives it: through the parsed intent Gemini returns.
 *
 * The knowledge base itself is stubbed, since what is under test here is
 * precedence — that the branch returns before the resolver — not the answer.
 */
mock.module('../utils/knowledgeAnswer.js', {
  namedExports: {
    buildKnowledgeAnswer: async () => {
      calls.nonPropertyReply += 1
      return nonPropertyReplyResult
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

beforeEach(() => {
  calls.gemini = 0
  calls.search = 0
  calls.propertyFind = 0
  calls.nonPropertyReply = 0
  geminiResult = { propertyType: null, district: null }
  nonPropertyReplyResult = null
  searchResult = emptySearchResult()
  propertyRows = [
    { _id: 'p1', title: 'Marina Residence', price: 450000, district: 'Kadıköy', status: 'Available' },
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

/* ═══════════ 1. Date/time short-circuits before any spend ═══════════ */

test('1a. a clock question is answered without Gemini, search, or a DB read', async () => {
  const res = await ask('What time is it in Istanbul?')

  assert.equal(res.status, 200)
  assert.match(res.body.reply, /in Istanbul/)
  assert.equal(calls.gemini, 0, 'a clock question paid for a Gemini call')
  assert.equal(calls.search, 0, 'a clock question ran a property search')
  assert.equal(calls.propertyFind, 0, 'a clock question hit the property collection')
})

test('1b. the answer follows the requested chat language', async () => {
  const turkish = await ask('saat kaç', { language: 'tr' })
  assert.match(turkish.body.reply, /İstanbul'da şu anda/)
  assert.equal(turkish.body.language, 'tr')

  const arabic = await ask('كم الساعة', { language: 'ar' })
  assert.match(arabic.body.reply, /الوقت الآن في إسطنبول/)
})

test('1c. asking the time does not erase the visitor search criteria', async () => {
  // The scenario that matters: search, ask the time, then "show me more".
  const currentFilters = { district: 'Kadıköy', propertyType: 'Apartment', listingType: 'Sale' }

  const res = await ask('What time is it?', { currentFilters })

  assert.deepEqual(res.body.parsed, currentFilters, 'a utility question wiped the search memory')
  assert.deepEqual(res.body.properties, [], 'a clock question returned listings')
})

test('1d. a scheduling phrase is NOT short-circuited', async () => {
  await ask('call me tomorrow')

  assert.equal(calls.gemini, 1, 'a real lead/scheduling message was swallowed by the clock branch')
})

/* ═══════════ 2. Knowledge precedence ═══════════ */

test('2a. a knowledge question is answered before the resolver ever runs', async () => {
  // "tell me about ..." is exactly the shape the resolver keys on, which is
  // why the resolver is placed after this branch rather than before Gemini.
  nonPropertyReplyResult = 'Property purchase tax in Turkey is ...'
  geminiResult = { intentType: 'knowledge_question' }

  const res = await ask('Tell me about property taxes in Istanbul')

  assert.equal(res.body.reply, nonPropertyReplyResult)
  assert.equal(calls.nonPropertyReply, 1)
  assert.equal(calls.propertyFind, 0, 'the title resolver ran on a knowledge question')
})

test('2b. a service question is likewise untouched', async () => {
  geminiResult = { intentType: 'knowledge_question' }
  nonPropertyReplyResult = 'Our renovation service covers ...'

  const res = await ask('Tell me about your renovation service', { pageKey: 'renovation' })

  assert.equal(res.body.reply, nonPropertyReplyResult)
  assert.equal(calls.propertyFind, 0)
})

/* ═══════════ 3. Specific-listing resolution ═══════════ */

test('3a. a named listing is returned, rendered from the database record', async () => {
  const res = await ask('Tell me about Marina Residence')

  assert.equal(res.body.properties.length, 1)
  assert.equal(res.body.properties[0]._id, 'p1')
  assert.equal(res.body.exactMatch, true)
  assert.match(res.body.reply, /Marina Residence/, 'the resolved listing is not named in the reply')
  assert.equal(calls.search, 0, 'a resolved listing also ran a broad search')
})

test('3b. an ambiguous name asks which one, and shows none', async () => {
  propertyRows = [
    { _id: 'a', title: 'Bosphorus Residence A', status: 'Available' },
    { _id: 'b', title: 'Bosphorus Residence B', status: 'Available' },
  ]

  const res = await ask('Tell me about Bosphorus Residence')

  assert.match(res.body.reply, /more than one listing/i)
  assert.match(res.body.reply, /Bosphorus Residence A/)
  assert.match(res.body.reply, /Bosphorus Residence B/)
  assert.deepEqual(res.body.properties, [], 'a listing was shown despite the ambiguity')
})

test('3c. a name we do not carry says so, and offers the normal search', async () => {
  propertyRows = []

  const res = await ask('Tell me about Atlantis Palace Tower')

  assert.match(res.body.reply, /couldn't find a listing called/i)
  assert.match(res.body.reply, /Atlantis Palace Tower/)
  assert.match(res.body.reply, /district, price/i, 'no alternative was offered')
  assert.deepEqual(res.body.properties, [])
})

/* ═══════════ 4. The ordinary pipeline is untouched ═══════════ */

test('4a. a requirements search still reaches the ordinary search', async () => {
  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])

  const res = await ask('Find modern apartments in Kadıköy')

  assert.equal(calls.search, 1, 'an ordinary search did not reach runPropertySearch')
  assert.equal(calls.propertyFind, 0, 'an ordinary search paid for a resolver query')
  assert.equal(res.body.properties.length, 1)
})

test('4b. Show More is not mistaken for a listing named "more"', async () => {
  searchResult = emptySearchResult([{ _id: 'x', title: 'Some Flat' }])

  const res = await ask('show me more', { shownPropertyIds: [], lastShownProperties: [] })

  assert.equal(calls.propertyFind, 0, 'Show More was captured by the title resolver')
  assert.equal(calls.search, 1, 'Show More stopped reaching the search')
  assert.ok(res.body.properties, 'Show More no longer returns a property list')
})

test('4c. an empty message is still rejected the same way', async () => {
  const res = await ask('   ')

  assert.equal(res.status, 400)
  assert.equal(calls.gemini, 0)
})

/* ═══════════ 5. No coordinate can leave through this route ═══════════ */

test('5. a resolved listing carries no location data', async () => {
  propertyRows = [{
    _id: 'p1', title: 'Marina Residence', district: 'Kadıköy', status: 'Available',
    // Even if a record carried these, the projection is what reaches a reply.
    location: { lat: 41.0, lng: 29.0 },
  }]

  const res = await ask('Where exactly is Marina Residence?')
  const serialized = JSON.stringify(res.body)

  for (const leak of ['"lat"', '"lng"', 'descriptionEmbedding']) {
    assert.ok(!serialized.includes(leak), `${leak} reached the chat response`)
  }
})
