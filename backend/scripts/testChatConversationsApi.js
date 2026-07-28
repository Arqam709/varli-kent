// backend/scripts/testChatConversationsApi.js
//
// Verification for the new user-owned conversation read APIs
// (routes/chatConversations.js). Boots the real, unmodified chat,
// chatConversations, and adminChats routers in-process, signs real JWTs for
// existing accounts (no user documents are modified), and drives every case
// from the approved test matrix over real HTTP. Not part of the app.
//
// Usage: node scripts/testChatConversationsApi.js

import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import Property from '../models/Property.js'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import chatRoutes from '../routes/chat.js'
import chatConversationRoutes from '../routes/chatConversations.js'
import adminChatRoutes from '../routes/adminChats.js'

dotenv.config()

const line = () => console.log('='.repeat(70))
const check = (label, pass) => console.log(`${pass ? '✓' : '✗'} ${label}`)

const run = async () => {
  await connectDB()

  const users = await User.find().limit(2)
  const owner = await User.findOne({ role: 'owner' })

  if (users.length < 2 || !owner) {
    console.log('Need at least 2 users and 1 owner-role user — found fewer. Aborting.')
    await mongoose.disconnect()
    process.exit(0)
  }

  const [userA, userB] = users
  const sampleProperties = await Property.find().limit(2)

  console.log(`User A: ${userA.name} <${userA.email}>`)
  console.log(`User B: ${userB.name} <${userB.email}>`)
  console.log(`Owner:  ${owner.name} <${owner.email}>`)
  console.log(`Sample properties available for population: ${sampleProperties.length}`)

  const tokenA = jwt.sign({ id: userA._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })
  const ownerToken = jwt.sign({ id: owner._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })

  const app = express()
  app.use(express.json())
  app.use('/api/chat', chatRoutes)
  app.use('/api/chat/conversations', chatConversationRoutes)
  app.use('/api/admin/chats', adminChatRoutes)
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
  })

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const chatBase = `http://127.0.0.1:${server.address().port}/api/chat`
  const convBase = `${chatBase}/conversations`
  const adminBase = `http://127.0.0.1:${server.address().port}/api/admin/chats`

  const get = async (url, token) => {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }

  const post = async (url, body, token) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }

  // ── Setup: controlled test data ──────────────────────────────────────────
  line()
  console.log('SETUP: creating controlled test conversations')
  line()

  const activeConv = await ChatConversation.create({
    user: userA._id,
    status: 'active',
    messageCount: 2,
    lastMessage: { text: 'Reply for active test conversation', role: 'assistant', at: new Date() },
  })
  await ChatMessage.insertMany([
    { conversation: activeConv._id, role: 'user', text: 'Show me apartments', pageKey: 'properties' },
    {
      conversation: activeConv._id,
      role: 'assistant',
      text: 'Reply for active test conversation',
      pageKey: 'properties',
      event: 'properties_shown',
      propertyIds: sampleProperties.map((p) => p._id),
    },
  ])

  const archivedConv = await ChatConversation.create({
    user: userA._id,
    status: 'archived',
    messageCount: 2,
    lastMessage: { text: 'Reply for archived test conversation', role: 'assistant', at: new Date() },
  })
  await ChatMessage.insertMany([
    { conversation: archivedConv._id, role: 'user', text: 'Old search', pageKey: 'properties' },
    { conversation: archivedConv._id, role: 'assistant', text: 'Reply for archived test conversation', pageKey: 'properties' },
  ])

  const foreignConv = await ChatConversation.create({ user: userB._id, status: 'active', messageCount: 0 })

  console.log(`Active conversation:   ${activeConv._id}`)
  console.log(`Archived conversation:  ${archivedConv._id}`)
  console.log(`Foreign (user B) conversation: ${foreignConv._id}`)

  // ── A: no token ──────────────────────────────────────────────────────────
  line()
  console.log('TEST A: no token')
  line()

  const noTokenList = await get(convBase, null)
  const noTokenDetail = await get(`${convBase}/${activeConv._id}`, null)

  check('GET /api/chat/conversations with no token -> 401', noTokenList.status === 401)
  check('GET /api/chat/conversations/:id with no token -> 401', noTokenDetail.status === 401)

  // ── B: list endpoint ─────────────────────────────────────────────────────
  line()
  console.log('TEST B: list endpoint')
  line()

  const listAll = await get(`${convBase}?status=all`, tokenA)
  const ownRows = listAll.json?.conversations || []

  check('200 for a logged-in user', listAll.status === 200)
  check(
    'Only user A\'s own conversations are returned (no "user" field to check against, verified by presence of both known ids and absence of the foreign one)',
    ownRows.some((c) => c._id === String(activeConv._id)) &&
      ownRows.some((c) => c._id === String(archivedConv._id)) &&
      !ownRows.some((c) => c._id === String(foreignConv._id))
  )
  check(
    'Newest activity first',
    ownRows.every((c, i) => i === 0 || new Date(c.lastActivityAt) <= new Date(ownRows[i - 1].lastActivityAt))
  )
  check('No transcript included in list rows', ownRows.every((c) => c.messages === undefined))
  check('No "user" key leaked into rows', ownRows.every((c) => c.user === undefined))

  const listDefaults = await get(convBase, tokenA)
  check('Default page is 1', listDefaults.json?.pagination?.page === 1)
  check('Default limit is 20', listDefaults.json?.pagination?.limit === 20)

  const invalidPage = await get(`${convBase}?page=-3`, tokenA)
  check('Invalid page falls back to 1', invalidPage.json?.pagination?.page === 1)

  const overLimit = await get(`${convBase}?limit=999`, tokenA)
  check('Limit above 50 clamps to 50', overLimit.json?.pagination?.limit === 50)

  const activeOnly = await get(`${convBase}?status=active`, tokenA)
  const archivedOnly = await get(`${convBase}?status=archived`, tokenA)
  const allStatus = await get(`${convBase}?status=all`, tokenA)

  check('status=active returns only active rows', (activeOnly.json?.conversations || []).every((c) => c.status === 'active'))
  check('status=archived returns only archived rows', (archivedOnly.json?.conversations || []).every((c) => c.status === 'archived'))
  check(
    'status=all returns both',
    (allStatus.json?.conversations || []).some((c) => c.status === 'active') &&
      (allStatus.json?.conversations || []).some((c) => c.status === 'archived')
  )

  // ── C: detail endpoint ───────────────────────────────────────────────────
  line()
  console.log('TEST C: detail endpoint')
  line()

  const detail = await get(`${convBase}/${activeConv._id}`, tokenA)
  const messages = detail.json?.messages || []

  check('200 for an owned conversation', detail.status === 200)
  check('Returned id matches', detail.json?.conversation?._id === String(activeConv._id))
  check(
    'Messages are chronological',
    messages.every((m, i) => i === 0 || new Date(m.createdAt) >= new Date(messages[i - 1].createdAt))
  )
  const assistantMsg = messages.find((m) => m.role === 'assistant')
  check(
    'Assistant message properties populated with lightweight fields',
    Boolean(assistantMsg) &&
      (sampleProperties.length === 0 ||
        (assistantMsg.properties.length > 0 && 'title' in assistantMsg.properties[0] && !('description' in assistantMsg.properties[0])))
  )
  check('User messages have properties: []', messages.filter((m) => m.role === 'user').every((m) => Array.isArray(m.properties) && m.properties.length === 0))
  check('Raw propertyIds not exposed', messages.every((m) => !('propertyIds' in m)))
  check('No populated "user" object on the conversation', detail.json?.conversation?.user === undefined)

  // ── D: invalid/foreign ids ───────────────────────────────────────────────
  line()
  console.log('TEST D: invalid/foreign ids')
  line()

  const malformed = await get(`${convBase}/not-a-valid-id`, tokenA)
  const missingId = new mongoose.Types.ObjectId().toString()
  const missing = await get(`${convBase}/${missingId}`, tokenA)
  const foreign = await get(`${convBase}/${foreignConv._id}`, tokenA)

  check('Malformed id -> 400', malformed.status === 400 && malformed.json?.message === 'Invalid conversation id')
  check('Valid but missing id -> 404', missing.status === 404 && missing.json?.message === 'Conversation not found')
  check("Another user's real conversation id -> 404 (no leak)", foreign.status === 404 && foreign.json?.message === 'Conversation not found')

  // ── E: continue compatibility ────────────────────────────────────────────
  line()
  console.log('TEST E: continue an old conversation loaded via GET, through the existing POST /api/chat contract')
  line()

  const loaded = await get(`${convBase}/${activeConv._id}`, tokenA)
  const countBeforeFollowUp = loaded.json?.conversation?.messageCount
  const totalConversationsBefore = await ChatConversation.countDocuments({ user: userA._id })

  const followUp = await post(chatBase, { message: 'any with a garden?', pageKey: 'properties', conversationId: String(activeConv._id) }, tokenA)

  const convAfterFollowUp = await ChatConversation.findById(activeConv._id)
  const totalConversationsAfter = await ChatConversation.countDocuments({ user: userA._id })

  check('POST succeeded', followUp.status === 200)
  check('Same conversationId returned', followUp.json?.conversationId === String(activeConv._id))
  check('messageCount increased', convAfterFollowUp.messageCount > countBeforeFollowUp)
  check('No new conversation was created', totalConversationsAfter === totalConversationsBefore)

  // ── F: admin regression ──────────────────────────────────────────────────
  line()
  console.log('TEST F: admin API regression (routes/adminChats.js unmodified)')
  line()

  const adminList = await get(`${adminBase}?status=all`, ownerToken)
  const adminDetail = await get(`${adminBase}/${activeConv._id}`, ownerToken)

  check('GET /api/admin/chats still returns 200', adminList.status === 200)
  check('GET /api/admin/chats/:id still returns 200', adminDetail.status === 200)
  check('Admin detail still populates user info', Boolean(adminDetail.json?.conversation?.user?.email))
  check('Admin detail still populates properties', (adminDetail.json?.messages || []).some((m) => m.properties?.length > 0) || sampleProperties.length === 0)

  // Cleanup: archive (not delete) every conversation this script created.
  await ChatConversation.updateMany(
    { _id: { $in: [activeConv._id, archivedConv._id, foreignConv._id] } },
    { $set: { status: 'archived' } }
  )

  console.log('')
  line()
  console.log('Done. All conversations created by this script were archived, not deleted.')
  line()

  server.close()
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
