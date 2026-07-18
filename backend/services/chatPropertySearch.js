// backend/services/chatPropertySearch.js
//
// Moved verbatim out of routes/chat.js (move-only refactor — chat.js split,
// stage 4). Executes property search against already-resolved parsed data
// and an already-built Mongo filter:
//
//   resolved parsed data + Mongo filter -> semantic search / description
//   search / field search -> progressive fallback -> properties + search
//   metadata
//
// No behavior change from the original routes/chat.js code — same fallback
// levels, same Mongo queries, same semantic/description honesty rules, same
// flags. This module does not parse raw messages, normalize Gemini output,
// build visitor-facing replies, manage conversation memory, handle
// district-scope clarification, handle lead flow, persist conversations, or
// know about Express/req/res.

import Property from '../models/Property.js'
import { findConceptForWord } from '../utils/lifestyleConcepts.js'
import { hasSoftDescriptionSearch } from './chatMessageParsing.js'
import { buildHardFilterForDescriptionSearch } from './chatFilters.js'
import {
  searchPropertiesByMeaning,
  buildSemanticSearchQuery,
  buildSemanticHardFilter,
} from './propertySemanticSearch.js'

const PROPERTY_SELECT =
  'title listingType price priceLabel district description address propertyType beds baths sqm mainImage images featured status pool garden furnished balcony elevator parking floor createdAt'

// ─── Progressive fallback search ──────────────────────────────────────────────
// Exported (though chat.js never imports it directly — only runPropertySearch
// below calls it) so it can be characterization-tested in isolation with
// controlled fixtures.
export const searchWithFallback = async (filter, mustHaveFilter = {}) => {
  // Step 1: exact search
  let properties = await Property.find(filter)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 0 }
  }

  // Step 2: keep listingType + propertyType + district, drop price/beds/features
  // (mustHave stays enforced — it is strict, unlike the optional feature toggles)
  const step2 = { status: 'Available', ...mustHaveFilter }

  if (filter.listingType) step2.listingType = filter.listingType
  if (filter.propertyType) step2.propertyType = filter.propertyType
  if (filter.district) step2.district = filter.district
  if (filter.$or) step2.$or = filter.$or
  if (filter._id) step2._id = filter._id

  properties = await Property.find(step2)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 1 }
  }

  // Step 3: drop district, keep listingType + propertyType (+ mustHave)
  const step3 = { status: 'Available', ...mustHaveFilter }

  if (filter.listingType) step3.listingType = filter.listingType
  if (filter.propertyType) step3.propertyType = filter.propertyType
  if (filter._id) step3._id = filter._id

  properties = await Property.find(step3)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 2 }
  }

  // Step 4: just listingType + propertyType (+ mustHave) — never drop propertyType
  // or mustHave once specified
  const step4 = { status: 'Available', ...mustHaveFilter }

  if (filter.listingType) step4.listingType = filter.listingType
  if (filter.propertyType) step4.propertyType = filter.propertyType
  if (filter._id) step4._id = filter._id

  properties = await Property.find(step4)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  return { properties, fallbackLevel: 3 }
}

// Structured/generic dwelling words that are already enforced as hard field
// filters (propertyType/listingType) elsewhere. Keeping them in the free-text
// $text query only causes false-positive matches — e.g. every apartment
// listing's title contains "Apartment", so a "near school" search would
// otherwise match every apartment in the database, not just ones about schools.
const STRUCTURED_TERMS_TO_STRIP = new Set([
  'apartment', 'apartments', 'villa', 'villas', 'penthouse', 'penthouses',
  'duplex', 'duplexes', 'studio', 'studios', 'office', 'offices',
  'commercial', 'land', 'shop', 'shops', 'warehouse', 'warehouses',
  'hotel', 'hotels', 'farm', 'farms', 'flat', 'flats', 'home', 'homes',
  'house', 'houses', 'property', 'properties',
  'rent', 'rental', 'rentals', 'sale', 'sell', 'selling', 'buy', 'buying',
  'buys', 'purchase', 'kiralık', 'satılık',
])

// Common connector/filler words that are too generic to prove a listing is
// actually relevant to what the visitor described, even though they aren't
// structured field terms (e.g. "near" appears in both "near school" and
// "near metro" listings — it doesn't tell them apart).
const CONNECTOR_WORDS_TO_IGNORE = new Set([
  'near', 'nearby', 'close', 'closer', 'to', 'for', 'with', 'and', 'or',
  'a', 'an', 'the', 'of', 'is', 'are', 'that', 'this', 'some', 'good',
  'any', 'have', 'has', 'does', 'do', 'want', 'need', 'looking', 'like',
  'area', 'place', 'around', 'from', 'into', 'your', 'you', 'me', 'my',
  'we', 'our', 'there', 'here', 'also', 'still', 'same', 'general',
])

// normalizeWord/getConceptSourcePhrases also exist, byte-identical, in
// routes/chat.js (and, separately, in chatReplyBuilder.js) — they're still
// needed directly in chat.js by memory-owned (detectConceptsInText,
// phraseConceptNames) and district-scope-owned (extractConceptIds) code
// that hasn't moved out yet. Services in this codebase don't reach back into
// routes/chat.js for helpers (see propertySemanticSearch.js's
// buildSemanticHardFilter and lifestyleConcepts.js's toSingular comment for
// the same established pattern) — these are small enough that an
// independent copy here is preferable to inventing a new shared module a
// stage early.
const normalizeWord = (word = '') => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Exported for test-isolation, same reasoning as searchWithFallback above.
export const stripStructuredTerms = (text = '') => {
  const cleaned = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STRUCTURED_TERMS_TO_STRIP.has(normalizeWord(word)))
    .join(' ')
    .trim()

  return cleaned
}

// Simple singular/plural tolerance so "schools" (from Gemini) still matches
// a property whose description only says "school", and vice versa.
const toSingular = (word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

// Prefer Gemini's short, tagged lifestyle/requirement phrases — they stay
// close to what the visitor actually said. Only fall back to the broader
// descriptionQuery (which Gemini tends to pad with loosely-related
// synonyms) when nothing more specific was tagged at all.
const getConceptSourcePhrases = (parsed = {}) => {
  const taggedPhrases = [
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ]

  if (taggedPhrases.length > 0) return taggedPhrases

  return parsed.descriptionQuery ? [parsed.descriptionQuery] : []
}

// Builds the pool of words a property's content must contain at least one of
// to count as a genuine lifestyle match. Words that map to a known concept
// expand to that concept's full synonym set (so "school" also matches
// "educational"/"campus"/etc); words that don't map to any known concept
// fall back to being checked literally, still excluding structured/connector
// noise — so the system stays general for concepts not yet in the dictionary.
export const getRelevanceCheckTerms = (parsed = {}) => {
  const words = getConceptSourcePhrases(parsed)
    .join(' ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter((word) => word.length >= 3 && !STRUCTURED_TERMS_TO_STRIP.has(word) && !CONNECTOR_WORDS_TO_IGNORE.has(word))

  const terms = new Set()

  words.forEach((word) => {
    const concept = findConceptForWord(word)

    if (concept) {
      concept.keywords.forEach((keyword) => terms.add(keyword))
    } else {
      terms.add(word)
    }
  })

  return Array.from(terms)
}

export const propertyMatchesSignificantTerm = (property, terms = []) => {
  // No meaningful vocabulary to check against (e.g. everything was a
  // structured/connector word) — don't reject results we have no way to verify.
  if (terms.length === 0) return true

  const haystack = [property.title, property.description, property.address, property.district]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return terms.some((term) => haystack.includes(toSingular(term)))
}

export const getDescriptionSearchQuery = (parsed = {}, message = '') => {
  const parts = [
    parsed.descriptionQuery,
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ].filter(Boolean)

  const rawQuery = parts.length > 0 ? parts.join(' ') : message
  const cleanedQuery = stripStructuredTerms(rawQuery)

  // Never search for literally nothing — if cleaning removed every word
  // (e.g. the raw query was just "apartment for rent"), fall back to the
  // uncleaned text rather than losing the search entirely.
  return cleanedQuery || rawQuery
}

export const searchByDescription = async ({ parsed, filter, message }) => {
  const descriptionSearchQuery = getDescriptionSearchQuery(parsed, message)

  if (!descriptionSearchQuery || !descriptionSearchQuery.trim()) {
    return {
      properties: [],
      descriptionSearchUsed: false,
      descriptionSearchQuery: null,
      descriptionSearchError: null,
    }
  }

  try {
    const hardFilter = buildHardFilterForDescriptionSearch(filter)

    const searchFilter = {
      ...hardFilter,
      $text: {
        $search: descriptionSearchQuery,
      },
    }

    const rawMatches = await Property.find(searchFilter, {
      score: { $meta: 'textScore' },
    })
      .select(PROPERTY_SELECT)
      .sort({
        score: { $meta: 'textScore' },
        featured: -1,
        createdAt: -1,
      })
      .limit(10)

    // $text can match purely on a generic word (e.g. "apartment" in the
    // title), and Gemini's expanded descriptionQuery can pad in loosely
    // related synonyms (e.g. "family friendly" for a plain "near school"
    // request). Verify relevance using the concept(s) actually tagged by the
    // visitor's request, not every word in the expanded search string.
    const relevanceTerms = getRelevanceCheckTerms(parsed)
    const strongMatches = rawMatches.filter((property) =>
      propertyMatchesSignificantTerm(property, relevanceTerms)
    )

    return {
      properties: strongMatches,
      descriptionSearchUsed: strongMatches.length > 0,
      descriptionSearchQuery,
      descriptionSearchError: null,
    }
  } catch (err) {
    console.log('Description search failed:', err.message)

    return {
      properties: [],
      descriptionSearchUsed: false,
      descriptionSearchQuery,
      descriptionSearchError: err.message,
    }
  }
}

// ─── Search waterfall wrapper ─────────────────────────────────────────────────
// Extraction of the inline sequence that used to live directly in
// routes/chat.js's route handler (steps 1-4 below), copied exactly: decide
// whether semantic search should be attempted, run semantic search, fall
// back to description search when semantic finds nothing, fall back to
// structured search when description finds no VERIFIED match. Takes the
// already-built Mongo `filter` and `mustHaveFilter` as inputs — this module
// does not build filters itself (that stays chatFilters.js's job, called by
// chat.js before this runs).
//
// Return shape intentionally does NOT include semanticSearchAttempted/
// semanticSearchError — the original inline code never tracked either as
// named, externally-observable state (the semantic try/catch only ever
// logged its error and fell through), and neither is read by chat.js's
// existing buildReply()/buildMatchReason()/res.json()/persistence calls.
// Inventing them here would be new behavior, not a move.
export const runPropertySearch = async ({ parsed, filter, mustHaveFilter, message }) => {
  let properties = []
  let fallbackLevel = 0
  let descriptionSearchUsed = false
  let descriptionSearchQuery = null
  let descriptionSearchError = null
  let matchedViaDescription = false
  let matchedViaSemantic = false

  const descriptionSearchAttempted = hasSoftDescriptionSearch(parsed)

  if (descriptionSearchAttempted) {
    // Try semantic (meaning-based) search first — it's the only thing that
    // generalizes across phrasings like "sea facing" / "water view" / "deniz
    // manzaralı" without a keyword dictionary. It only ever runs on the same
    // hard-filtered candidate pool as the existing search (never the whole
    // collection), so it can't override listingType/propertyType/district/
    // budget/features. Any failure (missing embeddings, embedding API error)
    // falls straight through to the existing searchByDescription — unchanged.
    let semanticResults = []

    try {
      const semanticQuery = buildSemanticSearchQuery(parsed)

      if (semanticQuery) {
        const semanticHardFilter = buildSemanticHardFilter({ filter, message })
        console.log('Semantic search attempted. Query:', semanticQuery)
        semanticResults = await searchPropertiesByMeaning({ query: semanticQuery, hardFilter: semanticHardFilter })
      }
    } catch (err) {
      console.log('Semantic search failed, falling back to keyword/concept search:', err.message)
      semanticResults = []
    }

    if (semanticResults.length > 0) {
      properties = semanticResults.map((property) => ({ ...property, matchedViaSemantic: true }))
      matchedViaSemantic = true
      console.log(`Semantic search matched ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}.`)
    } else {
      console.log('Semantic search found no strong matches — falling back to searchByDescription.')

      const descriptionResult = await searchByDescription({
        parsed,
        filter,
        message,
      })

      properties = descriptionResult.properties
      descriptionSearchUsed = descriptionResult.descriptionSearchUsed
      descriptionSearchQuery = descriptionResult.descriptionSearchQuery
      descriptionSearchError = descriptionResult.descriptionSearchError

      // If description search finds no VERIFIED match, fall back to normal
      // field search rather than showing unrelated "description matches".
      if (properties.length === 0) {
        const fallbackResult = await searchWithFallback(filter, mustHaveFilter)
        properties = fallbackResult.properties
        fallbackLevel = fallbackResult.fallbackLevel
      } else {
        matchedViaDescription = true
      }
    }
  } else {
    const fallbackResult = await searchWithFallback(filter, mustHaveFilter)
    properties = fallbackResult.properties
    fallbackLevel = fallbackResult.fallbackLevel
  }

  return {
    properties,
    filter,
    fallbackLevel,
    matchedViaDescription,
    matchedViaSemantic,
    descriptionSearchAttempted,
    descriptionSearchUsed,
    descriptionSearchQuery,
    descriptionSearchError,
  }
}
