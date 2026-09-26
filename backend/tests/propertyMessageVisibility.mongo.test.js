// "Delete for me" and "Delete conversation" in PROPERTY customer↔agent
// messaging, end to end against a real MongoDB.
//
// Real router, real authorization, real models, real queries — so `$ne` on an
// array, the ObjectId cutoffs, positional updates and cursor pagination are
// MongoDB's own behaviour, not a fake's. Only the push adapter is replaced (so
// nothing can leave the process), and Socket.IO is a recorder.
//
// Skipped unless PROPERTY_MESSAGING_TEST_MONGO_URI is set, like the other
// *.mongo.test.js files. A throwaway database is created and dropped.
//
// Nothing here touches the AI assistant's ChatConversation / ChatMessage.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

const MONGO_URI = process.env.PROPERTY_MESSAGING_TEST_MONGO_URI
const skip = !MONGO_URI && 'PROPERTY_MESSAGING_TEST_MONGO_URI is not set'

const DB_NAME = `varlikent_property_messaging_test_${process.pid}_${Date.now()}`
const SECRET = 'property-messaging-visibility-test-secret'

let pushCalls = []
mock.module('../services/messagePush.js', {
  namedExports: {
    sendNewMessagePush: async (args) => {
      pushCalls.push(args)
      return { sent: false }
    },
  },
})

let emits = []
const fakeIo = {
  to: (rooms) => ({ emit: (event, payload) => emits.push({ rooms: [].concat(rooms), event, payload }) }),
}

let server
let baseUrl
let User
let Property
let PropertyConversation
let PropertyMessage

let customer
let agent
let agent2
let stranger
const token = {}

before(async () => {
  if (skip) return
  process.env.JWT_SECRET = SECRET

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME })
  ;({ default: User } = await import('../models/User.js'))
  ;({ default: Property } = await import('../models/Property.js'))
  ;({ default: PropertyConversation } = await import('../models/PropertyConversation.js'))
  ;({ default: PropertyMessage } = await import('../models/PropertyMessage.js'))
  const { default: routes } = await import('../routes/propertyConversations.js')
  await PropertyConversation.syncIndexes()
  await PropertyMessage.syncIndexes()

  customer = await User.create({ name: 'Ahsan', email: 'customer@example.test', password: 'secret-1', role: 'user' })
  agent = await User.create({ name: 'Mehmet', email: 'agent@example.test', password: 'secret-2', role: 'agent' })
  agent2 = await User.create({ name: 'Ayse', email: 'agent2@example.test', password: 'secret-3', role: 'agent' })
  stranger = await User.create({ name: 'Cem', email: 'stranger@example.test', password: 'secret-4', role: 'user' })
  for (const user of [customer, agent, agent2, stranger]) token[user._id] = jwt.sign({ id: user._id }, SECRET)

  const app = express()
  app.use(express.json())
  app.set('io', fakeIo)
  app.use('/api/property-conversations', routes)
  app.use((err, req, res, _next) => res.status(500).json({ success: false, message: err.message }))
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (skip) return
  await new Promise((resolve) => server.close(resolve))
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  if (skip) return
  await PropertyConversation.deleteMany({})
  await PropertyMessage.deleteMany({})
  await Property.collection.deleteMany({})
  emits = []
  pushCalls = []
})

const call = async (user, method, path, body) => {
  const response = await fetch(`${baseUrl}/api/property-conversations${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${token[user._id]}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/**
 * A listing held by `holder`. Inserted through the raw collection so the
 * Property model's save hooks (translation, geocoding) never run in a
 * messaging test.
 */
const listing = async (holder = agent) => {
  const _id = new mongoose.Types.ObjectId()
  await Property.collection.insertOne({
    _id,
    title: 'Bosphorus Villa',
    listingType: 'Sale',
    price: 1000000,
    district: 'Besiktas',
    address: 'Test street 1',
    propertyType: 'Villa',
    beds: 4,
    baths: 3,
    sqm: 300,
    agent: holder._id,
  })
  return _id
}

/** Opens a thread as the customer and returns its id. */
const openThread = async (propertyId) => {
  const started = await call(customer, 'POST', '', { propertyId: String(propertyId) })
  assert.ok([200, 201].includes(started.status), JSON.stringify(started.body))
  return started.body.conversationId
}

const send = async (user, conversationId, text) => {
  const sent = await call(user, 'POST', `/${conversationId}/messages`, { text })
  assert.equal(sent.status, 201, JSON.stringify(sent.body))
  return sent.body.message
}

const texts = async (user, conversationId, query = '') => {
  const page = await call(user, 'GET', `/${conversationId}/messages${query}`)
  assert.equal(page.status, 200, JSON.stringify(page.body))
  return page.body.messages.map((message) => message.text)
}

const inbox = async (user) => {
  const list = await call(user, 'GET', '')
  assert.equal(list.status, 200)
  return list.body.conversations
}

const unread = async (user) => (await call(user, 'GET', '/unread-count')).body.count

const hide = (user, conversationId, messageId) =>
  call(user, 'POST', `/${conversationId}/messages/${messageId}/hide`)

const clear = (user, conversationId) => call(user, 'POST', `/${conversationId}/clear`)

/** Walks every page with `before`, as Load Older does, returning all texts oldest-first. */
const walkAllPages = async (user, conversationId, limit) => {
  const pages = []
  let before = null
  for (let guard = 0; guard < 50; guard += 1) {
    const query = `?limit=${limit}${before ? `&before=${before}` : ''}`
    const page = await call(user, 'GET', `/${conversationId}/messages${query}`)
    assert.equal(page.status, 200)
    pages.unshift(page.body.messages.map((message) => message.text))
    if (!page.body.hasMore) break
    assert.ok(page.body.nextCursor, 'hasMore without a cursor')
    before = page.body.nextCursor
  }
  return pages.flat()
}

// ── 1 / 2. Individual Delete for me ──────────────────────────────────────

test('1. the customer hides their own message: gone for them, intact for the agent and in the database', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  await send(customer, id, 'Can I visit tomorrow?')

  const result = await hide(customer, id, hello._id)
  assert.equal(result.status, 200)

  assert.deepEqual(await texts(customer, id), ['Can I visit tomorrow?'])
  assert.deepEqual(await texts(agent, id), ['Hello', 'Can I visit tomorrow?'])

  const stored = await PropertyMessage.findById(hello._id).lean()
  assert.equal(stored.text, 'Hello')
  assert.equal(String(stored.sender), String(customer._id))
})

test('2. a refresh, a restart or a second device all get the same answer', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  await hide(customer, id, hello._id)

  // A new token for the same account is a new device; the server decides.
  token[customer._id] = jwt.sign({ id: customer._id, device: 'b' }, SECRET)
  assert.deepEqual(await texts(customer, id), [])
  assert.deepEqual(await texts(agent, id), ['Hello'])
})

test('hiding is idempotent', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  await send(customer, id, 'Still there?')
  assert.equal((await hide(customer, id, hello._id)).status, 200)
  assert.equal((await hide(customer, id, hello._id)).status, 200)
  const stored = await PropertyMessage.findById(hello._id).lean()
  assert.equal(stored.hiddenFor.length, 1)
})

// ── 3 / 4. Authorization ─────────────────────────────────────────────────

test("3. the customer cannot hide the agent's message", { skip }, async () => {
  const id = await openThread(await listing())
  await send(customer, id, 'Hello')
  const hi = await send(agent, id, 'Hi')

  const result = await hide(customer, id, hi._id)
  assert.equal(result.status, 403)
  assert.deepEqual(await texts(customer, id), ['Hello', 'Hi'])
  const stored = await PropertyMessage.findById(hi._id).lean()
  assert.equal(stored.hiddenFor, undefined)
})

test('the agent cannot hide the customer\'s message either', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  assert.equal((await hide(agent, id, hello._id)).status, 403)
})

test('4. an unrelated user can neither hide a message nor clear the conversation', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')

  assert.equal((await hide(stranger, id, hello._id)).status, 404)
  assert.equal((await clear(stranger, id)).status, 404)
  assert.deepEqual(await texts(customer, id), ['Hello'])
  assert.equal((await inbox(customer)).length, 1)
})

test('a message id from another conversation is not found through this one', { skip }, async () => {
  const first = await openThread(await listing())
  const second = await openThread(await listing())
  const other = await send(customer, second, 'Other listing')
  await send(customer, first, 'This listing')

  assert.equal((await hide(customer, first, other._id)).status, 404)
  assert.deepEqual(await texts(customer, second), ['Other listing'])
})

test('malformed ids and missing auth are rejected', { skip }, async () => {
  const id = await openThread(await listing())
  await send(customer, id, 'Hello')
  assert.equal((await hide(customer, id, 'nope')).status, 404)
  assert.equal((await call(null, 'POST', `/${id}/clear`)).status, 401)
})

test('an agent who no longer holds the listing cannot change anything', { skip }, async () => {
  const propertyId = await listing(agent)
  const id = await openThread(propertyId)
  await send(customer, id, 'Hello')
  const reply = await send(agent, id, 'Hi')

  await Property.collection.updateOne({ _id: propertyId }, { $set: { agent: agent2._id } })

  assert.equal((await hide(agent, id, reply._id)).status, 404)
  assert.equal((await clear(agent, id)).status, 404)
})

test("a new agent does not inherit the previous agent's private view", { skip }, async () => {
  const propertyId = await listing(agent)
  const id = await openThread(propertyId)
  await send(customer, id, 'Hello')
  const reply = await send(agent, id, 'Hi')
  await send(customer, id, 'Thanks')
  assert.equal((await hide(agent, id, reply._id)).status, 200)
  assert.deepEqual(await texts(agent, id), ['Hello', 'Thanks'])

  await Property.collection.updateOne({ _id: propertyId }, { $set: { agent: agent2._id } })
  await PropertyConversation.updateOne({ _id: id }, { $set: { agent: agent2._id } })
  assert.deepEqual(await texts(agent2, id), ['Hello', 'Hi', 'Thanks'])
})

test('hiding still works on a closed conversation', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  await send(customer, id, 'Anyone?')
  await PropertyConversation.updateOne({ _id: id }, { $set: { status: 'closed' } })
  assert.equal((await hide(customer, id, hello._id)).status, 200)
})

// ── 5 / 6. Previews ──────────────────────────────────────────────────────

test('5. hiding my newest message: my preview falls back, the agent\'s does not change', { skip }, async () => {
  const id = await openThread(await listing())
  await send(agent, id, 'Hello')
  const interested = await send(customer, id, "I'm interested")

  const result = await hide(customer, id, interested._id)
  assert.equal(result.body.lastMessage.text, 'Hello')
  assert.equal(result.body.inInbox, true)

  const [mine] = await inbox(customer)
  const [theirs] = await inbox(agent)
  assert.equal(mine.lastMessage.text, 'Hello')
  assert.equal(String(mine.lastMessage.sender), String(agent._id))
  assert.equal(theirs.lastMessage.text, "I'm interested")

  // The shared field itself is untouched.
  const stored = await PropertyConversation.findById(id).lean()
  assert.equal(stored.lastMessage.text, "I'm interested")
  assert.equal(stored.agentUnreadCount, 1)
})

test('6. hiding my only message removes the row from MY inbox only', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')

  const result = await hide(customer, id, hello._id)
  assert.equal(result.body.inInbox, false)
  assert.equal(result.body.lastMessage, null)

  assert.equal((await inbox(customer)).length, 0)
  const agentRows = await inbox(agent)
  assert.equal(agentRows.length, 1)
  assert.equal(agentRows[0].lastMessage.text, 'Hello')
  assert.deepEqual(await texts(agent, id), ['Hello'])
  // Hiding my own message never marks it read for the agent.
  assert.equal(await unread(agent), 1)
})

test('a conversation written before this feature (no lastMessage.message) still works', { skip }, async () => {
  const id = await openThread(await listing())
  await send(customer, id, 'Hello')
  const last = await send(customer, id, 'Second')
  await PropertyConversation.updateOne({ _id: id }, { $unset: { 'lastMessage.message': 1 } })

  const result = await hide(customer, id, last._id)
  assert.equal(result.status, 200)
  assert.equal((await inbox(customer))[0].lastMessage.text, 'Hello')
  assert.equal((await inbox(agent))[0].lastMessage.text, 'Second')
})

// ── 7–10. Delete conversation ────────────────────────────────────────────

const twentyMessages = async (id) => {
  for (let i = 1; i <= 20; i += 1) {
    await send(i % 2 ? customer : agent, id, `Message ${i}`)
  }
}

test('7. clearing removes the conversation from my side; the agent keeps all 20 messages', { skip }, async () => {
  const id = await openThread(await listing())
  await twentyMessages(id)

  const result = await clear(customer, id)
  assert.equal(result.status, 200)

  assert.equal((await inbox(customer)).length, 0)
  assert.deepEqual(await texts(customer, id, '?limit=50'), [])

  assert.equal((await inbox(agent)).length, 1)
  assert.equal((await texts(agent, id, '?limit=50')).length, 20)
  assert.equal(await PropertyMessage.countDocuments({ conversation: id }), 20)
  assert.ok(await PropertyConversation.findById(id))
})

test('8. a new agent message brings the row back with only the new activity', { skip }, async () => {
  const id = await openThread(await listing())
  await twentyMessages(id)
  await clear(customer, id)

  await send(agent, id, 'Are you still interested?')

  const rows = await inbox(customer)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].lastMessage.text, 'Are you still interested?')
  assert.deepEqual(await texts(customer, id, '?limit=50'), ['Are you still interested?'])
  assert.equal((await texts(agent, id, '?limit=50')).length, 21)
})

test('9. sending again after clearing reuses the thread without restoring old history', { skip }, async () => {
  const propertyId = await listing()
  const id = await openThread(propertyId)
  await twentyMessages(id)
  await clear(customer, id)

  // "Message Agent" on the listing again: the same thread comes back...
  const reopened = await openThread(propertyId)
  assert.equal(String(reopened), String(id))
  // ...but not into the inbox, until something is actually said.
  assert.equal((await inbox(customer)).length, 0)

  await send(customer, id, 'Can we schedule a viewing?')

  const rows = await inbox(customer)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].lastMessage.text, 'Can we schedule a viewing?')
  assert.deepEqual(await texts(customer, id, '?limit=50'), ['Can we schedule a viewing?'])
  const agentTexts = await texts(agent, id, '?limit=50')
  assert.equal(agentTexts.length, 21)
  assert.equal(agentTexts.at(-1), 'Can we schedule a viewing?')
})

test('10. clearing resets MY unread count only; new messages count again', { skip }, async () => {
  const id = await openThread(await listing())
  await send(customer, id, 'Hello')
  await send(agent, id, 'Hi')
  await send(agent, id, 'Still there?')
  await send(customer, id, 'Yes')
  assert.equal(await unread(customer), 2)
  assert.equal(await unread(agent), 2)

  await clear(customer, id)
  assert.equal(await unread(customer), 0)
  assert.equal(await unread(agent), 2)

  await send(agent, id, 'Are you still interested?')
  assert.equal(await unread(customer), 1)
  assert.equal((await inbox(customer))[0].unreadCount, 1)
  assert.equal(await unread(agent), 2)
})

test('clearing an empty thread is a harmless no-op', { skip }, async () => {
  const id = await openThread(await listing())
  assert.equal((await clear(customer, id)).status, 200)
  await send(customer, id, 'Hello')
  assert.deepEqual(await texts(customer, id), ['Hello'])
})

test('a hidden message sent after a clear stays hidden; earlier history stays cleared', { skip }, async () => {
  const id = await openThread(await listing())
  await send(customer, id, 'Old')
  await clear(customer, id)
  const mistake = await send(customer, id, 'Typo')
  await send(customer, id, 'Fixed')
  await hide(customer, id, mistake._id)
  assert.deepEqual(await texts(customer, id), ['Fixed'])
  assert.deepEqual(await texts(agent, id), ['Old', 'Typo', 'Fixed'])
})

// ── 11. Pagination ───────────────────────────────────────────────────────

test('11a. hidden messages stay hidden across every page, with no gaps or duplicates', { skip }, async () => {
  const id = await openThread(await listing())
  const sent = []
  for (let i = 1; i <= 25; i += 1) sent.push(await send(i % 3 ? customer : agent, id, `M${i}`))

  // Hide customer messages spread through old and new pages.
  const hiddenNumbers = [1, 2, 4, 10, 11, 13, 20, 25]
  for (const n of hiddenNumbers) {
    assert.equal((await hide(customer, id, sent[n - 1]._id)).status, 200)
  }

  const expected = sent.map((m) => m.text).filter((t) => !hiddenNumbers.includes(Number(t.slice(1))))
  for (const limit of [1, 3, 5, 7]) {
    assert.deepEqual(await walkAllPages(customer, id, limit), expected, `limit ${limit}`)
  }
  assert.deepEqual(await walkAllPages(agent, id, 4), sent.map((m) => m.text))
})

test('11b. Load Older can never walk back into cleared history', { skip }, async () => {
  const id = await openThread(await listing())
  const before = []
  for (let i = 1; i <= 12; i += 1) before.push(await send(customer, id, `Old ${i}`))
  await clear(customer, id)
  for (let i = 1; i <= 7; i += 1) await send(i % 2 ? agent : customer, id, `New ${i}`)

  const expected = Array.from({ length: 7 }, (_, i) => `New ${i + 1}`)
  assert.deepEqual(await walkAllPages(customer, id, 3), expected)

  // Even a hand-built cursor pointing deep into the cleared range returns nothing old.
  const deep = await call(customer, 'GET', `/${id}/messages?before=${before[5]._id}`)
  assert.equal(deep.status, 200)
  assert.deepEqual(deep.body.messages, [])
  assert.equal(deep.body.hasMore, false)

  assert.equal((await walkAllPages(agent, id, 5)).length, 19)
})

// ── 12. Realtime and multi-device ────────────────────────────────────────

test('12. visibility changes reach only the acting user\'s own devices', { skip }, async () => {
  const id = await openThread(await listing())
  await send(customer, id, 'Hello')
  const second = await send(customer, id, 'Second')
  emits = []

  await hide(customer, id, second._id)
  await clear(customer, id)

  assert.deepEqual(emits.map((e) => e.event), ['property-message:hidden', 'property-conversation:cleared'])
  for (const emit of emits) {
    assert.deepEqual(emit.rooms, [`user:${customer._id}`])
  }
  assert.equal(emits[0].payload.messageId, String(second._id))
  assert.equal(emits[0].payload.lastMessage.text, 'Hello')
  assert.equal(emits[1].payload.conversationId, String(id))
})

test('hiding or clearing sends no push notification; a new message after clearing still does', { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  await send(customer, id, 'Again')
  pushCalls = []

  await hide(customer, id, hello._id)
  await clear(customer, id)
  assert.equal(pushCalls.length, 0)

  await send(agent, id, 'Are you still interested?')
  assert.equal(pushCalls.length, 1)
  assert.equal(pushCalls[0].senderSide, 'agent')
})

// ── 13. The agent's (website) view ───────────────────────────────────────

test("13. the agent's responses keep their exact pre-feature shape", { skip }, async () => {
  const id = await openThread(await listing())
  const hello = await send(customer, id, 'Hello')
  await send(agent, id, 'Hi')
  await hide(customer, id, hello._id)
  await clear(customer, id)

  const [row] = await inbox(agent)
  assert.deepEqual(Object.keys(row).sort(), [
    '_id', 'counterparty', 'createdAt', 'lastActivityAt', 'lastMessage', 'property', 'role', 'status', 'unreadCount',
  ])
  assert.deepEqual(Object.keys(row.lastMessage).sort(), ['at', 'sender', 'text'])
  assert.equal(row.lastMessage.text, 'Hi')

  const detail = await call(agent, 'GET', `/${id}`)
  assert.equal(detail.body.conversation.lastMessage.text, 'Hi')

  const page = await call(agent, 'GET', `/${id}/messages`)
  for (const message of page.body.messages) {
    assert.deepEqual(Object.keys(message).sort(), ['_id', 'createdAt', 'sender', 'text'])
  }
  assert.deepEqual(page.body.messages.map((m) => m.text), ['Hello', 'Hi'])

  // And the agent can keep messaging as before.
  await send(agent, id, 'Following up')
  assert.equal((await texts(agent, id)).length, 3)
})
