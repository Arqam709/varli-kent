// Device registration and the test-send endpoint.
//
// The REAL router and the REAL push service run here. Only the two genuine
// externals are faked: MongoDB and Expo's HTTPS push endpoint. No notification
// can leave the process and no network call is made.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'

const USER_A = 'user-a-id'
const USER_B = 'user-b-id'

// ── Fake collection ──────────────────────────────────────────────────────
// Enforces the one property the design leans on: `token` is unique.
let rows = []

const matches = (doc, query) =>
  Object.entries(query).every(([field, condition]) => {
    const value = doc[field]
    if (condition && typeof condition === 'object' && Array.isArray(condition.$in)) {
      return condition.$in.some((c) => String(c) === String(value))
    }
    return String(value) === String(condition)
  })

const FakePushDevice = {
  async findOneAndUpdate(query, update, options) {
    const set = update.$set || {}
    const existing = rows.find((r) => matches(r, query))

    if (existing) {
      Object.assign(existing, set)
      return existing
    }
    if (!options?.upsert) return null

    const created = { ...query, ...set }
    rows.push(created)
    return created
  },
  async updateOne(query, update) {
    const doc = rows.find((r) => matches(r, query))
    if (!doc) return { matchedCount: 0 }
    Object.assign(doc, update.$set || {})
    return { matchedCount: 1 }
  },
  async updateMany(query, update) {
    const hits = rows.filter((r) => matches(r, query))
    hits.forEach((r) => Object.assign(r, update.$set || {}))
    return { matchedCount: hits.length }
  },
  find(query) {
    const hits = rows.filter((r) => matches(r, query))
    // The route calls .select(); return a thenable that ignores it.
    return { select: async () => hits }
  },
}

mock.module('../models/PushDevice.js', { defaultExport: FakePushDevice })

// ── Fake auth ────────────────────────────────────────────────────────────
// The real `protect` needs a JWT and a database. What these tests are about is
// the ROUTE's behaviour given an identity, so the identity is injected and the
// header decides who it is.
let currentUser = USER_A

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ success: false, message: 'Not authorized, no token' })
      }
      req.user = { _id: currentUser }
      next()
    },
  },
})

// ── Fake Expo push endpoint ──────────────────────────────────────────────
let pushRequests = []
let nextTickets = null
let nextThrow = null
let nextStatus = 200

const realFetch = globalThis.fetch

globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://exp.host/')) {
    const messages = JSON.parse(options.body)
    pushRequests.push(messages)

    if (nextThrow) throw nextThrow

    return {
      ok: nextStatus >= 200 && nextStatus < 300,
      status: nextStatus,
      json: async () => ({
        data: nextTickets ?? messages.map(() => ({ status: 'ok', id: 'ticket' })),
      }),
    }
  }
  return realFetch(url, options)
}

// ── Server under test ────────────────────────────────────────────────────
let server
let baseUrl

before(async () => {
  const { default: pushRoutes } = await import('../routes/push.js')
  const app = express()
  app.use(express.json())
  app.use('/api/push', pushRoutes)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  globalThis.fetch = realFetch
  if (server) await new Promise((r) => server.close(r))
})

const call = async (method, path, body, { auth = true } = {}) => {
  const response = await realFetch(`${baseUrl}/api/push${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: 'Bearer test' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test.beforeEach(() => {
  rows = []
  pushRequests = []
  nextTickets = null
  nextThrow = null
  nextStatus = 200
  currentUser = USER_A
})

// ── Registration ─────────────────────────────────────────────────────────
test('registers a device for the authenticated user', async () => {
  const { status, body } = await call('POST', '/devices', {
    token: TOKEN_A,
    platform: 'android',
  })

  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].token, TOKEN_A)
  assert.equal(String(rows[0].user), USER_A)
  assert.equal(rows[0].active, true)
})

test('the push token is never echoed back to the client', async () => {
  const { body } = await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  assert.equal(JSON.stringify(body).includes(TOKEN_A), false)
})

test('repeated registration is idempotent — one row, not two', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })

  assert.equal(rows.length, 1)
})

test('one account can register several devices', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  await call('POST', '/devices', { token: TOKEN_B, platform: 'ios' })

  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((r) => String(r.user)),
    [USER_A, USER_A]
  )
})

test('an account switch REASSIGNS the device rather than duplicating it', async () => {
  // The scenario that a single User.pushToken field cannot express: two people
  // using one phone. B must inherit the device, and A must stop receiving on it.
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })

  currentUser = USER_B
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })

  assert.equal(rows.length, 1, 'the unique token must not produce a second row')
  assert.equal(String(rows[0].user), USER_B, 'ownership moves to whoever signed in')
})

test('a malformed token is rejected before it can reach the database', async () => {
  for (const bad of ['', 'not-a-token', 'ExponentPushToken', 12345, null]) {
    const { status } = await call('POST', '/devices', { token: bad, platform: 'android' })
    assert.equal(status, 400, `expected 400 for ${JSON.stringify(bad)}`)
  }
  assert.equal(rows.length, 0)
})

test('an unrecognised platform is rejected', async () => {
  const { status } = await call('POST', '/devices', { token: TOKEN_A, platform: 'windows' })
  assert.equal(status, 400)
  assert.equal(rows.length, 0)
})

test('registration requires authentication', async () => {
  const { status } = await call('POST', '/devices', { token: TOKEN_A, platform: 'android' }, { auth: false })
  assert.equal(status, 401)
  assert.equal(rows.length, 0)
})

// ── Deregistration ───────────────────────────────────────────────────────
test('sign-out deactivates this account\'s device', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })

  const { status } = await call('DELETE', '/devices', { token: TOKEN_A })

  assert.equal(status, 200)
  assert.equal(rows[0].active, false)
})

test('one account CANNOT deactivate another account\'s device', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' }) // owned by A

  currentUser = USER_B
  const { status, body } = await call('DELETE', '/devices', { token: TOKEN_A })

  assert.equal(status, 200, 'answers the same either way, so it is not an oracle')
  assert.equal(body.success, true)
  assert.equal(rows[0].active, true, "A's device must still be active")
  assert.equal(String(rows[0].user), USER_A)
})

// ── Test send ────────────────────────────────────────────────────────────
test('the test endpoint notifies ONLY the caller\'s own devices', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' }) // A

  currentUser = USER_B
  await call('POST', '/devices', { token: TOKEN_B, platform: 'android' }) // B

  currentUser = USER_A
  const { status, body } = await call('POST', '/test')

  assert.equal(status, 200)
  assert.equal(body.attempted, 1)
  assert.equal(body.accepted, 1)

  const sentTo = pushRequests.flat().map((m) => m.to)
  assert.deepEqual(sentTo, [TOKEN_A], "B's device must never be targeted")
})

test('the test payload is the agreed one', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  await call('POST', '/test')

  const [message] = pushRequests.flat()
  assert.equal(message.title, 'Varlikent')
  assert.equal(message.body, 'Push notifications are working.')
  assert.deepEqual(message.data, { type: 'test' })
})

test('a deactivated device is not notified', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  await call('DELETE', '/devices', { token: TOKEN_A })

  const { body } = await call('POST', '/test')

  assert.equal(body.attempted, 0)
  assert.equal(pushRequests.length, 0)
})

test('the test endpoint requires authentication', async () => {
  const { status } = await call('POST', '/test', undefined, { auth: false })
  assert.equal(status, 401)
})

// ── Provider failure ─────────────────────────────────────────────────────
test('a provider outage fails safely instead of throwing a 500', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  nextThrow = new Error('getaddrinfo ENOTFOUND exp.host')

  const { status, body } = await call('POST', '/test')

  assert.equal(status, 200, 'a notification failure is not a request failure')
  assert.equal(body.failed, 1)
  assert.equal(body.accepted, 0)
})

test('a non-2xx from Expo is counted, not thrown', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })
  nextStatus = 502

  const { status, body } = await call('POST', '/test')

  assert.equal(status, 200)
  assert.equal(body.failed, 1)
})

// ── Dead-token cleanup ───────────────────────────────────────────────────
test('DeviceNotRegistered deactivates that device automatically', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })

  nextTickets = [{ status: 'error', details: { error: 'DeviceNotRegistered' } }]
  const { body } = await call('POST', '/test')

  assert.equal(body.failed, 1)
  assert.equal(rows[0].active, false, 'a dead token must not linger forever')
})

test('an unrelated ticket error does NOT deactivate the device', async () => {
  await call('POST', '/devices', { token: TOKEN_A, platform: 'android' })

  nextTickets = [{ status: 'error', details: { error: 'MessageTooBig' } }]
  await call('POST', '/test')

  assert.equal(rows[0].active, true, 'only DeviceNotRegistered means the token is dead')
})
