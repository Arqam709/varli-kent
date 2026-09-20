// Room photos against a REAL MongoDB: real JWTs, the real `protect`, the real
// DesignRoomPhoto model and indexes, the real pipeline and lifecycle. Only
// Cloudinary is replaced (by an in-memory store) — tests never touch it.
//
// Skipped unless DESIGN_ROOM_PHOTOS_TEST_MONGO_URI is set. Point it at a
// throwaway server only: the test creates and DROPS its own database.

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Readable } from 'node:stream'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import * as fixtures from './helpers/roomPhotoFixtures.js'
import { ROOM_PHOTO_CONSENT_VERSION } from '../config/designRoomPhotos.js'

const MONGO_URI = process.env.DESIGN_ROOM_PHOTOS_TEST_MONGO_URI
const skip = !MONGO_URI && 'DESIGN_ROOM_PHOTOS_TEST_MONGO_URI is not set'

const objects = new Map()
const destroyed = []

mock.module('../services/designRoomPhotos/storage.js', {
  namedExports: {
    roomPhotoPublicId: (id) => `varlikent/integration/design-room-photos/${id}`,
    uploadRoomPhoto: async (publicId, buffer) => { objects.set(publicId, buffer); return { publicId } },
    destroyRoomPhoto: async (publicId) => { destroyed.push(publicId); objects.delete(publicId); return true },
    openRoomPhotoStream: async (publicId) => ({ stream: Readable.from([objects.get(publicId)]), contentLength: objects.get(publicId).length }),
  },
})

const SECRET = 'design-room-photos-integration-secret'
let server
let baseUrl
let Photo
let lifecycle
let tokenA
let tokenB
let userA

before(async () => {
  if (skip) return
  process.env.JWT_SECRET = SECRET
  await mongoose.connect(MONGO_URI, { dbName: `varlikent_room_photos_test_${process.pid}_${Date.now()}` })

  const { default: User } = await import('../models/User.js')
  ;({ default: Photo } = await import('../models/DesignRoomPhoto.js'))
  lifecycle = await import('../services/designRoomPhotos/lifecycle.js')
  const { default: routes } = await import('../routes/designRoomPhotos.js')
  await Photo.syncIndexes()

  userA = await User.create({ name: 'Ada', email: 'ada@example.test', password: 'secret-a' })
  const userB = await User.create({ name: 'Bo', email: 'bo@example.test', password: 'secret-b' })
  tokenA = jwt.sign({ id: userA._id }, SECRET)
  tokenB = jwt.sign({ id: userB._id }, SECRET)

  const app = express()
  app.use('/api/design-room-photos', routes)
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/design-room-photos`
})

after(async () => {
  if (skip) return
  await new Promise((resolve) => server.close(resolve))
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

const send = (token, method, path = '', body) => fetch(baseUrl + path, {
  method,
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  body,
})

test('upload → persisted → owner reads and streams → user B shut out → delete → purged', { skip }, async () => {
  const body = new FormData()
  body.append('consentVersion', ROOM_PHOTO_CONSENT_VERSION)
  body.append('photo', new Blob([await fixtures.jpegWithPrivateMetadata(3000, 2000)], { type: 'image/jpeg' }), 'room.jpg')

  assert.equal((await send(null, 'POST', '', body)).status, 401)

  const created = await send(tokenA, 'POST', '', body)
  assert.equal(created.status, 201)
  const { photo } = await created.json()

  const raw = await mongoose.connection.db.collection('designroomphotos').findOne({ _id: new mongoose.Types.ObjectId(photo._id) })
  assert.equal(String(raw.user), String(userA._id))
  assert.equal(raw.status, 'ready')
  assert.deepEqual([raw.width, raw.height], [2048, 1365])
  assert.equal(raw.asset.deliveryType, 'authenticated')
  assert.equal(raw.asset.publicId, `varlikent/integration/design-room-photos/${photo._id}`)
  assert.equal(Object.keys(raw).some((key) => /url|exif|filename/i.test(key)), false)

  assert.equal((await send(tokenA, 'GET', `/${photo._id}`)).status, 200)
  const image = await send(tokenA, 'GET', `/${photo._id}/image`)
  assert.equal(image.headers.get('cache-control'), 'private, no-store, max-age=0')
  assert.ok(Buffer.from(await image.arrayBuffer()).equals(objects.get(raw.asset.publicId)))

  for (const [method, path] of [['GET', `/${photo._id}`], ['GET', `/${photo._id}/image`], ['DELETE', `/${photo._id}`]]) {
    assert.equal((await send(tokenB, method, path)).status, 404, `${method} ${path} for user B`)
  }

  assert.equal((await send(tokenA, 'DELETE', `/${photo._id}`)).status, 200)
  const after = await Photo.findById(photo._id).lean()
  assert.equal(after.status, 'deleted')
  assert.ok(after.purgedAt)
  assert.deepEqual(destroyed, [raw.asset.publicId])
  assert.equal((await send(tokenA, 'GET', `/${photo._id}`)).status, 404)
})

test('the storage identity is unique, and the owner can never be reassigned', { skip }, async () => {
  const base = {
    user: userA._id,
    asset: { publicId: 'varlikent/integration/design-room-photos/unique-check', deliveryType: 'authenticated', format: 'jpg' },
    width: 1000, height: 800, bytes: 100, status: 'ready',
    consentVersion: ROOM_PHOTO_CONSENT_VERSION, expiresAt: new Date(Date.now() + 86_400_000),
  }
  const photo = await Photo.create(base)
  await assert.rejects(Photo.create(base), (err) => err.code === 11000)

  await Photo.findOneAndUpdate({ _id: photo._id }, { $set: { user: new mongoose.Types.ObjectId(), status: 'deleted' } })
  const stored = await Photo.findById(photo._id).lean()
  assert.equal(String(stored.user), String(userA._id))
  await Photo.deleteMany({})
})

test('the sweep purges expired and stale records in a real database', { skip }, async () => {
  const base = {
    user: userA._id, width: 1000, height: 800, bytes: 100,
    consentVersion: ROOM_PHOTO_CONSENT_VERSION,
  }
  const expired = await Photo.create({ ...base, asset: { publicId: 'varlikent/integration/design-room-photos/expired', deliveryType: 'authenticated', format: 'jpg' }, status: 'ready', expiresAt: new Date(Date.now() - 1000) })
  const stale = await Photo.create({ ...base, asset: { publicId: 'varlikent/integration/design-room-photos/stale', deliveryType: 'authenticated', format: 'jpg' }, status: 'uploading', expiresAt: new Date(Date.now() + 86_400_000) })
  await mongoose.connection.db.collection('designroomphotos').updateOne({ _id: stale._id }, { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } })

  const result = await lifecycle.sweepRoomPhotos()
  assert.equal(result.expired, 1)
  assert.equal(result.staleUploads, 1)
  for (const id of [expired._id, stale._id]) {
    const doc = await Photo.findById(id).lean()
    assert.equal(doc.status, 'deleted')
    assert.ok(doc.purgedAt)
  }

  const ttl = (await Photo.collection.indexes()).find((index) => index.expireAfterSeconds !== undefined)
  assert.deepEqual(ttl.key, { purgedAt: 1 })
})
