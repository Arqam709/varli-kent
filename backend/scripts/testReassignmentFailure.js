// The failure this whole fix exists for.
//
// Simulates the property route's tolerated error path end to end:
//
//   1. Admin reassigns a listing from Agent A to Agent B
//   2. The Property write SUCCEEDS
//   3. handlePropertyAgentReassignment() THROWS
//   4. Property.agent = B, but PropertyConversation.agent = A
//
// and then asserts that Agent A is refused by every messaging surface anyway.
//
// The point is that authorization must not depend on step 3 having worked.
// Testing only the happy reassignment path would have proved nothing about
// this, because on the happy path the pointer is correct and any
// implementation looks safe.
//
// No database connection, no document written — the real property route
// handler and the real messaging handlers run against stubbed models.
// Run with:  node scripts/testReassignmentFailure.js

import mongoose from 'mongoose'
import Property from '../models/Property.js'
import User from '../models/User.js'
import PropertyConversation from '../models/PropertyConversation.js'
import PropertyMessage from '../models/PropertyMessage.js'
import propertyRouter from '../routes/properties.js'
import conversationRouter from '../routes/propertyConversations.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
}

const oid = () => new mongoose.Types.ObjectId()

const handlerFor = (router, method, path) => {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method])
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

const makeRes = () => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}

const call = async (handler, req) => {
  const res = makeRes()
  let thrown = null
  await handler(req, res, (err) => { thrown = err })
  if (thrown) throw thrown
  return res
}

const query = (value) => {
  const chain = {
    populate: () => chain,
    select: () => chain,
    sort: () => chain,
    limit: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  }
  return chain
}

/* ── Cast ─────────────────────────────────────────────────────────────── */

const propertyId = oid()
const conversationId = oid()
const customerId = oid()
const agentAId = oid()
const agentBId = oid()

const customer = { _id: customerId, role: 'user' }
const agentA = { _id: agentAId, role: 'agent' }
const agentB = { _id: agentBId, role: 'agent' }
const admin = { _id: oid(), role: 'admin', permissions: ['edit_listing'] }

/* ── Stub the world ───────────────────────────────────────────────────── */

const originals = {
  propFindById: Property.findById,
  propFind: Property.find,
  propFindByIdAndUpdate: Property.findByIdAndUpdate,
  userFindById: User.findById,
  convFindById: PropertyConversation.findById,
  convUpdateMany: PropertyConversation.updateMany,
  convUpdateOne: PropertyConversation.updateOne,
  convAggregate: PropertyConversation.aggregate,
  convFind: PropertyConversation.find,
  msgFind: PropertyMessage.find,
  msgCreate: PropertyMessage.create,
}

// THE WORLD: what the database currently holds.
const world = {
  propertyAgent: agentAId,        // Property.agent
  conversationAgent: agentAId,    // PropertyConversation.agent  (may go stale)
}

// Both awaited directly (the property route) and via .select() (the messaging
// service), so this must be a thenable that also chains — which is what
// query() provides. Each call re-reads `world`, so the stub tracks the
// simulated database as it changes.
Property.findById = () => query({ _id: propertyId, agent: world.propertyAgent })

// Property.find({ agent }) answers "which listings does this agent hold?" from
// Property.agent — the authorization authority.
Property.find = (filter) => ({
  select: async () =>
    String(world.propertyAgent) === String(filter?.agent) ? [{ _id: propertyId }] : [],
})

User.findById = () => query({ _id: world.propertyAgent, role: 'agent', isActive: true })

// A FRESH mutable object per call, snapshotting the pointer at request time.
// Not a getter: reconcileConversationAgent() assigns to `.agent`, which a
// getter-only property would reject.
PropertyConversation.findById = () => query({
  _id: conversationId,
  property: propertyId,
  customer: customerId,
  agent: world.conversationAgent,
  status: 'open',
  customerUnreadCount: 0,
  agentUnreadCount: 0,
})

PropertyConversation.updateOne = async () => ({ modifiedCount: 1 })
PropertyMessage.find = () => query([])
PropertyMessage.create = async (doc) => ({ _id: oid(), ...doc, createdAt: new Date() })

/* ── Step 1-3: the admin reassigns, and the messaging write fails ─────── */

console.log('\n== the property route survives a messaging failure ==')

Property.findByIdAndUpdate = async () => ({ _id: propertyId, agent: agentBId })

let syncAttempted = false
PropertyConversation.updateMany = async () => {
  syncAttempted = true
  throw new Error('simulated: replica set stepped down mid-write')
}

// Silence the expected error log while still proving it was emitted.
const realConsoleError = console.error
let loggedArgs = null
console.error = (...args) => { loggedArgs = args }

const putHandler = handlerFor(propertyRouter, 'put', '/:id')
const putResult = await call(putHandler, {
  user: admin,
  params: { id: String(propertyId) },
  body: { agent: String(agentBId) },
})

console.error = realConsoleError

check('reassignment was attempted', syncAttempted, true)
// The listing edit is already saved and correct; failing it would be worse.
check('property edit still succeeds', putResult.statusCode, 200)
check('property now reports the new agent', String(putResult.body.property.agent), String(agentBId))

console.log('\n== the failure is logged, without leaking content ==')
check('an error was logged', Boolean(loggedArgs), true)
const logContext = loggedArgs?.[1] || {}
check('logs the property id', String(logContext.propertyId), String(propertyId))
check('logs the outgoing agent', String(logContext.previousAgentId), String(agentAId))
check('logs the incoming agent', String(logContext.nextAgentId), String(agentBId))
check('logs the error message', typeof logContext.error, 'string')
// Ids and an error string only — never message text or conversation content.
check('no message text logged', JSON.stringify(logContext).toLowerCase().includes('text'), false)

/* ── Step 4: the inconsistent state now exists ────────────────────────── */

world.propertyAgent = agentBId       // property moved
world.conversationAgent = agentAId   // pointer did NOT

console.log('\n== INCONSISTENT STATE established ==')
check('Property.agent = B', String(world.propertyAgent), String(agentBId))
check('PropertyConversation.agent = A (stale)', String(world.conversationAgent), String(agentAId))

/* ── The actual security assertions ───────────────────────────────────── */

const detail = handlerFor(conversationRouter, 'get', '/:id')
const messages = handlerFor(conversationRouter, 'get', '/:id/messages')
const sendMsg = handlerFor(conversationRouter, 'post', '/:id/messages')
const markRead = handlerFor(conversationRouter, 'patch', '/:id/read')
const inbox = handlerFor(conversationRouter, 'get', '/')
const unread = handlerFor(conversationRouter, 'get', '/unread-count')

const asUser = (user, extra = {}) => ({
  user,
  params: { id: String(conversationId) },
  query: {},
  body: {},
  ...extra,
})

console.log('\n== the OUTGOING agent is locked out of every surface ==')
check('detail → 404', (await call(detail, asUser(agentA))).statusCode, 404)
check('messages → 404', (await call(messages, asUser(agentA))).statusCode, 404)
check('send → 404', (await call(sendMsg, asUser(agentA, { body: { text: 'are you there?' } }))).statusCode, 404)
check('mark read → 404', (await call(markRead, asUser(agentA))).statusCode, 404)

let inboxFilter = null
PropertyConversation.find = (filter) => { inboxFilter = filter; return query([]) }
const inboxResult = await call(inbox, asUser(agentA))
check('inbox returns nothing', inboxResult.body.count, 0)
// A no longer holds the listing, so the ownership intersection is empty.
check('inbox scope excludes the listing', inboxFilter.property.$in.length, 0)

let unreadMatch = null
PropertyConversation.aggregate = async (pipeline) => { unreadMatch = pipeline[0].$match; return [] }
const unreadResult = await call(unread, asUser(agentA))
check('unread badge reads 0', unreadResult.body.count, 0)
check('unread scope excludes the listing', unreadMatch.property.$in.length, 0)

console.log('\n== the customer is unaffected by the inconsistency ==')
check('customer can open the thread', (await call(detail, asUser(customer))).statusCode, 200)
check('customer can read history', (await call(messages, asUser(customer))).statusCode, 200)

console.log('\n== customer send self-heals the pointer ==')
let reconciledTo = null
PropertyConversation.updateOne = async (filter, update) => {
  if (update.$set?.agent) reconciledTo = String(update.$set.agent)
  return { modifiedCount: 1 }
}
const healed = await call(sendMsg, asUser(customer, { body: { text: 'Any update?' } }))
check('send succeeds', healed.statusCode, 201)
check('pointer repaired towards the property', reconciledTo, String(agentBId))

// Reflect the repair the route just performed.
world.conversationAgent = agentBId

console.log('\n== after reconciliation the roles are exactly right ==')
check('incoming agent B: detail → 200', (await call(detail, asUser(agentB))).statusCode, 200)
check('incoming agent B: can send', (await call(sendMsg, asUser(agentB, { body: { text: 'On it.' } }))).statusCode, 201)
check('outgoing agent A: still 404', (await call(detail, asUser(agentA))).statusCode, 404)
check('outgoing agent A: still cannot send', (await call(sendMsg, asUser(agentA, { body: { text: 'hi' } }))).statusCode, 404)

const bInbox = await call(inbox, asUser(agentB))
check('B inbox scope includes the listing', inboxFilter.property.$in.length, 1)
check('B inbox query ran', bInbox.statusCode, 200)

/* ── Restore ──────────────────────────────────────────────────────────── */

Property.findById = originals.propFindById
Property.find = originals.propFind
Property.findByIdAndUpdate = originals.propFindByIdAndUpdate
User.findById = originals.userFindById
PropertyConversation.findById = originals.convFindById
PropertyConversation.updateMany = originals.convUpdateMany
PropertyConversation.updateOne = originals.convUpdateOne
PropertyConversation.aggregate = originals.convAggregate
PropertyConversation.find = originals.convFind
PropertyMessage.find = originals.msgFind
PropertyMessage.create = originals.msgCreate

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
