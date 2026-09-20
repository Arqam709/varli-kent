// Design My Space boards: the authenticated CRUD API and its ownership rule.
//
// The model is an in-memory stand-in that honours the filters the routes send,
// so a query that forgot `user: req.user._id` WOULD match another user's board
// here and fail the cross-user tests. Real-MongoDB persistence is covered by
// designBoards.mongo.test.js when a database URI is provided.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

let currentUser = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!currentUser) return res.status(401).json({ success: false, message: 'Not authorized, no token' })
      req.user = currentUser
      return next()
    },
    optionalAuth: (req, res, next) => next(),
    userFromToken: async () => null,
  },
})

const docs = new Map()
const calls = []
let nextId = 1
let createFailure = null

const objectId = () => (nextId++).toString(16).padStart(24, '0')
const clone = (value) => structuredClone(value)

// Compares ids the way MongoDB does for ObjectIds: by value.
const same = (a, b) => String(a) === String(b)

const matches = (doc, filter) => Object.entries(filter).every(([key, expected]) => {
  if (expected !== null && typeof expected === 'object') {
    throw new Error(`fake DesignBoard does not support the filter ${JSON.stringify({ [key]: expected })}`)
  }
  return same(doc[key], expected)
})

const find = (filter) => [...docs.values()].filter((doc) => matches(doc, filter))

class FakeDesignBoard {
  static async create(data) {
    calls.push({ method: 'create', data: clone(data) })
    if (createFailure) {
      const failure = createFailure
      createFailure = null
      throw failure
    }
    if (data.clientId && find({ user: data.user, clientId: data.clientId }).length > 0) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
    }
    const now = new Date(Date.now() + nextId)
    const doc = { _id: objectId(), version: 1, materials: [], ...clone(data), createdAt: now, updatedAt: now }
    docs.set(doc._id, doc)
    return clone(doc)
  }

  static find(filter) {
    calls.push({ method: 'find', filter: clone(filter) })
    const results = find(filter)
    return {
      sort: async (order) => {
        assert.deepEqual(order, { updatedAt: -1 })
        return clone(results.sort((a, b) => b.updatedAt - a.updatedAt))
      },
    }
  }

  static async findOne(filter) {
    calls.push({ method: 'findOne', filter: clone(filter) })
    const [doc] = find(filter)
    return doc ? clone(doc) : null
  }

  static async countDocuments(filter) {
    calls.push({ method: 'countDocuments', filter: clone(filter) })
    return find(filter).length
  }

  static async findOneAndUpdate(filter, update, options) {
    calls.push({ method: 'findOneAndUpdate', filter: clone(filter), update: clone(update), options })
    assert.deepEqual(Object.keys(update), ['$set'], 'updates must be $set only')
    assert.equal(options.returnDocument, 'after')
    assert.equal(options.runValidators, true)
    const [doc] = find(filter)
    if (!doc) return null
    Object.assign(doc, clone(update.$set), { updatedAt: new Date(Date.now() + nextId++) })
    return clone(doc)
  }

  static async findOneAndDelete(filter) {
    calls.push({ method: 'findOneAndDelete', filter: clone(filter) })
    const [doc] = find(filter)
    if (!doc) return null
    docs.delete(doc._id)
    return clone(doc)
  }
}

mock.module('../models/DesignBoard.js', { defaultExport: FakeDesignBoard })

const { default: designBoardRoutes, MAX_DESIGN_BOARDS_PER_USER } = await import('../routes/designBoards.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/design-boards', designBoardRoutes)
  app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }))
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  currentUser = null
  docs.clear()
  calls.length = 0
  createFailure = null
})

const USER_A = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'user', permissions: [] }
const USER_B = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'user', permissions: [] }

const as = (user) => { currentUser = user }

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const boardBody = (overrides = {}) => ({
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [
    { name: 'Calacatta Marble', color: '#f2ede8', image: 'https://res.cloudinary.com/demo/marble.jpg' },
    { name: 'Aged Brass', color: '#b08d57' },
  ],
  lighting: 'night',
  ...overrides,
})

const createAs = async (user, overrides) => {
  as(user)
  const response = await request('POST', '/api/design-boards', boardBody(overrides))
  assert.equal(response.status, 201, JSON.stringify(response.body))
  return response.body.board
}

/* ═══════════════ Authentication ═══════════════ */

test('every route requires a signed-in user', async () => {
  const id = 'cccccccccccccccccccccccc'
  for (const [method, path, body] of [
    ['GET', '/api/design-boards'],
    ['POST', '/api/design-boards', boardBody()],
    ['GET', `/api/design-boards/${id}`],
    ['PUT', `/api/design-boards/${id}`, boardBody()],
    ['DELETE', `/api/design-boards/${id}`],
  ]) {
    const response = await request(method, path, body)
    assert.equal(response.status, 401, `${method} ${path} answered without a session`)
  }
  assert.deepEqual(calls, [], 'the model was queried without a session')
})

/* ═══════════════ The owner’s lifecycle ═══════════════ */

test('1-2. a signed-in user creates a board, stored against their account', async () => {
  const board = await createAs(USER_A, { clientId: 'dms-lx1-abc12345' })

  assert.match(String(board._id), /^[0-9a-f]{24}$/)
  assert.equal(board.clientId, 'dms-lx1-abc12345')
  assert.equal(board.version, 1)
  assert.equal(board.room, 'living-room')
  assert.deepEqual(board.wall, { label: 'Warm Sand', color: '#e8ddd0' })
  assert.deepEqual(board.materials[1], { name: 'Aged Brass', color: '#b08d57' })
  assert.ok(board.createdAt && board.updatedAt)
  assert.equal('user' in board, false, 'the owner id leaked into the response')

  const stored = docs.get(String(board._id))
  assert.equal(stored.user, USER_A._id, 'ownership did not come from the session')
})

test('3. the owner lists and reads their boards, most recently edited first', async () => {
  const first = await createAs(USER_A, { room: 'bedroom' })
  const second = await createAs(USER_A, { room: 'kitchen' })

  const list = await request('GET', '/api/design-boards')
  assert.equal(list.status, 200)
  assert.equal(list.body.count, 2)
  assert.deepEqual(list.body.boards.map((b) => b._id), [second._id, first._id])
  assert.deepEqual(calls.find((c) => c.method === 'find').filter, { user: USER_A._id })

  const one = await request('GET', `/api/design-boards/${first._id}`)
  assert.equal(one.status, 200)
  assert.equal(one.body.board.room, 'bedroom')
})

test('4. the owner replaces a board', async () => {
  const board = await createAs(USER_A)

  const response = await request('PUT', `/api/design-boards/${board._id}`, boardBody({
    style: 'coastal',
    materials: [],
    lighting: 'day',
  }))

  assert.equal(response.status, 200)
  assert.equal(response.body.board.style, 'coastal')
  assert.deepEqual(response.body.board.materials, [])
  assert.equal(response.body.board.createdAt, board.createdAt)
  assert.deepEqual(calls.at(-1).filter, { _id: String(board._id), user: USER_A._id })
})

test('5. the owner deletes a board', async () => {
  const board = await createAs(USER_A)

  const response = await request('DELETE', `/api/design-boards/${board._id}`)
  assert.equal(response.status, 200)
  assert.equal(docs.size, 0)

  assert.equal((await request('GET', `/api/design-boards/${board._id}`)).status, 404)
  assert.equal((await request('DELETE', `/api/design-boards/${board._id}`)).status, 404)
})

/* ═══════════════ Another user ═══════════════ */

test('6. user B cannot read or list user A’s board', async () => {
  const board = await createAs(USER_A)

  as(USER_B)
  const one = await request('GET', `/api/design-boards/${board._id}`)
  assert.equal(one.status, 404)
  assert.deepEqual(one.body, { success: false, message: 'Design board not found' })

  const list = await request('GET', '/api/design-boards')
  assert.deepEqual(list.body.boards, [])
})

test('7. user B cannot update user A’s board', async () => {
  const board = await createAs(USER_A)

  as(USER_B)
  const response = await request('PUT', `/api/design-boards/${board._id}`, boardBody({ room: 'office' }))
  assert.equal(response.status, 404)
  assert.equal(docs.get(String(board._id)).room, 'living-room')
})

test('8. user B cannot delete user A’s board', async () => {
  const board = await createAs(USER_A)

  as(USER_B)
  const response = await request('DELETE', `/api/design-boards/${board._id}`)
  assert.equal(response.status, 404)
  assert.equal(docs.size, 1)
})

test('user B reusing user A’s clientId creates B’s own board and leaves A’s alone', async () => {
  const mine = await createAs(USER_A, { clientId: 'dms-shared' })
  const theirs = await createAs(USER_B, { clientId: 'dms-shared', room: 'office' })

  assert.notEqual(theirs._id, mine._id)
  assert.equal(docs.get(String(mine._id)).room, 'living-room')
  assert.equal(docs.get(String(theirs._id)).user, USER_B._id)
})

test('a malformed id is a plain 404 and never reaches the model', async () => {
  as(USER_A)
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await request(method, '/api/design-boards/not-an-id', method === 'PUT' ? boardBody() : undefined)
    assert.equal(response.status, 404)
  }
  assert.deepEqual(calls, [])
})

/* ═══════════════ Ownership cannot be supplied ═══════════════ */

test('a client cannot set or change the owner, id, version or timestamps', async () => {
  as(USER_A)
  for (const key of ['user', '_id', 'version', 'createdAt', 'updatedAt', 'isAdmin']) {
    const response = await request('POST', '/api/design-boards', { ...boardBody(), [key]: USER_B._id })
    assert.equal(response.status, 400, `${key} was accepted`)
    assert.equal(response.body.message, `Unsupported field: ${key}`)
  }

  const board = await createAs(USER_A)
  as(USER_A)
  const hijack = await request('PUT', `/api/design-boards/${board._id}`, { ...boardBody(), user: USER_B._id })
  assert.equal(hijack.status, 400)
  const renamed = await request('PUT', `/api/design-boards/${board._id}`, { ...boardBody(), clientId: 'dms-other' })
  assert.equal(renamed.status, 400, 'a board’s device id changed after creation')
  assert.equal(docs.get(String(board._id)).user, USER_A._id)
})

/* ═══════════════ Validation ═══════════════ */

test('only the shared room, style and lighting ids are accepted', async () => {
  as(USER_A)
  const invalid = {
    'unknown room': { room: 'attic' },
    'unknown style': { style: 'brutalist' },
    'unknown lighting': { lighting: 'dawn' },
    'translated label instead of id': { room: 'Living Room' },
    'missing wall': { wall: undefined },
    'wall not an object': { wall: 'Warm Sand' },
    'bad colour': { floor: { label: 'Oak', color: 'brown' } },
    'short hex': { floor: { label: 'Oak', color: '#abc' } },
    'empty label': { wall: { label: '   ', color: '#ffffff' } },
    'overlong label': { wall: { label: 'x'.repeat(81), color: '#ffffff' } },
    'extra finish key': { wall: { label: 'Sand', color: '#ffffff', price: 5 } },
    'materials not an array': { materials: {} },
    'too many materials': { materials: Array.from({ length: 25 }, (_, i) => ({ name: `M${i}`, color: '#111111' })) },
    'duplicate material': { materials: [{ name: 'Oak', color: '#111111' }, { name: 'Oak', color: '#111111' }] },
    'non-http texture': { materials: [{ name: 'Oak', color: '#111111', image: 'javascript:alert(1)' }] },
    'bad clientId': { clientId: '../../etc' },
  }

  for (const [label, overrides] of Object.entries(invalid)) {
    const body = boardBody(overrides)
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key]
    const response = await request('POST', '/api/design-boards', body)
    assert.equal(response.status, 400, `${label} was accepted`)
    assert.equal(typeof response.body.message, 'string')
  }
  assert.equal(docs.size, 0)
})

test('labels are trimmed, an empty texture is omitted, and zero materials is valid', async () => {
  const board = await createAs(USER_A, {
    wall: { label: '  Warm Sand  ', color: '#e8ddd0' },
    materials: [{ name: 'Oak', color: '#111111', image: '' }],
  })
  assert.equal(board.wall.label, 'Warm Sand')
  assert.deepEqual(board.materials, [{ name: 'Oak', color: '#111111' }])

  const empty = await createAs(USER_A, { materials: [] })
  assert.deepEqual(empty.materials, [])
})

test('a finish no longer in the Studio Palette still saves — boards are snapshots', async () => {
  const board = await createAs(USER_A, { wall: { label: 'Discontinued Terracotta', color: '#a0522d' } })
  assert.equal(board.wall.label, 'Discontinued Terracotta')
})

/* ═══════════════ Retried creates ═══════════════ */

test('re-sending a create with the same clientId updates that board instead of duplicating it', async () => {
  const first = await createAs(USER_A, { clientId: 'dms-retry' })

  const again = await request('POST', '/api/design-boards', boardBody({ clientId: 'dms-retry', style: 'classic' }))
  assert.equal(again.status, 200)
  assert.equal(again.body.board._id, first._id)
  assert.equal(again.body.board.style, 'classic')
  assert.equal(docs.size, 1)
})

test('a create that loses a duplicate-key race adopts the winning board', async () => {
  as(USER_A)
  // Simulates the other request inserting between our lookup and our insert.
  createFailure = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
  const winner = { _id: objectId(), user: USER_A._id, clientId: 'dms-race', version: 1, ...boardBody(), createdAt: new Date(), updatedAt: new Date() }
  const originalCount = FakeDesignBoard.countDocuments
  FakeDesignBoard.countDocuments = async (filter) => {
    docs.set(winner._id, clone(winner))
    return originalCount.call(FakeDesignBoard, filter)
  }

  try {
    const response = await request('POST', '/api/design-boards', boardBody({ clientId: 'dms-race', lighting: 'cool' }))
    assert.equal(response.status, 200)
    assert.equal(response.body.board._id, winner._id)
    assert.equal(response.body.board.lighting, 'cool')
    assert.equal(docs.size, 1)
  } finally {
    FakeDesignBoard.countDocuments = originalCount
  }
})

test(`a user can hold at most ${MAX_DESIGN_BOARDS_PER_USER} boards; others are unaffected`, async () => {
  for (let i = 0; i < MAX_DESIGN_BOARDS_PER_USER; i += 1) {
    docs.set(`${i}`.padStart(24, 'e'), { _id: `${i}`.padStart(24, 'e'), user: USER_A._id, ...boardBody(), createdAt: new Date(), updatedAt: new Date() })
  }

  as(USER_A)
  const blocked = await request('POST', '/api/design-boards', boardBody())
  assert.equal(blocked.status, 400)
  assert.match(blocked.body.message, /up to 50 designs/)

  await createAs(USER_B)
})
