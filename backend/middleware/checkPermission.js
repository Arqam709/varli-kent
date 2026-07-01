export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' })
    }
    next()
  }
}

export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ success: false, message: 'Forbidden: not authenticated' })
    }
    if (req.user.role === 'owner' || req.user.permissions.includes(permission)) {
      return next()
    }
    return res.status(403).json({ success: false, message: `Forbidden: missing permission '${permission}'` })
  }
}
