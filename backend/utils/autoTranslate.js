
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  POISONED_TRANSLATION_RE,
  isPoisonedTranslation,
  isUsableText,
} from './localizedField.js'

const ARABIC_RE = /[؀-ۿ]/
const TURKISH_RE = /[çğıöşüÇĞİÖŞÜ]/

export const detectLang = (text) => {
  if (typeof text !== 'string') return DEFAULT_LANGUAGE
  if (ARABIC_RE.test(text)) return 'ar'
  if (TURKISH_RE.test(text)) return 'tr'
  return DEFAULT_LANGUAGE
}

export const SOURCE_LANGUAGES = ['en', 'tr', 'ar']

export const isTranslationFailure = (data) => {
  if (!data || typeof data !== 'object') return true
  if (data.responseStatus && Number(data.responseStatus) !== 200) return true

  const translated = data.responseData?.translatedText
  if (typeof translated !== 'string' || translated.trim() === '') return true

  return POISONED_TRANSLATION_RE.test(translated)
}

export const sanitizePoisonedTranslations = (value) => {
  if (typeof value === 'string') {
    return isPoisonedTranslation(value) ? undefined : value
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizePoisonedTranslations(v))
  }

  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {}
    for (const [key, nested] of Object.entries(value)) {
      const cleaned = sanitizePoisonedTranslations(nested)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return out
  }

  return value
}

export const TRANSLATE_TIMEOUT_MS = 5000

export const translateOne = async (text, targetLang, fetchImpl = fetch) => {
  if (!isUsableText(text)) return null

  try {
    const url =
      'https://api.mymemory.translated.net/get' +
      `?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) })

    if (response && response.ok === false) return null

    const data = await response.json()
    if (isTranslationFailure(data)) return null

    const translated = data.responseData.translatedText
    return isUsableText(translated) ? translated : null
  } catch {
    return null
  }
}

export const isUnchangedSource = (text, stored) => { 
  if (typeof text !== 'string') return false
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false

  const sourceLang = stored.sourceLang
  if (typeof sourceLang !== 'string') return false

  return stored[sourceLang] === text
}

export const localizeFields = async (body, fields, existing = {}, fetchImpl = fetch) => {
  const out = { ...body }
  const prev = existing && typeof existing === 'object' ? existing : {}

  for (const key of fields) {
    if (!(key in out)) continue

    const incoming = out[key]
    if (typeof incoming !== 'string') continue

    const stored = prev[key]

    if (isUnchangedSource(incoming, stored)) {
      out[key] = stored
      continue
    }

    out[key] = await localizeText(incoming, stored, fetchImpl)
  }

  return out
}

export const localizeText = async (text, existing = null, fetchImpl = fetch) => {
  const source = typeof text === 'string' ? text : ''
  const sourceLang = detectLang(source)

  // The admin's own words are stored verbatim, never round-tripped through
  // the provider and back.
  const result = { sourceLang, [sourceLang]: source }

  if (!isUsableText(source)) return result

  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const targets = SUPPORTED_LANGUAGES.filter((lang) => lang !== sourceLang)

  const translations = await Promise.all(
    targets.map((lang) => translateOne(source, lang, fetchImpl))
  )

  targets.forEach((lang, i) => {
    const translated = translations[i]

    if (translated !== null) {
      result[lang] = translated
      return
    }

    // Failed. Keep whatever good translation this language already had.
    if (isUsableText(previous[lang])) result[lang] = previous[lang]
  })

  return result
}
