
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

const comparable = (text) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The same text, ignoring whitespace and letter case.
 *
 * Used to recognise a provider ECHO: MyMemory can answer HTTP 200 with the
 * input unchanged when it has no translation for a language. Storing that
 * would claim the source-language text IS the translation — which is exactly
 * how AboutContent, PageContent and team roles ended up with `tr`, `ar`, `de`,
 * `ru` and `ur` all holding the English sentence, so every client showed
 * English under a correct `tr` key.
 */
export const isSameText = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && comparable(a) === comparable(b)

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
    if (!isUsableText(translated)) return null

    // An echo is "no translation", not a translation. The target is then left
    // absent (or keeps a previous real one), and clients fall back to the
    // source language deliberately. A phrase that genuinely reads the same in
    // both languages — a brand name — loses nothing: the fallback shows the
    // identical text.
    if (isSameText(translated, text)) return null

    return translated
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

  // The previous document's own source text, e.g. the English an older copy was
  // made from. Only used to recognise stored echoes below.
  const previousSource = typeof previous.sourceLang === 'string' ? previous[previous.sourceLang] : undefined

  targets.forEach((lang, i) => {
    const translated = translations[i]

    if (translated !== null) {
      result[lang] = translated
      return
    }

    // Failed. Keep the translation this language already had — but only a
    // REAL one. A stored value that is just a copy of the source (new or
    // previous) is an echo written before echoes were rejected; preserving it
    // would keep claiming English is Turkish forever. An absent target lets
    // clients fall back honestly, and the next successful save fills it.
    const kept = previous[lang]
    if (!isUsableText(kept)) return
    if (isSameText(kept, source)) return
    if (lang !== previous.sourceLang && isSameText(kept, previousSource)) return

    result[lang] = kept
  })

  return result
}
