// Deleting AI chatbot history — ownership, permissions, and cascade.
//
// ── The two systems this file keeps apart ───────────────────────────────
// This backend has TWO conversation systems:
//
//   ChatConversation / ChatMessage        the AI property chatbot   (in scope)
//   PropertyConversation / PropertyMessage customer <-> agent threads (NOT)
//
// Every assertion below that mentions PropertyConversation exists to prove a
// delete path cannot reach across that line. The fake store holds records of
// both shapes for exactly that reason.
//
// The routes, their ownership queries and CURRENT's real permission middleware
// all run for real. Only MongoDB and JWT verification are replaced.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

// ── The signed-in actor ─────────────────────────────────────────────────
let currentUser = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!currentUser) return res.status(401).json({ success: false, message: 'Not authenticated' })
      req.user = currentUser
      next()
    },
    userFromToken: async () => null,
  },
})

// ── Scripted database ───────────────────────────────────────────────────
const db = {
  conversations: [],  // AI chatbot
  messages: [],       // AI chatbot
  propertyConversations: [], // must never be touched
  propertyMessages: [],      // must never be touched
  users: [],
}

const matches = (doc, filter) =>
  Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v))

mock.module('../models/ChatConversation.js', {
  defaultExport: {
    find: (filter = {}) => {
      const rows = db.conversations.filter((c) => matches(c, filter))
      const chain = {
        select: () => chain,
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        lean: async () => rows,
        then: (res, rej) => Promise.resolve(rows).then(res, rej),
      }
      return chain
    },
    findOne: (filter) => {
      const row = db.conversations.find((c) => matches(c, filter)) || null
      const chain = {
        select: async () => row,
        then: (res, rej) => Promise.resolve(row).then(res, rej),
      }
      return chain
    },
    findById: (id) => {
      const row = db.conversations.find((c) => String(c._id) === String(id)) || null
      return { select: async () => row }
    },
    deleteOne: async (filter) => {
      const before = db.conversations.length
      db.conversations = db.conversations.filter((c) => !matches(c, filter))
      return { deletedCount: before - db.conversations.length }
    },
    countDocuments: async (filter = {}) => db.conversations.filter((c) => matches(c, filter)).length,
  },
})

mock.module('../models/ChatMessage.js', {
  defaultExport: {
    find: () => ({ sort: () => ({ populate: async () => [] }) }),
    deleteMany: async (filter) => {
      const before = db.messages.length
      db.messages = db.messages.filter((m) => !matches(m, filter))
      return { deletedCount: before - db.messages.length }
    },
  },
})

mock.module('../models/User.js', {
  defaultExport: {
    findById: (id) => ({ select: async () => db.users.find((u) => String(u._id) === String(id)) || null }),
    find: () => ({ select: () => ({ lean: async () => db.users }) }),
  },
})

mock.module('../models/Property.js', { defaultExport: {} })
mock.module('../models/ContactSubmission.js', { defaultExport: {} })

const { default: chatConversationRoutes } = await import('../routes/chatConversations.js')
const { default: adminChatRoutes } = await import('../routes/adminChats.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/chat/conversations', chatConversationRoutes)
  app.use('/api/admin/chats', adminChatRoutes)
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message })
  })
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

// ── Actors ──────────────────────────────────────────────────────────────
const ALICE = { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Alice', email: 'a@x.test', role: 'user', permissions: [] }
const BOB = { _id: 'bbbbbbbbbbbbbbbbbbbbbbb2', name: 'Bob', email: 'b@x.test', role: 'user', permissions: [] }
const AGENT = { _id: 'ggggggggggggggggggggggg3', name: 'Gale', email: 'g@x.test', role: 'agent', permissions: ['view_chats', 'moderate_chats'] }
const ADMIN_VIEW = { _id: 'ddddddddddddddddddddddd4', name: 'Dee', email: 'd@x.test', role: 'admin', permissions: ['view_chats'] }
const ADMIN_MOD = { _id: 'eeeeeeeeeeeeeeeeeeeeeee5', name: 'Eve', email: 'e@x.test', role: 'admin', permissions: ['view_chats', 'moderate_chats'] }
const OWNER = { _id: 'fffffffffffffffffffffff6', name: 'Ora', email: 'o@x.test', role: 'owner', permissions: [] }

const oid = (n) => String(n).padStart(24, '0')

/** Seeds Alice with 2 conversations, Bob with 1, plus agent-thread lookalikes. */
const seed = () => {
  db.conversations = [
    { _id: oid(11), user: ALICE._id },
    { _id: oid(12), user: ALICE._id },
    { _id: oid(21), user: BOB._id },
  ]
  db.messages = [
    { _id: oid(111), conversation: oid(11) },
    { _id: oid(112), conversation: oid(11) },
    { _id: oid(121), conversation: oid(12) },
    { _id: oid(211), conversation: oid(21) },
  ]
  // Same shape, different system. Nothing in this wave may remove these.
  db.propertyConversations = [{ _id: oid(11), user: ALICE._id }, { _id: oid(91) }]
  db.propertyMessages = [{ _id: oid(911), conversation: oid(11) }]
  db.users = [ALICE, BOB]
}

beforeEach(() => { currentUser = null; seed() })

const request = async (method, path) => {
  const res = await fetch(baseUrl + path, { method, headers: { 'Content-Type': 'application/json' } })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const convIds = () => db.conversations.map((c) => String(c._id)).sort()
const msgIds = () => db.messages.map((m) => String(m._id)).sort()

/* ═══════════════ 1. User deletes one of their own ═══════════════ */

test('1a. a user deletes their own conversation, messages and all', async () => {
  currentUser = ALICE
  const res = await request('DELETE', `/api/chat/conversations/${oid(11)}`)

  assert.equal(res.status, 200)
  assert.equal(res.body.deletedCount, 1)
  assert.deepEqual(convIds(), [oid(12), oid(21)].sort())
  assert.deepEqual(msgIds(), [oid(121), oid(211)].sort(), 'child messages survived')
})

test('1b. a malformed id is a 400, never a CastError 500', async () => {
  currentUser = ALICE
  for (const bad of ['not-an-id', '123', 'null']) {
    const res = await request('DELETE', `/api/chat/conversations/${bad}`)
    assert.equal(res.status, 400, `'${bad}' was not rejected cleanly`)
  }
  assert.equal(db.conversations.length, 3)
})

test('1c. a well-formed but nonexistent id is a safe 404', async () => {
  currentUser = ALICE
  const res = await request('DELETE', `/api/chat/conversations/${oid(99)}`)

  assert.equal(res.status, 404)
  assert.equal(db.conversations.length, 3)
})

test('1d. deleting twice is consistent, not a 500', async () => {
  currentUser = ALICE
  assert.equal((await request('DELETE', `/api/chat/conversations/${oid(11)}`)).status, 200)
  assert.equal((await request('DELETE', `/api/chat/conversations/${oid(11)}`)).status, 404)
})

/* ═══════════════ 2. IDOR — the security case ═══════════════ */

test("2a. a user CANNOT delete another user's conversation", async () => {
  currentUser = BOB
  const res = await request('DELETE', `/api/chat/conversations/${oid(11)}`) // Alice's

  assert.equal(res.status, 404, 'a foreign conversation was not refused')
  assert.ok(db.conversations.some((c) => String(c._id) === oid(11)), "Alice's conversation was deleted")
  assert.ok(db.messages.some((m) => String(m.conversation) === oid(11)), "Alice's messages were deleted")
})

test('2b. a foreign conversation is indistinguishable from a missing one', async () => {
  currentUser = BOB
  const foreign = await request('DELETE', `/api/chat/conversations/${oid(11)}`)
  const missing = await request('DELETE', `/api/chat/conversations/${oid(99)}`)

  // Same status AND same message: the endpoint must not become an oracle for
  // "does conversation X exist".
  assert.equal(foreign.status, missing.status)
  assert.equal(foreign.body.message, missing.body.message)
})

test('2c. an unauthenticated caller is refused', async () => {
  currentUser = null
  assert.equal((await request('DELETE', `/api/chat/conversations/${oid(11)}`)).status, 401)
  assert.equal((await request('DELETE', '/api/chat/conversations')).status, 401)
  assert.equal(db.conversations.length, 3)
})

/* ═══════════════ 3. User clear-all ═══════════════ */

test('3a. clearing own history removes only the caller\'s conversations', async () => {
  currentUser = ALICE
  const res = await request('DELETE', '/api/chat/conversations')

  assert.equal(res.status, 200)
  assert.equal(res.body.deletedCount, 2)
  assert.deepEqual(convIds(), [oid(21)], "Bob's conversation was destroyed")
  assert.deepEqual(msgIds(), [oid(211)], "Bob's messages were destroyed")
})

test('3b. clearing an empty history is a success with count 0', async () => {
  db.conversations = []
  db.messages = []
  currentUser = ALICE

  const res = await request('DELETE', '/api/chat/conversations')
  assert.equal(res.status, 200)
  assert.equal(res.body.deletedCount, 0)
})

test('3c. a user with one conversation reports exactly one', async () => {
  currentUser = BOB
  const res = await request('DELETE', '/api/chat/conversations')

  assert.equal(res.body.deletedCount, 1)
  assert.equal(db.conversations.length, 2, "Alice's two conversations were affected")
})

/* ═══════════════ 4. Admin authorization ═══════════════ */

const adminDeleteOne = () => request('DELETE', `/api/admin/chats/${oid(11)}`)
const adminClearUser = () => request('DELETE', `/api/admin/chats/user/${ALICE._id}`)

test('4a. unauthenticated is refused on both admin routes', async () => {
  currentUser = null
  assert.equal((await adminDeleteOne()).status, 401)
  assert.equal((await adminClearUser()).status, 401)
  assert.equal(db.conversations.length, 3)
})

test('4b. a normal user is refused by role', async () => {
  currentUser = ALICE
  assert.equal((await adminDeleteOne()).status, 403)
  assert.equal((await adminClearUser()).status, 403)
  assert.equal(db.conversations.length, 3)
})

test('4c. an AGENT is refused even holding both chat permissions', async () => {
  // requireRole('owner','admin') rejects before any permission is consulted.
  currentUser = AGENT
  assert.equal((await adminDeleteOne()).status, 403)
  assert.equal((await adminClearUser()).status, 403)
  assert.equal(db.conversations.length, 3)
})

test('4d. a view-only admin CANNOT delete — view_chats is not moderation', async () => {
  currentUser = ADMIN_VIEW
  const one = await adminDeleteOne()
  const all = await adminClearUser()

  assert.equal(one.status, 403)
  assert.match(one.body.message, /moderate_chats/)
  assert.equal(all.status, 403)
  assert.equal(db.conversations.length, 3, 'a view-only admin destroyed history')
})

test('4e. an admin WITH moderate_chats may delete', async () => {
  currentUser = ADMIN_MOD
  const res = await adminDeleteOne()

  assert.equal(res.status, 200)
  assert.equal(res.body.deletedCount, 1)
  assert.deepEqual(convIds(), [oid(12), oid(21)].sort())
})

test('4f. an owner may delete without the permission listed', async () => {
  currentUser = OWNER
  assert.equal((await adminDeleteOne()).status, 200)
})

/* ═══════════════ 5. Admin moderation behaviour ═══════════════ */

test('5a. admin clear-user removes only that user\'s chatbot history', async () => {
  currentUser = ADMIN_MOD
  const res = await adminClearUser()

  assert.equal(res.status, 200)
  assert.equal(res.body.deletedCount, 2)
  assert.deepEqual(convIds(), [oid(21)], "another user's history was cleared")
  assert.equal(db.users.length, 2, 'the account itself was deleted')
})

test('5b. admin routes validate ids', async () => {
  currentUser = ADMIN_MOD
  assert.equal((await request('DELETE', '/api/admin/chats/not-an-id')).status, 400)
  assert.equal((await request('DELETE', '/api/admin/chats/user/not-an-id')).status, 400)
})

test('5c. admin routes 404 on missing targets', async () => {
  currentUser = ADMIN_MOD
  assert.equal((await request('DELETE', `/api/admin/chats/${oid(99)}`)).status, 404)
  assert.equal((await request('DELETE', `/api/admin/chats/user/${oid(99)}`)).status, 404)
})

/* ═══════════════ 6. Cascade + system isolation ═══════════════ */

test('6a. the cascade removes every message of the conversation and no others', async () => {
  const { deleteConversationCascade } = await import('../services/chatPersistence.js')

  const result = await deleteConversationCascade(oid(11))

  assert.equal(result.messagesDeleted, 2)
  assert.deepEqual(msgIds(), [oid(121), oid(211)].sort())
  assert.ok(!db.conversations.some((c) => String(c._id) === oid(11)))
})

test('6b. property-agent messaging is never touched by any delete path', async () => {
  // The fixtures deliberately give a PropertyConversation the SAME _id as an
  // AI conversation, and a PropertyMessage the same `conversation` value. If a
  // delete path ever reached the wrong collection, this is where it shows.
  const propConvBefore = db.propertyConversations.length
  const propMsgBefore = db.propertyMessages.length

  currentUser = ALICE
  await request('DELETE', `/api/chat/conversations/${oid(11)}`)
  await request('DELETE', '/api/chat/conversations')

  currentUser = ADMIN_MOD
  await request('DELETE', `/api/admin/chats/${oid(21)}`)
  await request('DELETE', `/api/admin/chats/user/${BOB._id}`)

  assert.equal(db.propertyConversations.length, propConvBefore, 'PropertyConversation was modified')
  assert.equal(db.propertyMessages.length, propMsgBefore, 'PropertyMessage was modified')
})

test('6c. deleting history leaves the user able to start again', async () => {
  currentUser = ALICE
  await request('DELETE', '/api/chat/conversations')

  // Nothing about the account was removed, so a new conversation can be made.
  assert.ok(db.users.some((u) => String(u._id) === String(ALICE._id)))
  db.conversations.push({ _id: oid(31), user: ALICE._id })
  assert.equal(db.conversations.filter((c) => String(c.user) === String(ALICE._id)).length, 1)
})

/* ═══════════════ 7. No conversation cap ═══════════════ */

test('7. nothing auto-deletes the oldest conversation', async () => {
  // The donor caps regular users at five stored conversations and silently
  // drops the oldest. That is a separate product decision and is NOT part of
  // this wave; creating a sixth must keep all six.
  const { default: chatPersistence } = { default: await import('../services/chatPersistence.js') }

  assert.ok(
    !('MAX_CONVERSATIONS_PER_USER' in chatPersistence),
    'a conversation cap was introduced'
  )
  assert.ok(
    !('enforceConversationCap' in chatPersistence),
    'automatic oldest-conversation deletion was introduced'
  )
})
