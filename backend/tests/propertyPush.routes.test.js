// Does a REJECTED property create notify anyone?
//
// propertyPush.test.js covers the service in isolation. This file asks whether
// it is REACHED at all, by driving the real POST /api/properties route down
// each of its rejecting paths and asserting the adapter was never invoked.
//
// The REAL router runs. Only genuine externals are faked: MongoDB, the auth
// middleware, the embedding service, and the push adapter — which is a SPY, so
// no notification can leave the process.

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import mongoose from 'mongoose'

const ADMIN = new mongoose.Types.ObjectId()
const AGENT = new mongoose.Types.ObjectId()

// ── Scripted database ────────────────────────────────────────────────────
let created = []
let createShouldThrow = null

const FakeProperty = {
  create: async (doc) => {
    if (createShouldThrow) throw createShouldThrow
    const saved = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc }
    created.push(saved)
    return saved
  },
  find: () => ({ select: () => ({ sort: () => ({ limit: async () => [] }) }) }),
  findById: () => ({ select: async () => null, populate: () => ({ select: async () => null }) }),
}

// The agent lookup used by applyAgentContact.
const FakeUser = {
  findById: (wanted) => ({
    select: async () =>
      String(wanted) === String(AGENT)
        ? { _id: AGENT, role: 'agent', isActive: true, name: 'Ahmet', email: 'a@x.test' }
        : null,
  }),
  find: () => ({ select: async () => [] }),
}

mock.module('../models/Property.js', { defaultExport: FakeProperty })
mock.module('../models/User.js', { defaultExport: FakeUser })

// Embeddings call an external model; irrelevant here and must not run.
mock.module('../services/propertyEmbeddingService.js', {
  namedExports: {
    generatePropertyEmbedding: async () => null,
    embeddingSourceFieldsChanged: () => false,
  },
})

// ── Scripted identity ────────────────────────────────────────────────────
let caller = null
let permitted = true

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!caller) return res.status(401).json({ success: false, message: 'Not authorized' })
      req.user = caller
      next()
    },
  },
})

mock.module('../middleware/checkPermission.js', {
  namedExports: {
    requireRole: () => (req, res, next) => {
      if (!permitted) return res.status(403).json({ success: false, message: 'Forbidden' })
      next()
    },
    requirePermission: () => (req, res, next) => next(),
  },
})

// ── The spy under test ───────────────────────────────────────────────────
let pushCalls = []

mock.module('../services/propertyPush.js', {
  namedExports: {
    sendNewPropertyPush: async (args) => {
      pushCalls.push(args)
      return { attempted: 1, accepted: 1, failed: 0 }
    },
  },
})

// ── Server under test ────────────────────────────────────────────────────
let server
let baseUrl

before(async () => {
  const { default: routes } = await import('../routes/properties.js')
  const app = express()
  app.use(express.json())
  app.use('/api/properties', routes)
  // The real error handler shape: a thrown create must surface as 500, not hang.
  app.use((err, req, res, _next) => res.status(500).json({ success: false, message: err.message }))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((r) => server.close(r))
})

const createProperty = async (body) => {
  const response = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/** A payload the route accepts, which each test then breaks in one way. */
const validBody = (overrides = {}) => ({
  title: 'Modern Apartment',
  listingType: 'Sale',
  price: 4200000,
  district: 'Kadıköy',
  propertyType: 'Apartment',
  beds: 3,
  baths: 2,
  sqm: 140,
  ...overrides,
})

test.beforeEach(() => {
  created = []
  pushCalls = []
  createShouldThrow = null
  caller = { _id: ADMIN, role: 'admin', name: 'Boss' }
  permitted = true
})

/* ═══════════════ Rejections ═══════════════ */

test('an invalid location is rejected, stores nothing, and notifies nobody', async () => {
  const { status } = await createProperty(
    validBody({ location: { lat: 'not-a-number', lng: 28.9 } })
  )

  assert.equal(status, 400)
  assert.equal(created.length, 0, 'no property may be created')
  assert.equal(pushCalls.length, 0, 'a refused create must notify nobody')
})

test('an out-of-range coordinate is rejected without a push', async () => {
  const { status } = await createProperty(validBody({ location: { lat: 999, lng: 28.9 } }))

  assert.equal(status, 400)
  assert.equal(created.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('an unassignable agent is rejected without a push', async () => {
  const { status } = await createProperty(
    validBody({ agent: new mongoose.Types.ObjectId().toString() })
  )

  assert.notEqual(status, 201)
  assert.equal(created.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('an unauthenticated create triggers no push', async () => {
  caller = null

  const { status } = await createProperty(validBody())

  assert.equal(status, 401)
  assert.equal(created.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('a forbidden role triggers no push', async () => {
  permitted = false

  const { status } = await createProperty(validBody())

  assert.equal(status, 403)
  assert.equal(created.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('a database failure during create triggers no push', async () => {
  createShouldThrow = new Error('write concern failed')

  const { status } = await createProperty(validBody())

  assert.equal(status, 500)
  assert.equal(pushCalls.length, 0, 'nothing may be announced for a listing that was not stored')
})

/* ═══════════════ Success ═══════════════ */

test('a successful create still returns 201 and pushes exactly once', async () => {
  const { status, body } = await createProperty(validBody())

  // The existing contract is unchanged.
  assert.equal(status, 201)
  assert.equal(body.success, true)
  assert.equal(body.property.title, 'Modern Apartment')

  assert.equal(created.length, 1)
  assert.equal(pushCalls.length, 1, 'exactly once — not zero, not twice')
})

test('the push receives the SAVED property, not the request body', async () => {
  await createProperty(validBody())

  // _id only exists after the write, so this proves the announcement happens
  // downstream of a committed document.
  assert.ok(pushCalls[0].property?._id, 'the saved document, with its id')
  assert.equal(String(pushCalls[0].property._id), String(created[0]._id))
})

test('the creator is excluded from their own listing notification', async () => {
  await createProperty(validBody())

  assert.deepEqual(
    pushCalls[0].excludeUserIds.map(String),
    [String(ADMIN)],
    'the admin looking at the create form does not need a buzz'
  )
})

test('a listing created WITH a valid agent still pushes once', async () => {
  const { status } = await createProperty(validBody({ agent: AGENT.toString() }))

  assert.equal(status, 201)
  assert.equal(pushCalls.length, 1)
})
