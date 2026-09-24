// POST /api/upload: what the admin is told when a file is refused.
//
// The rule this suite exists to defend is that a file the CALLER can fix must
// not come back as a server fault. Before this, multer's LIMIT_FILE_SIZE had no
// `.status`, so server.js's `res.status(err.status || 500)` turned "your photo
// is 14 MB" into a bare `500 File too large` — which the admin form then
// discarded and showed as "Upload failed".
//
// Cloudinary and JWT verification are replaced; multer, the size and type
// rules and the route wiring under test are real.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

let currentUser = { _id: 'o', role: 'owner', permissions: [] }

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!currentUser) return res.status(401).json({ success: false, message: 'Not authenticated' })
      req.user = currentUser
      next()
    },
    userFromToken: async () => null,
  },
})

// What the fake Cloudinary should do on the next call.
const cloud = { mode: 'ok' }

mock.module('../config/cloudinary.js', {
  defaultExport: {
    uploader: {
      upload_stream: (options, cb) => ({
        end: () => {
          if (cloud.mode === 'reject') {
            // The shape the SDK actually produces for a refused asset.
            return cb(Object.assign(new Error('Invalid image file'), { http_code: 400 }))
          }
          if (cloud.mode === 'down') {
            // A transport failure carries no http_code at all — the SDK never
            // got an answer to attach one to.
            return cb(new Error('connect ETIMEDOUT 10.0.0.1:443'))
          }
          cb(null, {
            secure_url: 'https://res.cloudinary.com/x/image/upload/v1/varlikent/abc.jpg',
            public_id: 'varlikent/abc',
            resource_type: 'image',
          })
        },
      }),
      destroy: async () => ({ result: 'ok' }),
    },
  },
})

const { default: uploadRoutes, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } = await import('../routes/upload.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/upload', uploadRoutes)
  // Byte-for-byte the handler in server.js, so a status this suite asserts is
  // the status the deployed API really returns.
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
  })
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

beforeEach(() => {
  currentUser = { _id: 'o', role: 'owner', permissions: [] }
  cloud.mode = 'ok'
})

const send = async ({ bytes = 1024, type = 'image/jpeg', name = 'photo.jpg', field = 'image' } = {}) => {
  const fd = new FormData()
  fd.append(field, new Blob([new Uint8Array(bytes)], { type }), name)
  const res = await fetch(baseUrl + '/api/upload', { method: 'POST', body: fd })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/* ══════════════════ 1. The happy path still works ══════════════════ */

test('a normal image uploads and returns url and publicId', async () => {
  const r = await send()
  assert.equal(r.status, 201)
  assert.equal(r.body.success, true)
  assert.match(r.body.url, /^https:\/\/res\.cloudinary\.com\//)
  assert.equal(r.body.publicId, 'varlikent/abc')
})

test('video is still accepted', async () => {
  const r = await send({ type: 'video/mp4', name: 'tour.mp4', bytes: 2048 })
  assert.equal(r.status, 201)
})

/* ══════════════════ 2. Too large is 413, not 500 ═══════════════════ */

test('an image over the image cap is refused as 413 with the limit named', async () => {
  const r = await send({ bytes: MAX_IMAGE_BYTES + 1 })
  assert.equal(r.status, 413, 'a fixable file must not be reported as a server fault')
  assert.match(r.body.message, /10 MB/)
  assert.match(r.body.message, /photo\.jpg/)
})

test('a file over the hard multer cap is refused as 413, not 500', async () => {
  const r = await send({ type: 'video/mp4', name: 'huge.mp4', bytes: MAX_VIDEO_BYTES + 1024 })
  assert.equal(r.status, 413)
  assert.match(r.body.message, /100 MB/)
})

test('a video between the image cap and the video cap is allowed', async () => {
  // The two caps must stay genuinely separate: enforcing 10 MB on everything
  // would quietly break the video support the picker advertises.
  const r = await send({ type: 'video/mp4', name: 'tour.mp4', bytes: MAX_IMAGE_BYTES + 1 })
  assert.equal(r.status, 201)
})

/* ══════════════════ 3. Unsupported type is 415 ═════════════════════ */

test('an unsupported file type is refused as 415 naming what is accepted', async () => {
  const r = await send({ type: 'application/pdf', name: 'plan.pdf' })
  assert.equal(r.status, 415)
  assert.match(r.body.message, /JPG/)
  assert.match(r.body.message, /MP4/)
})

test('a missing file is still a 400', async () => {
  const res = await fetch(baseUrl + '/api/upload', { method: 'POST', body: new FormData() })
  assert.equal(res.status, 400)
})

/* ══════════════════ 4. Provider errors stay opaque ═════════════════ */

test('a rejected asset is a 400 that does not leak the provider message', async () => {
  cloud.mode = 'reject'
  const r = await send()
  assert.equal(r.status, 400)
  assert.doesNotMatch(r.body.message, /Invalid image file/, 'the provider text must not be forwarded')
  assert.match(r.body.message, /size limits/)
})

test('an unreachable provider is a 502, with no host or address in the message', async () => {
  cloud.mode = 'down'
  const r = await send()
  assert.equal(r.status, 502)
  assert.doesNotMatch(r.body.message, /ETIMEDOUT|10\.0\.0\.1/)
  assert.match(r.body.message, /try again/i)
})

/* ══════════════════ 5. Authorisation is unchanged ══════════════════ */

test('an anonymous caller is still rejected before any file is read', async () => {
  currentUser = null
  const r = await send()
  assert.equal(r.status, 401)
})

test('a signed-in customer is still forbidden', async () => {
  currentUser = { _id: 'u', role: 'user', permissions: [] }
  const r = await send()
  assert.equal(r.status, 403)
})
