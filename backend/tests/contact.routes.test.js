// The public contact endpoint and the lead-routing categories it shares.
//
// ── Why this file exists ────────────────────────────────────────────────
// `Construction` was once missing from the interestType list in FOUR places at
// once — the model, the route validator, the LeadRouting model and the
// lead-routing route's ALL_TYPES. Three could be fixed while the fourth was
// forgotten and nothing would fail loudly.
//
// Phase 1B removed every one of those lists. Interests are records in the
// ContactInterest collection, created by admins at runtime. So the assertions
// below are about the same AGREEMENT, now against live data: whatever interest
// exists — built-in or admin-created, enabled or disabled — POST accepts it,
// lead routing offers it, and nothing else gets through.
//
// Only the genuine externals are replaced: MongoDB (the three models), the email
// sender, JWT verification and the role/permission gates (authorization has its
// own suite in contactInterests.routes.test.js). The routes, the service layer
// and the express-validator chain are real.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createFakeContactInterestModel } from './helpers/fakeContactInterestModel.js'
import { DEFAULT_CONTACT_INTEREST_VALUES } from '../config/contactInterests.js'

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

// ── Scripted databases ──────────────────────────────────────────────────
const calls = { create: [], notify: [], routingUpsert: [] }

const interests = createFakeContactInterestModel()
mock.module('../models/ContactInterest.js', { defaultExport: interests })

/** Admin-created interests present for the whole suite, beside the nine defaults. */
const DYNAMIC = [
  {
    id: 'investment_consultation',
    value: 'Investment Consultation',
    labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' },
    order: 10,
    enabled: true,
  },
  {
    id: 'land_acquisition',
    value: 'Land Acquisition',
    labels: { en: 'Land Acquisition' },
    order: 11,
    enabled: false,
  },
]

mock.module('../models/ContactSubmission.js', {
  defaultExport: {
    // The real schema only requires a string now; registration is the route's
    // job, which is exactly what these tests exercise.
    create: async (data) => {
      if (typeof data.interestType !== 'string' || data.interestType === '') {
        const err = new Error('ContactSubmission validation failed: interestType: Path `interestType` is required.')
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

const routingRows = new Map()

mock.module('../models/LeadRouting.js', {
  defaultExport: {
    find: async () => [...routingRows.values()].map((row) => structuredClone(row)),
    findOne: async ({ interestType }) => structuredClone(routingRows.get(interestType) ?? null),
    findOneAndUpdate: async (filter, update) => {
      calls.routingUpsert.push({ filter, update })
      const row = { interestType: filter.interestType, recipients: structuredClone(update.recipients) }
      routingRows.set(filter.interestType, row)
      return row
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

const { default: contactInterestRoutes } = await import('../routes/contactInterests.js')
const { default: contactRoutes } = await import('../routes/contact.js')
const { default: leadRoutingRoutes } = await import('../routes/leadRouting.js')
const { ensureDefaultContactInterests } = await import('../services/contactInterests.js')

let server
let baseUrl

const seedInterests = async () => {
  interests.docs.clear()
  await ensureDefaultContactInterests({ logger: { warn: () => {} } })
  for (const interest of DYNAMIC) await interests.create(interest)
}

before(async () => {
  await seedInterests()

  const app = express()
  app.use(express.json())
  app.use('/api/contact/interests', contactInterestRoutes)
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
  routingRows.clear()
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

const OWNER = { _id: 'owner-id', role: 'owner', permissions: [] }

const VALID = {
  name: 'Ada Yilmaz',
  email: 'ada@example.com',
  phone: '+90 532 000 00 00',
  interestType: 'General',
  message: 'Hello',
}

/** Every value a submission may carry: the defaults plus both admin-created interests. */
const REGISTERED = [...DEFAULT_CONTACT_INTEREST_VALUES, ...DYNAMIC.map((interest) => interest.value)]

/* ══════════════ 1. Every registered interest is accepted ══════════════ */

for (const interestType of REGISTERED) {
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

test('Construction and Troubleshoot remain separate accepted reasons', async () => {
  // Construction = commissioning a new build; Troubleshoot = a problem with
  // something already built. Different recipients, so never aliases.
  for (const interestType of ['Construction', 'Troubleshoot']) {
    for (const k of Object.keys(calls)) calls[k].length = 0
    const res = await request('POST', '/api/contact', { ...VALID, interestType })
    assert.equal(res.status, 201)
    assert.equal(calls.create[0].interestType, interestType)
  }
})

test('an admin-created interest is accepted without any code change', async () => {
  const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Investment Consultation' })

  assert.equal(res.status, 201)
  assert.equal(calls.create[0].interestType, 'Investment Consultation')
})

test('a DISABLED interest is still accepted, for older apps and old links', async () => {
  assert.equal(interests.docs.get('land_acquisition').enabled, false)

  const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Land Acquisition' })

  assert.equal(res.status, 201, 'disabling an interest must never turn a submission into a 400')
  assert.equal(calls.create[0].interestType, 'Land Acquisition')
  assert.equal(calls.notify[0].interestType, 'Land Acquisition')
})

test('the built-in values are accepted even before the defaults are in the database', async () => {
  interests.docs.clear()
  try {
    for (const interestType of DEFAULT_CONTACT_INTEREST_VALUES) {
      const res = await request('POST', '/api/contact', { ...VALID, interestType })
      assert.equal(res.status, 201, `${interestType} was refused without a database record`)
    }
  } finally {
    await seedInterests()
  }
})

test('built-in values never need a database lookup', async () => {
  interests.calls.length = 0
  await request('POST', '/api/contact', { ...VALID, interestType: 'Buying' })
  assert.equal(interests.calls.length, 0)
})

test('a failed lookup is a server error, not a validation verdict, and stores nothing', async () => {
  const realExists = interests.exists
  interests.exists = async () => { throw new Error('database unavailable') }
  try {
    const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Investment Consultation' })
    assert.equal(res.status, 500)
    assert.equal(calls.create.length, 0)
  } finally {
    interests.exists = realExists
  }
})

/* ══════════════ 2. Lead routing offers exactly what contact accepts ══════════════ */

test('lead routing offers every registered interest, enabled or disabled', async () => {
  currentUser = OWNER

  const res = await request('GET', '/api/lead-routing')
  assert.equal(res.status, 200)

  const offered = res.body.routing.map((r) => r.interestType)
  assert.deepEqual([...offered].sort(), [...REGISTERED].sort(),
    'lead routing and POST /api/contact disagree about which interests exist')
})

test('lead routing rows carry the English label and enabled state, and start with no recipients', async () => {
  currentUser = OWNER

  const { body } = await request('GET', '/api/lead-routing')
  const byType = Object.fromEntries(body.routing.map((row) => [row.interestType, row]))

  assert.deepEqual(byType['Investment Consultation'], {
    interestType: 'Investment Consultation', label: 'Investment Consultation', enabled: true, recipients: [],
  })
  assert.deepEqual(byType['Land Acquisition'], {
    interestType: 'Land Acquisition', label: 'Land Acquisition', enabled: false, recipients: [],
  })
  assert.equal(byType.General.label, 'General Enquiry')
})

test('every category lead routing offers is accepted by POST', async () => {
  currentUser = OWNER
  const { body } = await request('GET', '/api/lead-routing')
  currentUser = null

  for (const { interestType } of body.routing) {
    for (const k of Object.keys(calls)) calls[k].length = 0
    const res = await request('POST', '/api/contact', { ...VALID, interestType })
    assert.equal(res.status, 201, `lead routing offers '${interestType}' but POST rejects it`)
  }
})

test('a reason can be given recipients and routed', async () => {
  currentUser = OWNER

  const res = await request('PUT', '/api/lead-routing', {
    routing: [{ interestType: 'Construction', recipients: [{ email: 'build@varlikent.com', label: 'Build' }] }],
  })

  assert.equal(res.status, 200)
  assert.equal(calls.routingUpsert.length, 1)
  assert.equal(calls.routingUpsert[0].filter.interestType, 'Construction')
})

test('an admin-created interest can be routed, and so can a disabled one', async () => {
  currentUser = OWNER

  const res = await request('PUT', '/api/lead-routing', {
    routing: [
      { interestType: 'Investment Consultation', recipients: [{ email: 'invest@example.test', label: 'Investments' }] },
      { interestType: 'Land Acquisition', recipients: [{ email: 'land@example.test', label: '' }] },
    ],
  })

  assert.equal(res.status, 200)
  assert.deepEqual(calls.routingUpsert.map((c) => c.filter.interestType), ['Investment Consultation', 'Land Acquisition'])

  const { body } = await request('GET', '/api/lead-routing')
  const byType = Object.fromEntries(body.routing.map((row) => [row.interestType, row.recipients]))
  assert.deepEqual(byType['Investment Consultation'], [{ email: 'invest@example.test', label: 'Investments' }])
  assert.deepEqual(byType['Land Acquisition'], [{ email: 'land@example.test', label: '' }])
})

test('Construction and Troubleshoot hold independent recipient lists', async () => {
  currentUser = OWNER

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

const UNROUTABLE = [
  ['an arbitrary string', 'Gardening'],
  ['a stable id instead of the value', 'investment_consultation'],
  ['a translated label', 'Yatırım Danışmanlığı'],
  ['a near-miss spelling', 'Troubleshooting'],
  ['an empty string', ''],
]

for (const [label, interestType] of UNROUTABLE) {
  test(`lead routing refuses ${label}, and writes nothing from that request`, async () => {
    currentUser = OWNER

    const res = await request('PUT', '/api/lead-routing', {
      routing: [
        { interestType: 'General', recipients: [{ email: 'general@example.test', label: '' }] },
        { interestType, recipients: [{ email: 'x@example.test', label: '' }] },
      ],
    })

    assert.equal(res.status, 400)
    assert.equal(calls.routingUpsert.length, 0, 'the valid row before it was saved anyway')
  })
}

test('lead routing stores only email and label for each recipient', async () => {
  currentUser = OWNER

  const res = await request('PUT', '/api/lead-routing', {
    routing: [{
      interestType: 'General',
      recipients: [
        { email: '  general@example.test ', label: ' Front desk ', role: 'owner', permissions: ['user_management'] },
        { email: '', label: '' },
      ],
    }],
  })

  assert.equal(res.status, 200)
  assert.deepEqual(calls.routingUpsert[0].update.recipients, [{ email: 'general@example.test', label: 'Front desk' }],
    'extra fields were stored, or a blank row was kept')
})

test('a recipient with a label but no email is refused', async () => {
  currentUser = OWNER

  for (const routing of [
    [{ interestType: 'General', recipients: [{ label: 'No address' }] }],
    [{ interestType: 'General', recipients: 'general@example.test' }],
    [{ interestType: 'General', recipients: ['general@example.test'] }],
    'General',
  ]) {
    const res = await request('PUT', '/api/lead-routing', { routing })
    assert.equal(res.status, 400, `${JSON.stringify(routing)} was accepted`)
  }
  assert.equal(calls.routingUpsert.length, 0)
})

/* ══════════════ 3. Validation still rejects what it should ══════════════ */

const REJECTED = [
  ['an unknown reason', { interestType: 'Gardening' }],
  ['a translated reason', { interestType: 'İnşaat' }],
  ['a stable id', { interestType: 'construction' }],
  ['the stable id of an admin-created interest', { interestType: 'investment_consultation' }],
  ['the translated label of an admin-created interest', { interestType: 'Yatırım Danışmanlığı' }],
  ['a case variant of an admin-created value', { interestType: 'investment consultation' }],
  ['a lowercased Troubleshoot', { interestType: 'troubleshoot' }],
  ['the gerund spelling', { interestType: 'Troubleshooting' }],
  ['the department name instead of the reason', { interestType: 'Technical Support' }],
  ['a translated Troubleshoot label', { interestType: 'Sorun Giderme' }],
  ['a non-string interest', { interestType: { $ne: null } }],
  ['a missing interest', { interestType: undefined }],
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

test('an unregistered interest is reported on the interestType field', async () => {
  const res = await request('POST', '/api/contact', { ...VALID, interestType: 'Gardening' })

  assert.deepEqual(res.body.errors.map((e) => e.path), ['interestType'])
  assert.equal(res.body.errors[0].msg, 'Valid interest type is required')
})

test('field errors and an unregistered interest are reported together', async () => {
  const res = await request('POST', '/api/contact', { ...VALID, name: '', interestType: 'Gardening' })

  assert.deepEqual(res.body.errors.map((e) => e.path).sort(), ['interestType', 'name'])
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

/* ══════════════ 5. The public list and what POST accepts ══════════════ */

test('the public list offers enabled interests only, admin-created ones included', async () => {
  const res = await request('GET', '/api/contact/interests')
  const ids = res.body.interests.map((interest) => interest.id)

  assert.ok(ids.includes('investment_consultation'))
  assert.equal(ids.includes('land_acquisition'), false, 'a disabled interest was published')
  assert.ok(ids.includes('troubleshoot'))
  assert.ok(ids.includes('construction'))
})

test('every value the public list offers is accepted by POST', async () => {
  const res = await request('GET', '/api/contact/interests')

  for (const { value } of res.body.interests) {
    for (const key of Object.keys(calls)) calls[key].length = 0
    const post = await request('POST', '/api/contact', { ...VALID, interestType: value })
    assert.equal(post.status, 201, `the endpoint offers '${value}' but POST rejects it`)
  }
})

test('the public list never exposes configured routing recipients', async () => {
  routingRows.set('Investment Consultation', {
    interestType: 'Investment Consultation',
    recipients: [{ email: 'invest@example.test', label: 'Investments' }],
  })

  const raw = JSON.stringify((await request('GET', '/api/contact/interests')).body)

  assert.equal(raw.includes('@'), false, 'an email address reached the public vocabulary')
  assert.equal(/recipient/i.test(raw), false, 'routing data reached the public vocabulary')
})

/* ══════════════ 6. Only permitted fields are stored ══════════════ */

test('a mobile client can declare source: mobile', async () => {
  const res = await request('POST', '/api/contact', { ...VALID, source: 'mobile' })

  assert.equal(res.status, 201)
  assert.equal(calls.create[0].source, 'mobile')
})

test('a website client can declare source: website', async () => {
  const res = await request('POST', '/api/contact', { ...VALID, source: 'website' })

  assert.equal(res.status, 201)
  assert.equal(calls.create[0].source, 'website')
})

test('a client that sends no source is left to the schema default', async () => {
  // The website today, and every mobile build released before Phase 1.
  const res = await request('POST', '/api/contact', VALID)

  assert.equal(res.status, 201)
  assert.equal('source' in calls.create[0], false)
})

test('a public client cannot claim to be the AI assistant', async () => {
  const res = await request('POST', '/api/contact', { ...VALID, source: 'ai_assistant' })

  assert.equal(res.status, 201, 'the enquiry itself is still accepted')
  assert.equal('source' in calls.create[0], false, 'ai_assistant may only be set server-side')
})

test('a public client cannot set status or createdAt on its own submission', async () => {
  const res = await request('POST', '/api/contact', {
    ...VALID,
    status: 'Replied',
    createdAt: '2000-01-01T00:00:00.000Z',
  })

  assert.equal(res.status, 201)
  assert.equal('status' in calls.create[0], false)
  assert.equal('createdAt' in calls.create[0], false)
})
