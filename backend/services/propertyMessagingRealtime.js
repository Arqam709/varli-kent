// Who hears about a new human message, and what they are told.
//
// The route layer does HTTP and owns the write; this file owns the ONE realtime
// event that follows it. Keeping recipients and payload here mirrors how
// propertyMessaging.js already owns the authorization rules and serializers —
// the two things most likely to drift and leak if copy-pasted into a router.
//
// ── Direction ────────────────────────────────────────────────────────────
// SERVER → CLIENT only. There is no client→server messaging event anywhere in
// this codebase. REST remains the write path and MongoDB remains the source of
// truth; this is a notification that a write already happened.

import { userRoom } from '../realtime/socket.js'
import { messageResponse, previewOf } from './propertyMessaging.js'

/**
 * The only realtime event in the system.
 *
 * Deliberately one event rather than several. An inbox that receives this for a
 * conversation it does not know about can simply re-read GET
 * /property-conversations — a path that is already authorized and already
 * tested — instead of us inventing a second event with its own serializer and
 * its own authorization decision to get wrong. (That inbox handling is RT-2;
 * RT-1 only feeds the open thread.)
 */
export const NEW_MESSAGE_EVENT = 'property-message:new'

/**
 * What a participant is told about a new message.
 *
 * ── Reuses the REST serializers on purpose ──────────────────────────────
 * `messageResponse` is the SAME function POST /:id/messages returns to the
 * sender, so a client cannot receive two subtly different shapes for one
 * message and cannot need two code paths to append it. `previewOf` is the same
 * 140-character truncation written to conversation.lastMessage, so a future
 * inbox row rendered from this event matches what a refetch would show.
 *
 * ── What is deliberately absent ─────────────────────────────────────────
 * NO unread counts, for either side. One event goes to BOTH participants, and
 * conversationResponse() withholds the other side's count precisely because
 * exposing it would be a read receipt. Putting either count in a shared payload
 * would leak exactly that, and would quietly turn RT-1 into a feature V1 does
 * not offer. Each client increments its OWN count locally from the sender id.
 *
 * NO User or Property document. Nothing here that a client does not already
 * receive from REST.
 */
export const newMessagePayload = ({ conversationId, message }) => ({
  conversationId: String(conversationId),

  // Byte-identical to the REST send response.
  message: messageResponse(message),

  // Mirrors what the route just $set on the conversation, so RT-2 can render an
  // inbox row from this event without a refetch.
  lastMessage: {
    text: previewOf(message.text),
    sender: message.sender,
    at: message.createdAt,
  },
  lastActivityAt: message.createdAt,
})

/**
 * The rooms a new message is delivered to.
 *
 * ── Why currentAgentId and not conversation.agent ───────────────────────
 * Property.agent is the authorization authority; PropertyConversation.agent is
 * only a routing pointer that can be stale (see the header of
 * propertyMessaging.js). The caller passes the value it already resolved from
 * the PROPERTY on this very request, so a reassignment that happened seconds
 * ago is already reflected. Delivering to a stale pointer would push a
 * customer's private message to an agent who no longer holds the listing.
 *
 * ── Why user rooms and not a conversation room ──────────────────────────
 * A conversation room would have to be joined after an authorization check and
 * then LEFT again on reassignment; any missed eviction silently leaks the
 * thread. Here recipients are recomputed from current state on every single
 * message, so there is no membership that can go stale — the outgoing agent's
 * id is simply never produced. Multi-tab and multi-device fan-out comes free,
 * because every session of one account is already in that account's room.
 *
 * A null agent (unassigned or deleted listing) yields the customer alone. In
 * practice sendability already refuses that send, so this is belt and braces.
 */
export const newMessageRooms = ({ customerId, currentAgentId }) =>
  [...new Set([customerId, currentAgentId].filter(Boolean).map(String))].map(userRoom)

/**
 * Announces a message that is ALREADY SAFELY IN MONGODB.
 *
 * ── Failure boundary — the reason this cannot break sending ─────────────
 * Every realtime failure is swallowed here, deliberately, so that emission can
 * never become a second source of write failure. By the time this runs the
 * message row and the conversation update have both committed; the REST caller
 * is entitled to its 201 whatever happens next. Throwing would hand the sender
 * an error for a message that was genuinely delivered and stored — the worst
 * possible outcome, and it would also risk a "cannot set headers after they are
 * sent" crash depending on where the throw landed.
 *
 * This is why the function returns a boolean rather than a promise the route
 * has to await, and why the route never checks it: an offline recipient is
 * NORMAL. A room with zero sockets is normal. Neither is an error condition,
 * and neither changes the HTTP response.
 *
 * Returns true when an emit was attempted, purely so tests can assert it.
 */
export const emitNewPropertyMessage = (io, { conversationId, customerId, currentAgentId, message }) => {
  try {
    // No io on the app (a test harness, or a boot order that changed) must not
    // take the send down with it.
    if (!io || typeof io.to !== 'function') return false

    const rooms = newMessageRooms({ customerId, currentAgentId })
    if (rooms.length === 0) return false

    io.to(rooms).emit(NEW_MESSAGE_EVENT, newMessagePayload({ conversationId, message }))

    return true
  } catch (err) {
    // Ids only — never message text, never a participant's name. A log line is
    // not a place for the contents of a private conversation.
    console.error('[realtime] failed to emit new message; REST send was unaffected', {
      conversationId: String(conversationId),
      error: err.message,
    })
    return false
  }
}
