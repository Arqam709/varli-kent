// The Contact interest API — public vocabulary and admin management (Phase 1B).
//
// ── What is real and what is replaced ───────────────────────────────────
// Real: the interest, contact and lead-routing routers, their validation, the
// service layer, and the AUTHORIZATION middleware (requireRole /
// requirePermission) — who may manage interests is under test here.
// Replaced: JWT verification (protect), MongoDB (the three models) and the
// mailer.
//
// The ContactInterest stand-in (tests/helpers/fakeContactInterestModel.js)
// enforces the unique indexes on id and value the way MongoDB does. Every test
// starts from a freshly bootstrapped collection holding the nine defaults.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createFakeContactInterestModel } from './helpers/fakeContactInterestModel.js'
import { DEFAULT_CONTACT_INTERESTS, getDefaultPublicContactInterests } from '../config/contactInterests.js'

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

// ── Databases ───────────────────────────────────────────────────────────
const interests = createFakeContactInterestModel()
mock.module('../models/ContactInterest.js', { defaultExport: interests })

const routingRows = new Map()
/** Every write lead routing performs. Deletions are recorded so their absence can be asserted. */
const routingWrites = []

mock.module('../models/LeadRouting.js', {
  defaultExport: {
    find: async () => [...routingRows.values()].map((row) => structuredClone(row)),
    findOne: async ({ interestType }) => structuredClone(routingRows.get(interestType) ?? null),
    findOneAndUpdate: async (filter, update) => {
      routingWrites.push({ op: 'upsert', filter, update })
      const row = { interestType: filter.interestType, recipients: structuredClone(update.recipients) }
      routingRows.set(filter.interestType, row)
      return row
    },
    deleteOne: async (filter) => { routingWrites.push({ op: 'deleteOne', filter }) },
    deleteMany: async (filter) => { routingWrites.push({ op: 'deleteMany', filter }) },
    findOneAndDelete: async (filter) => { routingWrites.push({ op: 'findOneAndDelete', filter }) },
  },
})

const submissions = []
mock.module('../models/ContactSubmission.js', {
  defaultExport: {
    create: async (data) => {
      submissions.push(structuredClone(data))
      return { _id: `s${submissions.length}`, status: 'New', source: 'website', ...data }
    },
    find: () => ({ sort: async () => [] }),
    findByIdAndUpdate: async () => null,
    findByIdAndDelete: async () => null,
  },
})

const notified = []
mock.module('../utils/email.js', {
  namedExports: {
    sendContactNotification: async (submission) => {
      notified.push(submission)
      return true
    },
  },
})

const { default: contactInterestRoutes } = await import('../routes/contactInterests.js')
const { default: contactRoutes } = await import('../routes/contact.js')
const { default: leadRoutingRoutes } = await import('../routes/leadRouting.js')
const { ensureDefaultContactInterests } = await import('../services/contactInterests.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  // Same order as server.js.
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

beforeEach(async () => {
  currentUser = null
  interests.docs.clear()
  interests.failures.create = null
  await ensureDefaultContactInterests({ logger: { warn: () => {} } })
  interests.calls.length = 0
  routingRows.clear()
  routingWrites.length = 0
  submissions.length = 0
  notified.length = 0
})

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}

const as = async (user, method, path, body) => {
  currentUser = user
  try {
    return await request(method, path, body)
  } finally {
    currentUser = null
  }
}

const OWNER = { _id: 'o1', name: 'Owner', email: 'o@example.test', role: 'owner', permissions: [] }
const ADMIN_WITH = { _id: 'a1', name: 'Admin', email: 'a@example.test', role: 'admin', permissions: ['manage_page_content'] }
const ADMIN_WITHOUT = { _id: 'a2', name: 'Admin2', email: 'a2@example.test', role: 'admin', permissions: ['manage_about', 'view_contacts'] }
const AGENT = { _id: 'g1', name: 'Agent', email: 'g@example.test', role: 'agent', permissions: ['manage_page_content'] }
const CUSTOMER = { _id: 'u1', name: 'User', email: 'u@example.test', role: 'user', permissions: [] }

const INVESTMENT = { labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' } }

const create = (body = INVESTMENT, user = ADMIN_WITH) => as(user, 'POST', '/api/contact/interests', body)
const patch = (id, body, user = ADMIN_WITH) => as(user, 'PATCH', `/api/contact/interests/${id}`, body)
const publicList = async () => (await request('GET', '/api/contact/interests')).body.interests
const publicIds = async () => (await publicList()).map((interest) => interest.id)
const stored = (id) => structuredClone(interests.docs.get(id))

const VALID_ENQUIRY = {
  name: 'Ada Yilmaz',
  email: 'ada@example.com',
  phone: '+90 532 000 00 00',
  interestType: 'General',
  message: 'Hello',
}

/* ══════════════ 1. Public GET ══════════════ */

test('1a. GET /api/contact/interests is public and serves the bootstrapped defaults', async () => {
  const res = await request('GET', '/api/contact/interests')

  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.deepEqual(res.body.interests, getDefaultPublicContactInterests(),
    'a freshly bootstrapped database serves exactly the Phase 1A contract')
})

test('1b. the response must be revalidated, so admin edits reach visitors on their next load', async () => {
  const res = await request('GET', '/api/contact/interests')
  assert.equal(res.headers.get('cache-control'), 'no-cache')
})

test('1c. each entry exposes only id, value, labels and order', async () => {
  for (const interest of await publicList()) {
    assert.deepEqual(Object.keys(interest).sort(), ['id', 'labels', 'order', 'value'])
  }
})

test('1d. no routing data, email address or database bookkeeping reaches the public list', async () => {
  routingRows.set('Construction', { interestType: 'Construction', recipients: [{ email: 'build@example.test', label: 'Build' }] })

  const raw = JSON.stringify((await request('GET', '/api/contact/interests')).body)

  assert.equal(raw.includes('@'), false)
  for (const leaked of ['recipient', '_id', '__v', 'createdAt', 'updatedAt', 'enabled', 'permission']) {
    assert.equal(raw.includes(leaked), false, `'${leaked}' reached the public list`)
  }
})

test('1e. entries sharing an order are broken by id, the same way every time', async () => {
  interests.docs.get('construction').order = 1 // ties with buying

  const first = await publicIds()
  const second = await publicIds()

  assert.deepEqual(first.slice(0, 2), ['buying', 'construction'])
  assert.deepEqual(first, second)
})

test('1f. an empty collection yields an empty list, which both clients ignore in favour of their fallback', async () => {
  interests.docs.clear()
  const res = await request('GET', '/api/contact/interests')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.interests, [])
})

/* ══════════════ 2. Who may manage interests ══════════════ */

const ADMIN_ROUTES = [
  ['GET', '/api/contact/interests/manage', undefined],
  ['POST', '/api/contact/interests', INVESTMENT],
  ['PATCH', '/api/contact/interests/buying', { order: 3 }],
]

for (const [method, path, body] of ADMIN_ROUTES) {
  test(`2a. ${method} ${path} refuses anyone without manage_page_content, before touching the database`, async () => {
    for (const [who, user, status] of [
      ['a visitor', null, 401],
      ['a signed-in customer', CUSTOMER, 403],
      ['an agent (even holding the permission)', AGENT, 403],
      ['an admin without manage_page_content', ADMIN_WITHOUT, 403],
    ]) {
      interests.calls.length = 0
      const before = structuredClone([...interests.docs.values()])

      const res = await as(user, method, path, body)

      assert.equal(res.status, status, `${who} got ${res.status}`)
      assert.equal(interests.calls.length, 0, `${who} reached the database`)
      assert.deepEqual(structuredClone([...interests.docs.values()]), before, `${who} changed data`)
    }
  })

  test(`2b. ${method} ${path} is allowed for the owner and for an admin with manage_page_content`, async () => {
    for (const user of [OWNER, ADMIN_WITH]) {
      interests.docs.delete('investment_consultation')
      const res = await as(user, method, path, body)
      assert.ok(res.status >= 200 && res.status < 300, `${user.role} got ${res.status}: ${JSON.stringify(res.body)}`)
    }
  })
}

test('2c. lead routing stays owner-only — manage_page_content does not unlock recipients', async () => {
  assert.equal((await as(ADMIN_WITH, 'GET', '/api/lead-routing')).status, 403)
  assert.equal((await as(ADMIN_WITH, 'PUT', '/api/lead-routing', { routing: [] })).status, 403)
  assert.equal((await as(OWNER, 'GET', '/api/lead-routing')).status, 200)
})

test('2d. literal paths under /api/contact/interests never fall through to the submission routes', async () => {
  // PATCH /api/contact/:id/status would otherwise match /interests/status.
  const res = await patch('status', { order: 1 })
  assert.equal(res.status, 404)
  assert.equal(res.body.message, 'Contact interest not found')
})

/* ══════════════ 3. The management list ══════════════ */

test('3a. the management list includes disabled interests, marked, in public order', async () => {
  interests.docs.get('selling').enabled = false

  const res = await as(ADMIN_WITH, 'GET', '/api/contact/interests/manage')

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(res.body.interests.map((i) => i.id), DEFAULT_CONTACT_INTERESTS.map((i) => i.id))
  assert.equal(res.body.interests.find((i) => i.id === 'selling').enabled, false)
  assert.equal(res.body.interests.find((i) => i.id === 'buying').enabled, true)
})

test('3b. management entries carry no Mongo internals', async () => {
  const res = await as(ADMIN_WITH, 'GET', '/api/contact/interests/manage')
  for (const interest of res.body.interests) {
    assert.deepEqual(Object.keys(interest).sort(), ['createdAt', 'enabled', 'id', 'labels', 'order', 'updatedAt', 'value'])
  }
})

/* ══════════════ 4. Creating ══════════════ */

test('4a. creating an interest derives its id and canonical value on the server', async () => {
  const res = await create()

  assert.equal(res.status, 201)
  assert.equal(res.body.interest.id, 'investment_consultation')
  assert.equal(res.body.interest.value, 'Investment Consultation')
  assert.deepEqual(res.body.interest.labels, { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' })
  assert.equal(res.body.interest.enabled, true)
  assert.equal(res.body.interest.order, 10, 'a new interest goes after the highest existing order')

  assert.equal(stored('investment_consultation').value, 'Investment Consultation')
})

test('4b. the value is the English label trimmed, with inner whitespace collapsed', async () => {
  const res = await create({ labels: { en: '  Investment    Consultation  ' } })

  assert.equal(res.status, 201)
  assert.equal(res.body.interest.value, 'Investment Consultation')
  assert.equal(res.body.interest.id, 'investment_consultation')
})

test('4c. other languages are optional; blank ones are simply omitted', async () => {
  const res = await create({ labels: { en: 'Land Acquisition', tr: '   ', ar: '', de: 'Grundstückserwerb' } })

  assert.equal(res.status, 201)
  assert.deepEqual(res.body.interest.labels, { en: 'Land Acquisition', de: 'Grundstückserwerb' })
})

test('4d. an English label is required', async () => {
  for (const body of [{}, { labels: {} }, { labels: { en: '' } }, { labels: { en: '   ' } }, { labels: { tr: 'Yatırım' } }]) {
    const res = await create(body)
    assert.equal(res.status, 400, `${JSON.stringify(body)} was accepted`)
  }
  assert.equal(interests.docs.size, 9, 'nothing was created')
})

test('4e. a client cannot choose the id or the value', async () => {
  for (const body of [
    { ...INVESTMENT, id: 'investment_consultation' },
    { ...INVESTMENT, value: 'Investment Consultation' },
    { ...INVESTMENT, id: 'hijack', value: 'Buying' },
  ]) {
    const res = await create(body)
    assert.equal(res.status, 400)
    assert.match(res.body.message, /generated from the English label/)
  }
  assert.equal(interests.docs.size, 9)
})

test('4f. unexpected fields are rejected rather than stored', async () => {
  for (const extra of [{ recipients: [{ email: 'x@example.test' }] }, { createdAt: '2000-01-01' }, { _id: 'abc' }, { system: true }]) {
    const res = await create({ ...INVESTMENT, ...extra })
    assert.equal(res.status, 400, `${JSON.stringify(extra)} was accepted`)
    assert.match(res.body.message, /Unsupported field/)
  }
  assert.equal(interests.docs.size, 9)
})

test('4g. labels are validated: languages, types and length', async () => {
  for (const labels of [
    { en: 'Investment', fr: 'Investissement' },
    { en: 'Investment', tr: 42 },
    { en: ['Investment'] },
    'Investment',
    { en: 'x'.repeat(81) },
  ]) {
    const res = await create({ labels })
    assert.equal(res.status, 400, `${JSON.stringify(labels)} was accepted`)
  }
  assert.equal(interests.docs.size, 9)
})

test('4h. order must be a whole number in range when supplied, and is honoured', async () => {
  for (const order of [-1, 1.5, '3', 10000, null]) {
    const res = await create({ ...INVESTMENT, order })
    assert.equal(res.status, 400, `order ${JSON.stringify(order)} was accepted`)
  }

  const res = await create({ ...INVESTMENT, order: 0 })
  assert.equal(res.status, 201)
  assert.equal((await publicIds())[0], 'investment_consultation')
})

test('4i. enabled must be a boolean; an interest can be created hidden', async () => {
  assert.equal((await create({ ...INVESTMENT, enabled: 'true' })).status, 400)

  const res = await create({ ...INVESTMENT, enabled: false })
  assert.equal(res.status, 201)
  assert.equal((await publicIds()).includes('investment_consultation'), false)
})

test('4j. a label whose id already exists is a 409, not a silently suffixed id', async () => {
  const buying = await create({ labels: { en: 'buying' } })
  assert.equal(buying.status, 409)
  assert.match(buying.body.message, /'buying' already exists/)

  assert.equal((await create()).status, 201)
  const again = await create({ labels: { en: 'INVESTMENT consultation' } })
  assert.equal(again.status, 409)

  assert.equal([...interests.docs.keys()].filter((id) => id.startsWith('investment')).length, 1)
})

test('4k. a value that already exists under another id is a 409', async () => {
  interests.seed([
    ...[...interests.docs.values()].map((doc) => structuredClone(doc)),
    { id: 'invest', value: 'Investment Consultation', labels: { en: 'Investing' }, order: 10, enabled: true },
  ])

  const res = await create()
  assert.equal(res.status, 409)
  assert.match(res.body.message, /value 'Investment Consultation' already exists/)
})

test('4l. losing a creation race to the unique index is a clean 409', async () => {
  interests.failures.create = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })

  const res = await create()

  assert.equal(res.status, 409)
  assert.equal(interests.docs.has('investment_consultation'), false)
})

test('4m. two admins creating the same interest at once produce one record', async () => {
  // Signed in once for both requests: as() resets the actor when a request
  // finishes, which would race the second of two concurrent calls.
  currentUser = OWNER
  const results = await Promise.all([
    request('POST', '/api/contact/interests', INVESTMENT),
    request('POST', '/api/contact/interests', INVESTMENT),
  ])
  currentUser = null

  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  assert.equal([...interests.docs.values()].filter((doc) => doc.value === 'Investment Consultation').length, 1)
})

test('4n. an English label that cannot produce an id is refused with an explanation', async () => {
  for (const en of ['3D Design', 'تصميم', '!!!']) {
    const res = await create({ labels: { en } })
    assert.equal(res.status, 400, `${en} was accepted`)
    assert.match(res.body.message, /Latin letter/)
  }
})

/* ══════════════ 5. Updating ══════════════ */

test('5a. labels can be edited, replacing the whole set', async () => {
  const res = await patch('interior_design', { labels: { en: 'Interiors', tr: 'İç Tasarım' } })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.interest.labels, { en: 'Interiors', tr: 'İç Tasarım' },
    'languages left out of the edit are removed, so they fall back to English')
  assert.equal(res.body.interest.value, 'Interior Design', 'the canonical value never follows the label')

  const published = (await publicList()).find((interest) => interest.id === 'interior_design')
  assert.deepEqual(published.labels, { en: 'Interiors', tr: 'İç Tasarım' })
  assert.equal(published.value, 'Interior Design')
})

test('5b. changing order changes the public order', async () => {
  assert.equal((await patch('troubleshoot', { order: 0 })).status, 200)
  assert.equal((await publicIds())[0], 'troubleshoot')
})

test('5c. disabling hides an interest publicly; re-enabling restores it', async () => {
  const disabled = await patch('selling', { enabled: false })
  assert.equal(disabled.status, 200)
  assert.equal(disabled.body.interest.enabled, false)
  assert.equal((await publicIds()).includes('selling'), false)

  const managed = await as(ADMIN_WITH, 'GET', '/api/contact/interests/manage')
  assert.equal(managed.body.interests.find((i) => i.id === 'selling').enabled, false, 'still listed for admins')

  assert.equal((await patch('selling', { enabled: true })).status, 200)
  assert.equal((await publicIds()).includes('selling'), true)
})

test('5d. id and value cannot be changed after creation', async () => {
  for (const body of [{ id: 'renamed' }, { value: 'Renamed' }, { labels: { en: 'Buy' }, value: 'Buy' }]) {
    const res = await patch('buying', body)
    assert.equal(res.status, 400)
    assert.match(res.body.message, /cannot be changed after creation/)
  }

  assert.equal(stored('buying').value, 'Buying')
  assert.deepEqual(stored('buying').labels.en, 'Buying', 'a rejected request applied none of its fields')
  assert.equal(interests.calls.some((call) => call.method === 'findOneAndUpdate'), false)
})

test('5e. unexpected fields, empty bodies and non-object bodies are rejected', async () => {
  for (const body of [{ order: 2, createdAt: '2000-01-01' }, { recipients: [] }, {}, [], 'enabled']) {
    const res = await patch('buying', body)
    assert.equal(res.status, 400, `${JSON.stringify(body)} was accepted`)
  }
  assert.equal(stored('buying').order, 1)
})

test('5f. updates are validated like creation', async () => {
  for (const body of [
    { labels: { tr: 'Satın Alma' } },
    { labels: { en: '   ' } },
    { order: -5 },
    { order: 2.5 },
    { enabled: 'no' },
  ]) {
    assert.equal((await patch('buying', body)).status, 400, `${JSON.stringify(body)} was accepted`)
  }
})

test('5g. an unknown or malformed id is a 404', async () => {
  assert.equal((await patch('gardening', { order: 1 })).status, 404)
  assert.equal((await patch('Buying', { order: 1 })).status, 404)
  assert.equal((await patch('interior-design', { order: 1 })).status, 404)
})

test('5h. the last enabled interest cannot be disabled', async () => {
  for (const interest of DEFAULT_CONTACT_INTERESTS.filter((i) => i.id !== 'general')) {
    interests.docs.get(interest.id).enabled = false
  }

  const res = await patch('general', { enabled: false })

  assert.equal(res.status, 409)
  assert.equal(stored('general').enabled, true)
})

test('5i. interests cannot be deleted — only disabled', async () => {
  for (const path of ['/api/contact/interests/buying', '/api/contact/interests']) {
    const res = await as(OWNER, 'DELETE', path)
    assert.equal(res.status, 405)
  }
  assert.equal(interests.docs.size, 9)
})

/* ══════════════ 6. The whole lifecycle ══════════════ */

test('6. create → submit → route → disable (still accepted, routing kept) → re-enable', async () => {
  // An admin adds the interest; new visitors see it immediately.
  assert.equal((await create()).status, 201)
  assert.ok((await publicIds()).includes('investment_consultation'))

  // A mobile visitor submits its canonical value.
  let post = await request('POST', '/api/contact', {
    ...VALID_ENQUIRY, interestType: 'Investment Consultation', source: 'mobile',
  })
  assert.equal(post.status, 201)
  assert.equal(submissions.at(-1).interestType, 'Investment Consultation')
  assert.equal(submissions.at(-1).source, 'mobile')
  assert.equal(notified.at(-1).interestType, 'Investment Consultation', 'routing keys off the canonical value')

  // The owner finds it in Lead Routing without a code change, and routes it.
  let routing = await as(OWNER, 'GET', '/api/lead-routing')
  assert.deepEqual(routing.body.routing.find((row) => row.interestType === 'Investment Consultation'), {
    interestType: 'Investment Consultation', label: 'Investment Consultation', enabled: true, recipients: [],
  })
  const recipients = [{ email: 'invest@example.test', label: 'Investments' }]
  assert.equal((await as(OWNER, 'PUT', '/api/lead-routing', {
    routing: [{ interestType: 'Investment Consultation', recipients }],
  })).status, 200)

  // Disabled: gone from the public list…
  assert.equal((await patch('investment_consultation', { enabled: false })).status, 200)
  assert.equal((await publicIds()).includes('investment_consultation'), false)

  // …but an older client that still offers it is not turned away…
  post = await request('POST', '/api/contact', { ...VALID_ENQUIRY, interestType: 'Investment Consultation' })
  assert.equal(post.status, 201)

  // …and its routing is intact, shown as disabled.
  routing = await as(OWNER, 'GET', '/api/lead-routing')
  assert.deepEqual(routing.body.routing.find((row) => row.interestType === 'Investment Consultation'), {
    interestType: 'Investment Consultation', label: 'Investment Consultation', enabled: false, recipients,
  })
  assert.deepEqual(routingWrites.filter((write) => write.op !== 'upsert'), [], 'a routing row was deleted')

  // Re-enabled: back in public, recipients still there.
  assert.equal((await patch('investment_consultation', { enabled: true })).status, 200)
  assert.ok((await publicIds()).includes('investment_consultation'))
  routing = await as(OWNER, 'GET', '/api/lead-routing')
  assert.deepEqual(routing.body.routing.find((row) => row.interestType === 'Investment Consultation').recipients, recipients)
})
