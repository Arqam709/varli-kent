// Design boards against a REAL MongoDB, end to end: real JWTs, the real
// `protect` middleware, the real User and DesignBoard models and indexes.
//
// Skipped unless DESIGN_BOARDS_TEST_MONGO_URI is set, so `npm test` never needs
// a database and can never touch a real one by accident. Point it at a
// throwaway server only — the test creates and DROPS its own database:
//
//   DESIGN_BOARDS_TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

const MONGO_URI = process.env.DESIGN_BOARDS_TEST_MONGO_URI
const skip = !MONGO_URI && 'DESIGN_BOARDS_TEST_MONGO_URI is not set'

const DB_NAME = `varlikent_design_boards_test_${process.pid}_${Date.now()}`
const SECRET = 'design-boards-integration-test-secret'

let server
let baseUrl
let DesignBoard
let tokenA
let tokenB
let userA

before(async () => {
  if (skip) return
  process.env.JWT_SECRET = SECRET

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME })
  const { default: User } = await import('../models/User.js')
  ;({ default: DesignBoard } = await import('../models/DesignBoard.js'))
  const { default: designBoardRoutes } = await import('../routes/designBoards.js')
  await DesignBoard.syncIndexes()

  userA = await User.create({ name: 'Ada', email: 'ada@example.test', password: 'secret-a' })
  const userB = await User.create({ name: 'Bo', email: 'bo@example.test', password: 'secret-b' })
  tokenA = jwt.sign({ id: userA._id }, SECRET)
  tokenB = jwt.sign({ id: userB._id }, SECRET)

  const app = express()
  app.use(express.json())
  app.use('/api/design-boards', designBoardRoutes)
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (skip) return
  await new Promise((resolve) => server.close(resolve))
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

const call = async (token, method, path, body) => {
  const response = await fetch(`${baseUrl}/api/design-boards${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const board = (overrides = {}) => ({
  room: 'bathroom',
  style: 'classic',
  wall: { label: 'Chalk White', color: '#f4f1ea' },
  floor: { label: 'Grey Terrazzo', color: '#9a9a96' },
  materials: [{ name: 'Brushed Nickel', color: '#a8a9ad' }],
  lighting: 'day',
  ...overrides,
})

test('create → persisted → list/get → update → delete, and user B is shut out throughout', { skip }, async () => {
  assert.equal((await call(null, 'GET', '')).status, 401)

  // 1. create
  const created = await call(tokenA, 'POST', '', board({ clientId: 'dms-int-1' }))
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.board._id

  // 2. really in MongoDB, in the designboards collection, owned by A
  const raw = await mongoose.connection.db.collection('designboards').findOne({ _id: new mongoose.Types.ObjectId(id) })
  assert.ok(raw, 'the board was not written to the designboards collection')
  assert.equal(String(raw.user), String(userA._id))
  assert.equal(raw.clientId, 'dms-int-1')
  assert.equal(raw.room, 'bathroom')
  assert.ok(raw.createdAt instanceof Date && raw.updatedAt instanceof Date)

  // 3. list and get
  const list = await call(tokenA, 'GET', '')
  assert.deepEqual(list.body.boards.map((b) => b._id), [id])
  assert.equal((await call(tokenA, 'GET', `/${id}`)).body.board.style, 'classic')

  // 6-8. user B: read, list, update, delete all fail and change nothing
  assert.equal((await call(tokenB, 'GET', `/${id}`)).status, 404)
  assert.deepEqual((await call(tokenB, 'GET', '')).body.boards, [])
  assert.equal((await call(tokenB, 'PUT', `/${id}`, board({ room: 'office' }))).status, 404)
  assert.equal((await call(tokenB, 'DELETE', `/${id}`)).status, 404)
  const untouched = await DesignBoard.findById(id)
  assert.equal(untouched.room, 'bathroom')
  assert.equal(String(untouched.user), String(userA._id))

  // 4. update
  const updated = await call(tokenA, 'PUT', `/${id}`, board({ style: 'warm', materials: [] }))
  assert.equal(updated.status, 200)
  assert.equal(updated.body.board.style, 'warm')
  assert.deepEqual((await DesignBoard.findById(id).lean()).materials, [])

  // retried create with the same clientId: still one board
  const retried = await call(tokenA, 'POST', '', board({ clientId: 'dms-int-1', lighting: 'night' }))
  assert.equal(retried.status, 200)
  assert.equal(retried.body.board._id, id)
  assert.equal(await DesignBoard.countDocuments({ user: userA._id }), 1)

  // 5. delete
  assert.equal((await call(tokenA, 'DELETE', `/${id}`)).status, 200)
  assert.equal(await DesignBoard.countDocuments({}), 0)
})

test('the unique (user, clientId) index is real, and scoped per user', { skip }, async () => {
  const base = { ...board(), clientId: 'dms-int-dup' }
  await DesignBoard.create({ ...base, user: userA._id })
  await assert.rejects(DesignBoard.create({ ...base, user: userA._id }), (err) => err.code === 11000)

  // Another user with the same device id is a different board.
  await DesignBoard.create({ ...base, user: new mongoose.Types.ObjectId() })
  // Boards without a clientId never collide with each other.
  await DesignBoard.create({ ...board(), user: userA._id })
  await DesignBoard.create({ ...board(), user: userA._id })

  await DesignBoard.deleteMany({})
})

test('an update can never reassign the owner, even bypassing the route', { skip }, async () => {
  const doc = await DesignBoard.create({ ...board(), user: userA._id })
  await DesignBoard.findOneAndUpdate(
    { _id: doc._id },
    { $set: { user: new mongoose.Types.ObjectId(), room: 'office' } },
    { returnDocument: 'after', runValidators: true }
  )
  const stored = await DesignBoard.findById(doc._id).lean()
  assert.equal(stored.room, 'office')
  assert.equal(String(stored.user), String(userA._id), 'immutable `user` was overwritten')
  await DesignBoard.deleteMany({})
})
