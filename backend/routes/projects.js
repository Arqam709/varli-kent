import express from 'express'
import Project from '../models/Project.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/projects — public, visible only
router.get('/', async (req, res, next) => {
  try {
    const filter = { visible: true }
    if (req.query.status) filter.status = req.query.status
    const projects = await Project.find(filter).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, projects })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/featured — public active featured project
router.get('/featured', async (req, res, next) => {
  try {
    const project = await Project.findOne({ visible: true, featured: true, status: 'active' }).sort({ order: 1 })
    res.json({ success: true, project: project || null })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/all — admin
router.get('/all', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const projects = await Project.find().sort({ order: 1, createdAt: -1 })
    res.json({ success: true, projects })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/:id
router.get('/:id', async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
    if (!project) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, project })
  } catch (err) {
    next(err)
  }
})

// POST /api/projects — admin create
router.post('/', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const project = await Project.create(req.body)
    res.status(201).json({ success: true, project })
  } catch (err) {
    next(err)
  }
})

// PUT /api/projects/:id — admin update
router.put('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!project) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, project })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/projects/:id — admin delete
router.delete('/:id', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id)
    if (!project) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
