// Property location: validation, the public privacy contract, and the
// authorised-editor endpoint.
//
// The privacy rule this file exists to defend is that an APPROXIMATE listing's
// exact coordinate must never appear in a public response. Hiding a marker on
// the client is not privacy — the payload is one network-tab click away — so
// the redaction happens server-side and is asserted here against the real
// router rather than against a helper in isolation.
//
// Only the genuine externals are replaced: MongoDB (the Property model), the
// agent/embedding/messaging services, and JWT verification. The route logic,
// the validation and the redaction under test are all real.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

// ── The signed-in actor ─────────────────────────────────────────────────
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

// ── Scripted database ───────────────────────────────────────────────────
const db = {
  findResult: [],
  findByIdResult: null,
  createResult: null,
  updateResult: null,
}

const calls = {
  create: [],
  findByIdAndUpdate: [],
  select: [],
  reassignment: [],
  embedding: [],
}

// A query object that is chainable AND awaitable, matching the shapes the
// route actually uses: .select().sort().lean(), .select().populate(), and a
// bare await on findById().
const makeQuery = (result) => {
  const q = {
    select(arg) { calls.select.push(arg); return q },
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
    create: async (data) => { calls.create.push(data); return db.createResult ?? data },
    findByIdAndUpdate: async (id, ops) => {
      calls.findByIdAndUpdate.push({ id, ops })
      return db.updateResult
    },
    findByIdAndDelete: async () => null,
  },
})

// Registering the User model is a side effect the route imports; nothing reads it.
mock.module('../models/User.js', { defaultExport: {} })

mock.module('../services/agentAssignment.js', {
  namedExports: {
    // Passes everything through untouched so this suite measures location
    // handling only. Agent behaviour has its own coverage.
    resolveAgentContact: async () => ({ ok: true, drop: [], changes: {} }),
    publicAgent: (a) => (a ? { _id: 'agent-id', name: 'Agent' } : null),
    AGENT_POPULATE_FIELDS: 'name avatar role isActive',
  },
})

mock.module('../services/propertyEmbeddingService.js', {
  namedExports: {
    generatePropertyEmbedding: async (src) => { calls.embedding.push(src); return null },
    embeddingSourceFieldsChanged: () => false,
  },
})

mock.module('../services/propertyMessaging.js', {
  namedExports: {
    handlePropertyAgentReassignment: async (args) => { calls.reassignment.push(args) },
  },
})

const { default: propertyRoutes } = await import('../routes/properties.js')
const { parsePropertyLocation, publicLocation, editableLocation } = await import('../routes/properties.js')

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
  db.createResult = null
  db.updateResult = null
  for (const k of Object.keys(calls)) calls[k].length = 0
})

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const owner = () => ({ _id: 'owner-id', role: 'owner', permissions: [] })
const admin = (permissions = []) => ({ _id: 'admin-id', role: 'admin', permissions })

const BASE = { title: 'T', listingType: 'Sale', price: 1, district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1 }

// A stored document as the detail route sees it (needs toObject()).
const storedDoc = (location) => ({
  _id: 'p1',
  ...BASE,
  location,
  agent: null,
  toObject() { return { _id: 'p1', ...BASE, location, agent: null } },
})

/* ══════════════════════ 1. CREATE — accepted coordinates ══════════════════ */

const ACCEPTED = [
  ['ordinary Istanbul coordinates', { lat: 41.0082, lng: 28.9784 }],
  ['latitude 0 (equator)', { lat: 0, lng: 28.9784 }],
  ['longitude 0 (prime meridian)', { lat: 41.0082, lng: 0 }],
  ['both zero (null island)', { lat: 0, lng: 0 }],
  ['latitude -90', { lat: -90, lng: 10 }],
  ['latitude 90', { lat: 90, lng: 10 }],
  ['longitude -180', { lat: 10, lng: -180 }],
  ['longitude 180', { lat: 10, lng: 180 }],
]

for (const [label, loc] of ACCEPTED) {
  test(`create accepts ${label}`, async () => {
    currentUser = admin(['add_listing'])
    const res = await request('POST', '/api/properties', { ...BASE, location: loc })
    assert.equal(res.status, 201, 'must be created')
    assert.equal(calls.create.length, 1)
    assert.deepEqual(calls.create[0].location, {
      lat: loc.lat, lng: loc.lng, isApproximate: false, approxRadiusKm: 5,
    }, 'stored location must be normalised with defaults')
  })
}

test('create with no location stores no location key at all', async () => {
  currentUser = admin(['add_listing'])
  const res = await request('POST', '/api/properties', BASE)
  assert.equal(res.status, 201)
  assert.equal('location' in calls.create[0], false, 'absent must stay genuinely absent')
})

test('create normalises isApproximate and approxRadiusKm when supplied', async () => {
  currentUser = admin(['add_listing'])
  const res = await request('POST', '/api/properties', {
    ...BASE, location: { lat: 41, lng: 29, isApproximate: true, approxRadiusKm: 12 },
  })
  assert.equal(res.status, 201)
  assert.deepEqual(calls.create[0].location, { lat: 41, lng: 29, isApproximate: true, approxRadiusKm: 12 })
})

test('create accepts radius boundaries 1 and 20', async () => {
  currentUser = admin(['add_listing'])
  for (const r of [1, 20]) {
    calls.create.length = 0
    const res = await request('POST', '/api/properties', {
      ...BASE, location: { lat: 41, lng: 29, isApproximate: true, approxRadiusKm: r },
    })
    assert.equal(res.status, 201, `radius ${r} must be accepted`)
    assert.equal(calls.create[0].location.approxRadiusKm, r)
  }
})

/* ══════════════════════ 2. CREATE — rejected coordinates ══════════════════ */

const REJECTED = [
  // Clear-like shapes. None of these may be read as "remove the stored pin":
  // that is what an explicit `location: null` is for.
  ['empty object', {}],
  ['settings only, no coordinates', { isApproximate: true, approxRadiusKm: 10 }],
  ['isApproximate only', { isApproximate: true }],
  ['approxRadiusKm only', { approxRadiusKm: 10 }],
  ['both coordinates null', { lat: null, lng: null }],
  ['both coordinates null, with settings', { lat: null, lng: null, isApproximate: false, approxRadiusKm: 5 }],
  ['latitude without longitude', { lat: 41.0082 }],
  ['longitude without latitude', { lng: 28.9784 }],
  ['latitude present, longitude null', { lat: 41.0082, lng: null }],
  ['longitude present, latitude null', { lat: null, lng: 28.9784 }],
  ['latitude above 90', { lat: 90.1, lng: 10 }],
  ['latitude below -90', { lat: -90.1, lng: 10 }],
  ['longitude above 180', { lat: 10, lng: 180.1 }],
  ['longitude below -180', { lat: 10, lng: -180.1 }],
  ['numeric string latitude', { lat: '41.0082', lng: 28.9784 }],
  ['numeric string longitude', { lat: 41.0082, lng: '28.9784' }],
  ['non-numeric string', { lat: 'abc', lng: 28.9784 }],
  ['boolean latitude', { lat: true, lng: 28.9784 }],
  ['string isApproximate', { lat: 41, lng: 29, isApproximate: 'true' }],
  ['numeric isApproximate', { lat: 41, lng: 29, isApproximate: 1 }],
  ['radius 0', { lat: 41, lng: 29, approxRadiusKm: 0 }],
  ['radius above 20', { lat: 41, lng: 29, approxRadiusKm: 21 }],
  ['negative radius', { lat: 41, lng: 29, approxRadiusKm: -5 }],
  ['string radius', { lat: 41, lng: 29, approxRadiusKm: '5' }],
  ['array instead of object', [41, 29]],
  ['string instead of object', 'somewhere'],
]

for (const [label, loc] of REJECTED) {
  test(`create rejects ${label}`, async () => {
    currentUser = admin(['add_listing'])
    const res = await request('POST', '/api/properties', { ...BASE, location: loc })
    assert.equal(res.status, 400, 'must be rejected')
    assert.equal(calls.create.length, 0, 'nothing may be written')
    assert.equal(calls.embedding.length, 0, 'an invalid location must not cost an embedding call')
  })
}

/* ══════════════════════ 3. Direct validator unit tests ═══════════════════ */
// NaN and Infinity cannot survive JSON.stringify, so they are exercised
// against the exported validator rather than over the wire.

test('validator rejects NaN and Infinity', async () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(parsePropertyLocation({ lat: bad, lng: 29 }).ok, false, `lat ${bad}`)
    assert.equal(parsePropertyLocation({ lat: 41, lng: bad }).ok, false, `lng ${bad}`)
    assert.equal(parsePropertyLocation({ lat: 41, lng: 29, approxRadiusKm: bad }).ok, false, `radius ${bad}`)
  }
})

test('validator distinguishes absent / clear / replace', async () => {
  assert.deepEqual(parsePropertyLocation(undefined), { ok: true, value: undefined },
    'key absent means leave the stored location alone')
  assert.deepEqual(parsePropertyLocation(null), { ok: true, value: null },
    'explicit null is the ONLY clear signal')
  assert.deepEqual(parsePropertyLocation({ lat: 0, lng: 0 }).value,
    { lat: 0, lng: 0, isApproximate: false, approxRadiusKm: 5 })
})

test('validator refuses to infer a clear from a coordinate-less object', async () => {
  // A frontend that forgot to attach the pin must not be able to erase one.
  for (const shape of [
    {},
    { isApproximate: true },
    { approxRadiusKm: 10 },
    { isApproximate: true, approxRadiusKm: 10 },
    { lat: null, lng: null },
    { lat: null, lng: null, isApproximate: false, approxRadiusKm: 5 },
    { lat: undefined, lng: undefined },
  ]) {
    const out = parsePropertyLocation(shape)
    assert.equal(out.ok, false, JSON.stringify(shape) + ' must be rejected')
    assert.match(out.message, /location: null/, 'the error must point at the real clear signal')
  }
})

/* ══════════════════════ 4. UPDATE semantics ═════════════════════════════ */

test('update with location omitted leaves the stored location untouched', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = storedDoc({ lat: 41, lng: 29, isApproximate: false, approxRadiusKm: 5 })
  db.updateResult = storedDoc({ lat: 41, lng: 29, isApproximate: false, approxRadiusKm: 5 })

  const res = await request('PUT', '/api/properties/p1', { title: 'Renamed' })
  assert.equal(res.status, 200)
  const { ops } = calls.findByIdAndUpdate[0]
  assert.equal('location' in (ops.$set || {}), false, 'must not set location')
  assert.equal('$unset' in ops, false, 'must not clear location')
})

test('update with a valid location replaces it', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = storedDoc(null)
  db.updateResult = storedDoc({ lat: 1, lng: 2 })

  const res = await request('PUT', '/api/properties/p1', {
    location: { lat: 1, lng: 2, isApproximate: true, approxRadiusKm: 7 },
  })
  assert.equal(res.status, 200)
  const { ops } = calls.findByIdAndUpdate[0]
  assert.deepEqual(ops.$set.location, { lat: 1, lng: 2, isApproximate: true, approxRadiusKm: 7 })
  assert.equal('$unset' in ops, false)
})

test('update with location: null clears it via $unset', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = storedDoc({ lat: 41, lng: 29 })
  db.updateResult = storedDoc(undefined)

  const res = await request('PUT', '/api/properties/p1', { location: null })
  assert.equal(res.status, 200)
  const { ops } = calls.findByIdAndUpdate[0]
  assert.deepEqual(ops.$unset, { location: '' }, 'must unset, not write null')
  assert.equal('location' in (ops.$set || {}), false)
})

test('a location-only clear does not emit an empty $set', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = storedDoc({ lat: 41, lng: 29 })
  db.updateResult = storedDoc(undefined)

  await request('PUT', '/api/properties/p1', { location: null })
  const { ops } = calls.findByIdAndUpdate[0]
  assert.equal(ops.$set === undefined || Object.keys(ops.$set).length > 0, true,
    'MongoDB rejects an empty $set')
})

const CLEAR_LIKE = [
  ['empty object', {}],
  ['settings only', { isApproximate: true, approxRadiusKm: 10 }],
  ['isApproximate only', { isApproximate: true }],
  ['approxRadiusKm only', { approxRadiusKm: 10 }],
  ['null pair', { lat: null, lng: null }],
  ['null pair with settings', { lat: null, lng: null, isApproximate: false, approxRadiusKm: 5 }],
  ['latitude only', { lat: 41.0082 }],
  ['longitude only', { lng: 28.9784 }],
]

for (const [label, loc] of CLEAR_LIKE) {
  test(`update rejects a clear-like location (${label}) and leaves the stored pin alone`, async () => {
    currentUser = admin(['edit_listing'])
    db.findByIdResult = storedDoc({ lat: 41.0082, lng: 28.9784, isApproximate: false, approxRadiusKm: 5 })

    const res = await request('PUT', '/api/properties/p1', { location: loc })

    assert.equal(res.status, 400, 'must be refused')
    assert.equal(calls.findByIdAndUpdate.length, 0, 'the stored location must survive')
    assert.equal(calls.embedding.length, 0, 'no embedding regeneration')
    assert.equal(calls.reassignment.length, 0, 'no conversation reassignment')
  })

  test(`create rejects a clear-like location (${label})`, async () => {
    currentUser = admin(['add_listing'])
    const res = await request('POST', '/api/properties', { ...BASE, location: loc })
    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0, 'no property may be created')
  })
}

test('create with location: null succeeds and stores no location', async () => {
  currentUser = admin(['add_listing'])
  const res = await request('POST', '/api/properties', { ...BASE, location: null })
  assert.equal(res.status, 201)
  assert.equal(calls.create.length, 1)
  assert.equal('location' in calls.create[0], false)
})

test('an invalid location update is atomic — no write, no side effects', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = storedDoc({ lat: 41, lng: 29 })

  const res = await request('PUT', '/api/properties/p1', {
    title: 'Should not be saved',
    location: { lat: 999, lng: 29 },
  })

  assert.equal(res.status, 400)
  assert.equal(calls.findByIdAndUpdate.length, 0, 'no property write')
  assert.equal(calls.reassignment.length, 0, 'no conversation reassignment')
  assert.equal(calls.embedding.length, 0, 'no embedding regeneration')
})

/* ══════════════════════ 5. Public privacy contract ══════════════════════ */

const EXACT = { lat: 41.0082, lng: 28.9784, isApproximate: false, approxRadiusKm: 5 }
const APPROX = { lat: 41.0082, lng: 28.9784, isApproximate: true, approxRadiusKm: 8 }

for (const [label, path] of [['list', '/api/properties'], ['sale', '/api/properties/sale'], ['rent', '/api/properties/rent']]) {
  test(`public ${label} exposes coordinates of an EXACT listing`, async () => {
    db.findResult = [{ _id: 'p1', ...BASE, location: { ...EXACT } }]
    const res = await request('GET', path)
    assert.equal(res.status, 200)
    assert.equal(res.body.properties[0].location.lat, 41.0082)
    assert.equal(res.body.properties[0].location.lng, 28.9784)
  })

  test(`public ${label} REDACTS coordinates of an APPROXIMATE listing`, async () => {
    db.findResult = [{ _id: 'p1', ...BASE, location: { ...APPROX } }]
    const res = await request('GET', path)
    assert.equal(res.status, 200)
    const loc = res.body.properties[0].location
    assert.equal('lat' in loc, false, 'exact latitude must not be published')
    assert.equal('lng' in loc, false, 'exact longitude must not be published')
    assert.deepEqual(loc, { isApproximate: true, approxRadiusKm: 8 })
    assert.equal(JSON.stringify(res.body).includes('41.0082'), false,
      'the coordinate must appear nowhere in the payload')
  })
}

test('public detail exposes coordinates of an EXACT listing', async () => {
  db.findByIdResult = storedDoc({ ...EXACT })
  const res = await request('GET', '/api/properties/p1')
  assert.equal(res.status, 200)
  assert.equal(res.body.property.location.lat, 41.0082)
})

test('public detail REDACTS coordinates of an APPROXIMATE listing', async () => {
  db.findByIdResult = storedDoc({ ...APPROX })
  const res = await request('GET', '/api/properties/p1')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.property.location, { isApproximate: true, approxRadiusKm: 8 })
  assert.equal(JSON.stringify(res.body).includes('41.0082'), false)
})

test('public reads still exclude the embedding fields', async () => {
  db.findResult = []
  await request('GET', '/api/properties')
  assert.ok(calls.select.includes('-descriptionEmbedding -embeddingUpdatedAt'),
    'PUBLIC_PROPERTY_EXCLUDE must still be applied')
})

/* ══════════════════════ 6. Historical / malformed data ══════════════════ */

const MALFORMED = [
  ['latitude only', { lat: 41.0082 }],
  ['longitude only', { lng: 28.9784 }],
  ['numeric strings', { lat: '41.0082', lng: '28.9784' }],
  ['out of range', { lat: 999, lng: 28.9784 }],
  ['empty object', {}],
]

for (const [label, loc] of MALFORMED) {
  test(`a property with malformed stored location (${label}) still lists, with no usable coordinates`, async () => {
    db.findResult = [{ _id: 'p1', ...BASE, location: loc }]
    const res = await request('GET', '/api/properties')
    assert.equal(res.status, 200)
    assert.equal(res.body.properties.length, 1, 'the property must still be returned')
    assert.equal(res.body.properties[0].title, 'T')
    assert.equal('location' in res.body.properties[0], false, 'no unusable location key')
  })
}

test('a property with no location at all serialises normally', async () => {
  db.findResult = [{ _id: 'p1', ...BASE }]
  const res = await request('GET', '/api/properties')
  assert.equal(res.status, 200)
  assert.equal(res.body.properties.length, 1)
  assert.equal('location' in res.body.properties[0], false)
})

test('publicLocation never returns coordinates for an approximate record', async () => {
  const out = publicLocation({ lat: 1, lng: 2, isApproximate: true, approxRadiusKm: 3 })
  assert.equal('lat' in out, false)
  assert.equal('lng' in out, false)
})

/* ══════════════════════ 7. Admin exact-location endpoint ════════════════ */

test('owner reads the exact coordinates of an APPROXIMATE listing', async () => {
  currentUser = owner()
  db.findByIdResult = { location: { ...APPROX } }
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.location, { lat: 41.0082, lng: 28.9784, isApproximate: true, approxRadiusKm: 8 })
})

test('admin with edit_listing reads the exact coordinates', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = { location: { ...APPROX } }
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 200)
  assert.equal(res.body.location.lat, 41.0082)
})

const REFUSED_ACTORS = [
  ['admin with no permissions', () => admin([]), 403],
  ['admin with add_listing only', () => admin(['add_listing']), 403],
  ['admin with delete_listing only', () => admin(['delete_listing']), 403],
  ['admin with unrelated permissions', () => admin(['manage_team', 'view_contacts']), 403],
  ['agent', () => ({ _id: 'a', role: 'agent', permissions: ['edit_listing'] }), 403],
  ['regular user', () => ({ _id: 'u', role: 'user', permissions: ['edit_listing'] }), 403],
]

for (const [label, make, expected] of REFUSED_ACTORS) {
  test(`admin-location refuses ${label}`, async () => {
    currentUser = make()
    db.findByIdResult = { location: { ...APPROX } }
    const res = await request('GET', '/api/properties/p1/admin-location')
    assert.equal(res.status, expected)
    assert.equal(JSON.stringify(res.body).includes('41.0082'), false, 'no coordinate may leak')
  })
}

test('admin-location refuses an anonymous request with 401', async () => {
  currentUser = null
  db.findByIdResult = { location: { ...APPROX } }
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 401)
  assert.equal(JSON.stringify(res.body).includes('41.0082'), false)
})

test('admin-location returns null for a malformed stored location', async () => {
  currentUser = owner()
  db.findByIdResult = { location: { lat: 41.0082 } }
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 200)
  assert.equal(res.body.location, null, 'a half pair must not reach an editing form')
})

test('admin-location returns null when there is no stored location', async () => {
  currentUser = owner()
  db.findByIdResult = { location: undefined }
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 200)
  assert.equal(res.body.location, null)
})

test('admin-location 404s for a property that does not exist', async () => {
  currentUser = owner()
  db.findByIdResult = null
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 404)
})

test('admin-location returns ONLY the location — no other property field', async () => {
  currentUser = owner()
  db.findByIdResult = { _id: 'p1', location: { ...EXACT }, descriptionEmbedding: [1, 2, 3], agent: 'agent-id' }
  const res = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['location', 'success'])
  const serialised = JSON.stringify(res.body)
  assert.equal(serialised.includes('descriptionEmbedding'), false)
  assert.equal(serialised.includes('agent-id'), false)
})

/* ══════════════════════ 8. The end-to-end privacy proof ═════════════════ */

test('one approximate listing: public hides the coordinate, the editor still sees it', async () => {
  // Public list
  db.findResult = [{ _id: 'p1', ...BASE, location: { ...APPROX } }]
  const list = await request('GET', '/api/properties')
  assert.equal(JSON.stringify(list.body).includes('41.0082'), false, 'list must not leak')

  // Public detail
  db.findByIdResult = storedDoc({ ...APPROX })
  const detail = await request('GET', '/api/properties/p1')
  assert.equal(JSON.stringify(detail.body).includes('41.0082'), false, 'detail must not leak')

  // Authorised editor
  currentUser = admin(['edit_listing'])
  db.findByIdResult = { location: { ...APPROX } }
  const editor = await request('GET', '/api/properties/p1/admin-location')
  assert.equal(editor.body.location.lat, 41.0082, 'the editor must still get the exact pin')
})

/* ══════════════════════ 9. Regression guards ════════════════════════════ */

test('a location-only update does not touch the agent', async () => {
  currentUser = admin(['edit_listing'])
  db.findByIdResult = storedDoc(null)
  db.updateResult = storedDoc({ lat: 1, lng: 2 })

  await request('PUT', '/api/properties/p1', { location: { lat: 1, lng: 2 } })
  const { ops } = calls.findByIdAndUpdate[0]
  assert.equal('agent' in (ops.$set || {}), false, 'agent must not be written by a location edit')
  assert.equal('agentEmail' in (ops.$set || {}), false)
})

test('editableLocation preserves an exact approximate pin but rejects a half pair', async () => {
  assert.deepEqual(editableLocation({ lat: 0, lng: 0, isApproximate: true, approxRadiusKm: 9 }),
    { lat: 0, lng: 0, isApproximate: true, approxRadiusKm: 9 }, 'zero coordinates are real')
  assert.equal(editableLocation({ lat: 41 }), null)
  assert.equal(editableLocation(null), null)
  assert.equal(editableLocation('x'), null)
})
