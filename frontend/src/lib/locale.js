/**
 * The Intl locale for each interface language.
 *
 * One table for every place that formats a number or a date for display, so
 * a date on an admin page and a price on a listing follow the same language.
 * Without an explicit locale, toLocaleString() uses the BROWSER's language —
 * an admin reading the site in Turkish on an English-language browser saw
 * English month names and US date order.
 *
 * Display only: stored timestamps are never touched.
 */
export const APP_LOCALES = {
  en: 'en-US',
  tr: 'tr-TR',
  ar: 'ar',
  de: 'de-DE',
  ru: 'ru-RU',
  ur: 'ur-PK',
}

/** The Intl locale for an interface language, English for anything unknown. */
export const localeFor = (language) => APP_LOCALES[language] || APP_LOCALES.en
