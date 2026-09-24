// Property gallery: order, ceiling, cover and no-op.
//
// The rule this suite exists to defend is that THE ARRAY ORDER IS THE GALLERY.
// Nothing else records it — PropertyDetailsPage renders `property.images`
// exactly as stored — so any step that sorts, groups or re-derives the array
// silently rearranges a visitor's view of the property.
//
// Only MongoDB and JWT verification are replaced; the validation and the route
// wiring under test are real.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

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

const db = { findByIdResult: null, updateResult: null }
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
    find: () => makeQuery([]),
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

mock.module('../services/propertyCreatedPush.js', {
  namedExports: { notifyNewPropertyCreated: async () => {} },
})

const { default: propertyRoutes, parsePropertyImages, MAX_PROPERTY_IMAGES } =
  await import('../routes/properties.js')

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
  currentUser = { _id: 'o', role: 'owner', permissions: [] }
  db.findByIdResult = { _id: 'p1', agent: null, images: ['stored-a', 'stored-b'], mainImage: 'stored-a' }
  db.updateResult = { _id: 'p1' }
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

const BASE = { title: 'T', listingType: 'Sale', price: 1, district: 'D', address: 'A', beds: 1, baths: 1, sqm: 1 }
const created = () => calls.create[0]
const updateSet = () => calls.findByIdAndUpdate[0].ops.$set || {}
const urls = (n) =>
  Array.from({ length: n }, (_, i) => `https://res.cloudinary.com/x/image/upload/v1/varlikent/img${i}.jpg`)

/* ══════════════════ 1. Order is preserved, exactly ══════════════════ */

test('create stores the gallery in the order it was sent', async () => {
  const images = ['c.jpg', 'a.jpg', 'b.jpg']
  const r = await request('POST', '/api/properties', { ...BASE, images, mainImage: 'c.jpg' })
  assert.equal(r.status, 201)
  assert.deepEqual(created().images, ['c.jpg', 'a.jpg', 'b.jpg'])
})

test('update writes the dragged order verbatim — no sorting, no grouping', async () => {
  const reordered = ['d.jpg', 'a.jpg', 'c.jpg', 'b.jpg']
  const r = await request('PUT', '/api/properties/p1', { images: reordered, mainImage: 'd.jpg' })
  assert.equal(r.status, 200)
  assert.deepEqual(updateSet().images, reordered)
})

test('a 60-image gallery survives a round trip with its order intact', async () => {
  const images = urls(MAX_PROPERTY_IMAGES)
  const r = await request('PUT', '/api/properties/p1', { images, mainImage: images[0] })
  assert.equal(r.status, 200)
  assert.deepEqual(updateSet().images, images)
  assert.equal(updateSet().images.length, 60)
})

/* ══════════════════ 2. The ceiling is explicit ══════════════════════ */

test('one image over the ceiling is refused with a message naming the number', async () => {
  const r = await request('PUT', '/api/properties/p1', { images: urls(MAX_PROPERTY_IMAGES + 1) })
  assert.equal(r.status, 400)
  assert.match(r.body.message, new RegExp(String(MAX_PROPERTY_IMAGES)))
  assert.match(r.body.message, /Remove 1\b/)
  assert.equal(calls.findByIdAndUpdate.length, 0, 'nothing may be written')
})

test('the ceiling is refused before anything is created', async () => {
  // A rejected gallery must cost no database write, no agent lookup and no
  // embedding call — the same contract location and the detail fields hold to.
  const r = await request('POST', '/api/properties', { ...BASE, images: urls(200) })
  assert.equal(r.status, 400)
  assert.equal(calls.create.length, 0)
})

test('a non-array images value is refused rather than stored', async () => {
  for (const bad of ['a.jpg', 42, { 0: 'a.jpg' }]) {
    const r = await request('PUT', '/api/properties/p1', { images: bad })
    assert.equal(r.status, 400, JSON.stringify(bad) + ' must be refused')
  }
})

test('a non-string entry is refused rather than stored', async () => {
  const r = await request('PUT', '/api/properties/p1', { images: ['a.jpg', { url: 'b.jpg' }] })
  assert.equal(r.status, 400)
})

/* ══════════════════ 3. The cover follows position 0 ════════════════ */

test('mainImage defaults to the first image when none is sent', async () => {
  const r = await request('PUT', '/api/properties/p1', { images: ['first.jpg', 'second.jpg'] })
  assert.equal(r.status, 200)
  assert.equal(updateSet().mainImage, 'first.jpg')
})

test('a mainImage naming a URL not in the gallery is repaired to position 0', async () => {
  await request('PUT', '/api/properties/p1', {
    images: ['first.jpg', 'second.jpg'],
    mainImage: 'deleted-long-ago.jpg',
  })
  assert.equal(updateSet().mainImage, 'first.jpg')
})

test('a mainImage that IS in the gallery is left exactly where it was put', async () => {
  // Position 0 is only a FALLBACK. A deliberate cover choice must survive, so
  // that adding a "choose the cover" control later needs no change here.
  await request('PUT', '/api/properties/p1', {
    images: ['first.jpg', 'second.jpg', 'third.jpg'],
    mainImage: 'third.jpg',
  })
  assert.equal(updateSet().mainImage, 'third.jpg')
})

test('an emptied gallery leaves an empty cover, not a stale one', async () => {
  await request('PUT', '/api/properties/p1', { images: [], mainImage: 'stored-a' })
  assert.equal(updateSet().mainImage, '')
  assert.deepEqual(updateSet().images, [])
})

/* ══════════════════ 4. Omission is a true no-op ════════════════════ */

test('an edit that sends no images key touches neither the gallery nor the cover', async () => {
  const r = await request('PUT', '/api/properties/p1', { price: 999 })
  assert.equal(r.status, 200)
  const set = updateSet()
  assert.equal('images' in set, false, 'images must not reach $set')
  assert.equal('mainImage' in set, false, 'mainImage must not reach $set')
  assert.equal(set.price, 999)
})

/* ══════════════════ 5. Accidental repeats only ═════════════════════ */

test('an exact repeat of one URL is dropped, and the first position wins', async () => {
  await request('PUT', '/api/properties/p1', { images: ['a.jpg', 'b.jpg', 'a.jpg', 'c.jpg'] })
  assert.deepEqual(updateSet().images, ['a.jpg', 'b.jpg', 'c.jpg'])
})

test('two separate uploads of the same photo both survive', async () => {
  // Cloudinary gives every upload its own public_id, so genuinely repeated
  // uploads are DIFFERENT urls. Nothing here may collapse them.
  const images = [
    'https://res.cloudinary.com/x/image/upload/v1/varlikent/aaa111.jpg',
    'https://res.cloudinary.com/x/image/upload/v1/varlikent/bbb222.jpg',
  ]
  await request('PUT', '/api/properties/p1', { images })
  assert.deepEqual(updateSet().images, images)
})

test('blank and whitespace-only entries are dropped without shifting the rest', async () => {
  await request('PUT', '/api/properties/p1', { images: ['a.jpg', '', '   ', 'b.jpg'] })
  assert.deepEqual(updateSet().images, ['a.jpg', 'b.jpg'])
})

/* ══════════════════ 6. The parser, directly ════════════════════════ */

test('parsePropertyImages leaves an absent key absent', () => {
  assert.deepEqual(parsePropertyImages({ title: 'x' }).value, {})
})

test('parsePropertyImages trims surrounding whitespace on stored URLs', () => {
  const { value } = parsePropertyImages({ images: ['  a.jpg  ', 'b.jpg'] })
  assert.deepEqual(value.images, ['a.jpg', 'b.jpg'])
})

test('MAX_PROPERTY_IMAGES is 60 and the request it implies stays small', () => {
  assert.equal(MAX_PROPERTY_IMAGES, 60)
  // Measured, not assumed: this is why express.json()'s 100 kb default is left
  // alone rather than raised. A real Cloudinary URL on this account is 96 bytes.
  const body = JSON.stringify({ images: urls(MAX_PROPERTY_IMAGES), mainImage: 'x' })
  assert.ok(Buffer.byteLength(body) < 20 * 1024, 'a full gallery must stay far under 100 kb')
})
