// Server-side permission enforcement for the five content route groups.
//
// These permissions already existed in the User model and were already
// grantable in the admin UI, but the routes only ever checked
// requireRole('owner','admin') — so the permission was stored and displayed
// while enforcing nothing. Any admin could edit Team, Showroom, Reviews,
// Projects and About regardless of what the owner had actually granted. This
// suite is the guard against that silently coming back.
//
// What it exercises is the REAL router of each feature, mounted on a real
// express app over a real HTTP server. Only the two genuine externals are
// replaced: MongoDB (the models) and JWT verification (protect). The
// authorization middleware itself is the real requireRole/requirePermission,
// because that is the thing under test.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

// ── The signed-in actor ──────────────────────────────────────────────────
// Swapped per request. protect() is mocked to inject exactly this and nothing
// else, so each test states the actor's role and permissions literally rather
// than minting a JWT for them.
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

// ── Did the request reach the handler? ───────────────────────────────────
// The assertion that matters is not "did it return 200" — a stubbed model can
// make a handler fail for reasons unrelated to authorization. It is whether
// the handler was reached at all. Every model method records into this, so a
// blocked request is provably blocked BEFORE any data access.
const modelCalls = []

const stubModel = (name) => {
  const record = (method) => (...args) => {
    modelCalls.push({ model: name, method })
    if (method === 'find') return { sort: () => [] }
    if (method === 'findOne') return null
    if (method === 'findById') return null
    return { _id: 'stub-id', ...(args[0] && typeof args[0] === 'object' ? args[0] : {}) }
  }
  return {
    find: record('find'),
    findOne: record('findOne'),
    findById: record('findById'),
    create: record('create'),
    findByIdAndUpdate: record('findByIdAndUpdate'),
    findByIdAndDelete: record('findByIdAndDelete'),
  }
}

mock.module('../models/TeamMember.js', { defaultExport: stubModel('TeamMember') })
mock.module('../models/ShowroomImage.js', { defaultExport: stubModel('ShowroomImage') })
mock.module('../models/Review.js', { defaultExport: stubModel('Review') })
mock.module('../models/Project.js', { defaultExport: stubModel('Project') })
mock.module('../models/AboutContent.js', { defaultExport: stubModel('AboutContent') })

const { default: teamRoutes } = await import('../routes/team.js')
const { default: showroomRoutes } = await import('../routes/showroom.js')
const { default: reviewRoutes } = await import('../routes/reviews.js')
const { default: projectRoutes } = await import('../routes/projects.js')
const { default: aboutRoutes } = await import('../routes/about.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/team', teamRoutes)
  app.use('/api/showroom', showroomRoutes)
  app.use('/api/reviews', reviewRoutes)
  app.use('/api/projects', projectRoutes)
  app.use('/api/about', aboutRoutes)
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message })
  })

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  modelCalls.length = 0
  currentUser = null
})

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const owner = (permissions = []) => ({ _id: 'owner-id', role: 'owner', permissions })
const admin = (permissions = []) => ({ _id: 'admin-id', role: 'admin', permissions })

// Every mutating route now guarded, and the permission each one requires.
const GUARDED = [
  { permission: 'manage_team', method: 'GET', path: '/api/team/all' },
  { permission: 'manage_team', method: 'POST', path: '/api/team', body: { name: 'X' } },
  { permission: 'manage_team', method: 'PUT', path: '/api/team/abc', body: { name: 'X' } },
  { permission: 'manage_team', method: 'DELETE', path: '/api/team/abc' },

  { permission: 'manage_showroom', method: 'GET', path: '/api/showroom/renovation/all' },
  { permission: 'manage_showroom', method: 'POST', path: '/api/showroom', body: { service: 'renovation' } },
  { permission: 'manage_showroom', method: 'PUT', path: '/api/showroom/abc', body: { service: 'renovation' } },
  { permission: 'manage_showroom', method: 'DELETE', path: '/api/showroom/abc' },

  { permission: 'manage_reviews', method: 'GET', path: '/api/reviews/all' },
  { permission: 'manage_reviews', method: 'POST', path: '/api/reviews', body: { name: 'X' } },
  { permission: 'manage_reviews', method: 'PUT', path: '/api/reviews/abc', body: { name: 'X' } },
  { permission: 'manage_reviews', method: 'DELETE', path: '/api/reviews/abc' },

  { permission: 'manage_projects', method: 'GET', path: '/api/projects/all' },
  { permission: 'manage_projects', method: 'POST', path: '/api/projects', body: { title: 'X' } },
  { permission: 'manage_projects', method: 'PUT', path: '/api/projects/abc', body: { title: 'X' } },
  { permission: 'manage_projects', method: 'DELETE', path: '/api/projects/abc' },

  { permission: 'manage_about', method: 'PUT', path: '/api/about', body: { heroHeading: 'X' } },
]

// ── ADMIN WITHOUT THE PERMISSION → 403, before any data access ───────────
for (const route of GUARDED) {
  test(route.method + ' ' + route.path + ' — admin WITHOUT ' + route.permission + ' is refused', async () => {
    currentUser = admin([])
    const res = await request(route.method, route.path, route.body)
    assert.equal(res.status, 403, 'must be forbidden')
    assert.match(res.body?.message ?? '', new RegExp(route.permission), 'must name the missing permission')
    assert.deepEqual(modelCalls, [], 'must be refused BEFORE touching the database')
  })
}

// An unrelated permission must not open the door.
for (const route of GUARDED) {
  test(route.method + ' ' + route.path + ' — an unrelated permission does not satisfy ' + route.permission, async () => {
    currentUser = admin(['view_contacts', 'manage_partners'])
    const res = await request(route.method, route.path, route.body)
    assert.equal(res.status, 403)
    assert.deepEqual(modelCalls, [], 'must be refused BEFORE touching the database')
  })
}

// ── ADMIN WITH THE PERMISSION → reaches the handler ──────────────────────
for (const route of GUARDED) {
  test(route.method + ' ' + route.path + ' — admin WITH ' + route.permission + ' is allowed through', async () => {
    currentUser = admin([route.permission])
    const res = await request(route.method, route.path, route.body)
    assert.notEqual(res.status, 403, 'must not be forbidden')
    assert.ok(modelCalls.length > 0, 'handler must have been reached')
  })
}

// ── OWNER → allowed without holding the permission at all ────────────────
// requirePermission short-circuits on role === 'owner'. That is the existing
// contract in middleware/checkPermission.js, and adding these guards must not
// have changed it.
for (const route of GUARDED) {
  test(route.method + ' ' + route.path + ' — owner is allowed WITHOUT ' + route.permission, async () => {
    currentUser = owner([])
    const res = await request(route.method, route.path, route.body)
    assert.notEqual(res.status, 403, 'owner bypass must still apply')
    assert.ok(modelCalls.length > 0, 'handler must have been reached')
  })
}

// ── Role boundary is unchanged ───────────────────────────────────────────
test('a regular user is refused by requireRole before permissions are consulted', async () => {
  currentUser = { _id: 'user-id', role: 'user', permissions: ['manage_team'] }
  const res = await request('POST', '/api/team', { name: 'X' })
  assert.equal(res.status, 403)
  assert.match(res.body?.message ?? '', /insufficient role/)
  assert.deepEqual(modelCalls, [])
})

test('an agent is refused from admin content routes even holding the permission', async () => {
  currentUser = { _id: 'agent-id', role: 'agent', permissions: ['manage_team'] }
  const res = await request('POST', '/api/team', { name: 'X' })
  assert.equal(res.status, 403)
  assert.match(res.body?.message ?? '', /insufficient role/)
  assert.deepEqual(modelCalls, [])
})

test('an unauthenticated request never reaches the permission check', async () => {
  currentUser = null
  const res = await request('POST', '/api/team', { name: 'X' })
  assert.equal(res.status, 401)
  assert.deepEqual(modelCalls, [])
})

// ── Public reads stay public ─────────────────────────────────────────────
// The guards were added only to routes that already required a role. The
// unauthenticated GETs the public website depends on must be untouched.
const PUBLIC_READS = [
  ['GET', '/api/team'],
  ['GET', '/api/showroom/renovation'],
  ['GET', '/api/reviews'],
  ['GET', '/api/projects'],
  ['GET', '/api/projects/featured'],
  ['GET', '/api/about'],
]

for (const [method, path] of PUBLIC_READS) {
  test(method + ' ' + path + ' — still public, no auth required', async () => {
    currentUser = null
    const res = await request(method, path)
    assert.notEqual(res.status, 401, 'public read must not require authentication')
    assert.notEqual(res.status, 403, 'public read must not require a permission')
  })
}
