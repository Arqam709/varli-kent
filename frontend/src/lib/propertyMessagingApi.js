/**
 * Human customer↔agent messaging, as seen from the website.
 *
 * ── One API, two clients ────────────────────────────────────────────────
 * These call the SAME participant endpoints the mobile customer app uses:
 * /api/property-conversations. There is deliberately no /api/agent/messages —
 * the backend derives which side of a conversation the caller is on from the
 * JWT, so a second agent-only authorisation path would be a second thing to
 * keep in sync and a second thing to get wrong.
 *
 * Consequently NOTHING here ever sends an agentId, customerId or senderId.
 * Those fields are not merely unnecessary; no route reads them.
 *
 * This is NOT the Gemini assistant. That is ChatConversation/ChatMessage under
 * /api/chat and /api/admin/chats, and the two must not be mixed.
 */

import api from './api'

const BASE = '/property-conversations'

/**
 * Mirrors MAX_MESSAGE_LENGTH in backend/models/PropertyMessage.js.
 *
 * Used only to stop the browser producing a message the server will reject.
 * The backend re-validates and remains authoritative — see validateMessageText
 * in services/propertyMessaging.js.
 */
export const MAX_MESSAGE_LENGTH = 2000

/** Matches MESSAGE_PAGE_DEFAULT in routes/propertyConversations.js. */
export const MESSAGE_PAGE_SIZE = 30

/**
 * Fired whenever this tab does something that changes the agent's unread
 * total, so the sidebar badge can re-read it.
 *
 * A window event rather than a context: the badge has exactly one consumer
 * (AgentLayout) and one producer (the thread's mark-read), and threading a
 * provider through the portal for that would be more machinery than the
 * feature is worth. It is emphatically not a live feed — there is no polling
 * and no socket in this phase.
 */
export const HUMAN_UNREAD_EVENT = 'varlikent:human-unread-changed'

export const notifyHumanUnreadChanged = () => {
  window.dispatchEvent(new Event(HUMAN_UNREAD_EVENT))
}

/**
 * The Socket.IO event the backend emits after a message is safely stored.
 *
 * Named here, beside the REST calls it complements, so the string exists in one
 * place on this side of the wire — it must match NEW_MESSAGE_EVENT in
 * backend/services/propertyMessagingRealtime.js exactly, and a typo would fail
 * silently as "no live updates" rather than as an error.
 *
 * Payload:
 *   { conversationId, message: { _id, sender, text, createdAt },
 *     lastMessage: { text, sender, at }, lastActivityAt }
 *
 * `message` is the SAME shape sendPropertyMessage() returns, so a thread can
 * append it with the same code either way. Deliberately carries no unread count
 * for either side — that would be a read receipt.
 */
export const PROPERTY_MESSAGE_NEW_EVENT = 'property-message:new'

/**
 * The caller's own conversations, newest activity first.
 *
 * The sort is the server's ({ lastActivityAt: -1 }) and is not redone here.
 * For an agent the backend intersects the conversation pointer with CURRENT
 * Property.agent ownership, so a reassigned listing drops out of this list on
 * its own — the frontend neither filters nor can it.
 */
export const getPropertyConversations = async ({ limit = 50 } = {}) => {
  const res = await api.get(BASE, { params: { limit } })
  return Array.isArray(res.data?.conversations) ? res.data.conversations : []
}

/** Header/context for one thread. Messages are fetched separately. */
export const getPropertyConversation = async (conversationId) => {
  const res = await api.get(`${BASE}/${conversationId}`)
  return res.data?.conversation || null
}

/**
 * One page of messages, oldest→newest.
 *
 * `before` is a cursor on message `_id`; pass back the `nextCursor` of a page
 * to walk further into history. `nextCursor: null` means the start of the
 * thread has been reached.
 */
export const getPropertyMessages = async (conversationId, { before, limit = MESSAGE_PAGE_SIZE } = {}) => {
  const res = await api.get(`${BASE}/${conversationId}/messages`, {
    params: { limit, before: before || undefined },
  })

  return {
    messages: Array.isArray(res.data?.messages) ? res.data.messages : [],
    nextCursor: res.data?.nextCursor || null,
    hasMore: Boolean(res.data?.hasMore),
  }
}

/** Returns the SERVER-persisted message, which is what the thread appends. */
export const sendPropertyMessage = async (conversationId, text) => {
  const res = await api.post(`${BASE}/${conversationId}/messages`, { text })
  return res.data?.message || null
}

/** Clears the calling participant's unread counter. The body is ignored. */
export const markPropertyConversationRead = async (conversationId) => {
  const res = await api.patch(`${BASE}/${conversationId}/read`)
  return res.data
}

/**
 * Unread HUMAN messages across the agent's conversations.
 *
 * Not to be combined with /api/notifications/unread-count, which counts new
 * LISTINGS. Merging them would give one badge two meanings.
 */
export const getPropertyConversationUnreadCount = async () => {
  const res = await api.get(`${BASE}/unread-count`)
  return Number(res.data?.count) || 0
}

/* ── Response helpers ──────────────────────────────────────────────────── */

/** Axios shorthand for "this thread is gone, or was never yours". */
export const isUnavailable = (err) => err?.response?.status === 404

/**
 * A server message safe to show a user, or the supplied fallback.
 *
 * Only ever reads the API's own `message` field, which is written for humans —
 * never err.message, which can carry transport internals.
 */
export const readableError = (err, fallback) => {
  const message = err?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

/** Mirrors MESSAGE_PREVIEW_LENGTH, for optimistically updating an inbox row. */
const PREVIEW_LENGTH = 140

export const previewOf = (text = '') =>
  text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text
