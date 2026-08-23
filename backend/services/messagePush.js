import { MESSAGE_PREVIEW_LENGTH } from '../models/PropertyMessage.js'
import { sendPushToUsers } from './pushNotifications.js'

/**
 * Push notifications for a new property message.
 *
 * A thin adapter between the messaging route and the Phase-8A sender: it
 * decides WHO should be notified and what the notification says, and delegates
 * device fan-out. It deliberately owns no transport of its own.
 *
 * ── Why this is separate from the realtime emit ─────────────────────────
 * Socket.IO reaches an app that is OPEN. Push reaches one that is not. They are
 * two delivery channels for the same event and both run — replacing the socket
 * with push would make an open chat wait on FCM, and replacing push with the
 * socket would mean a closed app hears nothing.
 */

/**
 * The recipient rule.
 *
 * V1 notifies the CUSTOMER only, because the agent works in the web Agent
 * Portal and has no mobile app to receive anything. The function still resolves
 * both directions so that giving agents a device later is a change to this one
 * `if`, not a rewrite of the caller.
 *
 * @param {'customer'|'agent'} senderSide Which participant sent the message.
 * @returns {string|null} The user to notify, or null when nobody should be.
 */
export const messagePushRecipient = ({ senderSide, customerId, currentAgentId }) => {
  // The sender is never notified about their own message. This is why the rule
  // is expressed as "the other side" rather than "the customer".
  if (senderSide === 'agent') return customerId ? String(customerId) : null

  // customer → agent. No agent push destination exists in V1; returning the id
  // rather than null would notify a device that is not registered, and
  // returning nothing here is what keeps that explicit.
  return null
}

/**
 * Trims a message to something a notification can carry.
 *
 * Reuses `MESSAGE_PREVIEW_LENGTH` — the same bound the conversation's
 * denormalised `lastMessage.text` already uses — so the inbox preview and the
 * notification cannot disagree about how much of a message is shown.
 *
 * Whitespace is collapsed because a message with newlines renders as a tall,
 * ragged block in the notification tray. The STORED message is untouched; this
 * only shapes what the tray displays.
 */
export const notificationPreview = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()

  if (flat.length <= MESSAGE_PREVIEW_LENGTH) return flat

  return `${flat.slice(0, MESSAGE_PREVIEW_LENGTH - 1).trimEnd()}…`
}

/**
 * Notifies the other participant that a message arrived.
 *
 * Never throws and never rejects. The message is already committed by the time
 * this runs, so nothing it does may turn a stored message into a failed
 * request — the same contract `emitNewPropertyMessage` follows, and for the
 * same reason.
 *
 * @param {object} args
 * @param {'customer'|'agent'} args.senderSide
 * @param {string} args.senderName Shown in the title. Falls back when absent.
 * @param {object} args.message The saved PropertyMessage.
 * @returns {Promise<{sent:boolean}>} Reported for tests and logs, not for the
 *   HTTP response.
 */
export const sendNewMessagePush = async ({
  senderSide,
  senderName,
  customerId,
  currentAgentId,
  conversationId,
  propertyId,
  message,
}) => {
  try {
    const recipientId = messagePushRecipient({ senderSide, customerId, currentAgentId })
    if (!recipientId) return { sent: false }

    // A missing name is a real case — legacy accounts, and agents who never set
    // one — so the title degrades to something still true rather than rendering
    // "New message from undefined".
    const name = typeof senderName === 'string' && senderName.trim()
      ? senderName.trim()
      : 'your agent'

    const result = await sendPushToUsers({
      userIds: [recipientId],
      title: `New message from ${name}`,
      body: notificationPreview(message?.text),
      /**
       * Routing data only. No JWT, no email, no phone, no participant record
       * and no message document — a notification payload is readable by
       * anything that can see the device, and the conversation id is all the
       * app needs to open the thread. Authorisation still happens server-side
       * when that screen loads.
       */
      data: {
        type: 'message',
        conversationId: String(conversationId),
        ...(propertyId ? { propertyId: String(propertyId) } : {}),
      },
    })

    return { sent: result.accepted > 0 }
  } catch (err) {
    // Belt and braces: sendPushToUsers already swallows provider failures, but
    // a database error resolving devices would otherwise escape into a route
    // that has finished its real work.
    console.error('[push] could not send message notification:', err.message)
    return { sent: false }
  }
}
