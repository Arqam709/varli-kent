const POISONED_RE = /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGPAIR/i

export const SUPPORTED_LANGUAGES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const DEFAULT_LANGUAGE = 'en'

export const isPoisonedTranslation = (value) =>
  typeof value === 'string' && POISONED_RE.test(value)

/**
 * Present, non-blank, and not provider garbage.
 *
 * Exported so callers that need to ask about ONE language — rather than run
 * the whole fallback chain below — use this same definition instead of
 * writing a second one. src/lib/pageContentResolve.js is the case that needs
 * it: the CMS has to know whether the requested language specifically is
 * usable, because if it is not, the caller's language-aware fallback should
 * win over this file's English step.
 */
export const isUsable = (value) =>
  typeof value === 'string' && value.trim() !== '' && !POISONED_RE.test(value)

export const localizedText = (value, language = DEFAULT_LANGUAGE, fallback = '') => {
  // Legacy scalar. Every About document written before Wave 12A1 stores
  // plain strings, and they must keep rendering with no migration.
  if (typeof value === 'string') return isUsable(value) ? value : fallback

  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback

  const requested = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE

  if (isUsable(value[requested])) return value[requested]
  if (isUsable(value[DEFAULT_LANGUAGE])) return value[DEFAULT_LANGUAGE]

  const source = value.sourceLang
  if (typeof source === 'string' && isUsable(value[source])) return value[source]

  for (const lang of SUPPORTED_LANGUAGES) {
    if (isUsable(value[lang])) return value[lang]
  }

  return fallback
}

/**
 * The text an admin should EDIT — their own source-language words, not a
 * machine translation of them.
 *
 * Wave 12A2. An admin form cannot put a localized object in an <input>: it
 * renders "[object Object]" and then saves that string back over real
 * content. Every admin screen that edits localized content needs the same
 * unwrap, so it lives here rather than being written out per page.
 *
 * Returning the SOURCE language matters. An admin who wrote a bio in Turkish
 * should see their Turkish sentence when they reopen the form — showing them
 * the English machine translation invites them to "correct" it, which
 * silently changes the source language of the record.
 *
 * Sending a plain string back is also what tells the backend a field was
 * edited; an untouched localized object is passed through, and an unchanged
 * source string is detected and skipped (see utils/autoTranslate.js's
 * isUnchangedSource), so neither spends translation quota.
 */
export const editableText = (value) => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

  const source = typeof value.sourceLang === 'string' ? value.sourceLang : ''
  return localizedText(value, source || DEFAULT_LANGUAGE)
}

export default localizedText
