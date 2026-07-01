import express from 'express'
import LeadRouting from '../models/LeadRouting.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

const ALL_TYPES = ['Buying', 'Selling', 'Renting', 'Renovation', 'Interior Design', 'Architecture', 'General']

// GET /api/lead-routing — owner only
router.get('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const existing = await LeadRouting.find()
    // Return full list including types with no config yet
    const map = Object.fromEntries(existing.map(r => [r.interestType, r.recipients]))
    
    const result = ALL_TYPES.map(type => ({
      interestType: type,
      recipients: map[type] || [],
    }))
    res.json({ success: true, routing: result })
  } catch (err) {
    next(err)
  }
})

// PUT /api/lead-routing — owner only, replace all routing config
router.put('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const { routing } = req.body // array of { interestType, recipients }
    if (!Array.isArray(routing)) return res.status(400).json({ success: false, message: 'routing must be an array' })

    for (const item of routing) {
      await LeadRouting.findOneAndUpdate(
        { interestType: item.interestType },
        { recipients: item.recipients },
        { upsert: true, new: true }
      )
    }
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
