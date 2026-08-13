// Route-level tests for /api/property-conversations.
//
// The real Express handlers are pulled out of the router and invoked with fake
// req/res objects; the Mongoose models they call are stubbed. NO database
// connection is opened and NO document is written — every "record" below is a
// plain object living in this file.
//
// This covers the parts that are not pure logic: the start/reopen decision
// tree, which unread counter gets incremented, which side mark-read clears,
// the pagination cursor, and the 404-not-403 behaviour for non-participants.
// Run with:  node scripts/testPropertyConversationRoutes.js

import mongoose from 'mongoose'
import PropertyConversation from '../models/PropertyConversation.js'
import PropertyMessage, { MAX_MESSAGE_LENGTH } from '../models/PropertyMessage.js'
import Property from '../models/Property.js'
import User from '../models/User.js'
import router from '../routes/propertyConversations.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
}

/* ── Harness ──────────────────────────────────────────────────────────── */

/** Grabs the final handler registered for a method+path on the router. */
const handlerFor = (method, path) => {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  )
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

const makeRes = () => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}

/** Runs a handler and returns { statusCode, body }. Rethrows handler errors. */
const call = async (handler, req) => {
  const res = makeRes()
  let thrown = null
  await handler(req, res, (err) => { thrown = err })
  if (thrown) throw thrown
  return res
}

/** A stub that satisfies Mongoose's chainable query API and awaits to `value`. */
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

const oid = () => new mongoose.Types.ObjectId()

/* ── Cast ─────────────────────────────────────────────────────────────── */

const customerId = oid()
const agentAId = oid()
const agentBId = oid()
const propertyId = oid()
const conversationId = oid()

const customer = { _id: customerId, role: 'user' }
const agentA = { _id: agentAId, role: 'agent' }
const agentB = { _id: agentBId, role: 'agent' }
const stranger = { _id: oid(), role: 'user' }
const adminUser = { _id: oid(), role: 'admin' }

const openConversation = () => ({
  _id: conversationId,
  property: propertyId,
  customer: customerId,
  agent: agentAId,
  status: 'open',
  customerUnreadCount: 0,
  agentUnreadCount: 0,
})

/* ── Model stubs ──────────────────────────────────────────────────────── */

const real = {
  convFindById: PropertyConversation.findById,
  convFindOne: PropertyConversation.findOne,
  convCreate: PropertyConversation.create,
  convUpdateOne: PropertyConversation.updateOne,
  convAggregate: PropertyConversation.aggregate,
  convFind: PropertyConversation.find,
  msgFind: PropertyMessage.find,
  msgCreate: PropertyMessage.create,
  propFindById: Property.findById,
  userFindById: User.findById,
}

let captured = {}
const resetCaptured = () => { captured = {} }

const restoreAll = () => {
  PropertyConversation.findById = real.convFindById
  PropertyConversation.findOne = real.convFindOne
  PropertyConversation.create = real.convCreate
  PropertyConversation.updateOne = real.convUpdateOne
  PropertyConversation.aggregate = real.convAggregate
  PropertyConversation.find = real.convFind
  PropertyMessage.find = real.msgFind
  PropertyMessage.create = real.msgCreate
  Property.findById = real.propFindById
  User.findById = real.userFindById
}

PropertyConversation.updateOne = async (filter, update) => {
  captured.convUpdate = { filter, update }
  return { modifiedCount: 1 }
}

/* ══════════════════ START / REOPEN ══════════════════ */

const startHandler = handlerFor('post', '/')

const activeAgentAccount = { _id: agentAId, role: 'agent', isActive: true }

const stubStart = ({ property = { _id: propertyId, agent: agentAId }, agentAccount = activeAgentAccount, existing = null, createResult, createError } = {}) => {
  Property.findById = () => query(property)
  User.findById = () => query(agentAccount)
  PropertyConversation.findOne = async (filter) => { captured.findOne = filter; return existing }
  PropertyConversation.create = async (doc) => {
    captured.create = doc
    if (createError) throw createError
    return createResult || { _id: oid(), ...doc }
  }
}

console.log('\n== start conversation: input validation ==')
stubStart()
check('missing propertyId → 400', (await call(startHandler, { user: customer, body: {} })).statusCode, 400)
check('malformed propertyId → 400', (await call(startHandler, { user: customer, body: { propertyId: 'nope' } })).statusCode, 400)

stubStart({ property: null })
check('property not found → 404', (await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })).statusCode, 404)

console.log('\n== start conversation: the property decides the agent ==')
stubStart({ property: { _id: propertyId, agent: null } })
check('property has no agent → 409', (await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })).statusCode, 409)

stubStart({ agentAccount: { _id: agentAId, role: 'agent', isActive: false } })
check('assigned agent deactivated → 409', (await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })).statusCode, 409)

stubStart({ agentAccount: { _id: agentAId, role: 'user', isActive: true } })
check('assigned account demoted → 409', (await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })).statusCode, 409)

stubStart({ agentAccount: null })
check('assigned agent deleted → 409', (await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })).statusCode, 409)

console.log('\n== start conversation: who may start one ==')
stubStart()
// An agent viewing their own listing must not open a thread with themselves.
check('agent on their own listing → 400', (await call(startHandler, { user: agentA, body: { propertyId: String(propertyId) } })).statusCode, 400)
// Agents reply; customers initiate. An agent-initiated thread would be an
// outbound-marketing feature with its own consent questions.
check('a different agent starting → 403', (await call(startHandler, { user: agentB, body: { propertyId: String(propertyId) } })).statusCode, 403)

console.log('\n== start conversation: creation ==')
resetCaptured()
stubStart()
const created = await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })
check('created → 201', created.statusCode, 201)
check('reports created', created.body.created, true)
check('returns a conversation id', Boolean(created.body.conversationId), true)
check('customer is the authenticated user', String(captured.create.customer), String(customerId))
check('agent comes from the property', String(captured.create.agent), String(agentAId))
check('starts open', captured.create.status, 'open')

console.log('\n== start conversation: the client cannot choose participants ==')
resetCaptured()
stubStart()
await call(startHandler, {
  user: customer,
  body: { propertyId: String(propertyId), agent: String(agentBId), agentId: String(agentBId), customer: String(agentBId), customerId: String(agentBId), sender: String(agentBId) },
})
check('forged agentId ignored', String(captured.create.agent), String(agentAId))
check('forged customerId ignored', String(captured.create.customer), String(customerId))

console.log('\n== start conversation: one thread per customer per property ==')
resetCaptured()
const existingOpen = { ...openConversation(), save: async function () { captured.saved = this } }
stubStart({ existing: existingOpen })
const again = await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })
check('returns existing, not created', again.body.created, false)
check('same conversation id', String(again.body.conversationId), String(conversationId))
check('lookup keyed on customer+property', Object.keys(captured.findOne).sort().join(','), 'customer,property')
check('open thread not needlessly re-saved', captured.saved, undefined)

console.log('\n== start conversation: reopening a closed thread ==')
resetCaptured()
// Property was unassigned earlier: thread closed, agent detached.
const closedThread = {
  ...openConversation(),
  status: 'closed',
  agent: null,
  agentUnreadCount: 9,
  agentLastReadAt: new Date(),
  save: async function () { captured.saved = this },
}
stubStart({ existing: closedThread })
const reopened = await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })
check('no duplicate created', reopened.body.created, false)
check('same conversation id', String(reopened.body.conversationId), String(conversationId))
check('reopened', captured.saved.status, 'open')
check('assigned to the current property agent', String(captured.saved.agent), String(agentAId))
check('incoming agent unread reset', captured.saved.agentUnreadCount, 0)
check('incoming agent lastReadAt reset', captured.saved.agentLastReadAt, null)

console.log('\n== start conversation: simultaneous taps cannot duplicate ==')
resetCaptured()
const raceWinner = { ...openConversation() }
let findOneCalls = 0
Property.findById = () => query({ _id: propertyId, agent: agentAId })
User.findById = () => query(activeAgentAccount)
// First lookup misses (the other request has not committed yet), the insert
// loses the unique-index race, the retry finds the winner.
PropertyConversation.findOne = async () => (findOneCalls++ === 0 ? null : raceWinner)
PropertyConversation.create = async () => { const err = new Error('dup'); err.code = 11000; throw err }
const raced = await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })
check('duplicate key handled, not a 500', raced.statusCode, 200)
check('returns the winning conversation', String(raced.body.conversationId), String(conversationId))
check('reports not created', raced.body.created, false)

/* ══════════════════ PARTICIPANT ACCESS ══════════════════ */

const detailHandler = handlerFor('get', '/:id')

/**
 * Sentinel meaning "the Property document no longer exists".
 *
 * NOT `undefined` — passing undefined would trigger the default parameter
 * below and silently stub the consistent case instead.
 */
const PROPERTY_DELETED = Symbol('property-deleted')

/**
 * Stubs a conversation AND the property's current agent.
 *
 * Both matter now: agent-side authorization requires the conversation pointer,
 * the live role, AND current Property ownership. `currentAgentId` defaults to
 * the conversation's own agent (the consistent case); pass a different id,
 * null, or PROPERTY_DELETED to simulate a half-completed reassignment.
 */
const stubConversation = (conversation, currentAgentId = agentAId) => {
  PropertyConversation.findById = () => query(conversation)
  Property.findById = () => ({
    select: async () =>
      currentAgentId === PROPERTY_DELETED ? null : { _id: propertyId, agent: currentAgentId },
  })
}

/* ── REGRESSION: the reported "Conversation not found" bug ────────────────
 *
 * GET /:id is the ONLY route that populates, and populate turns
 * conversation.customer from an ObjectId into a full Mongoose document. The
 * original id comparison was String(a) === String(b), and String() of a
 * document is its inspect output — so a customer opening their own thread was
 * refused with 404 while messages/send/read (which do not populate) worked.
 *
 * The stub below returns REAL populated documents, which is what the route
 * actually receives. The generic `query()` helper's .populate() is a no-op
 * returning the same plain object, which is precisely why this slipped past
 * the original suite.
 */
console.log('\n== detail route with POPULATED refs (the shipped bug) ==')

const UserModel = (await import('../models/User.js')).default

const populatedConversation = {
  ...openConversation(),
  customer: new UserModel({ _id: customerId, name: 'Ahsan', role: 'user', isActive: true }),
  agent: new UserModel({ _id: agentAId, name: 'Ahmet', role: 'agent', isActive: true }),
}

stubConversation(populatedConversation, agentAId)
const populatedReq = (user) => ({ user, params: { id: String(conversationId) }, query: {}, body: {} })

check('customer opening their own thread → 200', (await call(detailHandler, populatedReq(customer))).statusCode, 200)
check('assigned agent → 200', (await call(detailHandler, populatedReq(agentA))).statusCode, 200)
// The unwrap must not soften any rule.
check('stranger → still 404', (await call(detailHandler, populatedReq(stranger))).statusCode, 404)
check('other agent → still 404', (await call(detailHandler, populatedReq(agentB))).statusCode, 404)
check('admin → still 404', (await call(detailHandler, populatedReq(adminUser))).statusCode, 404)

const populatedBody = (await call(detailHandler, populatedReq(customer))).body
check('response names the caller as customer', populatedBody.conversation.role, 'customer')
check('counterparty resolved to the agent', populatedBody.conversation.counterparty.name, 'Ahmet')
// The serializer whitelist must still hold on populated documents.
check('no email leaked from the populated doc', JSON.stringify(populatedBody).includes('@'), false)

console.log('\n== participant access: 404 for everyone else ==')
stubConversation(openConversation())
const req = (user, extra = {}) => ({ user, params: { id: String(conversationId) }, query: {}, body: {}, ...extra })

check('customer can read', (await call(detailHandler, req(customer))).statusCode, 200)
check('assigned agent can read', (await call(detailHandler, req(agentA))).statusCode, 200)
check('another customer → 404', (await call(detailHandler, req(stranger))).statusCode, 404)
check('another agent → 404', (await call(detailHandler, req(agentB))).statusCode, 404)
// Not 403: a 403 would confirm the conversation exists.
check('admin → 404 (no view_chats bypass)', (await call(detailHandler, req(adminUser))).statusCode, 404)
check('owner → 404', (await call(detailHandler, req({ _id: oid(), role: 'owner' }))).statusCode, 404)
check('demoted agent → 404', (await call(detailHandler, req({ _id: agentAId, role: 'user' }))).statusCode, 404)

stubConversation(null)
check('missing conversation → 404', (await call(detailHandler, req(customer))).statusCode, 404)
check('malformed id → 404 (indistinguishable)', (await call(detailHandler, { ...req(customer), params: { id: 'nope' } })).statusCode, 404)

/* ══════════════════ SEND MESSAGE ══════════════════ */

const sendHandler = handlerFor('post', '/:id/messages')

const stubSend = (conversation, agentAccount = activeAgentAccount, currentAgentId = agentAId) => {
  stubConversation(conversation, currentAgentId)
  User.findById = () => query(agentAccount)
  PropertyMessage.create = async (doc) => {
    captured.message = doc
    return { _id: oid(), ...doc, createdAt: new Date() }
  }
}

console.log('\n== send message: validation ==')
resetCaptured()
stubSend(openConversation())
const send = (user, body) => call(sendHandler, { user, params: { id: String(conversationId) }, body, query: {} })

check('empty text → 400', (await send(customer, { text: '' })).statusCode, 400)
check('whitespace-only → 400', (await send(customer, { text: '   ' })).statusCode, 400)
check('missing text → 400', (await send(customer, {})).statusCode, 400)
check('over max length → 400', (await send(customer, { text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).statusCode, 400)
check('exactly max length → 201', (await send(customer, { text: 'x'.repeat(MAX_MESSAGE_LENGTH) })).statusCode, 201)

console.log('\n== send message: sender is always the authenticated user ==')
resetCaptured()
stubSend(openConversation())
await send(customer, { text: '  Hello  ', sender: String(agentBId), senderId: String(agentBId) })
check('sender = req.user', String(captured.message.sender), String(customerId))
check('forged sender ignored', String(captured.message.sender) === String(agentBId), false)
check('text trimmed before storing', captured.message.text, 'Hello')
check('bound to the URL conversation', String(captured.message.conversation), String(conversationId))

console.log('\n== send message: unread goes to the RECIPIENT only ==')
resetCaptured()
stubSend(openConversation())
await send(customer, { text: 'Can I arrange a viewing?' })
check('customer sends → agent unread +1', captured.convUpdate.update.$inc.agentUnreadCount, 1)
check('customer sends → own unread untouched', 'customerUnreadCount' in captured.convUpdate.update.$inc, false)
// $inc rather than read-modify-write, so two simultaneous sends both count.
check('uses $inc, not a recomputed value', typeof captured.convUpdate.update.$inc.agentUnreadCount, 'number')
check('lastMessage preview stored', captured.convUpdate.update.$set.lastMessage.text, 'Can I arrange a viewing?')
check('lastMessage sender recorded', String(captured.convUpdate.update.$set.lastMessage.sender), String(customerId))
check('lastActivityAt bumped', captured.convUpdate.update.$set.lastActivityAt instanceof Date, true)

resetCaptured()
stubSend(openConversation())
await send(agentA, { text: 'Yes, Saturday works.' })
check('agent sends → customer unread +1', captured.convUpdate.update.$inc.customerUnreadCount, 1)
check('agent sends → own unread untouched', 'agentUnreadCount' in captured.convUpdate.update.$inc, false)

console.log('\n== send message: who may send, and when ==')
stubSend(openConversation())
check('non-participant → 404', (await send(stranger, { text: 'hi' })).statusCode, 404)
check('other agent → 404', (await send(agentB, { text: 'hi' })).statusCode, 404)
check('admin → 404', (await send(adminUser, { text: 'hi' })).statusCode, 404)

stubSend({ ...openConversation(), status: 'closed' })
check('closed conversation → 409', (await send(customer, { text: 'hi' })).statusCode, 409)

// Would otherwise increment an unread counter nobody can ever see.
stubSend(openConversation(), { _id: agentAId, role: 'agent', isActive: false })
check('agent deactivated → 409', (await send(customer, { text: 'hi' })).statusCode, 409)

stubSend(openConversation(), { _id: agentAId, role: 'user', isActive: true })
check('agent demoted → 409', (await send(customer, { text: 'hi' })).statusCode, 409)

stubSend({ ...openConversation(), agent: null }, null)
check('agent unassigned → 409', (await send(customer, { text: 'hi' })).statusCode, 409)

/* ══════════════════ MARK READ ══════════════════ */

const readHandler = handlerFor('patch', '/:id/read')

console.log('\n== mark read: the server picks the side ==')
resetCaptured()
stubConversation(openConversation())
const markRead = (user, body = {}) => call(readHandler, { user, params: { id: String(conversationId) }, body, query: {} })

await markRead(customer)
check('customer clears their own count', captured.convUpdate.update.$set.customerUnreadCount, 0)
check('customer sets their own timestamp', captured.convUpdate.update.$set.customerLastReadAt instanceof Date, true)
check('agent side untouched', 'agentUnreadCount' in captured.convUpdate.update.$set, false)

resetCaptured()
await markRead(agentA)
check('agent clears their own count', captured.convUpdate.update.$set.agentUnreadCount, 0)
check('agent sets their own timestamp', captured.convUpdate.update.$set.agentLastReadAt instanceof Date, true)
check('customer side untouched', 'customerUnreadCount' in captured.convUpdate.update.$set, false)

resetCaptured()
// The body is never consulted, so a client cannot clear the other person's badge.
await markRead(customer, { side: 'agent', participant: 'agent', agentUnreadCount: 0 })
check('body cannot choose the side', 'agentUnreadCount' in captured.convUpdate.update.$set, false)
check('still clears the caller side', captured.convUpdate.update.$set.customerUnreadCount, 0)

check('non-participant → 404', (await markRead(stranger)).statusCode, 404)

/* ══════════════════ MESSAGE PAGINATION ══════════════════ */

const messagesHandler = handlerFor('get', '/:id/messages')

const makeMessages = (n) =>
  Array.from({ length: n }, (_, i) => ({
    _id: oid(),
    conversation: conversationId,
    sender: i % 2 === 0 ? customerId : agentAId,
    text: `message ${i}`,
    createdAt: new Date(Date.now() - i * 1000),
  }))

const stubMessages = (rows) => {
  PropertyMessage.find = (filter) => {
    captured.msgFilter = filter
    const chain = {
      sort: (s) => { captured.msgSort = s; return chain },
      limit: (n) => { captured.msgLimit = n; return chain },
      then: (resolve, reject) => Promise.resolve(rows.slice(0, captured.msgLimit)).then(resolve, reject),
    }
    return chain
  }
}

console.log('\n== message pagination ==')
resetCaptured()
stubConversation(openConversation())
stubMessages(makeMessages(100))

const listMessages = (user, q = {}) =>
  call(messagesHandler, { user, params: { id: String(conversationId) }, query: q, body: {} })

const firstPage = await listMessages(customer)
check('default page size 30', firstPage.body.messages.length, 30)
check('fetches limit+1 to detect more', captured.msgLimit, 31)
check('newest-first from the database', captured.msgSort._id, -1)
check('scoped to this conversation', String(captured.msgFilter.conversation), String(conversationId))
check('hasMore true', firstPage.body.hasMore, true)
check('nextCursor provided', Boolean(firstPage.body.nextCursor), true)

// Returned oldest→newest so a chat view can append the page directly.
const times = firstPage.body.messages.map((m) => m.createdAt.getTime())
check('page is chronological', times.every((t, i) => i === 0 || times[i - 1] <= t), true)
// The cursor is the OLDEST message of the page — where the next page resumes.
check('nextCursor is the oldest of the page', String(firstPage.body.nextCursor), String(firstPage.body.messages[0]._id))

resetCaptured()
await listMessages(customer, { limit: '50' })
check('limit 50 honoured', captured.msgLimit, 51)
resetCaptured()
await listMessages(customer, { limit: '500' })
check('limit clamped to max 50', captured.msgLimit, 51)
resetCaptured()
await listMessages(customer, { limit: 'abc' })
check('garbage limit falls back to default', captured.msgLimit, 31)

resetCaptured()
const cursor = oid()
await listMessages(customer, { before: String(cursor) })
check('cursor applied as _id $lt', String(captured.msgFilter._id.$lt), String(cursor))
check('invalid cursor → 400', (await listMessages(customer, { before: 'nope' })).statusCode, 400)

resetCaptured()
stubMessages(makeMessages(10))
const lastPage = await listMessages(customer)
check('short page → hasMore false', lastPage.body.hasMore, false)
check('short page → nextCursor null', lastPage.body.nextCursor, null)

check('non-participant cannot paginate → 404', (await listMessages(stranger)).statusCode, 404)
check('other agent cannot paginate → 404', (await listMessages(agentB)).statusCode, 404)

/* ══════════════════ INBOX + UNREAD COUNT ══════════════════ */

const listHandler = handlerFor('get', '/')
const unreadHandler = handlerFor('get', '/unread-count')

console.log('\n== inbox is filtered by participation, not by a query param ==')
resetCaptured()
PropertyConversation.find = (filter) => { captured.listFilter = filter; return query([]) }
/** Which listings the agent currently holds, per the Property collection. */
const stubOwnedProperties = (ids) => { Property.find = () => ({ select: async () => ids.map((_id) => ({ _id })) }) }
stubOwnedProperties([propertyId])

await call(listHandler, { user: customer, query: {}, body: {} })
// 'lastMessage.at' is the empty-thread exclusion; see the section below.
check('customer sees threads they opened', Object.keys(captured.listFilter).sort().join(','), 'customer,lastMessage.at')
check('scoped to their own id', String(captured.listFilter.customer), String(customerId))

resetCaptured()
await call(listHandler, { user: agentA, query: {}, body: {} })
check('agent scope requires the conversation pointer', String(captured.listFilter.agent), String(agentAId))
// The second condition is what a stale pointer cannot satisfy.
check('agent scope ALSO requires current ownership', Array.isArray(captured.listFilter.property.$in), true)
check('restricted to listings they hold', String(captured.listFilter.property.$in[0]), String(propertyId))

resetCaptured()
// A client-supplied filter must not widen the query.
await call(listHandler, { user: customer, query: { customer: String(agentBId), agent: String(agentBId) }, body: {} })
check('query params cannot redirect the filter', String(captured.listFilter.customer), String(customerId))

console.log('\n== global unread count ==')
resetCaptured()
PropertyConversation.aggregate = async (pipeline) => { captured.pipeline = pipeline; return [{ _id: null, count: 12 }] }

const customerUnread = await call(unreadHandler, { user: customer, query: {}, body: {} })
check('returns a count', customerUnread.body.count, 12)
check('matches on customer', String(captured.pipeline[0].$match.customer), String(customerId))
check('sums the customer counter', captured.pipeline[1].$group.count.$sum, '$customerUnreadCount')

resetCaptured()
await call(unreadHandler, { user: agentA, query: {}, body: {} })
check('matches on agent', String(captured.pipeline[0].$match.agent), String(agentAId))
check('unread also gated on current ownership', Array.isArray(captured.pipeline[0].$match.property.$in), true)
check('sums the agent counter', captured.pipeline[1].$group.count.$sum, '$agentUnreadCount')

resetCaptured()
PropertyConversation.aggregate = async () => []
const noneUnread = await call(unreadHandler, { user: customer, query: {}, body: {} })
check('no conversations → 0, not undefined', noneUnread.body.count, 0)

/* ══════════ EMPTY THREADS ARE HIDDEN FROM INBOX LISTS ══════════
 *
 * REGRESSION: a conversation is created the moment a customer taps Message,
 * before they type anything. The agent's inbox showed those as a customer with
 * "No messages yet" — someone who had not actually contacted them.
 *
 * The trap this guards against: `{ lastMessage: { $ne: null } }` matches every
 * document and fixes nothing, because lastMessage is an inline nested path
 * that Mongoose materialises as { text: '', sender: null, at: null } on
 * create. `lastMessage.at` is the field that actually transitions.
 *
 * Hiding is a LIST rule only. Direct access by id must be untouched.
 */

console.log('\n== empty threads: the shape a brand-new conversation really has ==')

// Not hand-written — built by the real schema, so this asserts Mongoose's
// actual defaults rather than an assumption about them.
const freshDoc = new PropertyConversation({
  property: propertyId,
  customer: customerId,
  agent: agentAId,
  status: 'open',
  lastActivityAt: new Date(),
}).toObject()

check('lastMessage is NOT null on create', freshDoc.lastMessage === null, false)
check('lastMessage.at IS null on create', freshDoc.lastMessage.at, null)
check('lastMessage.text is empty on create', freshDoc.lastMessage.text, '')
check('no unread on either side', freshDoc.customerUnreadCount + freshDoc.agentUnreadCount, 0)
check('starts open', freshDoc.status, 'open')
check('lastActivityAt is set at creation', freshDoc.lastActivityAt instanceof Date, true)

const emptyThreadId = oid()
const spokenThreadId = oid()
const firstMessageAt = new Date()

const emptyThread = {
  _id: emptyThreadId,
  property: propertyId,
  customer: customerId,
  agent: agentAId,
  status: 'open',
  lastMessage: { text: '', sender: null, at: null },
  lastActivityAt: new Date(),
  customerUnreadCount: 0,
  agentUnreadCount: 0,
}

const spokenThread = {
  ...emptyThread,
  _id: spokenThreadId,
  lastMessage: { text: 'Hello, is this available?', sender: customerId, at: firstMessageAt },
  lastActivityAt: firstMessageAt,
  agentUnreadCount: 1,
}

/** Enough of Mongo's matching semantics to exercise the real inbox filter. */
const matchesFilter = (row, filter) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === 'lastMessage.at') {
      // Mongo's $ne: null excludes explicit null AND a missing path.
      const value = row.lastMessage?.at ?? null
      return value !== null
    }
    if (key === 'property') return condition.$in.some((id) => String(id) === String(row.property))
    return String(condition) === String(row[key])
  })

const stubInbox = (rows) => {
  PropertyConversation.find = (filter) => {
    captured.listFilter = filter
    return query(rows.filter((row) => matchesFilter(row, filter)))
  }
}

console.log('\n== A/G/H: an unspoken thread is in NEITHER inbox ==')
resetCaptured()
stubOwnedProperties([propertyId])
stubInbox([emptyThread])

const agentEmptyList = await call(listHandler, { user: agentA, query: {}, body: {} })
check('agent list excludes the empty thread', agentEmptyList.body.conversations.length, 0)
check('agent count reports 0', agentEmptyList.body.count, 0)
check('exclusion is in the query, not post-filtered', JSON.stringify(captured.listFilter['lastMessage.at']), '{"$ne":null}')

resetCaptured()
const customerEmptyList = await call(listHandler, { user: customer, query: {}, body: {} })
// The same rule on both sides: tapping Message and leaving must not leave a
// ghost row in the customer's own inbox either.
check('customer list excludes it too', customerEmptyList.body.conversations.length, 0)
check('customer scope carries the same condition', JSON.stringify(captured.listFilter['lastMessage.at']), '{"$ne":null}')

console.log('\n== D/E: the first real message makes it appear ==')
resetCaptured()
stubInbox([spokenThread, emptyThread])

const afterFirstMessage = await call(listHandler, { user: agentA, query: {}, body: {} })
check('exactly one row returned', afterFirstMessage.body.conversations.length, 1)
check('it is the spoken thread', String(afterFirstMessage.body.conversations[0]._id), String(spokenThreadId))
check('preview is the real first message', afterFirstMessage.body.conversations[0].lastMessage.text, 'Hello, is this available?')
check('sent by the customer', String(afterFirstMessage.body.conversations[0].lastMessage.sender), String(customerId))
// J — the agent's badge on that row.
check('agent unread is 1', afterFirstMessage.body.conversations[0].unreadCount, 1)
// There must be no window in which the agent sees a row with no preview.
check('no "empty preview" row reaches the client', afterFirstMessage.body.conversations.some((c) => c.lastMessage === null), false)
check('ordering key is the message timestamp', afterFirstMessage.body.conversations[0].lastActivityAt, firstMessageAt)

console.log('\n== B/C: hiding from the list does NOT restrict access ==')
// The mobile app navigates straight to the thread it just created, so this is
// the case that must keep working.
stubConversation(emptyThread)
check('customer can open the empty thread → 200', (await call(detailHandler, { ...req(customer), params: { id: String(emptyThreadId) } })).statusCode, 200)
check('assigned agent can open it → 200', (await call(detailHandler, { ...req(agentA), params: { id: String(emptyThreadId) } })).statusCode, 200)
check('a stranger still cannot → 404', (await call(detailHandler, { ...req(stranger), params: { id: String(emptyThreadId) } })).statusCode, 404)
check('admin still cannot → 404', (await call(detailHandler, { ...req(adminUser), params: { id: String(emptyThreadId) } })).statusCode, 404)

const emptyDetail = await call(detailHandler, { ...req(customer), params: { id: String(emptyThreadId) } })
check('detail reports no lastMessage', emptyDetail.body.conversation.lastMessage, null)

stubMessages([])
const emptyMessages = await call(messagesHandler, { user: customer, params: { id: String(emptyThreadId) }, query: {}, body: {} })
check('messages → 200', emptyMessages.statusCode, 200)
check('messages → empty array, not an error', Array.isArray(emptyMessages.body.messages) && emptyMessages.body.messages.length === 0, true)
check('no further pages', emptyMessages.body.hasMore, false)

console.log('\n== F: reopen before any message reuses the thread, still hidden ==')
resetCaptured()
const unspokenExisting = { ...emptyThread, save: async function () { captured.saved = this } }
stubStart({ existing: unspokenExisting })
const reopenedEmpty = await call(startHandler, { user: customer, body: { propertyId: String(propertyId) } })
check('same conversation id returned', String(reopenedEmpty.body.conversationId), String(emptyThreadId))
check('no duplicate created', reopenedEmpty.body.created, false)
check('start never writes lastMessage', captured.create, undefined)

stubOwnedProperties([propertyId])
stubInbox([unspokenExisting])
check('still absent from the agent inbox', (await call(listHandler, { user: agentA, query: {}, body: {} })).body.conversations.length, 0)

console.log('\n== I: the unread badge uses the identical scope ==')
resetCaptured()
PropertyConversation.aggregate = async (pipeline) => {
  captured.pipeline = pipeline
  // An empty thread contributes 0 by construction: only a send increments a
  // counter. The aggregate therefore matches nothing to sum.
  return []
}
const emptyUnread = await call(unreadHandler, { user: agentA, query: {}, body: {} })
check('badge reads 0 for an unspoken thread', emptyUnread.body.count, 0)
check('unread $match carries the same exclusion', JSON.stringify(captured.pipeline[0].$match['lastMessage.at']), '{"$ne":null}')
check('unread $match still gated on ownership', Array.isArray(captured.pipeline[0].$match.property.$in), true)

/* ══════════ HALF-COMPLETED REASSIGNMENT — EVERY SURFACE ══════════
 *
 * The exact failure the property route tolerates: Property.agent moved to B,
 * the follow-up conversation write threw, so the pointer still names A.
 * Nothing below may leak to A through ANY route.
 */

console.log('\n== STALE STATE: property=B, conversation.agent=A — agent A is denied everywhere ==')

const staleConversation = () => ({ ...openConversation(), agent: agentAId })

// 1. Conversation detail
stubConversation(staleConversation(), agentBId)
check('detail → 404', (await call(detailHandler, req(agentA))).statusCode, 404)

// 2. Messages list
stubConversation(staleConversation(), agentBId)
stubMessages(makeMessages(5))
check('messages → 404', (await listMessages(agentA)).statusCode, 404)

// 3. Send
stubSend(staleConversation(), activeAgentAccount, agentBId)
check('send → 404', (await send(agentA, { text: 'still here?' })).statusCode, 404)

// 4. Mark read
stubConversation(staleConversation(), agentBId)
check('mark read → 404', (await markRead(agentA)).statusCode, 404)

// 5. Inbox — A no longer holds the property, so the $in excludes the thread.
resetCaptured()
stubOwnedProperties([]) // reassignment moved the listing off A
await call(listHandler, { user: agentA, query: {}, body: {} })
check('inbox scope matches no property', captured.listFilter.property.$in.length, 0)

// 6. Unread count
resetCaptured()
PropertyConversation.aggregate = async (pipeline) => { captured.pipeline = pipeline; return [] }
const staleUnread = await call(unreadHandler, { user: agentA, query: {}, body: {} })
check('unread scope matches no property', captured.pipeline[0].$match.property.$in.length, 0)
check('badge reads 0', staleUnread.body.count, 0)

console.log('\n== STALE STATE: the customer is unaffected ==')
stubConversation(staleConversation(), agentBId)
check('customer can still open their thread', (await call(detailHandler, req(customer))).statusCode, 200)
stubMessages(makeMessages(5))
check('customer can still read history', (await listMessages(customer)).statusCode, 200)

console.log('\n== STALE STATE: customer send reconciles, then routes to B ==')
resetCaptured()
// Property says B; B's account is live; the conversation still names A.
stubSend(staleConversation(), { _id: agentBId, role: 'agent', isActive: true }, agentBId)
const reconciledSend = await send(customer, { text: 'Any update?' })
check('send succeeds', reconciledSend.statusCode, 201)
// updateOne is called twice: once by reconciliation, once for the unread $inc.
check('pointer repaired to B', String(captured.convUpdate.filter._id), String(conversationId))
check('unread went to the NEW agent', captured.convUpdate.update.$inc.agentUnreadCount, 1)
check('customer own unread untouched', 'customerUnreadCount' in captured.convUpdate.update.$inc, false)

console.log('\n== STALE STATE: property unassigned, conversation still names A ==')
stubConversation(staleConversation(), null)
check('agent A detail → 404', (await call(detailHandler, req(agentA))).statusCode, 404)
check('agent A mark read → 404', (await markRead(agentA)).statusCode, 404)
stubSend(staleConversation(), null, null)
check('agent A send → 404', (await send(agentA, { text: 'hi' })).statusCode, 404)
// The customer keeps history, but cannot send into an ownerless thread.
stubConversation(staleConversation(), null)
check('customer keeps read access', (await call(detailHandler, req(customer))).statusCode, 200)
stubSend(staleConversation(), null, null)
check('customer send → 409 (no agent to receive it)', (await send(customer, { text: 'hi' })).statusCode, 409)

console.log('\n== deleted property: agent fails closed, customer keeps history ==')
stubConversation(staleConversation(), PROPERTY_DELETED) // Property.findById → null
check('agent → 404 (ownership unverifiable)', (await call(detailHandler, req(agentA))).statusCode, 404)
check('customer → 200 (history survives)', (await call(detailHandler, req(customer))).statusCode, 200)

console.log('\n== incoming agent B before reconciliation ==')
// B holds the listing but the pointer has not moved. Privacy over
// availability: B waits rather than the door being left ajar for A.
stubConversation(staleConversation(), agentBId)
check('B is denied until the pointer catches up', (await call(detailHandler, req(agentB))).statusCode, 404)

console.log('\n== after successful reassignment, B has full access ==')
const reassigned = { ...openConversation(), agent: agentBId }
stubConversation(reassigned, agentBId)
check('B detail → 200', (await call(detailHandler, req(agentB))).statusCode, 200)
check('A detail → 404', (await call(detailHandler, req(agentA))).statusCode, 404)
stubSend(reassigned, { _id: agentBId, role: 'agent', isActive: true }, agentBId)
check('B can send', (await send(agentB, { text: 'Taking this over.' })).statusCode, 201)
check('A cannot send', (await send(agentA, { text: 'hi' })).statusCode, 404)

restoreAll()

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
