// Owner removal — Phase 2: the verification-code flow that demotes a
// non-protected owner.
//
// The REAL users router, auth middleware, role rules, owner-removal service
// and email templates run here. Faked: MongoDB (three in-memory collections)
// and the outbound Resend call. No real account, database or email is touched,
// and nothing is sent anywhere.
//
// The protected ids are fixtures standing in for the two real accounts; the
// real ids are environment configuration and appear nowhere in source.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const TEST_JWT_SECRET = 'test-only-secret-not-a-real-key-abcdefghijklmnop'
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.RESEND_API_KEY = 'test-resend-key-not-real'
process.env.EMAIL_FROM = 'Varlikent <no-reply@test.invalid>'

const ID = {
  protectedA: '6a00000000000000000000a1',
  protectedB: '6a00000000000000000000b2',
  ownerX: '6a00000000000000000000c3',
  ownerY: '6a00000000000000000000d4',
  admin: '6a00000000000000000000e5',
  agent: '6a00000000000000000000f6',
  user: '6a0000000000000000000a07',
  missing: '6a0000000000000000000fff',
}

const EMAIL = {
  protectedA: 'a@protected.test',
  protectedB: 'b@protected.test',
}

const PROTECTED_CONFIG = `${ID.protectedA},${ID.protectedB}`
process.env.PROTECTED_OWNER_IDS = PROTECTED_CONFIG

const MINUTE = 60 * 1000

// ── Fake collections ─────────────────────────────────────────────────────
let users = []
let requests = []
let activity = []

const comparable = (value) => (value instanceof Date ? value.getTime() : value)

const fieldMatches = (value, condition) => {
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$in') return operand.some((item) => String(item) === String(value))
      if (op === '$ne') return String(value) !== String(operand)
      if (op === '$elemMatch') return Array.isArray(value) && value.some((item) => matches(item, operand))
      // Like MongoDB, a range operator never matches a null/missing field.
      if (value === null || value === undefined) return false
      if (op === '$gt') return comparable(value) > comparable(operand)
      if (op === '$lt') return comparable(value) < comparable(operand)
      if (op === '$lte') return comparable(value) <= comparable(operand)
      throw new Error(`fake collection: unsupported operator ${op}`)
    })
  }
  if (condition instanceof Date) return comparable(value) === comparable(condition)
  return String(value) === String(condition)
}

const matches = (doc, criteria = {}) =>
  Object.entries(criteria).every(([field, condition]) => fieldMatches(doc[field], condition))

const applyUpdate = (doc, update) => {
  for (const [field, value] of Object.entries(update.$set || {})) doc[field] = value
  for (const [field, value] of Object.entries(update.$inc || {})) doc[field] = (doc[field] || 0) + value
  for (const [field, value] of Object.entries(update.$push || {})) doc[field] = [...(doc[field] || []), value]
}

const project = (doc, projection) => {
  if (!doc) return doc
  const out = { ...doc }
  if (projection) {
    for (const field of projection.split(' ').filter(Boolean)) {
      if (field.startsWith('-')) delete out[field.slice(1)]
    }
  }
  return out
}

// A chainable query. The resolver runs synchronously when the query is
// awaited, which is what models a single MongoDB operation being atomic: a
// conditional update either matches and applies in one step, or does not.
const query = (resolve) => {
  let projection = null
  let sort = null
  const chain = {
    select(p) { projection = p; return chain },
    sort(s) { sort = s; return chain },
    then: (onFulfilled, onRejected) =>
      Promise.resolve()
        .then(() => {
          const result = resolve(sort)
          return Array.isArray(result)
            ? result.map((doc) => project(doc, projection))
            : project(result, projection)
        })
        .then(onFulfilled, onRejected),
  }
  return chain
}

const sorted = (list, sort) => {
  if (!sort) return list
  const [[field, direction]] = Object.entries(sort)
  return [...list].sort((a, b) => (comparable(a[field]) - comparable(b[field])) * direction)
}

const FakeUser = {
  find: (criteria) => query(() => users.filter((doc) => matches(doc, criteria))),
  findById: (id) => query(() => users.find((doc) => doc._id === String(id)) || null),
  findOne: (criteria) => query(() => users.find((doc) => matches(doc, criteria)) || null),
  findOneAndUpdate: (criteria, update) =>
    query(() => {
      const doc = users.find((candidate) => matches(candidate, criteria))
      if (!doc) return null
      applyUpdate(doc, update)
      return doc
    }),
}

let requestSequence = 0

const FakeOwnerRemovalRequest = {
  // Enforces the model's unique partial index: one pending request per target.
  create: async (fields) => {
    if (fields.status === 'pending' && requests.some((r) => r.status === 'pending' && String(r.targetUser) === String(fields.targetUser))) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
    }
    requestSequence += 1
    const doc = {
      _id: `req-${requestSequence}`,
      attemptCount: 0,
      lastSentAt: null,
      confirmedBy: null,
      confirmedAt: null,
      closedReason: null,
      issuances: [],
      ...fields,
      // Strictly increasing, so "most recent" is unambiguous within one ms.
      createdAt: new Date(Date.now() + requestSequence),
    }
    requests.push(doc)
    return { ...doc }
  },
  find: (criteria) => query(() => requests.filter((doc) => matches(doc, criteria))),
  findOne: (criteria) =>
    query((sort) => sorted(requests.filter((doc) => matches(doc, criteria)), sort)[0] || null),
  findOneAndUpdate: (criteria, update) =>
    query(() => {
      const doc = requests.find((candidate) => matches(candidate, criteria))
      if (!doc) return null
      applyUpdate(doc, update)
      return doc
    }),
  updateOne: async (criteria, update) => {
    const doc = requests.find((candidate) => matches(candidate, criteria))
    if (doc) applyUpdate(doc, update)
    return { matchedCount: doc ? 1 : 0 }
  },
  updateMany: async (criteria, update) => {
    const hits = requests.filter((candidate) => matches(candidate, criteria))
    hits.forEach((doc) => applyUpdate(doc, update))
    return { matchedCount: hits.length }
  },
}

const FakeActivityLog = {
  create: async (entry) => {
    activity.push(entry)
    return entry
  },
}

mock.module('../models/User.js', { defaultExport: FakeUser })
mock.module('../models/OwnerRemovalRequest.js', { defaultExport: FakeOwnerRemovalRequest })
mock.module('../models/ActivityLog.js', { defaultExport: FakeActivityLog })

// ── Fake Resend ──────────────────────────────────────────────────────────
// Only calls to the Resend endpoint are intercepted; the test's own HTTP
// requests to the local server go through the real fetch.
const realFetch = globalThis.fetch
let emails = []
let failRecipients = new Set()
let failAllEmail = false

globalThis.fetch = async (url, options) => {
  if (String(url) !== RESEND_ENDPOINT) return realFetch(url, options)

  const payload = JSON.parse(options.body)
  const to = payload.to[0]

  if (failAllEmail || failRecipients.has(to)) {
    return { ok: false, status: 422, json: async () => ({ name: 'validation_error', message: 'rejected by fake' }) }
  }

  emails.push({ to, subject: payload.subject, html: payload.html, authorization: options.headers.Authorization })
  return { ok: true, status: 200, json: async () => ({ id: 'fake-id' }) }
}

// Everything the server writes to the console, so "the code is never logged"
// can be asserted rather than assumed.
const consoleOutput = []
const realConsole = { log: console.log, error: console.error, warn: console.warn }
for (const level of ['log', 'error', 'warn']) {
  console[level] = (...args) => { consoleOutput.push(args.map(String).join(' ')) }
}

let server
let baseUrl
let ownerRemoval
let roleManagement
let activityLogger

before(async () => {
  ownerRemoval = await import('../services/ownerRemoval.js')
  roleManagement = await import('../services/roleManagement.js')
  ;({ default: activityLogger } = await import('../middleware/activityLogger.js'))
  const { default: userRoutes } = await import('../routes/users.js')

  const app = express()
  app.use(express.json())
  app.use(activityLogger)
  app.use('/api/users', userRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  globalThis.fetch = realFetch
  Object.assign(console, realConsole)
  if (server) await new Promise((resolve) => server.close(resolve))
})

const seed = (fields) => {
  users.push({ isActive: true, permissions: [], password: 'stored-password-hash', ...fields })
}

beforeEach(() => {
  process.env.PROTECTED_OWNER_IDS = PROTECTED_CONFIG
  users = []
  requests = []
  activity = []
  emails = []
  failRecipients = new Set()
  failAllEmail = false
  consoleOutput.length = 0

  seed({ _id: ID.protectedA, name: 'Protected A', email: EMAIL.protectedA, role: 'owner' })
  seed({ _id: ID.protectedB, name: 'Protected B', email: EMAIL.protectedB, role: 'owner' })
  seed({ _id: ID.ownerX, name: 'Owner X', email: 'x@owner.test', role: 'owner' })
  seed({ _id: ID.ownerY, name: 'Owner Y', email: 'y@owner.test', role: 'owner', avatar: 'y.png', favourites: ['prop-1'], createdAt: new Date('2026-01-01') })
  seed({ _id: ID.admin, name: 'Admin', email: 'admin@staff.test', role: 'admin', permissions: ['user_management', 'manage_passwords'] })
  seed({ _id: ID.agent, name: 'Agent', email: 'agent@staff.test', role: 'agent' })
  seed({ _id: ID.user, name: 'Buyer', email: 'buyer@user.test', role: 'user' })
})

const tokenFor = (id) => jwt.sign({ id }, TEST_JWT_SECRET, { expiresIn: '1h' })

const call = async (method, path, { as, body } = {}) => {
  const response = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(as ? { authorization: `Bearer ${tokenFor(as)}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const raw = await response.text()
  return { status: response.status, body: JSON.parse(raw), raw }
}

const requestRemoval = (as, target = ID.ownerY) =>
  call('POST', `/api/users/${target}/request-owner-removal`, { as })

const confirmRemoval = (as, code, target = ID.ownerY) =>
  call('POST', `/api/users/${target}/confirm-owner-removal`, { as, body: { code } })

const userById = (id) => users.find((doc) => doc._id === id)
const pendingFor = (target = ID.ownerY) => requests.find((r) => r.status === 'pending' && String(r.targetUser) === target)
const codeEmails = () => emails.filter((email) => email.html.includes('data-owner-removal-code'))
const completionEmails = () => emails.filter((email) => !email.html.includes('data-owner-removal-code'))
const codeFrom = (email) => email.html.match(/data-owner-removal-code>(\d+)</)[1]
const latestCode = () => codeFrom(codeEmails().at(-1))
// Digits that occur in none of the fixture ids, so "this string appears
// nowhere" assertions cannot be tripped by an id that happens to contain it.
const wrongCodeFor = (code) => (code === '999999' ? '888888' : '999999')
const skipCooldown = (target = ID.ownerY) => {
  for (const r of requests) {
    if (String(r.targetUser) === target && r.lastSentAt) r.lastSentAt = new Date(Date.now() - 61 * 1000)
  }
}

/** A request already made by ownerX, returning the code that was emailed. */
const pendingRequest = async (as = ID.ownerX) => {
  const response = await requestRemoval(as)
  assert.equal(response.status, 200, 'setup: request accepted')
  return latestCode()
}

// ── Who can request ──────────────────────────────────────────────────────
test('1. an owner can request the removal of another ordinary owner', async () => {
  const { status, body } = await requestRemoval(ID.ownerX)

  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(body.delivery, 'full')
  assert.equal(body.message, 'Verification code sent to the protected owners.')
  assert.ok(pendingFor(), 'a pending request exists')
  assert.equal(String(pendingFor().requestedBy), ID.ownerX)
  assert.equal(userById(ID.ownerY).role, 'owner', 'nothing changes until the code is confirmed')
})

test('1. a protected owner can request it too', async () => {
  const { status } = await requestRemoval(ID.protectedA)
  assert.equal(status, 200)
})

for (const [number, label, actor] of [
  [2, 'an admin (even with user_management)', ID.admin],
  [3, 'a regular user', ID.user],
  [4, 'an agent', ID.agent],
]) {
  test(`${number}. ${label} cannot request an owner removal`, async () => {
    const { status } = await requestRemoval(actor)

    assert.equal(status, 403)
    assert.equal(requests.length, 0)
    assert.equal(emails.length, 0)
  })
}

test('an unauthenticated caller reaches neither route', async () => {
  assert.equal((await requestRemoval(null)).status, 401)
  assert.equal((await confirmRemoval(null, '123456')).status, 401)
  assert.equal(emails.length, 0)
})

test('5. an owner cannot target themselves', async () => {
  const { status } = await requestRemoval(ID.ownerY, ID.ownerY)

  assert.equal(status, 403)
  assert.equal(requests.length, 0)
  assert.equal(emails.length, 0)
})

for (const [label, actor] of [['an ordinary owner', ID.ownerX], ['the other protected owner', ID.protectedB]]) {
  test(`6. a protected owner cannot be targeted by ${label}`, async () => {
    const { status, body } = await requestRemoval(actor, ID.protectedA)

    assert.equal(status, 403)
    assert.match(body.message, /protected/i)
    assert.equal(requests.length, 0)
    assert.equal(emails.length, 0)
  })
}

for (const [label, target] of [['an admin', ID.admin], ['an agent', ID.agent], ['a regular user', ID.user]]) {
  test(`7. a target that is ${label} is rejected`, async () => {
    const { status } = await requestRemoval(ID.ownerX, target)

    assert.equal(status, 400)
    assert.equal(requests.length, 0)
    assert.equal(emails.length, 0)
  })
}

test('8. a nonexistent or malformed target is rejected', async () => {
  assert.equal((await requestRemoval(ID.ownerX, ID.missing)).status, 404)
  assert.equal((await requestRemoval(ID.ownerX, 'not-an-id')).status, 404)
  assert.equal((await confirmRemoval(ID.protectedA, '123456', ID.missing)).status, 404)
  assert.equal(requests.length, 0)
})

test('a deactivated ordinary owner can be removed, and stays deactivated', async () => {
  userById(ID.ownerY).isActive = false
  userById(ID.ownerY).permissions = ['add_listing']

  const requested = await requestRemoval(ID.ownerX)
  assert.equal(requested.status, 200)
  assert.equal(codeEmails().length, 2)

  const confirmed = await confirmRemoval(ID.protectedA, latestCode())
  assert.equal(confirmed.status, 200)

  assert.equal(userById(ID.ownerY).role, 'user')
  assert.deepEqual(userById(ID.ownerY).permissions, [])
  assert.equal(userById(ID.ownerY).isActive, false, 'not reactivated')
  assert.equal(confirmed.body.user.isActive, false)
})

test('an active owner stays active after removal', async () => {
  assert.equal((await confirmRemoval(ID.protectedA, await pendingRequest())).status, 200)

  assert.equal(userById(ID.ownerY).role, 'user')
  assert.equal(userById(ID.ownerY).isActive, true, 'not deactivated either')
})

test('a protected owner is untargetable whether active or not', async () => {
  userById(ID.protectedB).isActive = false

  const { status, body } = await requestRemoval(ID.ownerX, ID.protectedB)
  assert.equal(status, 403)
  assert.match(body.message, /protected/i)
  assert.equal(requests.length, 0)
  assert.equal(emails.length, 0)
  assert.equal(userById(ID.protectedB).role, 'owner')
})

// ── Requester rate limit ─────────────────────────────────────────────────
/** Has `as` issue `count` codes for ownerY, stepping past the per-target cooldown each time. */
const issueCodes = async (as, count) => {
  for (let n = 1; n <= count; n += 1) {
    skipCooldown()
    assert.equal((await requestRemoval(as)).status, 200, `setup: code ${n} issued`)
  }
  skipCooldown()
}

test('one owner may issue five codes in ten minutes, and the sixth is refused', async () => {
  await issueCodes(ID.ownerX, 5)
  const sentBefore = emails.length

  const { status, body } = await requestRemoval(ID.ownerX)

  assert.equal(status, 429)
  assert.match(body.message, /too many owner-removal requests/i)
  assert.ok(body.retryAfterSeconds >= 1 && body.retryAfterSeconds <= 600)
  assert.equal(emails.length, sentBefore, 'no further email was sent')
  assert.equal(ownerRemoval.OWNER_REMOVAL_REQUESTER_LIMIT, 5)
  assert.equal(ownerRemoval.OWNER_REMOVAL_REQUESTER_WINDOW_MS, 10 * MINUTE)
})

test('the requester limit counts across different targets', async () => {
  seed({ _id: '6a0000000000000000000b08', name: 'Owner Z', email: 'z@owner.test', role: 'owner' })
  const ownerZ = '6a0000000000000000000b08'

  // Five codes spread over two targets — each within its own cooldown rules.
  for (const target of [ID.ownerY, ownerZ, ID.ownerY, ownerZ, ID.ownerY]) {
    skipCooldown(target)
    assert.equal((await requestRemoval(ID.ownerX, target)).status, 200)
  }
  skipCooldown(ID.ownerY)
  skipCooldown(ownerZ)

  // The per-target cooldown has passed for both; the requester limit has not.
  for (const target of [ID.ownerY, ownerZ]) {
    const { status, body } = await requestRemoval(ID.ownerX, target)
    assert.equal(status, 429)
    assert.match(body.message, /too many owner-removal requests/i)
  }
})

test('the requester limit is per owner: someone else can still request', async () => {
  await issueCodes(ID.ownerX, 5)

  assert.equal((await requestRemoval(ID.ownerX)).status, 429)
  assert.equal((await requestRemoval(ID.protectedA)).status, 200)
})

test('the requester limit lifts once earlier codes leave the ten-minute window', async () => {
  await issueCodes(ID.ownerX, 5)
  assert.equal((await requestRemoval(ID.ownerX)).status, 429)

  // Eleven minutes later.
  for (const request of requests) {
    request.issuances = request.issuances.map((issuance) => ({ ...issuance, at: new Date(Date.now() - 11 * MINUTE) }))
  }

  assert.equal((await requestRemoval(ID.ownerX)).status, 200)
})

test('requests refused by the per-target cooldown do not count toward the requester limit', async () => {
  await pendingRequest(ID.ownerX)
  for (let n = 0; n < 8; n += 1) assert.equal((await requestRemoval(ID.ownerX)).status, 429)

  assert.equal(pendingFor().issuances.length, 1)

  skipCooldown()
  assert.equal((await requestRemoval(ID.ownerX)).status, 200)
})

test('the requester limit does not affect confirmation', async () => {
  await issueCodes(ID.protectedA, 5)
  assert.equal((await requestRemoval(ID.protectedA)).status, 429)

  // The same protected owner, over their request limit, can still confirm —
  // and wrong codes are governed by the attempt limit alone.
  const code = latestCode()
  assert.equal((await confirmRemoval(ID.protectedA, wrongCodeFor(code))).status, 401)
  assert.equal(pendingFor().attemptCount, 1)
  assert.equal((await confirmRemoval(ID.protectedA, code)).status, 200)
  assert.equal(userById(ID.ownerY).role, 'user')
})

test('issuance records hold who and when — never the code or its hash', async () => {
  await issueCodes(ID.ownerX, 2)
  const stored = pendingFor()

  assert.equal(stored.issuances.length, 2)
  for (const issuance of stored.issuances) {
    assert.deepEqual(Object.keys(issuance).sort(), ['at', 'requestedBy'])
    assert.equal(String(issuance.requestedBy), ID.ownerX)
  }
  assert.ok(!JSON.stringify(stored.issuances).includes(latestCode()))
})

test('the flow refuses to run when protected owners are not fully configured', async () => {
  for (const value of ['', ID.protectedA, `${ID.protectedA},${ID.protectedB},${ID.ownerX}`]) {
    process.env.PROTECTED_OWNER_IDS = value
    const { status } = await requestRemoval(ID.ownerX)
    assert.equal(status, 503, `config "${value ? 'partial' : 'empty'}"`)
  }
  assert.equal(requests.length, 0)
  assert.equal(emails.length, 0)
})

// ── The code ─────────────────────────────────────────────────────────────
test('9. the code is six digits, and generation keeps leading zeros', async () => {
  await pendingRequest()
  assert.match(latestCode(), /^\d{6}$/)

  const samples = Array.from({ length: 3000 }, () => ownerRemoval.generateOwnerRemovalCode())
  assert.ok(samples.every((code) => /^\d{6}$/.test(code)))
  assert.ok(samples.some((code) => code.startsWith('0')), 'codes below 100000 are possible and padded')
  assert.ok(new Set(samples).size > 2900, 'codes are not repeating')
})

test('10/11. only a hash is stored, and it verifies against the emailed code', async () => {
  const code = await pendingRequest()
  const stored = pendingFor()

  assert.ok(!JSON.stringify(requests).includes(code), 'the plaintext code is nowhere in the collection')
  assert.match(stored.codeHash, /^\$2[aby]\$/, 'a bcrypt hash')
  assert.notEqual(stored.codeHash, code)
  assert.equal(await bcrypt.compare(code, stored.codeHash), true)
  assert.equal(await bcrypt.compare(wrongCodeFor(code), stored.codeHash), false)
})

test('12. the code expires ten minutes after it is issued', async () => {
  const before = Date.now()
  const { body } = await requestRemoval(ID.ownerX)
  const after = Date.now()

  const expiresAt = new Date(pendingFor().expiresAt).getTime()
  assert.ok(expiresAt >= before + 10 * MINUTE && expiresAt <= after + 10 * MINUTE)
  assert.equal(new Date(body.expiresAt).getTime(), expiresAt)
  assert.equal(ownerRemoval.OWNER_REMOVAL_CODE_TTL_MS, 10 * MINUTE)
})

test('13. an expired code is rejected, even though it is the right one', async () => {
  const code = await pendingRequest()
  pendingFor().expiresAt = new Date(Date.now() - 1000)

  const { status } = await confirmRemoval(ID.protectedA, code)

  assert.equal(status, 410)
  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.equal(requests[0].status, 'expired')

  // …and stays rejected.
  assert.equal((await confirmRemoval(ID.protectedA, code)).status, 404)
})

// ── Attempts ─────────────────────────────────────────────────────────────
test('14. a wrong code increments the attempt count', async () => {
  const code = await pendingRequest()

  const first = await confirmRemoval(ID.protectedA, wrongCodeFor(code))
  assert.equal(first.status, 401)
  assert.equal(first.body.attemptsRemaining, 4)
  assert.equal(pendingFor().attemptCount, 1)

  const second = await confirmRemoval(ID.protectedB, wrongCodeFor(code))
  assert.equal(second.body.attemptsRemaining, 3)
  assert.equal(pendingFor().attemptCount, 2)
  assert.equal(userById(ID.ownerY).role, 'owner')
})

test('a malformed code is refused without using up an attempt', async () => {
  await pendingRequest()

  for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', null, { $ne: '' }, ['123456']]) {
    const { status } = await confirmRemoval(ID.protectedA, bad)
    assert.equal(status, 400, `code ${JSON.stringify(bad)}`)
  }
  assert.equal(pendingFor().attemptCount, 0)
})

test('15/16. five wrong attempts lock the request, and the right code no longer works', async () => {
  const code = await pendingRequest()
  const wrong = wrongCodeFor(code)

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal((await confirmRemoval(ID.protectedA, wrong)).status, 401, `attempt ${attempt}`)
  }

  const fifth = await confirmRemoval(ID.protectedA, wrong)
  assert.equal(fifth.status, 423)
  assert.equal(fifth.body.attemptsRemaining, 0)
  assert.equal(requests[0].status, 'locked')
  assert.equal(requests[0].attemptCount, 5)

  const afterLock = await confirmRemoval(ID.protectedA, code)
  assert.equal(afterLock.status, 423)
  assert.equal((await confirmRemoval(ID.protectedB, code)).status, 423)
  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.equal(requests[0].attemptCount, 5, 'a locked request takes no more attempts')
})

test('the correct code on the fifth attempt still succeeds', async () => {
  const code = await pendingRequest()
  for (let attempt = 1; attempt <= 4; attempt += 1) await confirmRemoval(ID.protectedA, wrongCodeFor(code))

  assert.equal((await confirmRemoval(ID.protectedA, code)).status, 200)
  assert.equal(userById(ID.ownerY).role, 'user')
})

test('parallel guesses cannot exceed the attempt limit', async () => {
  const code = await pendingRequest()
  const wrong = wrongCodeFor(code)

  const results = await Promise.all(Array.from({ length: 12 }, () => confirmRemoval(ID.protectedA, wrong)))

  assert.equal(results.filter((r) => r.status === 401).length, 4)
  assert.ok(results.every((r) => [401, 423, 409].includes(r.status)))
  assert.equal(requests[0].attemptCount, 5)
  assert.equal(requests[0].status, 'locked')
  assert.equal(userById(ID.ownerY).role, 'owner')
})

test('a locked request does not bypass the resend cooldown', async () => {
  const code = await pendingRequest()
  for (let attempt = 1; attempt <= 5; attempt += 1) await confirmRemoval(ID.protectedA, wrongCodeFor(code))

  assert.equal((await requestRemoval(ID.ownerX)).status, 429)

  skipCooldown()
  assert.equal((await requestRemoval(ID.ownerX)).status, 200)
  assert.equal((await confirmRemoval(ID.protectedA, latestCode())).status, 200)
})

// ── Cooldown and re-issue ────────────────────────────────────────────────
test('17. the cooldown blocks an immediate second request, from anyone', async () => {
  await pendingRequest(ID.ownerX)

  for (const actor of [ID.ownerX, ID.protectedA, ID.protectedB]) {
    const { status, body } = await requestRemoval(actor)
    assert.equal(status, 429)
    assert.ok(body.retryAfterSeconds >= 1 && body.retryAfterSeconds <= 60)
  }

  assert.equal(codeEmails().length, 2, 'no further email was sent')
  assert.equal(requests.length, 1)
})

test('18/19. after the cooldown a new code is issued and the old one stops working', async () => {
  const oldCode = await pendingRequest(ID.ownerX)
  const oldHash = pendingFor().codeHash
  await confirmRemoval(ID.protectedA, wrongCodeFor(oldCode))

  skipCooldown()
  const again = await requestRemoval(ID.protectedB)
  assert.equal(again.status, 200)

  const newCode = latestCode()
  assert.equal(codeEmails().length, 4)
  assert.equal(requests.filter((r) => r.status === 'pending').length, 1, 'still exactly one pending request')
  assert.notEqual(pendingFor().codeHash, oldHash)
  assert.equal(pendingFor().attemptCount, 0, 'a new code starts with a clean count')
  assert.equal(String(pendingFor().requestedBy), ID.protectedB)

  if (newCode !== oldCode) {
    assert.equal((await confirmRemoval(ID.protectedA, oldCode)).status, 401, 'the old code is now just a wrong code')
    assert.equal(userById(ID.ownerY).role, 'owner')
  }

  assert.equal((await confirmRemoval(ID.protectedA, newCode)).status, 200)
  assert.equal(userById(ID.ownerY).role, 'user')
})

test('two owners requesting at the same moment produce one code, not two', async () => {
  const results = await Promise.all([requestRemoval(ID.ownerX), requestRemoval(ID.protectedA), requestRemoval(ID.protectedB)])

  assert.deepEqual(results.map((r) => r.status).sort(), [200, 429, 429])
  assert.equal(requests.filter((r) => r.status === 'pending').length, 1)
  assert.equal(codeEmails().length, 2, 'one code, sent to the two protected owners')
  assert.equal(new Set(codeEmails().map(codeFrom)).size, 1)
})

test('separate targets have independent requests', async () => {
  users.find((u) => u._id === ID.ownerX).role = 'owner'

  assert.equal((await requestRemoval(ID.protectedA, ID.ownerY)).status, 200)
  assert.equal((await requestRemoval(ID.protectedA, ID.ownerX)).status, 200)
  assert.equal(requests.filter((r) => r.status === 'pending').length, 2)

  // A code issued for Y does nothing against X.
  const codeForY = codeFrom(codeEmails().find((email) => email.html.includes('y@owner.test')))
  const codeForX = codeFrom(codeEmails().find((email) => email.html.includes('x@owner.test') && !email.html.includes('y@owner.test')))

  if (codeForX !== codeForY) {
    assert.equal((await confirmRemoval(ID.protectedA, codeForY, ID.ownerX)).status, 401)
    assert.equal(userById(ID.ownerX).role, 'owner')
  }
  assert.equal((await confirmRemoval(ID.protectedA, codeForY, ID.ownerY)).status, 200)
  assert.equal(userById(ID.ownerX).role, 'owner')
})

// ── Delivery ─────────────────────────────────────────────────────────────
test('20. both protected owners receive the same code, in separate emails, and nobody else does', async () => {
  await requestRemoval(ID.ownerX)

  assert.equal(emails.length, 2)
  assert.deepEqual(emails.map((email) => email.to).sort(), [EMAIL.protectedA, EMAIL.protectedB])
  assert.equal(codeFrom(emails[0]), codeFrom(emails[1]))

  for (const email of emails) {
    assert.ok(!email.subject.includes(codeFrom(email)), 'the code is not in the subject line')
    assert.ok(email.html.includes('Owner X') && email.html.includes('x@owner.test'), 'names the requester')
    assert.ok(email.html.includes('Owner Y') && email.html.includes('y@owner.test'), 'names the target')
    assert.ok(email.html.includes('10 minutes'), 'states the expiry')
    for (const id of Object.values(ID)) assert.ok(!email.html.includes(id), 'no account ids')
  }
})

test('20. recipients come from the protected accounts\' current emails, not from a list', async () => {
  userById(ID.protectedA).email = 'moved@protected.test'

  await requestRemoval(ID.ownerX)
  assert.deepEqual(emails.map((email) => email.to).sort(), [EMAIL.protectedB, 'moved@protected.test'].sort())
})

test('the email template escapes account fields', async () => {
  userById(ID.ownerY).name = '<img src=x onerror=alert(1)>'

  await requestRemoval(ID.ownerX)
  assert.ok(!emails[0].html.includes('<img src=x'))
  assert.ok(emails[0].html.includes('&lt;img src=x'))
})

test('32. if no email can be sent the request is cancelled and nothing is left usable', async () => {
  failAllEmail = true

  const { status, body } = await requestRemoval(ID.ownerX)

  assert.equal(status, 502)
  assert.equal(body.success, false)
  assert.equal(pendingFor(), undefined, 'no pending request remains')
  assert.equal(requests[0].status, 'cancelled')
  assert.equal(requests[0].closedReason, 'delivery_failed')
  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.ok(activity.some((entry) => entry.statusCode === 502), 'the failure is on record')

  // A failed send does not start the cooldown: the owner can retry at once.
  failAllEmail = false
  assert.equal((await requestRemoval(ID.ownerX)).status, 200)
  assert.equal((await confirmRemoval(ID.protectedA, latestCode())).status, 200)
})

test('32. if one of the two emails fails the request stays valid and the shortfall is reported', async () => {
  failRecipients = new Set([EMAIL.protectedB])

  const { status, body } = await requestRemoval(ID.ownerX)

  assert.equal(status, 200)
  assert.equal(body.delivery, 'partial')
  assert.match(body.message, /could not be delivered to one/i)
  assert.deepEqual(emails.map((email) => email.to), [EMAIL.protectedA])
  assert.match(activity.at(-1).details, /1 of 2/)

  // Either protected owner can still complete it — including the one whose
  // email failed, given the code by the other.
  assert.equal((await confirmRemoval(ID.protectedB, latestCode())).status, 200)
})

// ── Who can confirm ──────────────────────────────────────────────────────
test('21. an ordinary owner holding the correct code cannot confirm — not even the requester', async () => {
  const code = await pendingRequest(ID.ownerX)

  const requester = await confirmRemoval(ID.ownerX, code)
  assert.equal(requester.status, 403)
  assert.match(requester.body.message, /protected owner/i)

  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.equal(pendingFor().attemptCount, 0, 'no attempt is used up')
  assert.equal(pendingFor().status, 'pending')
})

test('21. admins, agents, users and the target cannot confirm with the correct code either', async () => {
  const code = await pendingRequest()

  for (const actor of [ID.admin, ID.agent, ID.user, ID.ownerY]) {
    assert.equal((await confirmRemoval(actor, code)).status, 403)
  }
  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.equal(pendingFor().attemptCount, 0)
})

test('21. a protected id that is no longer an owner cannot confirm', async () => {
  const code = await pendingRequest()
  userById(ID.protectedA).role = 'admin'

  assert.equal((await confirmRemoval(ID.protectedA, code)).status, 403)
  assert.equal(userById(ID.ownerY).role, 'owner')
})

test('22. a protected owner with the wrong code cannot confirm', async () => {
  const code = await pendingRequest()

  const { status } = await confirmRemoval(ID.protectedA, wrongCodeFor(code))
  assert.equal(status, 401)
  assert.equal(userById(ID.ownerY).role, 'owner')
})

test('confirming without any pending request is rejected', async () => {
  const { status } = await confirmRemoval(ID.protectedA, '123456')
  assert.equal(status, 404)
  assert.equal(userById(ID.ownerY).role, 'owner')
})

for (const [label, confirmer] of [['protected owner A', ID.protectedA], ['protected owner B', ID.protectedB]]) {
  test(`23/24. ${label} can confirm a request made by someone else`, async () => {
    const code = await pendingRequest(ID.ownerX)

    const { status, body } = await confirmRemoval(confirmer, code)

    assert.equal(status, 200)
    assert.equal(body.success, true)
    assert.equal(requests[0].status, 'completed')
    assert.equal(String(requests[0].confirmedBy), confirmer)
    assert.ok(requests[0].confirmedAt instanceof Date)
    assert.notEqual(String(requests[0].requestedBy), confirmer)
  })
}

test('24. a request made by one protected owner can be confirmed by the other, or by themselves', async () => {
  await pendingRequest(ID.protectedA)
  assert.equal((await confirmRemoval(ID.protectedB, latestCode())).status, 200)

  // And the same person both requesting and confirming.
  userById(ID.ownerX).role = 'owner'
  assert.equal((await requestRemoval(ID.protectedA, ID.ownerX)).status, 200)
  assert.equal((await confirmRemoval(ID.protectedA, latestCode(), ID.ownerX)).status, 200)
  assert.equal(userById(ID.ownerX).role, 'user')
})

// ── What success does ────────────────────────────────────────────────────
test('25/26/27. confirmation demotes the owner to user, clears permissions, and deletes nothing', async () => {
  userById(ID.ownerY).permissions = ['add_listing', 'user_management']
  const before = { ...userById(ID.ownerY) }
  const code = await pendingRequest()

  const { status, body } = await confirmRemoval(ID.protectedA, code)
  const after = userById(ID.ownerY)

  assert.equal(status, 200)
  assert.ok(after, 'the account still exists')
  assert.equal(users.length, 7, 'no account was removed')
  assert.equal(after.role, 'user')
  assert.deepEqual(after.permissions, [])

  for (const field of ['_id', 'name', 'email', 'isActive', 'avatar', 'favourites', 'createdAt', 'password']) {
    assert.deepEqual(after[field], before[field], `${field} is untouched`)
  }

  assert.equal(body.user._id, ID.ownerY)
  assert.equal(body.user.role, 'user')
  assert.deepEqual(body.user.permissions, [])
  assert.equal(body.user.isProtected, false)
  assert.ok(!('password' in body.user))
})

test('the demoted account loses owner access on its very next request', async () => {
  assert.equal((await call('GET', '/api/users', { as: ID.ownerY })).status, 200)

  await confirmRemoval(ID.protectedA, await pendingRequest())

  assert.equal((await call('GET', '/api/users', { as: ID.ownerY })).status, 403)
  assert.equal((await requestRemoval(ID.ownerY, ID.ownerX)).status, 403)
})

test('both protected owners are notified once the removal completes', async () => {
  await confirmRemoval(ID.protectedB, await pendingRequest(ID.ownerX))

  const notices = completionEmails()
  assert.deepEqual(notices.map((email) => email.to).sort(), [EMAIL.protectedA, EMAIL.protectedB])
  for (const notice of notices) {
    assert.ok(notice.html.includes('Owner Y'), 'names who was removed')
    assert.ok(notice.html.includes('Protected B'), 'names who confirmed')
    assert.ok(notice.html.includes('Owner X'), 'names who requested')
    assert.ok(!/\d{6}/.test(notice.html.replace(/#[0-9a-f]{6}/gi, '')), 'carries no code')
  }
})

test('a failed completion notice does not undo or fail the removal', async () => {
  const code = await pendingRequest()
  failAllEmail = true

  assert.equal((await confirmRemoval(ID.protectedA, code)).status, 200)
  assert.equal(userById(ID.ownerY).role, 'user')
})

test('28. a completed request cannot be reused', async () => {
  const code = await pendingRequest()
  assert.equal((await confirmRemoval(ID.protectedA, code)).status, 200)

  // Someone restores the owner role out of band (scripts/createOwner.js).
  userById(ID.ownerY).role = 'owner'

  const reuse = await confirmRemoval(ID.protectedB, code)
  assert.equal(reuse.status, 409)
  assert.match(reuse.body.message, /already been used/i)
  assert.equal(userById(ID.ownerY).role, 'owner', 'the old code did not demote them again')
})

test('29. two protected owners confirming at the same instant: exactly one succeeds', async () => {
  const code = await pendingRequest(ID.ownerX)

  const results = await Promise.all([confirmRemoval(ID.protectedA, code), confirmRemoval(ID.protectedB, code)])

  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
  assert.equal(userById(ID.ownerY).role, 'user')
  assert.equal(requests.filter((r) => r.status === 'completed').length, 1)
  assert.equal(activity.filter((entry) => entry.action === 'completed owner removal for').length, 1)
  assert.equal(completionEmails().length, 2, 'one notification round, not two')
})

test('30. a target that became protected after the request is refused at confirmation', async () => {
  const code = await pendingRequest(ID.ownerX)
  process.env.PROTECTED_OWNER_IDS = `${ID.protectedA},${ID.ownerY}`

  const { status, body } = await confirmRemoval(ID.protectedA, code)

  assert.equal(status, 403)
  assert.match(body.message, /protected/i)
  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.notEqual(requests[0].status, 'completed')
})

test('31. a target that is no longer an owner is not touched, and the request is closed', async () => {
  const code = await pendingRequest()
  userById(ID.ownerY).role = 'admin'
  userById(ID.ownerY).permissions = ['add_listing']

  const { status } = await confirmRemoval(ID.protectedA, code)

  assert.equal(status, 409)
  assert.equal(userById(ID.ownerY).role, 'admin', 'left exactly as it was')
  assert.deepEqual(userById(ID.ownerY).permissions, ['add_listing'])
  assert.equal(requests[0].status, 'cancelled')
  assert.equal(requests[0].closedReason, 'target_changed')
})

test('31. once removed, the same account cannot be targeted again', async () => {
  await confirmRemoval(ID.protectedA, await pendingRequest())
  skipCooldown()

  assert.equal((await requestRemoval(ID.ownerX)).status, 400)
})

// ── What is never exposed ────────────────────────────────────────────────
test('33. no response ever contains the code, its hash, or who the protected owners are', async () => {
  const responses = []

  responses.push(await requestRemoval(ID.ownerX))
  const code = latestCode()
  const hash = pendingFor().codeHash

  responses.push(await requestRemoval(ID.ownerX)) // cooldown
  responses.push(await confirmRemoval(ID.ownerX, code)) // not protected
  responses.push(await confirmRemoval(ID.protectedA, wrongCodeFor(code)))
  responses.push(await confirmRemoval(ID.protectedA, code))
  responses.push(await confirmRemoval(ID.protectedA, code)) // reuse

  for (const { raw } of responses) {
    assert.ok(!raw.includes(code), 'no code')
    assert.ok(!raw.includes(hash), 'no hash')
    assert.ok(!raw.includes('$2'), 'no bcrypt material at all')
    assert.ok(!raw.includes('codeHash'))
    assert.ok(!raw.includes(EMAIL.protectedA) && !raw.includes(EMAIL.protectedB), 'no protected emails')
    assert.ok(!raw.includes(ID.protectedA) && !raw.includes(ID.protectedB), 'no protected ids')
    assert.ok(!raw.includes('PROTECTED_OWNER'))
  }

  assert.deepEqual(Object.keys(responses[0].body).sort(), ['delivery', 'expiresAt', 'message', 'success'])
})

test('34. the activity log records every stage and never the code or its hash', async () => {
  const code = await pendingRequest(ID.ownerX)
  const firstHash = pendingFor().codeHash
  const wrong = wrongCodeFor(code)

  for (let attempt = 1; attempt <= 5; attempt += 1) await confirmRemoval(ID.protectedA, wrong)

  skipCooldown()
  await requestRemoval(ID.ownerX)
  const secondCode = latestCode()
  const secondHash = pendingFor().codeHash
  await confirmRemoval(ID.protectedB, secondCode)

  const actions = activity.map((entry) => entry.action)
  assert.equal(actions.filter((a) => a === 'requested owner removal for').length, 2)
  assert.equal(actions.filter((a) => a === 'entered an incorrect owner-removal code for').length, 5)
  assert.equal(actions.filter((a) => a === 'locked the owner-removal request for').length, 1)
  assert.equal(actions.filter((a) => a === 'completed owner removal for').length, 1)

  const requested = activity.find((entry) => entry.action === 'requested owner removal for')
  assert.equal(String(requested.actorId), ID.ownerX)
  assert.equal(requested.actorName, 'Owner X')
  assert.equal(String(requested.targetId), ID.ownerY)
  assert.equal(requested.targetName, 'Owner Y')
  assert.equal(requested.resource, 'users')
  assert.equal(requested.method, 'POST')
  assert.equal(requested.path, `/api/users/${ID.ownerY}/request-owner-removal`)

  const wrongEntry = activity.find((entry) => entry.action === 'entered an incorrect owner-removal code for')
  assert.equal(String(wrongEntry.actorId), ID.protectedA)
  assert.equal(wrongEntry.statusCode, 401)
  assert.equal(wrongEntry.details, 'attempt 1 of 5')

  const completed = activity.find((entry) => entry.action === 'completed owner removal for')
  assert.equal(String(completed.actorId), ID.protectedB)
  assert.equal(String(completed.targetId), ID.ownerY)
  assert.match(completed.details, /demoted from owner to user; requested by Owner X/)

  const everything = JSON.stringify(activity)
  for (const secret of [code, wrong, secondCode, firstHash, secondHash]) {
    assert.ok(!everything.includes(secret), 'no code or hash in any activity entry')
  }

  const logged = consoleOutput.join('\n')
  for (const secret of [code, secondCode, firstHash, secondHash, process.env.RESEND_API_KEY]) {
    assert.ok(!logged.includes(secret), 'no code, hash or key in the server console')
  }
})

test('34. the generic activity middleware does not double-log these routes', async () => {
  await confirmRemoval(ID.protectedA, await pendingRequest(ID.ownerX))
  await new Promise((resolve) => setTimeout(resolve, 20))

  // Exactly the two entries the service wrote: one request, one completion.
  assert.deepEqual(
    activity.map((entry) => entry.action),
    ['requested owner removal for', 'completed owner removal for']
  )

  // Driven directly, the middleware skips both routes and nothing else.
  const finish = async (originalUrl) => {
    let listener
    const req = { method: 'POST', originalUrl, user: userById(ID.protectedA) }
    activityLogger(req, { statusCode: 200, on: (event, fn) => { listener = fn } }, () => {})
    listener()
    await Promise.resolve()
  }

  activity = []
  await finish(`/api/users/${ID.ownerY}/request-owner-removal`)
  await finish(`/api/users/${ID.ownerY}/confirm-owner-removal`)
  assert.equal(activity.length, 0)

  await finish(`/api/users/${ID.user}/role`)
  assert.equal(activity.length, 1, 'ordinary user-management actions are still logged')
  assert.equal(activity[0].action, 'changed the role of')
})

// ── Phase 1 and the existing owner rules still hold ──────────────────────
test('35. the normal role, permission and delete routes still refuse every owner', async () => {
  for (const actor of [ID.protectedA, ID.ownerX]) {
    for (const target of [ID.ownerY, ID.protectedB]) {
      if (actor === target) continue
      assert.equal((await call('PUT', `/api/users/${target}/role`, { as: actor, body: { role: 'user' } })).status, 403)
      assert.equal((await call('PUT', `/api/users/${target}/permissions`, { as: actor, body: { permissions: [] } })).status, 403)
      assert.equal((await call('DELETE', `/api/users/${target}`, { as: actor })).status, 403)
    }
  }
  assert.equal(userById(ID.ownerY).role, 'owner')
  assert.equal(userById(ID.protectedB).role, 'owner')
  assert.equal(users.length, 7)
})

test('35. validateRoleChange was not loosened to make removal possible', () => {
  const { validateRoleChange, assignableRolesFor } = roleManagement
  const protectedOwner = { _id: ID.protectedA, role: 'owner', permissions: [] }

  const ordinary = validateRoleChange({ actor: protectedOwner, target: { _id: ID.ownerY, role: 'owner' }, requestedRole: 'user' })
  assert.equal(ordinary.ok, false)
  assert.equal(ordinary.status, 403)

  assert.equal(
    validateRoleChange({ actor: protectedOwner, target: { _id: ID.user, role: 'user' }, requestedRole: 'owner' }).ok,
    false,
    'owner is still not assignable through the API'
  )
  assert.deepEqual(assignableRolesFor(protectedOwner), ['admin', 'agent', 'user'])
})

test('35. a protected owner can never be demoted by this flow, whatever is in the collection', async () => {
  // Even a pending request that somehow existed for a protected target, with
  // a known code, gets nowhere.
  requests.push({
    _id: 'forged',
    targetUser: ID.protectedB,
    requestedBy: ID.ownerX,
    codeHash: await bcrypt.hash('123456', 4),
    status: 'pending',
    attemptCount: 0,
    expiresAt: new Date(Date.now() + 10 * MINUTE),
    lastSentAt: new Date(Date.now() - 2 * MINUTE),
    createdAt: new Date(),
  })

  const { status } = await confirmRemoval(ID.protectedA, '123456', ID.protectedB)

  assert.equal(status, 403)
  assert.equal(userById(ID.protectedB).role, 'owner')
  assert.equal(requests[0].status, 'pending')
  assert.equal(requests[0].attemptCount, 0)
})
