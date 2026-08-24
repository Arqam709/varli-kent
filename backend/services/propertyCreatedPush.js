import PropertyAlert from '../models/PropertyAlert.js'
import User from '../models/User.js'
import { propertyMatchesAlert } from './propertyAlerts.js'
import { describeNewProperty, sendNewPropertyPush } from './propertyPush.js'
import { sendPushToUsers } from './pushNotifications.js'

const emptyResult = () => ({ attempted: 0, accepted: 0, failed: 0 })

const uniqueIds = (values = []) => [
  ...new Set(values.filter(Boolean).map(String)),
]

/**
 * Finds active customer accounts whose active saved alerts match a property.
 *
 * Matching deliberately delegates to propertyMatchesAlert, the same function
 * used by the in-app notifications feed. The bounded User query filters only
 * alert owners that matched, so stale staff/inactive-account alerts cannot
 * become personal customer push notifications.
 */
export const findMatchingCustomerUserIds = async (property) => {
  const alerts = await PropertyAlert.find({ active: true })
    .select('user listingType district propertyType minPrice maxPrice minBeds')
    .lean()

  const matchedOwnerIds = uniqueIds(
    alerts
      .filter((alert) => alert?.user && propertyMatchesAlert(property, alert))
      .map((alert) => alert.user)
  )

  if (matchedOwnerIds.length === 0) return []

  const customers = await User.find({
    _id: { $in: matchedOwnerIds },
    role: 'user',
    isActive: true,
  })
    .select('_id')
    .lean()

  return uniqueIds(customers.map((user) => user._id))
}

/** Sends one logical saved-alert notification per matching customer account. */
export const sendPropertyMatchPush = async ({ property, userIds = [] } = {}) => {
  const recipients = uniqueIds(userIds)
  const empty = emptyResult()

  if (!property?._id || recipients.length === 0) return empty

  try {
    return await sendPushToUsers({
      userIds: recipients,
      title: 'New match for your saved alert',
      body: describeNewProperty(property),
      data: {
        type: 'property_match',
        propertyId: String(property._id),
      },
    })
  } catch (err) {
    console.error('[push] could not send saved-alert match notification:', err.message)
    return empty
  }
}

/**
 * Orchestrates all OS notifications for one successfully created property.
 *
 * Never throws. If alert lookup fails, generic delivery still runs with only
 * the caller-provided exclusions. Once matching users are known, they remain
 * excluded from generic delivery even if Expo rejects the personalised push;
 * provider acceptance is not a reliable delivery/deduplication signal.
 */
export const notifyNewPropertyCreated = async ({ property, excludeUserIds = [] } = {}) => {
  const baseExclusions = uniqueIds(excludeUserIds)
  let matchingUserIds = []

  try {
    matchingUserIds = await findMatchingCustomerUserIds(property)
  } catch (err) {
    console.error('[push] could not resolve saved-alert matches:', err.message)
  }

  const genericExclusions = uniqueIds([...baseExclusions, ...matchingUserIds])

  // Delivery categories are independent after matching is known. Both helpers
  // contain their own failures, and allSettled is an extra guard against a
  // future adapter regression producing an unhandled rejection.
  await Promise.allSettled([
    sendPropertyMatchPush({ property, userIds: matchingUserIds }),
    sendNewPropertyPush({ property, excludeUserIds: genericExclusions }),
  ])

  return { matchingUserIds }
}
