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

/*
 * ── AI chatbot history deletion ──────────────────────────────────────────
 *
 * The single authoritative cleanup path. All four delete routes (user
 * delete-one, user clear-all, admin delete-one, admin clear-user) go through
 * here, so "what belongs to a conversation" is decided once.
 *
 * ── What is deleted, and what deliberately is not ────────────────────────
 * A ChatConversation owns its ChatMessage rows and nothing else. Two
 * references point OUT of this data and must survive:
 *
 *   ChatConversation.lead  -> ContactSubmission. A captured lead is a real
 *     business record owned by the leads system (/admin/messages, lead
 *     routing). A visitor tidying their chat history must not silently
 *     destroy the enquiry the sales team is working.
 *
 *   ChatMessage.propertyIds -> Property. Listings are obviously not owned by
 *     a chat that mentioned them.
 *
 * PropertyConversation / PropertyMessage are a DIFFERENT system (customer to
 * agent messaging) and are never touched here.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────
 * Messages go first. If message deletion fails the error propagates and the
 * conversation row survives, so the caller sees a failure and the history is
 * still reachable — the opposite order would orphan messages behind a
 * conversation that no longer exists, invisible to every query and to the
 * user who asked for them to be gone.
 *
 * No transaction: this deployment runs against a single connection with no
 * documented replica set, and Mongo requires one for multi-document
 * transactions. Sequencing so the recoverable state is the safe state is the
 * honest alternative.
 */
export const deleteConversationCascade = async (conversationId) => {
  const messages = await ChatMessage.deleteMany({ conversation: conversationId })
  await ChatConversation.deleteOne({ _id: conversationId })

  return { messagesDeleted: messages.deletedCount ?? 0 }
}

/**
 * Deletes every AI chatbot conversation belonging to one user.
 *
 * Only _id values are read, never transcripts — clearing a long history must
 * not pull every message document into memory to do it.
 *
 * Returns the number of CONVERSATIONS removed. A user with no history is not
 * an error; it returns 0.
 */
export const deleteConversationsForUser = async (userId) => {
  const conversations = await ChatConversation.find({ user: userId }).select('_id').lean()

  let deletedCount = 0
  for (const { _id } of conversations) {
    await deleteConversationCascade(_id)
    deletedCount++
  }

  return { deletedCount }
}
