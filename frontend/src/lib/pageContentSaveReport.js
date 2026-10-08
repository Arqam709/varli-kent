import { localeFor } from './locale.js'

/*
 * Reads the `translation` report a page-content save returns and reduces it to
 * what the editor needs to say.
 *
 *   translation.fields[fieldKey] = {
 *     sourceLang,
 *     translated: [lang…],
 *     needsAttention: [{ lang, reason, using: 'previous' | 'none' }],
 *   }
 *
 * outcome
 *   'unknown'       the response carried no report — a backend that predates
 *                   it. Nothing may be claimed about translation.
 *   'none'          a report with nothing in it: only images or section
 *                   toggles were saved, or text that needed no translating.
 *   'complete'      every language that was attempted came back translated.
 *   'partial'       some did, some did not.
 *   'untranslated'  none did. The source edit was still saved.
 *
 * languageCount   how many different languages were translated, across fields
 * sourceLangs     the language(s) the saved text was stored as
 * issues          one entry per field with a problem:
 *                   { fieldKey, previous: [lang…], missing: [lang…], tooLong }
 *                 `previous` — the old translation is still what visitors see;
 *                 `missing`  — there is no stored translation to show.
 */
const isList = (value) => Array.isArray(value)

export const summarizeSaveReport = (translation) => {
  const reported = translation?.fields
  if (!reported || typeof reported !== 'object' || isList(reported)) {
    return { outcome: 'unknown', languageCount: 0, sourceLangs: [], issues: [] }
  }

  const translatedLangs = new Set()
  const sourceLangs = new Set()
  const issues = []
  let failed = 0

  for (const [fieldKey, field] of Object.entries(reported)) {
    const translated = isList(field?.translated) ? field.translated : []
    const needsAttention = isList(field?.needsAttention) ? field.needsAttention : []
    // A field nothing was attempted for (emptied text) has nothing to report.
    if (translated.length + needsAttention.length === 0) continue

    if (typeof field.sourceLang === 'string') sourceLangs.add(field.sourceLang)
    for (const lang of translated) translatedLangs.add(lang)
    if (needsAttention.length === 0) continue

    failed += needsAttention.length
    issues.push({
      fieldKey,
      previous: needsAttention.filter((item) => item?.using === 'previous').map((item) => item.lang),
      missing: needsAttention.filter((item) => item?.using !== 'previous').map((item) => item.lang),
      tooLong: needsAttention.some((item) => item?.reason === 'too_long'),
    })
  }

  let outcome = 'none'
  if (translatedLangs.size > 0 && failed === 0) outcome = 'complete'
  else if (translatedLangs.size > 0) outcome = 'partial'
  else if (failed > 0) outcome = 'untranslated'

  return { outcome, languageCount: translatedLangs.size, sourceLangs: [...sourceLangs], issues }
}

/**
 * Language codes as a readable list in the reader's own language —
 * "German and Urdu", "Almanca ve Urduca" — with the punctuation and direction
 * that language uses. Falls back to the bare codes where Intl has no data.
 */
export const languageList = (codes, language) => {
  const locale = localeFor(language)
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' })
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(codes.map((code) => names.of(code)))
  } catch {
    return codes.join(', ')
  }
}
