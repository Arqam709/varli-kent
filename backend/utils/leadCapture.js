// backend/utils/leadCapture.js
//
// Pure helper functions for chatbot lead capture — no state, no DB calls, no
// side effects. Given the same input, always returns the same output. The
// conversation state machine (pending/confirming/save) lives in
// services/chatLeadFlow.js, which is the only place these are called from.
//
// Phase 3 (backend deterministic reply localization): the visitor-facing
// question/summary builders below (buildMissingFieldsQuestion,
// buildConfirmationSummary, buildPropertyDisambiguationQuestion) gained an
// optional trailing `language = 'en'` parameter and now render through
// services/chatReplyRenderer.js. buildInterestType() and buildLeadMessage()
// are deliberately UNCHANGED and take no language parameter: their output is
// not visitor-facing — buildInterestType()'s return value is persisted
// directly to ContactSubmission.interestType (a canonical, staff-facing
// value the admin panel filters on), and buildLeadMessage() builds the
// internal staff notification body. Translating either would make the same
// DB field hold different literal values depending on what language a lead
// happened to arrive in, and would send staff notifications in whatever
// language the visitor picked — neither is acceptable, so both stay fixed,
// canonical English. The one place buildInterestType()'s value reaches a
// visitor at all is the confirmation summary's "Interest:" line, which maps
// it through a separate DISPLAY-ONLY label (chatMessages.js's
// leadFlow.interestTypeDisplay) — the canonical value itself is never
// touched.
//
// All detection/extraction functions (detectLeadIntent,
// detectConfirmationIntent, detectCancellationIntent, extractEmail,
// extractPhone, extractNameFromPhrase, extractBareName, extractPreferredTime,
// resolveOrdinalIndex) are English-only raw-text pattern matching — this is
// the dialogue-act layer, explicitly out of scope for Phase 3 (deferred to a
// later multilingual-patterns phase) — left completely unchanged.

import {
  renderMissingFieldsQuestion,
  renderConfirmationSummary,
  renderPropertyDisambiguationQuestion,
} from '../services/chatReplyRenderer.js'

// ─── Intent detection ──────────────────────────────────────────────────────
// Primary signal is Gemini's own intentType/replyType classification
// (already computed by the property parser, no extra API call needed).
// The pattern list below is a deterministic safety net — general phrasing
// patterns (not exact sentences) so it still catches intent when Gemini is
// unavailable (keyword-fallback path) or under-classifies a borderline
// message like "I like this property".
const LEAD_INTENT_PATTERNS = [
  /\b(call|contact|reach)\s+(me|us)\b/,
  /\bcan\s+(someone|somebody|anybody|an?\s+agent)\s+(call|contact|reach)\b/,
  /\b(make|arrange|book|schedule)\s+(an?\s+)?(appointment|viewing|visit|tour)\b/,
  /\b(appointment|viewing|visit|tour)\s+for\s+(this|the|it|me)\b/,
  /\bi\s+want\s+to\s+(visit|see|view|book|schedule|arrange|meet)\b/,
  /\bcan\s+i\s+(visit|see|view)\s+(it|this|that)\b/,
  /\b(is\s+it|is\s+this)\s+(still\s+)?available\b/,
  /\bmore\s+details\b/,
  /\bmeet\s+(an?\s+)?agent\b/,
  /\bcontact\s+(an?\s+)?agent\b/,
  /\btalk\s+to\s+(your\s+)?team\b/,
  /\bi\s+(like|love)\s+this\b/,
  /\bplease\s+contact\s+me\b/,
  /\bcall\s+me\s+about\s+(this|it)\b/,
  /\bsee\s+it\s+(today|tomorrow|this\s+week)\b/,
  /\bwhatsapp\b/,
]

const hasDeterministicLeadIntent = (message = '') => {
  const text = message.trim().toLowerCase()
  return LEAD_INTENT_PATTERNS.some((pattern) => pattern.test(text))
}

export const detectLeadIntent = (message = '', parsedFromMessage = {}) => {
  const geminiSaysContact =
    parsedFromMessage.intentType === 'contact_request' || parsedFromMessage.replyType === 'contact_reply'

  return geminiSaysContact || hasDeterministicLeadIntent(message)
}

// ─── Confirmation / cancellation detection ─────────────────────────────────
const CONFIRM_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|correct|confirm(ed)?|send it|go ahead|that'?s right|sounds good|ok(ay)?|please\s+send)\b/i,
]

export const detectConfirmationIntent = (message = '') => CONFIRM_PATTERNS.some((pattern) => pattern.test(message.trim()))

const CANCEL_PATTERNS = [/^\s*(no|nope|nah|cancel|never\s*mind|don'?t\s+send|stop|not\s+now)\b/i]

export const detectCancellationIntent = (message = '') => CANCEL_PATTERNS.some((pattern) => pattern.test(message.trim()))

// ─── Deterministic extraction ──────────────────────────────────────────────
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const PHONE_REGEX = /(\+?\d[\d\s().-]{6,17}\d)/

export const extractEmail = (text = '') => {
  const match = text.match(EMAIL_REGEX)
  return match ? match[0] : null
}

export const extractPhone = (text = '') => {
  const match = text.match(PHONE_REGEX)
  if (!match) return null
  return match[0].replace(/[^\d+]/g, '')
}

const capitalizeWords = (text = '') => text.replace(/\b\w/g, (char) => char.toUpperCase())

const NAME_PATTERNS = [
  /\bmy name is\s+([a-zA-ZÀ-ÿ'’\- ]{2,40})/i,
  /\bthis is\s+([a-zA-ZÀ-ÿ'’\- ]{2,40})/i,
  /\bi am\s+([a-zA-ZÀ-ÿ'’\- ]{2,40})/i,
  /\bi'm\s+([a-zA-ZÀ-ÿ'’\- ]{2,40})/i,
  /\bname[:\-]\s*([a-zA-ZÀ-ÿ'’\- ]{2,40})/i,
]

// Explicit trigger-phrase extraction ("my name is Arqam"). Safe to use at
// any conversation stage, including corrections during confirmation, since
// it requires an unambiguous phrase, not just a bare word.
export const extractNameFromPhrase = (text = '') => {
  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern)
    if (!match || !match[1]) continue

    const name = match[1].split(/,|\band\b|\bphone\b|\bemail\b|\bcall\b/i)[0].trim()
    if (name.length >= 2) return capitalizeWords(name)
  }

  return null
}

const removeMatchedSubstring = (text, regex) => {
  const match = text.match(regex)
  return match ? text.replace(match[0], ' ') : text
}

// Removes any recognizable email/phone substring, leaving whatever text
// remains (used by extractBareName to find a leftover name-shaped token).
export const stripContactSubstrings = (text = '') => {
  let result = removeMatchedSubstring(text, EMAIL_REGEX)
  result = removeMatchedSubstring(result, PHONE_REGEX)
  return result
}

const NAME_CONNECTOR_STOPWORDS = new Set([
  'and', 'is', 'my', 'phone', 'email', 'call', 'me', 'contact', 'number', 'the', 'a', 'an',
  // Ordinal/pronoun words a visitor answering "which property?" would use —
  // excluded so "the first one" can never be misread as a bare name.
  'first', 'second', 'third', 'fourth', 'fifth', 'one', 'two', 'that', 'this', 'it',
])

const cleanNameCandidate = (text = '') =>
  text
    .replace(/[,.!?;:]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !NAME_CONNECTOR_STOPWORDS.has(word.toLowerCase()))
    .join(' ')
    .trim()

// Pure shape check: is this candidate string plausibly a human name (1-3
// alphabetic words, no digits/symbols, reasonable length)? Deliberately
// permissive — the confirmation step catches any mistake.
export const looksLikeBareName = (candidate = '') => {
  if (!candidate) return false
  if (!/^[a-zA-ZÀ-ÿ'’\- ]+$/.test(candidate)) return false

  const words = candidate.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 3) return false

  return words.every((word) => word.length >= 2 && word.length <= 20)
}

// Extracts a plausible bare name from text with no trigger phrase, e.g.
// "arqam" alone, or "arqam 5013562460 arqamwaqar42@gmail.com" -> "Arqam".
// Callers are responsible for deciding WHEN it's appropriate to call this
// (see services/chatLeadFlow.js) — it has no conversation-state awareness.
export const extractBareName = (text = '') => {
  const candidate = cleanNameCandidate(stripContactSubstrings(text))
  return looksLikeBareName(candidate) ? capitalizeWords(candidate) : null
}

const TIME_KEYWORDS = [
  'today', 'tomorrow', 'tonight', 'this morning', 'this afternoon', 'this evening',
  'this week', 'this weekend', 'next week', 'weekend',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'morning', 'afternoon', 'evening',
]

export const extractPreferredTime = (text = '') => {
  const lower = text.toLowerCase()
  const found = TIME_KEYWORDS.find((keyword) => lower.includes(keyword))
  if (!found) return null

  const index = lower.indexOf(found)
  return text.slice(Math.max(0, index - 15), index + found.length + 15).trim()
}

// ─── Validation ─────────────────────────────────────────────────────────────
export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')

export const isValidPhone = (phone) => {
  const digits = (phone || '').replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

// Canonical field ids (name/phone/email) — not English words. Phase 3
// changed this from returning ready-made English phrases ('phone number')
// to returning ids, specifically so buildMissingFieldsQuestion can resolve
// each id to a localized field name at render time instead of the display
// word being baked into the detection result. This does not change WHICH
// fields are detected as missing, in what order, or how many — only the
// token identifying each one — so it does not touch the lead state machine.
export const getMissingLeadFields = (pendingLead = {}) => {
  const missing = []

  if (!pendingLead.name) missing.push('name')
  if (!pendingLead.phone || !isValidPhone(pendingLead.phone)) missing.push('phone')
  if (!pendingLead.email || !isValidEmail(pendingLead.email)) missing.push('email')

  return missing
}

// English-only legacy helper — no longer used internally (see
// buildMissingFieldsQuestion below, which now goes through
// chatReplyRenderer.js's joinList for all three languages), kept
// exported/unchanged in case anything external still references it.
export const joinFieldNames = (items) => {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// Asks for exactly what's missing — one field is phrased as a single
// targeted question; multiple fields are asked together in one message and
// also invite a preferred appointment time (optional, not gated on).
// propertyTitle, when known, tailors the intro to "arrange an appointment
// for this property" instead of the generic "have our team reach out".
// `missingFields` are canonical ids from getMissingLeadFields (name/phone/
// email) — `language` defaults to 'en', reproducing the exact pre-Phase-3
// English wording when omitted.
export const buildMissingFieldsQuestion = (missingFields, propertyTitle = null, language = 'en') =>
  renderMissingFieldsQuestion(missingFields, propertyTitle, language)

// ─── Property disambiguation ────────────────────────────────────────────────
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth']

// Resolves a visitor's answer to "which property?" into a zero-based index,
// e.g. "the second one" or "2nd" -> 1. Returns -1 if unresolved.
export const resolveOrdinalIndex = (message = '') => {
  const lower = message.toLowerCase()

  const wordIndex = ORDINAL_WORDS.findIndex((word) => new RegExp(`\\b${word}\\b`).test(lower))
  if (wordIndex !== -1) return wordIndex

  const numMatch = lower.match(/\b([1-5])(st|nd|rd|th)?\b/)
  if (numMatch) return Number(numMatch[1]) - 1

  return -1
}

// `language` defaults to 'en', reproducing the exact pre-Phase-3 English
// wording (same ordinal words, same Oxford-comma-with-"or" join) when
// omitted.
export const buildPropertyDisambiguationQuestion = (candidateProperties = [], language = 'en') =>
  renderPropertyDisambiguationQuestion(candidateProperties.length, language)

// ─── ContactSubmission mapping ──────────────────────────────────────────────
export const buildInterestType = (parsed = {}) => {
  if (parsed.listingType === 'Sale') return 'Buying'
  if (parsed.listingType === 'Rent') return 'Renting'
  return 'General'
}

// Short, human-readable description of the active search context, e.g.
// "apartment for sale in Büyükçekmece" — reused both in the confirmation
// summary shown to the visitor and in the saved ContactSubmission message.
export const describeSearchContext = (parsed = {}) => {
  const parts = []

  if (parsed.propertyType) parts.push(parsed.propertyType.toLowerCase())
  if (parsed.listingType) parts.push(`for ${parsed.listingType.toLowerCase()}`)

  const districts = [
    ...(parsed.district ? [parsed.district] : []),
    ...(Array.isArray(parsed.districts) ? parsed.districts : []),
  ]
  if (districts.length > 0) parts.push(`in ${districts.join(' or ')}`)

  return parts.length > 0 ? parts.join(' ') : null
}

// `language` defaults to 'en', reproducing the exact pre-Phase-3 English
// summary when omitted. buildInterestType(parsed) itself is never touched —
// only its DISPLAY on the "Interest:" line is localized (see the file
// header note on why buildInterestType/buildLeadMessage stay canonical).
export const buildConfirmationSummary = (pendingLead, parsed, language = 'en') => {
  const searchContextText = pendingLead.propertyTitle ? null : describeSearchContext(parsed)
  return renderConfirmationSummary(pendingLead, buildInterestType(parsed), searchContextText, language)
}

export const buildLeadMessage = ({ pendingLead, parsed, message }) => {
  const lines = ['Submitted via VarliKent AI Chatbot.', '']

  if (pendingLead.propertyTitle) {
    lines.push(
      `Interested in: ${pendingLead.propertyTitle}${pendingLead.propertyId ? ` (ID: ${pendingLead.propertyId})` : ''}`
    )
  }

  const contextLine = describeSearchContext(parsed)
  if (contextLine) {
    lines.push(`Property/search: ${contextLine}`)
  }

  if (pendingLead.preferredTime) {
    lines.push(`Preferred contact time: ${pendingLead.preferredTime}`)
  }

  lines.push('', `Visitor's own words: "${message}"`)

  return lines.join('\n')
}
