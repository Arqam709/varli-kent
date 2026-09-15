import express from 'express'
import ContactInterest from '../models/ContactInterest.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import {
  CONTACT_INTEREST_ID_PATTERN,
  CONTACT_INTEREST_LANGUAGES,
  CONTACT_INTEREST_LIMITS,
  deriveContactInterestId,
  normalizeContactInterestValue,
} from '../config/contactInterests.js'
import {
  isDuplicateKeyError,
  listManagedContactInterests,
  listPublicContactInterests,
  toManagedContactInterest,
} from '../services/contactInterests.js'


const router = express.Router()

const canManage = [protect, requireRole('owner', 'admin'), requirePermission('manage_page_content')]

const MUTABLE_FIELDS = new Set(['labels', 'enabled', 'order'])

const badRequest = (res, message) => res.status(400).json({ success: false, message })
const notFound = (res) => res.status(404).json({ success: false, message: 'Contact interest not found' })
const conflict = (res, message) => res.status(409).json({ success: false, message })

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Explicit allow-list. `id` and `value` get their own message, since asking is a mistake worth explaining. */
const rejectUnsupportedFields = (body, immutableMessage) => {
  if (!isPlainObject(body)) return 'Request body must be an object'
  for (const key of Object.keys(body)) {
    if (key === 'id' || key === 'value') return immutableMessage
    if (!MUTABLE_FIELDS.has(key)) return `Unsupported field: ${key}`
  }
  return null
}

const validateLabels = (labels) => {
  if (!isPlainObject(labels)) return { error: 'labels must be an object' }

  const unsupported = Object.keys(labels).find((lang) => !CONTACT_INTEREST_LANGUAGES.includes(lang))
  if (unsupported) return { error: `labels contains an unsupported language: ${unsupported}` }

  const clean = {}
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    const raw = labels[lang]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string') return { error: `labels.${lang} must be a string` }
    const text = raw.trim()
    if (text.length > CONTACT_INTEREST_LIMITS.label) {
      return { error: `labels.${lang} must not exceed ${CONTACT_INTEREST_LIMITS.label} characters` }
    }
    // A blank optional language is simply absent; clients fall back to English.
    if (text) clean[lang] = text
  }

  if (!clean.en) return { error: 'An English label is required' }
  return { value: clean }
}

const validateOrder = (order) =>
  Number.isInteger(order) && order >= 0 && order <= CONTACT_INTEREST_LIMITS.order
    ? { value: order }
    : { error: `order must be a whole number between 0 and ${CONTACT_INTEREST_LIMITS.order}` }

const validateEnabled = (enabled) =>
  typeof enabled === 'boolean' ? { value: enabled } : { error: 'enabled must be true or false' }

/* ══════════════ Public ══════════════ */

router.get('/', async (req, res, next) => {
  try {
    const interests = await listPublicContactInterests()
    res.set('Cache-Control', 'no-cache')
    res.json({ success: true, interests })
  } catch (err) {
    next(err)
  }
})

/* ══════════════ Admin ══════════════ */

router.get('/manage', ...canManage, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.json({ success: true, interests: await listManagedContactInterests() })
  } catch (err) {
    next(err)
  }
})

router.post('/', ...canManage, async (req, res, next) => {
  try {
    const fieldError = rejectUnsupportedFields(
      req.body,
      'id and value are generated from the English label and cannot be supplied'
    )
    if (fieldError) return badRequest(res, fieldError)

    const labels = validateLabels(req.body.labels)
    if (labels.error) return badRequest(res, labels.error)

    const enabled = req.body.enabled === undefined ? { value: true } : validateEnabled(req.body.enabled)
    if (enabled.error) return badRequest(res, enabled.error)

    let order
    if (req.body.order !== undefined) {
      const checked = validateOrder(req.body.order)
      if (checked.error) return badRequest(res, checked.error)
      order = checked.value
    }

    // Both derived HERE, never trusted from the browser.
    const value = normalizeContactInterestValue(labels.value.en)
    const id = deriveContactInterestId(value)
    if (!id) {
      return badRequest(res, 'The English label must start with a Latin letter (A–Z) so a stable id can be generated from it')
    }

    if (await ContactInterest.exists({ id })) {
      return conflict(res, `An interest with the id '${id}' already exists. Edit or re-enable it instead.`)
    }
    if (await ContactInterest.exists({ value })) {
      return conflict(res, `An interest with the value '${value}' already exists. Edit or re-enable it instead.`)
    }

    if (order === undefined) {
      const existing = await ContactInterest.find({}).lean()
      const highest = existing.reduce((max, interest) => Math.max(max, interest.order ?? 0), 0)
      order = Math.min(highest + 1, CONTACT_INTEREST_LIMITS.order)
    }

    let created
    try {
      created = await ContactInterest.create({ id, value, labels: labels.value, order, enabled: enabled.value })
    } catch (err) {
      // Two admins creating the same interest at once: the unique index
      // decides, and the loser gets the same answer as a sequential duplicate.
      if (isDuplicateKeyError(err)) return conflict(res, 'An interest with this id or value already exists')
      if (err?.name === 'ValidationError') return badRequest(res, err.message)
      throw err
    }

    const plain = typeof created?.toObject === 'function' ? created.toObject() : created
    res.status(201).json({ success: true, interest: toManagedContactInterest(plain) })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', ...canManage, async (req, res, next) => {
  try {
    const { id } = req.params
    if (!CONTACT_INTEREST_ID_PATTERN.test(id)) return notFound(res)

    const fieldError = rejectUnsupportedFields(
      req.body,
      'The id and submitted value of an interest cannot be changed after creation'
    )
    if (fieldError) return badRequest(res, fieldError)
    if (Object.keys(req.body).length === 0) return badRequest(res, 'Nothing to update')

    const changes = {}

    if (req.body.labels !== undefined) {
      const labels = validateLabels(req.body.labels)
      if (labels.error) return badRequest(res, labels.error)
      // Replaces the whole labels object, so clearing a language removes it.
      changes.labels = labels.value
    }
    if (req.body.order !== undefined) {
      const order = validateOrder(req.body.order)
      if (order.error) return badRequest(res, order.error)
      changes.order = order.value
    }
    if (req.body.enabled !== undefined) {
      const enabled = validateEnabled(req.body.enabled)
      if (enabled.error) return badRequest(res, enabled.error)
      changes.enabled = enabled.value
    }

    if (changes.enabled === false) {
      const current = await ContactInterest.findOne({ id }).lean()
      if (!current) return notFound(res)

      // An empty public list makes both clients fall back to their bundled
      // defaults — the opposite of what disabling everything would intend.
      if (current.enabled !== false) {
        const othersEnabled = await ContactInterest.countDocuments({ enabled: true, id: { $ne: id } })
        if (othersEnabled === 0) {
          return conflict(res, 'At least one interest must stay enabled, otherwise the Contact form falls back to its built-in list')
        }
      }
    }

    let updated
    try {
      updated = await ContactInterest.findOneAndUpdate(
        { id },
        { $set: changes },
        { returnDocument: 'after', runValidators: true }
      ).lean()
    } catch (err) {
      if (err?.name === 'ValidationError' || err?.name === 'CastError') return badRequest(res, err.message)
      throw err
    }

    if (!updated) return notFound(res)
    res.json({ success: true, interest: toManagedContactInterest(updated) })
  } catch (err) {
    next(err)
  }
})

const noDelete = (req, res) =>
  res.status(405).json({ success: false, message: 'Contact interests cannot be deleted. Disable the interest instead.' })

router.delete('/', noDelete)
router.delete('/:id', noDelete)

export default router
