/**
 * Folds one `property-message:new` event into an inbox list.
 *
 * Pure and side-effect free: it decides what the list should become, and the
 * page decides what to do about it. That split is what makes the unread and
 * ordering rules directly testable without mounting a socket or a router.
 *
 * ── Why it reports `unknown` instead of building a row ──────────────────
 * The event carries a message and a preview, but deliberately NOT the
 * customer's name, the property title, or its image — broadcasting whole User
 * and Property documents to both participants would be a privacy regression for
 * the sake of saving a fetch. So when the conversation is not already in the
 * list — the important first-message case, where an empty thread is hidden from
 * the agent's inbox until someone actually speaks — this returns
 * `unknown: true` and the caller re-reads GET /property-conversations, which is
 * already authorized and already returns the safe summary shape.
 *
 * A partial placeholder row is never invented.
 *
 * Returns { conversations, unknown }.
 */
export const applyMessageEventToConversations = (
  current,
  payload,
  { currentUserId = null, activeConversationId = null } = {}
) => {
  const conversationId = payload?.conversationId ? String(payload.conversationId) : ''
  if (!conversationId) return { conversations: current, unknown: false }

  const index = current.findIndex((item) => String(item._id) === conversationId)

  // Not in the list — the caller refetches rather than guessing at a row.
  if (index === -1) return { conversations: current, unknown: true }

  const existing = current[index]

  const senderId = payload.message?.sender ? String(payload.message.sender) : null
  const sentByMe = Boolean(senderId && currentUserId && senderId === String(currentUserId))
  const isBeingRead = Boolean(activeConversationId) && String(activeConversationId) === conversationId

  const updated = {
    ...existing,

    // Raw server data, never a formatted string, so the row's own rendering
    // rules keep working untouched.
    lastMessage: payload.lastMessage ?? existing.lastMessage,
    lastActivityAt: payload.lastActivityAt ?? existing.lastActivityAt,

    /*
     * The recipient's own badge, mirroring the $inc the server just performed.
     *
     * Skipped for the agent's OWN message — the event reaches both participants,
     * so the sender receives their own copy here — and skipped while the
     * conversation is the one currently selected, because the open thread has
     * already marked it read and a badge would contradict what they are looking
     * at.
     *
     * This is a local echo for immediacy only. The server remains authoritative
     * and the sidebar badge re-reads the real total.
     */
    unreadCount: sentByMe || isBeingRead ? existing.unreadCount : (existing.unreadCount || 0) + 1,
  }

  // Replace in place, then order by activity. Replacing rather than inserting
  // is what guarantees one row per conversation id — appending the updated copy
  // without removing the old one is how a list grows duplicate keys.
  const next = current.map((item, i) => (i === index ? updated : item))

  // Newest first, matching the server's own { lastActivityAt: -1 } ordering and
  // the sort handleMessageSent already uses, so a live update and a refetch
  // cannot disagree about position. Sorting a copy — sort() mutates.
  return {
    conversations: next
      .slice()
      .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt)),
    unknown: false,
  }
}

export default applyMessageEventToConversations
