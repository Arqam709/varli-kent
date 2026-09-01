// backend/utils/istanbulTime.js
//
// Wave 15A — transplanted from the donor.
//
// "What time is it in Istanbul" has to be answered from the real current
// instant, converted to a real timezone. The backend does not run in Istanbul
// (Render picks its own), so `new Date().getHours()` would answer with the
// server's wall clock and confidently state the wrong hour. Every conversion
// below goes through Intl's `timeZone: 'Europe/Istanbul'`, which reads the
// IANA tz database — so this stays correct even if Turkey's offset policy
// changes again, and needs no new dependency.
//
// Two consumers:
//   (A) services/chatDateTimeQuestion.js — the visitor-facing answer.
//   (B) formatIstanbulDateTimeForPrompt() — a machine-readable anchor, for
//       whenever the parser prompt needs to ground a relative phrase.

const ISTANBUL_TIME_ZONE = 'Europe/Istanbul'

// A JS Date is always an absolute UTC instant — there is no such thing as a
// Date "in" a timezone — so this is deliberately just `new Date()`. It exists
// as its own export to give callers and tests one obvious seam for "the
// current instant" rather than inlining `new Date()` everywhere.
export const getIstanbulNow = () => new Date()

/*
 * en-GB with hour12:false gives zero-padded 24-hour numeric parts in Latin
 * digits, which is what the numeric half of the output is built from. Locale
 * here is a formatting detail, not the visitor's language — the visitor's
 * language only selects the weekday and month NAMES below.
 */
const PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: ISTANBUL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export const getIstanbulParts = (date = getIstanbulNow()) => {
  const raw = Object.fromEntries(
    PARTS_FORMATTER.formatToParts(date).map((part) => [part.type, part.value])
  )

  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    // en-GB renders midnight as hour "24" rather than "00"; normalised here
    // so callers never see an hour outside 0–23.
    hour: Number(raw.hour) % 24,
    minute: Number(raw.minute),
    second: Number(raw.second),
  }
}

/*
 * The offset is MEASURED, not asserted.
 *
 * The donor prints a hard-coded "UTC+3". That is true today — Turkey dropped
 * DST in 2016 — but it is a claim about the world baked into a string, and
 * the whole reason this file uses Intl is to not make claims like that. So
 * the label is derived by reading the Istanbul wall clock back as if it were
 * UTC and measuring the gap. If the tz database ever changes, the printed
 * label changes with it instead of quietly lying.
 */
export const getIstanbulOffsetMinutes = (date = getIstanbulNow()) => {
  const parts = getIstanbulParts(date)
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)

  return Math.round((asIfUtc - date.getTime()) / 60000)
}

export const formatUtcOffsetLabel = (date = getIstanbulNow()) => {
  const minutes = getIstanbulOffsetMinutes(date)
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const remainder = absolute % 60

  return remainder === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(remainder).padStart(2, '0')}`
}

/*
 * Weekday and month names come from Intl, per language, rather than from
 * hand-maintained tables — the donor keeps three 12-entry month arrays and
 * three 7-entry weekday arrays, which is a translation surface that can drift
 * and that Intl already answers correctly.
 *
 * Only the NAMES are taken from the localized formatter. The numbers stay in
 * Latin digits from PARTS_FORMATTER, because 'ar' would otherwise render them
 * as Arabic-Indic digits mid-sentence — a change in visible output the donor
 * never made and this wave is not the place to decide on.
 */
const nameFormatterCache = new Map()

const nameFormatter = (locale, option) => {
  const key = `${locale}|${JSON.stringify(option)}`
  if (!nameFormatterCache.has(key)) {
    nameFormatterCache.set(key, new Intl.DateTimeFormat(locale, { timeZone: ISTANBUL_TIME_ZONE, ...option }))
  }
  return nameFormatterCache.get(key)
}

// The chatbot answers in en/tr/ar (see utils/chatLanguage.js). Anything else
// is already normalised away before it reaches here; the fallback is defence
// in depth, not a supported path.
const SUPPORTED = new Set(['en', 'tr', 'ar'])
const localeFor = (language) => (SUPPORTED.has(language) ? language : 'en')

export const istanbulWeekdayName = (date = getIstanbulNow(), language = 'en') =>
  nameFormatter(localeFor(language), { weekday: 'long' }).format(date)

export const istanbulMonthName = (date = getIstanbulNow(), language = 'en') =>
  nameFormatter(localeFor(language), { month: 'long' }).format(date)

const pad2 = (n) => String(n).padStart(2, '0')

/*
 * Visitor-facing "Istanbul now", e.g.
 *   en: "Tuesday, 11 August 2026, 15:23 (Istanbul time, UTC+3)"
 *   tr: "Salı, 11 Ağustos 2026, saat 15:23 (Türkiye saati, UTC+3)"
 *   ar: "الثلاثاء، 11 أغسطس 2026، الساعة 15:23 (بتوقيت إسطنبول، UTC+3)"
 *
 * Sentence shape is the donor's, including the Arabic comma. The parenthetical
 * says which clock this is, so a visitor reading from another country is not
 * left guessing.
 */
export const formatIstanbulDateTime = (date = getIstanbulNow(), language = 'en') => {
  const parts = getIstanbulParts(date)
  const weekday = istanbulWeekdayName(date, language)
  const month = istanbulMonthName(date, language)
  const time = `${pad2(parts.hour)}:${pad2(parts.minute)}`
  const offset = formatUtcOffsetLabel(date)

  if (language === 'tr') {
    return `${weekday}, ${parts.day} ${month} ${parts.year}, saat ${time} (Türkiye saati, ${offset})`
  }
  if (language === 'ar') {
    return `${weekday}، ${parts.day} ${month} ${parts.year}، الساعة ${time} (بتوقيت إسطنبول، ${offset})`
  }
  return `${weekday}, ${parts.day} ${month} ${parts.year}, ${time} (Istanbul time, ${offset})`
}

// Machine-readable anchor: always English and numeric regardless of the
// visitor's language, because its reader is a model grounding its own date
// reasoning, not a person.
export const formatIstanbulDateTimeForPrompt = (date = getIstanbulNow()) => {
  const parts = getIstanbulParts(date)
  const weekday = istanbulWeekdayName(date, 'en')

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)} (${weekday}, ${ISTANBUL_TIME_ZONE}, ${formatUtcOffsetLabel(date)})`
}
