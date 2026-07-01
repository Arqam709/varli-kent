import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { body, validationResult } from 'express-validator'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { OAuth2Client } from 'google-auth-library'
import { sendPasswordResetEmail } from '../utils/email.js'
import jwksClient from 'jwks-rsa'

const router = express.Router()

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' })


const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)



const microsoftJwksClient = jwksClient({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  rateLimit: true,
})

const getMicrosoftSigningKey = (header, callback) => {
  microsoftJwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err)

    const signingKey = key.getPublicKey()
    callback(null, signingKey)
  })
}

const verifyMicrosoftIdToken = (idToken) => {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getMicrosoftSigningKey,
      {
  audience: process.env.MICROSOFT_CLIENT_ID,
  algorithms: ['RS256'],
  clockTolerance: 60 * 60 * 4,
},
      (err, decoded) => {
        if (err) return reject(err)

        const expectedIssuer = `https://login.microsoftonline.com/${decoded.tid}/v2.0`

        if (decoded.iss !== expectedIssuer) {
          return reject(new Error('Invalid Microsoft token issuer'))
        }

        resolve(decoded)
      }
    )
  })
}

// POST /api/auth/register
router.post(
  '/register',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() })
      }

      const { name, email, password } = req.body

      const existing = await User.findOne({ email })
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already in use' })
      }

      const user = await User.create({ name, email, password, role: 'user' })
      const token = signToken(user._id)

      const userObj = user.toObject()
      delete userObj.password

      res.status(201).json({ success: true, token, user: userObj })
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() })
      }

      const { email, password } = req.body

      const user = await User.findOne({ email })
      if (!user || !user.password) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' })
      }

      const isMatch = await user.comparePassword(password)
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' })
      }

      const token = signToken(user._id)
      const userObj = user.toObject()
      delete userObj.password

      res.json({ success: true, token, user: userObj })
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ success: true, user: req.user })
})

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out' })
})

// POST /api/auth/forgot-password
// Generates a reset token, stores it hashed on the user, and emails a link.
// Always returns 200 so we don't leak whether an email exists.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' })

    const user = await User.findOne({ email: email.toLowerCase() })

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex')

      user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex')
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await user.save({ validateBeforeSave: false })

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`
      const emailSent = await sendPasswordResetEmail(user.email, resetUrl)
      console.log('[forgot-password] email sent:', emailSent, '| to:', user.email, '| url:', resetUrl)
    }

    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body
    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' })
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }

    const hashed = crypto.createHash('sha256').update(token).digest('hex')
    const user = await User.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: new Date() },
    })

    if (!user) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' })
    }

    user.password = password
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()

    res.json({ success: true, message: 'Password has been reset. You can now log in.' })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/google
// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { accessToken } = req.body

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Google access token is required',
      })
    }

    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const googleUser = await googleRes.json()

    if (!googleUser.email) {
      return res.status(401).json({
        success: false,
        message: 'Google authentication failed',
      })
    }

    let user = await User.findOne({ email: googleUser.email.toLowerCase() })

    if (!user) {
      user = await User.create({
        name: googleUser.name,
        email: googleUser.email.toLowerCase(),
        avatar: googleUser.picture,
        password: Math.random().toString(36).slice(-12),
      })
    }

    const token = signToken(user._id)

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    console.log('Google auth error:', error)
    res.status(500).json({
      success: false,
      message: 'Google login failed',
    })
  }
})

// POST /api/auth/apple
router.post('/apple', (req, res) => {
  res.json({ message: 'Apple OAuth - configure APPLE_CLIENT_ID in .env' })
})

// POST /api/auth/microsoft
// POST /api/auth/microsoft
router.post('/microsoft', async (req, res) => {
  try {
    const { idToken } = req.body

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Microsoft token is required',
      })
    }

    if (!process.env.MICROSOFT_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        message: 'Microsoft client ID is missing on server',
      })
    }

    const microsoftUser = await verifyMicrosoftIdToken(idToken)

    const email = (
      microsoftUser.preferred_username ||
      microsoftUser.email ||
      ''
    ).toLowerCase()

    if (!email) {
      return res.status(401).json({
        success: false,
        message: 'Microsoft account email not found',
      })
    }

    let user = await User.findOne({ email })

    if (!user) {
      user = await User.create({
        name: microsoftUser.name || email.split('@')[0],
        email,
        avatar: null,
        password: crypto.randomBytes(24).toString('hex'),
        role: 'user',
      })
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your account is deactivated',
      })
    }

    const token = signToken(user._id)

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    console.log('Microsoft auth error:', error)

    res.status(401).json({
      success: false,
      message: 'Microsoft login failed',
    })
  }
})

export default router
