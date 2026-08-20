// Delivery through Resend's HTTPS API.
//
// Everything here runs against a fake global fetch, so the suite makes no
// network request, needs no API key, and can never send a real email. What is
// under test is the decision logic around the call: when it refuses to send at
// all, what it puts on the wire when it does, and what it reports back.
//
// The two HTML templates are deliberately NOT asserted line by line — they are
// unchanged from the SMTP implementation and are covered by being passed
// through. What IS asserted is that the reset URL reaches the HTML and never
// reaches a log, because that URL embeds the raw reset token.

import test, { before, mock } from 'node:test'
import assert from 'node:assert/strict'

/**
 * LeadRouting is replaced before utils/email.js is imported.
 *
 * Without this the lead tests run a real Mongoose query with no connection
 * open. That does not fail — it sits in the driver buffer until a ten-second
 * timeout, inside the try/catch that treats a routing lookup failure as
 * non-fatal. The assertions still passed, but each lead test took ten seconds
 * for a reason that had nothing to do with what it was testing.
 */
/** Scripted per test; null means "no routing configured for this type". */
let routingDoc = null

mock.module('../models/LeadRouting.js', {
  defaultExport: { findOne: async () => routingDoc },
})

let sendContactNotification
let sendPasswordResetEmail

before(async () => {
  const mod = await import('../utils/email.js')
  sendContactNotification = mod.sendContactNotification
  sendPasswordResetEmail = mod.sendPasswordResetEmail
})

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// ── Fakes ────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
const realError = console.error

/** Every fetch the code under test attempted. */
let calls = []
/** Everything written to console.error, so logs can be asserted on. */
let logs = []
let nextResponse = null
let nextThrow = null

const installFakes = () => {
  calls = []
  logs = []
  nextThrow = null
  routingDoc = null
  nextResponse = { ok: true, status: 200, json: async () => ({ id: 'fake-id' }) }

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (nextThrow) throw nextThrow
    return nextResponse
  }

  console.error = (...args) => {
    logs.push(args.map(String).join(' '))
  }
}

const restoreFakes = () => {
  globalThis.fetch = realFetch
  console.error = realError
}

/** Sets exactly the env this module reads, so tests do not leak into each other. */
const setEnv = ({ apiKey = 'test-key-not-real', from = 'Varlikent <no-reply@example.test>', owner } = {}) => {
  if (apiKey === null) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = apiKey

  if (from === null) delete process.env.EMAIL_FROM
  else process.env.EMAIL_FROM = from

  if (owner === undefined) delete process.env.OWNER_EMAIL
  else process.env.OWNER_EMAIL = owner
}

/** Parses the JSON body of the single fetch that was made. */
const sentBody = () => JSON.parse(calls[0].options.body)

const RESET_URL = 'https://www.varlikent.com/reset-password?token=aaaabbbbccccdddd'

test.beforeEach(installFakes)
test.afterEach(restoreFakes)

// ── A. Missing RESEND_API_KEY ────────────────────────────────────────────
test('A. no API key: returns false and never calls fetch', async () => {
  setEnv({ apiKey: null })

  const result = await sendPasswordResetEmail('user@example.test', RESET_URL)

  assert.equal(result, false)
  assert.equal(calls.length, 0, 'must not reach the network without a key')
  assert.ok(
    logs.some((l) => l.includes('RESEND_API_KEY is not configured')),
    'the missing variable must be named in the log'
  )
})

// ── B. Missing EMAIL_FROM ────────────────────────────────────────────────
test('B. no EMAIL_FROM: returns false and never calls fetch', async () => {
  setEnv({ from: null })

  const result = await sendPasswordResetEmail('user@example.test', RESET_URL)

  assert.equal(result, false)
  assert.equal(calls.length, 0)
  assert.ok(logs.some((l) => l.includes('EMAIL_FROM is not configured')))
})

// ── C. A successful send ─────────────────────────────────────────────────
test('C. posts to the Resend endpoint with the documented contract', async () => {
  setEnv()

  const result = await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  assert.equal(result, true)
  assert.equal(calls.length, 1)

  const { url, options } = calls[0]
  assert.equal(url, RESEND_ENDPOINT)
  assert.equal(options.method, 'POST')

  assert.equal(options.headers.Authorization, 'Bearer test-key-not-real')
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.ok(options.headers['User-Agent'], 'Resend rejects direct calls with no User-Agent')

  const body = sentBody()
  assert.equal(body.from, 'Varlikent <no-reply@example.test>')
  assert.deepEqual(body.to, ['buyer@example.test'])
  assert.equal(body.subject, 'Reset your Varlikent password')
  assert.ok(body.html.includes('Reset Your Password'), 'the existing template is still used')
})

test('C. the sender comes from EMAIL_FROM, never from a hard-coded domain', async () => {
  setEnv({ from: 'Someone Else <mail@other.test>' })

  await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  assert.equal(sentBody().from, 'Someone Else <mail@other.test>')
})

// ── D. Provider rejection ────────────────────────────────────────────────
test('D. a non-2xx response returns false and logs a safe diagnostic', async () => {
  setEnv()
  nextResponse = {
    ok: false,
    status: 403,
    json: async () => ({ name: 'validation_error', message: 'The domain is not verified.' }),
  }

  const result = await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  assert.equal(result, false)

  const line = logs.find((l) => l.includes('Resend rejected the message'))
  assert.ok(line, 'the rejection must be logged')
  assert.ok(line.includes('status=403'), 'the status is the most useful single fact')
  assert.ok(line.includes('validation_error'), 'and the provider reason')
})

test('D. an unparseable error body still fails cleanly', async () => {
  setEnv()
  nextResponse = {
    ok: false,
    status: 500,
    json: async () => {
      throw new Error('not json')
    },
  }

  assert.equal(await sendPasswordResetEmail('buyer@example.test', RESET_URL), false)
  assert.ok(logs.some((l) => l.includes('status=500')))
})

// ── E. Network failure ───────────────────────────────────────────────────
test('E. a rejected fetch returns false rather than throwing into the route', async () => {
  setEnv()
  nextThrow = new Error('getaddrinfo ENOTFOUND api.resend.com')

  const result = await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  assert.equal(result, false)
  assert.ok(logs.some((l) => l.includes('failed to complete')))
})

test('E. the forgot-password route therefore never sees an exception', async () => {
  // The route awaits this function and logs the boolean; a throw would escape
  // to the error handler and change the response the client sees, which is what
  // the generic message exists to prevent.
  setEnv()
  nextThrow = new Error('socket hang up')

  await assert.doesNotReject(() => sendPasswordResetEmail('buyer@example.test', RESET_URL))
})

// ── F. Multiple contact recipients ───────────────────────────────────────
test('F. lead notifications send to an array of de-duplicated recipients', async () => {
  setEnv({ owner: 'owner@example.test' })

  // The owner is also listed in routing, and one entry has no email at all.
  // Both are real shapes the Set + guard in sendContactNotification exist for.
  routingDoc = {
    recipients: [
      { email: 'sales@example.test' },
      { email: 'owner@example.test' },
      { email: null },
    ],
  }

  const result = await sendContactNotification({
    name: 'Test Lead',
    email: 'lead@example.test',
    phone: '+900000000',
    interestType: 'Villa',
    message: 'Interested.',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })

  assert.equal(result, true)

  const body = sentBody()
  assert.ok(Array.isArray(body.to), 'Resend takes an array for multiple recipients')
  assert.deepEqual(
    body.to,
    ['owner@example.test', 'sales@example.test'],
    'the owner appears once despite being listed twice, and the null is dropped'
  )
  assert.equal(body.subject, 'New Lead: Villa — Test Lead')
  assert.ok(body.html.includes('Test Lead'), 'the existing lead template is still used')
})

test('F. with no recipients at all, nothing is sent', async () => {
  setEnv({ owner: undefined })

  const result = await sendContactNotification({
    name: 'Test Lead',
    interestType: 'Villa',
    message: 'Interested.',
  })

  assert.equal(result, false)
  assert.equal(calls.length, 0, 'an email with no recipient must not be attempted')
})

// ── G. The reset URL reaches the HTML and never reaches a log ────────────
test('G. the reset URL is delivered in the HTML body', async () => {
  setEnv()

  await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  assert.ok(sentBody().html.includes(RESET_URL), 'the link must actually be in the email')
})

test('G. neither the reset URL, the token, the HTML nor the API key is ever logged', async () => {
  setEnv({ apiKey: 'super-secret-resend-key' })

  // Exercise every logging branch in one test, so a future branch that starts
  // logging the wrong thing cannot slip through by being on a rarer path.
  nextResponse = { ok: false, status: 422, json: async () => ({ name: 'x', message: 'y' }) }
  await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  nextThrow = new Error('boom')
  await sendPasswordResetEmail('buyer@example.test', RESET_URL)

  const all = logs.join('\n')
  assert.equal(all.includes(RESET_URL), false, 'the reset URL is a credential')
  assert.equal(all.includes('aaaabbbbccccdddd'), false, 'and so is the raw token inside it')
  assert.equal(all.includes('super-secret-resend-key'), false, 'the API key must never be logged')
  assert.equal(all.includes('<html>'), false, 'the HTML body must never be logged')
  assert.equal(all.includes('buyer@example.test'), false, 'recipients stay out of the logs too')
})
