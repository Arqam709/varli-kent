// backend/scripts/testChatUnverifiedSoftRequirement.js
//
// Deterministic route-contract regression for the post-search policy fix:
// an open-ended requirement (music studio, rooftop cinema, veterinary
// hospital, ...) whose soft/description search verifies nothing must NOT loop
// through hard-slot questions. It must instead surface an honest explanation
// and leave no stale pending question behind.
//
// No DB, no Gemini, no network. This exercises the REAL functions the route
// uses — decideFollowUp + createOrRetryPendingQuestion + buildReply — and
// replicates ONLY the tiny post-search glue that lives in routes/chat.js
// (the two conditional lines reproduced verbatim below), so it stays faithful
// to production without booting the server or calling Gemini/Mongo.
//
// Usage: node scripts/testChatUnverifiedSoftRequirement.js

import { decideFollowUp } from '../services/chatPolicyEngine.js'
import { createOrRetryPendingQuestion } from '../services/chatPendingQuestion.js'
import { buildReply } from '../services/chatReplyBuilder.js'
import { CHAT_MESSAGES } from '../locales/chatMessages.js'

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

// Replicates routes/chat.js's post-search glue EXACTLY (verbatim shape):
//   if (followUpDecision.softOutcome) parsed.pendingQuestion = null
//   if (followUpDecision.offerSlot)   parsed.pendingQuestion = createOrRetry(...)
// Returns the mutated pendingQuestion so the test can assert on it.
const applyRoutePostSearchGlue = (parsed, followUpDecision) => {
  if (followUpDecision.softOutcome) {
    parsed.pendingQuestion = null
  }
  if (followUpDecision.offerSlot) {
    parsed.pendingQuestion = createOrRetryPendingQuestion(
      parsed.pendingQuestion,
      [followUpDecision.offerSlot],
      parsed.turn
    )
  }
  return parsed.pendingQuestion
}

const baseParsed = (overrides = {}) => ({
  intentType: 'property_search',
  listingType: null,
  propertyType: null,
  propertyTypes: [],
  district: null,
  districts: [],
  descriptionQuery: 'music studio soundproof recording',
  searchMode: 'description',
  lifestyle: ['building suitable for a music studio'],
  mustHave: [],
  niceToHave: [],
  requirements: [],
  slotStatus: {},
  pendingQuestion: null,
  turn: 1,
  ...overrides,
})

line()
console.log('1. Music-studio class, no results (fallback, count 0)')
line()

{
  // Turn 1, nothing else stated: exactly the reported conversation's start.
  const parsed = baseParsed()
  const decision = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 0, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )

  assertEqual('no listing/property/district/budget question', decision.offerSlot, null)
  assertEqual('softOutcome is unverified_no_results', decision.softOutcome, 'unverified_no_results')

  applyRoutePostSearchGlue(parsed, decision)
  assertEqual('no pending question created', parsed.pendingQuestion, null)

  const reply = buildReply({
    properties: [],
    fallbackLevel: 0,
    parsed,
    descriptionSearchAttempted: true,
    followUp: decision,
    language: 'en',
  })
  assertEqual('honest terminal reply', reply, CHAT_MESSAGES.en.softUnverified.noResults)
  assertTrue('reply does not leak the internal descriptionQuery', !reply.includes('music studio'))
  assertTrue('reply does not append "try adding..." slot advice', !/try adding/i.test(reply))
}

line()
console.log('2. Stale pending question from a prior turn is cleared on pivot')
line()

{
  // A district question was pending from an earlier turn; the visitor then
  // pivots to the open-ended request. The stale pending must not survive to
  // trigger an irrelevant retry next turn.
  const parsed = baseParsed({
    turn: 2,
    pendingQuestion: { type: 'slot_question', slots: ['district'], askedAtTurn: 1, retryCount: 0 },
  })
  const decision = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 0, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )

  applyRoutePostSearchGlue(parsed, decision)
  assertEqual('stale pending question cleared', parsed.pendingQuestion, null)
}

line()
console.log('3. Fallback WITH structured alternatives (count > 0)')
line()

{
  const parsed = baseParsed()
  const decision = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 5, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )

  assertEqual('still no hard-slot question', decision.offerSlot, null)
  assertEqual('softOutcome is unverified_with_alternatives', decision.softOutcome, 'unverified_with_alternatives')

  applyRoutePostSearchGlue(parsed, decision)
  assertEqual('no pending question created for alternatives case', parsed.pendingQuestion, null)

  const reply = buildReply({
    properties: [{}, {}, {}, {}, {}],
    fallbackLevel: 0,
    parsed: { ...parsed, listingType: 'Sale' },
    matchedViaDescription: false,
    matchedViaSemantic: false,
    descriptionSearchAttempted: true,
    followUp: decision,
    language: 'en',
  })
  assertTrue('reply carries the honest broader-alternatives notice', reply.includes(CHAT_MESSAGES.en.softUnverified.withAlternatives))
  assertTrue('reply does not leak the internal descriptionQuery', !reply.includes('music studio'))
}

line()
console.log('4. Suppression silences the question but keeps the explanation')
line()

{
  // e.g. the visitor answered "no preference" on a fallback turn.
  const parsed = baseParsed({
    pendingQuestion: { type: 'slot_question', slots: ['district'], askedAtTurn: 1, retryCount: 0 },
    turn: 2,
  })
  const decision = decideFollowUp(
    { parsed, suppressFollowUp: true },
    { count: 0, mode: 'fallback', fallbackLevel: 0, descriptionSearchAttempted: true }
  )

  assertEqual('suppressed: no slot', decision.offerSlot, null)
  assertEqual('suppressed: softOutcome still preserved', decision.softOutcome, 'unverified_no_results')

  applyRoutePostSearchGlue(parsed, decision)
  assertEqual('suppressed: stale pending still cleared', parsed.pendingQuestion, null)

  const reply = buildReply({
    properties: [],
    fallbackLevel: 0,
    parsed,
    descriptionSearchAttempted: true,
    followUp: decision,
    language: 'en',
  })
  assertEqual('suppressed: honest explanation still rendered', reply, CHAT_MESSAGES.en.softUnverified.noResults)
}

line()
console.log('5. Normal (non-fallback) outcome still asks + keeps its pending question')
line()

{
  // A verified semantic result with empty slots: the cleanup must NOT fire,
  // and a normal refinement question is still created (proves the cleanup is
  // tied strictly to softOutcome, never applied universally).
  const parsed = baseParsed({ pendingQuestion: null })
  const decision = decideFollowUp(
    { parsed, suppressFollowUp: false },
    { count: 3, mode: 'semantic', fallbackLevel: 0, matchedViaSemantic: true }
  )

  assertEqual('semantic: offers a refinement slot', decision.offerSlot, 'listingType')
  assertEqual('semantic: softOutcome null', decision.softOutcome, null)

  applyRoutePostSearchGlue(parsed, decision)
  assertTrue('semantic: a pending question WAS created', parsed.pendingQuestion?.slots?.includes('listingType'))
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
