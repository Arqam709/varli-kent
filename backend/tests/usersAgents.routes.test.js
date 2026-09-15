// The agent selector on the admin property form, end to end on the server.
//
// GET /api/users/agents feeds the "Assigned Agent" dropdown. These tests pin
// who appears in it (active agents only), who may ask (owner, or an admin with
// property-management permission) and the exact response shape the frontend
// reads. The second half pins what a property save does with the chosen id:
// resolveAgentContact is what both POST and PUT /api/properties run.
//
// The REAL router, auth middleware and assignment service run here. Only
// MongoDB is faked.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'

const TEST_JWT_SECRET = 'test-only-secret-not-a-real-key-abcdefghijklmnop'
process.env.JWT_SECRET = TEST_JWT_SECRET

// Real-looking ObjectIds: parseAgentAssignment rejects anything else.
const ID = {
  owner: '6a0000000000000000000001',
  adminAdd: '6a0000000000000000000002',
  adminEdit: '6a0000000000000000000003',
  adminNoListing: '6a0000000000000000000004',
  alex: '6a0000000000000000000005',
  john: '6a0000000000000000000006',
  inactiveAgent: '6a0000000000000000000007',
  plainUser: '6a0000000000000000000008',
}

let docs = []

const seed = (fields) => {
  const doc = { isActive: true, permissions: [], ...fields }
  docs.push(doc)
  return doc
}

const matches = (doc, criteria) =>
  Object.entries(criteria).every(([field, value]) => doc[field] === value)

// Honours inclusion and exclusion projections, so a test can see exactly
// which fields the route asked MongoDB for.
const project = (doc, projection) => {
  if (!doc || !projection) return doc
  const fields = projection.split(' ').filter(Boolean)
  const excluded = fields.filter((f) => f.startsWith('-')).map((f) => f.slice(1))
  const included = fields.filter((f) => !f.startsWith('-'))

  if (included.length) {
    const out = { _id: doc._id }
    for (const field of included) if (field in doc) out[field] = doc[field]
    return out
  }

  const out = { ...doc }
  for (const field of excluded) delete out[field]
  return out
}

const query = (resolve) => {
  let projection = null
  let sort = null
  const chain = {
    select(p) { projection = p; return chain },
    sort(s) { sort = s; return chain },
    then: (onFulfilled, onRejected) =>
      Promise.resolve()
        .then(() => {
          const result = resolve()
          if (!Array.isArray(result)) return project(result, projection)
          const list = [...result]
          if (sort) {
            const [[field, direction]] = Object.entries(sort)
            list.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * direction)
          }
          return list.map((doc) => project(doc, projection))
        })
        .then(onFulfilled, onRejected),
  }
  return chain
}

const FakeUser = {
  find: (criteria) => query(() => docs.filter((doc) => matches(doc, criteria))),
  findById: (id) => query(() => docs.find((doc) => doc._id === String(id)) || null),
}

mock.module('../models/User.js', { defaultExport: FakeUser })

let server
let baseUrl
let resolveAgentContact

before(async () => {
  const { default: userRoutes } = await import('../routes/users.js')
  ;({ resolveAgentContact } = await import('../services/agentAssignment.js'))

  const app = express()
  app.use(express.json())
  app.use('/api/users', userRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

const tokenFor = (id) => jwt.sign({ id }, TEST_JWT_SECRET, { expiresIn: '1h' })

const getAgents = async (asId) => {
  const response = await fetch(`${baseUrl}/api/users/agents`, {
    headers: asId ? { authorization: `Bearer ${tokenFor(asId)}` } : {},
  })
  return { status: response.status, body: await response.json() }
}

test.beforeEach(() => {
  docs = []
  seed({ _id: ID.owner, name: 'Owner', email: 'owner@example.com', role: 'owner' })
  seed({ _id: ID.adminAdd, name: 'Admin Add', email: 'a1@example.com', role: 'admin', permissions: ['add_listing'] })
  seed({ _id: ID.adminEdit, name: 'Admin Edit', email: 'a2@example.com', role: 'admin', permissions: ['edit_listing'] })
  seed({ _id: ID.adminNoListing, name: 'Admin Other', email: 'a3@example.com', role: 'admin', permissions: ['user_management'] })
  // Seeded out of alphabetical order to prove the route sorts by name.
  seed({ _id: ID.john, name: 'john', email: 'john@example.com', role: 'agent', avatar: 'j.png', password: 'hash-j' })
  seed({ _id: ID.alex, name: 'alex', email: 'alex@example.com', role: 'agent', password: 'hash-a' })
  seed({ _id: ID.inactiveAgent, name: 'gone', email: 'gone@example.com', role: 'agent', isActive: false })
  seed({ _id: ID.plainUser, name: 'buyer', email: 'buyer@example.com', role: 'user' })
})

// ── GET /api/users/agents: who is listed ─────────────────────────────────
test('lists every active agent, sorted by name', async () => {
  const { status, body } = await getAgents(ID.owner)

  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(body.count, 2)
  assert.deepEqual(body.agents.map((a) => a.name), ['alex', 'john'])
})

test('never lists an account whose role is not agent', async () => {
  const { body } = await getAgents(ID.owner)
  const ids = body.agents.map((a) => a._id)

  for (const excluded of [ID.plainUser, ID.owner, ID.adminAdd, ID.adminEdit, ID.adminNoListing]) {
    assert.ok(!ids.includes(excluded), `${excluded} must not be offered as an agent`)
  }
})

test('never lists a deactivated agent', async () => {
  const { body } = await getAgents(ID.owner)
  assert.ok(!body.agents.some((a) => a._id === ID.inactiveAgent))
})

test('a newly promoted agent is listed on the very next request', async () => {
  docs.find((doc) => doc._id === ID.plainUser).role = 'agent'

  const { body } = await getAgents(ID.owner)
  assert.deepEqual(body.agents.map((a) => a.name), ['alex', 'buyer', 'john'])
})

test('response shape is exactly what the dropdown reads, and nothing more', async () => {
  const { body } = await getAgents(ID.owner)
  assert.ok(Array.isArray(body.agents), 'frontend reads r.data.agents')

  for (const agent of body.agents) {
    assert.deepEqual(Object.keys(agent).sort(), ['_id', 'avatar', 'email', 'name'])
  }

  const john = body.agents.find((a) => a._id === ID.john)
  assert.deepEqual(john, { _id: ID.john, name: 'john', email: 'john@example.com', avatar: 'j.png' })
  assert.ok(!JSON.stringify(body).includes('hash-'), 'no password material in the response')
})

// ── GET /api/users/agents: who may ask ───────────────────────────────────
test('owner may load the agent list', async () => {
  assert.equal((await getAgents(ID.owner)).status, 200)
})

test('admin with add_listing or edit_listing may load the agent list', async () => {
  assert.equal((await getAgents(ID.adminAdd)).status, 200)
  assert.equal((await getAgents(ID.adminEdit)).status, 200)
})

test('admin without property-management permission is refused', async () => {
  const { status, body } = await getAgents(ID.adminNoListing)
  assert.equal(status, 403)
  assert.equal(body.agents, undefined)
})

test('agents and ordinary users are refused', async () => {
  assert.equal((await getAgents(ID.alex)).status, 403)
  assert.equal((await getAgents(ID.plainUser)).status, 403)
})

test('unauthenticated, forged and deactivated callers are refused', async () => {
  assert.equal((await getAgents(null)).status, 401)

  const forged = await fetch(`${baseUrl}/api/users/agents`, {
    headers: { authorization: `Bearer ${jwt.sign({ id: ID.owner }, 'some-other-secret')}` },
  })
  assert.equal(forged.status, 401)

  docs.find((doc) => doc._id === ID.owner).isActive = false
  assert.equal((await getAgents(ID.owner)).status, 401)
})

// ── What a property save does with the selected id ──────────────────────
// POST /api/properties calls resolveAgentContact(body, null); PUT calls it with
// the stored property. The frontend sends `agent: form.agent || null`.

test('create: the selected agent id is stored on Property.agent', async () => {
  const result = await resolveAgentContact({ agent: ID.alex }, null)

  assert.equal(result.ok, true)
  assert.equal(result.changes.agent, ID.alex)
  assert.equal(result.changes.agentEmail, 'alex@example.com')
})

test('edit without changing the agent keeps the assignment', async () => {
  const existing = { agent: ID.alex, agentPhone: '+90 1', whatsappNumber: '+90 2' }
  const result = await resolveAgentContact(
    { agent: ID.alex, agentPhone: '+90 1', whatsappNumber: '+90 2' },
    existing
  )

  assert.equal(result.ok, true)
  assert.equal(result.changes.agent, ID.alex)
  assert.equal('agentPhone' in result.changes, false)
  assert.equal('whatsappNumber' in result.changes, false)
})

test('reassignment from agent A to agent B stores B and B\'s email', async () => {
  const result = await resolveAgentContact({ agent: ID.john }, { agent: ID.alex })

  assert.equal(result.ok, true)
  assert.equal(result.changes.agent, ID.john)
  assert.equal(result.changes.agentEmail, 'john@example.com')
  assert.equal(result.changes.agentPhone, '')
  assert.equal(result.changes.whatsappNumber, '')
})

test('clearing the assignment ("" or null) unassigns and clears agent contact', async () => {
  for (const cleared of ['', null]) {
    const result = await resolveAgentContact({ agent: cleared }, { agent: ID.alex })

    assert.equal(result.ok, true)
    assert.equal(result.changes.agent, null)
    assert.equal(result.changes.agentEmail, '')
    assert.equal(result.changes.agentPhone, '')
    assert.equal(result.changes.whatsappNumber, '')
  }
})

test('a save cannot assign a non-agent or a deactivated agent', async () => {
  assert.equal((await resolveAgentContact({ agent: ID.plainUser }, null)).ok, false)
  assert.equal((await resolveAgentContact({ agent: ID.inactiveAgent }, null)).ok, false)
})
