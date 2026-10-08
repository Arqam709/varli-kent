import { createHash } from 'node:crypto'
import { SUPPORTED_LANGUAGES, isUsableText } from './localizedField.js'

/*
 * TRANSLATION STATE — what a stored translation is a translation OF.
 *
 * A localized value keeps its flat shape:
 *
 *   { sourceLang: 'en', en: '…', tr: '…', de: '…', … }
 *
 * and may carry one sibling, `meta`, recording where each translation came
 * from:
 *
 *   meta: {
 *     sourceHash: '<sha256 of the stored source text>',
 *     langs: {
 *       tr: { from: '<hash>', by: 'machine', at: '<ISO time>' },
 *       de: { from: '<older hash>', by: 'machine', at: '…', error: 'timeout', errorAt: '…' },
 *       ru: { error: 'quota', errorAt: '…' },
 *     },
 *   }
 *
 *   from      the hash of the source text this translation was produced from
 *   by        'machine' today; 'manual' is reserved for a hand-written one
 *   at        when that translation was last successfully produced
 *   error     the reason the most recent automatic attempt failed — one of
 *             autoTranslate.js's TRANSLATION_FAILURE_REASONS — if it did
 *   errorAt   when that attempt failed
 *
 * ── What is deliberately NOT stored ──────────────────────────────────────
 * No status. "Translated", "stale" and the rest are derived by
 * translationStateOf from the text and the hashes, so a status can never
 * disagree with the content it describes.
 *
 * ── Lazy, and never guessed ──────────────────────────────────────────────
 * `meta` is written only when a value is saved. A value that has none is
 * valid forever, and its translations are 'unknown' — not current, not stale.
 * Nothing here infers provenance from how a translation looks, from dates, or
 * from what is known about a record's history.
 *
 * Nothing in this module is specific to one collection: it describes any value
 * autoTranslate.js's localizeText produces.
 */

/** Who can have produced a translation. */
export const TRANSLATION_AUTHORS = Object.freeze(['machine', 'manual'])

/** Every state translationStateOf can return. */
export const TRANSLATION_STATES = Object.freeze(['source', 'missing', 'unknown', 'translated', 'manual', 'stale'])

/**
 * The identity of a source text: the SHA-256 of exactly the string that is
 * stored, as UTF-8, in hex.
 *
 * Exactly: no trimming and no Unicode normalisation, so the hash can always be
 * recomputed from the stored value and compared. Two texts that differ by a
 * trailing newline are two different sources. This is a version identity, not
 * a security measure.
 */
export const sourceHash = (text) =>
  createHash('sha256').update(typeof text === 'string' ? text : '', 'utf8').digest('hex')

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/** A language entry that really records where its translation came from. */
const hasProvenance = (entry) =>
  isPlainObject(entry) && isHash(entry.from) && TRANSLATION_AUTHORS.includes(entry.by)

/**
 * The state of one language of a localized value.
 *
 *   source       it is the language the text was written in
 *   missing      no usable text is stored for it
 *   unknown      text is stored, but nothing records what it was translated
 *                from — every value saved before this metadata existed
 *   translated   a machine translation of the current source text
 *   manual       a hand-written translation of the current source text
 *   stale        a translation of an EARLIER source text
 *
 * "Current" is decided against the hash of the source text actually stored,
 * recomputed here, rather than by trusting meta.sourceHash. The two are equal
 * for anything this module wrote; if the source was changed some other way, the
 * recomputed hash is the truth and its translations correctly read as stale.
 */
export const translationStateOf = (value, lang) => {
  if (!isPlainObject(value)) return 'missing'
  if (typeof value.sourceLang === 'string' && lang === value.sourceLang) return 'source'
  if (!isUsableText(value[lang])) return 'missing'

  const entry = value.meta?.langs?.[lang]
  if (!hasProvenance(entry)) return 'unknown'

  const source = value[value.sourceLang]
  // Provenance without a source to compare it to proves nothing.
  if (typeof source !== 'string') return 'unknown'

  if (entry.from !== sourceHash(source)) return 'stale'
  return entry.by === 'manual' ? 'manual' : 'translated'
}

/** The state of every supported language of a localized value. */
export const translationStatesOf = (value) =>
  Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, translationStateOf(value, lang)]))

/**
 * `value` with the translation state of this save recorded on it.
 *
 *   value      what localizeTextWithReport returned — the object to store
 *   report     that same call's report: what happened to each language
 *   previous   the value stored before this save, if any
 *   now        the time of the save (a parameter so tests can fix it)
 *
 * For each language the save attempted:
 *
 *   translated                 from = the new source hash, by 'machine', at now.
 *                              Any earlier error is gone — the entry is new.
 *   failed, old text kept      the old text's provenance is carried over
 *                              UNCHANGED if it had one, so it now reads as
 *                              stale; if it had none it stays unknown. Either
 *                              way the failure is recorded beside it.
 *   failed, nothing stored     only the failure is recorded.
 *
 * A language the save did not attempt (the source language itself) gets no
 * entry. `value`'s own keys are returned untouched.
 */
export const withTranslationState = (value, report, previous = null, now = new Date()) => {
  const hash = sourceHash(value?.[value?.sourceLang])
  const stamp = now.toISOString()
  const earlier = isPlainObject(previous?.meta?.langs) ? previous.meta.langs : {}
  const langs = {}

  for (const [lang, outcome] of Object.entries(report?.targets || {})) {
    if (outcome.status === 'translated') {
      langs[lang] = { from: hash, by: 'machine', at: stamp }
      continue
    }

    const entry = {}
    // Only what was actually recorded for the text being kept. A translation
    // that predates this metadata has no provenance, and none is invented.
    if (outcome.using === 'previous' && hasProvenance(earlier[lang])) {
      entry.from = earlier[lang].from
      entry.by = earlier[lang].by
      if (typeof earlier[lang].at === 'string') entry.at = earlier[lang].at
    }
    entry.error = outcome.reason
    entry.errorAt = stamp
    langs[lang] = entry
  }

  return { ...value, meta: { sourceHash: hash, langs } }
}

/**
 * A localized value without its translation state — the form anything public
 * receives. Returns non-objects, and values that have no `meta`, as they are.
 */
export const withoutTranslationState = (value) => {
  if (!isPlainObject(value) || !('meta' in value)) return value
  const { meta: _meta, ...content } = value
  return content
}
