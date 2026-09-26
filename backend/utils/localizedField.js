import mongoose from 'mongoose'

export const SUPPORTED_LANGUAGES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

export const DEFAULT_LANGUAGE = 'en'

export const localizedField = (defaultText) => ({
  type: mongoose.Schema.Types.Mixed,
  ...(defaultText === undefined ? {} : { default: () => ({ sourceLang: DEFAULT_LANGUAGE, en: defaultText }) }),
})

export const POISONED_TRANSLATION_RE = /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGPAIR/i

export const isPoisonedTranslation = (value) =>
  typeof value === 'string' && POISONED_TRANSLATION_RE.test(value)

/** A string that is present, non-blank, and not provider garbage. */
export const isUsableText = (value) =>
  typeof value === 'string' && value.trim() !== '' && !isPoisonedTranslation(value)

export const resolveLocalized = (value, language = DEFAULT_LANGUAGE) => {
  // Legacy scalar — the shape every existing About document uses today.
  if (typeof value === 'string') return isUsableText(value) ? value : ''

  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

  const requested = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE

  if (isUsableText(value[requested])) return value[requested]
  if (isUsableText(value[DEFAULT_LANGUAGE])) return value[DEFAULT_LANGUAGE]

  const source = value.sourceLang
  if (typeof source === 'string' && isUsableText(value[source])) return value[source]

  for (const lang of SUPPORTED_LANGUAGES) {
    if (isUsableText(value[lang])) return value[lang]
  }

  return ''
}

export const isLocalizedObject = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  SUPPORTED_LANGUAGES.some((lang) => typeof value[lang] === 'string')


/**
 * Every usable language copy of a localized value, joined into one haystack.
 *
 * For LEXICAL matching only — concept extraction and evidence-unit coverage,
 * which is what the chat search layer does with a property's text. Those
 * matchers are deliberately multilingual: utils/lifestyleConcepts.js lists
 * English, Turkish and Arabic keywords under each concept id. Feeding them a
 * single language would make a property's concepts depend on which language
 * the admin happened to type in — a Turkish "deniz manzaralı" description
 * would stop matching an English "sea view" request as soon as the text was
 * localized, which is the opposite of the point.
 *
 * Deduplicated, because an echo-free localized value can still repeat a copy
 * across languages (a brand name, a number), and a repeated token would
 * otherwise inflate nothing useful.
 *
 * NOT for embeddings: a vector built from six translations of one sentence is
 * not comparable with the single-language vectors already backfilled. Those
 * use unwrapLocalized below.
 *
 * A legacy plain string passes straight through, so this is safe to call on
 * either stored shape.
 */
export const localizedSearchText = (value) => {
  if (typeof value === 'string') return isUsableText(value) ? value : ''
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

  const seen = new Set()
  for (const lang of SUPPORTED_LANGUAGES) {
    const text = value[lang]
    if (isUsableText(text)) seen.add(text.trim())
  }

  return [...seen].join(' ')
}

export const unwrapLocalized = (value) => {
  if (typeof value === 'string') return value
  if (!isLocalizedObject(value)) return ''

  const source = value.sourceLang
  if (typeof source === 'string' && isUsableText(value[source])) return value[source]

  return resolveLocalized(value, DEFAULT_LANGUAGE)
}
