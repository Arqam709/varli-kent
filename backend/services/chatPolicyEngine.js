// backend/services/chatPolicyEngine.js
//
// Phase 4 of the conversation-state architecture: the single authoritative
// ask-vs-search decision. Everything upstream (Gemini/fallback parsing,
// conversation memory, slot statuses, pendingQuestion resolution, district
// scope, lead flow, casual/contact/emotional routing) has already run and
// produced a fully resolved `parsed`. This module reads that state and
// decides what THIS turn should do — nothing else.
//
// Guiding principle (the product decision this phase implements): do not
// optimize for asking every missing question — optimize for helping the
// user make progress. The bot should prefer showing useful results when it
// already has enough context, and offer refinement afterward instead of
// behaving like a rigid form. Blocking questions are the exception, not the
// default.
//
// This module MUST NOT: mutate parsed state, parse raw message text, build
// Mongo filters, execute searches, write reply prose, touch Express req/res,
// persist conversations, or duplicate lead-flow/district-scope logic. It
// exports two pure functions:
//
//   decideTurnAction(context)              — runs BEFORE search
//   decideFollowUp(context, searchOutcome) — runs AFTER search
//
// Both return a small discriminated result object with a stable, kebab-case
// `reason` string — used for debug logging, tests, and future analytics,
// never shown to the user directly.

import { GOVERNED_SLOTS, deriveSlotStanding } from './chatSlotState.js'
import { hasSoftDescriptionSearch } from './chatMessageParsing.js'

export const PROPERTY_FLOW_INTENTS = ['property_search', 'property_followup']

// Out of a typical 5-result cap (searchWithFallback/searchByDescription), a
// count at or above this suggests there are likely more matches than shown —
// narrowing would help. Kept as a single named constant, not a scoring
// system: this is the one place a raw number enters the policy, and it only
// ever gates whether ONE specific refinement question is worth asking.
export const MANY_RESULTS_THRESHOLD = 4

// A deferred slot may be softly re-offered no sooner than this many turns
// after it was deferred — a GUARD against nagging in the very turn that just
// recorded the deferral, not the main reason to re-offer (see
// narrowingBenefitReason below, which is the main reason).
export const MIN_TURNS_BEFORE_REOFFER_DEFERRED = 1

const kebabSlot = (slot = '') => slot.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()

const sameSlotSet = (a = [], b = []) => a.length === b.length && a.every((slot) => b.includes(slot))

const computeStandings = (parsed = {}) =>
  Object.fromEntries(GOVERNED_SLOTS.map((slot) => [slot, deriveSlotStanding(parsed, slot)]))

// listingType not being 'filled' — for any reason (never discussed,
// deferred, or declined) — means the Mongo filter will naturally omit it
// (chatFilters.js is unchanged: it only adds listingType when parsed.
// listingType is set), so results may legitimately mix Sale and Rent. This
// is a PRESENTATION hint for chatReplyBuilder.js; it changes no filter.
const computeScope = (parsed) => {
  const listingTypeFilled = deriveSlotStanding(parsed, 'listingType') === 'filled'

  return {
    includeAllListingTypes: !listingTypeFilled,
    groupByListingType: !listingTypeFilled,
  }
}

const SECONDARY_SIGNAL_FIELDS = [
  'beds', 'baths', 'minSqm', 'maxSqm', 'furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking',
]

const hasSecondarySignal = (parsed = {}) => SECONDARY_SIGNAL_FIELDS.some((field) => Boolean(parsed[field]))

// A search is honest and worth running whenever ANY meaningful property
// signal exists — a filled governed slot, a lifestyle/description search, a
// secondary field (beds/baths/size/features), or an explicit property-search
// conversational intent. The last one is deliberate and is what makes
// "Show me properties" search instead of block: the visitor is unambiguously
// talking about property search, even with zero filters, and the search
// layer already has an honest default (status:'Available' only, sorted
// featured desc / newest first, capped) — presenting that is not a lie.
const isAnchored = (parsed, standings) =>
  Object.values(standings).includes('filled') ||
  hasSoftDescriptionSearch(parsed) ||
  hasSecondarySignal(parsed) ||
  PROPERTY_FLOW_INTENTS.includes(parsed.intentType)

// Composite reason for a search decision when no earlier rule already named
// one: names the highest-priority deferred/declined slot (GOVERNED_SLOTS
// order = listingType, propertyType, district, budget), or falls back to a
// generic label distinguishing "some real signal exists" from "genuinely
// nothing but property-search intent."
const pickSearchReason = (standings, hasFilledSlot) => {
  for (const slot of GOVERNED_SLOTS) {
    if (standings[slot] === 'deferred') return `${kebabSlot(slot)}-deferred-broad-search`
    if (standings[slot] === 'declined') return `${kebabSlot(slot)}-declined-broad-search`
  }

  return hasFilledSlot ? 'sufficient-context-search' : 'broad-request-search-over-block'
}

// Whether the same slot set was already asked at least once before, per the
// resolved pendingQuestion — used to cap the one remaining ask branch
// (the emergency question below) at a single retry, never an infinite loop.
const isRetryCapped = (parsed, slots) => {
  const pending = parsed.pendingQuestion
  return Boolean(pending && sameSlotSet(pending.slots, slots) && pending.retryCount >= 1)
}

// ─── Pre-search: decideTurnAction ──────────────────────────────────────────
//
// context: { parsed, pageKey, isShowMore }
//   parsed    — the fully resolved conversation state (post conversation-
//               memory, post pending-question resolution). Read-only.
//   pageKey   — informational only; a page-forced listingType is already
//               baked into `parsed` upstream (chat.js step 5), so no branch
//               here needs to special-case it.
//   isShowMore — computed once by the caller (chat.js already needs this
//               value for the shownPropertyIds exclusion) and passed in
//               rather than re-derived, so this module never parses raw text.
//
// Returns one of:
//   { type: 'ask',    slots, reason }
//   { type: 'search', scope, suppressFollowUp, reason }
//
// Ordered rules (first match wins):
//   1. show-more                → search, unchanged criteria, no question logic
//   2. this-turn noPreference   → search, suppressFollowUp (never re-nag
//                                  immediately about what was just declined)
//   3. emergency ask            → the ONE narrow case: no usable property
//                                  signal at all AND not already asked twice.
//                                  In the current pipeline this is a defensive
//                                  safety valve more than a common path — by
//                                  the time this function runs, everything
//                                  reaching it has already passed
//                                  buildNonPropertyReply, which only lets a
//                                  turn through when it is a genuine property
//                                  intent OR already has active context /
//                                  noPreference. See the Phase 4 report for
//                                  the full reachability argument.
//   4. default                  → search (this is the product decision: do
//                                  not block on missing listingType/
//                                  propertyType/district/budget — search and
//                                  let decideFollowUp offer ONE refinement
//                                  afterward instead)
export const decideTurnAction = (context = {}) => {
  const { parsed = {}, isShowMore = false } = context

  if (isShowMore) {
    return { type: 'search', scope: computeScope(parsed), suppressFollowUp: false, reason: 'show-more-continuation' }
  }

  if (parsed.noPreference === true) {
    return { type: 'search', scope: computeScope(parsed), suppressFollowUp: true, reason: 'no-preference-this-turn' }
  }

  const standings = computeStandings(parsed)
  const anchored = isAnchored(parsed, standings)

  if (!anchored && standings.propertyType === 'empty' && !isRetryCapped(parsed, ['propertyType'])) {
    return { type: 'ask', slots: ['propertyType'], reason: 'no-usable-property-signal' }
  }

  const hasFilledSlot = Object.values(standings).includes('filled')

  return {
    type: 'search',
    scope: computeScope(parsed),
    suppressFollowUp: false,
    reason: pickSearchReason(standings, hasFilledSlot),
  }
}

// ─── Soft-requirement search outcome (presentation, not refinement) ────────
// Derives HOW a completed search should be explained, independently of
// WHETHER another refinement question is emitted. `mode === 'fallback'` is
// chatPropertySearch.js's own machine-readable verdict: a soft/open-ended
// requirement WAS requested, but no semantic or description strategy could
// verify it (see runPropertySearch's `mode` computation). This function reads
// only that abstract outcome — it never inspects message text, descriptionQuery
// phrases, listing content, thresholds, or any search internals — so it works
// automatically for any open-ended request (music studio, rooftop cinema,
// veterinary hospital, ...) with no per-phrase code.
//
//   'unverified_no_results'       — fallback, nothing to show at all
//   'unverified_with_alternatives'— fallback, but structured alternatives exist
//   null                          — not a fallback outcome (exact/semantic/
//                                    description/plain-structured); unchanged
export const deriveSoftOutcome = (searchOutcome = {}) => {
  if (searchOutcome.mode !== 'fallback') return null
  return (searchOutcome.count || 0) > 0 ? 'unverified_with_alternatives' : 'unverified_no_results'
}

// ─── Post-search: decideFollowUp ───────────────────────────────────────────
//
// context: { parsed, suppressFollowUp }
//   suppressFollowUp — carried forward from this turn's decideTurnAction
//                       result (e.g. true after a noPreference turn); a
//                       second, independent suppression source would be a
//                       competing policy, so this is the only input, not a
//                       re-derivation.
//
// searchOutcome: { count, mode, fallbackLevel, matchedViaSemantic,
//                  matchedViaDescription, descriptionSearchAttempted,
//                  mixedListingTypes }
//
// Returns: { offerSlot: <slot>|null, reOffer: boolean, reason, softOutcome }
//   offerSlot / reOffer — WHETHER another refinement question is emitted.
//   softOutcome         — HOW the completed search is explained (see
//                         deriveSoftOutcome). These are SEPARATE
//                         responsibilities: suppressFollowUp silences the
//                         question but must NOT erase the honest explanation,
//                         so softOutcome is computed independently and carried
//                         on every return (null when not a fallback outcome).
// Always at most one slot — the shape itself makes "at most one refinement
// question" structurally true, not merely a rule to remember.
export const decideFollowUp = (context = {}, searchOutcome = {}) => {
  const { parsed = {}, suppressFollowUp = false } = context
  const { count = 0, fallbackLevel = 0 } = searchOutcome

  // Presentation (how the search is explained) is derived up front, so no
  // later branch — including suppression — can accidentally drop it.
  const softOutcome = deriveSoftOutcome(searchOutcome)

  if (suppressFollowUp) {
    return { offerSlot: null, reOffer: false, reason: 'suppressed-this-turn', softOutcome }
  }

  // A fallback outcome means a soft/open-ended requirement was requested but
  // nothing could be verified. Narrowing a hard filter (listingType/
  // propertyType/district/budget) cannot add the missing description evidence,
  // so we NEVER offer or re-offer a slot here — the honest explanation rides
  // on softOutcome instead. Checked before all slot logic below, and (unlike
  // suppression) it applies whether or not follow-up was suppressed, because
  // by this point suppression has already returned.
  if (softOutcome === 'unverified_no_results') {
    return { offerSlot: null, reOffer: false, reason: 'soft-requirement-unverified-no-results', softOutcome }
  }
  if (softOutcome === 'unverified_with_alternatives') {
    return { offerSlot: null, reOffer: false, reason: 'soft-requirement-unverified-with-alternatives', softOutcome }
  }

  const standings = computeStandings(parsed)

  if (count === 0) {
    // Reached only when softOutcome is null — i.e. a pure structured
    // no-results search (no soft requirement, or one not in fallback mode).
    // The reply message already explains the issue; nothing to refine.
    return { offerSlot: null, reOffer: false, reason: 'no-results-message-explains-issue', softOutcome: null }
  }

  // Names WHY narrowing would help, using real search outcomes rather than an
  // invented point score — a relaxed/fuzzy/mixed/large result set benefits
  // from one more constraint; a small, exact set does not.
  const narrowingBenefitReason = () => {
    if (fallbackLevel > 0) return 'fallback-relaxed-refinement-useful'
    if (searchOutcome.mixedListingTypes?.isMixed) return 'mixed-results-refinement-useful'
    if (searchOutcome.matchedViaSemantic || searchOutcome.matchedViaDescription) return 'fuzzy-match-refinement-useful'
    if (count >= MANY_RESULTS_THRESHOLD) return 'many-results-refinement-useful'
    return null
  }

  const benefitReason = narrowingBenefitReason()

  const emptySlot = GOVERNED_SLOTS.find((slot) => standings[slot] === 'empty')

  if (emptySlot) {
    return benefitReason
      ? { offerSlot: emptySlot, reOffer: false, reason: benefitReason, softOutcome: null }
      : { offerSlot: null, reOffer: false, reason: 'few-exact-results-no-refinement-needed', softOutcome: null }
  }

  // No empty slot left — every remaining unknown is either filled or
  // deferred/declined. Declined slots are NEVER candidates (excluded simply
  // by not matching 'deferred' below — that is the enforcement mechanism,
  // not a separate check to remember). A deferred slot may be softly
  // re-offered, gated on real benefit (the main condition) plus a minimum-
  // age guard (the safety net, never the main reason).
  const deferredSlot = GOVERNED_SLOTS.find((slot) => standings[slot] === 'deferred')

  if (deferredSlot) {
    const record = parsed.slotStatus?.[deferredSlot]
    const turnsSinceDeferred = record ? parsed.turn - record.turn : Infinity

    if (benefitReason && turnsSinceDeferred >= MIN_TURNS_BEFORE_REOFFER_DEFERRED) {
      return { offerSlot: deferredSlot, reOffer: true, reason: `deferred-slot-reoffer-${benefitReason}`, softOutcome: null }
    }

    return {
      offerSlot: null,
      reOffer: false,
      reason:
        turnsSinceDeferred < MIN_TURNS_BEFORE_REOFFER_DEFERRED
          ? 'deferred-too-recent-to-reoffer'
          : 'deferred-no-clear-benefit-yet',
      softOutcome: null,
    }
  }

  return { offerSlot: null, reOffer: false, reason: 'fully-specified-or-declined-no-refinement', softOutcome: null }
}

// ─── Result-composition helper ─────────────────────────────────────────────
// Pure data inspection (counts listingType values already present on
// returned property documents) — not language parsing. Used by chat.js to
// build searchOutcome.mixedListingTypes for decideFollowUp, and by
// chatReplyBuilder.js to decide whether to acknowledge the mix in prose.
export const detectMixedListingTypes = (properties = []) => {
  const saleCount = properties.filter((property) => property.listingType === 'Sale').length
  const rentCount = properties.filter((property) => property.listingType === 'Rent').length

  return { isMixed: saleCount > 0 && rentCount > 0, saleCount, rentCount }
}
