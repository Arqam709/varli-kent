import PushDevice from '../models/PushDevice.js'

/**
 * Sending push notifications through Expo's HTTPS push service.
 *
 * ── Why fetch and not the SDK ────────────────────────────────────────────
 * `expo-server-sdk` wraps one POST to one endpoint, plus chunking and a token
 * regex. That is a small amount of code we can read, and the same decision the
 * Resend migration made for the same reasons: Node 18+ has a global fetch, the
 * failure modes stay visible in this file rather than inside someone else's
 * client, and there is one less dependency to keep current.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 * It does not decide WHO to notify. Callers pass tokens. Phase 8B will supply
 * them from property-alert matching; nothing here knows about properties.
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

/**
 * Expo accepts at most 100 messages per request.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
const MAX_MESSAGES_PER_REQUEST = 100

/**
 * The two shapes Expo issues.
 *
 * Validated before sending rather than after: a malformed token is rejected by
 * the whole request in some cases, so one bad row could otherwise silence a
 * batch of good ones.
 */
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]]+\]$/

export const isExpoPushToken = (value) =>
  typeof value === 'string' && EXPO_TOKEN_PATTERN.test(value.trim())

/** Splits into request-sized batches. */
const chunk = (items, size) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Marks tokens Expo has told us are dead.
 *
 * `DeviceNotRegistered` means the app was uninstalled, the token rotated, or
 * notifications were turned off at the OS level. Without this the collection
 * would accumulate tokens that can never succeed, and every future send would
 * pay for them.
 *
 * Deactivating is deliberately not deleting — see the note in the model.
 */
const deactivateTokens = async (tokens) => {
  if (tokens.length === 0) return

  try {
    await PushDevice.updateMany({ token: { $in: tokens } }, { $set: { active: false } })
    console.log(`[push] deactivated ${tokens.length} unregistered device(s)`)
  } catch (err) {
    // A cleanup failure must not turn a partially successful send into an error.
    console.error('[push] could not deactivate unregistered devices:', err.message)
  }
}

/**
 * Sends one notification to many devices.
 *
 * @param {object} message
 * @param {string[]} message.tokens Expo push tokens. Invalid ones are dropped.
 * @param {string} message.title
 * @param {string} message.body
 * @param {object} [message.data] Payload the app reads when the user taps.
 * @returns {Promise<{attempted:number, accepted:number, failed:number}>}
 *   Never throws — a provider outage must not fail the request that triggered
 *   the send, because the notification is always secondary to whatever the
 *   caller was actually doing.
 */
export const sendPushNotifications = async ({ tokens, title, body, data = {} }) => {
  const valid = [...new Set((tokens || []).filter(isExpoPushToken))]

  const result = { attempted: valid.length, accepted: 0, failed: 0 }
  if (valid.length === 0) return result

  const unregistered = []

  for (const batch of chunk(valid, MAX_MESSAGES_PER_REQUEST)) {
    const messages = batch.map((to) => ({ to, title, body, data, sound: 'default' }))

    let response
    try {
      response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      })
    } catch (err) {
      // Never completed: DNS, TLS, socket. Distinct from Expo rejecting it.
      console.error('[push] request to Expo failed to complete:', err.message)
      result.failed += batch.length
      continue
    }

    if (!response.ok) {
      // Nothing from the body is logged: it echoes the messages back, and a
      // push token identifies a specific installation.
      console.error(`[push] Expo rejected the batch: status=${response.status}`)
      result.failed += batch.length
      continue
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      console.error('[push] Expo returned an unparseable body')
      result.failed += batch.length
      continue
    }

    /**
     * Expo answers with one TICKET per message, in order. A ticket is only an
     * acknowledgement that Expo accepted the message — final delivery is
     * reported later through RECEIPTS, which this phase deliberately does not
     * poll (see the report). Tickets are still enough to spot a dead token,
     * which is the cleanup that actually matters.
     */
    const tickets = Array.isArray(payload?.data) ? payload.data : []

    tickets.forEach((ticket, index) => {
      if (ticket?.status === 'ok') {
        result.accepted += 1
        return
      }

      result.failed += 1

      if (ticket?.details?.error === 'DeviceNotRegistered') {
        unregistered.push(batch[index])
      } else if (ticket?.details?.error) {
        // The error CODE is safe; the message can contain the token.
        console.error(`[push] ticket error: ${ticket.details.error}`)
      }
    })

    // A short body with no tickets means Expo accepted nothing.
    if (tickets.length === 0) result.failed += batch.length
  }

  await deactivateTokens(unregistered)

  return result
}

/** Token-level entry point shared by account and public notification domains. */
export const sendPushToTokens = sendPushNotifications

/**
 * Convenience wrapper: notify every active device belonging to these users.
 *
 * Phase 8B will call this with the users whose saved alerts matched a new
 * property. It exists now so that fan-out never has to reach into PushDevice
 * directly.
 */
export const sendPushToUsers = async ({ userIds, title, body, data }) => {
  const devices = await PushDevice.find({ user: { $in: userIds }, active: true }).select('token')

  return sendPushToTokens({
    tokens: devices.map((device) => device.token),
    title,
    body,
    data,
  })
}
