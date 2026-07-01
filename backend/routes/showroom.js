import express from 'express'
import ShowroomImage from '../models/ShowroomImage.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/showroom/:service — public, visible images for a service
router.get('/:service', async (req, res, next) => {
  try {
    const filter = { serviceType: req.params.service, visible: true }
    if (req.query.style) filter.style = req.query.style
    const images = await ShowroomImage.find(filter).sort({ order: 1, createdAt: 1 })
    res.json({ success: true, images })
  } catch (err) {
    next(err)
  }
})

// GET /api/showroom/:service/all — admin
router.get('/:service/all', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const images = await ShowroomImage.find({ serviceType: req.params.service }).sort({ order: 1, createdAt: 1 })
    res.json({ success: true, images })
  } catch (err) {
    next(err)
  }
})

// POST /api/showroom — create
router.post('/', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const image = await ShowroomImage.create(req.body)
    res.status(201).json({ success: true, image })
  } catch (err) {
    next(err)
  }
})

// PUT /api/showroom/:id — update
router.put('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const image = await ShowroomImage.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!image) return res.status(404).json({ success: false, message: 'Image not found' })
    res.json({ success: true, image })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/showroom/:id
router.delete('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const image = await ShowroomImage.findByIdAndDelete(req.params.id)
    if (!image) return res.status(404).json({ success: false, message: 'Image not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
