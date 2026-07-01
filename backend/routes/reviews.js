import express from 'express'
import Review from '../models/Review.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/reviews — public, visible only
router.get('/', async (req, res, next) => {
  try {
    const reviews = await Review.find({ visible: true }).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, reviews })
  } catch (err) {
    next(err)
  }
})

// GET /api/reviews/all — admin, all reviews
router.get('/all', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const reviews = await Review.find().sort({ order: 1, createdAt: -1 })
    res.json({ success: true, reviews })
  } catch (err) {
    next(err)
  }
})

// POST /api/reviews — admin create
router.post('/', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const { name, role, text, rating, avatar, visible, order } = req.body
    const review = await Review.create({ name, role, text, rating, avatar, visible, order })
    res.status(201).json({ success: true, review })
  } catch (err) {
    next(err)
  }
})

// PUT /api/reviews/:id — admin update
router.put('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' })
    res.json({ success: true, review })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/reviews/:id — admin delete
router.delete('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id)
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
