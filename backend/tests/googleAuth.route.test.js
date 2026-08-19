// End-to-end coverage for POST /api/auth/google.
//
// This exercises the REAL express router and the REAL verification service.
// Only the two genuine externals are replaced: Google's network endpoints and
// MongoDB. That is what makes it worth having alongside the unit suite — it is
// the test that would catch the route being wired up wrongly, the response
// shape drifting, or a rejection coming back with the wrong HTTP status.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'

const TRUSTED_WEB_CLIENT = 'trusted-web-client.apps.googleusercontent.com'
const ATTACKER_CLIENT = 'someone-elses-app.apps.googleusercontent.com'
const TEST_JWT_SECRET = 'test-only-secret-not-a-real-key-abcdefghijklmnop'

process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.GOOGLE_CLIENT_ID = TRUSTED_WEB_CLIENT
delete process.env.GOOGLE_CLIENT_IDS

// ── The scripted Google ──────────────────────────────────────────────────
// Each test sets these before making its request.
let tokenInfoResponse = null
let tokenInfoError = null
let profileResponse = null

const resetGoogle = () => {
  tokenInfoResponse = {
    aud: TRUSTED_WEB_CLIENT,
    sub: '1098765432100',
    email: 'buyer@example.com',
    email_verified: 'true',
    scopes: ['openid', 'email', 'profile'],
  }
  tokenInfoError = null
  profileResponse = {
    sub: '1098765432100',
    name: 'Test Buyer',
    email: 'buyer@example.com',
    email_verified: true,
    picture: 'https://lh3.googleusercontent.com/a/example',
  }
}

resetGoogle()

// ── The scripted database ────────────────────────────────────────────────
let storedUser = null
const createdDocs = []

/**
 * Mongoose documents respond to toObject(); safeUser() calls it. The fake has
 * to do the same or the route would break for a reason that has nothing to do
 * with what is being tested.
 */
const asDocument = (fields) => {
  const doc = { ...fields }

  // Non-enumerable so that spreading the document does not copy the method
  // itself, and defined over `doc` rather than the original `fields` so that a
  // field written by linking is actually visible to safeUser().
  Object.defineProperty(doc, 'toObject', {
    value: () => ({ ...doc }),
    enumerable: false,
  })

  return doc
}

/**
 * Reproduces just enough MongoDB query semantics for the linking logic to be
 * exercised honestly — in particular that a null inside `$in` also matches a
 * document where the field is absent, which is what makes the compare-and-swap
 * in attachGoogleId work against real accounts.
 *
 * A fake that returned storedUser for every findOne would make the
 * googleId-first lookup untestable: it would "find" a linked user that has no
 * googleId at all.
 */
const matchesQuery = (doc, query) =>
  Object.entries(query).every(([field, condition]) => {
    const value = doc[field]

    if (condition && typeof condition === 'object' && Array.isArray(condition.$in)) {
      return condition.$in.some((candidate) =>
        candidate === null ? value === null || value === undefined : value === candidate
      )
    }

    return value === condition
  })

const updatedFields = []

const FakeUser = {
  async findOne(query) {
    if (!storedUser || !matchesQuery(storedUser, query)) return null
    return storedUser
  },
  async findOneAndUpdate(query, update, options) {
    if (!storedUser || !matchesQuery(storedUser, query)) return null

    updatedFields.push(Object.keys(update.$set))
    Object.assign(storedUser, update.$set)

    return options?.new ? storedUser : { ...storedUser }
  },
  async create(doc) {
    createdDocs.push(doc)
    return asDocument({ _id: 'created-user-id', isActive: true, ...doc })
  },
}

mock.module('../models/User.js', { defaultExport: FakeUser })

// google-auth-library is replaced wholesale so getTokenInfo never leaves the
// process. The service constructs its OAuth2Client at import time, which is
// why this registration has to happen before the dynamic import below.
mock.module('google-auth-library', {
  namedExports: {
    OAuth2Client: class {
      async getTokenInfo() {
        if (tokenInfoError) throw tokenInfoError
        return tokenInfoResponse
      }
    },
  },
})

// The userinfo call uses global fetch directly. Intercept just that URL and
// let everything else through — the test client below needs real fetch to talk
// to the express server.
const realFetch = globalThis.fetch

globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
    if (!profileResponse) {
      return { ok: false, status: 500, json: async () => ({}) }
    }

    return { ok: true, status: 200, json: async () => profileResponse }
  }

  return realFetch(url, options)
}

// ── Server under test ────────────────────────────────────────────────────
let server
let baseUrl

before(async () => {
  const { default: authRoutes } = await import('../routes/auth.js')

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  globalThis.fetch = realFetch
  if (server) await new Promise((resolve) => server.close(resolve))
})

/** POSTs to the live route and returns { status, body }. */
const postGoogle = async (body) => {
  const response = await realFetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  return { status: response.status, body: await response.json() }
}

test.beforeEach(() => {
  resetGoogle()
  storedUser = null
  createdDocs.length = 0
  updatedFields.length = 0
})

// ── A. Missing token ─────────────────────────────────────────────────────
test('A. POST with no accessToken is a 400', async () => {
  const { status, body } = await postGoogle({})

  assert.equal(status, 400)
  assert.equal(body.success, false)
  assert.equal(body.message, 'Google access token is required')
})

test('A. POST with an empty body object is a 400, not a 500', async () => {
  const { status } = await postGoogle({ accessToken: '' })

  assert.equal(status, 400)
})

// ── B. Invalid token ─────────────────────────────────────────────────────
test('B. a token Google rejects is a 401', async () => {
  tokenInfoError = Object.assign(new Error('invalid_token'), { status: 400 })

  const { status, body } = await postGoogle({ accessToken: 'expired' })

  assert.equal(status, 401)
  assert.equal(body.success, false)
  assert.equal(body.message, 'Google authentication failed')
  assert.equal(body.token, undefined)
})

// ── C. Valid token from the trusted client ───────────────────────────────
test('C. a valid token from the Varlikent client returns a Varlikent JWT', async () => {
  const { status, body } = await postGoogle({ accessToken: 'good-token' })

  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.token, 'a session token must be issued')
  assert.ok(body.user, 'the user must be returned')

  // The session is Varlikent's own JWT, not anything of Google's.
  const decoded = jwt.verify(body.token, TEST_JWT_SECRET)
  assert.equal(decoded.id, 'created-user-id')

  assert.equal(body.user.email, 'buyer@example.com')
  assert.equal(body.user.provider, 'google')
  assert.equal(body.user.password, undefined, 'safeUser must still strip the password')

  // Step 2: the Google subject is now persisted on the new account.
  assert.equal(createdDocs.length, 1)
  assert.equal(createdDocs[0].googleId, '1098765432100')
})

test('C. the Google access token is never echoed back to the browser', async () => {
  const { body } = await postGoogle({ accessToken: 'super-secret-google-token' })

  assert.equal(JSON.stringify(body).includes('super-secret-google-token'), false)
})

// ── D. Valid token from an untrusted client — the vulnerability ──────────
test('D. a real Google token issued to another app is a 401 and creates nothing', async () => {
  tokenInfoResponse = { ...tokenInfoResponse, aud: ATTACKER_CLIENT }

  const { status, body } = await postGoogle({ accessToken: 'valid-but-foreign' })

  assert.equal(status, 401)
  assert.equal(body.success, false)
  assert.equal(body.message, 'Google authentication failed')
  assert.equal(body.token, undefined, 'no session may be issued')
  assert.equal(createdDocs.length, 0, 'no Varlikent account may be created')
})

test('D. the rejection does not disclose that the audience was the problem', async () => {
  tokenInfoResponse = { ...tokenInfoResponse, aud: ATTACKER_CLIENT }

  const { body } = await postGoogle({ accessToken: 'valid-but-foreign' })

  const message = body.message.toLowerCase()
  assert.equal(message.includes('client'), false)
  assert.equal(message.includes('audience'), false)
  assert.equal(JSON.stringify(body).includes(ATTACKER_CLIENT), false)
})

// ── E. No email ──────────────────────────────────────────────────────────
test('E. a verified token with no email address is a 401', async () => {
  tokenInfoResponse = { aud: TRUSTED_WEB_CLIENT, sub: '1098765432100' }
  profileResponse = { sub: '1098765432100', name: 'No Email' }

  const { status, body } = await postGoogle({ accessToken: 'no-email' })

  assert.equal(status, 401)
  assert.equal(body.message, 'Google authentication failed')
  assert.equal(createdDocs.length, 0)
})

// ── F. Unverified email ──────────────────────────────────────────────────
test('F. an unverified Google email is refused and creates no account', async () => {
  tokenInfoResponse = { ...tokenInfoResponse, email_verified: 'false' }
  profileResponse = { ...profileResponse, email_verified: false }

  const { status, body } = await postGoogle({ accessToken: 'unverified' })

  assert.equal(status, 403)
  assert.equal(body.success, false)
  assert.equal(createdDocs.length, 0, 'an unverified address must not claim an account')
})

// ── G. Existing active user, linked on the way through ───────────────────
test('G. an existing active user signs in without a second account being created', async () => {
  storedUser = asDocument({
    _id: 'existing-user-id',
    name: 'Returning Buyer',
    email: 'buyer@example.com',
    role: 'agent',
    provider: 'local',
    isActive: true,
    password: 'hashed-secret',
  })

  const { status, body } = await postGoogle({ accessToken: 'good-token' })

  assert.equal(status, 200)
  assert.equal(body.success, true)

  // Step 2: that same sign-in lazily attached the Google identity, writing
  // googleId and nothing else.
  assert.equal(body.user.googleId, '1098765432100')
  assert.deepEqual(updatedFields, [['googleId']])
  assert.equal(createdDocs.length, 0)

  assert.equal(jwt.verify(body.token, TEST_JWT_SECRET).id, 'existing-user-id')

  // Neither role nor provider may be rewritten by a Google sign-in.
  assert.equal(body.user.role, 'agent')
  assert.equal(body.user.provider, 'local')
  assert.equal(body.user.password, undefined)
})

// ── H. Inactive account ──────────────────────────────────────────────────
test('H. a deactivated account is refused with 403 and gets no token', async () => {
  storedUser = asDocument({
    _id: 'banned-user-id',
    email: 'buyer@example.com',
    isActive: false,
  })

  const { status, body } = await postGoogle({ accessToken: 'good-token' })

  assert.equal(status, 403)
  assert.equal(body.success, false)
  assert.equal(body.message, 'Your account is deactivated')
  assert.equal(body.token, undefined)
  assert.deepEqual(updatedFields, [], 'and it is not linked on the way out')
})

// ── Step 2: linking, end to end through the route ────────────────────────
test('a returning linked user is matched by googleId, not by email', async () => {
  // The Google account's address has changed since they last signed in. The
  // stable subject still identifies them, and their Varlikent email stands.
  storedUser = asDocument({
    _id: 'linked-user-id',
    email: 'old-address@example.com',
    googleId: '1098765432100',
    provider: 'google',
    role: 'user',
    isActive: true,
  })

  tokenInfoResponse = { ...tokenInfoResponse, email: 'new-address@example.com' }
  profileResponse = { ...profileResponse, email: 'new-address@example.com' }

  const { status, body } = await postGoogle({ accessToken: 'good-token' })

  assert.equal(status, 200)
  assert.equal(jwt.verify(body.token, TEST_JWT_SECRET).id, 'linked-user-id')
  assert.equal(body.user.email, 'old-address@example.com', 'email is not rewritten')
  assert.deepEqual(updatedFields, [], 'and nothing is written at all')
  assert.equal(createdDocs.length, 0)
})

test('an account linked to a DIFFERENT Google identity is refused', async () => {
  storedUser = asDocument({
    _id: 'someone-elses-account',
    email: 'buyer@example.com',
    googleId: 'G-a-completely-different-subject',
    isActive: true,
  })

  const { status, body } = await postGoogle({ accessToken: 'good-token' })

  assert.equal(status, 401)
  assert.equal(body.success, false)
  assert.equal(body.message, 'Google authentication failed')
  assert.equal(body.token, undefined, 'no session for a conflicting identity')
  assert.equal(
    storedUser.googleId,
    'G-a-completely-different-subject',
    'the existing link must not be overwritten'
  )
  assert.deepEqual(updatedFields, [])
})

test('a token carrying no Google subject is refused', async () => {
  tokenInfoResponse = { ...tokenInfoResponse, sub: undefined }
  profileResponse = { ...profileResponse, sub: undefined }

  const { status, body } = await postGoogle({ accessToken: 'no-sub' })

  assert.equal(status, 401)
  assert.equal(body.message, 'Google authentication failed')
  assert.equal(createdDocs.length, 0)
})

test('no Google identifier is echoed to the browser on a rejection', async () => {
  storedUser = asDocument({
    _id: 'someone-elses-account',
    email: 'buyer@example.com',
    googleId: 'G-a-completely-different-subject',
    isActive: true,
  })

  const { body } = await postGoogle({ accessToken: 'good-token' })

  const serialised = JSON.stringify(body)
  assert.equal(serialised.includes('G-a-completely-different-subject'), false)
  assert.equal(serialised.includes('1098765432100'), false)
})

// ── Website contract regression guard ────────────────────────────────────
test('the website request shape { accessToken } is still the accepted contract', async () => {
  // If this ever fails, production Google login is broken: LoginPage.jsx sends
  // exactly this body and nothing else.
  const { status, body } = await postGoogle({ accessToken: 'good-token' })

  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body).sort(), ['success', 'token', 'user'])
})

test('an idToken-shaped body is still rejected, since the site does not send one', async () => {
  const { status } = await postGoogle({ idToken: 'something.else.entirely' })

  assert.equal(status, 400)
})
