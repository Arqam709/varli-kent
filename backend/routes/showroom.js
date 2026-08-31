import express from 'express'
import ShowroomImage from '../models/ShowroomImage.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { localizeFields, sanitizePoisonedTranslations } from '../utils/autoTranslate.js'

const router = express.Router()

/*
 * Wave 14B adds title and detailText. Both write paths already pass the
 * stored document into localizeFields on update, so adding the keys here is
 * all that is needed for the two properties that matter: unchanged prose
 * spends no provider quota (isUnchangedSource), and a provider failure on
 * one language keeps the translation that language already had.
 *
 * `style` stays out deliberately — the public route matches it EXACTLY
 * against req.query.style, so translating it would break that filter.
 */
export const LOCALIZED_SHOWROOM_FIELDS = ['title', 'caption', 'detailText']

// GET /api/showroom/:service — public, visible images for a service
router.get('/:service', async (req, res, next) => {
  try {
    const filter = { serviceType: req.params.service, visible: true }
    if (req.query.style) filter.style = req.query.style
    const images = await ShowroomImage.find(filter).sort({ order: 1, createdAt: 1 })
    // See routes/team.js — strips provider garbage stored before the write
    // path guarded against it.
    res.json({ success: true, images: sanitizePoisonedTranslations(images.map((d) => d.toObject())) })
  } catch (err) {
    next(err)
  }
})

// GET /api/showroom/:service/all — admin
router.get('/:service/all', protect, requireRole('owner', 'admin'), requirePermission('manage_showroom'), async (req, res, next) => {
  try {
    const images = await ShowroomImage.find({ serviceType: req.params.service }).sort({ order: 1, createdAt: 1 })
    res.json({ success: true, images })
  } catch (err) {
    next(err)
  }
})

// POST /api/showroom — create
router.post('/', protect, requireRole('owner', 'admin'), requirePermission('manage_showroom'), async (req, res, next) => {
  try {
    const localizedBody = await localizeFields(req.body, LOCALIZED_SHOWROOM_FIELDS)
    const image = await ShowroomImage.create(localizedBody)
    res.status(201).json({ success: true, image })
  } catch (err) {
    next(err)
  }
})

// PUT /api/showroom/:id — update
router.put('/:id', protect, requireRole('owner', 'admin'), requirePermission('manage_showroom'), async (req, res, next) => {
  try {
    // Existing document read by _id first, so a provider failure cannot
    // destroy translations that already exist. See routes/team.js.
    const existing = await ShowroomImage.findById(req.params.id)
    if (!existing) return res.status(404).json({ success: false, message: 'Image not found' })

    const localizedBody = await localizeFields(req.body, LOCALIZED_SHOWROOM_FIELDS, existing.toObject())

    const image = await ShowroomImage.findByIdAndUpdate(req.params.id, localizedBody, { new: true, runValidators: true })
    if (!image) return res.status(404).json({ success: false, message: 'Image not found' })
    res.json({ success: true, image })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/showroom/:id
router.delete('/:id', protect, requireRole('owner', 'admin'), requirePermission('manage_showroom'), async (req, res, next) => {
  try {
    const image = await ShowroomImage.findByIdAndDelete(req.params.id)
    if (!image) return res.status(404).json({ success: false, message: 'Image not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
