// backend/services/propertyNameResolver.js
//
// Wave 15A — adapted from the donor's services/propertyNameResolver.js.
//
// One narrow question: does this message name ONE specific listing in our own
// inventory, by title? It does not answer questions and does not build
// replies — it reports what it found and lets routes/chat.js decide.
//
// ── What changed from the donor, and why ────────────────────────────────────
//
// The donor's copy is stage 1 of its "what's near this property" feature, so
// it returns { id, title, lat, lng, isApproximate } and its extraction looks
// for POI phrasing ("near X", "X yakın", "قريب من X"). Nearby/POI work is
// Wave 15B and explicitly out of scope here, so this copy:
//
//   * extracts from explicit SPECIFIC-LISTING phrasing instead ("tell me
//     about X", "how much is X"), because the donor's near/yakın patterns
//     belong to the feature that consumes coordinates;
//   * never selects `location`, so no coordinate can reach a reply from here
//     (Wave 9 privacy — the ordinary chatbot search does not select it
//     either);
//   * reports ambiguity to the caller instead of collapsing it to null, so a
//     visitor gets a clarifying question rather than silence;
//   * queries a bounded candidate set rather than loading every Available
//     property into memory on each request.
//
// The token-overlap matcher itself is the donor's, kept close to verbatim —
// it is the part that does the actual work.

import Property from '../models/Property.js'

// The exact public projection the ordinary chatbot search uses. Reused rather
// than re-listed so a resolved listing can never carry a field an ordinary
// search result would not — `location`, `descriptionEmbedding` and every
// admin-only field are absent from both by construction.
import { PROPERTY_SELECT } from './chatPropertySearch.js'

// The existing Show More detector, so pagination can never be mistaken for a
// listing name. See extractTitlePhrase below.
import { isShowMoreRequest } from './chatConversationMemory.js'

// Only properties the ordinary public chatbot would already surface. Same
// literal the fallback ladder in chatPropertySearch.js uses.
const PUBLIC_STATUS = 'Available'

// Enough candidates to detect ambiguity, few enough that a pathological
// message cannot pull the collection into memory.
const CANDIDATE_LIMIT = 25

// More than this and it is a clarification, not a shortlist.
const MAX_CLARIFICATION_CANDIDATES = 4

/*
 * Explicit specific-listing phrasing.
 *
 * The captured group is the candidate title. These are deliberately narrow:
 * a visitor describing what they want ("find modern apartments in Kadıköy")
 * must keep reaching the ordinary parser and search, even when their words
 * happen to appear inside some listing's title. Resolution only starts when
 * the sentence is *about* a named thing.
 */
const TITLE_PATTERNS = [
  // English. Note `show(?:\s+me)?` rather than `show|show\s+me` — alternation
  // is first-match, so the shorter branch would win and leave "me" glued to
  // the front of the captured title.
  /\btell\s+me\s+about\s+(.+)$/i,
  /\b(?:show(?:\s+me)?|open|view)\s+(?:the\s+)?(?:listing\s+)?(?:called\s+|named\s+)?(.+)$/i,
  /\bhow\s+much\s+is\s+(.+?)\??$/i,
  /\bwhat(?:'?s| is)\s+the\s+price\s+of\s+(.+?)\??$/i,
  /\bdetails?\s+(?:about|on|for)\s+(.+?)\??$/i,
  // Turkish — "... hakkında bilgi", "... ne kadar"
  /\b(.+?)\s+hakkında\s+bilgi/i,
  /\b(.+?)\s+ne\s+kadar\s*\??$/i,
  /\b(.+?)\s+adlı\s+(?:ilan|mülk)/i,
  // Arabic — "أخبرني عن X", "كم سعر X"
  /أخبرني\s+عن\s+(.+)$/,
  /كم\s+سعر\s+(.+?)\؟?$/,
  /معلومات\s+عن\s+(.+)$/,
]

// Trailing politeness/punctuation that is not part of a title.
const TRAILING_NOISE = /[\s.,!?;:'"«»؟]+$/

export const extractTitlePhrase = (message = '') => {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return null

  /*
   * "Show me more" is pagination, not a listing named "more". The `show ...`
   * pattern below would otherwise capture it and quietly break the existing
   * Show More flow, so the authoritative detector gets first refusal — reused
   * rather than re-expressed here, so the two can never disagree.
   */
  if (isShowMoreRequest(text)) return null

  for (const pattern of TITLE_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue

    const phrase = (match[1] || '').replace(TRAILING_NOISE, '').trim()
    // A single character is never a title; it is a typo or a stray word.
    if (phrase.length >= 2) return phrase
  }

  return null
}

/*
 * Normalisation, from the donor: fold Turkish İ before lowercasing (the
 * default lowercase of 'İ' produces a combining dot that then fails to match
 * a plain 'i'), then strip everything that is not a letter or number.
 *
 * Deliberately NOT aggressive: it folds case, spacing and punctuation only.
 * Nothing is dropped as a "stop word", so "Bosphorus Residence A" and
 * "Bosphorus Residence B" stay distinct titles.
 */
export const normalizeTitle = (text = '') =>
  String(text)
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .toLowerCase()
    // Punctuation becomes a SEPARATOR rather than being deleted, so
    // "Marina-Residence" and "Marina Residence" normalise alike instead of
    // collapsing into the single token "marinaresidence".
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const normalizeToTokenSet = (text = '') => new Set(normalizeTitle(text).split(' ').filter(Boolean))

/*
 * Donor's matcher, unchanged in substance.
 *
 * A title matches when a strict majority of the phrase's tokens appear in the
 * title's token set, order-independent. For a one- or two-token phrase a
 * "strict majority" would let a single shared word win, which is far too
 * loose against a catalogue of titles — so short phrases must match in full.
 */
const phraseMatchesTitle = (phraseTokens, titleTokenSet) => {
  if (phraseTokens.length === 0) return false

  const matched = phraseTokens.filter((token) => titleTokenSet.has(token)).length

  if (phraseTokens.length <= 2) return matched === phraseTokens.length
  return matched > phraseTokens.length / 2
}

// Exported for isolated testing, same convention as chatPropertySearch.js's
// own exported helpers.
export const findTitleMatches = (phrase, properties = []) => {
  const phraseTokens = Array.from(normalizeToTokenSet(phrase))
  if (phraseTokens.length === 0) return []

  const normalizedPhrase = phraseTokens.join(' ')

  // An exact normalised title always wins outright. Without this, asking for
  // "Bosphorus Residence" where both it and "Bosphorus Residence Annex"
  // exist would be reported as ambiguous, when the visitor named one of them
  // precisely.
  const exact = properties.filter((property) => normalizeTitle(property.title) === normalizedPhrase)
  if (exact.length > 0) return exact

  return properties.filter((property) => phraseMatchesTitle(phraseTokens, normalizeToTokenSet(property.title)))
}

/*
 * Escaped so a title phrase can never become an expression.
 *
 * Without this, a visitor typing "tell me about (a+)+$" would hand MongoDB a
 * catastrophically backtracking regex to run against every title. Every
 * metacharacter is escaped, so the pattern is only ever a literal.
 */
export const escapeRegex = (text = '') => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/*
 * resolvePropertyByName(message, PropertyModel) ->
 *   { status: 'not-a-title-question' }                  nothing to resolve
 *   { status: 'none', phrase }                          named, but no listing
 *   { status: 'resolved', property, phrase }            exactly one
 *   { status: 'ambiguous', candidates, phrase }         several plausible
 *   { status: 'error', phrase }                         lookup itself failed
 *
 * 'none' and 'error' are separate on purpose: telling a visitor "no listing by
 * that name" when the database is actually down is a false statement about
 * our own inventory.
 *
 * Read-only throughout — no property, embedding or conversation is written.
 */
export const resolvePropertyByName = async (message, PropertyModel = Property) => {
  const phrase = extractTitlePhrase(message)

  // No explicit specific-listing phrasing: not our turn, and — importantly —
  // no database query at all, so an ordinary search pays nothing for this
  // feature existing.
  if (!phrase) return { status: 'not-a-title-question' }

  try {
    const anchored = new RegExp(`^\\s*${escapeRegex(phrase)}\\s*$`, 'i')

    // 1. Exact title, case- and space-insensitive. One indexed-ish lookup,
    //    bounded, and the common case.
    const exactMatches = await PropertyModel.find({ status: PUBLIC_STATUS, title: anchored })
      .select(PROPERTY_SELECT)
      .limit(MAX_CLARIFICATION_CANDIDATES + 1)

    if (exactMatches.length === 1) return { status: 'resolved', property: exactMatches[0], phrase }
    if (exactMatches.length > 1) return { status: 'ambiguous', candidates: exactMatches, phrase }

    // 2. Otherwise a bounded candidate set, narrowed by the text index, then
    //    matched by normalised token overlap. $text takes a search string,
    //    not an expression, so the phrase cannot alter the query's shape.
    const candidates = await PropertyModel.find({ status: PUBLIC_STATUS, $text: { $search: phrase } })
      .select(PROPERTY_SELECT)
      .limit(CANDIDATE_LIMIT)

    const matches = findTitleMatches(phrase, candidates)

    if (matches.length === 0) return { status: 'none', phrase }
    if (matches.length === 1) return { status: 'resolved', property: matches[0], phrase }

    return { status: 'ambiguous', candidates: matches.slice(0, MAX_CLARIFICATION_CANDIDATES), phrase }
  } catch (err) {
    // Never throws out of here — the chatbot pipeline is fail-soft — but the
    // caller is told this was a failure, not an empty inventory.
    console.log('resolvePropertyByName failed:', err.message)
    return { status: 'error', phrase }
  }
}
