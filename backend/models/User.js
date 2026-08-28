import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  provider: {
  type: String,
  enum: ['local', 'google', 'microsoft', 'apple'],
  default: 'local',
},
  role: { type: String, enum: ['owner', 'admin', 'agent', 'user'], default: 'user' },
  permissions: {
    type: [String],
    enum: [
      // Listings
      'add_listing',
      'edit_listing',
      'delete_listing',
      'mark_featured',
      'manage_images',
      // Sales & Rentals
      'manage_sales',
      'manage_rentals',
      // Contacts & Leads
      'view_contacts',
      'reply_contacts',
      // Chats
      'view_chats',
      // Content management
      'manage_reviews',
      'manage_team',
      'manage_projects',
      'manage_showroom',
      'manage_about',
      'manage_partners',
      'manage_studio_colors',
      // Users & Security
      'user_management',
      'manage_passwords',
    ],
    default: [],
  },
  avatar: { type: String, default: '' },
  themePreference: { type: String, default: 'default' },
  favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],
  googleId: { type: String },
  microsoftId: { type: String },
  appleId: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  notificationsLastSeenAt: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
})

// One Google account may own at most one Varlikent account.
//
// Without this, the linking logic in services/googleAuth.js is only as strong
// as its read-then-write sequence: two simultaneous first-time sign-ins can
// both see "no user has this googleId" and both create one, leaving a single
// Google identity attached to two accounts with no way to tell which is real.
// The index turns that race into a duplicate-key error, which the service
// catches and settles by adopting whichever account won.
//
// ── Why partial rather than sparse ─────────────────────────────────────
// The field stays optional: password and Microsoft accounts have no googleId.
//
// `sparse: true` is the usual reflex here and is subtly wrong. Sparse omits
// documents where the field is MISSING, but still indexes those where it is
// explicitly null — so the moment any code writes `googleId: null`, the second
// such user collides with the first and cannot be saved. Keying the partial
// filter on `$type: 'string'` excludes missing AND null, so the constraint
// binds only accounts that genuinely carry a Google identity.
//
// Safe to add: a read-only check of the collection found 15 users, zero
// googleId values of any kind and zero duplicates, so there is nothing for the
// unique constraint to reject when Mongoose builds it on next startup.
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
)

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return
  this.password = await bcrypt.hash(this.password, 12)
})

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

const User = mongoose.model('User', userSchema)
export default User
