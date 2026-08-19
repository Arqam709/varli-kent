import express from 'express'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import cloudinary from '../config/cloudinary.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'
import { validateRoleChange, canReceiveAdminPermissions } from '../services/roleManagement.js'
import { adminAgentOption, ADMIN_AGENT_OPTION_FIELDS } from '../services/agentAssignment.js'

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

// Guard for the agent selector on the property form.
//
// Deliberately NOT canManageUsers: an admin granted add_listing/edit_listing
// but not user_management can legitimately create and edit properties, and
// gating the selector behind user_management would leave them staring at an
// empty dropdown on a form they are allowed to submit.
//
// This mirrors the pairing the property routes already use —
// requireRole('owner','admin') + requirePermission('add_listing'|'edit_listing')
// — so exactly the people who can assign an agent can list them.
const PROPERTY_MANAGEMENT_PERMISSIONS = ['add_listing', 'edit_listing']

const canAssignPropertyAgents = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' })
  if (req.user.role === 'owner') return next()
  if (
    req.user.role === 'admin' &&
    PROPERTY_MANAGEMENT_PERMISSIONS.some((perm) => req.user.permissions?.includes(perm))
  ) {
    return next()
  }
  return res.status(403).json({ success: false, message: 'Forbidden: requires property management access' })
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

// GET /api/users/agents — the Assigned Agent selector on the property form.
// MUST be before any '/:id' route so the wildcard cannot swallow 'agents'.
//
// Narrow on purpose. Reusing GET /api/users here would ship every account in
// the system, each with its full permissions array, to anyone editing a
// listing — and would also be unreachable for an admin without
// user_management. This returns active agents and four safe fields.
//
// It includes `email`, which the PUBLIC agent serializer deliberately does
// not: the property form auto-fills Property.agentEmail from the selected
// account, so an admin never retypes it. Two audiences, two serializers —
// adminAgentOption() here, publicAgent() on the listing page.
router.get('/agents', protect, canAssignPropertyAgents, async (req, res, next) => {
  try {
    const agents = await User.find({ role: 'agent', isActive: true })
      .select(ADMIN_AGENT_OPTION_FIELDS)
      .sort({ name: 1 })

    res.json({ success: true, count: agents.length, agents: agents.map(adminAgentOption) })
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

    // A Google-created account has no password at all, and bcrypt.compare()
    // throws outright on an undefined hash rather than returning false — so
    // without this guard the request dies as a 500 instead of an answer.
    //
    // This refuses rather than relaxes: changing a password still requires
    // proving the current one, and an account that has none cannot satisfy
    // that. The deliberate way to establish a first password is the emailed
    // reset link, which proves control of the address. Naming that path is
    // safe here because the request is already authenticated as this exact
    // user — there is nothing to disclose that they do not already know.
    if (!user?.password) {
      return res.status(400).json({
        success: false,
        message:
          'This account has no password yet. Use "Forgot password" to set one.',
      })
    }

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
    const VALID = ['default', 'forest', 'earth', 'navy', 'gold-white', 'sand-travertine', 'rosewood-blush', 'blush-ivory']
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
      { $addToSet: { favourites: req.params.propertyId } }, // $addToSet prevents duplicates, add this value to the array only if it is not already there.
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
      { $pull: { favourites: req.params.propertyId } }, // $pull removes the specified value from the array
      { new: true }
    ).select('-password')
    res.json({ success: true, favourites: user.favourites })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/:id/role
//
// Also the activate/deactivate endpoint — the admin UI PUTs the target's
// unchanged current role alongside an isActive toggle. validateRoleChange()
// treats "same role as now" and "no role sent" as NOT a role change, so
// toggling isActive never has to satisfy the promotion hierarchy.
//
// The rules themselves live in services/roleManagement.js.
router.put('/:id/role', protect, canManageUsers, async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id)
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    // The actor is req.user — resolved from the JWT by `protect`. Nothing
    // about the caller is ever read from the request body.
    const decision = validateRoleChange({
      actor: req.user,
      target,
      requestedRole: req.body.role,
    })

    if (!decision.ok) {
      return res.status(decision.status).json({ success: false, message: decision.message })
    }

    if (decision.roleChanged) {
      target.role = decision.role

      // An agent holds no admin permissions, by definition. Clearing on
      // promotion is what stops a demoted admin keeping delete_listing while
      // wearing the agent label.
      if (decision.role === 'agent') target.permissions = []
    }

    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive must be true or false' })
      }
      target.isActive = req.body.isActive
    }

    await target.save()

    const userObj = target.toObject() //convert the mongoose document to a plain JavaScript object
    delete userObj.password //bcz now we delete the password field from the user object before sending it in the response
    delete userObj.resetPasswordToken
    delete userObj.resetPasswordExpires
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

    let allowedPerms = Array.isArray(req.body.permissions) ? req.body.permissions : []

    // Agents are a customer-facing role, not a staff role — they must never
    // hold admin permissions. Rejecting rather than silently dropping so the
    // caller learns the grant did not happen. An empty array still succeeds,
    // which is what lets an admin clear permissions on someone being moved to
    // the agent role.
    if (!canReceiveAdminPermissions(target.role) && allowedPerms.length > 0) {
      return res.status(403).json({
        success: false,
        message: 'Agents cannot be granted admin permissions',
      })
    }

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
