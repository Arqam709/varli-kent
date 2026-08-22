import express from 'express'
import PushDevice from '../models/PushDevice.js'
import { protect } from '../middleware/auth.js'
import { isExpoPushToken, sendPushToUsers } from '../services/pushNotifications.js'

const router = express.Router()

// Every route here is behind `protect`, and the owner is always taken from
// `req.user` — there is no code path that accepts a userId from the request.

const PLATFORMS = ['android', 'ios']

/**
 * POST /api/push/devices — register this installation for notifications.
 *
 * Idempotent by construction. `token` is globally unique, so an upsert keyed on
 * it either refreshes the existing row or creates one; calling this on every
 * launch is expected and costs one write.
 *
 * ── The account-switch rule ──────────────────────────────────────────────
 * `user` is part of the UPDATE, not the filter. That is the whole design: a
 * push token identifies a phone, not a person, so when B signs in on A's phone
 * the row is REASSIGNED to B. Filtering on { token, user } instead would try to
 * insert a second row for the same token, hit the unique index, and leave A
 * still receiving notifications on a device B is now using.
 */
router.post('/devices', protect, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    const platform = req.body?.platform

    // Validated before it can reach the database, so a malformed value cannot
    // sit in the collection failing every future send.
    if (!isExpoPushToken(token)) {
      return res.status(400).json({ success: false, message: 'A valid Expo push token is required' })
    }

    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: 'platform must be android or ios' })
    }

    await PushDevice.findOneAndUpdate(
      { token },
      {
        $set: {
          user: req.user._id,
          platform,
          active: true,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    // The token is NOT echoed back. It is a routing credential for this
    // device, and the client already has it.
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/push/devices — stop notifying this installation.
 *
 * Called on sign-out. Scoped to `{ token, user: req.user._id }` so one account
 * cannot silence another account's device by guessing a token — the token is
 * the only thing the client supplies, and ownership is checked against the JWT.
 *
 * Deactivates rather than deletes, so signing back in restores it with one
 * update instead of racing to re-insert against the unique index.
 */
router.delete('/devices', protect, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''

    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' })
    }

    await PushDevice.updateOne(
      { token, user: req.user._id },
      { $set: { active: false } }
    )

    // Deliberately the same response whether or not a row matched. Reporting
    // "no such device" would let a caller probe which tokens exist.
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/push/test — prove the pipeline end to end.
 *
 * Targets ONLY `req.user`'s own devices. There is no recipient parameter at
 * all, which is what makes this safe to leave enabled: the worst a caller can
 * do is notify the phone in their own hand.
 *
 * Exists so push can be verified before Phase 8B wires it to property alerts —
 * separating "does delivery work" from "does matching work" is what keeps that
 * phase debuggable.
 */
router.post('/test', protect, async (req, res, next) => {
  try {
    const result = await sendPushToUsers({
      userIds: [req.user._id],
      title: 'Varlikent',
      body: 'Push notifications are working.',
      data: { type: 'test' },
    })

    // A summary only — never the tokens themselves.
    res.json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
})

export default router
