// Write-time automatic translation.
//
// Transplanted from the donor. An admin types content in one language; this
// calls MyMemory once per target language AT SAVE TIME and stores the result,
// so no visitor ever triggers a translation request.
//
// Provider, endpoint, timeout and failure-detection are the donor's, verbatim.
// One behaviour is deliberately different — see localizeText() below.

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  POISONED_TRANSLATION_RE,
  isPoisonedTranslation,
  isUsableText,
} from './localizedField.js'

const ARABIC_RE = /[؀-ۿ]/
const TURKISH_RE = /[çğıöşüÇĞİÖŞÜ]/

/*
 * Which language the admin typed in.
 *
 * Only en/tr/ar are detectable, matching the donor: those are the languages
 * admins actually write in, and they are also exactly the three the chat
 * pipeline supports. de/ru/ur are translate-only TARGETS and are never
 * inferred as a source — guessing "this is German" from Latin script would
 * misfire on ordinary English text and then translate English to English.
 */
export const detectLang = (text) => {
  if (typeof text !== 'string') return DEFAULT_LANGUAGE
  if (ARABIC_RE.test(text)) return 'ar'
  if (TURKISH_RE.test(text)) return 'tr'
  return DEFAULT_LANGUAGE
}

export const SOURCE_LANGUAGES = ['en', 'tr', 'ar']

/*
 * MyMemory returns HTTP 200 even when it is refusing to translate. The
 * refusal arrives as plain prose inside responseData.translatedText — a
 * quota warning — rather than as an HTTP error or a non-200 responseStatus.
 * Trusting that field blindly saves the warning as if it were a translation
 * and shows it to visitors.
 *
 * Donor logic, unchanged, plus an explicit empty-result check: MyMemory can
 * answer 200 with an empty translatedText, which is not a translation either.
 */
export const isTranslationFailure = (data) => {
  if (!data || typeof data !== 'object') return true
  if (data.responseStatus && Number(data.responseStatus) !== 200) return true

  const translated = data.responseData?.translatedText
  if (typeof translated !== 'string' || translated.trim() === '') return true

  return POISONED_TRANSLATION_RE.test(translated)
}

/*
 * Strips provider garbage out of any payload on its way to a client.
 *
 * Documents saved before the write path guarded against this can hold a
 * quota warning where a translation belongs; fixing the write path does not
 * clean them retroactively. Recursive so it reaches nested localized objects
 * inside stats[], team[] and contentBlocks[].
 *
 * Only plain object literals are walked. ObjectId, Date and Buffer are all
 * `typeof === 'object'` too, and rebuilding them from Object.entries()
 * destroys them — an ObjectId comes back as a bare { buffer: {...} } blob
 * that throws "Cast to ObjectId" the next time it is saved.
 */
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

/**
 * One translation request. Returns the translated string, or null on ANY
 * failure — never the source text.
 *
 * Returning null rather than the donor's `return text` is what lets
 * localizeText() below tell "translation failed" from "translation
 * succeeded and happens to equal the input". The donor cannot distinguish
 * those, which is the root of the bug described there.
 */
export const translateOne = async (text, targetLang, fetchImpl = fetch) => {
  if (!isUsableText(text)) return null

  try {
    const url =
      'https://api.mymemory.translated.net/get' +
      `?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) })

    // A non-2xx response has no usable body; asking for .json() on an error
    // page throws, which the catch below would swallow into the same null.
    // Checking explicitly keeps the two failure modes readable.
    if (response && response.ok === false) return null

    const data = await response.json()
    if (isTranslationFailure(data)) return null

    const translated = data.responseData.translatedText
    return isUsableText(translated) ? translated : null
  } catch {
    // Network error, abort/timeout, or malformed JSON. All the same to the
    // caller: no translation is available for this language right now.
    return null
  }
}

/**
 * Turns admin-typed text into { sourceLang, en, tr, ar, de, ru, ur }.
 *
 * `existing` is the value already stored on the document, if any. Passing it
 * is what makes a failed translation non-destructive.
 *
 * ── The donor bug this fixes ─────────────────────────────────────────────
 * The donor's translateOne returns the SOURCE TEXT when a request fails, and
 * its localizeText takes no existing value. So a save made while MyMemory's
 * daily quota is exhausted overwrites every previously-good translation with
 * the English source. A page that was fully translated last week silently
 * becomes English everywhere, and nothing reports it.
 *
 * Here, a failed target falls back in this order:
 *   1. the translation already stored for that language, if still usable
 *   2. nothing — the key is omitted
 *
 * Omitting is deliberate. Writing the source text into `de` would claim a
 * German translation exists; leaving `de` absent lets resolveLocalized()
 * fall back to English at read time, which looks identical to the visitor
 * and stays honest about what is actually stored — so the next successful
 * save can fill it in rather than treating the source text as done.
 */
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
