// backend/services/chatDateTimeQuestion.js
//
// Wave 15A — transplanted from the donor.
//
// Deterministic "what time is it" / "saat kaç" / "كم الساعة" early exit,
// checked in routes/chat.js BEFORE the Gemini parse, the same convention as
// the isPropertyPage early return already there. A clock question needs no
// model, no property search and no embedding call, so it costs nothing.
//
// Deliberately narrow: it fires only for an unambiguous literal question
// about the current date/time/day, never for scheduling phrases ("call me
// tomorrow", "available this weekend") — those carry real search or lead
// intent and must still reach the normal pipeline.

import { formatIstanbulDateTime, getIstanbulNow } from '../utils/istanbulTime.js'
import { renderDateTimeNow } from './chatReplyRenderer.js'

// English "time" is a common word in non-clock phrases. Rather than attempt a
// grammatical parse, a small bounded exclusion list covers the continuations
// that actually occur — the same tradeoff this codebase already accepts for
// free-text matching elsewhere (see lifestyleConcepts.js).
const NOT_LITERAL_TIME_FOLLOWERS = /^\s+(frame|difference|zone|to\b|for\b|being\b|management)/

const ENGLISH_TIME_PATTERNS = [
  /\bwhat\s+time\s+is\s+it\b/,
  /\bwhat'?s\s+the\s+time\b/,
  /\bwhat\s+is\s+the\s+time\b/,
  /\bcurrent\s+time\b/,
  /\btell\s+me\s+the\s+time\b/,
]

/*
 * Regex \b is defined against the ASCII \w class, which does NOT contain
 * Turkish's ç ğ ı ö ş ü. A trailing \b straight after one of those letters
 * ("kaç\b") therefore never matches at all — verified, not hypothetical.
 * TURKISH_WORD_END replaces it with "not followed by another word character",
 * which also correctly keeps "saat kaç" from matching inside the agglutinated
 * "saat kaçta" ("at what time" — a scheduling question, one word, no space).
 */
const TURKISH_WORD_END = '(?![a-zA-Z0-9çÇğĞıİöÖşŞüÜ])'

// Unambiguous enough to need no exclusion list.
const OTHER_PATTERNS = [
  // English — date / weekday
  /\bwhat'?s\s+today'?s?\s+date\b/,
  /\bwhat\s+is\s+today'?s?\s+date\b/,
  /\bwhat\s+(is\s+)?the\s+date\s+today\b/,
  /\bwhat\s+day\s+is\s+it\b/,
  // Turkish — see TURKISH_WORD_END above for why \b cannot close these
  new RegExp(`\\bsaat\\s+kaç${TURKISH_WORD_END}`),
  /\bbugün\s+günlerden\s+ne\b/,
  new RegExp(`\\bbugün\\s+ayın\\s+kaçı${TURKISH_WORD_END}`),
  /\bbugünün\s+tarihi\s+ne\b/,
  // Arabic
  /كم\s+الساعة/,
  /ما\s+هو\s+التاريخ\s+اليوم/,
  /ما\s+تاريخ\s+اليوم/,
  /اليوم\s+كم/,
]

export const isLiteralDateTimeQuestion = (message = '') => {
  const text = typeof message === 'string' ? message.trim().toLowerCase() : ''
  if (!text) return false

  const matchesTimePattern = ENGLISH_TIME_PATTERNS.some((pattern) => {
    const match = text.match(pattern)
    if (!match) return false

    const tail = text.slice(match.index + match[0].length)
    return !NOT_LITERAL_TIME_FOLLOWERS.test(tail)
  })

  if (matchesTimePattern) return true

  return OTHER_PATTERNS.some((pattern) => pattern.test(text))
}

// `date` is injectable so tests can assert an exact string instead of racing
// the clock; production always takes the default.
export const buildDateTimeAnswer = (language = 'en', date = getIstanbulNow()) =>
  renderDateTimeNow(formatIstanbulDateTime(date, language), language)
