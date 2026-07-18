// backend/scripts/testChatRouteIntegration.js
//
// Temporary manual integration test for the persistence wiring inside
// routes/chat.js. Boots the real, unmodified chat router in an isolated
// in-process Express server on an ephemeral port, signs a real JWT for an
// existing user, and drives a short multi-turn conversation over HTTP
// exactly like the frontend would. Not part of the app.
//
// Usage: node scripts/testChatRouteIntegration.js

import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import chatRoutes from '../routes/chat.js'

dotenv.config()

const line = () => console.log('='.repeat(70))

const run = async () => {
  await connectDB()

  const user = await User.findOne()

  if (!user) {
    console.log('No User documents exist — cannot run this test.')
    await mongoose.disconnect()
    process.exit(0)
  }

  console.log(`Using user: ${user.name} <${user.email}> (${user._id})`)

  // Archive (not delete) any leftover active conversation from a previous
  // test run, so this run gets a clean slate for backfill/creation checks.
  // Nothing is removed — just a status flip, still fully inspectable.
  const archived = await ChatConversation.updateMany(
    { user: user._id, status: 'active' },
    { $set: { status: 'archived', archivedAt: new Date() } }
  )
  if (archived.modifiedCount > 0) {
    console.log(`Archived ${archived.modifiedCount} leftover active conversation(s) for a clean slate.`)
  }

  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })

  const app = express()
  app.use(express.json())
  app.use('/api/chat', chatRoutes)

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/chat`

  const send = async (message, extra = {}) => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, pageKey: 'properties', ...extra }),
    })
    return res.json()
  }

  line()
  console.log('TURN 1: greeting')
  line()

  const turn1Message = 'hello'
  const turn1 = await send(turn1Message)
  console.log('Reply:', turn1.reply)

  let conversation = await ChatConversation.findOne({ user: user._id, status: 'active' })
  console.log(`Active conversation after turn 1: ${conversation ? conversation._id : 'none'}`)

  line()
  console.log('TURN 2: real property search')
  line()

  const historyAfterTurn1 = [
    { role: 'user', text: turn1Message },
    { role: 'assistant', text: turn1.reply },
  ]

  const turn2Message = 'Show me apartments for sale in Beylikduzu'
  const turn2 = await send(turn2Message, {
    history: [...historyAfterTurn1, { role: 'user', text: turn2Message }],
  })
  console.log('Reply:', turn2.reply)
  console.log('Properties returned:', (turn2.properties || []).length)

  conversation = await ChatConversation.findOne({ user: user._id, status: 'active' })
  console.log(`Active conversation after turn 2: ${conversation ? conversation._id : 'MISSING'}`)

  line()
  console.log('TURN 3: plain follow-up (conversation already active)')
  line()

  const historyAfterTurn2 = [
    ...historyAfterTurn1,
    { role: 'user', text: turn2Message },
    { role: 'assistant', text: turn2.reply },
  ]

  const turn3Message = 'thanks!'
  const turn3 = await send(turn3Message, {
    history: [...historyAfterTurn2, { role: 'user', text: turn3Message }],
    currentFilters: turn2.parsed,
  })
  console.log('Reply:', turn3.reply)

  console.log('')
  line()
  console.log('DATABASE STATE')
  line()

  conversation = await ChatConversation.findOne({ user: user._id, status: 'active' })
  const messages = conversation
    ? await ChatMessage.find({ conversation: conversation._id }).sort({ createdAt: 1 })
    : []

  console.log(`Conversation id: ${conversation?._id}`)
  console.log(`messageCount:    ${conversation?.messageCount}`)
  console.log(`lastMessage:     ${JSON.stringify(conversation?.lastMessage)}`)
  console.log('')

  messages.forEach((m, i) => {
    console.log(
      `[${i}] ${m.role} | event=${m.event} | pageKey=${m.pageKey} | propertyIds=${m.propertyIds.length} | ` +
        `text="${m.text.slice(0, 60)}"`
    )
  })

  console.log('')
  line()
  console.log('VERIFICATION')
  line()

  const hasBackfilledGreeting = messages.some((m) => m.role === 'user' && m.text === turn1Message)
  console.log(`${hasBackfilledGreeting ? '✓' : '✗'} Turn 1 greeting was backfilled once turn 2 triggered persistence`)

  const turn2SearchEventRecorded = messages.some(
    (m) => m.role === 'assistant' && (m.event === 'properties_shown' || m.event === 'no_results')
  )
  console.log(`${turn2SearchEventRecorded ? '✓' : '✗'} Turn 2 search recorded with a search event (properties_shown/no_results)`)

  const turn2PropertyIdsStored =
    (turn2.properties || []).length === 0 ||
    messages.some((m) => m.role === 'assistant' && m.event === 'properties_shown' && m.propertyIds.length > 0)
  console.log(`${turn2PropertyIdsStored ? '✓' : '✗'} propertyIds stored on the assistant message when properties were shown`)

  const turn3Persisted = messages.some((m) => m.role === 'user' && m.text === turn3Message)
  console.log(`${turn3Persisted ? '✓' : '✗'} Turn 3 (plain small talk) still saved, because the conversation was already active`)

  const noDuplicateGreeting = messages.filter((m) => m.role === 'user' && m.text === turn1Message).length === 1
  console.log(`${noDuplicateGreeting ? '✓' : '✗'} No duplicate history — greeting appears exactly once, not re-inserted on later turns`)

  const messageCountCorrect = Boolean(conversation) && conversation.messageCount === messages.length
  console.log(`${messageCountCorrect ? '✓' : '✗'} messageCount matches actual saved messages (${conversation?.messageCount} === ${messages.length})`)

  console.log('')
  console.log('Reply text returned to the client (should read exactly as before this change):')
  console.log(`  turn1: "${turn1.reply}"`)
  console.log(`  turn2: "${turn2.reply}"`)
  console.log(`  turn3: "${turn3.reply}"`)

  console.log('')
  line()
  console.log('No documents were deleted. Conversation id above is available for inspection in Compass.')
  line()

  server.close()
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
