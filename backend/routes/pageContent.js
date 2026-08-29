import express from 'express'
import PageContent from '../models/PageContent.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { sanitizePoisonedTranslations, isUnchangedSource, localizeText } from '../utils/autoTranslate.js'
import {
  isKnownPage,
  isKnownSection,
  fieldType,
  isValidImageUrl,
  MAX_TEXT_LENGTH,
} from '../config/pageContentRegistry.js'

const router = express.Router()

/** A JSON object literal — not null, not an array, not a class instance. */
const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const validatePayload = (pageKey, body) => {
  if (!isPlainObject(body)) return { ok: false, message: 'Request body must be an object' }

  const { fields, sections } = body

  if (fields !== undefined && !isPlainObject(fields)) {
    return { ok: false, message: '`fields` must be an object' }
  }
  if (sections !== undefined && !isPlainObject(sections)) {
    return { ok: false, message: '`sections` must be an object' }
  }

  for (const [key, entry] of Object.entries(fields || {})) {
    const registered = fieldType(pageKey, key)
    if (!registered) {
      return { ok: false, message: `Unknown field '${key}' for page '${pageKey}'` }
    }
    if (!isPlainObject(entry)) {
      return { ok: false, message: `Field '${key}' must be an object` }
    }
  
    if (entry.type !== registered) {
      return { ok: false, message: `Field '${key}' must be of type '${registered}'` }
    }

    if (registered === 'text') {
      if (typeof entry.value !== 'string') {
        return { ok: false, message: `Field '${key}' must carry a string 'value'` }
      }
      if (entry.value.length > MAX_TEXT_LENGTH) {
        return { ok: false, message: `Field '${key}' exceeds ${MAX_TEXT_LENGTH} characters` }
      }
    } else {
      if (typeof entry.url !== 'string') {
        return { ok: false, message: `Field '${key}' must carry a string 'url'` }
      }
      if (!isValidImageUrl(entry.url)) {
        return { ok: false, message: `Field '${key}' must be empty, a site-relative path, or an http(s) URL` }
      }
    }
  }

  for (const [key, visible] of Object.entries(sections || {})) {
    
    if (!isKnownSection(pageKey, key)) {
      return { ok: false, message: `Unknown section '${key}' for page '${pageKey}'` }
    }

    if (visible !== true && visible !== false) {
      return { ok: false, message: `Section '${key}' must be true or false` }
    }
  }

  return { ok: true }
}

router.get('/:pageKey', async (req, res, next) => {
  try {
    const { pageKey } = req.params

    if (!isKnownPage(pageKey)) {
      return res.status(404).json({ success: false, message: `Unknown page '${pageKey}'` })
    }

    const doc = await PageContent.findOne({ pageKey }).lean()

    res.json({
      success: true,
      fields: sanitizePoisonedTranslations(doc?.fields || {}),
      sections: doc?.sections || {},
    })
  } catch (err) {
    next(err)
  }
})

router.put(
  '/:pageKey',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('manage_page_content'),
  async (req, res, next) => {
    try {
      const { pageKey } = req.params

      if (!isKnownPage(pageKey)) {
        return res.status(404).json({ success: false, message: `Unknown page '${pageKey}'` })
      }

      const verdict = validatePayload(pageKey, req.body)
      if (!verdict.ok) {
        return res.status(400).json({ success: false, message: verdict.message })
      }

      const incomingFields = req.body.fields || {}
      const incomingSections = req.body.sections || {}

      const doc = (await PageContent.findOne({ pageKey })) || new PageContent({ pageKey, fields: {}, sections: {} })

      // Copied rather than mutated in place: Mixed paths do not reliably
      // report nested mutations to Mongoose, and rebuilding the maps makes the
      // partial-update semantics below explicit rather than incidental.
      const nextFields = { ...(doc.fields || {}) }
      const nextSections = { ...(doc.sections || {}) }

      for (const [key, entry] of Object.entries(incomingFields)) {
        if (entry.type === 'image') {
          nextFields[key] = { type: 'image', url: entry.url }
          continue
        }

        const stored = nextFields[key]

        if (isUnchangedSource(entry.value, stored)) continue

        // `stored` is passed as `existing`, which is what preserves a
        // previously good translation for any language the provider fails on
        // during this save.
        const localized = await localizeText(entry.value, stored)
        nextFields[key] = { type: 'text', ...localized }
      }

      for (const [key, visible] of Object.entries(incomingSections)) {
        nextSections[key] = visible
      }

      doc.fields = nextFields
      doc.sections = nextSections
      doc.markModified('fields')
      doc.markModified('sections')
      await doc.save()

      res.json({
        success: true,
        fields: sanitizePoisonedTranslations(doc.fields),
        sections: doc.sections,
      })
    } catch (err) {
      next(err)
    }
  }
)

export default router
