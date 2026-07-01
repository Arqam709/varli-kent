import express from 'express'
import TeamMember from '../models/TeamMember.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/team — public, visible members ordered
router.get('/', async (req, res, next) => {
  try {
    const members = await TeamMember.find({ visible: true }).sort({ order: 1, createdAt: 1 })
    res.json({ success: true, members })
  } catch (err) {
    next(err)
  }
})

// GET /api/team/all — admin, all members
router.get('/all', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const members = await TeamMember.find().sort({ order: 1, createdAt: 1 })
    res.json({ success: true, members })
  } catch (err) {
    next(err)
  }
})

// POST /api/team — create
router.post('/', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const member = await TeamMember.create(req.body)
    res.status(201).json({ success: true, member })
  } catch (err) {
    next(err)
  }
})

// PUT /api/team/:id — update
router.put('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const member = await TeamMember.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' })
    res.json({ success: true, member })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/team/:id
router.delete('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const member = await TeamMember.findByIdAndDelete(req.params.id)
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' })
    res.json({ success: true, message: 'Member deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
