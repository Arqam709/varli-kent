
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

/**
 * The source language a provider response reported, if it is one we accept.
 *
 * MyMemory answers every `autodetect|<target>` call with the language it
 * decided the input was, so the translations localizeText already makes carry
 * this for free — no separate detection request, which matters because the free
 * tier is rate limited and this codebase goes out of its way not to spend it.
 *
 * Only SOURCE_LANGUAGES values are honoured. A confident `fr` or `de` is
 * discarded rather than adopted: those are translate-only targets here, and
 * treating German as a source would ask the provider to translate German into
 * German. Anything unrecognised, absent, or malformed yields null, and the
 * caller keeps the local heuristic's answer.
 */
const readDetectedSourceLang = (data) => {
  const detected = data?.responseData?.detectedLanguage
  if (typeof detected !== 'string') return null

  const normalized = detected.trim().toLowerCase().slice(0, 2)
  return SOURCE_LANGUAGES.includes(normalized) ? normalized : null
}

/**
 * The single source language reported across a batch of translation responses.
 *
 * A majority rather than the first answer, because detection is per-request and
 * a short string can be read differently depending on the target language it was
 * being translated into. Ties break toward the earlier target, which is stable
 * because localizeText always builds its target list in SUPPORTED_LANGUAGES
 * order. Returns null when nothing usable was reported at all — the ordinary
 * case for a provider or test double that does not send detectedLanguage.
 */
const consensusSourceLang = (detections) => {
  const counts = new Map()
  for (const lang of detections) {
    if (!lang) continue
    counts.set(lang, (counts.get(lang) || 0) + 1)
  }

  let best = null
  let bestCount = 0
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang
      bestCount = count
    }
  }

  return best
}

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

/*
 * One attempt, classified so the caller knows whether retrying could help.
 *
 *   { ok: true,  value }      a real translation
 *   { ok: false, retry: false } a definitive answer — echo, provider garbage,
 *                               or blank. Asking again returns the same thing.
 *   { ok: false, retry: true }  transient — timeout, network error, non-2xx,
 *                               or a non-200 responseStatus.
 *
 * The distinction matters because retrying an echo would spend three requests
 * of a limited daily quota to be told the same thing three times.
 */
/**
 * Whether an HTTP failure status is worth asking about again.
 *
 * 408 and 429 are the provider saying "not now" — a timeout and a rate limit —
 * and 5xx is its own fault, so all three can succeed on a second try. Every
 * other status is a deterministic refusal of THIS request (a malformed language
 * pair, a rejected key); repeating it would spend quota to be refused again.
 *
 * A response with no numeric status is treated as not retryable: there is no
 * evidence of a transient condition, and inventing one would turn every
 * permanent failure into three.
 */
const isRetryableStatus = (status) =>
  typeof status === 'number' && (status === 408 || status === 429 || status >= 500)

const attemptTranslation = async (text, targetLang, fetchImpl) => {
  try {
    const url =
      'https://api.mymemory.translated.net/get' +
      `?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) })

    if (response && response.ok === false) {
      return { ok: false, retry: isRetryableStatus(response.status), detected: null }
    }

    const data = await response.json()

    // Read before any verdict below: the provider reports what it thought the
    // input was even on a response we go on to reject as an echo or as garbage.
    const detected = readDetectedSourceLang(data)

    // A non-200 responseStatus is the provider saying "not right now" (rate
    // limited, upstream hiccup) rather than "there is no translation", so it
    // is the one isTranslationFailure case worth asking about again.
    if (data && typeof data === 'object' && data.responseStatus && Number(data.responseStatus) !== 200) {
      return { ok: false, retry: true, detected }
    }

    if (isTranslationFailure(data)) return { ok: false, retry: false, detected }

    const translated = data.responseData.translatedText
    if (!isUsableText(translated)) return { ok: false, retry: false, detected }

    // An echo is "no translation", not a translation. The target is then left
    // absent (or keeps a previous real one), and clients fall back to the
    // source language deliberately. A phrase that genuinely reads the same in
    // both languages — a brand name — loses nothing: the fallback shows the
    // identical text.
    if (isSameText(translated, text)) return { ok: false, retry: false, detected }

    return { ok: true, value: translated, detected }
  } catch {
    return { ok: false, retry: true, detected: null }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const TRANSLATE_ATTEMPTS = 3

const RETRY_BACKOFF_MS = 300

/**
 * The translation of `text` into `targetLang`, or null when there isn't one.
 *
 * Returning null — never the source text — is the contract localizeText relies
 * on to leave a target absent and let clients fall back honestly. Handing back
 * the original would claim the English sentence IS the Turkish one, which is
 * the exact failure isSameText exists to catch coming from the provider.
 *
 * A TRANSIENT failure is retried up to TRANSLATE_ATTEMPTS times with a short
 * linear backoff. Before this, one timeout permanently cost that language its
 * translation until someone happened to re-save the record, and nothing about
 * the result looked wrong — unlike a quota warning, an absent translation is
 * indistinguishable from "the provider had nothing". Most calls still succeed
 * on the first attempt, so a save is not measurably slower.
 */
const translateOneDetecting = async (text, targetLang, fetchImpl = fetch) => {
  if (!isUsableText(text)) return { value: null, detected: null }

  let detected = null

  for (let attempt = 1; attempt <= TRANSLATE_ATTEMPTS; attempt += 1) {
    const result = await attemptTranslation(text, targetLang, fetchImpl)
    detected = detected || result.detected
    if (result.ok) return { value: result.value, detected }
    if (!result.retry) return { value: null, detected }
    if (attempt < TRANSLATE_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt)
  }

  return { value: null, detected }
}

export const translateOne = async (text, targetLang, fetchImpl = fetch) => {
  if (!isUsableText(text)) return null

  for (let attempt = 1; attempt <= TRANSLATE_ATTEMPTS; attempt += 1) {
    const result = await attemptTranslation(text, targetLang, fetchImpl)
    if (result.ok) return result.value
    if (!result.retry) return null
    if (attempt < TRANSLATE_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt)
  }

  return null
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
  const heuristicLang = detectLang(source)

  if (!isUsableText(source)) {
    // Nothing to translate and nothing to detect from, so the heuristic's answer
    // is final and no request is made.
    return { sourceLang: heuristicLang, [heuristicLang]: source }
  }

  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}

  /*
   * ── Source language, corrected from the translations themselves ──────────
   *
   * detectLang recognises Arabic script and the six Turkish diacritics, which
   * are unambiguous. What it cannot recognise is Turkish typed WITHOUT those
   * letters — ordinary on a non-Turkish keyboard, and common in short titles.
   * That text used to be labelled English, stored as the English copy, and
   * "translated" into the five other languages from a language it wasn't, so
   * every reader saw the Turkish sentence sitting under an `en` key.
   *
   * MyMemory reports the language it decided the input was on every
   * `autodetect|<target>` response, so the translations below answer this for
   * free. The first pass therefore runs against the HEURISTIC's target list and
   * the detected language is read off the results.
   *
   * When detection agrees with the heuristic — every genuinely English save, and
   * every case where the provider says nothing, including test doubles — this
   * costs exactly nothing and behaves as it always did.
   *
   * When it disagrees, two things are already true: the pass translated into the
   * real source language (wasted, and discarded), and it did NOT translate into
   * the language the heuristic wrongly claimed as the source. Only that one
   * missing language is then fetched — one extra request, and only for the text
   * that was being mislabelled.
   */
  const firstTargets = SUPPORTED_LANGUAGES.filter((lang) => lang !== heuristicLang)

  const firstPass = await Promise.all(
    firstTargets.map((lang) => translateOneDetecting(source, lang, fetchImpl))
  )

  const detectedLang = consensusSourceLang(firstPass.map((entry) => entry.detected))
  const sourceLang = detectedLang || heuristicLang

  const targets = SUPPORTED_LANGUAGES.filter((lang) => lang !== sourceLang)

  const translations = await Promise.all(
    targets.map((lang) => {
      const alreadyFetched = firstTargets.indexOf(lang)
      if (alreadyFetched !== -1) return firstPass[alreadyFetched].value
      // Only reachable when detection overrode the heuristic: this is the
      // language the first pass treated as the source and so never asked for.
      return translateOne(source, lang, fetchImpl)
    })
  )

  // The admin's own words are stored verbatim, never round-tripped through
  // the provider and back.
  const result = { sourceLang, [sourceLang]: source }

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
