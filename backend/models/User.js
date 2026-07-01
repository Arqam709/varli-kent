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
