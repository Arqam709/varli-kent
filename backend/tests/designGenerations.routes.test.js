// /api/design-generations over real HTTP: ownership, the server-built
// snapshot, room-photo rules, idempotency, history and deletion.
//
// Only the models, authentication and the site settings are stand-ins. No
// provider exists, and nothing here may ever produce a result.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Readable } from 'node:stream'
import express from 'express'
import { createFakeDesignGenerationModel } from './helpers/fakeDesignGenerationModel.js'
import {
  DESIGN_GENERATION_MAX_ACTIVE_PER_USER,
  DESIGN_GENERATION_MAX_PER_DAY,
  DESIGN_GENERATION_RETENTION_DAYS,
  DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS,
} from '../config/designGenerations.js'

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

const Generation = createFakeDesignGenerationModel()
mock.module('../models/DesignGeneration.js', { defaultExport: Generation })

const boards = new Map()
mock.module('../models/DesignBoard.js', {
  defaultExport: {
    findOne: async (filter) => {
      const board = boards.get(String(filter._id))
      return board && String(board.user) === String(filter.user) ? structuredClone(board) : null
    },
  },
})

const photos = new Map()
const photoUpdates = []
mock.module('../models/DesignRoomPhoto.js', {
  defaultExport: {
    findOne: async (filter) => {
      const photo = photos.get(String(filter._id))
      if (!photo) return null
      if (String(photo.user) !== String(filter.user)) return null
      if (filter.status && photo.status !== filter.status) return null
      return structuredClone(photo)
    },
    updateOne: async (filter, update) => {
      photoUpdates.push({ filter: structuredClone(filter), update: structuredClone(update) })
      const photo = photos.get(String(filter._id))
      if (!photo || String(photo.user) !== String(filter.user) || photo.status !== filter.status) {
        return { matchedCount: 0, modifiedCount: 0 }
      }
      const next = update.$max?.expiresAt
      if (next && next > photo.expiresAt) photo.expiresAt = next
      return { matchedCount: 1, modifiedCount: 1 }
    },
  },
})

let featureEnabled = true
mock.module('../models/SiteSettings.js', {
  defaultExport: {
    findOne: () => ({
      select: () => ({ lean: async () => ({ designGenerationsEnabled: featureEnabled }) }),
    }),
  },
})

const resultStorage = { opens: [], failure: null, bytes: Buffer.from([0xff, 0xd8, 0xff, 0x01]) }

mock.module('../services/designGenerations/resultStorage.js', {
  namedExports: {
    RESULT_CONTENT_TYPE: 'image/jpeg',
    RESULT_FORMAT: 'jpg',
    designGenerationResultPublicId: (id) => `varlikent/test/design-generations/${id}`,
    destroyGenerationResultAsset: async () => true,
    openGenerationResultStream: async (publicId, options) => {
      resultStorage.opens.push({ publicId, options })
      if (resultStorage.failure) throw resultStorage.failure
      return { stream: Readable.from([resultStorage.bytes]), contentLength: resultStorage.bytes.length }
    },
  },
})

const { default: routes } = await import('../routes/designGenerations.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/design-generations', routes)
  app.use((err, req, res, next) => res.status(500).json({ success: false, message: 'Internal Server Error' }))
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/design-generations`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

const USER_A = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'user', permissions: [] }
const USER_B = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'user', permissions: [] }
const as = (user) => { currentUser = user }

const BOARD_A = '11aaaaaaaaaaaaaaaaaaaaaa'
const BOARD_B = '11bbbbbbbbbbbbbbbbbbbbbb'
const PHOTO_A = '22aaaaaaaaaaaaaaaaaaaaaa'
const PHOTO_B = '22bbbbbbbbbbbbbbbbbbbbbb'

const board = (id, user, overrides = {}) => ({
  _id: id,
  user: user._id,
  version: 1,
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'night',
  ...overrides,
})

const photo = (id, user, overrides = {}) => ({
  _id: id,
  user: user._id,
  status: 'ready',
  expiresAt: new Date(Date.now() + 30 * 86_400_000),
  ...overrides,
})

beforeEach(() => {
  currentUser = null
  featureEnabled = true
  resultStorage.opens.length = 0
  resultStorage.failure = null
  Generation.docs.clear()
  Generation.calls.length = 0
  photoUpdates.length = 0
  boards.clear()
  photos.clear()
  boards.set(BOARD_A, board(BOARD_A, USER_A))
  boards.set(BOARD_B, board(BOARD_B, USER_B, { room: 'office' }))
  photos.set(PHOTO_A, photo(PHOTO_A, USER_A))
  photos.set(PHOTO_B, photo(PHOTO_B, USER_B))
})

const call = async (method, path = '', body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

let keyCounter = 0
const newKey = () => `idem-key-${(++keyCounter).toString().padStart(4, '0')}`

const create = (overrides = {}) => call('POST', '', {
  boardId: BOARD_A,
  roomPhotoId: PHOTO_A,
  idempotencyKey: newKey(),
  ...overrides,
})

/* ═══════════════ Authentication and the feature flag ═══════════════ */

test('every route requires a signed-in user and touches nothing without one', async () => {
  const id = 'cccccccccccccccccccccccc'
  assert.equal((await create()).status, 401)
  assert.equal((await call('GET')).status, 401)
  assert.equal((await call('GET', `/${id}`)).status, 401)
  assert.equal((await call('GET', `/${id}/image`)).status, 401)
  assert.equal((await call('DELETE', `/${id}`)).status, 401)
  assert.deepEqual(Generation.calls, [])
})

test('creation is refused while the feature is off; history stays readable', async () => {
  as(USER_A)
  featureEnabled = false

  const refused = await create()
  assert.deepEqual([refused.status, refused.body.code], [503, 'FEATURE_DISABLED'])
  assert.equal(Generation.docs.size, 0)

  assert.equal((await call('GET')).status, 200)
})

/* ═══════════════ Creation ═══════════════ */

test('a valid request is queued (202) with a server-built snapshot and no result', async () => {
  as(USER_A)
  const key = newKey()
  const { status, body } = await call('POST', '', { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: key })

  assert.equal(status, 202, JSON.stringify(body))
  assert.equal(body.generation.status, 'queued')
  assert.equal(body.generation.hasResult, false)
  assert.equal(body.generation.errorCode, null)
  assert.equal(body.generation.completedAt, null)
  assert.equal(body.generation.boardId, BOARD_A)
  assert.equal(body.generation.roomPhotoId, PHOTO_A)
  // The snapshot the client can see is the board it owns, as stored.
  assert.deepEqual(body.generation.board, {
    room: 'living-room',
    style: 'warm',
    wall: { label: 'Warm Sand', color: '#e8ddd0' },
    floor: { label: 'Dark Oak', color: '#4a3728' },
    materials: [{ name: 'Aged Brass', color: '#b08d57' }],
    lighting: 'night',
  })

  const stored = Generation.docs.get(String(body.generation._id))
  assert.equal(String(stored.user), USER_A._id)
  assert.equal(stored.promptVersion, 'room-restyle-v1')
  assert.equal(stored.idempotencyKey, key)
  assert.equal(stored.result, null)
  assert.equal(stored.attempts, 0)
  const days = (new Date(stored.expiresAt) - new Date(stored.createdAt)) / 86_400_000
  assert.ok(Math.abs(days - DESIGN_GENERATION_RETENTION_DAYS) < 0.1, `retention was ${days} days`)
})

test('the response and the record never carry storage identity or prompt text', async () => {
  as(USER_A)
  const { body } = await create()
  const serialized = JSON.stringify(body)
  for (const leak of ['publicId', 'cloudinary', 'deliveryType', 'leaseUntil', 'attempts', 'prompt', 'retryable', 'idempotencyKey']) {
    assert.equal(serialized.includes(leak), false, `the response exposes ${leak}`)
  }
  const stored = Generation.docs.get(String(body.generation._id))
  assert.equal('prompt' in stored, false, 'prompt text was stored')
})

test('the client cannot supply the owner, the snapshot, the status or a result', async () => {
  as(USER_A)
  const { status, body } = await call('POST', '', {
    boardId: BOARD_A,
    roomPhotoId: PHOTO_A,
    idempotencyKey: newKey(),
    user: USER_B._id,
    status: 'succeeded',
    boardSnapshot: { room: 'office', style: 'classic', wall: { label: 'Hacked', color: '#000000' }, floor: { label: 'Hacked', color: '#000000' }, materials: [], lighting: 'day' },
    result: { publicId: 'varlikent/anything', deliveryType: 'upload', format: 'jpg', width: 10, height: 10, bytes: 10 },
    promptVersion: 'attacker-v9',
    attempts: 99,
  })

  assert.equal(status, 202)
  const stored = Generation.docs.get(String(body.generation._id))
  assert.equal(String(stored.user), USER_A._id, 'the owner came from the request')
  assert.equal(stored.status, 'queued')
  assert.equal(stored.result, null)
  assert.equal(stored.promptVersion, 'room-restyle-v1')
  assert.equal(stored.attempts, 0)
  // The snapshot is the stored board, not what was sent.
  assert.equal(stored.boardSnapshot.room, 'living-room')
  assert.equal(stored.boardSnapshot.wall.label, 'Warm Sand')
})

test('another user’s board or room photo cannot be used, and says only "not found"', async () => {
  as(USER_A)
  const otherBoard = await create({ boardId: BOARD_B })
  assert.deepEqual([otherBoard.status, otherBoard.body.code], [404, 'BOARD_NOT_FOUND'])

  const otherPhoto = await create({ roomPhotoId: PHOTO_B })
  assert.deepEqual([otherPhoto.status, otherPhoto.body.code], [404, 'ROOM_PHOTO_NOT_FOUND'])

  // Exactly the same answers for ids that exist for nobody.
  const missingBoard = await create({ boardId: '11cccccccccccccccccccccc' })
  assert.deepEqual([missingBoard.status, missingBoard.body.code], [404, 'BOARD_NOT_FOUND'])
  assert.equal(Generation.docs.size, 0)
})

test('malformed ids and keys are rejected before any lookup', async () => {
  as(USER_A)
  for (const body of [
    { boardId: 'not-an-id', roomPhotoId: PHOTO_A, idempotencyKey: newKey() },
    { boardId: BOARD_A, roomPhotoId: 'nope', idempotencyKey: newKey() },
    { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: 'short' },
    { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: 'has spaces and is long enough' },
    { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: 'x'.repeat(65) },
    { boardId: BOARD_A, roomPhotoId: PHOTO_A },
    {},
  ]) {
    const response = await call('POST', '', body)
    assert.deepEqual([response.status, response.body.code], [400, 'INVALID_REQUEST'], JSON.stringify(body))
  }
  assert.equal(Generation.docs.size, 0)
})

test('a room photo that is not ready cannot be used', async () => {
  as(USER_A)
  for (const status of ['uploading', 'deleted']) {
    photos.set(PHOTO_A, photo(PHOTO_A, USER_A, { status }))
    const response = await create()
    assert.deepEqual([response.status, response.body.code], [404, 'ROOM_PHOTO_NOT_FOUND'], status)
  }

  photos.set(PHOTO_A, photo(PHOTO_A, USER_A, { expiresAt: new Date(Date.now() - 1000) }))
  const expired = await create()
  assert.deepEqual([expired.status, expired.body.code], [409, 'ROOM_PHOTO_EXPIRED'])
  assert.equal(Generation.docs.size, 0)
})

test('creating a generation extends the source photo’s life without shortening it', async () => {
  as(USER_A)
  // A photo close to expiry is held for the job window.
  photos.set(PHOTO_A, photo(PHOTO_A, USER_A, { expiresAt: new Date(Date.now() + 60_000) }))
  await create()

  const held = photos.get(PHOTO_A).expiresAt.getTime() - Date.now()
  assert.ok(Math.abs(held - DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS) < 5000, `held for ${held}ms`)
  assert.deepEqual(Object.keys(photoUpdates[0].update), ['$max'], 'the photo expiry was overwritten rather than extended')

  // A photo that already lives longer keeps its own date.
  const far = new Date(Date.now() + 25 * 86_400_000)
  photos.set(PHOTO_A, photo(PHOTO_A, USER_A, { expiresAt: far }))
  await create()
  assert.equal(photos.get(PHOTO_A).expiresAt.getTime(), far.getTime())
})

/* ═══════════════ Idempotency ═══════════════ */

test('the same key from the same user returns the first generation instead of a second', async () => {
  as(USER_A)
  const key = newKey()
  const first = await call('POST', '', { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: key })
  const retry = await call('POST', '', { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: key })

  assert.equal(first.status, 202)
  assert.equal(retry.status, 200)
  assert.equal(retry.body.generation._id, first.body.generation._id)
  assert.equal(Generation.docs.size, 1)
})

test('reusing a key for different inputs is a conflict, not a silent replay', async () => {
  as(USER_A)
  const key = newKey()
  await call('POST', '', { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: key })

  const photoTwo = '22cccccccccccccccccccccc'
  photos.set(photoTwo, photo(photoTwo, USER_A))
  const reused = await call('POST', '', { boardId: BOARD_A, roomPhotoId: photoTwo, idempotencyKey: key })

  assert.deepEqual([reused.status, reused.body.code], [409, 'IDEMPOTENCY_KEY_REUSED'])
  assert.equal(Generation.docs.size, 1)
})

test('the same key used by two different users never collides', async () => {
  const key = newKey()
  as(USER_A)
  const mine = await call('POST', '', { boardId: BOARD_A, roomPhotoId: PHOTO_A, idempotencyKey: key })
  as(USER_B)
  const theirs = await call('POST', '', { boardId: BOARD_B, roomPhotoId: PHOTO_B, idempotencyKey: key })

  assert.equal(mine.status, 202)
  assert.equal(theirs.status, 202)
  assert.notEqual(mine.body.generation._id, theirs.body.generation._id)
  assert.equal(Generation.docs.size, 2)
})

/* ═══════════════ Limits ═══════════════ */

test(`a user may hold ${DESIGN_GENERATION_MAX_ACTIVE_PER_USER} unfinished visualizations; others are unaffected`, async () => {
  as(USER_A)
  for (let i = 0; i < DESIGN_GENERATION_MAX_ACTIVE_PER_USER; i += 1) {
    assert.equal((await create()).status, 202)
  }

  const blocked = await create()
  assert.deepEqual([blocked.status, blocked.body.code], [429, 'GENERATION_ACTIVE_LIMIT'])

  as(USER_B)
  assert.equal((await call('POST', '', { boardId: BOARD_B, roomPhotoId: PHOTO_B, idempotencyKey: newKey() })).status, 202)
})

test('deleted visualizations still count toward the daily limit', async () => {
  as(USER_A)
  for (let i = 0; i < DESIGN_GENERATION_MAX_PER_DAY; i += 1) {
    Generation.seed({ user: USER_A._id, board: BOARD_A, roomPhoto: PHOTO_A, status: 'deleted', deletedAt: new Date(), purgedAt: new Date(), idempotencyKey: newKey(), promptVersion: 'v', boardSnapshot: {}, expiresAt: new Date() })
  }
  const blocked = await create()
  assert.deepEqual([blocked.status, blocked.body.code], [429, 'GENERATION_DAILY_LIMIT'])
})

/* ═══════════════ History ═══════════════ */

const seedFor = (user, overrides = {}) => Generation.seed({
  user: user._id,
  board: BOARD_A,
  boardSnapshot: {
    version: 1, room: 'bedroom', style: 'coastal',
    wall: { label: 'Chalk', color: '#f4f1ea' }, floor: { label: 'Oak', color: '#8a6240' },
    materials: [], lighting: 'day',
  },
  roomPhoto: PHOTO_A,
  status: 'queued',
  promptVersion: 'room-restyle-v1',
  idempotencyKey: newKey(),
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
})

test('history is this user’s only, newest first, paginated, without deleted entries', async () => {
  const mine = []
  for (let i = 0; i < 3; i += 1) {
    mine.push(seedFor(USER_A, { createdAt: new Date(Date.now() - (3 - i) * 60_000) }))
  }
  seedFor(USER_A, { status: 'deleted', deletedAt: new Date() })
  seedFor(USER_B)

  as(USER_A)
  const page1 = await call('GET', '?limit=2')
  assert.equal(page1.status, 200)
  assert.deepEqual(page1.body.generations.map((g) => g._id), [mine[2]._id, mine[1]._id])
  assert.deepEqual([page1.body.page, page1.body.limit, page1.body.total, page1.body.hasMore], [1, 2, 3, true])

  const page2 = await call('GET', '?page=2&limit=2')
  assert.deepEqual(page2.body.generations.map((g) => g._id), [mine[0]._id])
  assert.equal(page2.body.hasMore, false)

  // Bad paging values fall back to the safe defaults rather than erroring.
  const odd = await call('GET', '?page=-4&limit=9999')
  assert.equal(odd.status, 200)
  assert.equal(odd.body.page, 1)
  assert.ok(odd.body.limit <= 50)

  as(USER_B)
  assert.equal((await call('GET')).body.total, 1)
})

test('history items carry only display data', async () => {
  const seeded = seedFor(USER_A, { status: 'failed', error: { code: 'NOT_PROCESSED_IN_TIME', retryable: false }, completedAt: new Date() })
  as(USER_A)
  const { body } = await call('GET')
  const [item] = body.generations

  assert.deepEqual(Object.keys(item).sort(), [
    '_id', 'board', 'boardId', 'completedAt', 'createdAt', 'errorCode', 'expiresAt', 'hasResult', 'roomPhotoId', 'startedAt', 'status',
  ])
  assert.equal(item.errorCode, 'NOT_PROCESSED_IN_TIME')
  assert.equal(item.hasResult, false)
  assert.equal(item._id, seeded._id)
})

test('one visualization is readable by its owner only', async () => {
  const mine = seedFor(USER_A)
  as(USER_A)
  assert.equal((await call('GET', `/${mine._id}`)).status, 200)

  as(USER_B)
  const other = await call('GET', `/${mine._id}`)
  assert.equal(other.status, 404)
  assert.deepEqual(other.body, { success: false, code: 'GENERATION_NOT_FOUND', message: 'Visualization not found' })

  // A malformed id answers identically and never reaches the database.
  Generation.calls.length = 0
  assert.equal((await call('GET', '/not-an-id')).status, 404)
  assert.deepEqual(Generation.calls, [])
})

/* ═══════════════ The generated image ═══════════════ */

const RESULT = { publicId: 'varlikent/test/design-generations/x', deliveryType: 'authenticated', format: 'jpg', width: 1024, height: 768, bytes: 4 }

const image = async (path) => {
  const response = await fetch(baseUrl + path)
  return { status: response.status, response }
}

test('a succeeded generation streams its image to its owner, privately', async () => {
  const mine = seedFor(USER_A, { status: 'succeeded', result: RESULT, completedAt: new Date() })
  as(USER_A)

  const { response } = await image(`/${mine._id}/image`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(resultStorage.bytes))

  // The stored result's own identity was used; nothing about it was returned.
  assert.deepEqual(resultStorage.opens[0], { publicId: RESULT.publicId, options: { deliveryType: 'authenticated', format: 'jpg' } })
})

test('user B cannot fetch user A’s image, and storage is never contacted for them', async () => {
  const mine = seedFor(USER_A, { status: 'succeeded', result: RESULT, completedAt: new Date() })
  as(USER_B)

  const { response } = await image(`/${mine._id}/image`)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { success: false, code: 'GENERATION_NOT_FOUND', message: 'Visualization not found' })
  assert.deepEqual(resultStorage.opens, [])
})

test('only a succeeded generation WITH a result has an image', async () => {
  as(USER_A)
  const cases = [
    seedFor(USER_A, { status: 'queued' }),
    seedFor(USER_A, { status: 'processing', attempts: 1 }),
    seedFor(USER_A, { status: 'failed', error: { code: 'PROVIDER_FAILED' } }),
    // Succeeded but with no stored asset: impossible through the worker, and
    // still refused here rather than half-served.
    seedFor(USER_A, { status: 'succeeded', result: null }),
    seedFor(USER_A, { status: 'deleted', deletedAt: new Date(), result: RESULT }),
  ]

  for (const generation of cases) {
    assert.equal((await image(`/${generation._id}/image`)).status, 404, generation.status)
  }
  assert.deepEqual(resultStorage.opens, [])
})

test('a malformed id never reaches the database or storage', async () => {
  as(USER_A)
  Generation.calls.length = 0
  assert.equal((await image('/not-an-id/image')).status, 404)
  assert.deepEqual(Generation.calls, [])
  assert.deepEqual(resultStorage.opens, [])
})

test('a storage outage is a 502 that leaks nothing', async () => {
  const mine = seedFor(USER_A, { status: 'succeeded', result: RESULT, completedAt: new Date() })
  as(USER_A)
  resultStorage.failure = new Error('signed https://res.cloudinary.com/x?sig=SECRET failed')

  const { response } = await image(`/${mine._id}/image`)
  assert.equal(response.status, 502)
  const text = await response.text()
  assert.equal(/cloudinary|sig=|SECRET/i.test(text), false)
})

test('the history DTO says a result exists without revealing anything about it', async () => {
  seedFor(USER_A, { status: 'succeeded', result: RESULT, completedAt: new Date() })
  as(USER_A)

  const { body } = await call('GET')
  const [item] = body.generations
  assert.equal(item.hasResult, true)
  assert.equal(item.status, 'succeeded')
  const serialized = JSON.stringify(item)
  for (const leak of ['publicId', 'deliveryType', 'design-generations', 'cloudinary', 'varlikent/']) {
    assert.equal(serialized.includes(leak), false, `the DTO exposes ${leak}`)
  }
})

/* ═══════════════ Deletion ═══════════════ */

test('deleting hides a visualization at once and leaves the room photo alone', async () => {
  const mine = seedFor(USER_A)
  as(USER_A)

  assert.equal((await call('DELETE', `/${mine._id}`)).status, 200)
  const stored = Generation.docs.get(mine._id)
  assert.equal(stored.status, 'deleted')
  assert.ok(stored.deletedAt)
  // Phase 1 has no result asset, so the record is purged immediately.
  assert.ok(stored.purgedAt)

  assert.equal((await call('GET', `/${mine._id}`)).status, 404)
  assert.equal((await call('DELETE', `/${mine._id}`)).status, 404)
  assert.deepEqual((await call('GET')).body.generations, [])

  // The source photo is untouched: it is its own entity.
  assert.equal(photos.get(PHOTO_A).status, 'ready')
  assert.deepEqual(photoUpdates, [])
})

test('user B cannot delete user A’s visualization', async () => {
  const mine = seedFor(USER_A)
  as(USER_B)
  assert.equal((await call('DELETE', `/${mine._id}`)).status, 404)
  assert.equal(Generation.docs.get(mine._id).status, 'queued')
})
