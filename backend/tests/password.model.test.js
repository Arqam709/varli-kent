// The password rules that live in the User schema itself.
//
// These run against the REAL schema, the REAL pre-save hook and REAL bcrypt —
// no mocks, no database. Mongoose only needs a connection to query or persist;
// constructing a document, marking fields modified and running the registered
// middleware all work offline, so the behaviour under test here is the actual
// production behaviour rather than a restatement of it.
//
// Step 3 makes these rules load-bearing. Google accounts are now created with
// no password at all, so "what happens to a document that has none" stopped
// being a hypothetical and became the normal state of a real account.

import test from 'node:test'
import assert from 'node:assert/strict'

import User from '../models/User.js'

/** Runs the registered pre-save middleware, which is what save() would do. */
const runPreSaveHooks = (doc) => User.schema.s.hooks.execPre('save', doc, [])

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$/

const googleShapedDoc = () =>
  new User({
    name: 'Google Person',
    email: 'google-person@example.com',
    provider: 'google',
    googleId: 'G123',
    role: 'user',
  })

// ── The schema permits a passwordless account ────────────────────────────
test('password is optional, so a Google account can simply not have one', () => {
  assert.equal(User.schema.path('password').isRequired, undefined)

  const doc = googleShapedDoc()

  assert.equal(doc.validateSync(), undefined, 'must validate with no password')
  assert.equal(doc.password, undefined, 'and the field is absent, not null')
})

test('the created document carries no password key for Mongoose to store', () => {
  const stored = googleShapedDoc().toObject()

  assert.equal('password' in stored, false)
})

// ── The pre-save hook tolerates absence ──────────────────────────────────
test('the pre-save hook is a no-op for a document with no password', async () => {
  const doc = googleShapedDoc()

  await runPreSaveHooks(doc)

  assert.equal(doc.password, undefined, 'nothing invented, nothing hashed')
})

// ── Establishing a FIRST password on an account that had none ────────────
test('assigning a first password hashes it through the normal save path', async () => {
  // This is the flow a Google user reaches via Forgot Password → Reset
  // Password: the account starts with no password and ends with one they chose.
  const doc = googleShapedDoc()
  assert.equal(doc.password, undefined)

  doc.password = 'chosen-by-the-user'
  await runPreSaveHooks(doc)

  assert.match(doc.password, BCRYPT_HASH, 'stored as a bcrypt hash')
  assert.notEqual(doc.password, 'chosen-by-the-user', 'never stored in plaintext')
})

test('the newly established password then verifies', async () => {
  const doc = googleShapedDoc()

  doc.password = 'chosen-by-the-user'
  await runPreSaveHooks(doc)

  assert.equal(await doc.comparePassword('chosen-by-the-user'), true)
  assert.equal(await doc.comparePassword('not-the-password'), false)
})

test('establishing a password does not disturb the Google identity', async () => {
  const doc = googleShapedDoc()

  doc.password = 'chosen-by-the-user'
  await runPreSaveHooks(doc)

  // provider records where the account came from; it is not a statement about
  // which credentials still work. Both now do.
  assert.equal(doc.provider, 'google')
  assert.equal(doc.googleId, 'G123')
})

// ── An untouched password is never re-hashed ─────────────────────────────
test('saving an existing user without touching the password leaves it alone', async () => {
  // hydrate() builds a document in the state a database read produces: fields
  // populated, nothing marked modified. This is the state an account is in
  // when a Google sign-in attaches a googleId to it, and re-hashing an already
  // hashed password there would silently destroy the user's ability to log in.
  const doc = User.hydrate({
    name: 'Local Person',
    email: 'local-person@example.com',
    provider: 'local',
    password: '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ',
  })

  const before = doc.password

  doc.googleId = 'G123'
  await runPreSaveHooks(doc)

  assert.equal(doc.password, before, 'the hash must survive untouched')
})

test('the hook keys off isModified, not merely on the field being present', async () => {
  const doc = User.hydrate({
    name: 'Local Person',
    email: 'local-person@example.com',
    password: 'pretend-this-is-a-hash',
  })

  assert.equal(doc.isModified('password'), false)

  await runPreSaveHooks(doc)

  assert.equal(doc.password, 'pretend-this-is-a-hash')
})

// ── Why /me/password needs an explicit guard ─────────────────────────────
test('comparePassword THROWS on a passwordless account rather than returning false', async () => {
  // Documented deliberately, because it is the trap step 3 creates. bcrypt
  // refuses an undefined hash outright, so any caller that reaches
  // comparePassword() without first checking `user.password` turns a
  // legitimate request into a 500. routes/users.js guards for exactly this;
  // routes/auth.js login already did.
  const doc = googleShapedDoc()

  await assert.rejects(() => doc.comparePassword('anything'), /Illegal arguments/)
})
