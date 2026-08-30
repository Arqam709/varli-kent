import express from 'express'
import TeamMember from '../models/TeamMember.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { localizeFields, sanitizePoisonedTranslations } from '../utils/autoTranslate.js'

const router = express.Router()

/*
 * Wave 12A2. `name` is a person's name and is never translated; `photo`,
 * `order` and `visible` are not prose.
 */
/*
 * Wave 14A adds longBio. Because localizeFields() already receives the
 * stored document on update, adding the key here is all that is needed for
 * the two properties that matter: an unchanged longBio spends no provider
 * quota (isUnchangedSource), and a provider failure on one language keeps the
 * translation that language already had.
 */
export const LOCALIZED_TEAM_FIELDS = ['role', 'bio', 'longBio']

export const normalizeTeamRoleBody = (body) => {
  if (!body || typeof body !== 'object' || typeof body.role !== 'string') return body
  return { ...body, role: body.role.trim() }
}

// GET /api/team — public, visible members ordered
router.get('/', async (req, res, next) => {
  try {
    const members = await TeamMember.find({ visible: true }).sort({ order: 1, createdAt: 1 })
    // Strips any MyMemory warning already stored on a document, so text
    // poisoned before the write path guarded against it can never render as
    // content. The client resolver filters the same pattern again.
    res.json({ success: true, members: sanitizePoisonedTranslations(members.map((d) => d.toObject())) })
  } catch (err) {
    next(err)
  }
})

// GET /api/team/all — admin, all members
router.get('/all', protect, requireRole('owner', 'admin'), requirePermission('manage_team'), async (req, res, next) => {
  try {
    const members = await TeamMember.find().sort({ order: 1, createdAt: 1 })
    res.json({ success: true, members })
  } catch (err) {
    next(err)
  }
})

// POST /api/team — create
router.post('/', protect, requireRole('owner', 'admin'), requirePermission('manage_team'), async (req, res, next) => {
  try {
    const localizedBody = await localizeFields(normalizeTeamRoleBody(req.body), LOCALIZED_TEAM_FIELDS)
    const member = await TeamMember.create(localizedBody)
    res.status(201).json({ success: true, member })
  } catch (err) {
    next(err)
  }
})

// PUT /api/team/:id — update
router.put('/:id', protect, requireRole('owner', 'admin'), requirePermission('manage_team'), async (req, res, next) => {
  try {
    /*
     * The existing document is read BEFORE translating, by _id.
     *
     * The donor updates straight through findByIdAndUpdate, so its
     * localizeText never sees what is already stored — a save made while the
     * provider is refusing requests overwrites every good translation. Two
     * round-trips is the price of not doing that.
     *
     * Identity is the document's own _id, never a list position: reordering
     * or deleting a member would otherwise hand one person's translations to
     * another.
     */
    const existing = await TeamMember.findById(req.params.id)
    if (!existing) return res.status(404).json({ success: false, message: 'Member not found' })

    const localizedBody = await localizeFields(
      normalizeTeamRoleBody(req.body),
      LOCALIZED_TEAM_FIELDS,
      existing.toObject()
    )

    const member = await TeamMember.findByIdAndUpdate(req.params.id, localizedBody, { new: true, runValidators: true })
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' })
    res.json({ success: true, member })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/team/:id
router.delete('/:id', protect, requireRole('owner', 'admin'), requirePermission('manage_team'), async (req, res, next) => {
  try {
    const member = await TeamMember.findByIdAndDelete(req.params.id)
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' })
    res.json({ success: true, message: 'Member deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
