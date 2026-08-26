const POISONED_RE = /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGPAIR/i

export const SUPPORTED_LANGUAGES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const DEFAULT_LANGUAGE = 'en'

export const isPoisonedTranslation = (value) =>
  typeof value === 'string' && POISONED_RE.test(value)

const isUsable = (value) =>
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

export default localizedText
