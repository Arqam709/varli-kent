// Private storage for generated visualizations: what reaches Cloudinary, and
// what never reaches a client.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const cloudinaryCalls = []
let uploadResult = null
let uploadError = null
let destroyResult = { result: 'ok' }
let destroyThrows = null

mock.module('../config/cloudinary.js', {
  defaultExport: {
    uploader: {
      upload_stream: (options, callback) => {
        cloudinaryCalls.push({ method: 'upload_stream', options })
        return {
          end: (buffer) => {
            cloudinaryCalls.push({ method: 'end', bytes: buffer.length })
            queueMicrotask(() => callback(uploadError, uploadError ? undefined : uploadResult))
          },
        }
      },
      destroy: async (publicId, options) => {
        cloudinaryCalls.push({ method: 'destroy', publicId, options })
        if (destroyThrows) throw destroyThrows
        return destroyResult
      },
    },
    url: (publicId, options) => {
      cloudinaryCalls.push({ method: 'url', publicId, options })
      return `https://res.cloudinary.test/signed/${publicId}.${options.format}?sig=SECRET`
    },
  },
})

const storage = await import('../services/designGenerations/resultStorage.js')

const ID = '64b7f0c2a1b2c3d4e5f60718'

beforeEach(() => {
  cloudinaryCalls.length = 0
  uploadError = null
  uploadResult = { public_id: `varlikent/test/design-generations/${ID}`, bytes: 3, format: 'jpg', secure_url: 'https://should-not-leak' }
  destroyResult = { result: 'ok' }
  destroyThrows = null
})

/* ═══════════════ Identity ═══════════════ */

test('a result lives under its own generation id, apart from room photos', () => {
  const path = storage.designGenerationResultPublicId(ID, { VARLIKENT_ENV: 'production' })
  assert.equal(path, `varlikent/production/design-generations/${ID}`)
  assert.equal(path.includes('design-room-photos'), false, 'a result shares the room-photo path')
  assert.equal(storage.designGenerationResultPublicId(ID, {}), `varlikent/development/design-generations/${ID}`)
})

test('a result path can only be built from a generation ObjectId', () => {
  for (const bad of ['', 'ada@example.com', 'living-room.jpg', '../../etc', `${ID}/x`]) {
    assert.throws(() => storage.designGenerationResultPublicId(bad, {}))
  }
})

/* ═══════════════ Upload ═══════════════ */

test('results are uploaded privately, without overwriting, as JPEG only', async () => {
  const publicId = storage.designGenerationResultPublicId(ID, { VARLIKENT_ENV: 'test' })
  const result = await storage.uploadGenerationResult(publicId, Buffer.from([1, 2, 3]))

  const [{ options }] = cloudinaryCalls
  assert.equal(options.public_id, publicId)
  assert.equal(options.type, 'authenticated')
  assert.equal(options.overwrite, false)
  assert.equal(options.resource_type, 'image')
  assert.deepEqual(options.allowed_formats, ['jpg'])
  assert.deepEqual(options.tags, ['design-generation-result'])
  assert.equal('folder' in options, false)

  // The storage layer hands back identity, never a URL.
  assert.deepEqual(result, { publicId, bytes: 3, format: 'jpg' })
})

test('upload failures are reported without Cloudinary’s own message', async () => {
  uploadError = { message: 'Invalid Signature abc123 for api_key 999', http_code: 401 }
  await assert.rejects(storage.uploadGenerationResult('p', Buffer.from([1])), (error) => {
    assert.ok(error instanceof storage.ResultStorageError)
    assert.equal(error.message.includes('api_key'), false)
    return true
  })

  uploadError = null
  uploadResult = { ...uploadResult, existing: true }
  await assert.rejects(storage.uploadGenerationResult('p', Buffer.from([1])), storage.ResultStorageError)
})

/* ═══════════════ Destroy ═══════════════ */

test('destroy targets the authenticated result and invalidates caches', async () => {
  assert.equal(await storage.destroyGenerationResultAsset(`varlikent/test/design-generations/${ID}`), true)
  assert.deepEqual(cloudinaryCalls[0].options, { resource_type: 'image', type: 'authenticated', invalidate: true })
})

test('an already-missing result counts as destroyed; anything else is retryable', async () => {
  destroyResult = { result: 'not found' }
  assert.equal(await storage.destroyGenerationResultAsset('p'), true)

  destroyResult = { result: 'error' }
  await assert.rejects(storage.destroyGenerationResultAsset('p'), storage.ResultStorageError)

  destroyThrows = new Error('network')
  await assert.rejects(storage.destroyGenerationResultAsset('p'), storage.ResultStorageError)
})

/* ═══════════════ Delivery ═══════════════ */

test('delivery signs a URL server-side and returns only a stream', async (t) => {
  const fetched = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetched.push(url)
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-length': '3' } })
  })

  const image = await storage.openGenerationResultStream(`varlikent/test/design-generations/${ID}`)

  assert.deepEqual(cloudinaryCalls[0].options, { resource_type: 'image', type: 'authenticated', format: 'jpg', sign_url: true, secure: true })
  assert.equal(fetched.length, 1)
  assert.deepEqual(Object.keys(image).sort(), ['contentLength', 'stream'], 'the signed URL escaped the storage layer')

  const chunks = []
  for await (const chunk of image.stream) chunks.push(chunk)
  assert.deepEqual([...Buffer.concat(chunks)], [0xff, 0xd8, 0xff])
})

test('delivery failures carry neither the signed URL nor the signature', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }))
  await assert.rejects(storage.openGenerationResultStream('p'), (error) => {
    assert.equal(error.notFound, true)
    assert.equal(/sig=|https?:/.test(error.message), false)
    return true
  })
})
