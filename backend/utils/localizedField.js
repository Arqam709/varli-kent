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


export const unwrapLocalized = (value) => {
  if (typeof value === 'string') return value
  if (!isLocalizedObject(value)) return ''

  const source = value.sourceLang
  if (typeof source === 'string' && isUsableText(value[source])) return value[source]

  return resolveLocalized(value, DEFAULT_LANGUAGE)
}
