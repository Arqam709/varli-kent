import express from 'express'
import Property from '../models/Property.js'
import PropertyAlert from '../models/PropertyAlert.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { propertyMatchesAlert } from '../services/propertyAlerts.js'

const router = express.Router()

// Every route here is behind `protect`. Notification state is per-user, so
// none of it is available anonymously — and the user is always taken from
// `req.user` (set by the JWT), never from a client-supplied id.

// Only what a notification card renders. Keeps the payload small and, as a
// side effect, never ships descriptionEmbedding.
const NOTIFICATION_PROPERTY_FIELDS = [
  'title',
  'listingType',
  'price',
  'priceLabel',
  'district',
  'propertyType',
  'beds',
  'baths',
  'sqm',
  'mainImage',
  'images',
  'featured',
  'status',
  'createdAt',
].join(' ')

// A first-time user has no notificationsLastSeenAt, so their account creation
// date becomes the baseline: "new since you joined".
//
// The alternative — treating an absent value as "the beginning of time" —
// would greet every existing account with the entire back catalogue as
// unread, which is exactly the surprise we want to avoid. Anchoring to
// createdAt needs no magic window and no migration.
const baselineFor = (user) => user.notificationsLastSeenAt || user.createdAt

// Hard cap so a long-dormant account cannot pull an unbounded list. Newest
// first, matching the properties API.
const FEED_LIMIT = 50

// GET /api/notifications
// The feed plus its count, in one request.
router.get('/', protect, async (req, res, next) => {
  try {
    const since = baselineFor(req.user)

    const snapshotAt = new Date()

    const properties = await Property.find({ createdAt: { $gt: since } })
      .select(NOTIFICATION_PROPERTY_FIELDS)
      .sort({ createdAt: -1 })
      .limit(FEED_LIMIT)

    const alerts = await PropertyAlert.find({ user: req.user._id, active: true })

    const matchedPropertyIds = []
    for (const property of properties) {
      if (alerts.some((alert) => propertyMatchesAlert(property, alert))) {
        matchedPropertyIds.push(String(property._id))
      }
    }

    res.json({
      success: true,
      count: properties.length,
      snapshotAt,
      notifications: properties,
      
      matchedPropertyIds,
      
      alertCount: alerts.length,
    })
  } catch (err) {
    next(err)
  }
})

router.get('/unread-count', protect, async (req, res, next) => {
  try {
    const since = baselineFor(req.user)
    const count = await Property.countDocuments({ createdAt: { $gt: since } })

    res.json({ success: true, count })
  } catch (err) {
    next(err)
  }
})

router.patch('/seen', protect, async (req, res, next) => {
  try {
    const now = new Date()
    let seenAt = now

    if (req.body?.seenAt !== undefined) {
      const parsed = new Date(req.body.seenAt)
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid seenAt' })
      }
      // A client must not be able to mute future properties.
      seenAt = parsed > now ? now : parsed
    }

    const current = baselineFor(req.user)

    // Only ever move forward. A stale client replaying an old snapshot would
    // otherwise resurrect notifications the user has already dismissed.
    if (current && seenAt <= current) {
      return res.json({ success: true, notificationsLastSeenAt: current })
    }

    // Scoped to req.user._id — the authenticated identity. There is no code
    // path here that accepts a userId from the request.
    await User.updateOne(
      { _id: req.user._id },
      { $set: { notificationsLastSeenAt: seenAt } }
    )

    res.json({ success: true, notificationsLastSeenAt: seenAt })
  } catch (err) {
    next(err)
  }
})

export default router
