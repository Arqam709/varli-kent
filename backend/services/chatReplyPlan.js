// backend/services/chatReplyPlan.js
//
// Phase 3 (backend deterministic reply localization). Builds the two
// language-independent reply plans agreed in the architecture review:
//   buildSearchResultPlan  — the search-result summary
//   buildMatchReasonPlan   — the per-property "why this matches" reason
//
// These are pure functions: no prose, no English/Turkish/Arabic strings, no
// mutation of inputs. Every decision here (which branch applies, whether a
// concept was verified, which feature ids matched) was already being made
// inside chatReplyBuilder.js's buildReplyText/buildMatchReason — this module
// is an EXTRACTION of that existing decision logic into data, not new
// business logic. chatReplyRenderer.js consumes these plans and has no
// independent authority to decide what counts as verified — it can only
// render what the plan already decided, in whichever language.
//
// This module does not parse messages, run searches, build Mongo filters,
// or know about Express/req/res.

import { extractConceptIdsFromText, CANONICAL_CONCEPT_IDS } from '../utils/lifestyleConcepts.js'
import { hasSoftDescriptionSearch } from './chatMessageParsing.js'

// ─── Shared small helpers (kept as independent copies, matching this
// codebase's established convention — see chatPropertySearch.js's own note
// on why normalizeWord/getConceptSourcePhrases are duplicated rather than
// imported cross-service) ───────────────────────────────────────────────
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

export const hasMultiplePropertyTypes = (parsed = {}) =>
  Array.isArray(parsed.propertyTypes) && parsed.propertyTypes.length > 1

// ─── Per-property soft-match evidence ──────────────────────────────────────
// Moved verbatim (same logic, same strict primitive) from
// chatReplyBuilder.js's evaluateSoftMatchForProperty — re-exported from
// there unchanged for existing callers/tests.
export const evaluateSoftMatchForProperty = (property, parsed = {}) => {
  const requestedConceptIds = extractConceptIdsFromText(getConceptSourcePhrases(parsed).join(' '))

  if (requestedConceptIds.length === 0) {
    return { requestedConceptIds: [], matchedConceptIds: [], unmatchedConceptIds: [] }
  }

  const propertyText = [property.title, property.description, property.address, property.district]
    .filter(Boolean)
    .join(' ')
  const presentConceptIds = extractConceptIdsFromText(propertyText)

  return {
    requestedConceptIds,
    matchedConceptIds: requestedConceptIds.filter((id) => presentConceptIds.includes(id)),
    unmatchedConceptIds: requestedConceptIds.filter((id) => !presentConceptIds.includes(id)),
  }
}

// Feature toggles a fallback relaxation step is allowed to drop — same field
// list SOFT_FEATURE_LABELS used to cover in chatReplyBuilder.js, now
// expressed as ids only (no English label baked in). The renderer resolves
// each id to a localized word at render time.
const SOFT_FEATURE_IDS = ['furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking']

export const getRelaxedFeatureIds = (parsed = {}, mustHaveFilter = {}) =>
  SOFT_FEATURE_IDS.filter((field) => parsed[field] === true && !mustHaveFilter[field])

// ─── Search-result plan ─────────────────────────────────────────────────────
// discriminated by `type`:
//   'no_results' | 'soft_match' | 'structured'
export const buildSearchResultPlan = ({
  properties = [],
  fallbackLevel = 0,
  parsed = {},
  matchedViaDescription = false,
  matchedViaSemantic = false,
  descriptionSearchAttempted = false,
  relaxedFeatureIds = [],
  followUp,
  mixedListingTypes,
  searchEvidence,
  resultScope,
} = {}) => {
  // 'previous_results' when the search was locked inside the previously-shown
  // set (chat.js applied filter._id.$in) — lets the renderer say "none of THOSE"
  // and offer to broaden, distinct from a global no-result. Language-independent.
  const scope = resultScope === 'previous_results' ? 'previous_results' : null
  const count = properties.length
  const followUpPlan = followUp
    ? { offerSlot: followUp.offerSlot ?? null, reOffer: Boolean(followUp.reOffer) }
    : null
  const mixedListingPlan = mixedListingTypes ? { isMixed: Boolean(mixedListingTypes.isMixed) } : null

  // Presentation-only signal from the policy (chatPolicyEngine.deriveSoftOutcome):
  // 'unverified_no_results' | 'unverified_with_alternatives' | null. Carried into
  // the plan so the renderer can explain an unverified soft requirement honestly.
  // Language-independent id, exactly like every other plan field.
  const softOutcome = followUp?.softOutcome ?? null

  if (count === 0) {
    return {
      type: 'no_results',
      descriptionSearchAttempted,
      softOutcome,
      scope,
      followUp: followUpPlan,
      mixedListingTypes: mixedListingPlan,
    }
  }

  const isMultiType = hasMultiplePropertyTypes(parsed)

  // Shared by both branches below (soft_match and structured) — this is the
  // SAME concept-id extraction the rest of this module already uses for
  // verification evidence, reused here purely so the renderer can build a
  // natural, localized "what I searched for" phrase instead of ever
  // interpolating the internal, English-only parsed.descriptionQuery.
  const requestedConceptIds = extractConceptIdsFromText(getConceptSourcePhrases(parsed).join(' '))

  // ─── Result-set-level criterion coverage (the summary/card source of truth) ──
  // searchEvidence.unmatchedSoftCriteria is the criteria NOT verified by ANY
  // returned property — already computed once in runPropertySearch
  // (evaluateRequestEvidence / evaluateSoftCriteriaEvidence), the SAME truth the
  // per-card softEvidence aggregates to. The summary must name ONLY these, never
  // all requestedConceptIds, or it contradicts the cards (a criterion verified by
  // some property but not by ALL is NOT "unverified" at the set level).
  //   - unmatchedConceptIds:  the labelable (concept-id) subset, for localized wording.
  //   - hasUnmatchedCriteria: whether ANY criterion is genuinely unmatched — including
  //       open, non-concept requirements ("wheelchair suitable") that map to no
  //       concept id; distinguishes a real miss from Example C (every criterion met
  //       by SOME listing, but no single listing meets all).
  // Backward-compatible: with no searchEvidence (older callers/fixtures), fall
  // back to requestedConceptIds — the exact pre-fix behavior.
  const unmatchedSoftCriteria =
    searchEvidence && Array.isArray(searchEvidence.unmatchedSoftCriteria) ? searchEvidence.unmatchedSoftCriteria : null
  const toConceptIds = (entry) => {
    const ids = extractConceptIdsFromText(String(entry)) // phrase -> ids ("sea view" -> ["sea_view"])
    if (ids.length > 0) return ids
    return CANONICAL_CONCEPT_IDS.includes(entry) ? [entry] : [] // already a concept id ("sea_view")
  }
  const unmatchedConceptIds = unmatchedSoftCriteria
    ? [...new Set(unmatchedSoftCriteria.flatMap(toConceptIds))]
    : requestedConceptIds
  const hasUnmatchedCriteria = unmatchedSoftCriteria ? unmatchedSoftCriteria.length > 0 : requestedConceptIds.length > 0

  if (matchedViaDescription || matchedViaSemantic) {
    // Semantic path: count only candidates whose per-property softEvidence
    // (attached in the search layer) confirms EVERY requested criterion.
    // Backward-compatible: if no property carries softEvidence (older callers/
    // fixtures), fall back to the previous "count all semantic" behavior so
    // nothing that predates this evidence contract changes.
    const semanticHasEvidence = matchedViaSemantic && properties.some((property) => property && property.softEvidence)

    const verifiedCount = matchedViaSemantic
      ? semanticHasEvidence
        ? properties.filter((property) => property?.softEvidence?.fullyVerified).length
        : count
      : properties.filter((property) => {
          // requestedConceptIds depends only on `parsed`, not the property —
          // reuse the value already hoisted above rather than recomputing it
          // per property via evaluateSoftMatchForProperty's own copy.
          const { matchedConceptIds } = evaluateSoftMatchForProperty(property, parsed)
          return requestedConceptIds.length === 0 || matchedConceptIds.length > 0
        }).length

    // noneVerified/mixedVerified now apply to the semantic path too, but ONLY
    // when real softEvidence is present (semanticHasEvidence). Description keeps
    // its existing behavior (`!matchedViaSemantic`), and a semantic result with
    // no evidence keeps the old "may match by meaning" wording.
    const evidenceGoverned = !matchedViaSemantic || semanticHasEvidence
    const noneVerified = evidenceGoverned && verifiedCount === 0
    const mixedVerified = evidenceGoverned && verifiedCount > 0 && verifiedCount < count

    return {
      type: 'soft_match',
      count,
      verifiedCount,
      noneVerified,
      mixedVerified,
      matchedViaSemantic,
      matchedViaDescription,
      requestedConceptIds,
      unmatchedConceptIds,
      hasUnmatchedCriteria,
      scope,
      descriptionQuery: parsed.descriptionQuery || null,
      listingType: parsed.listingType || null,
      propertyType: !isMultiType ? parsed.propertyType || null : null,
      propertyTypes: isMultiType ? parsed.propertyTypes : [],
      followUp: followUpPlan,
      mixedListingTypes: mixedListingPlan,
    }
  }

  const districts = [
    ...(parsed.district ? [parsed.district] : []),
    ...(Array.isArray(parsed.districts) ? parsed.districts : []),
  ]

  return {
    type: 'structured',
    count,
    fallbackLevel,
    listingType: parsed.listingType || null,
    propertyType: !isMultiType ? parsed.propertyType || null : null,
    propertyTypes: isMultiType ? parsed.propertyTypes : [],
    maxPrice: parsed.maxPrice || null,
    districts,
    descriptionSearchAttempted,
    descriptionQuery: parsed.descriptionQuery || null,
    requestedConceptIds,
    softOutcome,
    relaxedFeatureIds: fallbackLevel > 0 ? relaxedFeatureIds : [],
    followUp: followUpPlan,
    mixedListingTypes: mixedListingPlan,
  }
}

// ─── Match-reason plan (per property) ───────────────────────────────────────
export const buildMatchReasonPlan = (property = {}, parsed = {}, matchedViaDescription = false, matchedViaSemantic = false) => {
  const requestedDistricts = [
    ...(parsed.district ? [parsed.district] : []),
    ...(Array.isArray(parsed.districts) ? parsed.districts : []),
  ]

  const propertyDistrict = String(property.district || '')
  const districtMatches =
    requestedDistricts.length > 0 &&
    requestedDistricts.some((d) => propertyDistrict.toLowerCase().includes(String(d).toLowerCase()))

  const listingTypeMatches = Boolean(parsed.listingType) && property.listingType === parsed.listingType
  const propertyTypeMatches = Boolean(parsed.propertyType) && property.propertyType === parsed.propertyType
  const propertyTypeInRequestedSet =
    !propertyTypeMatches &&
    Array.isArray(parsed.propertyTypes) &&
    parsed.propertyTypes.length > 1 &&
    parsed.propertyTypes.includes(property.propertyType)
  const bedsMatches = Boolean(parsed.beds) && Number(property.beds) === Number(parsed.beds)
  const bathsMatches = Boolean(parsed.baths) && Number(property.baths) === Number(parsed.baths)

  const withinBudget =
    (!parsed.minPrice || Number(property.price) >= Number(parsed.minPrice)) &&
    (!parsed.maxPrice || Number(property.price) <= Number(parsed.maxPrice))
  const budgetMatches = Boolean(parsed.minPrice || parsed.maxPrice) && withinBudget

  const featureFieldIds = ['furnished', 'balcony', 'elevator', 'pool', 'garden']
  const matchedFeatureIds = featureFieldIds.filter((id) => parsed[id] === true && property[id])

  const parkingMatches =
    parsed.parking === true &&
    property.parking &&
    !['', 'no', 'none'].includes(String(property.parking).toLowerCase())

  if (parkingMatches) matchedFeatureIds.push('parking')

  const { requestedConceptIds, matchedConceptIds, unmatchedConceptIds } = evaluateSoftMatchForProperty(property, parsed)

  // Lifestyle evidence only ever applies when a soft search actually ran.
  //
  // Change B: a semantic match now claims only the concepts the property text
  // ACTUALLY confirms (matchedConceptIds), exactly like a description match —
  // NOT every requested concept. Embedding similarity retrieves the candidate
  // but is not treated as per-concept confirmation. When a semantic candidate
  // confirms no specific concept, matchedConceptIds is empty and the generic
  // "matches by meaning" claim below carries it honestly instead.
  const lifestyleApplies = matchedViaDescription || matchedViaSemantic
  const confirmedConceptIds = requestedConceptIds.length === 0 ? [] : matchedConceptIds
  const finalConfirmedConceptIds = lifestyleApplies ? confirmedConceptIds : []

  const semanticGenericClaim = lifestyleApplies && finalConfirmedConceptIds.length === 0 && matchedViaSemantic
  const descriptionGenericClaim =
    lifestyleApplies &&
    finalConfirmedConceptIds.length === 0 &&
    !matchedViaSemantic &&
    matchedViaDescription &&
    requestedConceptIds.length === 0 &&
    Boolean(parsed.descriptionQuery)
  const unverifiedConceptId =
    lifestyleApplies && finalConfirmedConceptIds.length === 0 && matchedViaDescription && requestedConceptIds.length > 0
      ? unmatchedConceptIds[0] || null
      : null

  // ─── Semantic evidence override (Area A) ────────────────────────────────
  // When the search layer attached per-property softEvidence, the soft claim
  // and the unverified note come from THAT requirement-agnostic, per-criterion
  // verdict — not from concept-only similarity. This lets an open requirement
  // (wheelchair, music studio) be reported honestly, and lets a partial match
  // (family confirmed, school not) show BOTH the confirmed part and the
  // unconfirmed note. Description/fallback keep the concept-only logic above.
  const softEvidence = matchedViaSemantic && property && property.softEvidence ? property.softEvidence : null

  let planMatchedConceptIds = finalConfirmedConceptIds
  let planUnverifiedConceptId = unverifiedConceptId
  let planHasUnverifiedRequirement = false
  let planSemanticGenericClaim = semanticGenericClaim
  let planDescriptionGenericClaim = descriptionGenericClaim

  if (softEvidence) {
    const conceptsOf = (phrases) =>
      [...new Set((Array.isArray(phrases) ? phrases : []).flatMap((phrase) => extractConceptIdsFromText(phrase)))]
    const verifiedConceptIds = conceptsOf(softEvidence.verifiedCriteria)
    const unverifiedConceptIds = conceptsOf(softEvidence.unverifiedCriteria)

    planMatchedConceptIds = verifiedConceptIds
    planUnverifiedConceptId = unverifiedConceptIds[0] || null
    planHasUnverifiedRequirement =
      Array.isArray(softEvidence.unverifiedCriteria) && softEvidence.unverifiedCriteria.length > 0
    // A positive generic claim only when EVERYTHING was verified but no concept
    // label applies (an open requirement confirmed by evidence units) — never
    // when a requirement is left unconfirmed.
    planSemanticGenericClaim = softEvidence.fullyVerified === true && verifiedConceptIds.length === 0
    planDescriptionGenericClaim = false
  }

  return {
    propertyType: parsed.propertyType || null,
    propertyTypeValue: property.propertyType || null,
    listingType: parsed.listingType || null,
    propertyTypeMatches,
    listingTypeMatches,
    districtMatches,
    propertyTypeInRequestedSet,
    bedsMatches,
    bathsMatches,
    budgetMatches,
    beds: parsed.beds || null,
    baths: parsed.baths || null,
    matchedFeatureIds,
    matchedConceptIds: planMatchedConceptIds,
    unverifiedConceptId: planUnverifiedConceptId,
    hasUnverifiedRequirement: planHasUnverifiedRequirement,
    semanticGenericClaim: planSemanticGenericClaim,
    descriptionGenericClaim: planDescriptionGenericClaim,
    matchedViaSemantic,
    matchedViaDescription,
    descriptionQuery: parsed.descriptionQuery || null,
    requestedDistricts,
    propertyDistrict: property.district || null,
  }
}

// Re-exported for chat.js/policy callers that only need to know "is there a
// soft/lifestyle search active" — unchanged from chatMessageParsing.js.
export { hasSoftDescriptionSearch }
