import express from 'express'
import AboutContent from '../models/AboutContent.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { localizeText, sanitizePoisonedTranslations } from '../utils/autoTranslate.js'

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

/*
 * The localized prose fields at the top level of the document. Donor list,
 * unchanged. Everything NOT named here keeps its stored type — missionImage
 * is a URL, and translating it would break the page.
 */
export const LOCALIZED_TOP_LEVEL_FIELDS = [
  'heroLabel',
  'heroHeading',
  'heroSubtext',
  'missionLabel',
  'missionHeading',
  'missionParagraph1',
  'missionParagraph2',
  'teamLabel',
  'teamHeading',
]

/*
 * Translates one field, carrying the previously stored value forward.
 *
 * Only a PLAIN STRING is translated. An incoming value that is already a
 * localized object means the admin form sent the stored object back
 * untouched, so re-translating it would spend six requests to produce what
 * is already there — and, while the quota is exhausted, would degrade it.
 *
 * `previous` is what makes a failed target non-destructive; see
 * utils/autoTranslate.js's localizeText.
 */
const localizeIfString = async (value, previous, fetchImpl) =>
  typeof value === 'string' ? localizeText(value, previous, fetchImpl) : value

/**
 * Localizes every localizable field on an incoming About payload.
 *
 * Structure follows the donor exactly — top-level fields, stats[].label,
 * team[].role, contentBlocks[].heading and contentBlocks[].paragraphs[].
 * Nothing recurses into arbitrary strings: only these declared fields are
 * ever sent to the translation provider, so a URL, an ObjectId, an image
 * path or a stat value can never be translated by accident.
 *
 * `existing` is the currently stored document. Array items are matched by
 * INDEX, which is how the admin form presents them — it edits a list in
 * place, so row 2's previous translations belong to row 2.
 *
 * `fetchImpl` exists so tests can drive the provider deterministically and
 * offline; production never passes it.
 */
export const localizeAboutPayload = async (body, existing = {}, fetchImpl = fetch) => {
  const out = { ...body }
  const prev = existing || {}

  for (const key of LOCALIZED_TOP_LEVEL_FIELDS) {
    if (key in out) out[key] = await localizeIfString(out[key], prev[key], fetchImpl)
  }

  if (Array.isArray(out.stats)) {
    const prevStats = Array.isArray(prev.stats) ? prev.stats : []
    out.stats = await Promise.all(
      out.stats.map(async (stat, i) => ({
        ...stat,
        label: await localizeIfString(stat?.label, prevStats[i]?.label, fetchImpl),
      }))
    )
  }

  if (Array.isArray(out.team)) {
    const prevTeam = Array.isArray(prev.team) ? prev.team : []
    out.team = await Promise.all(
      out.team.map(async (member, i) => ({
        ...member,
        role: await localizeIfString(member?.role, prevTeam[i]?.role, fetchImpl),
      }))
    )
  }

  if (Array.isArray(out.contentBlocks)) {
    const prevBlocks = Array.isArray(prev.contentBlocks) ? prev.contentBlocks : []
    out.contentBlocks = await Promise.all(
      out.contentBlocks.map(async (block, bi) => {
        const prevBlock = prevBlocks[bi] || {}
        const prevParagraphs = Array.isArray(prevBlock.paragraphs) ? prevBlock.paragraphs : []

        return {
          ...block,
          heading: await localizeIfString(block?.heading, prevBlock.heading, fetchImpl),
          paragraphs: Array.isArray(block?.paragraphs)
            ? await Promise.all(
                block.paragraphs.map((p, pi) => localizeIfString(p, prevParagraphs[pi], fetchImpl))
              )
            : block?.paragraphs,
        }
      })
    )
  }

  return out
}

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
    // Strips any provider warning already stored on the document, so text
    // that was poisoned before the write path guarded against it can never
    // render as content. The client resolver filters the same pattern again.
    const about = sanitizePoisonedTranslations(doc.toObject ? doc.toObject() : doc)
    res.json({ success: true, about })
  } catch (err) {
    next(err)
  }
})

// PUT /api/about — admin update entire document.
// Guards unchanged: protect + requireRole('owner','admin') + manage_about.
router.put('/', protect, requireRole('owner', 'admin'), requirePermission('manage_about'), async (req, res, next) => {
  try {
    let doc = await AboutContent.findOne()

    const existing = doc ? (doc.toObject ? doc.toObject() : doc) : {}
    const localizedBody = await localizeAboutPayload(req.body, existing)

    if (!doc) {
      doc = await AboutContent.create(localizedBody)
    } else {
      Object.assign(doc, localizedBody)
      // Mixed fields are not change-tracked by Mongoose: mutating or
      // reassigning one does not mark the path dirty, so save() would write
      // nothing. Every localized field is Mixed, so each must be flagged
      // explicitly or admin edits would silently no-op.
      for (const key of LOCALIZED_TOP_LEVEL_FIELDS) {
        if (key in localizedBody) doc.markModified(key)
      }
      for (const key of ['stats', 'team', 'contentBlocks']) {
        if (key in localizedBody) doc.markModified(key)
      }
      await doc.save()
    }

    const about = sanitizePoisonedTranslations(doc.toObject ? doc.toObject() : doc)
    res.json({ success: true, about })
  } catch (err) {
    next(err)
  }
})

export default router
