import express from 'express'
import Partner from '../models/Partner.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/partners — public, visible partners ordered
router.get('/', async (req, res, next) => {
  try {
    const partners = await Partner.find({ visible: true }).sort({ order: 1, createdAt: 1 })
    res.json({ success: true, partners })
  } catch (err) {
    next(err)
  }
})

// GET /api/partners/all — admin, all partners
router.get('/all', protect, requireRole('owner', 'admin'), requirePermission('manage_partners'), async (req, res, next) => {
  try {
    const partners = await Partner.find().sort({ order: 1, createdAt: 1 })
    res.json({ success: true, partners })
  } catch (err) {
    next(err)
  }
})

// POST /api/partners — create
router.post('/', protect, requireRole('owner', 'admin'), requirePermission('manage_partners'), async (req, res, next) => {
  try {
    const partner = await Partner.create(req.body)
    res.status(201).json({ success: true, partner })
  } catch (err) {
    next(err)
  }
})

// PUT /api/partners/:id — update
router.put('/:id', protect, requireRole('owner', 'admin'), requirePermission('manage_partners'), async (req, res, next) => {
  try {
    const partner = await Partner.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true })
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' })
    res.json({ success: true, partner })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/partners/:id
router.delete('/:id', protect, requireRole('owner', 'admin'), requirePermission('manage_partners'), async (req, res, next) => {
  try {
    const partner = await Partner.findByIdAndDelete(req.params.id)
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' })
    res.json({ success: true, message: 'Partner deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
