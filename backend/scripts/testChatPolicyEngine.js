// backend/scripts/testChatPolicyEngine.js
//
// Focused, fully deterministic unit tests for services/chatPolicyEngine.js —
// no DB, no Gemini, no network. Tests the policy as a pure decision table:
// fixed `parsed` state in, fixed decision out. Same conventions as
// testChatSlotState.js / testChatPendingQuestion.js.
//
// Usage: node scripts/testChatPolicyEngine.js

import {
  PROPERTY_FLOW_INTENTS,
  MANY_RESULTS_THRESHOLD,
  MIN_TURNS_BEFORE_REOFFER_DEFERRED,
  decideTurnAction,
  decideFollowUp,
  detectMixedListingTypes,
  deriveSoftOutcome,
} from '../services/chatPolicyEngine.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const assertEqual = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (pass) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
    console.log(`    expected: ${JSON.stringify(expected)}`)
    console.log(`    actual:   ${JSON.stringify(actual)}`)
  }
}

const assertTrue = (label, condition) => {
  if (condition) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
  }
}

// Full parsed-shaped fixture, defaults to "nothing known yet" with a
// property-search intent (the common case reaching the engine, since
// non-property intents without context are filtered out upstream by
// buildNonPropertyReply before chat.js ever calls the engine).
const parsedFixture = (overrides = {}) => ({
  intentType: 'property_search',
  replyType: 'search',
  nextQuestion: null,
  noPreference: false,
  listingType: null,
  propertyType: null,
  propertyTypes: [],
  district: null,
  districts: [],
  beds: null,
  baths: null,
  minPrice: null,
  maxPrice: null,
  minSqm: null,
  maxSqm: null,
  furnished: null,
  balcony: null,
  elevator: null,
  pool: null,
  garden: null,
  parking: null,
  descriptionQuery: null,
  searchMode: 'field',
  lifestyle: [],
  mustHave: [],
  niceToHave: [],
  requirements: [],
  slotStatus: {},
  pendingQuestion: null,
  turn: 1,
  ...overrides,
})

const property = (listingType, overrides = {}) => ({ listingType, ...overrides })

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. show more -> search')
line()

{
  const decision = decideTurnAction({
    parsed: parsedFixture({ listingType: 'Sale', propertyType: 'Apartment' }),
    isShowMore: true,
  })
  assertEqual('show-more type', decision.type, 'search')
  assertEqual('show-more reason', decision.reason, 'show-more-continuation')
  assertEqual('show-more does not suppress follow-up', decision.suppressFollowUp, false)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. lifestyle/description -> search, never blocked')
line()

{
  const decision = decideTurnAction({
    parsed: parsedFixture({ searchMode: 'description', descriptionQuery: 'sea view' }),
  })
  assertEqual('lifestyle search type', decision.type, 'search')
}

{
  // Even with a description search present, nothing here should ever ask —
  // regardless of how few structured fields are known.
  const decision = decideTurnAction({ parsed: parsedFixture({ lifestyle: ['near schools'] }) })
  assertEqual('lifestyle array alone -> search', decision.type, 'search')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. noPreference this turn -> search + suppress follow-up')
line()

{
  const decision = decideTurnAction({ parsed: parsedFixture({ noPreference: true }) })
  assertEqual('noPreference type', decision.type, 'search')
  assertEqual('noPreference suppresses follow-up', decision.suppressFollowUp, true)
  assertEqual('noPreference reason', decision.reason, 'no-preference-this-turn')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. listingType deferred -> broad search + mixed scope')
line()

{
  const parsed = parsedFixture({
    propertyType: 'Apartment',
    district: 'Büyükçekmece',
    slotStatus: { listingType: { status: 'deferred', turn: 1 } },
  })
  const decision = decideTurnAction({ parsed })
  assertEqual('deferred listingType -> search', decision.type, 'search')
  assertEqual('deferred listingType reason', decision.reason, 'listing-type-deferred-broad-search')
  assertEqual('scope includes all listing types', decision.scope.includeAllListingTypes, true)
  assertEqual('scope groups by listing type', decision.scope.groupByListingType, true)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. listingType declined -> broad search, never offer it again')
line()

{
  const parsed = parsedFixture({
    propertyType: 'Apartment',
    slotStatus: { listingType: { status: 'declined', turn: 1 } },
  })
  const turnDecision = decideTurnAction({ parsed })
  assertEqual('declined listingType -> search', turnDecision.type, 'search')
  assertEqual('declined listingType reason', turnDecision.reason, 'listing-type-declined-broad-search')

  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: MANY_RESULTS_THRESHOLD + 2, fallbackLevel: 0 }
  )
  assertTrue('declined listingType is never the offered slot', followUp.offerSlot !== 'listingType')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. budget deferred -> search, no blocking ask')
line()

{
  const parsed = parsedFixture({
    listingType: 'Sale',
    propertyType: 'Apartment',
    slotStatus: { budget: { status: 'deferred', turn: 1 } },
  })
  const decision = decideTurnAction({ parsed })
  assertEqual('budget deferred -> search', decision.type, 'search')
  assertEqual('budget deferred reason', decision.reason, 'budget-deferred-broad-search')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. budget declined -> search, never offered again')
line()

{
  const parsed = parsedFixture({
    listingType: 'Sale',
    propertyType: 'Apartment',
    slotStatus: { budget: { status: 'declined', turn: 1 } },
  })
  const turnDecision = decideTurnAction({ parsed })
  assertEqual('budget declined -> search', turnDecision.type, 'search')

  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: MANY_RESULTS_THRESHOLD + 2, fallbackLevel: 0 }
  )
  assertTrue('declined budget never offered', followUp.offerSlot !== 'budget')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. district deferred/declined -> search across districts')
line()

{
  const deferred = decideTurnAction({
    parsed: parsedFixture({
      listingType: 'Sale',
      propertyType: 'Apartment',
      slotStatus: { district: { status: 'deferred', turn: 1 } },
    }),
  })
  assertEqual('district deferred -> search', deferred.type, 'search')
  assertEqual('district deferred reason', deferred.reason, 'district-deferred-broad-search')

  const declined = decideTurnAction({
    parsed: parsedFixture({
      listingType: 'Sale',
      propertyType: 'Apartment',
      slotStatus: { district: { status: 'declined', turn: 1 } },
    }),
  })
  assertEqual('district declined -> search', declined.type, 'search')
  assertEqual('district declined reason', declined.reason, 'district-declined-broad-search')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('I. propertyType deferred/declined -> broad search, no blocker')
line()

{
  const deferred = decideTurnAction({
    parsed: parsedFixture({
      listingType: 'Sale',
      district: 'Kadıköy',
      slotStatus: { propertyType: { status: 'deferred', turn: 1 } },
    }),
  })
  assertEqual('propertyType deferred -> search (not ask)', deferred.type, 'search')
  assertEqual('propertyType deferred reason', deferred.reason, 'property-type-deferred-broad-search')

  const declined = decideTurnAction({
    parsed: parsedFixture({
      listingType: 'Sale',
      district: 'Kadıköy',
      slotStatus: { propertyType: { status: 'declined', turn: 1 } },
    }),
  })
  assertEqual('propertyType declined -> search', declined.type, 'search')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('J. broad "show properties" state -> search rather than block')
line()

{
  // "Show me properties." — intentType property_search, literally nothing
  // else known. Product decision: search, do not block on propertyType.
  const decision = decideTurnAction({ parsed: parsedFixture() })
  assertEqual('"Show me properties." -> search', decision.type, 'search')
  assertEqual('reason distinguishes "nothing filled" from "something filled"', decision.reason, 'broad-request-search-over-block')
}

{
  // "Show me properties for sale." — listingType filled, nothing else.
  const decision = decideTurnAction({ parsed: parsedFixture({ listingType: 'Sale' }) })
  assertEqual('"Show me properties for sale." -> search', decision.type, 'search')
  assertEqual('reason reflects real signal present', decision.reason, 'sufficient-context-search')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('K. Sale only -> search, propertyType offered post-search')
line()

{
  const parsed = parsedFixture({ listingType: 'Sale' })
  const turnDecision = decideTurnAction({ parsed })
  assertEqual('Sale-only turn decision -> search', turnDecision.type, 'search')

  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: turnDecision.suppressFollowUp },
    { count: MANY_RESULTS_THRESHOLD, fallbackLevel: 0 }
  )
  assertEqual('propertyType offered once results exist', followUp.offerSlot, 'propertyType')
  assertEqual('not a re-offer (propertyType was empty, not deferred)', followUp.reOffer, false)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('L. Apartment only -> search, district/listingType offered based on outcome')
line()

{
  const parsed = parsedFixture({ propertyType: 'Apartment' })
  const turnDecision = decideTurnAction({ parsed })
  assertEqual('Apartment-only turn decision -> search (not ask)', turnDecision.type, 'search')

  // Highest-priority empty slot is listingType (GOVERNED_SLOTS order).
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: MANY_RESULTS_THRESHOLD, fallbackLevel: 0 }
  )
  assertEqual('listingType offered (highest priority empty slot)', followUp.offerSlot, 'listingType')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('M. completely empty property request -> chosen opening behavior')
line()

{
  // "I want to find a property." — property intent, zero everything else.
  // Chosen behavior: search a small honest default set (status: 'Available'
  // only — chatFilters.js already produces exactly this), never block.
  const decision = decideTurnAction({
    parsed: parsedFixture({ intentType: 'property_search' }),
  })
  assertEqual('empty property-intent request -> search (chosen default)', decision.type, 'search')
}

{
  // The narrow emergency safety-valve: reachable only if a non-property
  // intent with genuinely zero context somehow reaches the engine (in the
  // current pipeline this is defensive — buildNonPropertyReply normally
  // intercepts such turns first). Proves the valve exists and works.
  const decision = decideTurnAction({
    parsed: parsedFixture({ intentType: 'unknown', propertyType: null }),
  })
  assertEqual('emergency: no usable signal at all -> ask', decision.type, 'ask')
  assertEqual('emergency asks propertyType', decision.slots, ['propertyType'])
  assertEqual('emergency reason', decision.reason, 'no-usable-property-signal')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('N. Gemini says ask_question but policy says search -> search wins')
line()

{
  // Gemini's suggestion lives only in replyType/nextQuestion — the engine
  // never reads them at all, so a search-worthy state searches regardless
  // of what Gemini suggested.
  const parsed = parsedFixture({
    listingType: 'Sale',
    replyType: 'ask_question',
    nextQuestion: 'What type of property are you interested in?',
  })
  const decision = decideTurnAction({ parsed })
  assertEqual('engine ignores Gemini ask_question suggestion', decision.type, 'search')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('O. pending retryCount >= 1 -> no repeated blocking ask when search is possible')
line()

{
  // Emergency-ask scenario, already asked once (retryCount 1) — must not
  // ask a third time; search instead.
  const parsed = parsedFixture({
    intentType: 'unknown',
    pendingQuestion: { type: 'slot_question', slots: ['propertyType'], askedAtTurn: 1, retryCount: 1 },
  })
  const decision = decideTurnAction({ parsed })
  assertEqual('retry-capped emergency -> search instead of asking a 3rd time', decision.type, 'search')
}

{
  // Same slots, retryCount 0 (asked once already, not yet capped) -> still
  // allowed to ask (this is the 2nd ask, i.e. the one retry).
  const parsed = parsedFixture({
    intentType: 'unknown',
    pendingQuestion: { type: 'slot_question', slots: ['propertyType'], askedAtTurn: 1, retryCount: 0 },
  })
  const decision = decideTurnAction({ parsed })
  assertEqual('not yet capped -> may ask again (the one retry)', decision.type, 'ask')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('P. declined slot never offered')
line()

{
  const parsed = parsedFixture({
    listingType: 'Sale',
    propertyType: 'Apartment',
    slotStatus: {
      district: { status: 'declined', turn: 1 },
      budget: { status: 'declined', turn: 1 },
    },
  })
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 10, fallbackLevel: 2 })
  assertTrue('declined district never offered', followUp.offerSlot !== 'district')
  assertTrue('declined budget never offered', followUp.offerSlot !== 'budget')
  assertEqual('nothing left to offer -> null', followUp.offerSlot, null)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Q. deferred slot not offered without clear benefit')
line()

{
  const parsed = parsedFixture({
    listingType: 'Sale',
    propertyType: 'Apartment',
    district: 'Kadıköy',
    slotStatus: { budget: { status: 'deferred', turn: 1 } },
    turn: 3,
  })
  // Few, exact, unrelaxed results — no benefit signal at all.
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 2, fallbackLevel: 0 })
  assertEqual('no benefit -> not re-offered', followUp.offerSlot, null)
  assertEqual('reason names the lack of benefit', followUp.reason, 'deferred-no-clear-benefit-yet')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('R. deferred slot softly re-offered when outcome demonstrates benefit')
line()

{
  // Every OTHER governed slot is filled, isolating listingType as the only
  // non-filled (deferred) one — empty slots always outrank deferred slots
  // (P/Q/T already prove that ordering), so this fixture must leave none.
  const parsed = parsedFixture({
    propertyType: 'Apartment',
    district: 'Büyükçekmece',
    maxPrice: 5000000,
    slotStatus: { listingType: { status: 'deferred', turn: 1 } },
    turn: 3, // 2 turns after the deferral — past the minimum guard
  })
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: MANY_RESULTS_THRESHOLD + 1, fallbackLevel: 0, mixedListingTypes: { isMixed: true, saleCount: 3, rentCount: 2 } }
  )
  assertEqual('deferred listingType softly re-offered', followUp.offerSlot, 'listingType')
  assertEqual('marked as a re-offer, not a blocking ask', followUp.reOffer, true)
  assertTrue('reason names the benefit driver', followUp.reason.startsWith('deferred-slot-reoffer-'))
}

{
  // Same slot, same benefit, but on the VERY turn it was deferred — guard
  // must prevent immediately re-offering what was just declined to answer.
  const parsed = parsedFixture({
    propertyType: 'Apartment',
    district: 'Büyükçekmece',
    maxPrice: 5000000,
    slotStatus: { listingType: { status: 'deferred', turn: 3 } },
    turn: 3,
  })
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: MANY_RESULTS_THRESHOLD + 1, fallbackLevel: 0 }
  )
  assertEqual('same-turn deferral -> not re-offered yet', followUp.offerSlot, null)
  assertEqual('reason names the timing guard', followUp.reason, 'deferred-too-recent-to-reoffer')
}

assertTrue('MIN_TURNS_BEFORE_REOFFER_DEFERRED is a small guard, not the main condition', MIN_TURNS_BEFORE_REOFFER_DEFERRED === 1)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('S. few exact results -> no follow-up')
line()

{
  const parsed = parsedFixture({ listingType: 'Sale', propertyType: 'Apartment' })
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 2, fallbackLevel: 0 })
  assertEqual('few exact results -> no offer', followUp.offerSlot, null)
  assertEqual('reason', followUp.reason, 'few-exact-results-no-refinement-needed')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('T. many broad results -> one refinement')
line()

{
  const parsed = parsedFixture({ listingType: 'Sale' })
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: MANY_RESULTS_THRESHOLD, fallbackLevel: 0 })
  assertEqual('many results -> offer', followUp.offerSlot, 'propertyType')
  assertEqual('reason names many-results specifically', followUp.reason, 'many-results-refinement-useful')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('U. fallback-relaxed results -> useful refinement')
line()

{
  const parsed = parsedFixture({ listingType: 'Sale', propertyType: 'Apartment' })
  // Small count, but fallbackLevel > 0 (relaxed) — benefit comes from the
  // relaxation, not the count.
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 1, fallbackLevel: 2 })
  assertEqual('relaxed results -> offer', followUp.offerSlot, 'district')
  assertEqual('reason names fallback relaxation specifically', followUp.reason, 'fallback-relaxed-refinement-useful')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('V. mixed Sale/Rent result detection')
line()

assertEqual(
  'detects a genuine mix',
  detectMixedListingTypes([property('Sale'), property('Rent'), property('Sale')]),
  { isMixed: true, saleCount: 2, rentCount: 1 }
)
assertEqual('all-Sale is not mixed', detectMixedListingTypes([property('Sale'), property('Sale')]), {
  isMixed: false,
  saleCount: 2,
  rentCount: 0,
})
assertEqual('empty list is not mixed', detectMixedListingTypes([]), { isMixed: false, saleCount: 0, rentCount: 0 })

{
  const parsed = parsedFixture({ propertyType: 'Apartment', district: 'Büyükçekmece' })
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 2, fallbackLevel: 0, mixedListingTypes: { isMixed: true, saleCount: 1, rentCount: 1 } }
  )
  assertEqual('mixed results alone justify a refinement even with few results', followUp.offerSlot, 'listingType')
  assertEqual('reason names the mix specifically', followUp.reason, 'mixed-results-refinement-useful')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('W. at most one follow-up (structural, not just observed)')
line()

{
  const parsed = parsedFixture() // everything empty
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 10, fallbackLevel: 3 })
  assertTrue('offerSlot is a single value, never an array', !Array.isArray(followUp.offerSlot))
  assertTrue('offerSlot is a string or null', followUp.offerSlot === null || typeof followUp.offerSlot === 'string')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('X. stable reason strings for every branch')
line()

{
  const reasons = new Set()
  const scenarios = [
    () => decideTurnAction({ parsed: parsedFixture(), isShowMore: true }),
    () => decideTurnAction({ parsed: parsedFixture({ noPreference: true }) }),
    () => decideTurnAction({ parsed: parsedFixture({ intentType: 'unknown' }) }),
    () => decideTurnAction({ parsed: parsedFixture() }),
    () => decideTurnAction({ parsed: parsedFixture({ listingType: 'Sale' }) }),
    () =>
      decideTurnAction({
        parsed: parsedFixture({ propertyType: 'A', slotStatus: { listingType: { status: 'deferred', turn: 1 } } }),
      }),
  ]

  scenarios.forEach((run) => {
    const decision = run()
    assertTrue(`reason is a non-empty string (${decision.reason})`, typeof decision.reason === 'string' && decision.reason.length > 0)
    reasons.add(decision.reason)
  })

  assertTrue('distinct scenarios produce distinct reasons', reasons.size === scenarios.length)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Y. functions do not mutate inputs')
line()

{
  const parsed = parsedFixture({
    listingType: 'Sale',
    slotStatus: { budget: { status: 'deferred', turn: 1 } },
    pendingQuestion: { type: 'slot_question', slots: ['propertyType'], askedAtTurn: 1, retryCount: 0 },
  })
  const snapshot = JSON.stringify(parsed)

  decideTurnAction({ parsed, isShowMore: false })
  assertEqual('decideTurnAction does not mutate parsed', JSON.stringify(parsed), snapshot)

  decideFollowUp({ parsed, suppressFollowUp: false }, { count: 5, fallbackLevel: 1 })
  assertEqual('decideFollowUp does not mutate parsed', JSON.stringify(parsed), snapshot)

  const properties = [property('Sale'), property('Rent')]
  const propertiesSnapshot = JSON.stringify(properties)
  detectMixedListingTypes(properties)
  assertEqual('detectMixedListingTypes does not mutate its input', JSON.stringify(properties), propertiesSnapshot)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Z. sanity: constants and intent list')
line()

assertEqual('PROPERTY_FLOW_INTENTS', PROPERTY_FLOW_INTENTS, ['property_search', 'property_followup'])
assertTrue('MANY_RESULTS_THRESHOLD is a small positive integer', Number.isInteger(MANY_RESULTS_THRESHOLD) && MANY_RESULTS_THRESHOLD > 0)

// ═══════════════════════════════════════════════════════════════════════
// AA. Unverified soft-requirement fallback outcome (the "music studio" class)
//
// mode === 'fallback' is chatPropertySearch.js's verdict that a soft/open-
// ended requirement was requested but nothing could be verified. The policy
// must then STOP the hard-slot sequence and surface an honest presentation
// (softOutcome) — entirely from the abstract outcome, never message text.
// These cases work identically for any open-ended request (rooftop cinema,
// veterinary hospital, ...) — nothing here is phrase-specific.
line()
console.log('AA. unverified soft-requirement fallback outcomes')
line()

// deriveSoftOutcome — the pure mapping (independent of the refinement path).
assertEqual('deriveSoftOutcome fallback+0 -> no-results', deriveSoftOutcome({ mode: 'fallback', count: 0 }), 'unverified_no_results')
assertEqual('deriveSoftOutcome fallback+5 -> with-alternatives', deriveSoftOutcome({ mode: 'fallback', count: 5 }), 'unverified_with_alternatives')
assertEqual('deriveSoftOutcome semantic -> null', deriveSoftOutcome({ mode: 'semantic', count: 3 }), null)
assertEqual('deriveSoftOutcome description -> null', deriveSoftOutcome({ mode: 'description', count: 2 }), null)
assertEqual('deriveSoftOutcome exact -> null', deriveSoftOutcome({ mode: 'exact', count: 5 }), null)
assertEqual('deriveSoftOutcome no mode -> null', deriveSoftOutcome({ count: 0 }), null)
assertEqual('deriveSoftOutcome empty -> null', deriveSoftOutcome({}), null)

// CASE 1 — fallback, count 0: no slot, honest terminal explanation.
{
  const parsed = parsedFixture() // nothing filled — the real turn-1 shape
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 0, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )
  assertEqual('CASE 1: no slot offered', followUp.offerSlot, null)
  assertEqual('CASE 1: not a re-offer', followUp.reOffer, false)
  assertEqual('CASE 1: softOutcome', followUp.softOutcome, 'unverified_no_results')
  assertEqual('CASE 1: stable reason', followUp.reason, 'soft-requirement-unverified-no-results')
}

// CASE 2 — fallback, count > 0: broader alternatives, still no slot.
{
  const parsed = parsedFixture()
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 5, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )
  assertEqual('CASE 2: no slot offered', followUp.offerSlot, null)
  assertEqual('CASE 2: not a re-offer', followUp.reOffer, false)
  assertEqual('CASE 2: softOutcome', followUp.softOutcome, 'unverified_with_alternatives')
  assertEqual('CASE 2: stable reason', followUp.reason, 'soft-requirement-unverified-with-alternatives')
}

// A fallback outcome overrides the normal many-results refinement offer:
// even with 5 empty slots, narrowing cannot verify the requirement.
{
  const parsed = parsedFixture() // every governed slot empty
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: MANY_RESULTS_THRESHOLD + 1, mode: 'fallback', fallbackLevel: 0 }
  )
  assertEqual('fallback beats many-results offer -> no slot', followUp.offerSlot, null)
  assertEqual('fallback beats many-results offer -> with-alternatives', followUp.softOutcome, 'unverified_with_alternatives')
}

// Suppression silences the QUESTION but must NOT erase the EXPLANATION.
{
  const parsed = parsedFixture()
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: true },
    { count: 0, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )
  assertEqual('suppressed + fallback0: no slot', followUp.offerSlot, null)
  assertEqual('suppressed + fallback0: reason is suppression', followUp.reason, 'suppressed-this-turn')
  assertEqual('suppressed + fallback0: softOutcome still preserved', followUp.softOutcome, 'unverified_no_results')
}
{
  const parsed = parsedFixture()
  const followUp = decideFollowUp(
    { parsed, suppressFollowUp: true },
    { count: 5, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )
  assertEqual('suppressed + fallback5: no slot', followUp.offerSlot, null)
  assertEqual('suppressed + fallback5: reason is suppression', followUp.reason, 'suppressed-this-turn')
  assertEqual('suppressed + fallback5: softOutcome still preserved', followUp.softOutcome, 'unverified_with_alternatives')
}

// Non-fallback modes are completely unchanged, and always carry softOutcome null.
{
  const parsed = parsedFixture() // empty slots
  const semantic = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 3, mode: 'semantic', fallbackLevel: 0, matchedViaSemantic: true })
  assertEqual('semantic: still offers a refinement slot', semantic.offerSlot, 'listingType')
  assertEqual('semantic: reason unchanged', semantic.reason, 'fuzzy-match-refinement-useful')
  assertEqual('semantic: softOutcome null', semantic.softOutcome, null)

  const description = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 2, mode: 'description', fallbackLevel: 0, matchedViaDescription: true })
  assertEqual('description: still offers a refinement slot', description.offerSlot, 'listingType')
  assertEqual('description: softOutcome null', description.softOutcome, null)

  const exact = decideFollowUp({ parsed, suppressFollowUp: false }, { count: MANY_RESULTS_THRESHOLD, mode: 'exact', fallbackLevel: 0 })
  assertEqual('exact many-results: still offers', exact.offerSlot, 'listingType')
  assertEqual('exact: reason unchanged', exact.reason, 'many-results-refinement-useful')
  assertEqual('exact: softOutcome null', exact.softOutcome, null)
}

// Pure structured no-results (no soft search / no fallback mode) — unchanged.
{
  const parsed = parsedFixture({ listingType: 'Sale', propertyType: 'Apartment' })
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 0, fallbackLevel: 0, descriptionSearchAttempted: false })
  assertEqual('structured no-results: no slot', followUp.offerSlot, null)
  assertEqual('structured no-results: reason unchanged', followUp.reason, 'no-results-message-explains-issue')
  assertEqual('structured no-results: softOutcome null', followUp.softOutcome, null)
}

// A fallback outcome never re-offers a deferred slot either.
{
  const parsed = parsedFixture({ slotStatus: { listingType: { status: 'deferred', turn: 1 } }, turn: 3 })
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 5, mode: 'fallback', fallbackLevel: 0 })
  assertEqual('fallback never re-offers deferred slot', followUp.offerSlot, null)
  assertEqual('fallback deferred -> reOffer false', followUp.reOffer, false)
  assertEqual('fallback deferred -> with-alternatives', followUp.softOutcome, 'unverified_with_alternatives')
}

// At-most-one-follow-up invariant holds for fallback outcomes too.
{
  const parsed = parsedFixture()
  const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 5, mode: 'fallback', fallbackLevel: 0 })
  assertTrue('fallback: offerSlot never an array', !Array.isArray(followUp.offerSlot))
}

// Input purity under a fallback outcome.
{
  const parsed = parsedFixture({ pendingQuestion: { type: 'slot_question', slots: ['listingType'], askedAtTurn: 1, retryCount: 0 } })
  const snapshot = JSON.stringify(parsed)
  decideFollowUp({ parsed, suppressFollowUp: false }, { count: 0, mode: 'fallback', descriptionSearchAttempted: true })
  assertEqual('fallback decideFollowUp does not mutate parsed', JSON.stringify(parsed), snapshot)
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
