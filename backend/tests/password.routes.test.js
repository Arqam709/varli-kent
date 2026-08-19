// The password lifecycle of an account that started out with none.
//
// Step 3 removed the placeholder password from new Google accounts, which
// makes "no password" a real, normal state rather than an impossible one.
// These tests walk the whole route-level consequence of that: such an account
// cannot password-log-in, can still ask for a reset link, can establish a
// first password through it, and can then use both ways in.
//
// The REAL routers run here. Only MongoDB and the outbound email are faked.
// Password hashing is deliberately real bcrypt — the schema hook itself is
// covered separately in password.model.test.js.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const TEST_JWT_SECRET = 'test-only-secret-not-a-real-key-abcdefghijklmnop'

process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.FRONTEND_URL = 'http://localhost:5173'

// ── Fake collection ──────────────────────────────────────────────────────
let docs = []
const sentEmails = []

/**
 * A document that behaves the way the routes rely on: comparePassword runs
 * real bcrypt, and save() applies the same "hash only when modified" rule the
 * schema hook applies. Both are one-liners in models/User.js and both are
 * verified against the real schema in password.model.test.js; reproducing them
 * here is what lets these route tests assert real cryptographic outcomes
 * instead of asserting that a stub was called.
 */
const makeDoc = (fields) => {
  const doc = {
    ...fields,
    _id: fields._id || `user-${docs.length + 1}`,
    isActive: fields.isActive ?? true,

    async comparePassword(candidate) {
      return bcrypt.compare(candidate, this.password)
    },

    async save() {
      if (this.password && this.password !== this.__hashedFrom) {
        this.password = await bcrypt.hash(this.password, 12)
        this.__hashedFrom = this.password
      }
      return this
    },
  }

  Object.defineProperty(doc, 'toObject', {
    value: () => {
      const { comparePassword, save, toObject, ...rest } = doc
      return rest
    },
    enumerable: false,
  })

  // Non-enumerable, so this bookkeeping never reaches a spread, a JSON
  // serialisation or a response body. A real Mongoose document has no such
  // field; leaving it visible would make the fake look like it was leaking a
  // hash when only the harness was.
  Object.defineProperty(doc, '__hashedFrom', {
    value: doc.password,
    writable: true,
    enumerable: false,
  })

  return doc
}

/** Seeds a user whose stored password is a genuine bcrypt hash. */
const seedWithPassword = async (fields, plaintext) => {
  const doc = makeDoc({ ...fields, password: await bcrypt.hash(plaintext, 12) })
  docs.push(doc)
  return doc
}

const seedPasswordless = (fields) => {
  const doc = makeDoc(fields)
  delete doc.password
  docs.push(doc)
  return doc
}

const matchesQuery = (doc, query) =>
  Object.entries(query).every(([field, condition]) => {
    const value = doc[field]

    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$gt' in condition) return value != null && value > condition.$gt
      if (Array.isArray(condition.$in)) {
        return condition.$in.some((c) =>
          c === null ? value === null || value === undefined : value === c
        )
      }
    }

    return value === condition
  })

/**
 * A minimal chainable query, because the middleware calls
 * `User.findById(id).select('-password')` — the select happens BEFORE the
 * await, so a plain async function would blow up on `.select` of a Promise.
 *
 * The projection is honoured rather than ignored. `protect` puts whatever this
 * returns onto req.user, and GET /me serialises req.user straight back to the
 * client, so a fake that quietly dropped the projection would report that
 * endpoint as safe no matter what it actually returned.
 */
const query = (resolve) => {
  const chain = {
    select(projection) {
      const excluded = projection
        .split(' ')
        .filter((field) => field.startsWith('-'))
        .map((field) => field.slice(1))

      const previous = resolve
      resolve = () => {
        const doc = previous()
        if (!doc) return doc

        const projected = { ...doc, toObject: () => doc.toObject() }
        for (const field of excluded) delete projected[field]
        return projected
      }

      return chain
    },
    then: (onFulfilled, onRejected) =>
      Promise.resolve().then(resolve).then(onFulfilled, onRejected),
  }

  return chain
}

const FakeUser = {
  async findOne(criteria) {
    return docs.find((doc) => matchesQuery(doc, criteria)) || null
  },
  findById(id) {
    return query(() => docs.find((doc) => doc._id === id) || null)
  },
  findByIdAndUpdate(id, update) {
    return query(() => {
      const doc = docs.find((candidate) => candidate._id === id) || null
      if (doc) Object.assign(doc, update)
      return doc
    })
  },
  async create(fields) {
    const doc = makeDoc(fields)
    await doc.save()
    docs.push(doc)
    return doc
  },
}

mock.module('../models/User.js', { defaultExport: FakeUser })

// The reset email must never actually be sent from a test run.
mock.module('../utils/email.js', {
  namedExports: {
    sendPasswordResetEmail: async (to, url) => {
      sentEmails.push({ to, url })
      return true
    },
  },
})

// ── Server under test ────────────────────────────────────────────────────
let server
let baseUrl

before(async () => {
  const { default: authRoutes } = await import('../routes/auth.js')
  const { default: userRoutes } = await import('../routes/users.js')

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use('/api/users', userRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

const request = async (method, path, { body, token } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return { status: response.status, body: await response.json() }
}

test.beforeEach(() => {
  docs = []
  sentEmails.length = 0
})

// ── Website theme preference ─────────────────────────────────────────────
test('all eight website themes persist and invalid themes are rejected', async () => {
  const user = seedPasswordless({ _id: 'theme-user', name: 'Theme User', email: 'theme@example.com' })
  const token = tokenFor('theme-user')
  const validThemes = [
    'default',
    'forest',
    'earth',
    'navy',
    'gold-white',
    'sand-travertine',
    'rosewood-blush',
    'blush-ivory',
  ]

  for (const theme of validThemes) {
    const response = await request('PUT', '/api/users/me/theme', { token, body: { theme } })
    assert.equal(response.status, 200, `${theme} should be accepted`)
    assert.equal(user.themePreference, theme)
  }

  const invalid = await request('PUT', '/api/users/me/theme', {
    token,
    body: { theme: 'not-a-real-theme' },
  })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.success, false)
})

test('theme preference endpoint rejects unauthenticated requests', async () => {
  const response = await request('PUT', '/api/users/me/theme', { body: { theme: 'default' } })
  assert.equal(response.status, 401)
})

// ── D. A passwordless account cannot password-log-in ─────────────────────
test('D. a Google account with no password is refused at /login', async () => {
  seedPasswordless({
    _id: 'google-user',
    name: 'Google Person',
    email: 'google@example.com',
    provider: 'google',
    googleId: 'G123',
  })

  const { status, body } = await request('POST', '/api/auth/login', {
    body: { email: 'google@example.com', password: 'any-guess' },
  })

  assert.equal(status, 401)
  assert.equal(body.success, false)
  assert.equal(body.token, undefined)
})

test('D. the refusal is the generic message, not "this account has no password"', async () => {
  seedPasswordless({ _id: 'g', email: 'google@example.com', name: 'G', provider: 'google' })

  const { body } = await request('POST', '/api/auth/login', {
    body: { email: 'google@example.com', password: 'any-guess' },
  })

  // Saying more would confirm the address is registered AND describe how it
  // authenticates, which is a free map for anyone probing accounts.
  assert.equal(body.message, 'Invalid credentials')

  const missing = await request('POST', '/api/auth/login', {
    body: { email: 'nobody@example.com', password: 'any-guess' },
  })

  assert.equal(missing.body.message, body.message, 'identical to the unknown-email response')
  assert.equal(missing.status, 401)
})

test('D. a passwordless login attempt does not crash on bcrypt', async () => {
  // bcrypt.compare() throws on an undefined hash, so the guard in /login is
  // what keeps this a 401 rather than a 500.
  seedPasswordless({ _id: 'g', email: 'google@example.com', name: 'G' })

  const { status } = await request('POST', '/api/auth/login', {
    body: { email: 'google@example.com', password: 'x' },
  })

  assert.notEqual(status, 500)
  assert.equal(status, 401)
})

// ── E. Forgot Password is available to a passwordless account ────────────
test('E. a passwordless Google account can request a reset link', async () => {
  const user = seedPasswordless({
    _id: 'google-user',
    name: 'Google Person',
    email: 'google@example.com',
    provider: 'google',
    googleId: 'G123',
  })

  const { status, body } = await request('POST', '/api/auth/forgot-password', {
    body: { email: 'google@example.com' },
  })

  assert.equal(status, 200)
  assert.equal(body.success, true)

  assert.equal(sentEmails.length, 1, 'the reset email is genuinely sent')
  assert.ok(user.resetPasswordToken, 'a hashed token is stored on the account')
  assert.ok(user.resetPasswordExpires > new Date(), 'with an expiry in the future')
})

test('E. the stored reset token is hashed, never the raw token from the link', async () => {
  const user = seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  await request('POST', '/api/auth/forgot-password', { body: { email: 'google@example.com' } })

  const rawToken = new URL(sentEmails[0].url).searchParams.get('token')

  assert.notEqual(user.resetPasswordToken, rawToken, 'the raw token must not be at rest')
  assert.equal(
    user.resetPasswordToken,
    crypto.createHash('sha256').update(rawToken).digest('hex')
  )
})

test('E. the response is identical for an unknown email', async () => {
  const known = await request('POST', '/api/auth/forgot-password', {
    body: { email: 'nobody@example.com' },
  })

  seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  const unknown = await request('POST', '/api/auth/forgot-password', {
    body: { email: 'google@example.com' },
  })

  assert.equal(known.status, unknown.status)
  assert.deepEqual(known.body, unknown.body, 'anti-enumeration behaviour preserved')
})

// ── The reset credential must never reach the logs ───────────────────────

/**
 * Runs a request with every console method captured, and returns everything
 * that was written as one string.
 *
 * The route logs synchronously during the request, so swapping the methods
 * around the awaited call catches all of it. Arguments are serialised the way
 * a log transport would see them, so a sensitive value nested in an object
 * would still be caught rather than slipping through as "[object Object]".
 */
const captureLogs = async (run) => {
  const original = { ...console }
  const written = []
  const record = (...args) =>
    written.push(
      args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
    )

  console.log = record
  console.error = record
  console.warn = record
  console.info = record

  try {
    const result = await run()
    return { result, logs: written.join('\n') }
  } finally {
    Object.assign(console, original)
  }
}

test('forgot-password never writes the raw reset token to the logs', async () => {
  const user = seedPasswordless({
    _id: 'google-user',
    name: 'Google Person',
    email: 'google@example.com',
    provider: 'google',
    googleId: 'G123',
  })

  const { result, logs } = await captureLogs(() =>
    request('POST', '/api/auth/forgot-password', { body: { email: 'google@example.com' } })
  )

  // The email still goes out, still carrying a working link.
  assert.equal(sentEmails.length, 1)

  const resetUrl = sentEmails[0].url
  const rawToken = new URL(resetUrl).searchParams.get('token')

  assert.ok(rawToken, 'the emailed link still contains the raw token')
  assert.equal(sentEmails[0].to, 'google@example.com')

  // None of it may appear in the logs. The raw token is the credential: an
  // attacker reading logs would need nothing else to seize the account.
  assert.equal(logs.includes(rawToken), false, 'raw token must not be logged')
  assert.equal(logs.includes(resetUrl), false, 'reset URL must not be logged')
  assert.equal(logs.includes('reset-password?token='), false, 'nor any fragment of it')
  assert.equal(logs.includes('google@example.com'), false, 'nor the account address')

  // Storage and response are unchanged by the logging fix.
  assert.equal(
    user.resetPasswordToken,
    crypto.createHash('sha256').update(rawToken).digest('hex'),
    'MongoDB still holds only the hash'
  )
  assert.equal(user.resetPasswordToken.includes(rawToken), false)
  assert.equal(result.status, 200)
  assert.equal(result.body.message, 'If that email is registered, a reset link has been sent.')
})

test('the operational log line survives, so the send is still observable', async () => {
  // Removing the sensitive parts must not mean removing the signal: whether
  // the email actually went out is the one thing worth knowing here.
  seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  const { logs } = await captureLogs(() =>
    request('POST', '/api/auth/forgot-password', { body: { email: 'google@example.com' } })
  )

  assert.match(logs, /\[forgot-password\]/, 'the operation is still logged')
  assert.match(logs, /true|false/, 'and it still reports whether the email was sent')
})

test('a reset for an unknown email logs nothing sensitive either', async () => {
  const { result, logs } = await captureLogs(() =>
    request('POST', '/api/auth/forgot-password', { body: { email: 'nobody@example.com' } })
  )

  assert.equal(logs.includes('nobody@example.com'), false)
  assert.equal(result.status, 200)
})

test('completing a reset does not log the token that was consumed', async () => {
  const user = seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  await request('POST', '/api/auth/forgot-password', { body: { email: 'google@example.com' } })
  const rawToken = new URL(sentEmails.at(-1).url).searchParams.get('token')

  const { logs } = await captureLogs(() =>
    request('POST', '/api/auth/reset-password', {
      body: { token: rawToken, password: 'a-real-choice' },
    })
  )

  assert.equal(logs.includes(rawToken), false, 'the token must not surface on the way out either')
  assert.equal(logs.includes('a-real-choice'), false, 'and neither must the new password')
  assert.equal(await user.comparePassword('a-real-choice'), true, 'while the reset still works')
})

// ── F. Reset Password establishes the FIRST password ─────────────────────
/** Runs forgot-password and returns the raw token from the emailed link. */
const requestResetToken = async (email) => {
  await request('POST', '/api/auth/forgot-password', { body: { email } })
  return new URL(sentEmails.at(-1).url).searchParams.get('token')
}

test('F. a first password can be established on an account that had none', async () => {
  const user = seedPasswordless({
    _id: 'google-user',
    name: 'Google Person',
    email: 'google@example.com',
    provider: 'google',
    googleId: 'G123',
  })

  assert.equal(user.password, undefined)

  const token = await requestResetToken('google@example.com')

  const { status, body } = await request('POST', '/api/auth/reset-password', {
    body: { token, password: 'a-real-choice' },
  })

  assert.equal(status, 200)
  assert.equal(body.success, true)

  assert.ok(user.password, 'the account now has a password')
  assert.notEqual(user.password, 'a-real-choice', 'stored hashed, never in plaintext')
  assert.equal(await user.comparePassword('a-real-choice'), true)
})

test('F. the reset token is consumed, so the link cannot be replayed', async () => {
  const user = seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })
  const token = await requestResetToken('google@example.com')

  await request('POST', '/api/auth/reset-password', { body: { token, password: 'first-choice' } })

  assert.equal(user.resetPasswordToken, undefined)

  const replay = await request('POST', '/api/auth/reset-password', {
    body: { token, password: 'attacker-choice' },
  })

  assert.equal(replay.status, 400)
  assert.equal(await user.comparePassword('first-choice'), true, 'the first password stands')
})

test('F. establishing a password leaves provider and googleId untouched', async () => {
  const user = seedPasswordless({
    _id: 'g',
    name: 'G',
    email: 'google@example.com',
    provider: 'google',
    googleId: 'G123',
  })

  const token = await requestResetToken('google@example.com')
  await request('POST', '/api/auth/reset-password', { body: { token, password: 'a-real-choice' } })

  assert.equal(user.provider, 'google', 'provider still records the account origin')
  assert.equal(user.googleId, 'G123', 'and Google remains a way in')
})

test('F. an invalid or expired token establishes nothing', async () => {
  const user = seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  const { status } = await request('POST', '/api/auth/reset-password', {
    body: { token: 'not-a-real-token', password: 'attacker-choice' },
  })

  assert.equal(status, 400)
  assert.equal(user.password, undefined, 'the account is still passwordless')
})

// ── G. After the reset, password login works ─────────────────────────────
test('G. the account can log in with the password it just established', async () => {
  seedPasswordless({
    _id: 'google-user',
    name: 'Google Person',
    email: 'google@example.com',
    provider: 'google',
    googleId: 'G123',
  })

  const token = await requestResetToken('google@example.com')
  await request('POST', '/api/auth/reset-password', { body: { token, password: 'a-real-choice' } })

  const { status, body } = await request('POST', '/api/auth/login', {
    body: { email: 'google@example.com', password: 'a-real-choice' },
  })

  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(jwt.verify(body.token, TEST_JWT_SECRET).id, 'google-user')

  // provider is unchanged by any of this: it still says where the account
  // began, while googleId and password both now describe how it can be used.
  assert.equal(body.user.provider, 'google')
})

test('G. the wrong password is still refused afterwards', async () => {
  seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  const token = await requestResetToken('google@example.com')
  await request('POST', '/api/auth/reset-password', { body: { token, password: 'a-real-choice' } })

  const { status } = await request('POST', '/api/auth/login', {
    body: { email: 'google@example.com', password: 'wrong' },
  })

  assert.equal(status, 401)
})

// ── Change Password on a passwordless account ────────────────────────────
const tokenFor = (id) => jwt.sign({ id }, TEST_JWT_SECRET, { expiresIn: '1h' })

test('change-password refuses a passwordless account cleanly, not with a 500', async () => {
  const user = seedPasswordless({
    _id: 'google-user',
    name: 'Google Person',
    email: 'google@example.com',
    provider: 'google',
  })

  const { status, body } = await request('PUT', '/api/users/me/password', {
    token: tokenFor('google-user'),
    body: { currentPassword: 'anything', newPassword: 'newpass1', confirmPassword: 'newpass1' },
  })

  assert.notEqual(status, 500, 'bcrypt must not be reached with an undefined hash')
  assert.equal(status, 400)
  assert.equal(body.success, false)
  assert.equal(user.password, undefined, 'and no password may be set this way')
})

test('change-password still demands the current password when one exists', async () => {
  await seedWithPassword(
    { _id: 'local-user', name: 'Local', email: 'local@example.com', provider: 'local' },
    'the-real-one'
  )

  const wrong = await request('PUT', '/api/users/me/password', {
    token: tokenFor('local-user'),
    body: { currentPassword: 'guessing', newPassword: 'newpass1', confirmPassword: 'newpass1' },
  })

  assert.equal(wrong.status, 401, 'the security check is unchanged')

  const right = await request('PUT', '/api/users/me/password', {
    token: tokenFor('local-user'),
    body: { currentPassword: 'the-real-one', newPassword: 'newpass1', confirmPassword: 'newpass1' },
  })

  assert.equal(right.status, 200)
})

// ── Legacy accounts keep what they have ──────────────────────────────────
test('a pre-step-3 Google account with a placeholder password still behaves normally', async () => {
  // The three Google accounts that predate this change carry a bcrypt hash of
  // a random string nobody has ever seen. Step 3 does not remove those. Such
  // an account cannot be password-guessed, and can still take the reset path.
  const user = await seedWithPassword(
    { _id: 'legacy', name: 'Legacy', email: 'legacy@example.com', provider: 'google' },
    'kx8f2mq9wz1a'
  )

  const guess = await request('POST', '/api/auth/login', {
    body: { email: 'legacy@example.com', password: 'kx8f2mq9wz1b' },
  })

  assert.equal(guess.status, 401)
  assert.ok(user.password, 'the legacy hash is untouched')

  const token = await requestResetToken('legacy@example.com')
  await request('POST', '/api/auth/reset-password', { body: { token, password: 'chosen-now' } })

  const { status } = await request('POST', '/api/auth/login', {
    body: { email: 'legacy@example.com', password: 'chosen-now' },
  })

  assert.equal(status, 200, 'and they can replace it deliberately')
})

// ── I. Password never leaves the API ─────────────────────────────────────
test('I. no response in the whole lifecycle contains a password or a hash', async () => {
  await seedWithPassword(
    { _id: 'local-user', name: 'Local', email: 'local@example.com', provider: 'local' },
    'the-real-one'
  )

  const login = await request('POST', '/api/auth/login', {
    body: { email: 'local@example.com', password: 'the-real-one' },
  })

  assert.equal(login.body.user.password, undefined, 'safeUser strips it')
  assert.equal(JSON.stringify(login.body).includes('the-real-one'), false)
  assert.equal(JSON.stringify(login.body).includes('$2b$'), false, 'no bcrypt hash either')

  const me = await request('GET', '/api/auth/me', { token: login.body.token })

  assert.equal(me.status, 200)
  assert.equal(me.body.user.password, undefined)
  assert.equal(JSON.stringify(me.body).includes('$2b$'), false)
})

test('I. the reset response does not echo the new password back', async () => {
  seedPasswordless({ _id: 'g', name: 'G', email: 'google@example.com' })

  const token = await requestResetToken('google@example.com')
  const { body } = await request('POST', '/api/auth/reset-password', {
    body: { token, password: 'a-real-choice' },
  })

  assert.equal(JSON.stringify(body).includes('a-real-choice'), false)
})
