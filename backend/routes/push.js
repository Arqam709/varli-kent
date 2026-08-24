import express from 'express'
import PushDevice from '../models/PushDevice.js'
import { protect } from '../middleware/auth.js'
import { isExpoPushToken, sendPushToUsers } from '../services/pushNotifications.js'

const router = express.Router()

const PLATFORMS = ['android', 'ios']

const readRegistration = (body) => {
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const platform = body?.platform

  if (!isExpoPushToken(token)) {
    return { error: 'A valid Expo push token is required' }
  }
  if (!PLATFORMS.includes(platform)) {
    return { error: 'platform must be android or ios' }
  }
  return { token, platform }
}

/**
 * POST /api/push/devices/anonymous — register public push capability.
 *
 * This route never accepts or derives account ownership. If the token is
 * already linked to a user, the request is deliberately a no-op: possession
 * of a token is not authority to detach somebody else's personal pushes.
 * The response stays identical, so it is not a token-ownership oracle.
 */
router.post('/devices/anonymous', async (req, res, next) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'userId')) {
      return res.status(400).json({ success: false, message: 'userId is not accepted' })
    }

    const registration = readRegistration(req.body)
    if (registration.error) {
      return res.status(400).json({ success: false, message: registration.error })
    }

    const { token, platform } = registration
    const existing = await PushDevice.findOne({ token }).select('user')

    if (!existing) {
      try {
        await PushDevice.create({ token, platform, user: null, active: true, lastSeenAt: new Date() })
      } catch (err) {
        // A concurrent authenticated registration may win the unique-token
        // race. In that case it owns the row and this anonymous request must
        // not overwrite it. Every other database failure remains real.
        if (err?.code !== 11000) throw err
      }
    } else if (!existing.user) {
      await PushDevice.updateOne(
        { token, user: null },
        { $set: { platform, active: true, lastSeenAt: new Date() } }
      )
    }

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

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
    const registration = readRegistration(req.body)
    if (registration.error) {
      return res.status(400).json({ success: false, message: registration.error })
    }
    const { token, platform } = registration

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
 * DELETE /api/push/devices — detach personal ownership on sign-out.
 *
 * Called on sign-out. Scoped to `{ token, user: req.user._id }` so one account
 * cannot silence another account's device by guessing a token — the token is
 * the only thing the client supplies, and ownership is checked against the JWT.
 *
 * The token stays active and anonymous, so public new-listing notifications
 * continue. Invalid-token handling remains the only normal deactivation path.
 */
router.delete('/devices', protect, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''

    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' })
    }

    await PushDevice.updateOne(
      { token, user: req.user._id },
      { $set: { user: null, active: true, lastSeenAt: new Date() } }
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
