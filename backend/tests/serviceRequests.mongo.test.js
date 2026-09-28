// Service requests end to end, against a real MongoDB.
//
// Real router, real auth middleware (JWT + User lookup), real models, real
// ownership queries, real image pipeline (sharp). Faked: Cloudinary (the
// request storage module — so nothing is uploaded anywhere) and the lead email
// sender (a recorder — so nothing is sent).
//
// Skipped unless SERVICE_REQUESTS_TEST_MONGO_URI is set, like the other
// *.mongo.test.js files. A throwaway database is created and dropped.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Readable } from 'node:stream'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import sharp from 'sharp'

const MONGO_URI = process.env.SERVICE_REQUESTS_TEST_MONGO_URI
const skip = !MONGO_URI && 'SERVICE_REQUESTS_TEST_MONGO_URI is not set'

const DB_NAME = `varlikent_service_requests_test_${process.pid}_${Date.now()}`
const SECRET = 'service-requests-test-secret'

// ── Fake storage (Cloudinary) ────────────────────────────────────────────
const storage = { uploads: [], copies: [], destroyed: [], failUploadAt: null }

mock.module('../services/serviceRequests/storage.js', {
  namedExports: {
    SERVICE_REQUEST_PHOTO_FORMAT: 'jpg',
    SERVICE_REQUEST_PHOTO_CONTENT_TYPE: 'image/jpeg',
    serviceRequestPhotoPublicId: (requestId, photoId) => `test/service-requests/${requestId}/${photoId}`,
    uploadServiceRequestPhoto: async (publicId, buffer) => {
      if (storage.failUploadAt !== null && storage.uploads.length === storage.failUploadAt) {
        throw new Error('storage down')
      }
      storage.uploads.push({ publicId, bytes: buffer.length })
      return { publicId, bytes: buffer.length, format: 'jpg' }
    },
    copyAssetToRequest: async (source, publicId) => {
      storage.copies.push({ from: source.publicId, to: publicId, kind: source.kind })
      return { publicId, bytes: 4321, format: 'jpg' }
    },
    destroyServiceRequestPhotos: async (photos = []) => {
      storage.destroyed.push(...photos.map((photo) => photo.publicId))
      return true
    },
    openServiceRequestPhotoStream: async (photo) => ({
      stream: Readable.from([Buffer.from(`image:${photo.publicId}`)]),
      contentLength: null,
    }),
  },
})

// ── Fake lead email ──────────────────────────────────────────────────────
let emails = []
mock.module('../utils/email.js', {
  namedExports: {
    sendContactNotification: async (submission, details) => {
      emails.push({ submission, details })
      return true
    },
  },
})

let server
let baseUrl
let User
let DesignBoard
let DesignRoomPhoto
let DesignGeneration
let ServiceRequest
let ContactSubmission

let alice
let bob
const token = {}

before(async () => {
  if (skip) return
  process.env.JWT_SECRET = SECRET
  process.env.PUBLIC_API_URL = 'https://api.example.test/api'

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME })
  ;({ default: User } = await import('../models/User.js'))
  ;({ default: DesignBoard } = await import('../models/DesignBoard.js'))
  ;({ default: DesignRoomPhoto } = await import('../models/DesignRoomPhoto.js'))
  ;({ default: DesignGeneration } = await import('../models/DesignGeneration.js'))
  ;({ default: ServiceRequest } = await import('../models/ServiceRequest.js'))
  ;({ default: ContactSubmission } = await import('../models/ContactSubmission.js'))
  const { default: routes } = await import('../routes/serviceRequests.js')
  await ServiceRequest.syncIndexes()

  alice = await User.create({ name: 'Alice', email: 'alice@example.test', password: 'secret-1' })
  bob = await User.create({ name: 'Bob', email: 'bob@example.test', password: 'secret-2' })
  for (const user of [alice, bob]) token[user._id] = jwt.sign({ id: user._id }, SECRET)

  const app = express()
  app.use(express.json())
  app.use('/api/service-requests', routes)
  app.use((err, req, res, _next) => res.status(500).json({ success: false, message: err.message }))
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

beforeEach(async () => {
  if (skip) return
  for (const Model of [DesignBoard, DesignRoomPhoto, DesignGeneration, ServiceRequest, ContactSubmission]) {
    await Model.deleteMany({})
  }
  storage.uploads = []
  storage.copies = []
  storage.destroyed = []
  storage.failUploadAt = null
  emails = []
})

// ── Helpers ──────────────────────────────────────────────────────────────

let keySeq = 0
const key = () => `test-key-${Date.now()}-${keySeq++}`

const contact = { name: 'Alice Customer', email: 'alice@example.test', phone: '+90 555 000 1122' }

const interiorPayload = (extra = {}) => ({
  type: 'interior_design',
  idempotencyKey: key(),
  contact,
  property: { type: 'apartment', sizeSqm: 110, district: 'Kadıköy' },
  budget: '500k_1m',
  timeline: 'within_3_months',
  notes: 'We want it calm.',
  interiorDesign: { rooms: ['living_room'] },
  ...extra,
})

const renovationPayload = (extra = {}) => ({
  type: 'renovation',
  idempotencyKey: key(),
  contact,
  property: { type: 'apartment', sizeSqm: 120 },
  budget: '1m_2_5m',
  timeline: 'asap',
  renovation: { areas: ['kitchen', 'bathroom'], work: ['flooring', 'plumbing'] },
  ...extra,
})

const submitJson = async (user, payload) => {
  const response = await fetch(`${baseUrl}/api/service-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[user._id]}` },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json() }
}

const jpeg = (width = 800, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: { r: 180, g: 170, b: 150 } } }).jpeg().toBuffer()

const submitMultipart = async (user, payload, files) => {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  files.forEach((buffer, index) => form.append('photos', new Blob([buffer], { type: 'image/jpeg' }), `p${index}.jpg`))
  const response = await fetch(`${baseUrl}/api/service-requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token[user._id]}` },
    body: form,
  })
  return { status: response.status, body: await response.json() }
}

const get = async (user, path) => {
  const response = await fetch(`${baseUrl}/api/service-requests${path}`, {
    headers: user ? { Authorization: `Bearer ${token[user._id]}` } : {},
  })
  const type = response.headers.get('content-type') || ''
  return { status: response.status, body: type.includes('json') ? await response.json() : await response.text() }
}

const boardFields = {
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'warm',
}

/** A complete Design My Space chain for `user`: board → room photo → visualization. */
const designChain = async (user, { photoStatus = 'ready', generationStatus = 'succeeded' } = {}) => {
  const { ROOM_PHOTO_CONSENT_VERSION } = await import('../config/designRoomPhotos.js')
  const board = await DesignBoard.create({ user: user._id, ...boardFields })
  const photo = await DesignRoomPhoto.create({
    user: user._id,
    asset: { publicId: `rp/${new mongoose.Types.ObjectId()}`, deliveryType: 'authenticated', format: 'jpg' },
    width: 1600,
    height: 1200,
    bytes: 200000,
    status: photoStatus,
    consentVersion: ROOM_PHOTO_CONSENT_VERSION,
    expiresAt: new Date(Date.now() + 86400000),
  })
  const generation = await DesignGeneration.create({
    user: user._id,
    board: board._id,
    boardSnapshot: { version: 1, ...boardFields },
    roomPhoto: photo._id,
    status: generationStatus,
    promptVersion: 'room-restyle-v1',
    idempotencyKey: `gen-${new mongoose.Types.ObjectId()}`,
    result: generationStatus === 'succeeded'
      ? { publicId: `dg/${new mongoose.Types.ObjectId()}`, deliveryType: 'authenticated', format: 'jpg', width: 1024, height: 768, bytes: 150000 }
      : null,
    expiresAt: new Date(Date.now() + 86400000),
  })
  return { board, photo, generation }
}

// ── The gap this feature closes ──────────────────────────────────────────

test('BEFORE: the old consultation lead held no board, photo or visualization — only text', { skip }, async () => {
  // Exactly what the app's old path produced: POST /api/contact with the board
  // serialized into `message` (design-board-serializer.ts). This documents the
  // stored shape — a ContactSubmission has no field for any of them.
  const legacy = await ContactSubmission.create({
    name: 'Alice',
    email: 'alice@example.test',
    phone: '+90 555 000 1122',
    interestType: 'Interior Design',
    message: 'Design Board · Room: Living Room · Style: Warm Modern · Wall: Warm Sand (#e8ddd0)',
    source: 'mobile',
  })
  const stored = legacy.toObject()
  for (const field of ['user', 'designBoard', 'board', 'generation', 'roomPhoto', 'photos', 'images']) {
    assert.equal(field in stored, false, `${field} was never part of a contact lead`)
  }
})

// ── Interior Design: direct ──────────────────────────────────────────────

test('a direct interior design request works without any design', { skip }, async () => {
  const { status, body } = await submitJson(alice, interiorPayload())
  assert.equal(status, 201, JSON.stringify(body))
  assert.equal(body.request.type, 'interior_design')
  assert.equal(body.request.status, 'submitted')
  assert.equal(body.request.interiorDesign.design, null)

  const [submission] = await ContactSubmission.find()
  assert.equal(submission.interestType, 'Interior Design')
  assert.equal(submission.source, 'mobile')
  assert.ok(submission.message.startsWith('INTERIOR DESIGN REQUEST · Request ID: '))
  assert.ok(submission.message.includes('Design attached: No'))

  const stored = await ServiceRequest.findById(body.request._id)
  assert.equal(String(stored.user), String(alice._id))
  assert.equal(String(stored.contactSubmission), String(submission._id))

  // Exactly one lead email, from the existing notification, with the details.
  assert.equal(emails.length, 1)
  assert.equal(String(emails[0].submission._id), String(submission._id))
  assert.ok(emails[0].details.rows.some(([key]) => key === 'Request ID'))
})

// ── Interior Design: from a design ───────────────────────────────────────

test('AFTER: requesting a board attaches the board and a snapshot of its choices', { skip }, async () => {
  const { board } = await designChain(alice)
  const { status, body } = await submitJson(
    alice,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], designBoardId: String(board._id) } })
  )
  assert.equal(status, 201, JSON.stringify(body))

  const design = body.request.interiorDesign.design
  assert.equal(String(design.boardId), String(board._id))
  assert.equal(design.generationId, null)
  assert.equal(design.snapshot.style, 'warm')
  assert.equal(design.snapshot.wall.label, 'Warm Sand')
  assert.equal(body.request.photos.length, 0)
  assert.ok((await ContactSubmission.findOne()).message.includes('Style: Warm Modern'))
})

test('AFTER: requesting a visualization attaches board, generation, room photo and copies both images', { skip }, async () => {
  const { board, photo, generation } = await designChain(alice)
  const { status, body } = await submitJson(
    alice,
    interiorPayload({
      interiorDesign: { rooms: ['living_room'], designBoardId: String(board._id), generationId: String(generation._id) },
    })
  )
  assert.equal(status, 201, JSON.stringify(body))

  const stored = await ServiceRequest.findById(body.request._id)
  assert.equal(String(stored.interiorDesign.design.board), String(board._id))
  assert.equal(String(stored.interiorDesign.design.generation), String(generation._id))
  assert.equal(String(stored.interiorDesign.design.roomPhoto), String(photo._id))
  assert.deepEqual(stored.photos.map((p) => p.kind), ['room_photo', 'visualization'])

  // Copied from the originals to request-owned private paths.
  assert.deepEqual(storage.copies.map((c) => c.from), [photo.asset.publicId, generation.result.publicId])
  assert.ok(storage.copies.every((c) => c.to.startsWith(`test/service-requests/${stored._id}/`)))

  const submission = await ContactSubmission.findOne()
  assert.ok(submission.message.includes('AI visualization: Yes'))
  assert.ok(submission.message.includes('Photos: 2'))
  // The email links to each image through an expiring signed link.
  assert.equal(emails[0].details.photoLinks.length, 2)
  assert.ok(emails[0].details.photoLinks[0].url.startsWith('https://api.example.test/api/service-requests/staff-photos/'))
})

test('a visualization alone is enough; its board is taken from the server record', { skip }, async () => {
  const { board, generation } = await designChain(alice)
  const { status, body } = await submitJson(
    alice,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], generationId: String(generation._id) } })
  )
  assert.equal(status, 201)
  assert.equal(String(body.request.interiorDesign.design.boardId), String(board._id))
})

test('the snapshot is what was visualized, even if the board was edited afterwards', { skip }, async () => {
  const { board, generation } = await designChain(alice)
  await DesignBoard.updateOne({ _id: board._id }, { $set: { style: 'coastal' } })

  const { body } = await submitJson(
    alice,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], generationId: String(generation._id) } })
  )
  assert.equal(body.request.interiorDesign.design.snapshot.style, 'warm')
})

test('an expired room photo does not block the request; the visualization is still attached', { skip }, async () => {
  const { generation } = await designChain(alice, { photoStatus: 'deleted' })
  const { status, body } = await submitJson(
    alice,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], generationId: String(generation._id) } })
  )
  assert.equal(status, 201)
  assert.deepEqual(body.request.photos.map((p) => p.kind), ['visualization'])
})

test('an unfinished visualization cannot be requested', { skip }, async () => {
  const { generation } = await designChain(alice, { generationStatus: 'processing' })
  const { status, body } = await submitJson(
    alice,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], generationId: String(generation._id) } })
  )
  assert.equal(status, 400)
  assert.equal(body.code, 'VISUALIZATION_NOT_READY')
})

// ── Ownership ────────────────────────────────────────────────────────────

test("Bob cannot attach Alice's visualization or board — and nothing is stored", { skip }, async () => {
  const { board, generation } = await designChain(alice)

  const viaGeneration = await submitJson(
    bob,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], generationId: String(generation._id) } })
  )
  const viaBoard = await submitJson(
    bob,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], designBoardId: String(board._id) } })
  )
  for (const result of [viaGeneration, viaBoard]) {
    assert.equal(result.status, 400)
    assert.equal(result.body.code, 'DESIGN_NOT_FOUND')
  }
  assert.equal(await ServiceRequest.countDocuments(), 0)
  assert.equal(await ContactSubmission.countDocuments(), 0)
  assert.equal(storage.copies.length, 0)
  assert.equal(emails.length, 0)
})

test("a generation cannot be paired with a different board", { skip }, async () => {
  const first = await designChain(alice)
  const second = await designChain(alice)
  const { status, body } = await submitJson(
    alice,
    interiorPayload({
      interiorDesign: {
        rooms: ['living_room'],
        designBoardId: String(second.board._id),
        generationId: String(first.generation._id),
      },
    })
  )
  assert.equal(status, 400)
  assert.equal(body.code, 'DESIGN_NOT_FOUND')
})

test('a deleted or missing design answers exactly like someone else\'s', { skip }, async () => {
  const { generation } = await designChain(alice)
  await DesignGeneration.updateOne({ _id: generation._id }, { $set: { status: 'deleted' } })
  const deleted = await submitJson(alice, interiorPayload({ interiorDesign: { rooms: ['kitchen'], generationId: String(generation._id) } }))
  const missing = await submitJson(alice, interiorPayload({ interiorDesign: { rooms: ['kitchen'], designBoardId: String(new mongoose.Types.ObjectId()) } }))
  assert.equal(deleted.body.code, 'DESIGN_NOT_FOUND')
  assert.equal(missing.body.code, 'DESIGN_NOT_FOUND')
})

// ── After submission, the originals may change or disappear ──────────────

test('deleting the board, photo and visualization later leaves the request intact', { skip }, async () => {
  const { board, photo, generation } = await designChain(alice)
  const { body } = await submitJson(
    alice,
    interiorPayload({ interiorDesign: { rooms: ['living_room'], generationId: String(generation._id) } })
  )

  await DesignBoard.deleteOne({ _id: board._id })
  await DesignRoomPhoto.updateOne({ _id: photo._id }, { $set: { status: 'deleted' } })
  await DesignGeneration.updateOne({ _id: generation._id }, { $set: { status: 'deleted' } })

  const detail = await get(alice, `/${body.request._id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.request.interiorDesign.design.snapshot.wall.label, 'Warm Sand')
  assert.equal(detail.body.request.photos.length, 2)

  const image = await get(alice, `/${body.request._id}/photos/${detail.body.request.photos[1]._id}`)
  assert.equal(image.status, 200)
  assert.ok(image.body.includes('test/service-requests/'))
})

// ── Renovation ───────────────────────────────────────────────────────────

test('a renovation request with several photos is stored and routed to Renovation', { skip }, async () => {
  const photos = [await jpeg(), await jpeg(900, 700), await jpeg(1200, 900)]
  const { status, body } = await submitMultipart(alice, renovationPayload({ notes: 'Old tiles' }), photos)
  assert.equal(status, 201, JSON.stringify(body))

  assert.equal(body.request.type, 'renovation')
  assert.deepEqual(body.request.renovation, { areas: ['kitchen', 'bathroom'], work: ['flooring', 'plumbing'] })
  assert.deepEqual(body.request.photos.map((p) => p.kind), ['customer', 'customer', 'customer'])
  assert.equal(storage.uploads.length, 3)

  const submission = await ContactSubmission.findOne()
  assert.equal(submission.interestType, 'Renovation')
  assert.ok(submission.message.startsWith('RENOVATION REQUEST'))
  assert.ok(submission.message.includes('Areas: Kitchen, Bathroom'))
  assert.ok(submission.message.includes('Work: Flooring, Plumbing'))
  assert.ok(submission.message.includes('Photos: 3'))
  assert.ok(submission.message.includes('Notes: Old tiles'))
})

test('renovation requires areas, work, budget and timeline', { skip }, async () => {
  const { status, body } = await submitJson(
    alice,
    renovationPayload({ renovation: { areas: [], work: [] }, budget: undefined, timeline: undefined })
  )
  assert.equal(status, 400)
  assert.deepEqual(body.errors.map((e) => e.field).sort(), ['budget', 'renovation.areas', 'renovation.work', 'timeline'])
  assert.equal(await ContactSubmission.countDocuments(), 0)
})

test('a renovation request cannot carry a design', { skip }, async () => {
  const { board } = await designChain(alice)
  const { status } = await submitJson(alice, renovationPayload({ interiorDesign: { designBoardId: String(board._id) } }))
  assert.equal(status, 400)
})

test('more than six photos are refused', { skip }, async () => {
  const photo = await jpeg()
  const { status, body } = await submitMultipart(alice, renovationPayload(), Array(7).fill(photo))
  assert.equal(status, 400)
  assert.equal(body.code, 'TOO_MANY_PHOTOS')
})

test('an unreadable photo is refused before anything is stored', { skip }, async () => {
  const { status, body } = await submitMultipart(alice, renovationPayload(), [await jpeg(), Buffer.from('not an image')])
  assert.equal(status, 400)
  assert.equal(body.code, 'PHOTO_UNREADABLE')
  assert.equal(storage.uploads.length, 0)
  assert.equal(await ServiceRequest.countDocuments(), 0)
})

test('a storage failure mid-submit removes what was stored and creates nothing', { skip }, async () => {
  storage.failUploadAt = 1
  const { status, body } = await submitMultipart(alice, renovationPayload(), [await jpeg(), await jpeg()])
  assert.equal(status, 502)
  assert.equal(body.code, 'PHOTO_STORAGE_FAILED')
  assert.equal(storage.destroyed.length, 1)
  assert.equal(await ServiceRequest.countDocuments(), 0)
  assert.equal(await ContactSubmission.countDocuments(), 0)
})

test('if the lead cannot be recorded, the whole request is rolled back', { skip }, async () => {
  const original = ContactSubmission.create
  ContactSubmission.create = async () => { throw new Error('mongo hiccup') }
  try {
    const { status } = await submitMultipart(alice, renovationPayload(), [await jpeg()])
    assert.equal(status, 500)
  } finally {
    ContactSubmission.create = original
  }
  assert.equal(await ServiceRequest.countDocuments(), 0)
  assert.equal(storage.destroyed.length, 1)
  assert.equal(emails.length, 0)
})

// ── Duplicate submits ────────────────────────────────────────────────────

test('the same idempotency key never creates a second request, lead or email', { skip }, async () => {
  const payload = renovationPayload()
  const first = await submitJson(alice, payload)
  const second = await submitJson(alice, payload)
  assert.equal(first.status, 201)
  assert.equal(second.status, 200)
  assert.equal(second.body.duplicate, true)
  assert.equal(String(second.body.request._id), String(first.body.request._id))
  assert.equal(await ServiceRequest.countDocuments(), 1)
  assert.equal(await ContactSubmission.countDocuments(), 1)
  assert.equal(emails.length, 1)
})

test('simultaneous identical submits still produce one request', { skip }, async () => {
  const payload = renovationPayload()
  const results = await Promise.all([submitJson(alice, payload), submitJson(alice, payload), submitJson(alice, payload)])
  assert.ok(results.every((r) => [200, 201].includes(r.status)), JSON.stringify(results.map((r) => r.status)))
  assert.equal(await ServiceRequest.countDocuments(), 1)
})

// ── My Requests ──────────────────────────────────────────────────────────

test('each customer lists only their own requests, newest first, with derived status', { skip }, async () => {
  const a1 = await submitJson(alice, interiorPayload())
  const a2 = await submitJson(alice, renovationPayload())
  await submitJson(bob, renovationPayload({ contact: { ...contact, email: 'bob@example.test' } }))

  const aliceList = await get(alice, '')
  assert.deepEqual(aliceList.body.requests.map((r) => String(r._id)), [String(a2.body.request._id), String(a1.body.request._id)])
  assert.deepEqual(aliceList.body.requests.map((r) => r.type), ['renovation', 'interior_design'])

  const bobList = await get(bob, '')
  assert.equal(bobList.body.requests.length, 1)
})

test('status follows the lead: Replied → contacted, Archived → closed, deleted → closed', { skip }, async () => {
  const { body } = await submitJson(alice, renovationPayload())
  const stored = await ServiceRequest.findById(body.request._id)
  const status = async () => (await get(alice, `/${body.request._id}`)).body.request.status

  assert.equal(await status(), 'submitted')
  await ContactSubmission.updateOne({ _id: stored.contactSubmission }, { $set: { status: 'Replied' } })
  assert.equal(await status(), 'contacted')
  await ContactSubmission.updateOne({ _id: stored.contactSubmission }, { $set: { status: 'Archived' } })
  assert.equal(await status(), 'closed')
  await ContactSubmission.deleteOne({ _id: stored.contactSubmission })
  assert.equal(await status(), 'closed')
  assert.equal((await get(alice, '')).body.requests[0].status, 'closed')
})

test("another customer's request and its photos are simply not found", { skip }, async () => {
  const { body } = await submitMultipart(alice, renovationPayload(), [await jpeg()])
  const requestId = body.request._id
  const photoId = body.request.photos[0]._id

  assert.equal((await get(bob, `/${requestId}`)).status, 404)
  assert.equal((await get(bob, `/${requestId}/photos/${photoId}`)).status, 404)
  assert.equal((await get(alice, `/${requestId}/photos/${photoId}`)).status, 200)
  assert.equal((await get(null, `/${requestId}`)).status, 401)
  assert.equal((await get(alice, '/not-an-id')).status, 404)
})

// ── Staff photo links ────────────────────────────────────────────────────

test('the emailed staff link shows exactly its photo, and a tampered link shows nothing', { skip }, async () => {
  await submitMultipart(alice, renovationPayload(), [await jpeg(), await jpeg()])
  const [first, second] = emails[0].details.photoLinks.map((link) => new URL(link.url))
  const local = (url) => `${url.pathname.replace('/api/service-requests', '')}${url.search}`

  assert.equal((await get(null, local(first))).status, 200)

  const swapped = new URL(first)
  swapped.pathname = second.pathname
  assert.equal((await get(null, local(swapped))).status, 404)

  const tampered = new URL(first)
  tampered.searchParams.set('sig', 'forged')
  assert.equal((await get(null, local(tampered))).status, 404)

  const extended = new URL(first)
  extended.searchParams.set('expires', String(Number(first.searchParams.get('expires')) + 1))
  assert.equal((await get(null, local(extended))).status, 404)
})

// ── Account deletion ─────────────────────────────────────────────────────

test("deleting an account removes the customer's requests and images, not the leads", { skip }, async () => {
  const { deleteAllServiceRequestsForUser } = await import('../services/serviceRequests/lifecycle.js')
  await submitMultipart(alice, renovationPayload(), [await jpeg(), await jpeg()])
  await submitJson(bob, renovationPayload({ contact: { ...contact, email: 'bob@example.test' } }))

  const result = await deleteAllServiceRequestsForUser(alice._id)
  assert.equal(result.deleted, 1)
  assert.equal(storage.destroyed.length, 2)
  assert.equal(await ServiceRequest.countDocuments({ user: alice._id }), 0)
  assert.equal(await ServiceRequest.countDocuments({ user: bob._id }), 1)
  assert.equal(await ContactSubmission.countDocuments(), 2)
})
