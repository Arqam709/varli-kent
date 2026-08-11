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
  role: { type: String, enum: ['owner', 'admin', 'user'], default: 'user' },
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
  // When this user last opened their notifications feed.
  //
  // Intentionally OPTIONAL with no default, so every existing account keeps
  // working without a migration. When it is absent the notification routes
  // fall back to `createdAt`, which means "new since you joined" — a
  // brand-new account therefore starts with zero notifications rather than
  // being shown the entire back catalogue.
  //
  // Deliberately generic ("notifications", not "newPropertyAlerts") so the
  // saved-alert filters planned for a later phase can build on it.
  notificationsLastSeenAt: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
})

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return
  this.password = await bcrypt.hash(this.password, 12)
})

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

const User = mongoose.model('User', userSchema)
export default User
