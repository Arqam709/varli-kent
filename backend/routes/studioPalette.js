import express from 'express'
import StudioPalette from '../models/StudioPalette.js'
import { protect } from '../middleware/auth.js'
import { requirePermission, requireRole } from '../middleware/checkPermission.js'

const router = express.Router()

const PAGE_KEYS = new Set(['renovation', 'interior-design'])
const ALLOWED_BODY_KEYS = new Set(['materials', 'wallFinishes', 'floorFinishes'])
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const LIMITS = {
  name: 80,
  label: 80,
  image: 2048,
  materials: 24,
  wallFinishes: 16,
  floorFinishes: 16,
}

const badRequest = (res, message) => res.status(400).json({ success: false, message })

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
)

const validateText = (value, field, maximum) => {
  if (typeof value !== 'string') return { error: `${field} must be a string` }
  const trimmed = value.trim()
  if (!trimmed) return { error: `${field} must not be empty` }
  if (trimmed.length > maximum) return { error: `${field} must not exceed ${maximum} characters` }
  return { value: trimmed }
}

const validateColor = (value, field) => {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    return { error: `${field} must be a six-digit hex color in #RRGGBB format` }
  }
  return { value }
}

const validateImage = (value) => {
  if (value === undefined || value === '') return { value: '' }
  if (typeof value !== 'string') return { error: 'image must be a string' }
  const trimmed = value.trim()
  if (!trimmed) return { value: '' }
  if (trimmed.length > LIMITS.image) return { error: `image must not exceed ${LIMITS.image} characters` }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'image must be empty or a valid HTTP(S) URL' }
    }
  } catch {
    return { error: 'image must be empty or a valid HTTP(S) URL' }
  }
  return { value: trimmed }
}

const unsupportedEntryKey = (entry, allowedKeys, field) => {
  const key = Object.keys(entry).find((candidate) => !allowedKeys.includes(candidate))
  return key ? `${field} contains unsupported field: ${key}` : null
}

const validateMaterials = (value) => {
  if (!Array.isArray(value)) return { error: 'materials must be an array' }
  if (value.length < 1 || value.length > LIMITS.materials) {
    return { error: `materials must contain between 1 and ${LIMITS.materials} entries` }
  }

  const sanitized = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    const field = `materials[${index}]`
    if (!isPlainObject(entry)) return { error: `${field} must be an object` }
    const keyError = unsupportedEntryKey(entry, ['name', 'color', 'image'], field)
    if (keyError) return { error: keyError }
    const name = validateText(entry.name, `${field}.name`, LIMITS.name)
    if (name.error) return name
    const color = validateColor(entry.color, `${field}.color`)
    if (color.error) return color
    const image = validateImage(entry.image)
    if (image.error) return { error: `${field}.${image.error}` }
    sanitized.push({ name: name.value, color: color.value, image: image.value })
  }
  return { value: sanitized }
}

const validateFinishes = (value, group) => {
  if (!Array.isArray(value)) return { error: `${group} must be an array` }
  if (value.length < 1 || value.length > LIMITS[group]) {
    return { error: `${group} must contain between 1 and ${LIMITS[group]} entries` }
  }

  const sanitized = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    const field = `${group}[${index}]`
    if (!isPlainObject(entry)) return { error: `${field} must be an object` }
    const keyError = unsupportedEntryKey(entry, ['label', 'color'], field)
    if (keyError) return { error: keyError }
    const label = validateText(entry.label, `${field}.label`, LIMITS.label)
    if (label.error) return label
    const color = validateColor(entry.color, `${field}.color`)
    if (color.error) return color
    sanitized.push({ label: label.value, color: color.value })
  }
  return { value: sanitized }
}

const validateRequest = (body) => {
  if (!isPlainObject(body)) return { error: 'Request body must be an object' }
  const keys = Object.keys(body)
  if (keys.length === 0) return { error: 'At least one palette group is required' }
  const unknownKey = keys.find((key) => !ALLOWED_BODY_KEYS.has(key))
  if (unknownKey) return { error: `Unsupported field: ${unknownKey}` }

  const updates = {}
  for (const key of keys) {
    const result = key === 'materials'
      ? validateMaterials(body[key])
      : validateFinishes(body[key], key)
    if (result.error) return result
    updates[key] = result.value
  }
  return { value: updates }
}

router.get('/:pageKey', async (req, res) => {
  try {
    if (!PAGE_KEYS.has(req.params.pageKey)) return badRequest(res, 'Invalid page key')
    const palette = await StudioPalette.findOne({ pageKey: req.params.pageKey })
    return res.json({ success: true, palette })
  } catch (error) {
    console.error('Get studio palette error:', error)
    return res.status(500).json({ success: false, message: 'Failed to get studio palette' })
  }
})

router.put(
  '/:pageKey',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('manage_studio_colors'),
  async (req, res) => {
    try {
      if (!PAGE_KEYS.has(req.params.pageKey)) return badRequest(res, 'Invalid page key')
      const validation = validateRequest(req.body)
      if (validation.error) return badRequest(res, validation.error)

      let palette = await StudioPalette.findOne({ pageKey: req.params.pageKey })
      if (!palette) palette = new StudioPalette({ pageKey: req.params.pageKey })
      for (const [key, value] of Object.entries(validation.value)) palette[key] = value
      await palette.save()
      return res.json({ success: true, palette })
    } catch (error) {
      console.error('Update studio palette error:', error)
      return res.status(500).json({ success: false, message: 'Failed to update studio palette' })
    }
  },
)

router.delete(
  '/:pageKey',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('manage_studio_colors'),
  async (req, res) => {
    try {
      if (!PAGE_KEYS.has(req.params.pageKey)) return badRequest(res, 'Invalid page key')
      await StudioPalette.findOneAndDelete({ pageKey: req.params.pageKey })
      return res.json({ success: true })
    } catch (error) {
      console.error('Delete studio palette error:', error)
      return res.status(500).json({ success: false, message: 'Failed to delete studio palette' })
    }
  },
)

export default router
