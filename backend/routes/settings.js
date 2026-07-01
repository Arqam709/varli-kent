import express from 'express'
import SiteSettings from '../models/SiteSettings.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

const getOrCreate = async () => {
  let s = await SiteSettings.findOne()
  if (!s) s = await SiteSettings.create({})
  return s
}

// GET /api/settings — public
router.get('/', async (req, res, next) => {
  try {
    const settings = await getOrCreate()
    res.json({ success: true, settings })
  } catch (err) {
    next(err)
  }
})

// PUT /api/settings — owner only
router.put('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    let settings = await SiteSettings.findOne()
    if (!settings) {
      settings = await SiteSettings.create(req.body)
    } else {
      Object.assign(settings, req.body)
      await settings.save()
    }
    res.json({ success: true, settings })
  } catch (err) {
    next(err)
  }
})

export default router
