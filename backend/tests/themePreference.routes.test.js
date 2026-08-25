// The canonical theme vocabulary — PUT /api/users/me/theme.
//
// This endpoint is the contract between the website, the backend and the mobile
// app. Mobile stores its own local theme ids and translates to these eight
// before syncing; if this list changes, mobile starts getting 400s again and the
// failure is invisible there by design (the sync is deliberately best-effort).
//
// So this file pins the list itself, not just the happy path. It is TEST-ONLY —
// no production behaviour is changed by it.
//
// The REAL router runs. Only genuine externals are faked: MongoDB, Cloudinary,
// and the auth/permission middleware.

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import mongoose from 'mongoose'

const CALLER = new mongoose.Types.ObjectId()

/** The vocabulary the website and mobile both depend on. */
const CANONICAL = [
  'default',
  'forest',
  'earth',
  'navy',
  'gold-white',
  'sand-travertine',
  'rosewood-blush',
  'blush-ivory',
]

/** Local mobile ids, which must NEVER be accepted — see theme-contract.ts. */
const MOBILE_LOCAL_ONLY = ['classic', 'dark', 'light']

// ── Scripted database ────────────────────────────────────────────────────
let updates = []

const FakeUser = {
  findByIdAndUpdate: (id, patch) => ({
    select: async () => {
      updates.push({ id: String(id), patch })
      return { _id: id, ...patch }
    },
  }),
  findById: () => ({ select: async () => null, populate: () => ({ select: async () => null }) }),
  find: () => ({ select: () => ({ sort: () => ({ limit: async () => [] }) }) }),
}

mock.module('../models/User.js', { defaultExport: FakeUser })

// Cloudinary is imported at module scope by the router and must not be reached.
mock.module('../config/cloudinary.js', {
  defaultExport: { uploader: { upload_stream: () => ({ end: () => {} }) } },
})

// ── Scripted identity ────────────────────────────────────────────────────
let caller = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!caller) return res.status(401).json({ success: false, message: 'Not authorized' })
      req.user = caller
      next()
    },
  },
})

mock.module('../middleware/checkPermission.js', {
  namedExports: {
    requireRole: () => (req, res, next) => next(),
    requirePermission: () => (req, res, next) => next(),
  },
})

// ── Server under test ────────────────────────────────────────────────────
let server
let baseUrl

before(async () => {
  const { default: routes } = await import('../routes/users.js')
  const app = express()
  app.use(express.json())
  app.use('/api/users', routes)
  app.use((err, req, res, _next) => res.status(500).json({ success: false, message: err.message }))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((r) => server.close(r))
})

const setTheme = async (theme) => {
  const response = await fetch(`${baseUrl}/api/users/me/theme`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme }),
  })
  return { status: response.status, body: await response.json() }
}

test.beforeEach(() => {
  updates = []
  caller = { _id: CALLER, role: 'user' }
})

/* ═══════════════ The canonical eight ═══════════════ */

test('1. every canonical theme is accepted and stored', async () => {
  for (const theme of CANONICAL) {
    updates = []

    const { status } = await setTheme(theme)

    assert.equal(status, 200, `${theme} must be accepted`)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].patch.themePreference, theme)
  }
})

/* ═══════════════ What must be rejected ═══════════════ */

test('2. mobile local-only ids are rejected — this is why the adapter exists', async () => {
  // classic / dark / light are what mobile used to send directly. If any of
  // these starts returning 200, two vocabularies are being stored in one field.
  for (const theme of MOBILE_LOCAL_ONLY) {
    updates = []

    const { status } = await setTheme(theme)

    assert.equal(status, 400, `${theme} must NOT be accepted`)
    assert.equal(updates.length, 0, 'nothing may be written')
  }
})

test('3. junk values are rejected and store nothing', async () => {
  for (const theme of ['', 'nonsense', 'DEFAULT', null, undefined, 42, {}, []]) {
    updates = []

    const { status } = await setTheme(theme)

    assert.equal(status, 400, `${JSON.stringify(theme)} must be rejected`)
    assert.equal(updates.length, 0)
  }
})

test('4. an unauthenticated caller cannot set a theme', async () => {
  caller = null

  const { status } = await setTheme('default')

  assert.equal(status, 401)
  assert.equal(updates.length, 0)
})

/* ═══════════════ The vocabulary itself ═══════════════ */

test('5. the accepted set is EXACTLY these eight — no more, no fewer', async () => {
  // Guards both directions: a theme silently dropped would break the website,
  // and a theme silently added would go unnoticed by mobile's adapter.
  const accepted = []

  for (const theme of [...CANONICAL, ...MOBILE_LOCAL_ONLY, 'earth-tone', 'blush', 'navy-blue']) {
    const { status } = await setTheme(theme)
    if (status === 200) accepted.push(theme)
  }

  assert.deepEqual(accepted, CANONICAL)
})

test('6. the field is stored verbatim, with no normalisation', async () => {
  // Mobile relies on reading back exactly what it wrote — fromSharedThemeId
  // translates, it does not guess.
  await setTheme('sand-travertine')

  assert.equal(updates[0].patch.themePreference, 'sand-travertine')
})
