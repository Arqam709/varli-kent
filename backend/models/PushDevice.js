import mongoose from 'mongoose'

/**
 * One device that has agreed to receive push notifications.
 *
 * ── Why a collection instead of `User.pushToken` ────────────────────────
 * A single field on User can hold exactly one device, so the moment somebody
 * installs Varlikent on a phone and a tablet the second registration silently
 * destroys the first — and the first device stops receiving anything with no
 * error anywhere. A separate document per device makes "several devices" the
 * normal case rather than a bug, and lets one dead device be deactivated
 * without touching the account.
 *
 * It also keeps push state off the User document, which is read on every single
 * authenticated request by `protect`. Push tokens change independently of the
 * account and have no business being fetched on every request.
 *
 * ── Ownership is a property of the DEVICE, not the account ──────────────
 * `token` is globally unique, deliberately. An Expo push token identifies a
 * physical installation, so if two accounts sign in on the same phone the token
 * must belong to whoever is signed in NOW — otherwise account A keeps receiving
 * notifications while account B is using the device. The registration route
 * therefore reassigns `user` on conflict rather than creating a second row.
 */
const pushDeviceSchema = new mongoose.Schema(
  {
    // Always req.user._id. No route reads an owner from the request body.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * The Expo push token, e.g. `ExponentPushToken[xxxxxxxx]`.
     *
     * Unique so the same installation cannot appear twice, which is what makes
     * registration idempotent and what prevents a user from being notified
     * twice on one device.
     */
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    platform: {
      type: String,
      enum: ['android', 'ios'],
      required: true,
    },

    /**
     * Cleared when Expo reports the token is dead, or when the user signs out.
     *
     * Deactivating rather than deleting means a device that signs back in is
     * one update away from working, and it keeps the unique index meaningful:
     * a returning token matches its existing row instead of racing to insert.
     */
    active: { type: Boolean, default: true },

    /** Refreshed on every registration, so stale devices are identifiable. */
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

/** The send path: every active device for a set of users. */
pushDeviceSchema.index({ user: 1, active: 1 })

const PushDevice = mongoose.model('PushDevice', pushDeviceSchema)
export default PushDevice
