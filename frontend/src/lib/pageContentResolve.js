import { localizedText, isUsable } from './localizedText.js'

export const resolveCmsField = (field, language, fallback) => {
  if (!field) return fallback

  if (field.type === 'image') {
    // A URL is not prose: no language, no poison filtering, no localizedText.
    return typeof field.url === 'string' && field.url.trim() !== '' ? field.url : fallback
  }

  // Deliberately NOT localizedText() here: its chain falls through to English
  // on a missing language, which is the one answer that must not outrank the
  // caller's already-translated fallback. isUsable is imported from that same
  // module, so "usable" — including the poison rule — has one definition.
  if (isUsable(field[language])) return field[language]

  if (fallback !== undefined && fallback !== null && fallback !== '') return fallback

  // No usable fallback offered. NOW the shared chain is exactly right:
  // English, then the source language, then any stored language, rather than
  // rendering nothing.
  return localizedText(field, language, '') || fallback
}

/** Visible unless an admin has explicitly turned it off. */
export const isSectionVisibleIn = (sections, key) => sections?.[key] !== false

/**
 * Assigns each visible section its dark/light band.
 *
 * The pages alternate tone deliberately, and in places put two same-toned
 * sections together ON PURPOSE. Hiding a section between two others can
 * collapse that into an accidental clash — two dark bands meeting with nothing
 * between them.
 *
 * So a section flips only when its tone now collides with the previous
 * visible section AND that collision is not one the design asked for.
 *
 * ── What counts as "asked for" ───────────────────────────────────────────
 * An intentional pairing is two sections that were neighbours in the original
 * order AND were given the same tone there. Both halves matter, and the donor
 * checks only the first — which leaves a clash in a case that actually occurs:
 *
 *   designed   a(dark)  b(light)  c(dark)  d(light)
 *   hide b  →  a(dark)           c(dark)  d(light)
 *
 * c collides with a and correctly flips to light. Now d — still light — sits
 * against a light c. Adjacency alone says "a and d were neighbours, leave it",
 * so the donor stops there and ships the clash. Asking whether c and d were
 * ALSO the same tone by design (they were not: dark then light) shows this
 * pairing is an artefact of the flip, and d flips to dark. The alternation
 * survives, which is the entire point of the mechanism.
 */
export const computeBands = (sectionOrder = [], defaultBands = {}, sections = {}) => {
  const map = {}
  let prevBand = null
  let prevIdx = -1
  let prevKey = null

  sectionOrder.forEach((key, idx) => {
    if (!isSectionVisibleIn(sections, key)) return

    let band = defaultBands[key] || 'dark'

    if (prevBand !== null && band === prevBand) {
      const wasAdjacent = idx === prevIdx + 1
      const wasSameToneByDesign = defaultBands[key] === defaultBands[prevKey]
      const intentionalPairing = wasAdjacent && wasSameToneByDesign

      if (!intentionalPairing) band = band === 'dark' ? 'light' : 'dark'
    }

    map[key] = band
    prevBand = band
    prevIdx = idx
    prevKey = key
  })

  return map
}

/**
 * Builds a PUT body containing ONLY what the admin actually changed.
 *
 * The first save of a page is the case this exists for. Sending every
 * registry field means the server sees ~57 brand-new homepage strings and
 * translates all of them — five MyMemory calls each — because none of them is
 * stored yet for isUnchangedSource() to recognise. Editing one heading should
 * cost one field's worth of quota, not the whole page's.
 *
 * A delta against a baseline (rather than a set of dirty flags) also settles
 * the change-then-revert case for free: typing into a box and undoing it
 * leaves the value equal to the baseline, so nothing is sent.
 *
 * Sections normalise through `!== false` before comparison, because "absent"
 * and "true" both mean visible — flipping a never-configured section on must
 * not register as a change.
 */
export const buildSavePayload = ({
  fieldDefs = [],
  baselineValues = {},
  values = {},
  baselineSections = {},
  sections = {},
}) => {
  const fields = {}

  for (const def of fieldDefs) {
    const next = values[def.key] ?? ''
    const prev = baselineValues[def.key] ?? ''
    if (next === prev) continue

    fields[def.key] = def.type === 'image'
      ? { type: 'image', url: next }
      : { type: 'text', value: next }
  }

  const changedSections = {}

  for (const key of new Set([...Object.keys(baselineSections), ...Object.keys(sections)])) {
    const next = isSectionVisibleIn(sections, key)
    const prev = isSectionVisibleIn(baselineSections, key)
    if (next !== prev) changedSections[key] = next
  }

  return { fields, sections: changedSections }
}

/** True when a payload would change nothing on the server. */
export const isEmptyPayload = (payload) =>
  Object.keys(payload.fields).length === 0 && Object.keys(payload.sections).length === 0

/**
 * The background a section should actually render.
 *
 * computeBands answers "dark or light"; a page needs a colour. Mapping the
 * semantic band straight onto a canonical pair would flatten real design: the
 * Architecture stats bar is #252523, not C.charcoal, and both are "dark".
 *
 * So the rule is: while a section still has the band it was designed with,
 * render its ORIGINAL colour, untouched. Only when computeBands has actually
 * flipped it — because hiding a neighbour created a clash the design never
 * intended — does it fall back to the page's canonical colour for the new
 * band.
 *
 * The consequence that matters: with every section visible, no band is ever
 * flipped, so every page renders exactly the colours it renders today.
 *
 * @param {string}  key          section key
 * @param {string}  band         what bandFor(key) returned
 * @param {Object}  defaultBands designed band per section
 * @param {Object}  originals    designed colour per section
 * @param {Object}  canonical    { dark, light } fallback colours for this page
 */
export const sectionBackground = (key, band, defaultBands, originals, canonical) =>
  band === defaultBands[key] ? originals[key] : canonical[band]
