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

export const LanguageProvider = ({ children }) => {
  /*
   * A saved preference always wins. Only its ABSENCE — or a value this build
   * cannot honour — falls through to Turkish, so a returning visitor who chose
   * English, German, Russian, Arabic or Urdu keeps that choice untouched.
   */
  const [language, setLanguageState] = useState(() =>
    normalizeLanguage(localStorage.getItem('vk_lang'))
  )

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
  const setLanguage = (next) => setLanguageState(normalizeLanguage(next))

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
