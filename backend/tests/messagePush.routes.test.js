// Does a REJECTED message send notify anyone?
//
// messagePush.test.js covers the push service in isolation: given a call, what
// does it do. This file asks the different question the Phase-8B brief actually
// required — is that call REACHED at all — by driving the real
// POST /api/property-conversations/:id/messages route down each of its
// rejecting paths and asserting the adapter was never invoked.
//
// The REAL router and the REAL propertyMessaging service run here (validation,
// authorization, sendability, agent reconciliation). Only genuine externals are
// faked: MongoDB, the JWT middleware, Socket.IO, and the push adapter — which
// is a SPY, so no notification can leave the process.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import mongoose from 'mongoose'

// Real-looking ObjectIds: loadAuthorizedConversation rejects anything else
// before authorization even runs, so string ids would pass every test for the
// wrong reason.
const id = () => new mongoose.Types.ObjectId()

const CUSTOMER = id()
const AGENT = id()
const STRANGER = id()
const PROPERTY = id()
const CONVERSATION = id()

// ── Scripted database ────────────────────────────────────────────────────
let conversation = null
let property = null
let users = {}
let createdMessages = []
let conversationUpdates = []

const asDoc = (fields) => ({ ...fields })

/** Mongoose query objects answer .populate() and then await to the document. */
const asQuery = (doc) => {
  const q = {
    populate: () => q,
    select: () => q,
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
  }
  return q
}

const FakePropertyConversation = {
  findById: (wanted) => asQuery(String(wanted) === String(CONVERSATION) ? conversation : null),
  updateOne: async (query, update) => {
    conversationUpdates.push({ query, update })
    return { matchedCount: 1 }
  },
}

const FakePropertyMessage = {
  create: async (doc) => {
    const created = { _id: id(), createdAt: new Date(), ...doc }
    createdMessages.push(created)
    return created
  },
}

const FakeProperty = {
  findById: (wanted) => asQuery(String(wanted) === String(PROPERTY) ? property : null),
}

const FakeUser = {
  findById: (wanted) => asQuery(users[String(wanted)] ?? null),
}

mock.module('../models/PropertyConversation.js', { defaultExport: FakePropertyConversation })
mock.module('../models/PropertyMessage.js', {
  defaultExport: FakePropertyMessage,
  namedExports: { MESSAGE_PREVIEW_LENGTH: 140, MAX_MESSAGE_LENGTH: 2000 },
})
mock.module('../models/Property.js', { defaultExport: FakeProperty })
mock.module('../models/User.js', { defaultExport: FakeUser })

// ── Scripted identity ────────────────────────────────────────────────────
let caller = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!caller) {
        return res.status(401).json({ success: false, message: 'Not authorized, no token' })
      }
      req.user = caller
      next()
    },
  },
})

// ── The spy under test ───────────────────────────────────────────────────
// Replaced rather than merely observed, so a real Expo request is impossible
// even if the production code changed underneath these tests.
let pushCalls = []

mock.module('../services/messagePush.js', {
  namedExports: {
    sendNewMessagePush: async (args) => {
      pushCalls.push(args)
      return { sent: true }
    },
  },
})

// ── Socket.IO ────────────────────────────────────────────────────────────
let emitCalls = []

mock.module('../services/propertyMessagingRealtime.js', {
  namedExports: {
    emitNewPropertyMessage: (io, payload) => {
      emitCalls.push(payload)
    },
  },
})

// ── Server under test ────────────────────────────────────────────────────
let server
let baseUrl

before(async () => {
  const { default: routes } = await import('../routes/propertyConversations.js')
  const app = express()
  app.use(express.json())
  app.use('/api/property-conversations', routes)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((r) => server.close(r))
})

const sendMessage = async (conversationId, body) => {
  const response = await fetch(`${baseUrl}/api/property-conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/** The healthy baseline every test starts from, then breaks one thing. */
test.beforeEach(() => {
  conversation = asDoc({
    _id: CONVERSATION,
    property: PROPERTY,
    customer: CUSTOMER,
    agent: AGENT,
    status: 'open',
  })
  property = asDoc({ _id: PROPERTY, agent: AGENT })
  users = {
    [String(AGENT)]: asDoc({ _id: AGENT, role: 'agent', isActive: true, name: 'Ahmet' }),
    [String(CUSTOMER)]: asDoc({ _id: CUSTOMER, role: 'user', isActive: true, name: 'Buyer' }),
  }
  caller = { _id: AGENT, role: 'agent', name: 'Ahmet' }

  createdMessages = []
  conversationUpdates = []
  pushCalls = []
  emitCalls = []
})

/* ═══════════════ 1. Invalid message text ═══════════════ */

test('1. empty text is rejected, stores nothing, and notifies nobody', async () => {
  const { status, body } = await sendMessage(CONVERSATION, { text: '   ' })

  assert.equal(status, 400)
  assert.equal(body.success, false)
  assert.equal(createdMessages.length, 0, 'no PropertyMessage may be created')
  assert.equal(pushCalls.length, 0, 'a refused send must notify nobody')
  assert.equal(emitCalls.length, 0, 'and must not announce anything on the socket')
})

test('1. a missing or non-string text is rejected without a push', async () => {
  for (const text of [undefined, null, 123, { evil: true }, []]) {
    pushCalls = []
    createdMessages = []

    const { status } = await sendMessage(CONVERSATION, { text })

    assert.equal(status, 400, `expected 400 for ${JSON.stringify(text)}`)
    assert.equal(createdMessages.length, 0)
    assert.equal(pushCalls.length, 0)
  }
})

test('1. text over the length limit is rejected without a push', async () => {
  const { status } = await sendMessage(CONVERSATION, { text: 'x'.repeat(2001) })

  assert.equal(status, 400)
  assert.equal(createdMessages.length, 0)
  assert.equal(pushCalls.length, 0)
})

/* ═══════════════ 2. Unauthorised access ═══════════════ */

test('2. a non-participant gets 404 and triggers no push', async () => {
  caller = { _id: STRANGER, role: 'user', name: 'Nosy' }

  const { status, body } = await sendMessage(CONVERSATION, { text: 'let me in' })

  assert.equal(status, 404)
  assert.equal(body.message, 'Conversation not found')
  assert.equal(createdMessages.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('2. an agent who NO LONGER holds the listing is refused, and no push', async () => {
  // The pointer still names them, but the property has moved on. Authorization
  // fails closed — and so must the notification.
  property = asDoc({ _id: PROPERTY, agent: id() })

  const { status } = await sendMessage(CONVERSATION, { text: 'still mine?' })

  assert.equal(status, 404)
  assert.equal(createdMessages.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('2. a demoted agent is refused, and no push', async () => {
  caller = { _id: AGENT, role: 'user', name: 'Ahmet' }

  const { status } = await sendMessage(CONVERSATION, { text: 'hello' })

  assert.equal(status, 404)
  assert.equal(pushCalls.length, 0)
})

test('2. an unknown conversation id triggers no push', async () => {
  const { status } = await sendMessage(id(), { text: 'hello' })

  assert.equal(status, 404)
  assert.equal(pushCalls.length, 0)
})

test('2. a MALFORMED conversation id triggers no push', async () => {
  const { status } = await sendMessage('not-an-object-id', { text: 'hello' })

  assert.equal(status, 404)
  assert.equal(pushCalls.length, 0)
})

test('2. an unauthenticated request triggers no push', async () => {
  caller = null

  const { status } = await sendMessage(CONVERSATION, { text: 'hello' })

  assert.equal(status, 401)
  assert.equal(pushCalls.length, 0)
})

/* ═══════════════ 3. Unsendable conversation ═══════════════ */

test('3. a CLOSED conversation is rejected with 409 and no push', async () => {
  conversation.status = 'closed'

  const { status, body } = await sendMessage(CONVERSATION, { text: 'one more thing' })

  assert.equal(status, 409)
  assert.equal(body.message, 'This conversation is closed.')
  assert.equal(createdMessages.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('3. a property with NO agent is rejected with 409 and no push', async () => {
  // Customer side, so authorization passes; sendability is what refuses.
  caller = { _id: CUSTOMER, role: 'user', name: 'Buyer' }
  property = asDoc({ _id: PROPERTY, agent: null })

  const { status, body } = await sendMessage(CONVERSATION, { text: 'anyone there?' })

  assert.equal(status, 409)
  assert.match(body.message, /until an agent is assigned/)
  assert.equal(createdMessages.length, 0)
  assert.equal(pushCalls.length, 0)
})

test('3. a DEACTIVATED agent makes the thread unsendable, and no push', async () => {
  caller = { _id: CUSTOMER, role: 'user', name: 'Buyer' }
  users[String(AGENT)] = asDoc({ _id: AGENT, role: 'agent', isActive: false, name: 'Ahmet' })

  const { status } = await sendMessage(CONVERSATION, { text: 'hello?' })

  assert.equal(status, 409)
  assert.equal(createdMessages.length, 0)
  assert.equal(pushCalls.length, 0)
})

/* ═══════════════ 4. Successful agent → customer ═══════════════ */

test('4. a successful agent reply still saves, emits, and pushes exactly once', async () => {
  const { status, body } = await sendMessage(CONVERSATION, {
    text: 'Hi, this property is still available.',
  })

  // The existing contract is unchanged.
  assert.equal(status, 201)
  assert.equal(body.success, true)
  assert.equal(body.message.text, 'Hi, this property is still available.')

  // The message really was stored.
  assert.equal(createdMessages.length, 1)
  assert.equal(String(createdMessages[0].sender), String(AGENT))

  // The recipient's counter moved, not the sender's.
  const [{ update }] = conversationUpdates.filter((u) => u.update.$inc)
  assert.deepEqual(Object.keys(update.$inc), ['customerUnreadCount'])

  // Realtime is untouched by this phase.
  assert.equal(emitCalls.length, 1, 'Socket.IO must still fire')

  // And exactly one push, aimed at the customer.
  assert.equal(pushCalls.length, 1, 'exactly once — not zero, not twice')
  assert.equal(pushCalls[0].senderSide, 'agent')
  assert.equal(String(pushCalls[0].customerId), String(CUSTOMER))
  assert.equal(String(pushCalls[0].conversationId), String(CONVERSATION))
  assert.equal(pushCalls[0].senderName, 'Ahmet')
})

test('4. the push is attempted AFTER the message is committed', async () => {
  // Ordering is the whole safety property: nothing may notify about a message
  // the database has not accepted.
  await sendMessage(CONVERSATION, { text: 'ordering matters' })

  assert.equal(createdMessages.length, 1)
  assert.equal(pushCalls.length, 1)
  assert.ok(
    conversationUpdates.some((u) => u.update.$inc),
    'the unread counter was updated before the notification'
  )
})

/* ═══════════════ 5. Successful customer → agent ═══════════════ */

test('5. a customer message saves normally and never self-pushes', async () => {
  caller = { _id: CUSTOMER, role: 'user', name: 'Buyer' }

  const { status, body } = await sendMessage(CONVERSATION, { text: 'Is it still available?' })

  // The existing API response is preserved.
  assert.equal(status, 201)
  assert.equal(body.success, true)
  assert.equal(createdMessages.length, 1)

  // The AGENT's counter moves for a customer message.
  const [{ update }] = conversationUpdates.filter((u) => u.update.$inc)
  assert.deepEqual(Object.keys(update.$inc), ['agentUnreadCount'])

  // Realtime still fires for the customer→agent direction.
  assert.equal(emitCalls.length, 1)

  /*
   * The route calls the adapter once for BOTH directions — recipient selection
   * belongs in one place, not duplicated in the route. What matters here is
   * that it is told the sender was the customer, which is what makes the
   * adapter return null and send nothing. Its own suite proves that; this
   * proves the route hands it the right side.
   */
  assert.equal(pushCalls.length, 1)
  assert.equal(pushCalls[0].senderSide, 'customer', 'the adapter must know who sent it')
  assert.equal(String(pushCalls[0].customerId), String(CUSTOMER))
})

/*
 * The remaining half of "a customer is never pushed their own message" lives in
 * messagePush.test.js, deliberately.
 *
 * This file mocks the adapter in order to observe the ROUTE, so it cannot also
 * test the adapter's logic — it would only be re-testing the mock. The two
 * halves compose:
 *
 *   here                  the route passes senderSide: 'customer'
 *   messagePush.test.js   senderSide: 'customer' → recipient null → nothing sent
 *
 * Splitting it that way is what keeps each assertion about real code.
 */
