import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export const userFromToken = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET)
  const user = await User.findById(decoded.id).select('-password')

  if (!user || !user.isActive) return null

  return user
}

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' })
    }

    const user = await userFromToken(authHeader.split(' ')[1])

    if (!user) {
      return res.status(401).json({ success: false, message: 'Not authorized, user not found or inactive' })
    }

    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Not authorized, invalid token' })
  }
}

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next()
    }

    const user = await userFromToken(authHeader.split(' ')[1])

    if (user) {
      req.user = user
    }
  } catch {
    // ignore token errors - just continue without user
  }
  next()
}
