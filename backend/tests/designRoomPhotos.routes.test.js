// /api/design-room-photos over real HTTP, with real multer, the real image
// pipeline and the real lifecycle service. Only the model (in memory),
// authentication (a session switch) and Cloudinary (a recorder) are stand-ins.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Readable } from 'node:stream'
import express from 'express'
import sharp from 'sharp'
import { createFakeDesignRoomPhotoModel } from './helpers/fakeDesignRoomPhotoModel.js'
import * as fixtures from './helpers/roomPhotoFixtures.js'
import {
  ROOM_PHOTO_CONSENT_VERSION,
  ROOM_PHOTO_MAX_STORED_PER_USER,
  ROOM_PHOTO_MAX_UPLOAD_BYTES,
  ROOM_PHOTO_MAX_UPLOADS_PER_DAY,
} from '../config/designRoomPhotos.js'

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

const Model = createFakeDesignRoomPhotoModel()
mock.module('../models/DesignRoomPhoto.js', { defaultExport: Model })

const storage = {
  uploads: [],
  destroys: [],
  opens: [],
  uploadFailure: null,
  destroyFailure: null,
  openFailure: null,
  objects: new Map(),
}

mock.module('../services/designRoomPhotos/storage.js', {
  namedExports: {
    roomPhotoPublicId: (id) => `varlikent/test/design-room-photos/${id}`,
    uploadRoomPhoto: async (publicId, buffer) => {
      storage.uploads.push({ publicId, buffer })
      if (storage.uploadFailure) throw storage.uploadFailure
      storage.objects.set(publicId, buffer)
      return { publicId, bytes: buffer.length, format: 'jpg' }
    },
    destroyRoomPhoto: async (publicId, deliveryType) => {
      storage.destroys.push({ publicId, deliveryType })
      if (storage.destroyFailure) throw storage.destroyFailure
      storage.objects.delete(publicId)
      return true
    },
    openRoomPhotoStream: async (publicId, options) => {
      storage.opens.push({ publicId, options })
      if (storage.openFailure) throw storage.openFailure
      const bytes = storage.objects.get(publicId)
      return { stream: Readable.from([bytes]), contentLength: bytes.length }
    },
  },
})

const { default: routes } = await import('../routes/designRoomPhotos.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/design-room-photos', routes)
  app.use((err, req, res, next) => res.status(err.status || 500).json({ success: false, message: 'Internal Server Error' }))
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/design-room-photos`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  currentUser = null
  Model.docs.clear()
  Model.calls.length = 0
  storage.uploads.length = 0
  storage.destroys.length = 0
  storage.opens.length = 0
  storage.uploadFailure = null
  storage.destroyFailure = null
  storage.openFailure = null
  storage.objects.clear()
})

const USER_A = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'user', permissions: [] }
const USER_B = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'user', permissions: [] }
const as = (user) => { currentUser = user }

let photoJpeg
before(async () => { photoJpeg = await fixtures.jpeg(2400, 1800) })

/** Builds the multipart form the app sends: consentVersion first, then photo. */
const form = (options = {}) => {
  // An explicit `photo: undefined` / `consent: undefined` means "omit the part",
  // which destructuring defaults would silently turn back into a valid request.
  const photo = 'photo' in options ? options.photo : photoJpeg
  const consent = 'consent' in options ? options.consent : ROOM_PHOTO_CONSENT_VERSION
  const { filename = 'room.jpg', type = 'image/jpeg', extra = [], consentLast = false, field = 'photo' } = options
  const body = new FormData()
  if (consent !== undefined && !consentLast) body.append('consentVersion', consent)
  if (photo !== undefined) body.append(field, new Blob([photo], { type }), filename)
  if (consent !== undefined && consentLast) body.append('consentVersion', consent)
  for (const [name, value] of extra) body.append(name, value)
  return body
}

const upload = async (options) => {
  const response = await fetch(baseUrl, { method: 'POST', body: form(options) })
  return { status: response.status, body: await response.json() }
}

const call = async (method, path = '') => {
  const response = await fetch(baseUrl + path, { method })
  return { status: response.status, response }
}

const uploadAs = async (user, options) => {
  as(user)
  const result = await upload(options)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.photo
}

/* ═══════════════ Authentication ═══════════════ */

test('every route requires a signed-in user and touches nothing without one', async () => {
  const id = 'cccccccccccccccccccccccc'
  assert.equal((await upload()).status, 401)
  assert.equal((await call('GET')).status, 401)
  assert.equal((await call('GET', `/${id}`)).status, 401)
  assert.equal((await call('GET', `/${id}/image`)).status, 401)
  assert.equal((await call('DELETE', `/${id}`)).status, 401)
  assert.deepEqual(Model.calls, [])
  assert.deepEqual(storage.uploads, [])
})

/* ═══════════════ Upload ═══════════════ */

test('a valid JPEG is normalized, stored privately and returned without any storage identity', async () => {
  const photo = await uploadAs(USER_A)

  // The response is exactly the safe shape.
  assert.deepEqual(Object.keys(photo).sort(), ['_id', 'createdAt', 'expiresAt', 'format', 'height', 'status', 'width'])
  assert.equal(photo.status, 'ready')
  assert.deepEqual([photo.width, photo.height, photo.format], [2048, 1536, 'jpg'])
  const serialized = JSON.stringify(photo)
  for (const leak of ['publicId', 'cloudinary', 'design-room-photos', 'http', 'asset']) {
    assert.equal(serialized.includes(leak), false, `the response exposes ${leak}`)
  }

  // Storage received the NORMALIZED bytes under the record's own id.
  assert.equal(storage.uploads.length, 1)
  const [{ publicId, buffer }] = storage.uploads
  assert.equal(publicId, `varlikent/test/design-room-photos/${photo._id}`)
  assert.equal(buffer.equals(photoJpeg), false, 'the original upload was stored')
  const stored = await sharp(buffer).metadata()
  assert.deepEqual([stored.format, stored.width, stored.height], ['jpeg', 2048, 1536])

  // MongoDB: owned by the session user, ready, consent recorded, retention set.
  const record = Model.docs.get(photo._id)
  assert.equal(record.user, USER_A._id)
  assert.equal(record.status, 'ready')
  assert.equal(record.consentVersion, ROOM_PHOTO_CONSENT_VERSION)
  assert.deepEqual(record.asset, { publicId, deliveryType: 'authenticated', format: 'jpg' })
  assert.equal(record.bytes, buffer.length)
  const days = (new Date(record.expiresAt) - new Date(record.createdAt)) / 86_400_000
  assert.ok(days > 29.9 && days < 30.1, `retention was ${days} days`)
})

test('PNG and WebP uploads are accepted and stored as JPEG', async () => {
  for (const [photo, type, filename] of [[await fixtures.png(), 'image/png', 'room.png'], [await fixtures.webp(), 'image/webp', 'room.webp']]) {
    const result = await uploadAs(USER_A, { photo, type, filename })
    assert.equal(result.format, 'jpg')
  }
  for (const { buffer } of storage.uploads) assert.equal((await sharp(buffer).metadata()).format, 'jpeg')
})

test('what the client claims about the file is ignored', async () => {
  as(USER_A)
  // A text file named and typed as a JPEG.
  const text = await upload({ photo: fixtures.textFile(), type: 'image/jpeg', filename: 'living-room.jpg' })
  assert.deepEqual([text.status, text.body.code], [400, 'PHOTO_UNREADABLE'])

  // A real JPEG named and typed as something else is still a JPEG.
  const mislabeled = await upload({ type: 'application/octet-stream', filename: 'notes.txt' })
  assert.equal(mislabeled.status, 201)
})

test('corrupt, unsupported, too large, too small and panoramic images are refused, and nothing is stored', async () => {
  as(USER_A)
  const cases = [
    [await fixtures.truncatedJpeg(), 400, 'PHOTO_UNREADABLE'],
    [await fixtures.gif(), 400, 'PHOTO_UNSUPPORTED_FORMAT'],
    [fixtures.svg(), 400, 'PHOTO_UNREADABLE'],
    [fixtures.pngClaimingDimensions(30000, 30000), 400, 'PHOTO_DIMENSIONS_TOO_LARGE'],
    [await fixtures.jpeg(700, 400), 400, 'PHOTO_TOO_SMALL'],
    [await fixtures.jpeg(3300, 1000), 400, 'PHOTO_ASPECT_RATIO'],
  ]

  for (const [photo, status, code] of cases) {
    const result = await upload({ photo })
    assert.deepEqual([result.status, result.body.code], [status, code])
  }
  assert.deepEqual(storage.uploads, [])
  assert.equal(Model.docs.size, 0)
})

test('an upload over the byte limit is 413, not a generic 500', async () => {
  as(USER_A)
  const oversized = Buffer.alloc(ROOM_PHOTO_MAX_UPLOAD_BYTES + 1, 0xab)
  oversized.set([0xff, 0xd8, 0xff], 0)
  const result = await upload({ photo: oversized })
  assert.deepEqual([result.status, result.body.code], [413, 'PHOTO_FILE_TOO_LARGE'])
  assert.deepEqual(storage.uploads, [])
})

test('consent is required, must be the current version, and must precede the photo', async () => {
  as(USER_A)
  for (const consent of [undefined, '', 'yes', '2020-01-room-photo-v0']) {
    const result = await upload({ consent })
    assert.deepEqual([result.status, result.body.code], [400, 'CONSENT_REQUIRED'], `consent ${consent}`)
  }
  const late = await upload({ consentLast: true })
  assert.deepEqual([late.status, late.body.code], [400, 'CONSENT_REQUIRED'])
  assert.deepEqual(storage.uploads, [])
})

test('malformed multipart requests are 400-class, never 500', async () => {
  as(USER_A)
  const wrongField = await upload({ field: 'image' })
  assert.deepEqual([wrongField.status, wrongField.body.code], [400, 'INVALID_UPLOAD'])

  const twoFiles = form()
  twoFiles.append('photo', new Blob([photoJpeg], { type: 'image/jpeg' }), 'second.jpg')
  const second = await fetch(baseUrl, { method: 'POST', body: twoFiles })
  assert.equal(second.status, 400)

  const broken = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=----x' },
    body: '------x\r\nContent-Disposition: form-data; name="consentVersion"\r\n\r\n' + ROOM_PHOTO_CONSENT_VERSION + '\r\n------x\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\n',
  })
  assert.ok(broken.status >= 400 && broken.status < 500, `broken multipart answered ${broken.status}`)

  const noFile = await upload({ photo: undefined })
  assert.deepEqual([noFile.status, noFile.body.code], [400, 'PHOTO_REQUIRED'])

  const json = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(json.status, 400)
})

test('the client cannot choose the owner', async () => {
  as(USER_A)
  const withUser = await upload({ extra: [['user', USER_B._id]] })
  assert.equal(withUser.status, 400, 'an extra owner field was accepted')

  const viaQuery = await fetch(`${baseUrl}?user=${USER_B._id}&userId=${USER_B._id}`, { method: 'POST', body: form() })
  const { photo } = await viaQuery.json()
  assert.equal(Model.docs.get(photo._id).user, USER_A._id)
})

test('a storage failure is reported as a failure, and the record is hidden and queued for purge', async () => {
  as(USER_A)
  storage.uploadFailure = new Error('storage down')
  const result = await upload()

  assert.deepEqual([result.status, result.body.code], [502, 'ROOM_PHOTO_STORAGE_FAILED'])
  assert.equal(JSON.stringify(result.body).includes('storage down'), false)
  const [record] = Model.docs.values()
  assert.equal(record.status, 'deleted')
  assert.ok(record.deletedAt)
  // The upload might have landed despite the error, so destroy was attempted.
  assert.equal(storage.destroys.length, 1)
  assert.equal(storage.destroys[0].publicId, record.asset.publicId)
})

test('if the record cannot be finalized, the upload is not reported as a success', async () => {
  as(USER_A)
  Model.failures.findOneAndUpdate = new Error('mongo blip')
  const result = await upload()
  assert.equal(result.status, 500)
  // Left `uploading`, which the stale-upload sweep hides and purges.
  const [record] = Model.docs.values()
  assert.equal(record.status, 'uploading')
})

/* ═══════════════ Limits ═══════════════ */

const seedPhoto = (user, overrides = {}) => {
  const _id = (Model.docs.size + 1).toString(16).padStart(24, 'd')
  return Model.seed({
    _id,
    user: user._id,
    asset: { publicId: `varlikent/test/design-room-photos/${_id}`, deliveryType: 'authenticated', format: 'jpg' },
    width: 2048,
    height: 1536,
    bytes: 1000,
    status: 'ready',
    consentVersion: ROOM_PHOTO_CONSENT_VERSION,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  })
}

test(`a user holding ${ROOM_PHOTO_MAX_STORED_PER_USER} photos is refused before the body is processed; others are not`, async () => {
  for (let i = 0; i < ROOM_PHOTO_MAX_STORED_PER_USER; i += 1) {
    seedPhoto(USER_A, { createdAt: new Date(Date.now() - 3 * 86_400_000) })
  }

  as(USER_A)
  const blocked = await upload()
  assert.deepEqual([blocked.status, blocked.body.code], [400, 'ROOM_PHOTO_LIMIT_REACHED'])
  assert.deepEqual(storage.uploads, [])

  await uploadAs(USER_B)
})

test(`deleted photos still count toward ${ROOM_PHOTO_MAX_UPLOADS_PER_DAY} uploads per day`, async () => {
  for (let i = 0; i < ROOM_PHOTO_MAX_UPLOADS_PER_DAY; i += 1) {
    seedPhoto(USER_A, { status: 'deleted', deletedAt: new Date(), purgedAt: new Date() })
  }
  as(USER_A)
  const blocked = await upload()
  assert.deepEqual([blocked.status, blocked.body.code], [429, 'ROOM_PHOTO_DAILY_LIMIT'])
  assert.deepEqual(storage.uploads, [])
})

/* ═══════════════ Reading ═══════════════ */

test('the list holds only the signed-in user’s ready photos, newest first, with the safe shape', async () => {
  const older = seedPhoto(USER_A, { createdAt: new Date(Date.now() - 60_000) })
  const newer = seedPhoto(USER_A, { createdAt: new Date() })
  seedPhoto(USER_A, { status: 'uploading' })
  seedPhoto(USER_A, { status: 'deleted', deletedAt: new Date() })
  seedPhoto(USER_B)

  as(USER_A)
  const { response } = await call('GET')
  assert.equal(response.status, 200)
  const { photos } = await response.json()
  assert.deepEqual(photos.map((p) => p._id), [newer._id, older._id])
  for (const photo of photos) {
    assert.deepEqual(Object.keys(photo).sort(), ['_id', 'createdAt', 'expiresAt', 'format', 'height', 'status', 'width'])
  }
  assert.deepEqual(Model.calls.find((c) => c.method === 'find').filter, { user: USER_A._id, status: 'ready' })

  as(USER_B)
  const other = await (await call('GET')).response.json()
  assert.equal(other.photos.length, 1)
})

test('the owner reads their photo; another user and malformed ids get the same 404', async () => {
  const photo = await uploadAs(USER_A)

  const own = await fetch(`${baseUrl}/${photo._id}`)
  assert.equal(own.status, 200)
  assert.deepEqual((await own.json()).photo, photo)

  as(USER_B)
  const other = await fetch(`${baseUrl}/${photo._id}`)
  assert.equal(other.status, 404)
  assert.deepEqual(await other.json(), { success: false, message: 'Room photo not found' })

  for (const path of ['/not-an-id', `/not-an-id/image`]) {
    assert.equal((await call('GET', path)).status, 404)
  }
})

test('the image is streamed to its owner only, as private uncacheable JPEG', async () => {
  const photo = await uploadAs(USER_A)

  const { response } = await call('GET', `/${photo._id}/image`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.equals(storage.uploads[0].buffer), 'a different image was served')
  assert.deepEqual(storage.opens[0].options, { deliveryType: 'authenticated', format: 'jpg' })

  as(USER_B)
  storage.opens.length = 0
  assert.equal((await call('GET', `/${photo._id}/image`)).status, 404)
  assert.deepEqual(storage.opens, [], 'storage was contacted for another user')
})

test('a storage outage while streaming is a 502 with no storage details', async () => {
  const photo = await uploadAs(USER_A)
  storage.openFailure = new Error('signed https://res.cloudinary.com/... failed')

  const { response } = await call('GET', `/${photo._id}/image`)
  assert.equal(response.status, 502)
  const text = await response.text()
  assert.equal(text.includes('cloudinary'), false)
})

test('photos that are uploading or deleted do not exist for their owner', async () => {
  const uploading = seedPhoto(USER_A, { status: 'uploading' })
  const deleted = seedPhoto(USER_A, { status: 'deleted', deletedAt: new Date() })
  as(USER_A)
  for (const photo of [uploading, deleted]) {
    assert.equal((await call('GET', `/${photo._id}`)).status, 404)
    assert.equal((await call('GET', `/${photo._id}/image`)).status, 404)
    assert.equal((await call('DELETE', `/${photo._id}`)).status, 404)
  }
})

/* ═══════════════ Deletion ═══════════════ */

test('deleting hides the photo at once and destroys the private asset', async () => {
  const photo = await uploadAs(USER_A)
  const publicId = storage.uploads[0].publicId

  const { response } = await call('DELETE', `/${photo._id}`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).purged, true)

  assert.deepEqual(storage.destroys, [{ publicId, deliveryType: 'authenticated' }])
  const record = Model.docs.get(photo._id)
  assert.equal(record.status, 'deleted')
  assert.ok(record.deletedAt && record.purgedAt)

  assert.equal((await call('GET', `/${photo._id}`)).status, 404)
  assert.equal((await call('GET', `/${photo._id}/image`)).status, 404)
  assert.equal((await call('DELETE', `/${photo._id}`)).status, 404)
})

test('if the physical delete fails, the photo is still gone for the user and stays queued for retry', async () => {
  const photo = await uploadAs(USER_A)
  storage.destroyFailure = new Error('cloudinary unavailable')

  const { response } = await call('DELETE', `/${photo._id}`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).purged, false)

  const record = Model.docs.get(photo._id)
  assert.equal(record.status, 'deleted')
  assert.equal(record.purgedAt, null, 'an unconfirmed destroy was recorded as purged')
  assert.equal((await call('GET', `/${photo._id}`)).status, 404)
})

test('user B cannot delete user A’s photo', async () => {
  const photo = await uploadAs(USER_A)
  as(USER_B)
  assert.equal((await call('DELETE', `/${photo._id}`)).status, 404)
  assert.equal(Model.docs.get(photo._id).status, 'ready')
  assert.deepEqual(storage.destroys, [])
})
