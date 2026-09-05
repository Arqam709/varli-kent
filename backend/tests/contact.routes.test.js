// The public contact endpoint and the lead-routing vocabulary it shares.
//
// ── Why this file exists ────────────────────────────────────────────────
// `Construction` was missing from the interestType enum in FOUR places at
// once — the model, the route validator, the LeadRouting model and the
// lead-routing route's ALL_TYPES. Three of the four could be fixed while the
// fourth was forgotten and nothing would fail loudly: the submission would be
// accepted and then routed to nobody, or accepted by the API and rejected by
// Mongoose on save.
//
// So the assertions below are deliberately about AGREEMENT between those four
// lists, not just about Construction. That paid off: 'Troubleshoot' was added
// as the ninth reason and had to be threaded through all four before the
// agreement test below would pass again.
//
// Only the genuine externals are replaced: MongoDB (the two models), the email
// sender, and JWT verification. The route logic and the express-validator
// chain under test are the real ones.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

// ── The signed-in actor ─────────────────────────────────────────────────
let currentUser = null

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

// ── Scripted database ───────────────────────────────────────────────────
const calls = { create: [], notify: [], routingUpsert: [] }

/**
 * A stand-in that enforces the MODEL's enum the way Mongoose would.
 *
 * Without this the test would prove the route validator accepts Construction
 * while saying nothing about whether the document could actually be stored —
 * which is exactly the half-fix this file exists to prevent.
 */
const CONTACT_ENUM = [
  'Buying', 'Selling', 'Renting', 'Renovation',
  'Interior Design', 'Architecture', 'Construction', 'General', 'Troubleshoot',
]

mock.module('../models/ContactSubmission.js', {
  defaultExport: {
    create: async (data) => {
      if (!CONTACT_ENUM.includes(data.interestType)) {
        const err = new Error(`ContactSubmission validation failed: interestType: \`${data.interestType}\` is not a valid enum value`)
        err.name = 'ValidationError'
        throw err
      }
      calls.create.push(data)
      return { _id: 'c1', status: 'New', source: 'website', ...data }
    },
    find: () => ({ sort: async () => [] }),
    findByIdAndUpdate: async () => null,
    findByIdAndDelete: async () => null,
  },
})

mock.module('../models/LeadRouting.js', {
  defaultExport: {
    find: async () => [],
    findOne: async () => null,
    findOneAndUpdate: async (filter, update) => {
      calls.routingUpsert.push({ filter, update })
      return { interestType: filter.interestType, recipients: update.recipients }
    },
  },
})

mock.module('../utils/email.js', {
  namedExports: {
    sendContactNotification: async (submission) => {
      calls.notify.push(submission)
      return true
    },
  },
})

mock.module('../middleware/checkPermission.js', {
  namedExports: {
    requireRole: () => (req, res, next) => next(),
    requirePermission: () => (req, res, next) => next(),
  },
})

const { default: contactRoutes } = await import('../routes/contact.js')
const { default: leadRoutingRoutes } = await import('../routes/leadRouting.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/contact', contactRoutes)
  app.use('/api/lead-routing', leadRoutingRoutes)
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message })
  })
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

beforeEach(() => {
  currentUser = null
  for (const k of Object.keys(calls)) calls[k].length = 0
})

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const VALID = {
  name: 'Ada Yilmaz',
  email: 'ada@example.com',
  phone: '+90 532 000 00 00',
  interestType: 'General',
  message: 'Hello',
}

/* ══════════════ 1. Every reason the clients offer is accepted ══════════════ */

// The list both the website select and the mobile chips render.
const REASONS = [
  'Buying', 'Selling', 'Renting', 'Renovation',
  'Interior Design', 'Architecture', 'Construction', 'General', 'Troubleshoot',
]

for (const interestType of REASONS) {
  test(`accepts interestType "${interestType}"`, async () => {
    const res = await request('POST', '/api/contact', { ...VALID, interestType })

    assert.equal(res.status, 201, `${interestType} must be accepted`)
    assert.equal(res.body.success, true)
    assert.equal(calls.create.length, 1, 'exactly one submission is stored')
    assert.equal(calls.create[0].interestType, interestType,
      'the canonical value is stored verbatim, never translated')
    assert.equal(calls.notify.length, 1, 'a lead notification is sent')
    assert.equal(calls.notify[0].interestType, interestType,
      'routing keys off the same canonical value')
  })
}

test('Construction specifically: accepted by the validator AND storable by the model', async () => {
  // The regression guard. Before this change the route rejected it with 400;
  // a partial fix would have let the route through and failed on save.
  const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Construction' })

  assert.equal(res.status, 201)
  assert.equal(calls.create[0].interestType, 'Construction')
})

test('Troubleshoot specifically: accepted by the validator AND storable by the model', async () => {
  // The technical-support reason. Same two-layer check as Construction: the
  // validator must let it through AND the model enum must be able to store it.
  const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Troubleshoot' })

  assert.equal(res.status, 201)
  assert.equal(calls.create[0].interestType, 'Troubleshoot',
    'the canonical English value is stored, never a localized label')
  assert.equal(calls.notify[0].interestType, 'Troubleshoot',
    'the notifier receives the same string it will use as the LeadRouting key')
})

test('Construction and Troubleshoot are separate reasons, not aliases', async () => {
  // The business distinction this feature exists for: Construction is a visitor
  // commissioning a new build; Troubleshoot is a visitor reporting a problem with
  // something already built. They must be able to carry different recipients, so
  // neither may be silently folded into the other.
  assert.ok(REASONS.includes('Construction'), 'Construction was dropped')
  assert.ok(REASONS.includes('Troubleshoot'), 'Troubleshoot is missing')

  await request('POST', '/api/contact', { ...VALID, interestType: 'Construction' })
  const stored = calls.create[0].interestType
  assert.equal(stored, 'Construction', 'a Construction lead must not be rewritten to Troubleshoot')
})

/* ══════════════ 2. The four lists agree ══════════════ */

test('lead routing offers exactly the reasons contact accepts', async () => {
  currentUser = { _id: 'owner-id', role: 'owner', permissions: [] }

  const res = await request('GET', '/api/lead-routing')
  assert.equal(res.status, 200)

  const offered = res.body.routing.map((r) => r.interestType)

  // Sorted, because the two lists are maintained in different files and their
  // ORDER is a presentation choice — only the SET has to match.
  assert.deepEqual(
    [...offered].sort(),
    [...REASONS].sort(),
    'ALL_TYPES and the contact validator have drifted apart'
  )
})

test('a reason can be given recipients and routed', async () => {
  currentUser = { _id: 'owner-id', role: 'owner', permissions: [] }

  const res = await request('PUT', '/api/lead-routing', {
    routing: [{ interestType: 'Construction', recipients: [{ email: 'build@varlikent.com', label: 'Build' }] }],
  })

  assert.equal(res.status, 200)
  assert.equal(calls.routingUpsert.length, 1)
  assert.equal(calls.routingUpsert[0].filter.interestType, 'Construction')
})

test('Troubleshoot can be given its own technical recipients', async () => {
  // This IS the "routes to the technical department" mechanism: there is no
  // department model and no technical role — an owner types addresses into the
  // Troubleshoot row and sendContactNotification() looks them up by this key.
  currentUser = { _id: 'owner-id', role: 'owner', permissions: [] }

  const res = await request('PUT', '/api/lead-routing', {
    routing: [{
      interestType: 'Troubleshoot',
      recipients: [{ email: 'technical@example.test', label: 'Technical' }],
    }],
  })

  assert.equal(res.status, 200)
  assert.equal(calls.routingUpsert.length, 1)
  assert.equal(calls.routingUpsert[0].filter.interestType, 'Troubleshoot',
    'the upsert keys off the canonical value the contact form submits')
  assert.deepEqual(calls.routingUpsert[0].update.recipients,
    [{ email: 'technical@example.test', label: 'Technical' }])
})

test('Construction and Troubleshoot hold independent recipient lists', async () => {
  currentUser = { _id: 'owner-id', role: 'owner', permissions: [] }

  await request('PUT', '/api/lead-routing', {
    routing: [
      { interestType: 'Construction', recipients: [{ email: 'build@example.test', label: 'Build' }] },
      { interestType: 'Troubleshoot', recipients: [{ email: 'technical@example.test', label: 'Technical' }] },
    ],
  })

  assert.equal(calls.routingUpsert.length, 2, 'both rows are written, neither collapsed into the other')
  const byType = Object.fromEntries(
    calls.routingUpsert.map((c) => [c.filter.interestType, c.update.recipients[0].email])
  )
  assert.equal(byType.Construction, 'build@example.test')
  assert.equal(byType.Troubleshoot, 'technical@example.test')
})

/* ══════════════ 3. Validation still rejects what it should ══════════════ */

const REJECTED = [
  ['an unknown reason', { interestType: 'Gardening' }],
  ['a translated reason', { interestType: 'İnşaat' }],
  ['a lowercased reason', { interestType: 'construction' }],
  // The near-miss spellings of the newest reason. Each is a plausible typo in a
  // client that hardcodes the string instead of reading it from the shared list,
  // and each must fail loudly rather than be stored as a category nothing routes.
  ['a lowercased Troubleshoot', { interestType: 'troubleshoot' }],
  ['the gerund spelling', { interestType: 'Troubleshooting' }],
  ['the department name instead of the reason', { interestType: 'Technical Support' }],
  ['a bare department name', { interestType: 'Technical' }],
  ['a translated Troubleshoot label', { interestType: 'Sorun Giderme' }],
  ['a missing name', { name: '' }],
  ['a malformed email', { email: 'not-an-email' }],
  ['a missing phone', { phone: '' }],
  ['an empty message', { message: '' }],
]

for (const [label, override] of REJECTED) {
  test(`rejects ${label}`, async () => {
    const res = await request('POST', '/api/contact', { ...VALID, ...override })

    assert.equal(res.status, 400)
    assert.equal(calls.create.length, 0, 'nothing may be stored')
    assert.equal(calls.notify.length, 0, 'no lead email for a rejected submission')
    assert.ok(Array.isArray(res.body.errors), 'the express-validator error shape is preserved')
  })
}

test('a translated reason is refused rather than silently stored', async () => {
  // The website had this exact bug: the select submitted the LABEL, so a
  // Turkish visitor sent "Satın Alma" and was rejected by the enum. Both
  // clients now send canonical English; this pins that contract.
  const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Satın Alma' })

  assert.equal(res.status, 400)
  assert.equal(calls.create.length, 0)
})

/* ══════════════ 4. The endpoint stays public ══════════════ */

test('submitting requires no authentication', async () => {
  currentUser = null

  const res = await request('POST', '/api/contact', VALID)

  assert.equal(res.status, 201, 'a general enquiry must not require an account')
})

test('reading submissions still requires authentication', async () => {
  currentUser = null

  const res = await request('GET', '/api/contact')

  assert.equal(res.status, 401, 'the inbox is staff-only')
})
