import express from 'express'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import cloudinary from '../config/cloudinary.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

const uploadToCloudinary = (buffer, folder) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err) return reject(err)
      resolve(result)
    }).end(buffer)
  })

const canManageUsers = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' })
  if (req.user.role === 'owner' || req.user.permissions?.includes('user_management')) return next()
  return res.status(403).json({ success: false, message: 'Forbidden: requires owner role or user_management permission' })
}

const canChangePasswords = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' })
  if (req.user.role === 'owner' || req.user.permissions?.includes('manage_passwords')) return next()
  return res.status(403).json({ success: false, message: 'Forbidden: requires owner role or manage_passwords permission' })
}

// GET /api/users
router.get('/', protect, canManageUsers, async (req, res, next) => {
  try {
    const users = await User.find().select('-password -resetPasswordToken -resetPasswordExpires')
    res.json({ success: true, count: users.length, users })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/me/avatar — upload profile picture
router.put('/me/avatar', protect, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image provided' })
    const result = await uploadToCloudinary(req.file.buffer, 'varlikent/avatars')
    const user = await User.findByIdAndUpdate(req.user._id, { avatar: result.secure_url }, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires')
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/me/profile — any logged-in user updates their own name/email
router.put('/me/profile', protect, async (req, res, next) => {
  try {
    const { name, email } = req.body
    if (!name && !email) return res.status(400).json({ success: false, message: 'Nothing to update' })

    const updates = {}
    if (name?.trim()) updates.name = name.trim()
    if (email?.trim()) {
      const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user._id } })
      if (existing) return res.status(400).json({ success: false, message: 'Email already in use' })
      updates.email = email.toLowerCase().trim()
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires')
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/me/password — any logged-in user changes their own password (requires current password)
router.put('/me/password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All password fields are required' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' })
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match' })
    }

    const user = await User.findById(req.user._id)
    const isMatch = await user.comparePassword(currentPassword)
    if (!isMatch) return res.status(401).json({ success: false, message: 'Current password is incorrect' })

    user.password = newPassword
    await user.save()

    res.json({ success: true, message: 'Password updated successfully' })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/me/theme — save theme preference
router.put('/me/theme', protect, async (req, res, next) => {
  try {
    const { theme } = req.body
    const VALID = ['default', 'classic', 'dark', 'light', 'forest']
    if (!VALID.includes(theme)) return res.status(400).json({ success: false, message: 'Invalid theme' })
    const user = await User.findByIdAndUpdate(req.user._id, { themePreference: theme }, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires')
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
})

// GET /api/users/favourites - MUST be before /:id
router.get('/favourites', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('favourites')
    res.json({ success: true, favourites: user.favourites })
  } catch (err) {
    next(err)
  }
})

// POST /api/users/favourites/:propertyId
router.post('/favourites/:propertyId', protect, async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { favourites: req.params.propertyId } },
      { new: true }
    ).select('-password')
    res.json({ success: true, favourites: user.favourites })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/users/favourites/:propertyId
router.delete('/favourites/:propertyId', protect, async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { favourites: req.params.propertyId } },
      { new: true }
    ).select('-password')
    res.json({ success: true, favourites: user.favourites })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/:id/role
router.put('/:id/role', protect, canManageUsers, async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id)
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    if (target.role === 'owner') {
      return res.status(403).json({ success: false, message: 'Cannot change the role of another owner' })
    }

    target.role = req.body.role
    if (req.body.isActive !== undefined) target.isActive = req.body.isActive
    await target.save()

    const userObj = target.toObject()
    delete userObj.password
    res.json({ success: true, user: userObj })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/:id/permissions
// Owner can set any permissions. Admin with user_management can set permissions only within their own permission set.
router.put('/:id/permissions', protect, canManageUsers, async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id)
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    if (target.role === 'owner') {
      return res.status(403).json({ success: false, message: 'Cannot modify owner permissions' })
    }

    let allowedPerms = req.body.permissions
    // Non-owner admins with user_management can only grant permissions they themselves hold
    if (req.user.role !== 'owner') {
      allowedPerms = allowedPerms.filter(p => req.user.permissions?.includes(p))
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { permissions: allowedPerms },
      { new: true, runValidators: true }
    ).select('-password -resetPasswordToken -resetPasswordExpires')

    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/:id/password — manual password change by admin/owner
router.put('/:id/password', protect, canChangePasswords, async (req, res, next) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' })
    }

    const target = await User.findById(req.params.id)
    if (!target) return res.status(404).json({ success: false, message: 'User not found' })

    // Only owner can change another owner's password
    if (target.role === 'owner' && req.user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Cannot change an owner\'s password' })
    }

    target.password = newPassword
    await target.save()

    res.json({ success: true, message: 'Password updated successfully' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/users/:id
router.delete('/:id', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id)
    if (!target) return res.status(404).json({ success: false, message: 'User not found' })
    if (target.role === 'owner') return res.status(403).json({ success: false, message: 'Cannot delete an owner account' })
    if (target._id.toString() === req.user._id.toString()) return res.status(403).json({ success: false, message: 'Cannot delete your own account' })

    await User.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'User permanently deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
