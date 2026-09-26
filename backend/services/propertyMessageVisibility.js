// PER-PARTICIPANT VISIBILITY for customer↔agent property messaging.
//
// "Delete for me" and "Delete conversation" change what ONE user sees and
// nothing else. The shared PropertyMessage documents, the shared lastMessage,
// the other participant's unread count and the other participant's inbox are
// never modified here — the other side is still entitled to the whole
// conversation, exactly as it was written, and is never told anything changed.
//
// This file belongs to the PROPERTY messaging system only (PropertyConversation
// / PropertyMessage). It has no relationship to the AI assistant transcripts
// (ChatConversation / ChatMessage), which have their own persistence and admin
// tooling.
//
// ── Where the state lives ────────────────────────────────────────────────
//   PropertyMessage.hiddenFor            one message, hidden for these users
//   participantViews[].clearedThrough    "history up to and including this
//                                         message _id is gone for this user"
//   participantViews[].preview*          this user's inbox preview, when it
//                                         differs from the shared one
//   PropertyConversation.hiddenFromInbox this user removed the row; reset by
//                                         the next message anyone sends
//
// All of it is keyed by USER, so an agent reassignment never passes one
// agent's private view to the next.

import PropertyConversation from '../models/PropertyConversation.js'
import PropertyMessage from '../models/PropertyMessage.js'
import { effectiveLastMessage, participantViewOf, previewOf } from './propertyMessaging.js'

const sameIdString = (a, b) => Boolean(a) && Boolean(b) && String(a) === String(b)

/* ── Reading ───────────────────────────────────────────────────────────── */

/**
 * The messages of this conversation that `userId` may see: not hidden by
 * them, and newer than their clear cutoff, if they have one.
 *
 * Applied by the SERVER on every page, so pagination stays exact: `limit + 1`
 * still decides hasMore, and the cursor is still the oldest RETURNED _id — a
 * page can never come back short because hidden rows were filtered afterwards,
 * and Load Older can never walk back into cleared history.
 *
 * The other participant's filter names only THEIR id, so this user's choices
 * cannot affect what the other side receives.
 */
export const visibleMessagesFilter = (conversation, userId) => {
  const filter = { conversation: conversation._id, hiddenFor: { $ne: userId } }
  const cutoff = participantViewOf(conversation, userId)?.clearedThrough
  if (cutoff) filter._id = { $gt: cutoff }
  return filter
}

/** The newest message of the conversation, visible or not, or null. */
const newestMessage = (conversationId) =>
  PropertyMessage.findOne({ conversation: conversationId }).sort({ _id: -1 }).select('_id createdAt')

/** The newest message `userId` can still see, or null. */
const newestVisibleMessage = (conversation, userId) =>
  PropertyMessage.findOne(visibleMessagesFilter(conversation, userId))
    .sort({ _id: -1 })
    .select('_id sender text createdAt')

/* ── Writing ───────────────────────────────────────────────────────────── */

/**
 * Makes sure the shared lastMessage names the message it describes, and says
 * whether that is `newest`.
 *
 * Rows written before lastMessage.message existed carry only `at`; for those
 * the id is filled in when — and only when — `at` still matches the newest
 * message. If it does not, a newer message has landed since this request read
 * the conversation, and the caller must not write a private preview or hide
 * the row: that new message is visible to this user, and the shared preview
 * already shows it.
 */
const anchorSharedPreview = async (conversation, newest) => {
  const shared = conversation.lastMessage
  if (shared?.message) return sameIdString(shared.message, newest._id)

  if (!shared?.at || new Date(shared.at).getTime() !== new Date(newest.createdAt).getTime()) {
    return false
  }

  const result = await PropertyConversation.updateOne(
    { _id: conversation._id, 'lastMessage.message': null, 'lastMessage.at': newest.createdAt },
    { $set: { 'lastMessage.message': newest._id } }
  )
  return result?.matchedCount > 0
}

/**
 * Writes fields onto THIS user's view, creating it the first time.
 *
 * Positional $set first; if the user has no view yet, $push one — guarded by
 * `$ne` so two simultaneous first writes cannot create two views. The loser
 * of that race retries the $set once, against the view the winner created.
 */
const saveParticipantView = async (conversationId, userId, fields) => {
  const set = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [`participantViews.$.${key}`, value])
  )
  const updateExisting = () =>
    PropertyConversation.updateOne(
      { _id: conversationId, 'participantViews.user': userId },
      { $set: set }
    )

  if ((await updateExisting())?.matchedCount > 0) return

  const pushed = await PropertyConversation.updateOne(
    { _id: conversationId, 'participantViews.user': { $ne: userId } },
    {
      $push: {
        participantViews: {
          user: userId,
          clearedThrough: null,
          previewThrough: null,
          preview: null,
          ...fields,
        },
      },
    }
  )
  if (!(pushed?.matchedCount > 0)) await updateExisting()
}

/** What the caller's inbox now shows for this conversation. */
const participantState = async (conversationId, userId) => {
  const fresh = await PropertyConversation.findById(conversationId).select(
    'lastMessage participantViews hiddenFromInbox'
  )
  const inInbox = !(fresh?.hiddenFromInbox || []).some((id) => sameIdString(id, userId))
  return { lastMessage: inInbox && fresh ? effectiveLastMessage(fresh, userId) : null, inInbox }
}

/**
 * "Delete for me" — ONE of the user's own messages.
 *
 * The route has already authorized the conversation and checked that the user
 * sent this message. Here:
 *   1. the user joins the message's hiddenFor (idempotent $addToSet, and the
 *      filter repeats `sender`, so ownership is enforced by the write itself);
 *   2. the user's private preview is recomputed from what they can still see;
 *   3. if they can see nothing at all, the row leaves THEIR inbox until the
 *      next message.
 *
 * Unchanged, deliberately: the message text, the shared lastMessage, both
 * unread counts (hiding your own message says nothing about whether the other
 * person has read it), lastActivityAt.
 */
export const hideMessageForUser = async ({ conversation, message, user }) => {
  await PropertyMessage.updateOne(
    { _id: message._id, conversation: conversation._id, sender: user._id },
    { $addToSet: { hiddenFor: user._id } }
  )

  const newest = await newestMessage(conversation._id)
  if (newest && (await anchorSharedPreview(conversation, newest))) {
    const visible = await newestVisibleMessage(conversation, user._id)
    const preview = visible
      ? { text: previewOf(visible.text), sender: visible.sender, at: visible.createdAt }
      : null

    await saveParticipantView(conversation._id, user._id, { previewThrough: newest._id, preview })

    if (!visible) {
      // Conditional on the shared preview still being `newest`: a message sent
      // in the meantime is visible to this user and must keep the row.
      await PropertyConversation.updateOne(
        { _id: conversation._id, 'lastMessage.message': newest._id },
        { $addToSet: { hiddenFromInbox: user._id } }
      )
    }
  }

  return participantState(conversation._id, user._id)
}

/**
 * "Delete conversation" — the user's whole history, for them only.
 *
 * The cutoff is the newest message's _id at this moment: everything at or
 * before it leaves this user's history for good, and anything sent afterwards
 * — by either participant — is new activity they will see. The row leaves
 * their inbox until that happens, and their OWN unread count is cleared, since
 * they chose to be done with what was unread.
 *
 * The conversation document, every message, the other participant's unread
 * count and their inbox are untouched. Nothing is deleted.
 */
export const clearConversationForUser = async ({ conversation, user, side }) => {
  const newest = await newestMessage(conversation._id)
  if (!newest) return participantState(conversation._id, user._id)

  const anchored = await anchorSharedPreview(conversation, newest)

  await saveParticipantView(conversation._id, user._id, {
    clearedThrough: newest._id,
    // Nothing is visible any more — but only a statement about `newest`.
    ...(anchored ? { previewThrough: newest._id, preview: null } : {}),
  })

  if (anchored) {
    const unread = side === 'customer'
      ? { customerUnreadCount: 0, customerLastReadAt: new Date() }
      : { agentUnreadCount: 0, agentLastReadAt: new Date() }

    // One conditional write: if a message arrived after `newest`, the row stays
    // (that message is visible to this user) and so does its unread count.
    await PropertyConversation.updateOne(
      { _id: conversation._id, 'lastMessage.message': newest._id },
      { $addToSet: { hiddenFromInbox: user._id }, $set: unread }
    )
  }

  return participantState(conversation._id, user._id)
}
