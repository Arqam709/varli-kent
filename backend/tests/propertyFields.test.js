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

const { default: propertyRoutes, parseExtendedPropertyFields } = await import('../routes/properties.js')

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
