// backend/scripts/testChatPersistenceMulti.js
//
// Isolated verification of the redesigned recordChatExchange() — the
// conversationId-driven contract (multiple independent conversations per
// user, ownership-checked appends, fail-closed on foreign/malformed ids).
// No HTTP, no chat.js involvement. Not part of the app.
//
// Usage: node scripts/testChatPersistenceMulti.js

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import { recordChatExchange } from '../services/chatPersistence.js'

dotenv.config()

const line = () => console.log('='.repeat(70))
const check = (label, pass) => console.log(`${pass ? '✓' : '✗'} ${label}`)

const run = async () => {
  await connectDB()

  const users = await User.find().limit(2)

  if (users.length < 2) {
    console.log('Need at least 2 User documents to test foreign-ownership rejection — found fewer. Aborting.')
    await mongoose.disconnect()
    process.exit(0)
  }

  const [userA, userB] = users
  console.log(`User A (owner):  ${userA.name} <${userA.email}>`)
  console.log(`User B (foreign): ${userB.name} <${userB.email}>`)

  // ── A: conversationId null + non-meaningful event ──────────────────────
  line()
  console.log('TEST A: conversationId null + non-meaningful event')
  line()

  const countBefore = await ChatConversation.countDocuments({ user: userA._id })

  const resultA = await recordChatExchange({
    userId: userA._id,
    conversationId: null,
    pageKey: 'properties',
    userMessageText: 'hi',
    assistantReplyText: 'Hello! How can I help?',
    propertyIds: [],
    event: null,
    history: [],
    lead: null,
    parsed: null,
  })

  console.log('Result:', JSON.stringify(resultA))

  const countAfterA = await ChatConversation.countDocuments({ user: userA._id })

  check('persisted: false', resultA.persisted === false)
  check('conversationId: null', resultA.conversationId === null)
  check('error: false', resultA.error === false)
  check('No conversation was created', countAfterA === countBefore)

  // ── B: conversationId null + meaningful event ───────────────────────────
  line()
  console.log('TEST B: conversationId null + meaningful event')
  line()

  const history = [
    { role: 'user', text: 'Hello' },
    { role: 'assistant', text: 'Hi, how can I help?' },
  ]

  const resultB = await recordChatExchange({
    userId: userA._id,
    conversationId: null,
    pageKey: 'properties',
    userMessageText: 'Show me apartments in Beylikduzu',
    assistantReplyText: 'I found two apartments.',
    propertyIds: [],
    event: 'properties_shown',
    history,
    lead: null,
    parsed: null,
  })

  console.log('Result:', JSON.stringify(resultB))

  const conversationId = resultB.conversationId
  const conversationAfterB = await ChatConversation.findById(conversationId)
  const messagesAfterB = await ChatMessage.find({ conversation: conversationId }).sort({ createdAt: 1 })

  check('persisted: true', resultB.persisted === true)
  check('New conversationId returned', Boolean(conversationId))
  check('History backfilled once (4 messages total)', messagesAfterB.length === 4)
  check('messageCount matches (4)', conversationAfterB.messageCount === 4)
  check(
    'Backfilled + current messages in correct order',
    messagesAfterB[0].text === 'Hello' &&
      messagesAfterB[1].text === 'Hi, how can I help?' &&
      messagesAfterB[2].text === 'Show me apartments in Beylikduzu' &&
      messagesAfterB[3].text === 'I found two apartments.'
  )

  // ── C: owned conversationId + event null ────────────────────────────────
  line()
  console.log('TEST C: owned conversationId + event: null (no gate, no re-backfill)')
  line()

  const resultC = await recordChatExchange({
    userId: userA._id,
    conversationId,
    pageKey: 'properties',
    userMessageText: 'thanks!',
    assistantReplyText: "You're welcome!",
    propertyIds: [],
    event: null,
    history, // deliberately resent, as the real frontend does every turn
    lead: null,
    parsed: null,
  })

  console.log('Result:', JSON.stringify(resultC))

  const conversationAfterC = await ChatConversation.findById(conversationId)
  const messagesAfterC = await ChatMessage.find({ conversation: conversationId }).sort({ createdAt: 1 })
  const conversationCountForUserA = await ChatConversation.countDocuments({ user: userA._id })

  check('persisted: true', resultC.persisted === true)
  check('Same conversationId returned', resultC.conversationId === conversationId)
  check('Appended despite non-meaningful event (6 messages total)', messagesAfterC.length === 6)
  check('No re-backfill occurred (exactly 2 new messages, not more)', messagesAfterC.length === messagesAfterB.length + 2)
  check('messageCount matches (6)', conversationAfterC.messageCount === 6)
  check('No second conversation was created for user A', conversationCountForUserA === countAfterA + 1)

  // ── D: foreign user's conversationId ────────────────────────────────────
  line()
  console.log("TEST D: user B attempts to send into user A's conversation")
  line()

  const resultD = await recordChatExchange({
    userId: userB._id,
    conversationId,
    pageKey: 'properties',
    userMessageText: 'trying to hijack this conversation',
    assistantReplyText: 'this should never be written',
    propertyIds: [],
    event: null,
    history: [],
    lead: null,
    parsed: null,
  })

  console.log('Result:', JSON.stringify(resultD))

  const messagesAfterD = await ChatMessage.find({ conversation: conversationId })
  const conversationCountForUserB = await ChatConversation.countDocuments({ user: userB._id })

  check('persisted: false', resultD.persisted === false)
  check('conversationId: null', resultD.conversationId === null)
  check('error: true', resultD.error === true)
  check("reason: 'conversation_not_found'", resultD.reason === 'conversation_not_found')
  check("User A's conversation was NOT appended to (still 6 messages)", messagesAfterD.length === 6)
  check('No replacement conversation was created for user B', conversationCountForUserB === 0)

  // ── E: malformed conversationId ─────────────────────────────────────────
  line()
  console.log('TEST E: malformed conversationId')
  line()

  const resultE = await recordChatExchange({
    userId: userA._id,
    conversationId: 'not-a-valid-object-id',
    pageKey: 'properties',
    userMessageText: 'this should fail safely',
    assistantReplyText: 'this should never be written',
    propertyIds: [],
    event: null,
    history: [],
    lead: null,
    parsed: null,
  })

  console.log('Result:', JSON.stringify(resultE))

  const conversationCountForUserAFinal = await ChatConversation.countDocuments({ user: userA._id })

  check('persisted: false', resultE.persisted === false)
  check('conversationId: null', resultE.conversationId === null)
  check('error: true', resultE.error === true)
  check("reason: 'conversation_not_found'", resultE.reason === 'conversation_not_found')
  check('No new conversation was created for user A', conversationCountForUserAFinal === conversationCountForUserA)

  // Archive (not delete) the one real test conversation this script created.
  // (archivedAt is not a schema field on ChatConversation — status alone.)
  await ChatConversation.findByIdAndUpdate(conversationId, { status: 'archived' })

  console.log('')
  line()
  console.log(`Done. Test conversation ${conversationId} archived (not deleted) — available for inspection.`)
  line()

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
