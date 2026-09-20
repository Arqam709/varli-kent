// Room photo storage: exactly what is sent to Cloudinary, and what is not.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const cloudinaryCalls = []
let uploadResult = null
let uploadError = null
let destroyResult = { result: 'ok' }
let destroyThrows = null

const fakeCloudinary = {
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
}

mock.module('../config/cloudinary.js', { defaultExport: fakeCloudinary })

const storage = await import('../services/designRoomPhotos/storage.js')

const ID = '64b7f0c2a1b2c3d4e5f60718'

beforeEach(() => {
  cloudinaryCalls.length = 0
  uploadError = null
  uploadResult = { public_id: `varlikent/test/design-room-photos/${ID}`, bytes: 3, format: 'jpg', secure_url: 'https://should-not-leak' }
  destroyResult = { result: 'ok' }
  destroyThrows = null
})

/* ═══════════════ Identity ═══════════════ */

test('the public ID is environment-scoped and carries nothing but the record id', () => {
  assert.equal(storage.roomPhotoPublicId(ID, { VARLIKENT_ENV: 'production' }), `varlikent/production/design-room-photos/${ID}`)
  assert.equal(storage.roomPhotoPublicId(ID, { NODE_ENV: 'staging' }), `varlikent/staging/design-room-photos/${ID}`)
  assert.equal(storage.roomPhotoPublicId(ID, {}), `varlikent/development/design-room-photos/${ID}`)
  // VARLIKENT_ENV wins, and hostile values collapse to a safe segment.
  assert.equal(storage.roomPhotoPublicId(ID, { VARLIKENT_ENV: '../Prod Env/', NODE_ENV: 'x' }), `varlikent/prod-env/design-room-photos/${ID}`)
})

test('a public ID can only be built from a record ObjectId', () => {
  for (const bad of ['', 'alice@example.com', 'living-room.jpg', '../../etc', `${ID}/x`]) {
    assert.throws(() => storage.roomPhotoPublicId(bad, {}))
  }
})

/* ═══════════════ Upload ═══════════════ */

test('uploads are private (authenticated), non-overwriting images with no folder option', async () => {
  const publicId = storage.roomPhotoPublicId(ID, { VARLIKENT_ENV: 'test' })
  const result = await storage.uploadRoomPhoto(publicId, Buffer.from([1, 2, 3]))

  const [{ options }] = cloudinaryCalls
  assert.deepEqual(options, {
    public_id: publicId,
    resource_type: 'image',
    type: 'authenticated',
    overwrite: false,
    allowed_formats: ['jpg'],
    tags: ['design-room-photo'],
    timeout: 60000,
  })
  assert.equal('folder' in options, false)
  assert.deepEqual(cloudinaryCalls[1], { method: 'end', bytes: 3 })
  // Cloudinary's URL never makes it out of the storage layer.
  assert.deepEqual(result, { publicId, bytes: 3, format: 'jpg' })
})

test('an upload error is reported without Cloudinary’s own message', async () => {
  uploadError = { message: 'Invalid Signature 1a2b3c for api_key 123456', http_code: 401 }
  await assert.rejects(storage.uploadRoomPhoto('p', Buffer.from([1])), (err) => {
    assert.ok(err instanceof storage.RoomPhotoStorageError)
    assert.equal(err.message.includes('api_key'), false)
    return true
  })
})

test('an upload that hit an existing asset is a failure, not a success', async () => {
  uploadResult = { ...uploadResult, existing: true }
  await assert.rejects(storage.uploadRoomPhoto('p', Buffer.from([1])), storage.RoomPhotoStorageError)
})

/* ═══════════════ Destroy ═══════════════ */

test('destroy targets the authenticated image and invalidates CDN copies', async () => {
  assert.equal(await storage.destroyRoomPhoto('varlikent/test/design-room-photos/x'), true)
  assert.deepEqual(cloudinaryCalls[0], {
    method: 'destroy',
    publicId: 'varlikent/test/design-room-photos/x',
    options: { resource_type: 'image', type: 'authenticated', invalidate: true },
  })
})

test('an asset that is already gone counts as destroyed', async () => {
  destroyResult = { result: 'not found' }
  assert.equal(await storage.destroyRoomPhoto('p'), true)
})

test('any other destroy outcome is a failure the caller can retry', async () => {
  destroyResult = { result: 'error' }
  await assert.rejects(storage.destroyRoomPhoto('p'), storage.RoomPhotoStorageError)
  destroyThrows = new Error('network')
  await assert.rejects(storage.destroyRoomPhoto('p'), storage.RoomPhotoStorageError)
})

/* ═══════════════ Delivery ═══════════════ */

test('delivery signs a URL server-side, fetches it, and returns only a stream', async (t) => {
  const fetched = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetched.push(url)
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-length': '3' } })
  })

  const image = await storage.openRoomPhotoStream('varlikent/test/design-room-photos/x')

  assert.deepEqual(cloudinaryCalls[0].options, { resource_type: 'image', type: 'authenticated', format: 'jpg', sign_url: true, secure: true })
  assert.equal(fetched.length, 1)
  assert.deepEqual(Object.keys(image).sort(), ['contentLength', 'stream'], 'the signed URL escaped the storage layer')
  assert.equal(image.contentLength, 3)

  const chunks = []
  for await (const chunk of image.stream) chunks.push(chunk)
  assert.deepEqual([...Buffer.concat(chunks)], [0xff, 0xd8, 0xff])
})

test('delivery failures carry neither the signed URL nor the signature', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }))
  await assert.rejects(storage.openRoomPhotoStream('p'), (err) => {
    assert.equal(err.notFound, true)
    assert.equal(/sig=|https?:/.test(err.message), false)
    return true
  })

  t.mock.method(globalThis, 'fetch', async () => { throw new Error('getaddrinfo https://res.cloudinary.test/signed/p?sig=SECRET') })
  await assert.rejects(storage.openRoomPhotoStream('p'), (err) => {
    assert.equal(err.message.includes('SECRET'), false)
    return true
  })
})
