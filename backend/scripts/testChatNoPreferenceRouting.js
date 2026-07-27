// backend/scripts/testChatNoPreferenceRouting.js
//
// Focused, fully deterministic tests for the no-preference/exploration
// routing fix — no DB connection, no Gemini call, no network. Fixed inputs,
// exact assertions, same conventions as testChatConversationMemory.js.
//
// THE BUG BEING GUARDED AGAINST (verified with a one-shot live replay on
// 2026-07-18, model gemini-3.1-flash-lite): mid-search, the visitor answered
// the assistant's "Do you have a preferred district or budget?" with
// "no i am just looking i didnt decide anything yet". Gemini correctly
// returned intentType "property_followup", listingType "Sale", propertyType
// "Apartment", noPreference true — but also replyType "casual_reply", and
// buildNonPropertyReply fired the context-blind canned casual greeting off
// replyType alone, discarding the fully-sufficient merged search context.
//
// simulateTurn() below mirrors routes/chat.js's routing order exactly
// (normalize -> raw-text type signals -> conversation-state resolution ->
// district scope -> page context -> lead flow -> non-property reply ->
// POLICY ENGINE ask-vs-search decision). It stops where chat.js would run
// the actual DB search — filter contents stand in for the search; a handful
// of Phase 4 scenarios below additionally exercise decideFollowUp/buildReply
// directly against fixture properties to cover POST-search behavior, the
// same pattern section 1 already used before Phase 4 existed. The
// shownPropertyIds $nin exclusion and persistence are chat.js-only concerns,
// out of scope here and covered by the route-level tests.
//
// PHASE 4 NOTE: decideTurnAction/decideFollowUp (chatPolicyEngine.js) changed
// real, intentional behavior — the bot now prefers searching over blocking
// with a question (see the architecture discussion this phase implements).
// Several assertions below that used to expect an 'ask' route now correctly
// expect 'search': that is not a regression, it is the point of this phase.
// Search-vs-declined-slot conservatism (this file's original purpose) is
// unaffected — every Phase 1-3 scenario that already searched still searches
// identically; only the handful that used to BLOCK now searches instead.
//
// Usage: node scripts/testChatNoPreferenceRouting.js

import {
  normalizeParsed,
  applyRawTextPropertyTypeSignals,
  keywordFallbackParser,
} from '../services/chatMessageParsing.js'
import { resolveConversationState, isShowMoreRequest } from '../services/chatConversationMemory.js'
import { handleDistrictScopeClarification } from '../services/chatDistrictScope.js'
import { handleLeadFlow } from '../services/chatLeadFlow.js'
import {
  buildNonPropertyReply,
  shouldSkipGeminiAskQuestion,
  buildNextUsefulQuestion,
  renderSlotQuestion,
  buildReply,
} from '../services/chatReplyBuilder.js'
import { buildMongoFilter } from '../services/chatFilters.js'
import { createOrRetryPendingQuestion } from '../services/chatPendingQuestion.js'
import {
  decideTurnAction,
  decideFollowUp,
  detectMixedListingTypes,
  MANY_RESULTS_THRESHOLD,
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

// ─── Route simulation (mirrors routes/chat.js order exactly, Phase 4) ──────
const simulateTurn = async ({ message, currentFilters = {}, geminiOutput, pageKey = 'properties' }) => {
  let parsedFromMessage = normalizeParsed(geminiOutput, message)
  applyRawTextPropertyTypeSignals(parsedFromMessage, message)

  let { parsed, newLifestyleConceptsInMessage } = resolveConversationState({
    message,
    currentFilters,
    parsedFromMessage,
  })

  const districtScopeResult = handleDistrictScopeClarification({
    message,
    currentFilters,
    parsedFromMessage,
    parsed,
    newLifestyleConceptsInMessage,
  })

  parsed = districtScopeResult.parsed

  if (districtScopeResult.handled) {
    return { route: 'district_clarification', reply: districtScopeResult.reply, parsed }
  }

  if (pageKey === 'sale') parsed.listingType = 'Sale'
  if (pageKey === 'rent') parsed.listingType = 'Rent'

  const leadResult = await handleLeadFlow({
    message,
    parsed,
    parsedFromMessage,
    currentFilters,
    pageKey,
    lastShownProperties: [],
  })

  if (leadResult.handled) {
    return { route: 'lead_flow', reply: leadResult.reply, parsed }
  }

  const nonPropertyReply = buildNonPropertyReply(parsed)

  if (nonPropertyReply) {
    return { route: 'non_property_reply', reply: nonPropertyReply, parsed }
  }

  // Phase 4: the single authoritative ask-vs-search decision.
  const isShowMore = isShowMoreRequest(message)
  const turnAction = decideTurnAction({ parsed, pageKey, isShowMore })

  if (turnAction.type === 'ask') {
    const questionText = renderSlotQuestion(turnAction.slots)
    parsed.pendingQuestion = createOrRetryPendingQuestion(parsed.pendingQuestion, turnAction.slots, parsed.turn)
    return { route: 'ask', reply: questionText, parsed, turnAction }
  }

  // search — this sim stops before hitting the DB, matching its documented
  // scope. Scenarios needing post-search behavior call decideFollowUp/
  // buildReply directly against fixture properties (see section 1 and the
  // Phase 4 section below).
  return { route: 'search', filter: buildMongoFilter(parsed), parsed, turnAction }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

// Gemini output shape with every field null/empty, overridable per scenario.
const geminiParsed = (overrides = {}) => ({
  intent: 'property_search',
  intentType: 'property_search',
  replyType: 'search',
  searchMode: 'field',
  descriptionQuery: null,
  nextQuestion: null,
  listingType: null,
  propertyType: null,
  propertyTypes: [],
  uncertainPropertyType: false,
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
  mustHave: [],
  niceToHave: [],
  lifestyle: [],
  lifestyleConcepts: [],
  excludedConcepts: [],
  changedMind: false,
  noPreference: false,
  requirements: [],
  needsClarification: false,
  clarifyingQuestion: null,
  ...overrides,
})

// The EXACT output Gemini returned in the verified 2026-07-18 replay of the
// failing final turn — do not "improve" it; the point is that routing must
// survive this exact inconsistent combination (property_followup context +
// casual_reply).
const verifiedFailingTurnGemini = geminiParsed({
  intentType: 'property_followup',
  replyType: 'casual_reply',
  nextQuestion:
    "No problem! Feel free to browse or let me know if you'd like to narrow it down by district, budget, or any specific features whenever you're ready.",
  listingType: 'Sale',
  propertyType: 'Apartment',
  noPreference: true,
})

// What currentFilters round-trips back as after turn 2 ("apartment" ->
// "Do you have a preferred district or budget?") — the merged parsed the
// frontend stored and echoes back, including the stale ask_question fields.
const activeSaleApartmentFilters = () => ({
  ...geminiParsed({
    replyType: 'ask_question',
    nextQuestion: 'Do you have a preferred district or budget?',
    listingType: 'Sale',
    propertyType: 'Apartment',
  }),
})

const failingMessage = 'no i am just looking i didnt decide anything yet'

const fixtureProperties = [
  { _id: 'p1', title: 'A1', listingType: 'Sale', propertyType: 'Apartment', district: 'Esenyurt', price: 3000000 },
  { _id: 'p2', title: 'A2', listingType: 'Sale', propertyType: 'Apartment', district: 'Beylikdüzü', price: 4000000 },
]

const mixedFixtureProperties = [
  { _id: 'm1', title: 'M1', listingType: 'Sale', propertyType: 'Apartment', district: 'Büyükçekmece', price: 3500000 },
  { _id: 'm2', title: 'M2', listingType: 'Rent', propertyType: 'Apartment', district: 'Büyükçekmece', price: 25000 },
  { _id: 'm3', title: 'M3', listingType: 'Sale', propertyType: 'Apartment', district: 'Büyükçekmece', price: 4200000 },
]

// Runs a turn all the way through post-search policy + reply, using fixture
// properties in place of a real DB search (same principle simulateTurn
// documents for the pre-search half).
const simulatePostSearch = (turnResult, { properties = fixtureProperties, fallbackLevel = 0, ...outcomeOverrides } = {}) => {
  const mixedListingTypes = detectMixedListingTypes(properties)
  const followUp = decideFollowUp(
    { parsed: turnResult.parsed, suppressFollowUp: turnResult.turnAction?.suppressFollowUp === true },
    { count: properties.length, fallbackLevel, mixedListingTypes, ...outcomeOverrides }
  )
  const reply = buildReply({
    properties,
    fallbackLevel,
    parsed: turnResult.parsed,
    followUp,
    mixedListingTypes,
  })

  return { followUp, reply, mixedListingTypes }
}

const run = async () => {
  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('1. Exact failing conversation (verified Gemini output, verbatim)')
  line()

  const bugTurn = await simulateTurn({
    message: failingMessage,
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: verifiedFailingTurnGemini,
  })

  assertEqual('route is search (not the canned casual reply)', bugTurn.route, 'search')
  assertEqual('filterUsed is exactly Sale + Apartment, broad', bugTurn.filter, {
    status: 'Available',
    listingType: 'Sale',
    propertyType: 'Apartment',
  })
  assertTrue('no district in filter', !('district' in (bugTurn.filter || {})))
  assertTrue('no price in filter', !('price' in (bugTurn.filter || {})))
  assertEqual('merged listingType preserved', bugTurn.parsed.listingType, 'Sale')
  assertEqual('merged propertyType preserved', bugTurn.parsed.propertyType, 'Apartment')
  assertEqual('noPreference survives into merged parsed', bugTurn.parsed.noPreference, true)
  assertEqual('policy engine suppresses follow-up this turn', bugTurn.turnAction.suppressFollowUp, true)

  const bugReply = buildReply({
    properties: fixtureProperties,
    fallbackLevel: 0,
    parsed: bugTurn.parsed,
  })

  assertTrue('reply does not re-ask buy/rent', !/buy or rent/i.test(bugReply))
  assertTrue('reply does not re-ask property type', !/type of property/i.test(bugReply))
  assertTrue(
    'reply does not immediately re-ask district after the visitor just declined',
    !/preferred district/i.test(bugReply)
  )
  assertTrue('reply announces results', /I found 2/i.test(bugReply))

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('2. Phrase variants via the same structured noPreference signal')
  line()

  // Different phrasings, and deliberately different replyType wobbles —
  // routing must depend on the structured signal + context, not the words.
  const variants = [
    { message: "I haven't decided yet", replyType: 'casual_reply' },
    { message: 'No preference', replyType: 'search' },
    { message: 'Anything is fine', replyType: 'casual_reply' },
    { message: "I'm just browsing", replyType: 'casual_reply' },
    { message: 'Show me whatever you have', replyType: 'search' },
    {
      message: "I don't know my budget yet",
      replyType: 'ask_question',
      nextQuestion: 'Do you have a preferred district?',
    },
  ]

  for (const variant of variants) {
    const result = await simulateTurn({
      message: variant.message,
      currentFilters: activeSaleApartmentFilters(),
      geminiOutput: geminiParsed({
        intentType: 'property_followup',
        replyType: variant.replyType,
        nextQuestion: variant.nextQuestion || null,
        listingType: 'Sale',
        propertyType: 'Apartment',
        noPreference: true,
      }),
    })

    assertEqual(`"${variant.message}" (${variant.replyType}) -> search`, result.route, 'search')
    assertEqual(`"${variant.message}" keeps Sale + Apartment`, result.filter, {
      status: 'Available',
      listingType: 'Sale',
      propertyType: 'Apartment',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('3. Genuine casual chat, NO active context')
  line()

  const casualNoContext = await simulateTurn({
    message: 'How are you?',
    currentFilters: {},
    geminiOutput: geminiParsed({ intentType: 'casual_chat', replyType: 'casual_reply' }),
  })

  assertEqual('route is non_property_reply', casualNoContext.route, 'non_property_reply')
  assertTrue('canned casual reply returned', /doing well/i.test(casualNoContext.reply))

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('4. Genuine casual chat WITH active context — must stay casual')
  line()

  const casualWithContext = await simulateTurn({
    message: 'How are you?',
    currentFilters: activeSaleApartmentFilters(),
    // Per the prompt's casual_chat example: no filters invented, and this is
    // classified casual_chat by intent, not just replyType.
    geminiOutput: geminiParsed({ intentType: 'casual_chat', replyType: 'casual_reply' }),
  })

  assertEqual('route stays non_property_reply (no auto-search)', casualWithContext.route, 'non_property_reply')
  assertTrue('canned casual reply returned', /doing well/i.test(casualWithContext.reply))

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('5. False positives: "no ..." messages are NOT exploration mode')
  line()

  const noParking = await simulateTurn({
    message: 'No parking needed',
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      parking: false,
    }),
  })

  assertEqual('"No parking needed" -> search', noParking.route, 'search')
  assertEqual('"No parking needed" does not set noPreference', noParking.parsed.noPreference, false)
  assertTrue('"No parking needed" adds no parking constraint', !('parking' in noParking.filter))

  const villaInstead = await simulateTurn({
    message: 'No, I want a villa instead',
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Villa',
    }),
  })

  assertEqual('"No, I want a villa instead" -> search', villaInstead.route, 'search')
  assertEqual('propertyType switched to Villa', villaInstead.filter.propertyType, 'Villa')
  assertEqual('noPreference stays false', villaInstead.parsed.noPreference, false)

  const noFurnished = await simulateTurn({
    message: "I don't want a furnished apartment",
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      furnished: false,
    }),
  })

  assertEqual('"I don\'t want furnished" -> search', noFurnished.route, 'search')
  assertTrue('no furnished constraint in filter', !('furnished' in noFurnished.filter))

  const noShowMore = await simulateTurn({
    message: 'No, show me more',
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
    }),
  })

  assertEqual('"No, show me more" -> search with same criteria', noShowMore.route, 'search')
  assertEqual('"No, show me more" keeps Sale + Apartment', noShowMore.filter, {
    status: 'Available',
    listingType: 'Sale',
    propertyType: 'Apartment',
  })

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('6. noPreference lifetime: strictly per-turn')
  line()

  // Previous response carried noPreference:true back via currentFilters; the
  // next message says nothing about preference — it must NOT stick.
  const staleFilters = { ...activeSaleApartmentFilters(), noPreference: true }
  const nextTurn = await simulateTurn({
    message: 'what about Esenyurt',
    currentFilters: staleFilters,
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: 'Esenyurt',
    }),
  })

  assertEqual('stale noPreference cleared on next turn', nextTurn.parsed.noPreference, false)
  assertEqual('district applied normally', nextTurn.filter.district?.$regex, 'Esenyurt')
  assertEqual(
    'next-useful-question returns again once noPreference expired',
    buildNextUsefulQuestion(nextTurn.parsed),
    'Do you have a budget range in mind?'
  )

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('7. Regression coverage of neighbouring flows')
  line()

  // 7a. show more — raw-text detection untouched
  assertEqual('isShowMoreRequest("show me more")', isShowMoreRequest('show me more'), true)
  assertEqual('isShowMoreRequest("no, show me more") stays false', isShowMoreRequest('no, show me more'), false)

  const showMore = await simulateTurn({
    message: 'show me more',
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
    }),
  })
  assertEqual('show more -> search with same criteria', showMore.route, 'search')
  assertEqual('show more turn reason', showMore.turnAction.reason, 'show-more-continuation')

  // 7b. listing type switch resets district/propertyType (rule 8, memory
  // level — UNCHANGED). Phase 4 changes only the ROUTE outcome: the old
  // policy blocked here asking for property type again; the new policy
  // searches instead (decision: do not block on a merely-empty slot).
  const listingSwitch = await simulateTurn({
    message: 'actually I want to rent',
    currentFilters: { ...activeSaleApartmentFilters(), district: 'Kadıköy' },
    geminiOutput: geminiParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  })

  assertEqual('listing switch clears district (memory rule unchanged)', listingSwitch.parsed.district, null)
  assertEqual('listing switch clears propertyType (memory rule unchanged)', listingSwitch.parsed.propertyType, null)
  assertEqual('Phase 4: listing switch now searches instead of re-asking property type', listingSwitch.route, 'search')
  assertEqual('listing switch filter has listingType only', listingSwitch.filter, { status: 'Available', listingType: 'Rent' })

  // 7c. district-scope clarification: trigger, then both answers (unaffected
  // by Phase 4 — this sub-flow runs entirely upstream of the policy engine).
  const scopeTrigger = await simulateTurn({
    message: 'my wife wants a sea view',
    currentFilters: { ...activeSaleApartmentFilters(), district: 'Kadıköy' },
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      replyType: 'search',
      searchMode: 'description',
      descriptionQuery: 'sea view apartment',
      listingType: 'Sale',
      propertyType: 'Apartment',
      lifestyle: ['sea view'],
    }),
  })

  assertEqual('lifestyle pivot with old district asks scope question', scopeTrigger.route, 'district_clarification')
  assertTrue('scope question mentions the district', /Kadıköy/.test(scopeTrigger.reply))

  const pendingScopeFilters = {
    ...activeSaleApartmentFilters(),
    district: 'Kadıköy',
    searchMode: 'description',
    descriptionQuery: 'sea view apartment',
    lifestyle: ['sea view'],
    pendingClarification: { type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['sea_view'], retryCount: 0 },
  }

  const scopeKeep = await simulateTurn({
    message: 'keep Kadıköy',
    currentFilters: pendingScopeFilters,
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: 'Kadıköy',
    }),
  })

  assertEqual('scope answer "keep" continues to search', scopeKeep.route, 'search')
  assertEqual('scope answer "keep" retains district', scopeKeep.filter.district?.$regex, 'Kadıköy')

  const scopeBroaden = await simulateTurn({
    message: 'anywhere is fine',
    currentFilters: pendingScopeFilters,
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      noPreference: true,
    }),
  })

  assertEqual('scope answer "anywhere" continues to search', scopeBroaden.route, 'search')
  assertTrue('scope answer "anywhere" drops district', !('district' in scopeBroaden.filter))

  // 7d. lifestyle concept switch and combine (unaffected — rule B always
  // searches for a lifestyle/description request).
  const lifestyleFilters = {
    ...activeSaleApartmentFilters(),
    searchMode: 'description',
    descriptionQuery: 'near schools',
    lifestyle: ['near schools'],
  }

  const conceptSwitch = await simulateTurn({
    message: 'what about sea view',
    currentFilters: lifestyleFilters,
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      searchMode: 'description',
      descriptionQuery: 'sea view',
      listingType: 'Sale',
      propertyType: 'Apartment',
      lifestyle: ['sea view'],
    }),
  })

  assertEqual('concept switch -> search', conceptSwitch.route, 'search')
  assertEqual('concept switch replaces lifestyle', conceptSwitch.parsed.lifestyle, ['sea view'])

  const conceptCombine = await simulateTurn({
    message: 'also near a park',
    currentFilters: lifestyleFilters,
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      searchMode: 'description',
      descriptionQuery: 'near park',
      listingType: 'Sale',
      propertyType: 'Apartment',
      lifestyle: ['near park'],
    }),
  })

  assertEqual('concept combine -> search', conceptCombine.route, 'search')
  assertEqual('concept combine unions lifestyle', conceptCombine.parsed.lifestyle, ['near schools', 'near park'])

  // 7e. lead flow still wins before reply routing / policy engine
  const leadEntry = await simulateTurn({
    message: 'can you call me please',
    currentFilters: activeSaleApartmentFilters(),
    geminiOutput: geminiParsed({ intentType: 'contact_request', replyType: 'contact_reply' }),
  })

  assertEqual('contact request enters lead flow', leadEntry.route, 'lead_flow')
  assertTrue('lead flow asks for contact details', typeof leadEntry.reply === 'string' && leadEntry.reply.length > 0)

  // 7f. Phase 4: a decline right after "for sale" (propertyType still
  // unknown) now searches broadly instead of blocking — noPreference alone
  // is enough to search, regardless of anchoring.
  const declineWithoutType = await simulateTurn({
    message: "I haven't decided yet",
    currentFilters: geminiParsed({ replyType: 'ask_question', listingType: 'Sale' }),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      replyType: 'casual_reply',
      listingType: 'Sale',
      noPreference: true,
    }),
  })

  assertEqual('Phase 4: decline with no propertyType now searches instead of blocking', declineWithoutType.route, 'search')
  assertEqual('search suppresses the follow-up this turn', declineWithoutType.turnAction.suppressFollowUp, true)
  assertEqual('propertyType stays genuinely open (no filter, no forced value)', declineWithoutType.filter, {
    status: 'Available',
    listingType: 'Sale',
  })

  // 7g. Phase 4 (= spec item N): Gemini's ask_question suggestion no longer
  // has routing authority — the engine searches because listingType alone
  // already anchors the turn.
  const firstTurn = await simulateTurn({
    message: 'Show me properties for sale',
    currentFilters: {},
    geminiOutput: geminiParsed({
      replyType: 'ask_question',
      nextQuestion: 'What type of property are you interested in (e.g., apartment, villa, penthouse)?',
      listingType: 'Sale',
    }),
  })

  assertEqual("Phase 4: Gemini's ask_question suggestion is overridden -> search", firstTurn.route, 'search')
  assertEqual('reason reflects the real signal present, not Gemini\'s suggestion', firstTurn.turnAction.reason, 'sufficient-context-search')

  // 7h. no-results reply wording unchanged; noPreference suppresses the
  // trailing question but keeps the honest no-results message
  assertEqual(
    'no-results field-search reply unchanged',
    buildReply({ properties: [], fallbackLevel: 3, parsed: geminiParsed({ listingType: 'Sale', propertyType: 'Apartment' }) }),
    "I couldn't find any available properties right now. Try adjusting your district, budget, or property type."
  )

  assertEqual(
    'no-results description reply with noPreference gives generic guidance (no re-ask)',
    buildReply({
      properties: [],
      fallbackLevel: 0,
      parsed: geminiParsed({ listingType: 'Sale', propertyType: 'Apartment', noPreference: true, descriptionQuery: 'sea view' }),
      descriptionSearchAttempted: true,
    }),
    "I couldn't find a strong match from the property descriptions yet. Try adding a district, budget, or property type."
  )

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('8. Direct unit checks on the changed helpers')
  line()

  assertEqual(
    'buildNonPropertyReply: verified bug parsed -> null',
    buildNonPropertyReply({
      intentType: 'property_followup',
      replyType: 'casual_reply',
      listingType: 'Sale',
      propertyType: 'Apartment',
      noPreference: true,
    }),
    null
  )
  assertTrue(
    'buildNonPropertyReply: casual_reply with property intent but NO context/noPreference still casual',
    /doing well/i.test(buildNonPropertyReply({ intentType: 'property_search', replyType: 'casual_reply' }) || '')
  )
  assertTrue(
    'buildNonPropertyReply: intentType casual_chat always casual, even with context',
    /doing well/i.test(
      buildNonPropertyReply({ intentType: 'casual_chat', replyType: 'casual_reply', listingType: 'Sale', propertyType: 'Apartment' }) || ''
    )
  )
  assertEqual('shouldSkipGeminiAskQuestion: noPreference -> true', shouldSkipGeminiAskQuestion({ noPreference: true }), true)
  assertEqual('shouldSkipGeminiAskQuestion: plain fields -> false', shouldSkipGeminiAskQuestion({ listingType: 'Sale' }), false)
  assertEqual(
    'buildNextUsefulQuestion: suppressed while noPreference is true',
    buildNextUsefulQuestion({ listingType: 'Sale', propertyType: 'Apartment', noPreference: true }),
    null
  )
  assertEqual(
    'buildNextUsefulQuestion: unchanged without noPreference',
    buildNextUsefulQuestion({ listingType: 'Sale', propertyType: 'Apartment' }),
    'Do you have a preferred district?'
  )

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('9. Phase 1: Büyükçekmece stale-nextQuestion case, full pipeline')
  line()

  // Captured production turn: the bot had asked "buy or rent, and budget?";
  // the user deferred. The stale-nextQuestion guarantee from Phase 1 is
  // still what's under test here — it is orthogonal to Phase 4's ask-vs-
  // search policy. What HAS changed since this section was first written:
  // the route itself. The Phase 2 shadow mechanism reads "not sure ...
  // buying or renting..." and defers listingType (detectShadowSlotSignals —
  // no pendingQuestion needed for this one, unlike section 11's more
  // targeted case), so by the time the Phase 4 engine runs, listingType's
  // standing is already 'deferred', not merely empty — and Phase 4 never
  // blocks on a deferred slot. Route is 'search', not 'ask'.
  const staleQuestionText = 'Are you looking to buy or rent, and what is your budget?'

  const buyukcekmeceTurn = await simulateTurn({
    message: "I am not sure. I just want to see the apartments and later I'll decide whether buying or renting is better.",
    currentFilters: geminiParsed({
      intentType: 'property_search',
      replyType: 'ask_question',
      nextQuestion: staleQuestionText,
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
    }),
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      replyType: 'search',
      nextQuestion: null,
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
      uncertainPropertyType: true,
      noPreference: false,
    }),
  })

  assertEqual('Büyükçekmece: Phase 1 guarantee holds — parsed.nextQuestion is null', buyukcekmeceTurn.parsed.nextQuestion, null)
  assertTrue(
    'Büyükçekmece: stale question text absent from resolved state',
    !JSON.stringify(buyukcekmeceTurn.parsed).includes(staleQuestionText)
  )
  assertEqual('Büyükçekmece: propertyType retained', buyukcekmeceTurn.parsed.propertyType, 'Apartment')
  assertEqual('Büyükçekmece: district retained', buyukcekmeceTurn.parsed.district, 'Büyükçekmece')
  assertEqual('Büyükçekmece: Phase 2 shadow signal defers listingType', buyukcekmeceTurn.parsed.slotStatus.listingType, {
    status: 'deferred',
    turn: buyukcekmeceTurn.parsed.turn,
  })
  assertEqual('Büyükçekmece (Phase 4): route is now search, not ask', buyukcekmeceTurn.route, 'search')
  assertEqual('Büyükçekmece (Phase 4): reason names the deferred listingType', buyukcekmeceTurn.turnAction.reason, 'listing-type-deferred-broad-search')

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('10. Phase 2 shadow mode: slotStatus never changes routing or filters')
  line()

  // The exact failing-conversation turn again, now with a shadow slotStatus
  // and turn round-tripping in currentFilters — route, filter, and criteria
  // must be identical to section 1's run, and the Mongo filter must not
  // contain any Phase 2 keys.
  const shadowTurn = await simulateTurn({
    message: failingMessage,
    currentFilters: {
      ...activeSaleApartmentFilters(),
      slotStatus: { district: { status: 'declined', turn: 2 }, budget: { status: 'deferred', turn: 2 } },
      turn: 3,
    },
    geminiOutput: verifiedFailingTurnGemini,
  })

  assertEqual('shadow: route still search', shadowTurn.route, 'search')
  assertEqual('shadow: filter identical (no slotStatus/turn leakage)', shadowTurn.filter, {
    status: 'Available',
    listingType: 'Sale',
    propertyType: 'Apartment',
  })
  assertEqual('shadow: statuses round-trip in resolved state', shadowTurn.parsed.slotStatus, {
    district: { status: 'declined', turn: 2 },
    budget: { status: 'deferred', turn: 2 },
  })
  assertEqual('shadow: turn incremented once', shadowTurn.parsed.turn, 4)

  // Hostile slotStatus from the client must sanitize away without touching
  // the route decision.
  const hostileShadowTurn = await simulateTurn({
    message: 'How are you?',
    currentFilters: {
      ...activeSaleApartmentFilters(),
      slotStatus: { listingType: 'deferred', hacked: { status: 'declined', turn: 1 } },
      turn: -5,
    },
    geminiOutput: geminiParsed({ intentType: 'casual_chat', replyType: 'casual_reply' }),
  })

  assertEqual('hostile shadow: casual route unchanged', hostileShadowTurn.route, 'non_property_reply')
  assertEqual('hostile shadow: slotStatus sanitized to {}', hostileShadowTurn.parsed.slotStatus, {})
  assertEqual('hostile shadow: invalid turn normalized then incremented', hostileShadowTurn.parsed.turn, 1)

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('11. Phase 3: pendingQuestion lifecycle through the full pipeline (Phase 4 routing)')
  line()

  // First turn "for sale" -> listingType alone anchors the turn -> Phase 4
  // searches immediately. No PRE-search pendingQuestion gets created (that
  // would only happen via decideFollowUp, post-search, out of this DB-free
  // sim's reach — see section 12 for that half).
  const firstAskTurn = await simulateTurn({
    message: 'Show me properties for sale',
    currentFilters: {},
    geminiOutput: geminiParsed({
      replyType: 'ask_question',
      nextQuestion: 'What type of property are you interested in (e.g., apartment, villa, penthouse)?',
      listingType: 'Sale',
    }),
  })

  assertEqual('Phase 4: first turn searches instead of asking', firstAskTurn.route, 'search')
  assertEqual('Phase 4: no pre-search pendingQuestion created', firstAskTurn.parsed.pendingQuestion, null)

  // Büyükçekmece WITH an explicit pending question from a prior turn
  // (['listingType','budget']) — Phase 3's targeted interpretation still
  // defers exactly listingType (the message names buying/renting, not
  // budget) and shrinks pending to ['budget'], preserving the ORIGINAL
  // askedAtTurn/retryCount (Phase 3's partial-resolution rule, unaffected).
  // Phase 4 change: since propertyType+district are filled, the turn is
  // anchored regardless — route is 'search', and because decideTurnAction's
  // search branch never touches pendingQuestion, the already-shrunk pending
  // question for budget rides through untouched (no fresh listingType
  // pending question is invented).
  const anchoredBuyukcekmece = await simulateTurn({
    message: "I am not sure. I just want to see the apartments and later I'll decide whether buying or renting is better.",
    currentFilters: {
      ...geminiParsed({ propertyType: 'Apartment', district: 'Büyükçekmece' }),
      pendingQuestion: { type: 'slot_question', slots: ['listingType', 'budget'], askedAtTurn: 2, retryCount: 0 },
      turn: 2,
    },
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      replyType: 'search',
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
      uncertainPropertyType: true,
    }),
  })

  assertEqual('anchored (Phase 4): route is search', anchoredBuyukcekmece.route, 'search')
  assertEqual('anchored: listingType deferred via pending target', anchoredBuyukcekmece.parsed.slotStatus.listingType, {
    status: 'deferred',
    turn: 3,
  })
  assertEqual('anchored: budget has no status (not addressed by the answer)', anchoredBuyukcekmece.parsed.slotStatus.budget, undefined)
  assertEqual('anchored: pending shrinks to budget, original askedAtTurn/retryCount kept', anchoredBuyukcekmece.parsed.pendingQuestion, {
    type: 'slot_question',
    slots: ['budget'],
    askedAtTurn: 2,
    retryCount: 0,
  })
  assertEqual('anchored: propertyType retained', anchoredBuyukcekmece.parsed.propertyType, 'Apartment')
  assertEqual('anchored: district retained', anchoredBuyukcekmece.parsed.district, 'Büyükçekmece')

  // Casual interruption: pending survives the whole pipeline untouched
  // (unaffected by Phase 4 — casual routing happens upstream of the engine).
  const casualWithPending = await simulateTurn({
    message: 'How are you?',
    currentFilters: {
      ...activeSaleApartmentFilters(),
      pendingQuestion: { type: 'slot_question', slots: ['district'], askedAtTurn: 2, retryCount: 0 },
      turn: 2,
    },
    geminiOutput: geminiParsed({ intentType: 'casual_chat', replyType: 'casual_reply' }),
  })

  assertEqual('casual: route unchanged', casualWithPending.route, 'non_property_reply')
  assertEqual('casual: pending survives', casualWithPending.parsed.pendingQuestion, {
    type: 'slot_question',
    slots: ['district'],
    askedAtTurn: 2,
    retryCount: 0,
  })

  // Phase 4: with propertyType+district already filled, "hmm okay" (an
  // uninterpretable non-answer) is anchored regardless — the engine searches
  // instead of re-asking, so the pre-existing pendingQuestion for listingType
  // is left exactly as Phase 3 resolved it (untouched, NOT incremented —
  // there is no re-ask to increment a retry count for).
  const noReaskTurn = await simulateTurn({
    message: 'hmm okay',
    currentFilters: {
      ...geminiParsed({ propertyType: 'Apartment', district: 'Büyükçekmece' }),
      pendingQuestion: { type: 'slot_question', slots: ['listingType'], askedAtTurn: 2, retryCount: 0 },
      turn: 2,
    },
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      replyType: 'search',
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
    }),
  })

  assertEqual('Phase 4: anchored turn searches instead of re-asking', noReaskTurn.route, 'search')
  assertEqual('Phase 4: pendingQuestion left untouched, not incremented', noReaskTurn.parsed.pendingQuestion, {
    type: 'slot_question',
    slots: ['listingType'],
    askedAtTurn: 2,
    retryCount: 0,
  })

  // Expired pending is silently dropped before interpretation — unaffected
  // by Phase 4 (Phase 3 expiry runs upstream of the engine entirely).
  const expiredTurn = await simulateTurn({
    message: 'not sure',
    currentFilters: {
      ...activeSaleApartmentFilters(),
      pendingQuestion: { type: 'slot_question', slots: ['district'], askedAtTurn: 1, retryCount: 0 },
      turn: 8,
    },
    geminiOutput: geminiParsed({
      intentType: 'property_followup',
      replyType: 'search',
      listingType: 'Sale',
      propertyType: 'Apartment',
    }),
  })

  assertEqual('expired pending: no district status written from stale anchor', expiredTurn.parsed.slotStatus.district, undefined)

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log('12. Phase 4: route-level regression scenarios')
  line()

  // 12.1 — Exact Büyükçekmece bug (flagship): search runs, no missing-info
  // ask, filter omits listingType, reply acknowledges a genuine Sale+Rent
  // mix, no listingType pendingQuestion is immediately recreated. Uses the
  // exact captured production wording (contains both "buying" and
  // "renting", which is what lets the Phase 2 shadow signal defer
  // listingType — same mechanism section 9 already proves) so listingType
  // genuinely reaches 'deferred', not merely 'empty': the MIN_TURNS_BEFORE_
  // REOFFER_DEFERRED guard is what must suppress the immediate re-ask here,
  // not merely the absence of a signal.
  {
    const turnResult = await simulateTurn({
      message: "I am not sure. I just want to see the apartments and later I'll decide whether buying or renting is better.",
      currentFilters: geminiParsed({ propertyType: 'Apartment', district: 'Büyükçekmece' }),
      geminiOutput: geminiParsed({
        intentType: 'property_followup',
        replyType: 'search',
        propertyType: 'Apartment',
        district: 'Büyükçekmece',
        uncertainPropertyType: true,
      }),
    })

    assertEqual('12.1: listingType reaches deferred standing (not merely empty)', turnResult.parsed.slotStatus.listingType, {
      status: 'deferred',
      turn: turnResult.parsed.turn,
    })

    assertEqual('12.1: search path, no missing-info ask', turnResult.route, 'search')
    assertTrue('12.1: filter omits listingType', !('listingType' in turnResult.filter))
    assertEqual('12.1: filter keeps propertyType + district', turnResult.filter, {
      status: 'Available',
      propertyType: 'Apartment',
      district: { $regex: 'Büyükçekmece', $options: 'i' },
    })

    const { followUp, reply } = simulatePostSearch(turnResult, { properties: mixedFixtureProperties })
    assertTrue('12.1: reply acknowledges the Sale/Rent mix', /both properties for sale and for rent/i.test(reply))
    assertTrue('12.1: reply does not compare sale price to rent as the same scale', !/directly comparable/i.test(reply) || /not on the same scale|not directly comparable/i.test(reply))
    assertTrue('12.1: no immediate listingType question recreated', followUp.offerSlot !== 'listingType')
  }

  // 12.2 — Exact "just browsing" bug: covered fully by section 1; confirm
  // the two specific claims item 2 asks for explicitly.
  {
    assertEqual('12.2: no casual reply (section 1 bugTurn)', bugTurn.route, 'search')
    assertEqual('12.2: no immediate district/budget question this turn', bugTurn.turnAction.suppressFollowUp, true)
  }

  // 12.3 — "Show me properties": search/default result path, no rigid
  // propertyType blocker.
  {
    const turnResult = await simulateTurn({
      message: 'Show me properties.',
      currentFilters: {},
      geminiOutput: geminiParsed({ intentType: 'property_search', replyType: 'search' }),
    })

    assertEqual('12.3: searches rather than blocking', turnResult.route, 'search')
    assertEqual('12.3: default filter is honest and minimal', turnResult.filter, { status: 'Available' })
  }

  // 12.4 — "Show me properties for sale": Sale filter, search, optional
  // propertyType refinement AFTER results, never before.
  {
    const turnResult = await simulateTurn({
      message: 'Show me properties for sale.',
      currentFilters: {},
      geminiOutput: geminiParsed({ intentType: 'property_search', replyType: 'search', listingType: 'Sale' }),
    })

    assertEqual('12.4: no pre-search block', turnResult.route, 'search')
    assertEqual('12.4: Sale filter applied', turnResult.filter, { status: 'Available', listingType: 'Sale' })

    const { followUp } = simulatePostSearch(turnResult, {
      properties: Array.from({ length: MANY_RESULTS_THRESHOLD }, (_, i) => ({ _id: `s${i}`, listingType: 'Sale' })),
    })
    assertEqual('12.4: propertyType offered only after results, when useful', followUp.offerSlot, 'propertyType')
  }

  // 12.5 — "Rent." answering a pending ['listingType','budget'] question:
  // listingType fills, budget remains open, no repeated combined question.
  {
    const turnResult = await simulateTurn({
      message: 'Rent.',
      currentFilters: {
        ...geminiParsed({ propertyType: 'Apartment', district: 'Kadıköy' }),
        pendingQuestion: { type: 'slot_question', slots: ['listingType', 'budget'], askedAtTurn: 2, retryCount: 0 },
        turn: 2,
      },
      geminiOutput: geminiParsed({ intentType: 'property_followup', listingType: 'Rent' }),
    })

    assertEqual('12.5: listingType filled', turnResult.parsed.listingType, 'Rent')
    assertEqual('12.5: pending shrinks to budget only, no combined re-ask', turnResult.parsed.pendingQuestion, {
      type: 'slot_question',
      slots: ['budget'],
      askedAtTurn: 2,
      retryCount: 0,
    })
    assertEqual('12.5: searches (anchored by listingType+propertyType+district)', turnResult.route, 'search')
  }

  // 12.6 — "No preference" on budget: declined, never offered again.
  {
    const parsed = {
      ...geminiParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
      slotStatus: { budget: { status: 'declined', turn: 1 } },
      turn: 2,
    }
    const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 10, fallbackLevel: 2 })
    assertTrue('12.6: declined budget is never the offered slot', followUp.offerSlot !== 'budget')
  }

  // 12.7 — casual interruption: covered fully by section 11's
  // casualWithPending; cross-referenced here for the numbered checklist.
  assertEqual('12.7: casual reply still wins upstream of the engine', casualWithPending.route, 'non_property_reply')

  // 12.8 — district scope and lead flow unchanged: cross-referenced (7c/7e).
  assertEqual('12.8: district-scope trigger unchanged', scopeTrigger.route, 'district_clarification')
  assertEqual('12.8: lead flow unchanged', leadEntry.route, 'lead_flow')

  // 12.9 — show more unchanged: cross-referenced (7a).
  assertEqual('12.9: show-more unchanged', showMore.route, 'search')

  // 12.10 — listing-type switch: memory-level rule unchanged (district/
  // propertyType still clear); route-level outcome intentionally changed
  // by Phase 4 (search instead of re-ask) — both already asserted in 7b.
  assertEqual('12.10: district still clears on listing-type switch', listingSwitch.parsed.district, null)

  // 12.11 — lifestyle add/remove unchanged: cross-referenced (7d).
  assertEqual('12.11: lifestyle switch unchanged', conceptSwitch.parsed.lifestyle, ['sea view'])
  assertEqual('12.11: lifestyle combine unchanged', conceptCombine.parsed.lifestyle, ['near schools', 'near park'])

  // 12.12 — no-results fallback unchanged: cross-referenced (7h) plus a
  // direct decideFollowUp check for the zero-results case.
  {
    const parsed = geminiParsed({ listingType: 'Sale', propertyType: 'Apartment' })
    const followUp = decideFollowUp({ parsed, suppressFollowUp: false }, { count: 0, fallbackLevel: 0, descriptionSearchAttempted: false })
    assertEqual('12.12: plain no-results offers nothing (message already explains)', followUp.offerSlot, null)
    assertEqual('12.12: reason names the explained no-results case', followUp.reason, 'no-results-message-explains-issue')
  }

  // 12.13 — Gemini unavailable / fallback-parser scenario: the keyword
  // fallback's output shape (no noPreference/uncertainPropertyType fields at
  // all) still flows through the engine correctly.
  {
    const fallbackParsed = keywordFallbackParser('rent apartment in Beylikdüzü')
    let parsedFromMessage = normalizeParsed(fallbackParsed, 'rent apartment in Beylikdüzü')
    applyRawTextPropertyTypeSignals(parsedFromMessage, 'rent apartment in Beylikdüzü')

    const { parsed } = resolveConversationState({
      message: 'rent apartment in Beylikdüzü',
      currentFilters: {},
      parsedFromMessage,
    })

    const decision = decideTurnAction({ parsed, isShowMore: false })
    assertEqual('12.13: fallback-parsed turn searches normally', decision.type, 'search')
    assertEqual('12.13: fallback parser extracted listingType', parsed.listingType, 'Rent')
    assertEqual('12.13: fallback parser extracted propertyType', parsed.propertyType, 'Apartment')
  }

  // ═══════════════════════════════════════════════════════════════════════
  line()
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`)
  line()

  process.exit(failCount > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error('Test run crashed:', err)
  process.exit(1)
})
