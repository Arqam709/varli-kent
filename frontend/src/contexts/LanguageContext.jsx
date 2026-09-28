import { createContext, useContext, useState, useEffect } from 'react'
import translations from '../locales/translations'
import { SUPPORTED_LANGUAGES } from '../lib/localizedText'

const LanguageContext = createContext(null)

/*
 * The language a visitor sees before they have ever chosen one.
 *
 * Turkish, because Varlikent is a Turkish company selling Turkish property to a
 * primarily Turkish audience — the majority of first-time visitors should not
 * have to find the selector before the site reads naturally to them.
 *
 * This is the INTERFACE default and nothing else. It is deliberately NOT the
 * same value as the translation fallback used when a piece of database content
 * has no copy in the requested language: that stays English, in
 * src/lib/localizedText.js and backend/utils/localizedField.js, because it
 * answers a different question ("this record has no Turkish text — what do we
 * show instead?"). Conflating the two would make Turkish the assumed source
 * language of admin-typed content, which it is not.
 */
const DEFAULT_LANGUAGE = 'tr'

/**
 * A stored or incoming language code reduced to one this app actually has.
 *
 * Guards the one value that drives the entire interface. Without it, anything
 * in localStorage under this key — a code from a language that was later
 * removed, a value written by an older build, a hand-edited string, `null` on a
 * first visit — became `language` verbatim. That put an unsupported code into
 * `document.documentElement.lang`, into every localizedText() lookup, and into
 * formatPrice()'s Intl locale, where the interface silently fell back to
 * English while claiming to be something else.
 *
 * SUPPORTED_LANGUAGES comes from src/lib/localizedText.js rather than being
 * listed again here: it is already the authority every localized read uses, and
 * its six codes are exactly the six keys in the translations catalogue.
 */
const normalizeLanguage = (value) =>
  SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE

/*
 * ── Why a migration is needed at all ────────────────────────────────────────
 *
 * The build before the Turkish default did this:
 *
 *     const [language] = useState(() => localStorage.getItem('vk_lang') || 'en')
 *     useEffect(() => { localStorage.setItem('vk_lang', language) }, [language])
 *
 * That effect runs on MOUNT, unconditionally. So every visitor who ever opened
 * the old site — even for a second, even if they never touched the selector —
 * had `vk_lang: "en"` written into their browser. The value that means "I chose
 * English" and the value that means "I was handed the old default" are the same
 * four characters, so simply changing the fallback to Turkish left the entire
 * existing audience on English forever. That is the bug this migration fixes.
 *
 * ── What can and cannot be recovered ───────────────────────────────────────
 *
 * The old storage recorded no intent, so a stored `en` is genuinely ambiguous
 * and no amount of cleverness here can un-ambiguate it. Every OTHER code can:
 * because the old default was `en`, a stored `tr`, `de`, `ru`, `ar` or `ur`
 * could only ever have been written by someone clicking that language. Those
 * are never touched.
 *
 * So the migration is deliberately narrow — it resets ONLY `en`, ONLY once:
 *
 *   MIGRATED_KEY   written the first time this build runs, so the reset can
 *                  never repeat and can never fight a later choice of English.
 *   EXPLICIT_KEY   written by setLanguage, i.e. only ever by a real click.
 *                  From now on an explicit English choice is recorded as such
 *                  and survives this and any future default change.
 *
 * ── The accepted cost ──────────────────────────────────────────────────────
 *
 * Someone who deliberately chose English BEFORE this ships has no explicit
 * marker, so they are switched to Turkish once. That is the unavoidable price
 * of the old storage not recording intent. It is the least surprising of the
 * available options: this is a Turkish company's site, English is one click
 * away, and that click now sticks permanently. The alternative — leaving every
 * legacy browser on English — would mean the Turkish default never reaches the
 * people already using the site, which is the whole point of the change.
 */
const EXPLICIT_KEY = 'vk_lang_explicit'
const MIGRATED_KEY = 'vk_lang_default_migrated'

/** The legacy default. Only this value is ambiguous enough to migrate. */
const LEGACY_AUTO_LANGUAGE = 'en'

/**
 * The language to start in, running the one-time legacy reset if it is due.
 *
 * Writes MIGRATED_KEY whether or not anything changed, so this is a true
 * one-shot: a visitor migrated to Turkish who then picks English back gets
 * both an explicit marker and an already-migrated flag, and is never reset
 * again.
 */
const resolveInitialLanguage = () => {
  const stored = localStorage.getItem('vk_lang')

  if (localStorage.getItem(MIGRATED_KEY)) return normalizeLanguage(stored)

  localStorage.setItem(MIGRATED_KEY, '1')

  const legacyAutoDefault =
    stored === LEGACY_AUTO_LANGUAGE && !localStorage.getItem(EXPLICIT_KEY)

  return legacyAutoDefault ? DEFAULT_LANGUAGE : normalizeLanguage(stored)
}

export const LanguageProvider = ({ children }) => {
  /*
   * A saved preference wins, with the single exception handled above: a legacy
   * `en` that no one ever actually chose. Absence, or a value this build cannot
   * honour, falls through to Turkish.
   */
  const [language, setLanguageState] = useState(resolveInitialLanguage)

  useEffect(() => {
    localStorage.setItem('vk_lang', language)
    document.documentElement.setAttribute('lang', language)
    // Arabic and Urdu are right-to-left; the other four are not. Kept inline
    // rather than behind a constant: three contract tests assert this exact
    // expression as source text, because it is the one line protecting RTL.
    document.documentElement.setAttribute('dir', ['ar', 'ur'].includes(language) ? 'rtl' : 'ltr')
  }, [language])

  /*
   * Normalized on the way in too, so a bad code from a caller cannot reach
   * state — the same guard ThemeContext's setTheme applies to a theme id.
   * Every language button passes a code from its own list, so in practice this
   * only ever matters to the next person who adds one.
   */
  const setLanguage = (next) => {
    // Only a real click reaches this function, so this is the one place that can
    // honestly record intent — which is exactly what the old build never did.
    localStorage.setItem(EXPLICIT_KEY, '1')
    setLanguageState(normalizeLanguage(next))
  }

  // `language` is always one of the six after normalization, so this cannot
  // miss; the fallback stays as the last line of defence if a catalogue entry
  // is ever removed without its code being removed from SUPPORTED_LANGUAGES.
  const t = translations[language] || translations.en

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
