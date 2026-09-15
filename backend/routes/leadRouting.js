import express from 'express'
import LeadRouting from '../models/LeadRouting.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'
import { listRoutableContactInterests } from '../services/contactInterests.js'

const router = express.Router()

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/*
 * Lead routing — owner only, unchanged by Phase 1B.
 *
 * The CATEGORIES are no longer a hardcoded list: they are every registered
 * contact interest (services/contactInterests.js), so an interest an admin
 * creates appears here without a code change.
 *
 * Disabled interests are still listed, marked `enabled: false`, and keep their
 * recipients. Old clients can still submit them, so their leads still need a
 * destination, and re-enabling an interest must find its routing intact. No
 * routing row is ever deleted here.
 */

// GET /api/lead-routing — owner only
router.get('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const [interests, existing] = await Promise.all([listRoutableContactInterests(), LeadRouting.find()])
    const recipientsByType = Object.fromEntries(existing.map((row) => [row.interestType, row.recipients]))

    // One row per interest, including those with nothing configured yet.
    const routing = interests.map((interest) => ({
      interestType: interest.value,
      label: interest.labels.en,
      enabled: interest.enabled,
      recipients: recipientsByType[interest.value] || [],
    }))
    res.json({ success: true, routing })
  } catch (err) {
    next(err)
  }
})

// PUT /api/lead-routing — owner only, replace the recipients of the listed types
router.put('/', protect, requireRole('owner'), async (req, res, next) => {
  try {
    const { routing } = req.body // array of { interestType, recipients }
    if (!Array.isArray(routing)) return res.status(400).json({ success: false, message: 'routing must be an array' })

    const registered = new Set((await listRoutableContactInterests()).map((interest) => interest.value))

    // Validate EVERYTHING before writing anything, so a bad row cannot leave
    // the configuration half-saved.
    const updates = []
    for (const item of routing) {
      if (!isPlainObject(item) || typeof item.interestType !== 'string' || !registered.has(item.interestType)) {
        const name = isPlainObject(item) ? String(item.interestType) : String(item)
        return res.status(400).json({ success: false, message: `Unknown interest type: ${name}` })
      }
      if (!Array.isArray(item.recipients)) {
        return res.status(400).json({ success: false, message: `recipients for ${item.interestType} must be an array` })
      }

      const recipients = []
      for (const recipient of item.recipients) {
        if (!isPlainObject(recipient)) {
          return res.status(400).json({ success: false, message: `Invalid recipient for ${item.interestType}` })
        }
        const email = typeof recipient.email === 'string' ? recipient.email.trim() : ''
        const label = typeof recipient.label === 'string' ? recipient.label.trim() : ''
        // A row added in the editor and never filled in is not a recipient.
        if (!email && !label) continue
        if (!email) {
          return res.status(400).json({ success: false, message: `Every recipient for ${item.interestType} needs an email address` })
        }
        recipients.push({ email, label })
      }

      updates.push({ interestType: item.interestType, recipients })
    }

    for (const { interestType, recipients } of updates) {
      await LeadRouting.findOneAndUpdate(
        { interestType },
        { recipients },
        { upsert: true, new: true }
      )
    }
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
