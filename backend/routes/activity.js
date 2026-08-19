import express from 'express'
import ActivityLog from '../models/ActivityLog.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/activity — owner only. Most recent actions first.
router.get('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 300)
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(limit)
    res.json({ success: true, logs })
  } catch (err) {
    next(err)
  }
})

export default router
