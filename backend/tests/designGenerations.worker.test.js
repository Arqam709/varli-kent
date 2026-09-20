// The generation worker: one claimed job from queued to a stored result, and
// every way that can fail.
//
// The provider and Cloudinary are stand-ins — no paid API is ever called from
// the test suite — but the state machine, the prompt builder and the real
// sharp pipeline run for real.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { createFakeDesignGenerationModel } from './helpers/fakeDesignGenerationModel.js'
import { DESIGN_GENERATION_MAX_ATTEMPTS } from '../config/designGenerations.js'

const Generation = createFakeDesignGenerationModel()
mock.module('../models/DesignGeneration.js', { defaultExport: Generation })

/* ── The source room photo ─────────────────────────────────────────────── */

const photos = new Map()
mock.module('../models/DesignRoomPhoto.js', {
  defaultExport: {
    findOne: async (filter) => {
      const photo = photos.get(String(filter._id))
      if (!photo) return null
      if (String(photo.user) !== String(filter.user)) return null
      if (filter.status && photo.status !== filter.status) return null
      return structuredClone(photo)
    },
  },
})

const roomPhotoReads = []
let sourceBytes = null
let sourceFailure = null

mock.module('../services/designRoomPhotos/storage.js', {
  namedExports: {
    readRoomPhotoBuffer: async (publicId, options) => {
      roomPhotoReads.push({ publicId, options })
      if (sourceFailure) throw sourceFailure
      return sourceBytes
    },
  },
})

/* ── The provider ──────────────────────────────────────────────────────── */

const providerCalls = []
let providerResult = null
let providerFailure = null

mock.module('../services/designGenerations/providers/index.js', {
  namedExports: {
    // The real ProviderError, so classification is genuinely exercised.
    ProviderError: (await import('../services/designGenerations/providers/providerError.js')).ProviderError,
    isProviderConfigured: () => true,
    providerName: () => 'test',
    editRoomImage: async (input) => {
      providerCalls.push(input)
      if (providerFailure) throw providerFailure
      return providerResult
    },
  },
})

/* ── Result storage ────────────────────────────────────────────────────── */

const uploads = []
const destroys = []
let uploadFailure = null
let destroyFailure = null

mock.module('../services/designGenerations/resultStorage.js', {
  namedExports: {
    RESULT_FORMAT: 'jpg',
    RESULT_CONTENT_TYPE: 'image/jpeg',
    designGenerationResultPublicId: (id) => `varlikent/test/design-generations/${id}`,
    uploadGenerationResult: async (publicId, buffer) => {
      uploads.push({ publicId, buffer })
      if (uploadFailure) throw uploadFailure
      return { publicId, bytes: buffer.length, format: 'jpg' }
    },
    destroyGenerationResultAsset: async (publicId) => {
      destroys.push(publicId)
      if (destroyFailure) throw destroyFailure
      return true
    },
  },
})

const { ProviderError } = await import('../services/designGenerations/providers/providerError.js')
const worker = await import('../services/designGenerations/worker.js')
const state = await import('../services/designGenerations/generationState.js')

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PHOTO = '22aaaaaaaaaaaaaaaaaaaaaa'
let counter = 0

const roomImage = (width = 1600, height = 1200) => sharp({
  create: { width, height, channels: 3, background: { r: 170, g: 140, b: 100 } },
}).jpeg().toBuffer()

const seedGeneration = (overrides = {}) => Generation.seed({
  user: USER,
  board: '11aaaaaaaaaaaaaaaaaaaaaa',
  boardSnapshot: {
    version: 1, room: 'living-room', style: 'warm',
    wall: { label: 'Warm Sand', color: '#e8ddd0' },
    floor: { label: 'Dark Oak', color: '#4a3728' },
    materials: [{ name: 'Aged Brass', color: '#b08d57' }],
    lighting: 'night',
  },
  roomPhoto: PHOTO,
  status: 'processing',
  attempts: 1,
  leaseUntil: new Date(Date.now() + 60_000),
  promptVersion: 'room-restyle-v1',
  idempotencyKey: `worker-key-${(counter += 1).toString().padStart(4, '0')}`,
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
})

const stored = (generation) => Generation.docs.get(generation._id)

beforeEach(async () => {
  Generation.docs.clear()
  Generation.calls.length = 0
  photos.clear()
  photos.set(PHOTO, {
    _id: PHOTO, user: USER, status: 'ready',
    width: 2048, height: 1536,
    asset: { publicId: 'varlikent/test/design-room-photos/x', deliveryType: 'authenticated', format: 'jpg' },
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  roomPhotoReads.length = 0
  providerCalls.length = 0
  uploads.length = 0
  destroys.length = 0
  sourceFailure = null
  providerFailure = null
  uploadFailure = null
  destroyFailure = null
  sourceBytes = await roomImage()
  providerResult = { buffer: await roomImage(1024, 768), mimeType: 'image/png', model: 'test-model' }
})

/* ═══════════════ The happy path ═══════════════ */

test('a claimed job becomes a stored private result and succeeds', async () => {
  const generation = seedGeneration()
  assert.equal(await worker.processGeneration(stored(generation)), 'succeeded')

  // The source photo was read privately, server-side, by its storage id.
  assert.equal(roomPhotoReads.length, 1)
  assert.equal(roomPhotoReads[0].publicId, 'varlikent/test/design-room-photos/x')
  assert.ok(roomPhotoReads[0].options.maxBytes > 0, 'the read is not bounded')

  // The provider got the photo bytes and a server-built prompt.
  assert.equal(providerCalls.length, 1)
  const [call] = providerCalls
  assert.ok(Buffer.isBuffer(call.imageBuffer))
  assert.match(call.prompt, /Redesign the living room/)
  assert.match(call.prompt, /Warm Sand/)
  assert.match(call.prompt, /Keep the camera position/)

  // The result is a NEW asset under the generation's own id.
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].publicId, `varlikent/test/design-generations/${generation._id}`)
  assert.notEqual(uploads[0].publicId, 'varlikent/test/design-room-photos/x')

  // It was normalized: JPEG, within the delivery ceiling, metadata gone.
  const meta = await sharp(uploads[0].buffer).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.ok(meta.width <= 2048 && meta.height <= 2048)
  assert.equal(meta.exif, undefined)

  const record = stored(generation)
  assert.equal(record.status, 'succeeded')
  assert.ok(record.completedAt)
  assert.equal(record.leaseUntil, null)
  assert.equal(record.result.publicId, uploads[0].publicId)
  assert.equal(record.result.deliveryType, 'authenticated')
  assert.equal(record.result.format, 'jpg')
  assert.deepEqual([record.result.width, record.result.height], [meta.width, meta.height])
  assert.equal(record.result.bytes, uploads[0].buffer.length)
})

test('the original room photo is never written to', async () => {
  const generation = seedGeneration()
  await worker.processGeneration(stored(generation))

  const photo = photos.get(PHOTO)
  assert.equal(photo.status, 'ready')
  assert.equal(photo.asset.publicId, 'varlikent/test/design-room-photos/x')
  assert.equal(uploads.some((upload) => upload.publicId.includes('design-room-photos')), false)
  assert.deepEqual(destroys, [])
})

/* ═══════════════ Source photo problems ═══════════════ */

test('a missing, not-ready or expired source photo fails the job for good', async () => {
  for (const mutate of [
    () => photos.delete(PHOTO),
    () => { photos.get(PHOTO).status = 'deleted' },
    () => { photos.get(PHOTO).expiresAt = new Date(Date.now() - 1000) },
    () => { photos.get(PHOTO).user = 'bbbbbbbbbbbbbbbbbbbbbbbb' },
  ]) {
    Generation.docs.clear()
    photos.set(PHOTO, {
      _id: PHOTO, user: USER, status: 'ready', width: 2048, height: 1536,
      asset: { publicId: 'varlikent/test/design-room-photos/x', deliveryType: 'authenticated', format: 'jpg' },
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    mutate()

    const generation = seedGeneration()
    assert.equal(await worker.processGeneration(stored(generation)), 'failed')
    assert.equal(stored(generation).status, 'failed')
    assert.equal(stored(generation).error.code, 'SOURCE_PHOTO_UNAVAILABLE')
  }
  assert.deepEqual(providerCalls, [], 'the provider was called without a usable photo')
})

test('storage being unreachable is retryable: the job goes back to the queue', async () => {
  sourceFailure = new Error('cloudinary unreachable')
  const generation = seedGeneration({ attempts: 1 })

  assert.equal(await worker.processGeneration(stored(generation)), 'failed')
  assert.equal(stored(generation).status, 'queued', 'a transient read failure ended the job')
  assert.equal(stored(generation).error.code, 'SOURCE_PHOTO_UNAVAILABLE')
})

/* ═══════════════ Provider outcomes ═══════════════ */

test('a timeout is retryable; content rejection and invalid output are not', async () => {
  const cases = [
    [new ProviderError('PROVIDER_TIMEOUT', { retryable: true }), 'queued', 'PROVIDER_TIMEOUT'],
    [new ProviderError('PROVIDER_FAILED', { retryable: true }), 'queued', 'PROVIDER_FAILED'],
    [new ProviderError('PROVIDER_REJECTED_CONTENT'), 'failed', 'PROVIDER_REJECTED_CONTENT'],
    [new ProviderError('PROVIDER_INVALID_IMAGE'), 'failed', 'PROVIDER_INVALID_IMAGE'],
  ]

  for (const [failure, expectedStatus, expectedCode] of cases) {
    providerFailure = failure
    const generation = seedGeneration({ attempts: 1 })
    assert.equal(await worker.processGeneration(stored(generation)), 'failed')
    assert.equal(stored(generation).status, expectedStatus, expectedCode)
    assert.equal(stored(generation).error.code, expectedCode)
    assert.equal(stored(generation).result, null, 'a failed job stored a result')
  }
  assert.deepEqual(uploads, [])
})

test('a retryable failure on the last attempt ends the job instead of looping', async () => {
  providerFailure = new ProviderError('PROVIDER_TIMEOUT', { retryable: true })
  const generation = seedGeneration({ attempts: DESIGN_GENERATION_MAX_ATTEMPTS })

  await worker.processGeneration(stored(generation))
  assert.equal(stored(generation).status, 'failed')
  assert.equal(stored(generation).error.code, 'PROVIDER_TIMEOUT')
})

test('an unexpected error is treated as a provider failure, never as success', async () => {
  providerFailure = new TypeError('something the adapter did not classify')
  const generation = seedGeneration()

  assert.equal(await worker.processGeneration(stored(generation)), 'failed')
  assert.equal(stored(generation).status, 'failed')
  assert.equal(stored(generation).error.code, 'PROVIDER_FAILED')
  assert.equal(stored(generation).result, null)
})

test('output that is not a usable image is rejected by the shared pipeline', async () => {
  for (const bytes of [Buffer.from('this is not an image'), Buffer.alloc(0), (await roomImage(1600, 1200)).subarray(0, 400)]) {
    providerResult = { buffer: bytes, mimeType: 'image/png' }
    const generation = seedGeneration()
    assert.equal(await worker.processGeneration(stored(generation)), 'failed')
    assert.equal(stored(generation).error.code, 'PROVIDER_INVALID_IMAGE')
  }
  assert.deepEqual(uploads, [], 'unusable output reached storage')
})

/* ═══════════════ Storage and completion failures ═══════════════ */

test('a result that cannot be stored is retryable and leaves nothing behind', async () => {
  uploadFailure = new Error('cloudinary down')
  const generation = seedGeneration({ attempts: 1 })

  assert.equal(await worker.processGeneration(stored(generation)), 'failed')
  assert.equal(stored(generation).status, 'queued')
  assert.equal(stored(generation).error.code, 'RESULT_STORAGE_FAILED')
  assert.equal(stored(generation).result, null)
})

test('if completion fails after upload, the orphaned image is destroyed', async () => {
  // The generation was deleted by its owner while the provider was working.
  const generation = seedGeneration()
  const original = state.completeGeneration
  const uploadedIds = []

  // Simulate the completion losing its race: mark the record deleted first.
  Generation.docs.get(generation._id).status = 'deleted'

  assert.equal(await worker.processGeneration({ ...stored(generation), status: 'processing' }), 'failed')

  assert.equal(uploads.length, 1, 'the provider result was never uploaded')
  uploadedIds.push(uploads[0].publicId)
  // The image that nothing points at was removed.
  assert.deepEqual(destroys, uploadedIds)
  assert.equal(stored(generation).status, 'deleted', 'the deleted record was revived')
  assert.equal(stored(generation).result, null)
  assert.equal(typeof original, 'function')
})

test('an orphan that cannot be destroyed is reported, not silently forgotten', async () => {
  destroyFailure = new Error('destroy failed')
  const generation = seedGeneration()
  Generation.docs.get(generation._id).status = 'deleted'

  const errors = []
  const originalError = console.error
  console.error = (message) => errors.push(String(message))
  try {
    await worker.processGeneration({ ...stored(generation), status: 'processing' })
  } finally {
    console.error = originalError
  }

  assert.ok(errors.some((message) => message.includes('orphaned result asset')), 'no warning was logged')
})

/* ═══════════════ The loop ═══════════════ */

test('the loop claims queued work, runs it, and stops when the queue is empty', async () => {
  const queued = Generation.seed({
    user: USER, board: '11aaaaaaaaaaaaaaaaaaaaaa',
    boardSnapshot: {
      version: 1, room: 'kitchen', style: 'coastal',
      wall: { label: 'Chalk', color: '#f4f1ea' }, floor: { label: 'Oak', color: '#8a6240' },
      materials: [], lighting: 'day',
    },
    roomPhoto: PHOTO, status: 'queued', attempts: 0, promptVersion: 'room-restyle-v1',
    idempotencyKey: 'worker-loop-key-1', expiresAt: new Date(Date.now() + 86_400_000),
  })

  await worker.runGenerationWorkerOnce()
  // The job is claimed synchronously; its processing finishes right after.
  await new Promise((resolve) => setTimeout(resolve, 50))

  const record = stored(queued)
  assert.equal(record.status, 'succeeded')
  assert.equal(record.attempts, 1, 'the claim did not count exactly one attempt')
  assert.deepEqual(worker.workerLoad(), { active: 0, polling: false })
})

test('an empty queue does no work and touches no provider', async () => {
  await worker.runGenerationWorkerOnce()
  assert.deepEqual(providerCalls, [])
  assert.deepEqual(uploads, [])
})
