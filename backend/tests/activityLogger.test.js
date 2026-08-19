import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const createdLogs = []

mock.module('../models/ActivityLog.js', {
  defaultExport: {
    create: async (entry) => {
      createdLogs.push(entry)
      return entry
    },
  },
})

const { default: activityLogger } = await import('../middleware/activityLogger.js')

const admin = { _id: 'admin-id', name: 'Admin User', email: 'admin@example.com', role: 'admin' }
const owner = { _id: 'owner-id', name: 'Owner User', email: 'owner@example.com', role: 'owner' }

beforeEach(() => {
  createdLogs.length = 0
})

const finishRequest = async ({
  method = 'POST',
  path = '/api/properties',
  statusCode = 200,
  user = admin,
  body = undefined,
  headers = undefined,
} = {}) => {
  let finishListener
  let nextCalled = false
  const req = { method, path, user, body, headers }
  const res = {
    statusCode,
    on(event, listener) {
      if (event === 'finish') finishListener = listener
    },
  }

  activityLogger(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true, 'middleware must continue immediately')
  assert.equal(typeof finishListener, 'function', 'finish listener must be registered')
  finishListener()
  await Promise.resolve()
}

test('GET requests are not logged', async () => {
  await finishRequest({ method: 'GET' })
  assert.equal(createdLogs.length, 0)
})

test('failed requests with status >= 400 are not logged', async () => {
  await finishRequest({ statusCode: 400 })
  assert.equal(createdLogs.length, 0)
})

test('normal users are not logged', async () => {
  await finishRequest({ user: { ...admin, role: 'user' } })
  assert.equal(createdLogs.length, 0)
})

test('agents are not logged', async () => {
  await finishRequest({ user: { ...admin, role: 'agent' } })
  assert.equal(createdLogs.length, 0)
})

test('a successful admin mutation is logged', async () => {
  await finishRequest()
  assert.equal(createdLogs.length, 1)
  assert.equal(createdLogs[0].actorRole, 'admin')
  assert.equal(createdLogs[0].action, 'created')
})

test('a successful owner mutation is logged', async () => {
  await finishRequest({ method: 'DELETE', path: '/api/partners/0123456789abcdef01234567', user: owner })
  assert.equal(createdLogs.length, 1)
  assert.equal(createdLogs[0].actorRole, 'owner')
  assert.equal(createdLogs[0].action, 'deleted')
})

test('/api/auth is skipped', async () => {
  await finishRequest({ path: '/api/auth/google' })
  assert.equal(createdLogs.length, 0)
})

test('/api/chat is skipped', async () => {
  await finishRequest({ path: '/api/chat' })
  assert.equal(createdLogs.length, 0)
})

test('/api/upload is skipped', async () => {
  await finishRequest({ path: '/api/upload' })
  assert.equal(createdLogs.length, 0)
})

test('/api/property-conversations is skipped', async () => {
  await finishRequest({ path: '/api/property-conversations/0123456789abcdef01234567/messages' })
  assert.equal(createdLogs.length, 0)
})

test('/api/notifications is skipped', async () => {
  await finishRequest({ method: 'PATCH', path: '/api/notifications/seen' })
  assert.equal(createdLogs.length, 0)
})

test('/api/property-alerts is skipped', async () => {
  await finishRequest({ method: 'PATCH', path: '/api/property-alerts/0123456789abcdef01234567' })
  assert.equal(createdLogs.length, 0)
})

test('/api/agent is skipped', async () => {
  await finishRequest({ path: '/api/agent/profile' })
  assert.equal(createdLogs.length, 0)
})

test('request.body is never persisted', async () => {
  await finishRequest({ body: { harmless: 'field', secret: 'body-secret' } })
  assert.equal(createdLogs.length, 1)
  assert.equal(JSON.stringify(createdLogs[0]).includes('body-secret'), false)
  assert.equal(Object.hasOwn(createdLogs[0], 'body'), false)
})

test('Authorization headers and tokens are never persisted', async () => {
  await finishRequest({ headers: { authorization: 'Bearer private-jwt-token' } })
  assert.equal(createdLogs.length, 1)
  assert.equal(JSON.stringify(createdLogs[0]).includes('private-jwt-token'), false)
  assert.equal(Object.hasOwn(createdLogs[0], 'headers'), false)
})

test('password fields are never persisted', async () => {
  await finishRequest({ method: 'PUT', path: '/api/users/0123456789abcdef01234567/password', body: { newPassword: 'never-store-this-password' } })
  assert.equal(createdLogs.length, 1)
  assert.equal(JSON.stringify(createdLogs[0]).includes('never-store-this-password'), false)
  assert.equal(Object.hasOwn(createdLogs[0], 'password'), false)
})

test('message text is never persisted', async () => {
  await finishRequest({ body: { message: 'private customer message text' } })
  assert.equal(createdLogs.length, 1)
  assert.equal(JSON.stringify(createdLogs[0]).includes('private customer message text'), false)
  assert.equal(Object.hasOwn(createdLogs[0], 'message'), false)
})
