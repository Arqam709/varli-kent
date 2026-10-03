import express from 'express'
import ActivityLog from '../models/ActivityLog.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'
import { isProtectedOwner } from '../config/protectedOwners.js'
import { OWNER_REMOVAL_IN_PROGRESS_ACTIONS } from '../services/ownerRemoval.js'

const router = express.Router()

// GET /api/activity — owner only. Most recent actions first.
//
// One class of entry is narrower than owner-only: an owner removal that is
// still in progress (requested, a wrong code, a lock, a failed send) is shown
// to protected owners alone. Every other entry — a COMPLETED owner removal
// included — is visible to all owners exactly as before.
//
// The exclusion is part of the query rather than applied to the result, so a
// non-protected owner still receives a full page of `limit` entries.
router.get('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 300)
    const filter = isProtectedOwner(req.user)
      ? {}
      : { action: { $nin: OWNER_REMOVAL_IN_PROGRESS_ACTIONS } }
    const logs = await ActivityLog.find(filter).sort({ createdAt: -1 }).limit(limit)
    res.json({ success: true, logs })
  } catch (err) {
    next(err)
  }
})

export default router
