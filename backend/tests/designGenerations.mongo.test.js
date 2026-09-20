// Generations against a REAL MongoDB: real JWTs, the real `protect`, the real
// models and indexes, and the real claim/lease. This is the only place single
// document atomicity — two workers racing for one job — can actually be shown.
//
// Skipped unless DESIGN_GENERATIONS_TEST_MONGO_URI is set. Point it at a
// throwaway server only: the test creates and DROPS its own database.
// No provider is contacted here; none exists.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Readable } from 'node:stream'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import sharp from 'sharp'
import { DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS } from '../config/designGenerations.js'

const MONGO_URI = process.env.DESIGN_GENERATIONS_TEST_MONGO_URI
const skip = !MONGO_URI && 'DESIGN_GENERATIONS_TEST_MONGO_URI is not set'

// The feature flag is a site setting; this keeps it on for the whole run.
mock.module('../models/SiteSettings.js', {
  defaultExport: { findOne: () => ({ select: () => ({ lean: async () => ({ designGenerationsEnabled: true }) }) }) },
})

// The provider and both private stores are stand-ins — no paid API and no
// Cloudinary in the test suite. Everything else is real.
const sourceObjects = new Map()
const resultObjects = new Map()
const providerCalls = []
let providerFailure = null

mock.module('../services/designRoomPhotos/storage.js', {
  namedExports: {
    readRoomPhotoBuffer: async (publicId) => {
      const bytes = sourceObjects.get(publicId)
      if (!bytes) throw new Error('missing source object')
      return bytes
    },
    // Also used by the room-photo lifecycle, which this suite exercises when a
    // photo is deleted. Deleting the source must never remove a result.
    destroyRoomPhoto: async (publicId) => {
      sourceObjects.delete(publicId)
      return true
    },
    openRoomPhotoStream: async () => { throw new Error('not used in this suite') },
    uploadRoomPhoto: async () => { throw new Error('not used in this suite') },
    roomPhotoPublicId: (id) => `varlikent/integration/design-room-photos/${id}`,
    RoomPhotoStorageError: class RoomPhotoStorageError extends Error {},
  },
})

mock.module('../services/designGenerations/providers/index.js', {
  namedExports: {
    ProviderError: (await import('../services/designGenerations/providers/providerError.js')).ProviderError,
    isProviderConfigured: () => true,
    providerName: () => 'test',
    editRoomImage: async (input) => {
      providerCalls.push({ prompt: input.prompt, bytes: input.imageBuffer.length })
      if (providerFailure) throw providerFailure
      // A real, decodable image — the pipeline downstream is genuine.
      const generated = await sharp({ create: { width: 1024, height: 768, channels: 3, background: { r: 90, g: 120, b: 150 } } })
        .png()
        .toBuffer()
      return { buffer: generated, mimeType: 'image/png', model: 'test-model' }
    },
  },
})

mock.module('../services/designGenerations/resultStorage.js', {
  namedExports: {
    RESULT_FORMAT: 'jpg',
    RESULT_CONTENT_TYPE: 'image/jpeg',
    designGenerationResultPublicId: (id) => `varlikent/integration/design-generations/${id}`,
    uploadGenerationResult: async (publicId, buffer) => {
      resultObjects.set(publicId, buffer)
      return { publicId, bytes: buffer.length, format: 'jpg' }
    },
    destroyGenerationResultAsset: async (publicId) => {
      resultObjects.delete(publicId)
      return true
    },
    openGenerationResultStream: async (publicId) => {
      const bytes = resultObjects.get(publicId)
      if (!bytes) throw new Error('missing result object')
      return { stream: Readable.from([bytes]), contentLength: bytes.length }
    },
  },
})

const SECRET = 'design-generations-integration-secret'
let server
let baseUrl
let Generation
let Board
let Photo
let state
let lifecycle
let worker
let tokenA
let tokenB
let userA
let userB

before(async () => {
  if (skip) return
  process.env.JWT_SECRET = SECRET
  await mongoose.connect(MONGO_URI, { dbName: `varlikent_generations_test_${process.pid}_${Date.now()}` })

  const { default: User } = await import('../models/User.js')
  ;({ default: Generation } = await import('../models/DesignGeneration.js'))
  ;({ default: Board } = await import('../models/DesignBoard.js'))
  ;({ default: Photo } = await import('../models/DesignRoomPhoto.js'))
  state = await import('../services/designGenerations/generationState.js')
  lifecycle = await import('../services/designGenerations/lifecycle.js')
  worker = await import('../services/designGenerations/worker.js')
  const { default: routes } = await import('../routes/designGenerations.js')
  await Generation.syncIndexes()

  userA = await User.create({ name: 'Ada', email: 'ada@example.test', password: 'secret-a' })
  userB = await User.create({ name: 'Bo', email: 'bo@example.test', password: 'secret-b' })
  tokenA = jwt.sign({ id: userA._id }, SECRET)
  tokenB = jwt.sign({ id: userB._id }, SECRET)

  const app = express()
  app.use(express.json())
  app.use('/api/design-generations', routes)
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/design-generations`
})

after(async () => {
  if (skip) return
  await new Promise((resolve) => server.close(resolve))
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  if (skip) return
  await Generation.deleteMany({})
  providerCalls.length = 0
  providerFailure = null
  resultObjects.clear()
})

const send = (token, method, path = '', body) => fetch(baseUrl + path, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const makeBoard = (user) => Board.create({
  user: user._id,
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'night',
})

let photoCounter = 0
const makePhoto = async (user, overrides = {}) => {
  const publicId = `varlikent/integration/design-room-photos/gen-${photoCounter += 1}`
  sourceObjects.set(publicId, await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 180, b: 150 } } }).jpeg().toBuffer())
  return makePhotoRecord(user, publicId, overrides)
}

const makePhotoRecord = (user, publicId, overrides = {}) => Photo.create({
  user: user._id,
  asset: { publicId, deliveryType: 'authenticated', format: 'jpg' },
  width: 2048, height: 1536, bytes: 1000,
  status: 'ready',
  consentVersion: '2026-09-room-photo-v1',
  expiresAt: new Date(Date.now() + 30 * 86_400_000),
  ...overrides,
})

test('create → queued → owner reads history → user B shut out → delete', { skip }, async () => {
  const board = await makeBoard(userA)
  const photo = await makePhoto(userA)

  assert.equal((await send(null, 'POST', '', {})).status, 401)

  const created = await send(tokenA, 'POST', '', {
    boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'integration-key-1',
  })
  assert.equal(created.status, 202)
  const { generation } = await created.json()

  const raw = await mongoose.connection.db.collection('designgenerations').findOne({ _id: new mongoose.Types.ObjectId(generation._id) })
  assert.equal(String(raw.user), String(userA._id))
  assert.equal(raw.status, 'queued')
  assert.equal(raw.result, null)
  assert.equal(raw.boardSnapshot.wall.label, 'Warm Sand')
  assert.equal('prompt' in raw, false)

  assert.equal((await send(tokenA, 'GET', `/${generation._id}`)).status, 200)
  const history = await (await send(tokenA, 'GET')).json()
  assert.equal(history.total, 1)

  for (const [method, path] of [['GET', `/${generation._id}`], ['DELETE', `/${generation._id}`]]) {
    assert.equal((await send(tokenB, method, path)).status, 404, `${method} for user B`)
  }
  assert.deepEqual((await (await send(tokenB, 'GET')).json()).generations, [])

  assert.equal((await send(tokenA, 'DELETE', `/${generation._id}`)).status, 200)
  const deleted = await Generation.findById(generation._id).lean()
  assert.equal(deleted.status, 'deleted')
  assert.ok(deleted.purgedAt, 'with no result, deletion purges immediately')

  // The source photo is untouched and still usable.
  const sourcePhoto = await Photo.findById(photo._id).lean()
  assert.equal(sourcePhoto.status, 'ready')
})

test('creating holds the source photo, and the hold only ever extends it', { skip }, async () => {
  const board = await makeBoard(userA)
  const soon = new Date(Date.now() + 60_000)
  const photo = await makePhoto(userA, { expiresAt: soon })

  await send(tokenA, 'POST', '', { boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'integration-hold-1' })

  const held = await Photo.findById(photo._id).lean()
  const window = held.expiresAt.getTime() - Date.now()
  assert.ok(Math.abs(window - DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS) < 10_000, `held for ${window}ms`)

  // A photo that already outlives the hold keeps its own, longer date.
  const far = new Date(Date.now() + 25 * 86_400_000)
  const longLived = await makePhoto(userA, { expiresAt: far })
  await send(tokenA, 'POST', '', { boardId: String(board._id), roomPhotoId: String(longLived._id), idempotencyKey: 'integration-hold-2' })
  assert.equal((await Photo.findById(longLived._id).lean()).expiresAt.getTime(), far.getTime())
})

test('the unique (user, idempotencyKey) index is real and scoped per user', { skip }, async () => {
  const boardA = await makeBoard(userA)
  const photoA = await makePhoto(userA)
  const boardB = await makeBoard(userB)
  const photoB = await makePhoto(userB)
  const body = (board, photo) => ({ boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'shared-key-value' })

  const first = await send(tokenA, 'POST', '', body(boardA, photoA))
  const retry = await send(tokenA, 'POST', '', body(boardA, photoA))
  assert.equal(first.status, 202)
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).generation._id, (await first.json()).generation._id)

  // The same key for another user is a different generation entirely.
  assert.equal((await send(tokenB, 'POST', '', body(boardB, photoB))).status, 202)
  assert.equal(await Generation.countDocuments({}), 2)

  // And the index itself refuses a duplicate written directly.
  const existing = await Generation.findOne({ user: userA._id })
  await assert.rejects(Generation.create({ ...existing.toObject(), _id: new mongoose.Types.ObjectId() }), (err) => err.code === 11000)
})

test('two workers racing for one job: exactly one wins', { skip }, async () => {
  const board = await makeBoard(userA)
  const photo = await makePhoto(userA)
  await send(tokenA, 'POST', '', { boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'integration-claim-1' })

  const claims = await Promise.all(Array.from({ length: 5 }, () => state.claimNextGeneration()))
  const winners = claims.filter(Boolean)

  assert.equal(winners.length, 1, `${winners.length} workers claimed the same job`)
  assert.equal(winners[0].status, 'processing')
  assert.equal(winners[0].attempts, 1, 'the attempt was counted more than once')

  // While the lease holds, nobody else may take it.
  assert.equal(await state.claimNextGeneration(), null)
})

test('a crashed worker’s job is recovered, then given up on, and never silently succeeds', { skip }, async () => {
  const board = await makeBoard(userA)
  const photo = await makePhoto(userA)
  await send(tokenA, 'POST', '', { boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'integration-lease-1' })

  const claimed = await state.claimNextGeneration()
  // The worker dies: its lease simply runs out.
  await Generation.updateOne({ _id: claimed._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })

  const recovered = await lifecycle.sweepDesignGenerations()
  assert.equal(recovered.requeued, 1)
  assert.equal((await Generation.findById(claimed._id).lean()).status, 'queued')

  // Two more crashes exhaust the attempts, and it fails rather than looping.
  for (let i = 0; i < 2; i += 1) {
    const again = await state.claimNextGeneration()
    assert.ok(again, 'the job should be claimable while attempts remain')
    await Generation.updateOne({ _id: again._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })
    await lifecycle.sweepDesignGenerations()
  }

  const final = await Generation.findById(claimed._id).lean()
  assert.equal(final.status, 'failed')
  assert.equal(final.error.code, 'LEASE_EXPIRED')
  assert.equal(final.result, null, 'a failed generation must never hold a result')
})

test('deleting a room photo ends its unfinished jobs and spares finished history', { skip }, async () => {
  const board = await makeBoard(userA)
  const photo = await makePhoto(userA)
  const common = { user: userA._id, board: board._id, roomPhoto: photo._id, promptVersion: 'room-restyle-v0-placeholder', expiresAt: new Date(Date.now() + 86_400_000), boardSnapshot: { version: 1, room: 'living-room', style: 'warm', wall: { label: 'Sand', color: '#e8ddd0' }, floor: { label: 'Oak', color: '#4a3728' }, materials: [], lighting: 'day' } }

  const queued = await Generation.create({ ...common, status: 'queued', idempotencyKey: 'cascade-queued-1' })
  const succeeded = await Generation.create({
    ...common, status: 'succeeded', idempotencyKey: 'cascade-succeeded-1', completedAt: new Date(),
    result: { publicId: 'varlikent/integration/design-generations/x', deliveryType: 'authenticated', format: 'jpg', width: 1024, height: 768, bytes: 1000 },
  })

  const { releaseGenerationsForDeletedRoomPhoto } = await import('../services/designRoomPhotos/lifecycle.js')
  assert.equal(await releaseGenerationsForDeletedRoomPhoto(photo._id), 1)

  assert.equal((await Generation.findById(queued._id).lean()).error.code, 'SOURCE_PHOTO_UNAVAILABLE')
  assert.equal((await Generation.findById(queued._id).lean()).status, 'failed')
  // The finished one keeps its own result asset, which is not the room photo.
  const kept = await Generation.findById(succeeded._id).lean()
  assert.equal(kept.status, 'succeeded')
  assert.ok(kept.result.publicId)
})

test('end to end: queued → worker → provider → private result → succeeded → image', { skip }, async () => {
  const board = await makeBoard(userA)
  const photo = await makePhoto(userA)

  const created = await send(tokenA, 'POST', '', {
    boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'integration-e2e-1',
  })
  assert.equal(created.status, 202)
  const { generation } = await created.json()
  assert.equal(generation.status, 'queued')
  assert.equal(generation.hasResult, false)

  // No image exists yet, so there is nothing to serve.
  assert.equal((await send(tokenA, 'GET', `/${generation._id}/image`)).status, 404)

  // The worker claims it and runs it to completion.
  await worker.runGenerationWorkerOnce()
  await new Promise((resolve) => setTimeout(resolve, 200))

  // The provider was called once, with a server-built prompt.
  assert.equal(providerCalls.length, 1)
  assert.match(providerCalls[0].prompt, /Keep the camera position/)

  const stored = await Generation.findById(generation._id).lean()
  assert.equal(stored.status, 'succeeded')
  assert.equal(stored.attempts, 1)
  assert.equal(stored.leaseUntil, null)
  assert.ok(stored.completedAt)
  assert.equal(stored.result.publicId, `varlikent/integration/design-generations/${generation._id}`)
  assert.equal(stored.result.format, 'jpg')
  assert.ok(stored.result.width > 0 && stored.result.bytes > 0)

  // The result is a SEPARATE asset; the room photo is untouched.
  const sourcePhoto = await Photo.findById(photo._id).lean()
  assert.equal(sourcePhoto.status, 'ready')
  assert.equal(sourcePhoto.asset.publicId, photo.asset.publicId)
  assert.notEqual(stored.result.publicId, sourcePhoto.asset.publicId)
  assert.ok(sourceObjects.has(sourcePhoto.asset.publicId), 'the original image was destroyed')

  // The API says a result exists, without revealing anything about it.
  const detail = await (await send(tokenA, 'GET', `/${generation._id}`)).json()
  assert.equal(detail.generation.status, 'succeeded')
  assert.equal(detail.generation.hasResult, true)
  assert.equal(JSON.stringify(detail).includes('varlikent/'), false)

  // The owner can fetch the generated image; user B cannot.
  const imageResponse = await send(tokenA, 'GET', `/${generation._id}/image`)
  assert.equal(imageResponse.status, 200)
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg')
  const delivered = Buffer.from(await imageResponse.arrayBuffer())
  assert.ok(delivered.equals(resultObjects.get(stored.result.publicId)))
  const meta = await sharp(delivered).metadata()
  assert.equal(meta.format, 'jpeg')

  assert.equal((await send(tokenB, 'GET', `/${generation._id}/image`)).status, 404)
  assert.equal((await send(null, 'GET', `/${generation._id}/image`)).status, 401)

  // Deleting removes the generated image, and only that image.
  assert.equal((await send(tokenA, 'DELETE', `/${generation._id}`)).status, 200)
  const deleted = await Generation.findById(generation._id).lean()
  assert.equal(deleted.status, 'deleted')
  assert.ok(deleted.purgedAt, 'the result was not confirmed purged')
  assert.equal(resultObjects.has(stored.result.publicId), false, 'the generated image survived deletion')
  assert.ok(sourceObjects.has(sourcePhoto.asset.publicId), 'deleting a visualization deleted the room photo')
  assert.equal((await send(tokenA, 'GET', `/${generation._id}/image`)).status, 404)
})

test('a provider refusal ends as failed with no result and no stored image', { skip }, async () => {
  const { ProviderError } = await import('../services/designGenerations/providers/providerError.js')
  providerFailure = new ProviderError('PROVIDER_REJECTED_CONTENT')

  const board = await makeBoard(userA)
  const photo = await makePhoto(userA)
  const created = await send(tokenA, 'POST', '', {
    boardId: String(board._id), roomPhotoId: String(photo._id), idempotencyKey: 'integration-e2e-fail',
  })
  const { generation } = await created.json()

  await worker.runGenerationWorkerOnce()
  await new Promise((resolve) => setTimeout(resolve, 200))

  const stored = await Generation.findById(generation._id).lean()
  assert.equal(stored.status, 'failed')
  assert.equal(stored.error.code, 'PROVIDER_REJECTED_CONTENT')
  assert.equal(stored.result, null)
  assert.equal(resultObjects.size, 0)
  assert.equal((await send(tokenA, 'GET', `/${generation._id}/image`)).status, 404)
})
