// Protected owners — Phase 1: identity by MongoDB _id, and the guards that
// keep those two accounts from being deleted, demoted, re-permissioned,
// password-reset by someone else, or having their email changed.
//
// The REAL users router, auth router, auth middleware and role rules run here.
// Only MongoDB, the account-deletion cleanup services and Microsoft's signing
// keys are faked. No real account, database or email is touched.
//
// The two protected ids below are fixtures standing in for the two real owner
// accounts. The real ids are environment configuration (PROTECTED_OWNER_IDS)
// and deliberately appear nowhere in source, tests included.
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
const MICROSOFT_CLIENT_ID = 'test-microsoft-client-id'
const MICROSOFT_TENANT = 'test-tenant-id'

process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.MICROSOFT_CLIENT_ID = MICROSOFT_CLIENT_ID

const ID = {
  protectedA: '6a00000000000000000000a1',
  protectedB: '6a00000000000000000000b2',
  plainOwner: '6a00000000000000000000c3',
  adminPasswords: '6a00000000000000000000d4',
  adminUsers: '6a00000000000000000000e5',
  plainUser: '6a00000000000000000000f6',
}

const PROTECTED_CONFIG = `${ID.protectedA},${ID.protectedB}`
process.env.PROTECTED_OWNER_IDS = PROTECTED_CONFIG

const PASSWORD = {
  protectedA: 'protected-a-current-pw',
  plainOwner: 'plain-owner-current-pw',
  plainUser: 'plain-user-current-pw',
}

// ── Fake collection ──────────────────────────────────────────────────────
let docs = []
const deleted = []

const makeDoc = (fields) => {
  const doc = { isActive: true, permissions: [], ...fields }

  const hidden = {
    async comparePassword(candidate) {
      return bcrypt.compare(candidate, doc.password)
    },
    // Same rule as the schema's pre-save hook: hash only a changed password.
    async save() {
      if (doc.password && doc.password !== hidden.hashedFrom) {
        doc.password = await bcrypt.hash(doc.password, 4)
        hidden.hashedFrom = doc.password
      }
      return doc
    },
    toObject() {
      return { ...doc }
    },
  }
  hidden.hashedFrom = doc.password

  for (const name of ['comparePassword', 'save', 'toObject']) {
    Object.defineProperty(doc, name, { value: hidden[name], enumerable: false })
  }
  return doc
}

const seed = async (fields, plaintext) => {
  const doc = makeDoc({
    ...fields,
    ...(plaintext ? { password: await bcrypt.hash(plaintext, 4) } : {}),
  })
  docs.push(doc)
  return doc
}

const byId = (id) => docs.find((doc) => doc._id === String(id)) || null

const matches = (doc, criteria = {}) =>
  Object.entries(criteria).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && '$ne' in condition) {
      return String(doc[field]) !== String(condition.$ne)
    }
    return doc[field] === condition
  })

// Honours exclusion projections on plain copies, and hands back the live
// document when nothing is projected (the routes then call save() on it).
const project = (doc, projection) => {
  if (!doc || !projection) return doc
  const out = { ...doc }
  for (const field of projection.split(' ').filter(Boolean)) {
    if (field.startsWith('-')) delete out[field.slice(1)]
  }
  return out
}

const query = (resolve) => {
  let projection = null
  const chain = {
    select(p) { projection = p; return chain },
    then: (onFulfilled, onRejected) =>
      Promise.resolve()
        .then(() => {
          const result = resolve()
          return Array.isArray(result)
            ? result.map((doc) => project(doc, projection))
            : project(result, projection)
        })
        .then(onFulfilled, onRejected),
  }
  return chain
}

const FakeUser = {
  find: (criteria) => query(() => docs.filter((doc) => matches(doc, criteria))),
  findById: (id) => query(() => byId(id)),
  findOne: (criteria) => query(() => docs.find((doc) => matches(doc, criteria)) || null),
  findByIdAndUpdate: (id, update) =>
    query(() => {
      const doc = byId(id)
      if (doc) Object.assign(doc, update)
      return doc
    }),
  findByIdAndDelete: async (id) => {
    deleted.push(String(id))
    docs = docs.filter((doc) => doc._id !== String(id))
    return null
  },
  create: async (fields) => {
    const doc = makeDoc({ _id: crypto.randomBytes(12).toString('hex'), ...fields })
    docs.push(doc)
    return doc
  },
}

mock.module('../models/User.js', { defaultExport: FakeUser })

// Account deletion's cleanup services reach for real collections.
const noCleanup = async () => ({ deleted: 0, purged: 0, pending: 0 })
mock.module('../services/designRoomPhotos/lifecycle.js', {
  namedExports: { deleteAllRoomPhotosForUser: noCleanup },
})
mock.module('../services/designGenerations/lifecycle.js', {
  namedExports: { deleteAllGenerationsForUser: noCleanup },
})
mock.module('../services/serviceRequests/lifecycle.js', {
  namedExports: { deleteAllServiceRequestsForUser: noCleanup },
})

// Microsoft's signing keys, replaced with a key pair generated for this run so
// the route's REAL token verification executes against a token we can mint.
const msKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const msPublicPem = msKeys.publicKey.export({ type: 'spki', format: 'pem' })

mock.module('jwks-rsa', {
  defaultExport: () => ({
    getSigningKey: (kid, callback) => callback(null, { getPublicKey: () => msPublicPem }),
  }),
})

const microsoftIdToken = (email) =>
  jwt.sign(
    { tid: MICROSOFT_TENANT, preferred_username: email, name: 'Microsoft Person' },
    msKeys.privateKey,
    {
      algorithm: 'RS256',
      audience: MICROSOFT_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/v2.0`,
      keyid: 'test-key',
      expiresIn: '5m',
    }
  )

let server
let baseUrl
let protectedOwners
let roleManagement

before(async () => {
  protectedOwners = await import('../config/protectedOwners.js')
  roleManagement = await import('../services/roleManagement.js')
  const { default: userRoutes } = await import('../routes/users.js')
  const { default: authRoutes } = await import('../routes/auth.js')

  const app = express()
  app.use(express.json())
  app.use('/api/users', userRoutes)
  app.use('/api/auth', authRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

beforeEach(async () => {
  process.env.PROTECTED_OWNER_IDS = PROTECTED_CONFIG
  docs = []
  deleted.length = 0

  await seed({ _id: ID.protectedA, name: 'Protected A', email: 'a@protected.test', role: 'owner' }, PASSWORD.protectedA)
  await seed({ _id: ID.protectedB, name: 'Protected B', email: 'b@protected.test', role: 'owner' }, 'protected-b-pw')
  await seed({ _id: ID.plainOwner, name: 'Plain Owner', email: 'owner@plain.test', role: 'owner' }, PASSWORD.plainOwner)
  await seed({ _id: ID.adminPasswords, name: 'Admin PW', email: 'pw@admin.test', role: 'admin', permissions: ['manage_passwords'] }, 'admin-pw')
  await seed({ _id: ID.adminUsers, name: 'Admin UM', email: 'um@admin.test', role: 'admin', permissions: ['user_management'] }, 'admin-um')
  await seed({ _id: ID.plainUser, name: 'Buyer', email: 'buyer@user.test', role: 'user' }, PASSWORD.plainUser)
})

const tokenFor = (id) => jwt.sign({ id }, TEST_JWT_SECRET, { expiresIn: '1h' })

const call = async (method, path, { as, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(as ? { authorization: `Bearer ${tokenFor(as)}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

const passwordMatches = (id, plaintext) => bcrypt.compare(plaintext, byId(id).password)

// Everyone who could conceivably reach a management route.
const ACTORS = [
  ['the other protected owner', ID.protectedB],
  ['an ordinary owner', ID.plainOwner],
  ['an admin with manage_passwords', ID.adminPasswords],
  ['an admin with user_management', ID.adminUsers],
]

// ── Configuration ────────────────────────────────────────────────────────
test('configured ids resolve as protected from a string, an ObjectId-like value and a user document', () => {
  const { isProtectedOwner, getProtectedOwnerIds } = protectedOwners

  assert.deepEqual(getProtectedOwnerIds().sort(), [ID.protectedA, ID.protectedB].sort())

  for (const id of [ID.protectedA, ID.protectedB]) {
    assert.equal(isProtectedOwner(id), true, 'string id')
    assert.equal(isProtectedOwner(id.toUpperCase()), true, 'case-insensitive hex')
    assert.equal(isProtectedOwner({ toString: () => id }), true, 'ObjectId-like')
    assert.equal(isProtectedOwner({ _id: id, role: 'owner' }), true, 'plain user object')
    assert.equal(isProtectedOwner({ _id: { toString: () => id } }), true, 'document with ObjectId _id')
    assert.equal(isProtectedOwner(byId(id)), true, 'user document')
  }
})

test('ordinary owners, admins and users are not protected', () => {
  const { isProtectedOwner } = protectedOwners

  for (const id of [ID.plainOwner, ID.adminPasswords, ID.adminUsers, ID.plainUser]) {
    assert.equal(isProtectedOwner(id), false)
    assert.equal(isProtectedOwner(byId(id)), false)
  }
  for (const nothing of [null, undefined, '', {}, { _id: null }, 'not-an-id']) {
    assert.equal(isProtectedOwner(nothing), false)
  }
})

test('protection follows the id, never the email address', () => {
  const { isProtectedOwner } = protectedOwners

  // An ordinary owner holding a protected owner's address is still ordinary…
  byId(ID.plainOwner).email = byId(ID.protectedA).email
  assert.equal(isProtectedOwner(byId(ID.plainOwner)), false)

  // …and a protected owner whose address changed is still protected.
  byId(ID.protectedA).email = 'moved@elsewhere.test'
  assert.equal(isProtectedOwner(byId(ID.protectedA)), true)
})

test('whitespace and empty entries are tolerated', () => {
  process.env.PROTECTED_OWNER_IDS = `  ${ID.protectedA} , ,${ID.protectedB},  `
  assert.deepEqual(protectedOwners.getProtectedOwnerIds().sort(), [ID.protectedA, ID.protectedB].sort())
  assert.equal(protectedOwners.isProtectedOwnerConfigValid(), true)
})

test('missing configuration protects nobody and does not throw', () => {
  for (const value of [undefined, '', '   ', ',,']) {
    if (value === undefined) delete process.env.PROTECTED_OWNER_IDS
    else process.env.PROTECTED_OWNER_IDS = value

    assert.deepEqual(protectedOwners.getProtectedOwnerIds(), [])
    assert.equal(protectedOwners.isProtectedOwner(ID.protectedA), false)
    assert.equal(protectedOwners.isProtectedOwner(ID.plainUser), false)
    assert.equal(protectedOwners.isProtectedOwnerConfigValid(), false)
    assert.equal(protectedOwners.reportProtectedOwnerConfig(), 0)
  }
})

test('a malformed entry is ignored without protecting anyone else or dropping the valid entry', () => {
  process.env.PROTECTED_OWNER_IDS = `${ID.protectedA},not-an-object-id,a@protected.test,123`

  assert.deepEqual(protectedOwners.getProtectedOwnerIds(), [ID.protectedA])
  assert.equal(protectedOwners.isProtectedOwner(ID.protectedA), true)
  assert.equal(protectedOwners.isProtectedOwner(ID.protectedB), false)
  assert.equal(protectedOwners.isProtectedOwner('not-an-object-id'), false)
  assert.equal(protectedOwners.isProtectedOwnerConfigValid(), false)
})

test('with no configuration the existing owner rules still refuse every owner', async () => {
  delete process.env.PROTECTED_OWNER_IDS

  const del = await call('DELETE', `/api/users/${ID.protectedA}`, { as: ID.plainOwner })
  assert.equal(del.status, 403)

  const role = await call('PUT', `/api/users/${ID.protectedA}/role`, { as: ID.plainOwner, body: { role: 'user' } })
  assert.equal(role.status, 403)

  const perms = await call('PUT', `/api/users/${ID.protectedA}/permissions`, { as: ID.plainOwner, body: { permissions: [] } })
  assert.equal(perms.status, 403)

  assert.equal(byId(ID.protectedA).role, 'owner')
  assert.deepEqual(deleted, [])
})

// ── A. Delete ────────────────────────────────────────────────────────────
for (const [label, actor] of ACTORS) {
  test(`A. ${label} cannot delete a protected owner`, async () => {
    const { status } = await call('DELETE', `/api/users/${ID.protectedA}`, { as: actor })

    assert.equal(status, 403)
    assert.ok(byId(ID.protectedA), 'the account still exists')
    assert.deepEqual(deleted, [])
  })
}

test('A. the protected rule is the one that answers, ahead of the general owner rule', async () => {
  const { status, body } = await call('DELETE', `/api/users/${ID.protectedA}`, { as: ID.plainOwner })
  assert.equal(status, 403)
  assert.match(body.message, /protected/i)

  const ordinary = await call('DELETE', `/api/users/${ID.plainOwner}`, { as: ID.protectedA })
  assert.equal(ordinary.status, 403, 'ordinary owners stay undeletable through this route')
  assert.doesNotMatch(ordinary.body.message, /protected/i)
})

test('A. a protected id is refused even if its role were no longer owner', async () => {
  byId(ID.protectedA).role = 'user'

  const { status, body } = await call('DELETE', `/api/users/${ID.protectedA}`, { as: ID.plainOwner })
  assert.equal(status, 403)
  assert.match(body.message, /protected/i)
  assert.deepEqual(deleted, [])
})

test('A. deleting an ordinary user still works', async () => {
  const { status } = await call('DELETE', `/api/users/${ID.plainUser}`, { as: ID.plainOwner })
  assert.equal(status, 200)
  assert.deepEqual(deleted, [ID.plainUser])
})

// ── B. Role and active state ─────────────────────────────────────────────
for (const [label, actor] of ACTORS.filter(([, id]) => id !== ID.adminPasswords)) {
  for (const role of ['admin', 'agent', 'user']) {
    test(`B. ${label} cannot change a protected owner's role to ${role}`, async () => {
      const { status } = await call('PUT', `/api/users/${ID.protectedA}/role`, { as: actor, body: { role } })

      assert.equal(status, 403)
      assert.equal(byId(ID.protectedA).role, 'owner')
    })
  }

  test(`B. ${label} cannot deactivate a protected owner`, async () => {
    const { status } = await call('PUT', `/api/users/${ID.protectedA}/role`, {
      as: actor,
      body: { role: 'owner', isActive: false },
    })

    assert.equal(status, 403)
    assert.equal(byId(ID.protectedA).isActive, true)
  })
}

test('B. a protected owner cannot change their own role or deactivate themselves', async () => {
  const demote = await call('PUT', `/api/users/${ID.protectedA}/role`, { as: ID.protectedA, body: { role: 'user' } })
  assert.equal(demote.status, 403)

  const off = await call('PUT', `/api/users/${ID.protectedA}/role`, { as: ID.protectedA, body: { isActive: false } })
  assert.equal(off.status, 403)

  assert.equal(byId(ID.protectedA).role, 'owner')
  assert.equal(byId(ID.protectedA).isActive, true)
})

test('B. validateRoleChange refuses a protected id whatever its role, and leaves the hierarchy alone', () => {
  const { validateRoleChange } = roleManagement
  const owner = { _id: ID.plainOwner, role: 'owner', permissions: [] }

  const drifted = validateRoleChange({
    actor: owner,
    target: { _id: ID.protectedA, role: 'admin' },
    requestedRole: 'user',
  })
  assert.equal(drifted.ok, false)
  assert.equal(drifted.status, 403)
  assert.match(drifted.message, /protected/i)

  // Unchanged rules for everyone else.
  assert.deepEqual(
    validateRoleChange({ actor: owner, target: { _id: ID.plainUser, role: 'user' }, requestedRole: 'admin' }),
    { ok: true, roleChanged: true, role: 'admin' }
  )
  assert.equal(
    validateRoleChange({ actor: owner, target: { _id: ID.plainUser, role: 'user' }, requestedRole: 'owner' }).ok,
    false
  )
})

test('B. role changes on ordinary accounts still work', async () => {
  const { status, body } = await call('PUT', `/api/users/${ID.plainUser}/role`, { as: ID.protectedA, body: { role: 'agent' } })

  assert.equal(status, 200)
  assert.equal(body.user.role, 'agent')
  assert.equal(body.user.isProtected, false)
})

// ── C. Permissions ───────────────────────────────────────────────────────
for (const [label, actor] of ACTORS.filter(([, id]) => id !== ID.adminPasswords)) {
  test(`C. ${label} cannot change a protected owner's permissions`, async () => {
    const { status, body } = await call('PUT', `/api/users/${ID.protectedA}/permissions`, {
      as: actor,
      body: { permissions: ['add_listing'] },
    })

    assert.equal(status, 403)
    assert.match(body.message, /protected/i)
    assert.deepEqual(byId(ID.protectedA).permissions, [])
  })
}

test('C. permissions on an ordinary admin can still be edited', async () => {
  const { status, body } = await call('PUT', `/api/users/${ID.adminPasswords}/permissions`, {
    as: ID.plainOwner,
    body: { permissions: ['add_listing'] },
  })

  assert.equal(status, 200)
  assert.deepEqual(body.user.permissions, ['add_listing'])
})

// ── D. Administrative password reset ─────────────────────────────────────
for (const [label, actor] of ACTORS.filter(([, id]) => id !== ID.adminUsers)) {
  test(`D. ${label} cannot reset a protected owner's password`, async () => {
    const { status } = await call('PUT', `/api/users/${ID.protectedA}/password`, {
      as: actor,
      body: { newPassword: 'attacker-chosen-pw' },
    })

    assert.equal(status, 403)
    assert.equal(await passwordMatches(ID.protectedA, PASSWORD.protectedA), true, 'old password still works')
    assert.equal(await passwordMatches(ID.protectedA, 'attacker-chosen-pw'), false)
  })
}

test('D. a protected owner cannot use the administrative route on their own account either', async () => {
  const { status, body } = await call('PUT', `/api/users/${ID.protectedA}/password`, {
    as: ID.protectedA,
    body: { newPassword: 'no-current-password-proved' },
  })

  assert.equal(status, 403)
  assert.match(body.message, /protected/i)
  assert.equal(await passwordMatches(ID.protectedA, PASSWORD.protectedA), true)
})

test('D. administrative password reset is unchanged for other accounts', async () => {
  const user = await call('PUT', `/api/users/${ID.plainUser}/password`, { as: ID.plainOwner, body: { newPassword: 'new-user-pw' } })
  assert.equal(user.status, 200)
  assert.equal(await passwordMatches(ID.plainUser, 'new-user-pw'), true)

  const byAdmin = await call('PUT', `/api/users/${ID.plainUser}/password`, { as: ID.adminPasswords, body: { newPassword: 'newer-user-pw' } })
  assert.equal(byAdmin.status, 200)

  // Existing behaviour, deliberately not altered in Phase 1.
  const owner = await call('PUT', `/api/users/${ID.plainOwner}/password`, { as: ID.protectedA, body: { newPassword: 'new-owner-pw' } })
  assert.equal(owner.status, 200)

  const adminOnOwner = await call('PUT', `/api/users/${ID.plainOwner}/password`, { as: ID.adminPasswords, body: { newPassword: 'nope-nope' } })
  assert.equal(adminOnOwner.status, 403)
})

// ── E. Own password ──────────────────────────────────────────────────────
test('E. a protected owner changes their own password with the current one', async () => {
  const { status } = await call('PUT', '/api/users/me/password', {
    as: ID.protectedA,
    body: { currentPassword: PASSWORD.protectedA, newPassword: 'my-new-password', confirmPassword: 'my-new-password' },
  })

  assert.equal(status, 200)
  assert.equal(await passwordMatches(ID.protectedA, 'my-new-password'), true)
})

test('E. …and is refused with the wrong current password', async () => {
  const { status } = await call('PUT', '/api/users/me/password', {
    as: ID.protectedA,
    body: { currentPassword: 'wrong', newPassword: 'my-new-password', confirmPassword: 'my-new-password' },
  })

  assert.equal(status, 401)
  assert.equal(await passwordMatches(ID.protectedA, PASSWORD.protectedA), true)
})

// ── F / G. Own profile ───────────────────────────────────────────────────
test('F. a protected owner cannot change their own email', async () => {
  const { status, body } = await call('PUT', '/api/users/me/profile', {
    as: ID.protectedA,
    body: { name: 'Protected A', email: 'attacker@elsewhere.test' },
  })

  assert.equal(status, 403)
  assert.match(body.message, /protected/i)
  assert.equal(byId(ID.protectedA).email, 'a@protected.test')
})

test('F. an email-only request is refused too, and nothing else is applied alongside it', async () => {
  const emailOnly = await call('PUT', '/api/users/me/profile', { as: ID.protectedA, body: { email: 'x@elsewhere.test' } })
  assert.equal(emailOnly.status, 403)

  const withName = await call('PUT', '/api/users/me/profile', {
    as: ID.protectedA,
    body: { name: 'Renamed', email: 'x@elsewhere.test' },
  })
  assert.equal(withName.status, 403)
  assert.equal(byId(ID.protectedA).name, 'Protected A', 'a refused request changes nothing')
  assert.equal(byId(ID.protectedA).email, 'a@protected.test')
})

test('G. a protected owner can change their name while sending the same email', async () => {
  const { status, body } = await call('PUT', '/api/users/me/profile', {
    as: ID.protectedA,
    body: { name: 'New Display Name', email: '  A@Protected.Test ' },
  })

  assert.equal(status, 200)
  assert.equal(body.user.name, 'New Display Name')
  assert.equal(body.user.email, 'a@protected.test')
  assert.equal(body.user.isProtected, true)
})

test('G. a name-only request works as well', async () => {
  const { status, body } = await call('PUT', '/api/users/me/profile', { as: ID.protectedB, body: { name: 'Just A Name' } })

  assert.equal(status, 200)
  assert.equal(body.user.name, 'Just A Name')
  assert.equal(byId(ID.protectedB).email, 'b@protected.test')
})

test('G. ordinary accounts can still change their email', async () => {
  const owner = await call('PUT', '/api/users/me/profile', { as: ID.plainOwner, body: { name: 'Plain Owner', email: 'new@plain.test' } })
  assert.equal(owner.status, 200)
  assert.equal(byId(ID.plainOwner).email, 'new@plain.test')
  assert.equal(owner.body.user.isProtected, false)

  const user = await call('PUT', '/api/users/me/profile', { as: ID.plainUser, body: { name: 'Buyer', email: 'new@user.test' } })
  assert.equal(user.status, 200)
})

// ── H / I / J. What the API reports ──────────────────────────────────────
test('H/I. GET /api/users marks exactly the two configured accounts as protected', async () => {
  const { status, body } = await call('GET', '/api/users', { as: ID.plainOwner })

  assert.equal(status, 200)
  assert.equal(body.users.length, 6)

  for (const user of body.users) {
    assert.equal(typeof user.isProtected, 'boolean', `${user.name} carries a boolean`)
    assert.equal(user.isProtected, [ID.protectedA, ID.protectedB].includes(user._id), user.name)
  }

  const plainOwner = body.users.find((u) => u._id === ID.plainOwner)
  assert.equal(plainOwner.role, 'owner')
  assert.equal(plainOwner.isProtected, false, 'an ordinary owner is not protected')
})

test('J. the user list exposes the boolean and nothing about the configuration', async () => {
  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${tokenFor(ID.plainOwner)}` },
  })
  const raw = await response.text()
  const body = JSON.parse(raw)

  assert.deepEqual(Object.keys(body).sort(), ['count', 'success', 'users'])
  assert.ok(!raw.includes('PROTECTED_OWNER'), 'no configuration key name')
  assert.ok(!raw.includes(PROTECTED_CONFIG), 'no raw configuration value')
  assert.ok(!/protectedOwnerIds|protectedIds/i.test(raw), 'no id list under another name')

  for (const user of body.users) {
    assert.ok(!('password' in user))
    assert.ok(!('resetPasswordToken' in user))
    // A protected id appears only as that user's own _id — which the list
    // already returned for every account before this feature existed.
    const others = [ID.protectedA, ID.protectedB].filter((id) => id !== user._id)
    for (const id of others) assert.ok(!JSON.stringify(user).includes(id))
  }
})

test('J. with no configuration every account reports isProtected: false', async () => {
  delete process.env.PROTECTED_OWNER_IDS

  const { body } = await call('GET', '/api/users', { as: ID.plainOwner })
  assert.ok(body.users.every((user) => user.isProtected === false))
})

test('J. /auth/me reports isProtected for the signed-in account without leaking secrets', async () => {
  const mine = await call('GET', '/api/auth/me', { as: ID.protectedA })
  assert.equal(mine.status, 200)
  assert.equal(mine.body.user.isProtected, true)
  assert.equal(mine.body.user.email, 'a@protected.test')
  assert.ok(!('password' in mine.body.user))
  assert.ok(!JSON.stringify(mine.body).includes(ID.protectedB), 'the other protected id is not revealed')

  const ordinary = await call('GET', '/api/auth/me', { as: ID.plainOwner })
  assert.equal(ordinary.body.user.isProtected, false)

  const user = await call('GET', '/api/auth/me', { as: ID.plainUser })
  assert.equal(user.body.user.isProtected, false)
})

test('J. the login response carries the same boolean', async () => {
  const protectedLogin = await call('POST', '/api/auth/login', {
    body: { email: 'a@protected.test', password: PASSWORD.protectedA },
  })
  assert.equal(protectedLogin.status, 200)
  assert.equal(protectedLogin.body.user.isProtected, true)
  assert.ok(!('password' in protectedLogin.body.user))

  const ordinaryLogin = await call('POST', '/api/auth/login', {
    body: { email: 'owner@plain.test', password: PASSWORD.plainOwner },
  })
  assert.equal(ordinaryLogin.status, 200)
  assert.equal(ordinaryLogin.body.user.isProtected, false)
})

// ── Microsoft email-match sign-in ────────────────────────────────────────
test('Microsoft sign-in cannot be used to sign in as a protected owner', async () => {
  const { status, body } = await call('POST', '/api/auth/microsoft', {
    body: { idToken: microsoftIdToken('a@protected.test') },
  })

  assert.equal(status, 403)
  assert.equal(body.success, false)
  assert.ok(!('token' in body), 'no session is issued')
  assert.ok(!('user' in body))
})

test('Microsoft sign-in is unchanged for ordinary existing accounts', async () => {
  const { status, body } = await call('POST', '/api/auth/microsoft', {
    body: { idToken: microsoftIdToken('buyer@user.test') },
  })

  assert.equal(status, 200)
  assert.equal(body.user._id, ID.plainUser)
  assert.equal(body.user.isProtected, false)
  assert.ok(body.token)
})

test('Microsoft sign-in still creates a new ordinary account for an unknown address', async () => {
  const { status, body } = await call('POST', '/api/auth/microsoft', {
    body: { idToken: microsoftIdToken('brand-new@person.test') },
  })

  assert.equal(status, 200)
  assert.equal(body.user.role, 'user')
  assert.equal(body.user.isProtected, false)
})

test('a forged Microsoft token is still rejected before any account is looked up', async () => {
  const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const forged = jwt.sign(
    { tid: MICROSOFT_TENANT, preferred_username: 'buyer@user.test' },
    stranger.privateKey,
    {
      algorithm: 'RS256',
      audience: MICROSOFT_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/v2.0`,
      keyid: 'test-key',
    }
  )

  const { status, body } = await call('POST', '/api/auth/microsoft', { body: { idToken: forged } })
  assert.equal(status, 401)
  assert.ok(!('token' in body))
})
