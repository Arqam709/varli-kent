import express from 'express'
import AboutContent from '../models/AboutContent.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

const DEFAULT_STATS = [
  { value: '10+', label: 'Years Experience', order: 0 },
  { value: '500+', label: 'Properties Listed', order: 1 },
  { value: '120+', label: 'Happy Clients', order: 2 },
  { value: '50+', label: 'Districts Covered', order: 3 },
]

const DEFAULT_TEAM = [
  { name: 'Selin Kaya', role: 'Senior Agent', avatar: '', order: 0 },
  { name: 'Mert Demir', role: 'Investment Advisor', avatar: '', order: 1 },
  { name: 'Lina Öztürk', role: 'Rental Specialist', avatar: '', order: 2 },
]

async function getOrCreate() {
  let doc = await AboutContent.findOne()
  if (!doc) {
    doc = await AboutContent.create({ stats: DEFAULT_STATS, team: DEFAULT_TEAM })
  }
  return doc
}

// GET /api/about — public
router.get('/', async (req, res, next) => {
  try {
    const doc = await getOrCreate()
    res.json({ success: true, about: doc })
  } catch (err) {
    next(err)
  }
})

// PUT /api/about — admin update entire document
router.put('/', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    let doc = await AboutContent.findOne()
    if (!doc) {
      doc = await AboutContent.create(req.body)
    } else {
      Object.assign(doc, req.body)
      await doc.save()
    }
    res.json({ success: true, about: doc })
  } catch (err) {
    next(err)
  }
})

export default router
