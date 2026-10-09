import { resolveCmsField } from './pageContentResolve.js'
import { isUsable } from './localizedText.js'
import { catalogueText } from './pageContentCatalogue.js'

/*
 * WHAT THE EDITOR SHOWS about a field's translations.
 *
 * The backend reports the state of what is STORED for each language
 * (utils/translationState.js): source, missing, unknown, translated, manual,
 * stale. That is not yet what an admin needs to know, because a language with
 * nothing stored is usually perfectly healthy: the page falls back to the
 * website's built-in translation of that same text.
 *
 * So the stored state is combined here with two things only the frontend
 * knows — the registry default a field started from, and the catalogue text a
 * page falls back to — into what is displayed:
 *
 *   source      the language the text was written in
 *   current     a stored machine translation of the current source text
 *   manual      a stored hand-written translation of the current source text
 *   existing    a stored translation from before tracking began; its source
 *               version is unknown. Not a problem in itself.
 *   builtin     nothing stored, and none needed: the source is still the
 *               original wording, so the built-in translation matches it
 *   stale       a stored translation of an EARLIER source text
 *   outdated    nothing stored, and the source has been edited: visitors see
 *               the built-in translation of the ORIGINAL wording
 *   missing     nothing stored and no built-in translation: visitors see the
 *               source text
 *
 * The backend's vocabulary is not changed, renamed or reinterpreted here: each
 * backend state maps to exactly one group of the above.
 */

export const TRANSLATION_STATUS_LANGUAGES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

/** Every status the editor can display, calmest first. */
export const DISPLAY_STATUSES = ['source', 'current', 'manual', 'builtin', 'existing', 'stale', 'outdated', 'missing']

/** The statuses that ask for the admin's attention by themselves. */
export const ATTENTION_STATUSES = ['stale', 'outdated', 'missing']

/** Where the text a visitor sees comes from. */
export const TEXT_ORIGINS = ['stored', 'builtin', 'source']

// Failure identifiers (backend TRANSLATION_FAILURE_REASONS) → the handful of
// things worth telling an admin apart. Anything unrecognised is 'failed'.
const FAILURE_KINDS = {
  quota: 'quota',
  too_long: 'tooLong',
  echo: 'echo',
}
export const failureKind = (error) => (typeof error === 'string' && error ? FAILURE_KINDS[error] || 'failed' : null)

const sameWording = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/**
 * Whether a field's source text is still the wording the site shipped with.
 *
 * Only then is the built-in translation known to be a translation of it. The
 * registry default is English, so a field stored in any other source language
 * is never treated as default — that cannot be shown, so it is not claimed. A
 * field that was never saved, or was emptied, shows the built-in text in every
 * language and counts as default.
 */
export const sourceIsDefault = (def, field) => {
  if (!field) return true
  const source = field[field.sourceLang]
  if (!isUsable(source)) return true
  return field.sourceLang === 'en' && sameWording(source, def.default)
}

const BACKEND_TO_DISPLAY = { source: 'source', translated: 'current', manual: 'manual', unknown: 'existing', stale: 'stale' }

/**
 * One row per language for one text field.
 *
 *   pageKey   the page the field belongs to
 *   def       the field's registry definition ({ key, default, … })
 *   field     what is stored for it — undefined when it was never saved
 *   states    the backend's translationStates[fieldKey] — undefined for a
 *             field that is not stored
 *
 * Each row: { lang, status, text, origin, failure, attention }
 *
 *   text        what a visitor of that language sees right now, from the same
 *               resolver the public pages use
 *   origin      'stored' | 'builtin' | 'source' — where that text comes from
 *   failure     null, or why the last automatic attempt failed
 *               ('failed' | 'quota' | 'tooLong' | 'echo')
 *   attention   true when the status is one of ATTENTION_STATUSES, or the last
 *               automatic attempt failed
 */
export const describeFieldTranslations = ({ pageKey, def, field, states }) => {
  const sourceLang = field?.sourceLang || 'en'
  const isDefault = sourceIsDefault(def, field)

  return TRANSLATION_STATUS_LANGUAGES.map((lang) => {
    const builtIn = catalogueText(pageKey, def.key, lang)
    const hasBuiltIn = isUsable(builtIn)
    const stored = field ? isUsable(field[lang]) : false
    // A field that is not stored has no backend states: its source is the
    // English default and nothing else exists.
    const backend = states?.[lang] || (lang === sourceLang ? 'source' : 'missing')

    let status = BACKEND_TO_DISPLAY[backend]
    if (!status) {
      if (hasBuiltIn) status = isDefault ? 'builtin' : 'outdated'
      else status = 'missing'
    }

    // Exactly what the public page renders: stored slot, else built-in, else
    // the source text.
    const text = resolveCmsField(field, lang, hasBuiltIn ? builtIn : undefined) || (lang === sourceLang ? def.default : '') || ''
    const origin = stored ? (lang === sourceLang ? 'source' : 'stored') : hasBuiltIn ? 'builtin' : 'source'

    const failure = failureKind(field?.meta?.langs?.[lang]?.error)

    return { lang, status, text, origin, failure, attention: ATTENTION_STATUSES.includes(status) || Boolean(failure) }
  })
}

/**
 * A page's translations at a glance.
 *
 *   counts      { <status>: number } over every text field × the five
 *               non-source languages (the source itself is not a translation)
 *   failures    languages whose last automatic attempt failed
 *   attention   languages that need a look: an attention status or a failure
 */
export const summarizePageTranslations = (rowsByField) => {
  const counts = Object.fromEntries(DISPLAY_STATUSES.filter((status) => status !== 'source').map((status) => [status, 0]))
  let failures = 0
  let attention = 0

  for (const rows of Object.values(rowsByField)) {
    for (const row of rows) {
      if (row.status === 'source') continue
      counts[row.status] += 1
      if (row.failure) failures += 1
      if (row.attention) attention += 1
    }
  }

  return { counts, failures, attention }
}
