// backend/services/chatReplyBuilder.js
//
// Phase 3 (backend deterministic reply localization): this file is now a
// compatibility FACADE. Every export keeps its original name and signature
// — routes/chat.js, chatDistrictScope.js, and every existing test import
// this exact same set of names, unchanged. Each reply-producing export
// gains one optional trailing `language = 'en'` parameter; every export
// called with no `language` argument produces byte-identical English output
// to before this phase (verified against the full existing
// testChatReplyBuilder.js/testChatSearchEvidence.js suites).
//
// The actual decision logic (what counts as verified, which fallback level
// applies, which slot to ask about) now lives in chatReplyPlan.js — pure,
// language-independent. The actual per-language prose lives in
// chatReplyRenderer.js and locales/chatMessages.js. This file's only job is
// to keep the OLD call shape working while delegating to the new ones.
//
// shouldSkipGeminiAskQuestion, hasActiveSearchContext,
// shouldContinuePropertyFlow, buildMissingInfoQuestion(WithSlots),
// buildNextUsefulQuestion(WithSlots), pluralizePropertyType, and
// describePropertyTypesPhrase carry no visitor-facing prose Phase 3 needs to
// touch (the first three are routing booleans; the ask/next-question
// question-text pair is superseded in production by chatPolicyEngine.js +
// renderSlotQuestion, per the Phase 4 comment in routes/chat.js, but stays
// exported/tested/English-only since nothing calls it for real replies
// anymore) — left completely unchanged.

import { findConceptForWord, extractConceptIdsFromText } from '../utils/lifestyleConcepts.js'
import {
  hasSoftDescriptionSearch,
  hasKnownPropertyType,
  messageExpressesTypeUncertainty,
} from './chatMessageParsing.js'
import {
  hasMultiplePropertyTypes,
  evaluateSoftMatchForProperty,
  buildSearchResultPlan,
  buildMatchReasonPlan,
  getRelaxedFeatureIds,
} from './chatReplyPlan.js'
import {
  renderNonPropertyReply,
  renderSlotQuestionText,
  renderGenericSlotQuestion,
  renderSlotFragment,
  renderMultiSlotQuestion,
  renderRefinementOfferText,
  renderRefinementReofferText,
  renderMixedListingNotice,
  renderSearchResultPlan,
  renderMatchReasonPlan,
  featureLabel,
  joinList,
} from './chatReplyRenderer.js'
import { CHAT_MESSAGES } from '../locales/chatMessages.js'

// Skip Gemini's own follow-up question when a soft description search should
// run instead, or when the visitor just declined to narrow down — re-asking
// for district/budget right after "no preference" is exactly the nagging this
// prevents. Essential missing fields are still asked deterministically by
// buildMissingInfoQuestion afterwards.
export const shouldSkipGeminiAskQuestion = (parsed) =>
  hasSoftDescriptionSearch(parsed) || parsed.noPreference === true

const PROPERTY_FLOW_INTENTS = ['property_search', 'property_followup']

// True when the merged conversation state already holds concrete search
// criteria worth continuing with (structured fields or a pending
// lifestyle/description search).
export const hasActiveSearchContext = (parsed = {}) =>
  Boolean(
    parsed.listingType ||
      parsed.propertyType ||
      (Array.isArray(parsed.propertyTypes) && parsed.propertyTypes.length > 0) ||
      parsed.district ||
      (Array.isArray(parsed.districts) && parsed.districts.length > 0) ||
      parsed.beds ||
      parsed.baths ||
      parsed.minPrice ||
      parsed.maxPrice ||
      parsed.minSqm ||
      parsed.maxSqm ||
      hasSoftDescriptionSearch(parsed)
  )

// Guard against Gemini's inconsistent "property intent + casual replyType"
// combination (verified live: a mid-search "no i am just looking i didnt
// decide anything yet" came back as intentType property_followup, replyType
// casual_reply, noPreference true, with the full search context intact).
// When Gemini itself says the visitor is still in a property flow AND either
// flagged a no-preference answer or the merged state already has real
// criteria, the turn must continue toward search — replyType alone must not
// divert it into the context-blind canned casual reply. A genuine casual
// message keeps intentType casual_chat and is unaffected.
export const shouldContinuePropertyFlow = (parsed = {}) =>
  PROPERTY_FLOW_INTENTS.includes(parsed.intentType) &&
  (parsed.noPreference === true || hasActiveSearchContext(parsed))

export const buildNonPropertyReply = (parsed, language = 'en') => {
  if (
    (parsed.intentType === 'casual_chat' || parsed.replyType === 'casual_reply') &&
    !shouldContinuePropertyFlow(parsed)
  ) {
    return renderNonPropertyReply('casual', language)
  }

  if (parsed.intentType === 'emotional_message' || parsed.replyType === 'support_reply') {
    return renderNonPropertyReply('emotional', language)
  }

  if (parsed.intentType === 'contact_request' || parsed.replyType === 'contact_reply') {
    return renderNonPropertyReply('contact', language)
  }

  if (parsed.intentType === 'website_service_question' || parsed.replyType === 'service_reply') {
    return renderNonPropertyReply('service', language)
  }

  if (parsed.intentType === 'unknown' || parsed.replyType === 'unknown_reply') {
    return renderNonPropertyReply('unknown', language)
  }

  return null
}

// Structured variant (Phase 3, pre-existing): the question-selection branch
// itself declares which logical slot it is asking about, so pendingQuestion
// creation never has to reverse-engineer slots from English text. Not
// touched by Phase 3 (backend deterministic reply localization) — see file
// header. Still English-only by design; nothing on the production reply
// path calls it anymore.
export const buildMissingInfoQuestionWithSlots = (parsed, message = '') => {
  if (hasSoftDescriptionSearch(parsed)) {
    return null
  }

  if (!parsed.listingType) {
    return { text: 'Are you looking to buy or rent?', slots: ['listingType'] }
  }

  if (!hasKnownPropertyType(parsed)) {
    if (messageExpressesTypeUncertainty(message)) {
      return {
        text: 'Would you prefer apartment, villa, office, or should I show residential properties?',
        slots: ['propertyType'],
      }
    }

    return {
      text: 'What type of property are you looking for — apartment, villa, office, or something else?',
      slots: ['propertyType'],
    }
  }

  return null
}

export const buildMissingInfoQuestion = (parsed, message = '') =>
  buildMissingInfoQuestionWithSlots(parsed, message)?.text ?? null

// ─── Next useful question helper (pre-existing, English-only, see file
// header — kept only so buildReply's back-compat "followUp omitted" path can
// still ask WHICH SLOT to render, exactly as before) ────────────────────────
export const buildNextUsefulQuestionWithSlots = (parsed = {}) => {
  if (parsed.noPreference === true) {
    return null
  }

  if (!parsed.listingType) {
    return { text: 'Are you looking to buy or rent?', slots: ['listingType'] }
  }

  if (!hasKnownPropertyType(parsed)) {
    return { text: 'Do you prefer an apartment, villa, or another property type?', slots: ['propertyType'] }
  }

  if (!parsed.district && (!parsed.districts || parsed.districts.length === 0)) {
    return { text: 'Do you have a preferred district?', slots: ['district'] }
  }

  if (!parsed.maxPrice && !parsed.minPrice) {
    return { text: 'Do you have a budget range in mind?', slots: ['budget'] }
  }

  return null
}

export const buildNextUsefulQuestion = (parsed = {}) =>
  buildNextUsefulQuestionWithSlots(parsed)?.text ?? null

// ─── Phase 4 render helpers, now localized (Phase 3) ───────────────────────
const GOVERNED_QUESTION_SLOTS = ['listingType', 'propertyType', 'district', 'budget']

// Renders a blocking question for decideTurnAction's `{ type: 'ask', slots }`
// result. Single known slot reuses the exact existing phrasing; multiple
// slots compose a natural combined question via the per-language list-join
// grammar in chatReplyRenderer.js.
export const renderSlotQuestion = (slots = [], language = 'en') => {
  const known = slots.filter((slot) => GOVERNED_QUESTION_SLOTS.includes(slot))

  if (known.length === 0) return renderGenericSlotQuestion(language)
  if (known.length === 1) return renderSlotQuestionText(known[0], language)

  const fragments = known.map((slot) => renderSlotFragment(slot, language))
  return renderMultiSlotQuestion(joinList(fragments, language, 'and'), language)
}

// Blocking-style phrasing for an EMPTY slot offered post-search vs. a
// gentler phrasing for RE-offering a slot the visitor already deferred.
export const renderRefinementOffer = (slot, { reOffer = false } = {}, language = 'en') => {
  if (!slot) return null
  return reOffer ? renderRefinementReofferText(slot, language) : renderRefinementOfferText(slot, language)
}

export const getRelaxedFeatureLabels = (parsed = {}, mustHaveFilter = {}, language = 'en') =>
  getRelaxedFeatureIds(parsed, mustHaveFilter).map((id) => featureLabel(id, language))

const PROPERTY_TYPE_PLURAL_OVERRIDES = { Duplex: 'Duplexes' }

// English-only legacy helper — nothing on the production reply path calls
// this anymore (the renderer has its own internal copy for byte-identical
// English output), but it stays exported/unchanged since it is directly
// tested and chatDistrictScope.js still imports it for its own (still
// English-only pending Phase 3.5) internal use.
export const pluralizePropertyType = (type) =>
  (PROPERTY_TYPE_PLURAL_OVERRIDES[type] || `${type}s`).toLowerCase()

export { hasMultiplePropertyTypes }

// English-only legacy helper (see pluralizePropertyType note above) — kept
// exported/unchanged for the same reason.
export const describePropertyTypesPhrase = (parsed = {}) => {
  if (hasMultiplePropertyTypes(parsed)) {
    return parsed.propertyTypes.map(pluralizePropertyType).join(' and ')
  }

  return parsed.propertyType ? parsed.propertyType.toLowerCase() : null
}

// ─── buildReply ──────────────────────────────────────────────────────────────
// Reverse map so the legacy call shape (`relaxedFeatureLabels: ['a pool', ...]`
// — pre-existing English label strings, still used by
// testChatReplyBuilder.js) keeps working: mapped back to feature ids, which
// is what the language-independent plan actually carries. New production
// callers (routes/chat.js) pass `relaxedFeatureIds` directly instead — see
// getRelaxedFeatureIds, exported above.
const EN_FEATURE_LABEL_TO_ID = Object.fromEntries(
  Object.entries(CHAT_MESSAGES.en.featureLabel).map(([id, label]) => [label, id])
)

// Public entry point. `language` defaults to 'en' and, when omitted, every
// existing caller/test gets byte-identical output to the pre-Phase-3
// version of this function.
//
// Back-compat subtlety preserved exactly from before Phase 3: when the
// caller does not pass a `followUp` key at all (every pre-Phase-4
// test/caller), the next question is decided the OLD way — via
// buildNextUsefulQuestionWithSlots(parsed) — not via the policy engine's
// explicit decision. When `followUp` IS passed (routes/chat.js's real call
// site), it is authoritative. This dual path predates Phase 3; only the
// TEXT each path produces is now localized.
export const buildReply = (args = {}) => {
  const {
    properties = [],
    fallbackLevel = 0,
    parsed = {},
    matchedViaDescription = false,
    matchedViaSemantic = false,
    descriptionSearchAttempted = false,
    relaxedFeatureLabels,
    relaxedFeatureIds,
    followUp,
    mixedListingTypes,
    language = 'en',
  } = args

  const followUpProvided = 'followUp' in args

  let nextQuestion
  if (followUpProvided) {
    const slot = followUp?.offerSlot ?? null
    nextQuestion = renderRefinementOffer(slot, { reOffer: followUp?.reOffer }, language)
  } else {
    const slot = buildNextUsefulQuestionWithSlots(parsed)?.slots?.[0] ?? null
    nextQuestion = slot ? renderRefinementOfferText(slot, language) : null
  }

  const effectiveRelaxedFeatureIds =
    relaxedFeatureIds ||
    (relaxedFeatureLabels || []).map((label) => EN_FEATURE_LABEL_TO_ID[label]).filter(Boolean)

  const plan = buildSearchResultPlan({
    properties,
    fallbackLevel,
    parsed,
    matchedViaDescription,
    matchedViaSemantic,
    descriptionSearchAttempted,
    relaxedFeatureIds: effectiveRelaxedFeatureIds,
    followUp,
    mixedListingTypes,
  })

  const text = renderSearchResultPlan(plan, nextQuestion, language)

  if (properties.length > 0 && mixedListingTypes?.isMixed) {
    return `${renderMixedListingNotice(language)} ${text}`
  }

  return text
}

export { evaluateSoftMatchForProperty }

export const buildMatchReason = (property, parsed = {}, matchedViaDescription = false, matchedViaSemantic = false, language = 'en') => {
  const plan = buildMatchReasonPlan(property, parsed, matchedViaDescription, matchedViaSemantic)
  return renderMatchReasonPlan(plan, language)
}

// Re-exported so any future caller wanting to inspect a concept id's presence
// (unrelated to reply rendering) doesn't need a second import path — kept
// for parity with the pre-Phase-3 module surface (both were already
// available transitively via lifestyleConcepts.js imports elsewhere).
export { findConceptForWord, extractConceptIdsFromText }
