import mongoose from 'mongoose'

// One request to remove (demote) a non-protected owner, awaiting a code that
// was emailed to the protected owners. The rules live in
// services/ownerRemoval.js; this file is storage only.
//
// The verification code itself is never stored — only a bcrypt hash of it.

export const OWNER_REMOVAL_STATUSES = ['pending', 'completed', 'locked', 'cancelled', 'expired']

const ownerRemovalRequestSchema = new mongoose.Schema({
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The owner who asked for the code currently in force. Updated when the
  // code is re-issued, so it always names who triggered the latest email.
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  codeHash: { type: String, required: true },
  status: { type: String, enum: OWNER_REMOVAL_STATUSES, default: 'pending' },
  // Guesses made against the code currently in force. Reserved atomically
  // BEFORE the code is compared, so parallel guesses cannot exceed the limit.
  attemptCount: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  // When a code was last emailed. Null when delivery failed outright, so a
  // failed send does not start the resend cooldown.
  lastSentAt: { type: Date, default: null },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedAt: { type: Date, default: null },
  // Every time a code was issued under this request, and by whom. A re-issue
  // overwrites codeHash in place, so the document count alone would not show
  // how many emails one owner has triggered; this does, and the requester
  // rate limit in services/ownerRemoval.js counts it. No code, no hash.
  issuances: {
    type: [{
      _id: false,
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      at: { type: Date, required: true },
    }],
    default: [],
  },
  // Why a request stopped without completing — 'delivery_failed',
  // 'target_changed', 'demotion_failed'. Never holds a code or a hash.
  closedReason: { type: String, default: null },
}, { timestamps: true })

// At most ONE pending request per target, enforced by the database rather
// than by a read-then-write in application code. Two owners asking at the
// same instant cannot both create one: the second insert is a duplicate-key
// error, which the service turns into "a code was just sent".
ownerRemovalRequestSchema.index(
  { targetUser: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
)

ownerRemovalRequestSchema.index({ targetUser: 1, lastSentAt: -1 })

// Serves the requester rate limit's lookup.
ownerRemovalRequestSchema.index({ 'issuances.requestedBy': 1, 'issuances.at': -1 })

// Housekeeping only: finished and abandoned requests are removed 30 days
// after their code expired. Expiry itself is always checked explicitly by the
// service — the TTL monitor runs about once a minute and is never relied on
// to make a code stop working.
ownerRemovalRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export default mongoose.model('OwnerRemovalRequest', ownerRemovalRequestSchema)
