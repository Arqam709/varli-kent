import PushDevice from '../models/PushDevice.js'
import User from '../models/User.js'
import { sendPushToTokens } from './pushNotifications.js'

/**
 * The generic "a new listing went up" notification.
 *
 * Deliberately knows nothing about saved alerts. Phase 8C.2 will add the
 * personalised variant ("New match for your saved alert") and will pass the
 * users it already notified as `excludeUserIds`, so nobody is told about the
 * same property twice. That parameter is the only seam 8C.2 needs; nothing
 * here has to change.
 */

/**
 * How much of a listing description a notification carries.
 *
 * Not `MESSAGE_PREVIEW_LENGTH` — that bound exists to match the conversation
 * inbox preview, which is a different thing shown in a different place. A
 * listing line is one phrase, and Android truncates a single-line body around
 * this length anyway.
 */
const BODY_MAX_LENGTH = 120

/**
 * Turns a property into one readable line.
 *
 * Prefers the admin-authored `title`, because a human wrote it for this exact
 * listing and it reads better than anything assembled from columns. The
 * district is appended only when the title does not already say it — otherwise
 * "Modern Apartment in Kadıköy" would become "…in Kadıköy in Kadıköy".
 *
 * Whitespace is collapsed so a title pasted with newlines does not render as a
 * ragged block in the tray. The Property document is never touched.
 */
export const describeNewProperty = (property) => {
  const title = String(property?.title || '').replace(/\s+/g, ' ').trim()
  const district = String(property?.district || '').replace(/\s+/g, ' ').trim()

  let line = title

  if (district && !title.toLowerCase().includes(district.toLowerCase())) {
    line = title ? `${title} in ${district}` : district
  }

  if (line.length <= BODY_MAX_LENGTH) return line

  return `${line.slice(0, BODY_MAX_LENGTH - 1).trimEnd()}…`
}

/**
 * Who should hear about a new listing.
 *
 * ── Why the query starts from devices, not users ────────────────────────
 * Loading every User to find the notifiable ones would scan the whole
 * collection to discover that most of them have never installed the app. The
 * device collection already IS the set of people reachable by push, so it is
 * both the smaller set and the correct one.
 *
 * ── Who is filtered out, and why ────────────────────────────────────────
 * `excludeUserIds`  8C.2's seam — users already told about this property.
 * staff roles       These notifications are for customers browsing listings.
 *                   An admin who happens to have the app installed does not
 *                   want a phone buzz every time they publish something, and
 *                   the person who just pressed Create least of all.
 *
 * The role lookup is one query bounded by the number of people who own a
 * device — not by the size of the user base — so it stays cheap as the
 * customer base grows.
 *
 * @returns {Promise<string[]>} Distinct eligible Expo tokens.
 */
export const findGenericPushRecipients = async ({ excludeUserIds = [] } = {}) => {
  const devices = await PushDevice.find({ active: true }).select('token user').lean()
  const excluded = new Set(excludeUserIds.filter(Boolean).map(String))
  const linkedUserIds = [
    ...new Set(
      devices
        .map((device) => device.user)
        .filter(Boolean)
        .map(String)
        .filter((id) => !excluded.has(id))
    ),
  ]

  // Positive allowlist: only customer role=user is eligible. A future role is
  // therefore excluded by default instead of accidentally treated as retail.
  const customers = linkedUserIds.length
    ? await User.find({ _id: { $in: linkedUserIds }, role: 'user' }).select('_id').lean()
    : []
  const customerIds = new Set(customers.map((user) => String(user._id)))

  return [
    ...new Set(
      devices
        .filter((device) => {
          if (!device.user) return true
          const userId = String(device.user)
          return !excluded.has(userId) && customerIds.has(userId)
        })
        .map((device) => device.token)
    ),
  ]
}
/**
 * Announces a newly created listing.
 *
 * Never throws and never rejects. The property is already committed by the time
 * this runs, so nothing it does may turn a stored listing into a failed
 * request — the same contract the message push and the realtime emit follow.
 *
 * @param {object} args
 * @param {object} args.property The saved Property document.
 * @param {string[]} [args.excludeUserIds] Users already notified another way.
 * @returns {Promise<{attempted:number, accepted:number, failed:number}>}
 */
export const sendNewPropertyPush = async ({ property, excludeUserIds = [] } = {}) => {
  const empty = { attempted: 0, accepted: 0, failed: 0 }

  try {
    if (!property?._id) return empty

    const tokens = await findGenericPushRecipients({ excludeUserIds })

    // Nobody reachable. Returning early keeps a quiet installation from making
    // a pointless HTTPS round trip on every listing an admin creates.
    if (tokens.length === 0) return empty

    return await sendPushToTokens({
      tokens,
      // Deliberately distinct from 8C.2's "New match for your saved alert", so
      // the two are tellable apart in the tray at a glance.
      title: 'New property added',
      body: describeNewProperty(property),
      /**
       * Routing only. The price and title are in the visible notification
       * because a human reads them there; they are NOT in `data`, because the
       * app fetches the property after opening and a payload is readable by
       * anything that can see the device. No agent contact, no owner, no
       * internal metadata, no document.
       */
      data: {
        type: 'new_property',
        propertyId: String(property._id),
      },
    })
  } catch (err) {
    // sendPushToTokens already swallows provider failures; this also contains a
    // database error resolving recipients, which would otherwise escape into a
    // route that has finished its real work.
    console.error('[push] could not send new-property notification:', err.message)
    return empty
  }
}
