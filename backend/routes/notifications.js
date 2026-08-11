import express from 'express'
import Property from '../models/Property.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'

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

    // Captured BEFORE the query so it can never be later than the newest
    // property returned. The client sends this back to /seen, which is what
    // stops a property created mid-request from being silently skipped.
    const snapshotAt = new Date()

    // No status filter, matching GET /api/properties — the public list does
    // not hide Sold/Rented either, so notifications stay consistent with what
    // tapping through will actually show. Deleted properties are removed with
    // findByIdAndDelete, so they simply cannot appear.
    const properties = await Property.find({ createdAt: { $gt: since } })
      .select(NOTIFICATION_PROPERTY_FIELDS)
      .sort({ createdAt: -1 })
      .limit(FEED_LIMIT)

    res.json({
      success: true,
      count: properties.length,
      snapshotAt,
      notifications: properties,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/notifications/unread-count
// Cheap count for the bell badge. Deliberately separate from the feed so the
// Home screen does not download up to 50 properties just to render a dot,
// and — importantly — reading the badge never advances the seen timestamp.
router.get('/unread-count', protect, async (req, res, next) => {
  try {
    const since = baselineFor(req.user)
    const count = await Property.countDocuments({ createdAt: { $gt: since } })

    res.json({ success: true, count })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/seen
// Body: { seenAt?: ISO string }
//
// Advances this user's baseline. `seenAt` should be the `snapshotAt` returned
// by the feed, so anything created after that snapshot stays unread.
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
