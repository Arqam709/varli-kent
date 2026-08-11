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
import { extractConceptIdsFromText } from '../utils/lifestyleConcepts.js'
import {
  buildEvidenceUnits,
  propertyVerifiesDescription,
  evaluateRequestEvidence,
  buildRequestCriteria,
  evaluatePropertyEvidence,
} from './descriptionEvidence.js'
import { hasSoftDescriptionSearch } from './chatMessageParsing.js'
import { LISTING_TYPE_TERMS, PROPERTY_TYPE_TERMS } from '../locales/chatParsingVocabulary.js'
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
// Phase 5 (multilingual deterministic fallback parsing): rawQuery here can
// fall back to the raw visitor message (see getDescriptionSearchQuery below)
// when no descriptionQuery/lifestyle/mustHave/etc. tags were filled in —
// which can be Turkish/Arabic text. Single-word vocabulary terms from the
// same centralized listing/property-type maps keywordFallbackParser uses are
// added here for the same reason: they're already enforced as hard field
// filters elsewhere, so leaving them in free text only causes false-positive
// $text matches. Multi-word terms (e.g. "for rent") are skipped — this set
// is matched one whitespace-split token at a time.
const MULTILINGUAL_STRUCTURED_WORDS = [
  ...Object.values(LISTING_TYPE_TERMS).flat(),
  ...Object.values(PROPERTY_TYPE_TERMS).flat(),
].filter((term) => !term.includes(' '))

const STRUCTURED_TERMS_TO_STRIP = new Set([
  'apartment', 'apartments', 'villa', 'villas', 'penthouse', 'penthouses',
  'duplex', 'duplexes', 'studio', 'studios', 'office', 'offices',
  'commercial', 'land', 'shop', 'shops', 'warehouse', 'warehouses',
  'hotel', 'hotels', 'farm', 'farms', 'flat', 'flats', 'home', 'homes',
  'house', 'houses', 'property', 'properties',
  'rent', 'rental', 'rentals', 'sale', 'sell', 'selling', 'buy', 'buying',
  'buys', 'purchase', 'kiralık', 'satılık',
  ...MULTILINGUAL_STRUCTURED_WORDS,
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
const normalizeWord = (word = '') => word.replace(/İ/g, 'i').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

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

// ─── Search-evidence contract ──────────────────────────────────────────────
// Global, search-method-level facts about a completed search — what was
// requested, what was actually confirmed across the RETURNED set, and
// whether anything was relaxed. This concept-id aggregate (built on the
// strict extractConceptIdsFromText primitive, shared with
// chatReplyBuilder.js's per-card labels) reports, at the DICTIONARY-concept
// level, which requested soft criteria the returned set confirms — a
// complement to the per-property evidence-unit verification in
// services/descriptionEvidence.js that now gates candidate selection above.
export const evaluateSoftCriteriaEvidence = (properties = [], parsed = {}) => {
  const requestedConceptIds = extractConceptIdsFromText(getConceptSourcePhrases(parsed).join(' '))

  if (requestedConceptIds.length === 0) {
    return { requestedConceptIds: [], matchedSoftCriteria: [], unmatchedSoftCriteria: [], descriptionQueryVerified: true }
  }

  const presentAcrossResults = new Set()

  properties.forEach((property) => {
    const propertyText = [property.title, property.description, property.address, property.district]
      .filter(Boolean)
      .join(' ')

    extractConceptIdsFromText(propertyText).forEach((id) => presentAcrossResults.add(id))
  })

  const matchedSoftCriteria = requestedConceptIds.filter((id) => presentAcrossResults.has(id))
  const unmatchedSoftCriteria = requestedConceptIds.filter((id) => !presentAcrossResults.has(id))

  return {
    requestedConceptIds,
    matchedSoftCriteria,
    unmatchedSoftCriteria,
    // "Verified" at the aggregate level means at least one requested soft
    // criterion was confirmed present in at least one returned property —
    // NOT that every property matches every criterion. Per-property/
    // per-concept nuance for card wording lives in chatReplyBuilder.js.
    descriptionQueryVerified: matchedSoftCriteria.length > 0,
  }
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

    // $text retrieves candidates on OR-semantics (any query term), so a match
    // can rest on a single generic word. Verify each candidate with the
    // evidence-unit COVERAGE layer (services/descriptionEvidence.js): the
    // requirement is decomposed into units and a candidate only counts as a
    // verified description match when it covers a strict majority of them (or
    // a unit-adjacency/phrase appears) — never on one overlapping token. Units
    // are built once and reused across all candidates.
    const evidenceUnits = buildEvidenceUnits(parsed)
    const strongMatches = rawMatches.filter((property) =>
      propertyVerifiesDescription(property, evidenceUnits)
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
      // DEMOTE, don't drop: keep every semantic candidate visible, but attach
      // per-property, per-criterion evidence so the reply layers can tell a
      // fully-verified match from an unverified broader alternative. Criteria
      // are built once and reused across candidates. Cosine similarity alone is
      // never treated as proof of any specific requirement.
      const semanticCriteria = buildRequestCriteria(parsed)
      properties = semanticResults.map((property) => ({
        ...property,
        matchedViaSemantic: true,
        softEvidence: evaluatePropertyEvidence(parsed, property, semanticCriteria),
      }))
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

  // mode: which search method actually produced these results.
  //   'exact'       — no soft criteria requested at all (plain structured search)
  //   'semantic'    — meaning-based embedding search matched
  //   'description' — $text/keyword search matched (and was relevance-verified)
  //   'fallback'    — soft criteria were requested but neither semantic nor
  //                   description search could verify anything; results are
  //                   hard-criteria-only (this is the villa/school case —
  //                   candidates returned, nothing soft confirmed)
  const mode = !descriptionSearchAttempted
    ? 'exact'
    : matchedViaSemantic
    ? 'semantic'
    : matchedViaDescription
    ? 'description'
    : 'fallback'

  // Soft-criteria evidence — normalized to { requestedSoftCriteria,
  // matchedSoftCriteria, unmatchedSoftCriteria, descriptionQueryVerified }.
  //
  //   'description'/'fallback' — concept-id evidence (unchanged). These
  //       candidates already passed evidence-unit coverage at RETRIEVAL, so
  //       the concept-level "at least one confirmed" reporting stays valid.
  //   'semantic'   — Change B: cosine retrieval gives NO coverage guarantee,
  //       so compute honest phrase-level evidence from the returned text via
  //       evaluateRequestEvidence. descriptionQueryVerified here means "every
  //       requested criterion is confirmed" — embedding score is NOT treated
  //       as confirmation. The candidates are NOT dropped for failing this;
  //       they remain semantic results (see `properties` above, untouched).
  //   'exact'      — no soft criteria requested; nothing to verify.
  let softEvidence
  if (mode === 'semantic') {
    softEvidence = evaluateRequestEvidence(parsed, properties)
  } else if (mode === 'description' || mode === 'fallback') {
    const conceptEvidence = evaluateSoftCriteriaEvidence(properties, parsed)
    softEvidence = {
      requestedSoftCriteria: conceptEvidence.requestedConceptIds,
      matchedSoftCriteria: conceptEvidence.matchedSoftCriteria,
      unmatchedSoftCriteria: conceptEvidence.unmatchedSoftCriteria,
      descriptionQueryVerified: conceptEvidence.descriptionQueryVerified,
    }
  } else {
    softEvidence = { requestedSoftCriteria: [], matchedSoftCriteria: [], unmatchedSoftCriteria: [], descriptionQueryVerified: true }
  }

  // relaxed: true whenever the visitor's full request was not fully honored
  // — a structured fallback level kicked in, OR soft criteria were
  // requested but never verified. Semantic matches are never "relaxed" by
  // this definition (each one individually cleared the similarity
  // threshold); a description match is only relaxed if the aggregate check
  // above found nothing (mode would be 'fallback' in that case anyway, but
  // this stays explicit for callers that only inspect `relaxed`).
  const relaxed = fallbackLevel > 0 || mode === 'fallback' || (mode === 'description' && !softEvidence.descriptionQueryVerified)

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
    searchEvidence: {
      mode,
      relaxed,
      softSearchAttempted: descriptionSearchAttempted,
      requestedSoftCriteria: softEvidence.requestedSoftCriteria,
      matchedSoftCriteria: softEvidence.matchedSoftCriteria,
      unmatchedSoftCriteria: softEvidence.unmatchedSoftCriteria,
      descriptionQueryVerified: softEvidence.descriptionQueryVerified,
    },
  }
}
