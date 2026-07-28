import mongoose from 'mongoose'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'

export const MEANINGFUL_EVENTS = [
  'property_search',
  'properties_shown',
  'clarification_requested',
  'lead_flow_started',
  'lead_captured',
  'no_results',
  'error',
]

const VALID_ROLES = ['user', 'assistant']

// Drops the current user message if the client already included it as the
// last history entry, keeps only valid roles with non-empty text, and
// leaves ordering untouched (callers already send history oldest-first).
const sanitizeHistory = (history, currentUserMessageText) => {
  if (!Array.isArray(history) || history.length === 0) return []

  let entries = history
  const last = entries[entries.length - 1]

  if (last && last.role === 'user' && last.text === currentUserMessageText) {
    entries = entries.slice(0, -1)
  }

  return entries
    .filter(
      (entry) =>
        entry &&
        VALID_ROLES.includes(entry.role) &&
        typeof entry.text === 'string' &&
        entry.text.trim().length > 0
    )
    .map((entry) => ({ role: entry.role, text: entry.text }))
}

const createConversationWithBackfill = async (userId, history, userMessageText) => {
  const conversation = await ChatConversation.create({ user: userId, status: 'active' })

  const sanitized = sanitizeHistory(history, userMessageText)

  const backfillDocs = sanitized.map((entry, index) => ({
    conversation: conversation._id,
    role: entry.role,
    text: entry.text,
    pageKey: null,
    // 1ms apart, oldest first, so chronological order survives a single
    // bulk insert done "all at once" right now.
    createdAt: new Date(Date.now() + index),
  }))

  if (backfillDocs.length > 0) {
    await ChatMessage.insertMany(backfillDocs)
  }

  return { conversation, backfillCount: backfillDocs.length }
}

const appendExchange = async (
  conversationId,
  { userMessageText, assistantReplyText, propertyIds, pageKey, event }
) => {
  const now = Date.now()

  const docs = [
    {
      conversation: conversationId,
      role: 'user',
      text: userMessageText,
      pageKey: pageKey ?? null,
      createdAt: new Date(now),
    },
    {
      conversation: conversationId,
      role: 'assistant',
      text: assistantReplyText,
      propertyIds,
      pageKey: pageKey ?? null,
      event,
      createdAt: new Date(now + 1),
    },
  ]

  await ChatMessage.insertMany(docs)
  return docs.length
}

export const isMeaningfulExchange = ({ event }) => MEANINGFUL_EVENTS.includes(event)

export const recordChatExchange = async ({
  userId,
  conversationId = null,
  pageKey = null,
  userMessageText,
  assistantReplyText,
  propertyIds = [],
  event = null,
  history = [],
  lead = null,
  // Reserved for future analytics use only. Intentionally not saved anywhere
  // yet — no schema field for it, do not persist it in this function.
  parsed = null,
}) => {
  try {
    let conversation
    let insertedCount = 0

    if (conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return { persisted: false, conversationId: null, error: true, reason: 'conversation_not_found' }
      }

      // Ownership is baked into the query itself, not a separate
      // fetch-then-compare step. Status is never filtered on — an archived
      // conversation must remain just as resumable as an active one.
      conversation = await ChatConversation.findOne({ _id: conversationId, user: userId })

      if (!conversation) {
        return { persisted: false, conversationId: null, error: true, reason: 'conversation_not_found' }
      }

      // A real, owned conversation was supplied — always append. No
      // meaningful-event gate (that only ever existed to decide whether to
      // start persisting at all) and no backfill (its prior messages are
      // already persisted from earlier turns).
    } else {
      if (!isMeaningfulExchange({ event })) {
        return { persisted: false, conversationId: null, error: false }
      }

      const created = await createConversationWithBackfill(userId, history, userMessageText)
      conversation = created.conversation
      insertedCount += created.backfillCount
    }

    insertedCount += await appendExchange(conversation._id, {
      userMessageText,
      assistantReplyText,
      propertyIds,
      pageKey,
      event,
    })

    const now = new Date()
    const update = {
      $inc: { messageCount: insertedCount },
      $set: {
        lastMessage: { text: assistantReplyText, role: 'assistant', at: now },
        lastActivityAt: now,
      },
    }

    if (lead && lead.id) {
      update.$set.leadCaptured = true
      update.$set.lead = lead.id
    }

    await ChatConversation.findByIdAndUpdate(conversation._id, update)

    return { persisted: true, conversationId: String(conversation._id) }
  } catch (err) {
    console.error('chatPersistence.recordChatExchange failed:', err)
    return { persisted: false, conversationId: null, error: true }
  }
}
