// Shared shape for write-time-localized text fields.
//
// A localized field is populated ONCE, when an admin saves, by
// utils/autoTranslate.js's localizeText(). It stores the admin's original
// text plus a MyMemory translation for every other supported language. The
// public read side then just picks value[language] — zero translation API
// calls on page view, which is the entire point of the exercise.
//
// ── Why Mixed rather than the donor's sub-schema ─────────────────────────
// The donor declares this as a strict Mongoose sub-schema:
//
//     new mongoose.Schema({ sourceLang, en, tr, ar, de, ru, ur }, {_id:false})
//
// CURRENT cannot use that. Every AboutContent document already in this
// database stores these fields as PLAIN STRINGS ("Our Story"), because that
// is what the schema declared until now. Pointing a sub-schema at an
// existing string does not read it as `{ en: "Our Story" }` — Mongoose
// cannot cast a string to a subdocument, so the value is lost or the
// document fails to hydrate, and the About page silently empties out.
//
// Mixed accepts both shapes unchanged, so a legacy string keeps working and
// a localized object round-trips intact. Runtime correctness therefore never
// depends on running a migration. resolveLocalized() below is what gives the
// two shapes a single meaning.

import mongoose from 'mongoose'

// The six website languages. en/tr/ar are also the three CHAT languages and
// the only ones an admin is expected to type in; de/ru/ur are translate-only
// targets. Keep this list in sync with src/locales/translations.js.
export const SUPPORTED_LANGUAGES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

export const DEFAULT_LANGUAGE = 'en'

/**
 * A localized text field.
 *
 * Mixed, with no default: an absent field must stay absent rather than
 * materialising as an empty localized object on every legacy document the
 * moment this schema ships.
 */
export const localizedField = (defaultText) => ({
  type: mongoose.Schema.Types.Mixed,
  ...(defaultText === undefined ? {} : { default: () => ({ sourceLang: DEFAULT_LANGUAGE, en: defaultText }) }),
})

/*
 * MyMemory answers HTTP 200 while refusing to translate, putting its refusal
 * in the response body as ordinary text. Those sentences are already sitting
 * in some documents from before the write path guarded against them, and
 * fixing the write path does not clean them up retroactively.
 *
 * Anything matching this is treated as MISSING everywhere it is read, so
 * provider garbage can never render as content. Mirrored verbatim in
 * src/lib/localizedText.js — the two must agree.
 */
export const POISONED_TRANSLATION_RE = /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGPAIR/i

export const isPoisonedTranslation = (value) =>
  typeof value === 'string' && POISONED_TRANSLATION_RE.test(value)

/** A string that is present, non-blank, and not provider garbage. */
export const isUsableText = (value) =>
  typeof value === 'string' && value.trim() !== '' && !isPoisonedTranslation(value)

/**
 * Reads one localized value in the requested language.
 *
 * Accepts every shape this field can hold: a legacy plain string, a complete
 * localized object, a partial one, null, undefined, or something unexpected.
 *
 * Fallback order — requested, then English, then the language the admin
 * actually typed in, then any other usable value, then ''. The sourceLang
 * step matters: an admin who writes only Turkish and whose English
 * translation failed still has real Turkish text on the document, and
 * showing that beats showing nothing.
 */
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

/**
 * True when a value is already in localized-object form.
 *
 * Used by the write path to tell "the admin edited this field and sent a new
 * plain string" from "the admin left it alone and sent the stored object
 * back untouched" — only the former needs translating.
 */
export const isLocalizedObject = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  SUPPORTED_LANGUAGES.some((lang) => typeof value[lang] === 'string')

/**
 * Unwraps a localized value back to the text an admin should edit — their own
 * source-language text, not a machine translation of it.
 *
 * Without this the admin form would render "[object Object]" in every input
 * once a field has been localized.
 */
export const unwrapLocalized = (value) => {
  if (typeof value === 'string') return value
  if (!isLocalizedObject(value)) return ''

  const source = value.sourceLang
  if (typeof source === 'string' && isUsableText(value[source])) return value[source]

  return resolveLocalized(value, DEFAULT_LANGUAGE)
}
