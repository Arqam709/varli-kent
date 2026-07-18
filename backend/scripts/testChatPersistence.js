// backend/scripts/testChatPersistence.js
//
// Temporary manual test script for services/chatPersistence.js. Not part of
// the chatbot flow — exercises recordChatExchange() directly against the
// real database, with no involvement from chat.js, ChatContext.jsx, or the
// lead flow, before this service is wired into anything live.
//
// Usage: node scripts/testChatPersistence.js

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import { recordChatExchange } from '../services/chatPersistence.js'

dotenv.config()

const line = () => console.log('='.repeat(70))

const TEST_HISTORY = [
  { role: 'user', text: 'Hello' },
  { role: 'assistant', text: 'Hi, how can I help?' },
]

const TEST_USER_MESSAGE = 'Show me apartments in Beylikdüzü'
const TEST_ASSISTANT_REPLY = 'I found two apartments.'

const run = async () => {
  await connectDB()

  line()
  console.log('STEP 1: Find an existing user')
  line()

  const user = await User.findOne()

  if (!user) {
    console.log('No User documents exist in this database — nothing to test against.')
    console.log('Create a user first (e.g. via signup or scripts/createOwner.js), then re-run this script.')
    await mongoose.disconnect()
    process.exit(0)
  }

  console.log(`Using user: ${user.name} <${user.email}> (${user._id})`)

  console.log('')
  line()
  console.log('STEP 2: Check for a pre-existing active conversation (before calling recordChatExchange)')
  line()

  const beforeConversation = await ChatConversation.findOne({ user: user._id, status: 'active' })

  if (beforeConversation) {
    console.log(`An active conversation ALREADY exists for this user: ${beforeConversation._id}`)
    console.log('(Likely left over from a previous run of this script — backfill will be skipped this time,')
    console.log(' since backfill only ever happens once, at conversation creation.)')
  } else {
    console.log('No active conversation exists yet for this user — this call should create one.')
  }

  console.log('')
  line()
  console.log('STEP 3: Call recordChatExchange()')
  line()

  const result = await recordChatExchange({
    userId: user._id,
    pageKey: 'properties',
    userMessageText: TEST_USER_MESSAGE,
    assistantReplyText: TEST_ASSISTANT_REPLY,
    propertyIds: [],
    event: 'properties_shown',
    history: TEST_HISTORY,
    lead: null,
    parsed: null,
  })

  console.log('Return value:')
  console.log(JSON.stringify(result, null, 2))

  console.log('')
  line()
  console.log('STEP 4: Query ChatConversation')
  line()

  let conversation = null

  if (result.conversationId) {
    conversation = await ChatConversation.findById(result.conversationId)
  }

  if (!conversation) {
    console.log('No conversation document found — nothing further to inspect.')
  } else {
    console.log(`Conversation created?  yes`)
    console.log(`Conversation id:       ${conversation._id}`)
    console.log(`messageCount:          ${conversation.messageCount}`)
    console.log(`lastMessage:           ${JSON.stringify(conversation.lastMessage)}`)
    console.log(`lastActivityAt:        ${conversation.lastActivityAt}`)
  }

  console.log('')
  line()
  console.log('STEP 5: Query ChatMessage (chronological order)')
  line()

  const messages = conversation
    ? await ChatMessage.find({ conversation: conversation._id }).sort({ createdAt: 1 })
    : []

  messages.forEach((msg, index) => {
    console.log(`[${index}] role=${msg.role}`)
    console.log(`     text:        ${msg.text}`)
    console.log(`     createdAt:   ${msg.createdAt.toISOString()}`)
    console.log(`     event:       ${msg.event}`)
    console.log(`     pageKey:     ${msg.pageKey}`)
    console.log(`     propertyIds: ${JSON.stringify(msg.propertyIds)}`)
  })

  console.log('')
  line()
  console.log('VERIFICATION')
  line()

  const conversationCreated = result.persisted === true && Boolean(result.conversationId)
  console.log(`${conversationCreated ? '✓' : '✗'} Conversation was created/used (persisted: true, conversationId present)`)

  if (beforeConversation) {
    console.log('N/A History backfilled — an active conversation already existed before this run, so backfill was correctly skipped')
  } else {
    const historyBackfilled = TEST_HISTORY.every((entry) =>
      messages.some((msg) => msg.role === entry.role && msg.text === entry.text)
    )
    console.log(`${historyBackfilled ? '✓' : '✗'} History was backfilled (both prior turns found among saved messages)`)
  }

  const lastTwo = messages.slice(-2)
  const currentExchangeAppended =
    lastTwo.length === 2 &&
    lastTwo[0].role === 'user' &&
    lastTwo[0].text === TEST_USER_MESSAGE &&
    lastTwo[1].role === 'assistant' &&
    lastTwo[1].text === TEST_ASSISTANT_REPLY

  console.log(`${currentExchangeAppended ? '✓' : '✗'} Current exchange was appended (last two messages match the call's input)`)

  const messageCountCorrect = Boolean(conversation) && conversation.messageCount === messages.length
  console.log(`${messageCountCorrect ? '✓' : '✗'} messageCount is correct (${conversation?.messageCount} === ${messages.length} actual messages)`)

  const lastMessageCorrect =
    Boolean(conversation) &&
    conversation.lastMessage?.text === TEST_ASSISTANT_REPLY &&
    conversation.lastMessage?.role === 'assistant'

  console.log(`${lastMessageCorrect ? '✓' : '✗'} lastMessage matches the assistant reply just sent`)

  const messagesOrdered = messages.every((msg, index) => {
    if (index === 0) return true
    return msg.createdAt.getTime() >= messages[index - 1].createdAt.getTime()
  })

  console.log(`${messagesOrdered ? '✓' : '✗'} Messages are in chronological order`)

  console.log('')
  line()
  console.log('Done. No documents were deleted — inspect them in MongoDB Compass.')
  console.log(`Conversation id: ${conversation?._id}`)
  line()

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
