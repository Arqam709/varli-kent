import { SUPPORTED_LANGUAGES, isUsableText } from '../utils/localizedField.js'
import { translateFromTo } from '../utils/autoTranslate.js'
import { sourceHash, retryBlockedBy, translationEntryAfter, translationStateOf } from '../utils/translationState.js'
import { isKnownPage, fieldType } from '../config/pageContentRegistry.js'

/*
 * RETRY ONE TRANSLATION — one text field, one language.
 *
 * The only write path besides the editor's save, so it is built to be unable
 * to do more than it says:
 *
 *   What it translates   the source text and source language STORED for the
 *                        field. Nothing is taken from the caller, and the
 *                        language is not detected again.
 *   What it asks for     exactly one provider translation: source → `lang`.
 *   What it may replace  a tracked machine translation of an earlier source
 *                        (stale), or nothing at all (missing). Text whose
 *                        origin is unknown, hand-written text, a current
 *                        translation and the source itself are refused —
 *                        here, not only in the interface.
 *   What it writes       `fields.<fieldKey>.<lang>` and that language's entry
 *                        in `fields.<fieldKey>.meta`, in ONE conditional
 *                        update. No other language, field or section is part
 *                        of the update.
 *   The race             the update only matches while the stored source is
 *                        still the text that was translated. If an admin
 *                        saved a new source meanwhile, nothing is written and
 *                        the caller is told to try again.
 *
 * Returns { status, body } for the route to send. Outcomes are kept apart:
 *
 *   200  translated: true    a new translation was stored
 *   200  translated: false   the provider produced nothing; the failure was
 *                            recorded and the text is exactly as it was
 *   400 / 404                not a retryable address (page, field, language)
 *   409                      the stored record does not allow it — `reason` is
 *                            source_language, already_current,
 *                            manual_translation, legacy_translation, no_source
 *                            or source_changed
 */

const refuse = (status, reason, message) => ({ status, body: { success: false, reason, message } })

const REFUSAL_MESSAGES = {
  source_language: 'This is the language the text was written in, so there is nothing to translate.',
  already_current: 'This translation already matches the current source text.',
  manual_translation: 'This translation was written by hand and is not replaced automatically.',
  legacy_translation: 'This existing translation predates translation tracking and cannot be retried automatically.',
}

export const retryPageContentTranslation = async ({ PageContent, pageKey, fieldKey, lang, fetchImpl = fetch, now = () => new Date() }) => {
  if (!isKnownPage(pageKey)) return refuse(404, 'unknown_page', `Unknown page '${pageKey}'`)

  const type = fieldType(pageKey, fieldKey)
  if (!type) return refuse(404, 'unknown_field', `Unknown field '${fieldKey}' for page '${pageKey}'`)
  if (type !== 'text') return refuse(400, 'not_text', `Field '${fieldKey}' is not a text field`)
  if (!SUPPORTED_LANGUAGES.includes(lang)) return refuse(400, 'invalid_language', `Unsupported language '${lang}'`)

  const doc = await PageContent.findOne({ pageKey }).lean()
  const field = doc?.fields?.[fieldKey]
  const sourceLang = field?.sourceLang
  const source = field?.[sourceLang]

  // Nothing stored to translate from: a field that was never saved, or emptied.
  if (!field || field.type !== 'text' || typeof sourceLang !== 'string' || !isUsableText(source)) {
    return refuse(409, 'no_source', 'This field has no saved source text to translate.')
  }

  const blocked = retryBlockedBy(field, lang)
  if (blocked) return refuse(409, blocked, REFUSAL_MESSAGES[blocked])

  // The identity of the text this attempt is made from.
  const hash = sourceHash(source)
  const { value: translation, reason } = await translateFromTo(source, sourceLang, lang, fetchImpl)
  const translated = translation !== null && translation !== undefined

  const entry = translationEntryAfter({ translated, reason, earlier: field.meta?.langs?.[lang], hash, now: now() })
  const path = `fields.${fieldKey}`
  const changes = { [`${path}.meta.sourceHash`]: hash, [`${path}.meta.langs.${lang}`]: entry }
  if (translated) changes[`${path}.${lang}`] = translation

  // Matches only while the stored source is still exactly what was translated.
  const outcome = await PageContent.updateOne(
    { pageKey, [`${path}.sourceLang`]: sourceLang, [`${path}.${sourceLang}`]: source },
    { $set: changes }
  )
  if (!outcome || outcome.matchedCount !== 1) {
    return refuse(409, 'source_changed', 'The source text changed while the translation was being retried. Please try again.')
  }

  if (!translated) {
    console.warn(`[page-content] ${pageKey}: retry of ${fieldKey}.${lang} produced no translation (${reason})`)
  }

  const after = { ...field, meta: { ...(field.meta || {}), sourceHash: hash, langs: { ...(field.meta?.langs || {}), [lang]: entry } } }
  if (translated) after[lang] = translation

  return {
    status: 200,
    body: {
      success: true,
      fieldKey,
      lang,
      translated,
      ...(translated ? {} : { reason }),
      translationState: translationStateOf(after, lang),
    },
  }
}
