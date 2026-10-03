// GET /api/activity — who may see which entries.
//
// The route stays owner-only. Within that, owner-removal activity that is
// still IN PROGRESS (requested, wrong code, locked, failed send) is shown to
// protected owners alone; a COMPLETED removal and every unrelated entry stay
// visible to all owners.
//
// The REAL activity router, auth middleware and protected-owner config run
// here, and the action strings are imported from the service that writes
// them — nothing below retypes a label. Only MongoDB is faked.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'

const TEST_JWT_SECRET = 'test-only-secret-not-a-real-key-abcdefghijklmnop'
process.env.JWT_SECRET = TEST_JWT_SECRET

const ID = {
  protectedA: '6a00000000000000000000a1',
  protectedB: '6a00000000000000000000b2',
  ownerX: '6a00000000000000000000c3',
  ownerY: '6a00000000000000000000d4',
  admin: '6a00000000000000000000e5',
  agent: '6a00000000000000000000f6',
  user: '6a0000000000000000000a07',
}

const PROTECTED_CONFIG = `${ID.protectedA},${ID.protectedB}`
process.env.PROTECTED_OWNER_IDS = PROTECTED_CONFIG

// ── Fake collections ─────────────────────────────────────────────────────
let users = []
let logs = []
/** Every filter the route handed to ActivityLog.find(), for inspection. */
let filtersSeen = []

const userQuery = (resolve) => {
  const chain = {
    select() { return chain },
    then: (onFulfilled, onRejected) => Promise.resolve().then(resolve).then(onFulfilled, onRejected),
  }
  return chain
}

const FakeUser = {
  findById: (id) => userQuery(() => users.find((doc) => doc._id === String(id)) || null),
}

const logMatches = (log, filter = {}) =>
  Object.entries(filter).every(([field, condition]) => {
    if (condition && typeof condition === 'object') {
      const unsupported = Object.keys(condition).filter((op) => op !== '$nin')
      if (unsupported.length) throw new Error(`fake ActivityLog: unsupported operator ${unsupported[0]}`)
      return !condition.$nin.includes(log[field])
    }
    return log[field] === condition
  })

// Applies filter, then sort, then limit — the order MongoDB applies them in,
// which is what makes "filter in the query" differ from "filter the result".
const FakeActivityLog = {
  find: (filter) => {
    filtersSeen.push(filter)
    let sort = null
    let limit = null
    const chain = {
      sort(s) { sort = s; return chain },
      limit(n) { limit = n; return chain },
      then: (onFulfilled, onRejected) =>
        Promise.resolve()
          .then(() => {
            let result = logs.filter((log) => logMatches(log, filter))
            if (sort) {
              const [[field, direction]] = Object.entries(sort)
              result = [...result].sort((a, b) => (a[field] - b[field]) * direction)
            }
            return limit === null ? result : result.slice(0, limit)
          })
          .then(onFulfilled, onRejected),
    }
    return chain
  },
}

mock.module('../models/User.js', { defaultExport: FakeUser })
mock.module('../models/ActivityLog.js', { defaultExport: FakeActivityLog })

let server
let baseUrl
let ACTIVITY
let IN_PROGRESS

before(async () => {
  ;({
    OWNER_REMOVAL_ACTIVITY: ACTIVITY,
    OWNER_REMOVAL_IN_PROGRESS_ACTIONS: IN_PROGRESS,
  } = await import('../services/ownerRemoval.js'))
  const { default: activityRoutes } = await import('../routes/activity.js')

  const app = express()
  app.use(express.json())
  app.use('/api/activity', activityRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

let clock = 0

const addLog = (action, extra = {}) => {
  clock += 1
  const log = {
    _id: `log-${clock}`,
    actorId: ID.ownerX,
    actorName: 'Owner X',
    actorEmail: 'x@owner.test',
    actorRole: 'owner',
    method: 'POST',
    path: `/api/users/${ID.ownerY}/request-owner-removal`,
    resource: 'users',
    action,
    statusCode: 200,
    createdAt: clock,
    ...extra,
  }
  logs.push(log)
  return log
}

const UNRELATED = ['created', 'updated', 'deleted', 'changed the role of', 'updated permissions for', 'changed the password for']

beforeEach(() => {
  process.env.PROTECTED_OWNER_IDS = PROTECTED_CONFIG
  filtersSeen = []
  clock = 0
  logs = []

  users = [
    { _id: ID.protectedA, name: 'Protected A', email: 'a@protected.test', role: 'owner', isActive: true, permissions: [] },
    { _id: ID.protectedB, name: 'Protected B', email: 'b@protected.test', role: 'owner', isActive: true, permissions: [] },
    { _id: ID.ownerX, name: 'Owner X', email: 'x@owner.test', role: 'owner', isActive: true, permissions: [] },
    { _id: ID.ownerY, name: 'Owner Y', email: 'y@owner.test', role: 'owner', isActive: true, permissions: [] },
    { _id: ID.admin, name: 'Admin', email: 'admin@staff.test', role: 'admin', isActive: true, permissions: ['user_management', 'manage_passwords'] },
    { _id: ID.agent, name: 'Agent', email: 'agent@staff.test', role: 'agent', isActive: true, permissions: [] },
    { _id: ID.user, name: 'Buyer', email: 'buyer@user.test', role: 'user', isActive: true, permissions: [] },
  ]

  // One of every owner-removal action, in the order a real removal produces
  // them, surrounded by ordinary activity.
  addLog('created', { resource: 'properties', path: '/api/properties' })
  addLog(ACTIVITY.deliveryFailed, { statusCode: 502, targetId: ID.ownerY, targetName: 'Owner Y' })
  addLog(ACTIVITY.requested, { targetId: ID.ownerY, targetName: 'Owner Y' })
  addLog(ACTIVITY.incorrectCode, { statusCode: 401, actorId: ID.protectedA, targetId: ID.ownerY, targetName: 'Owner Y' })
  addLog(ACTIVITY.locked, { statusCode: 423, actorId: ID.protectedA, targetId: ID.ownerY, targetName: 'Owner Y' })
  addLog('changed the role of', { method: 'PUT', path: `/api/users/${ID.user}/role` })
  addLog(ACTIVITY.completed, { actorId: ID.protectedB, targetId: ID.ownerY, targetName: 'Owner Y' })
  addLog('updated', { method: 'PUT', resource: 'settings', path: '/api/settings' })
})

const tokenFor = (id) => jwt.sign({ id }, TEST_JWT_SECRET, { expiresIn: '1h' })

const getActivity = async (as, query = '') => {
  const response = await fetch(`${baseUrl}/api/activity${query}`, {
    headers: as ? { authorization: `Bearer ${tokenFor(as)}` } : {},
  })
  return { status: response.status, body: await response.json() }
}

const actionsSeenBy = async (as, query) => (await getActivity(as, query)).body.logs.map((log) => log.action)

// ── The constants themselves ─────────────────────────────────────────────
test('the in-progress set is exactly the four non-completed owner-removal actions', () => {
  assert.deepEqual(
    [...IN_PROGRESS].sort(),
    [ACTIVITY.requested, ACTIVITY.incorrectCode, ACTIVITY.locked, ACTIVITY.deliveryFailed].sort()
  )
  assert.ok(!IN_PROGRESS.includes(ACTIVITY.completed), 'a completed removal is not restricted')
  assert.equal(new Set(Object.values(ACTIVITY)).size, 5, 'five distinct labels')
})

// ── Protected owners see everything ──────────────────────────────────────
for (const [label, protectedId] of [['protected owner A', ID.protectedA], ['protected owner B', ID.protectedB]]) {
  test(`1. ${label} sees pending removal-request activity`, async () => {
    assert.ok((await actionsSeenBy(protectedId)).includes(ACTIVITY.requested))
  })

  test(`2. ${label} sees wrong-code activity`, async () => {
    assert.ok((await actionsSeenBy(protectedId)).includes(ACTIVITY.incorrectCode))
  })

  test(`3. ${label} sees locked activity`, async () => {
    assert.ok((await actionsSeenBy(protectedId)).includes(ACTIVITY.locked))
  })

  test(`4. ${label} sees delivery-failure activity`, async () => {
    assert.ok((await actionsSeenBy(protectedId)).includes(ACTIVITY.deliveryFailed))
  })

  test(`${label} receives the whole log, unfiltered and newest first`, async () => {
    const { status, body } = await getActivity(protectedId)

    assert.equal(status, 200)
    assert.equal(body.logs.length, logs.length)
    assert.deepEqual(body.logs.map((log) => log._id), [...logs].reverse().map((log) => log._id))
    assert.deepEqual(filtersSeen.at(-1), {}, 'no restriction is applied to the query')
  })
}

// ── Ordinary owners ──────────────────────────────────────────────────────
for (const [label, ownerId] of [['the requesting owner', ID.ownerX], ['the owner being removed', ID.ownerY]]) {
  test(`5. ${label} does not see any of the four in-progress owner-removal entries`, async () => {
    const seen = await actionsSeenBy(ownerId)

    for (const action of [ACTIVITY.requested, ACTIVITY.incorrectCode, ACTIVITY.locked, ACTIVITY.deliveryFailed]) {
      assert.ok(!seen.includes(action), `"${action}" is hidden`)
    }
  })

  test(`6. ${label} still sees completed owner-removal activity`, async () => {
    const { body } = await getActivity(ownerId)
    const completed = body.logs.filter((log) => log.action === ACTIVITY.completed)

    assert.equal(completed.length, 1)
    assert.equal(completed[0].targetName, 'Owner Y')
  })

  test(`7. ${label} still sees every unrelated entry`, async () => {
    const { status, body } = await getActivity(ownerId)

    assert.equal(status, 200)
    assert.deepEqual(
      body.logs.map((log) => log.action),
      ['updated', ACTIVITY.completed, 'changed the role of', 'created'],
      'everything except the four in-progress entries, newest first'
    )
  })
}

test('7. no unrelated action is ever caught by the restriction', async () => {
  logs = []
  for (const action of UNRELATED) addLog(action, { path: '/api/somewhere' })
  // Near-misses: similar wording that is NOT one of the restricted labels.
  addLog('requested removal of an owner')
  addLog('removed an owner')

  const ordinary = await actionsSeenBy(ID.ownerX)
  const protectedView = await actionsSeenBy(ID.protectedA)

  assert.equal(ordinary.length, logs.length)
  assert.deepEqual(ordinary, protectedView)
})

test('the restriction is applied in the query, so an ordinary owner still gets a full page', async () => {
  logs = []
  // Newest 10 entries are all in-progress removal activity; older ones are not.
  for (let n = 0; n < 6; n += 1) addLog('updated', { path: '/api/settings' })
  for (let n = 0; n < 10; n += 1) addLog(ACTIVITY.incorrectCode, { statusCode: 401 })

  const { body } = await getActivity(ID.ownerX, '?limit=5')

  assert.equal(body.logs.length, 5, 'five visible entries, not an empty page')
  assert.ok(body.logs.every((log) => log.action === 'updated'))
  assert.deepEqual(filtersSeen.at(-1), { action: { $nin: [...IN_PROGRESS] } })

  // The protected owner asking for the same page sees the hidden entries.
  const protectedPage = await getActivity(ID.protectedA, '?limit=5')
  assert.ok(protectedPage.body.logs.every((log) => log.action === ACTIVITY.incorrectCode))
})

test('visibility follows the configured id, not the role or the email', async () => {
  // An ordinary owner carrying a protected owner's address sees nothing more.
  users.find((u) => u._id === ID.ownerX).email = 'a@protected.test'
  assert.ok(!(await actionsSeenBy(ID.ownerX)).includes(ACTIVITY.requested))

  // Remove B from the configuration and B is treated like any other owner.
  process.env.PROTECTED_OWNER_IDS = ID.protectedA
  assert.ok(!(await actionsSeenBy(ID.protectedB)).includes(ACTIVITY.requested))
  assert.ok((await actionsSeenBy(ID.protectedA)).includes(ACTIVITY.requested))
})

test('with no protected owners configured the in-progress entries are hidden from everyone', async () => {
  delete process.env.PROTECTED_OWNER_IDS

  for (const ownerId of [ID.protectedA, ID.protectedB, ID.ownerX]) {
    const seen = await actionsSeenBy(ownerId)
    for (const action of IN_PROGRESS) assert.ok(!seen.includes(action))
    assert.ok(seen.includes(ACTIVITY.completed))
    assert.ok(seen.includes('created'))
  }
})

// ── Access to the route itself ───────────────────────────────────────────
test('8. the route is still owner-only: admins, agents and users are refused', async () => {
  for (const [label, id] of [['admin', ID.admin], ['agent', ID.agent], ['user', ID.user]]) {
    const { status, body } = await getActivity(id)
    assert.equal(status, 403, label)
    assert.ok(!('logs' in body), `${label} receives no entries`)
  }
})

test('8. an unauthenticated request is refused', async () => {
  const { status, body } = await getActivity(null)
  assert.equal(status, 401)
  assert.ok(!('logs' in body))

  const bad = await fetch(`${baseUrl}/api/activity`, { headers: { authorization: 'Bearer not-a-token' } })
  assert.equal(bad.status, 401)
})

test('8. a deactivated owner is refused, protected or not', async () => {
  users.find((u) => u._id === ID.ownerX).isActive = false
  users.find((u) => u._id === ID.protectedA).isActive = false

  assert.equal((await getActivity(ID.ownerX)).status, 401)
  assert.equal((await getActivity(ID.protectedA)).status, 401)
})

test('8. the response shape and the limit handling are unchanged', async () => {
  const { body } = await getActivity(ID.ownerX)
  assert.deepEqual(Object.keys(body).sort(), ['logs', 'success'])
  assert.equal(body.success, true)

  logs = []
  for (let n = 0; n < 350; n += 1) addLog('updated', { path: '/api/settings' })

  assert.equal((await getActivity(ID.ownerX)).body.logs.length, 100, 'default limit')
  assert.equal((await getActivity(ID.ownerX, '?limit=150')).body.logs.length, 150)
  assert.equal((await getActivity(ID.ownerX, '?limit=9999')).body.logs.length, 300, 'capped at 300')
  assert.equal((await getActivity(ID.protectedA, '?limit=9999')).body.logs.length, 300)
})
