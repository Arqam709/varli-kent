// backend/scripts/testChatPendingQuestion.js
//
// Focused, fully deterministic unit tests for services/chatPendingQuestion.js
// — no DB, no Gemini, no network. Same conventions as testChatSlotState.js.
//
// Usage: node scripts/testChatPendingQuestion.js

import {
  PENDING_QUESTION_TYPE,
  PENDING_QUESTION_MAX_AGE_TURNS,
  normalizePendingQuestion,
  createPendingQuestion,
  createOrRetryPendingQuestion,
  deriveGeminiQuestionSlots,
  resolvePendingAnswer,
} from '../services/chatPendingQuestion.js'
import { deriveSlotStanding } from '../services/chatSlotState.js'

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

const pending = (slots, askedAtTurn = 1, retryCount = 0) => ({
  type: PENDING_QUESTION_TYPE,
  slots,
  askedAtTurn,
  retryCount,
})

// Minimal merged-state fixture: valueless governed slots + a turn counter.
const emptyState = (overrides = {}) => ({
  listingType: null,
  propertyType: null,
  propertyTypes: [],
  district: null,
  districts: [],
  minPrice: null,
  maxPrice: null,
  slotStatus: {},
  turn: 4,
  ...overrides,
})

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. normalizePendingQuestion')
line()

assertEqual('null -> null', normalizePendingQuestion(null, 2), null)
assertEqual('missing -> null', normalizePendingQuestion(undefined, 2), null)
assertEqual('array -> null', normalizePendingQuestion([pending(['budget'])], 2), null)
assertEqual('string -> null', normalizePendingQuestion('slot_question', 2), null)
assertEqual('wrong type -> null', normalizePendingQuestion({ ...pending(['budget']), type: 'lead_question' }, 2), null)
assertEqual('empty slots -> null', normalizePendingQuestion(pending([]), 2), null)
assertEqual('non-array slots -> null', normalizePendingQuestion({ ...pending(['budget']), slots: 'budget' }, 2), null)
assertEqual(
  'unknown slots filtered; all-unknown -> null',
  normalizePendingQuestion(pending(['beds', 'parking']), 2),
  null
)
assertEqual(
  'duplicate + unknown slots cleaned',
  normalizePendingQuestion(pending(['budget', 'budget', 'beds', 'listingType']), 2),
  pending(['budget', 'listingType'], 1, 0)
)
assertEqual(
  'malformed askedAtTurn normalized to 0',
  normalizePendingQuestion(pending(['budget'], 'three'), 2),
  pending(['budget'], 0, 0)
)
assertEqual(
  'malformed retryCount normalized to 0',
  normalizePendingQuestion(pending(['budget'], 1, -4), 2),
  pending(['budget'], 1, 0)
)
assertEqual(
  'extra properties removed',
  normalizePendingQuestion({ ...pending(['budget']), exploit: 'x', text: 'hi' }, 2),
  pending(['budget'], 1, 0)
)

{
  const raw = pending(['budget', 'beds'])
  normalizePendingQuestion(raw, 2)
  assertEqual('input not mutated', raw.slots, ['budget', 'beds'])
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. creation')
line()

assertEqual(
  'createPendingQuestion: correct shape, deduped, retry 0',
  createPendingQuestion(['listingType', 'listingType', 'budget'], 5),
  pending(['listingType', 'budget'], 5, 0)
)
assertEqual('createPendingQuestion: unknown slots only -> null', createPendingQuestion(['beds'], 5), null)
assertEqual('createPendingQuestion: empty -> null', createPendingQuestion([], 5), null)
assertEqual('createPendingQuestion: invalid turn -> 0', createPendingQuestion(['budget'], -1), pending(['budget'], 0, 0))

assertEqual(
  'createOrRetry: same slot set increments retry, refreshes askedAtTurn',
  createOrRetryPendingQuestion(pending(['budget'], 2, 0), ['budget'], 4),
  pending(['budget'], 4, 1)
)
assertEqual(
  'createOrRetry: same slots in different order still counts as retry',
  createOrRetryPendingQuestion(pending(['listingType', 'budget'], 2, 1), ['budget', 'listingType'], 4),
  pending(['budget', 'listingType'], 4, 2)
)
assertEqual(
  'createOrRetry: different slot set is fresh (retry 0)',
  createOrRetryPendingQuestion(pending(['budget'], 2, 1), ['district'], 4),
  pending(['district'], 4, 0)
)
assertEqual(
  'createOrRetry: no existing -> fresh',
  createOrRetryPendingQuestion(null, ['listingType'], 4),
  pending(['listingType'], 4, 0)
)
assertEqual(
  'createOrRetry: invalid new slots keeps existing',
  createOrRetryPendingQuestion(pending(['budget'], 2, 0), ['beds'], 4),
  pending(['budget'], 2, 0)
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. expiry')
line()

assertEqual(
  'active within limit survives',
  normalizePendingQuestion(pending(['budget'], 2), 2 + PENDING_QUESTION_MAX_AGE_TURNS),
  pending(['budget'], 2, 0)
)
assertEqual(
  'expired after limit -> null',
  normalizePendingQuestion(pending(['budget'], 2), 2 + PENDING_QUESTION_MAX_AGE_TURNS + 1),
  null
)
assertEqual('askedAtTurn in the future -> null (hostile)', normalizePendingQuestion(pending(['budget'], 99), 3), null)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. explicit values resolve pending slots')
line()

{
  // Values are already merged into state by the time resolution runs.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType']),
    state: emptyState({ listingType: 'Rent' }),
    message: 'Rent',
    parsedFromMessage: { intentType: 'property_followup', listingType: 'Rent' },
    newCriteriaCount: 1,
  })
  assertEqual('listingType value -> pending cleared', result.pendingQuestion, null)
  assertEqual('no status written for explicitly set slot', result.state.slotStatus, {})
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['propertyType']),
    state: emptyState({ propertyTypes: ['Apartment', 'Villa'] }),
    message: 'apartment or villa',
    parsedFromMessage: { intentType: 'property_followup' },
    newCriteriaCount: 1,
  })
  assertEqual('propertyTypes array counts as value', result.pendingQuestion, null)
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['district']),
    state: emptyState({ district: 'Esenyurt' }),
    message: 'Esenyurt',
    parsedFromMessage: { intentType: 'property_followup', district: 'Esenyurt' },
    newCriteriaCount: 1,
  })
  assertEqual('district value -> pending cleared', result.pendingQuestion, null)
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType', 'budget']),
    state: emptyState({ listingType: 'Rent', maxPrice: 25000 }),
    message: 'Rent, maximum 25,000',
    parsedFromMessage: { intentType: 'property_followup', listingType: 'Rent', maxPrice: 25000 },
    newCriteriaCount: 2,
  })
  assertEqual('both values -> pending fully cleared', result.pendingQuestion, null)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. targeted defer / decline')
line()

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType']),
    state: emptyState(),
    message: "I'm not sure yet.",
    parsedFromMessage: { intentType: 'property_followup' },
  })
  assertEqual('uncertainty + pending listingType -> deferred', deriveSlotStanding(result.state, 'listingType'), 'deferred')
  assertEqual('pending cleared', result.pendingQuestion, null)
  assertEqual('status turn stamped from state turn', result.state.slotStatus.listingType.turn, 4)
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['budget']),
    state: emptyState(),
    message: "I don't know my budget yet.",
    parsedFromMessage: { intentType: 'property_followup' },
  })
  assertEqual('uncertainty + pending budget -> deferred', deriveSlotStanding(result.state, 'budget'), 'deferred')
  assertEqual('pending cleared', result.pendingQuestion, null)
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['district']),
    state: emptyState(),
    message: 'Anywhere is fine.',
    parsedFromMessage: { intentType: 'property_followup' },
  })
  assertEqual('"Anywhere is fine" + pending district -> declined', deriveSlotStanding(result.state, 'district'), 'declined')
  assertEqual('pending cleared', result.pendingQuestion, null)
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['budget']),
    state: emptyState(),
    message: 'No preference.',
    parsedFromMessage: { intentType: 'property_followup', noPreference: true },
  })
  assertEqual(
    '"No preference" + pending budget -> declined (explicit no-preference means stop asking)',
    deriveSlotStanding(result.state, 'budget'),
    'declined'
  )
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['budget']),
    state: emptyState(),
    message: "not sure, honestly no preference",
    parsedFromMessage: { intentType: 'property_followup' },
  })
  assertEqual('decline beats defer when both signals present', deriveSlotStanding(result.state, 'budget'), 'declined')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F/G. partial and full resolution')
line()

{
  // "Rent, but I'm not sure about budget" — value + slot-scoped defer.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType', 'budget'], 3, 0),
    state: emptyState({ listingType: 'Rent' }),
    message: "Rent, but I'm not sure about budget",
    parsedFromMessage: { intentType: 'property_followup', listingType: 'Rent' },
    newCriteriaCount: 1,
  })
  assertEqual('listingType addressed by value', deriveSlotStanding(result.state, 'listingType'), 'filled')
  assertEqual('budget deferred (mentioned + uncertain)', deriveSlotStanding(result.state, 'budget'), 'deferred')
  assertEqual('pending fully cleared (both addressed)', result.pendingQuestion, null)
}

{
  // "Rent." — partial: budget stays pending, original askedAtTurn/retry kept.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType', 'budget'], 3, 1),
    state: emptyState({ listingType: 'Rent' }),
    message: 'Rent',
    parsedFromMessage: { intentType: 'property_followup', listingType: 'Rent' },
    newCriteriaCount: 1,
  })
  assertEqual('pending shrinks to budget only', result.pendingQuestion, pending(['budget'], 3, 1))
  assertEqual('budget has no status (still genuinely open)', deriveSlotStanding(result.state, 'budget'), 'empty')
}

{
  // Vague answer naming ONE pending slot scopes the signal to it.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType', 'budget'], 3, 0),
    state: emptyState(),
    message: "I don't know my budget",
    parsedFromMessage: { intentType: 'property_followup' },
  })
  assertEqual('budget deferred (named)', deriveSlotStanding(result.state, 'budget'), 'deferred')
  assertEqual('listingType untouched (not named)', deriveSlotStanding(result.state, 'listingType'), 'empty')
  assertEqual('pending shrinks to listingType', result.pendingQuestion, pending(['listingType'], 3, 0))
}

{
  // Vague answer naming nothing applies to all remaining pending slots.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['district', 'budget'], 3, 0),
    state: emptyState(),
    message: 'no preference at all',
    parsedFromMessage: { intentType: 'property_followup', noPreference: true },
  })
  assertEqual('district declined', deriveSlotStanding(result.state, 'district'), 'declined')
  assertEqual('budget declined', deriveSlotStanding(result.state, 'budget'), 'declined')
  assertEqual('pending cleared', result.pendingQuestion, null)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. explicit set beats vague negative language')
line()

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType']),
    state: emptyState({ listingType: 'Rent' }),
    message: 'No, I want to rent.',
    parsedFromMessage: { intentType: 'property_followup', listingType: 'Rent' },
    newCriteriaCount: 1,
  })
  assertEqual('value set, not declined/deferred', deriveSlotStanding(result.state, 'listingType'), 'filled')
  assertEqual('no status entry created', result.state.slotStatus, {})
  assertEqual('pending cleared', result.pendingQuestion, null)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('I. casual interruption survives')
line()

{
  const before = pending(['listingType'], 3, 1)
  const result = resolvePendingAnswer({
    pendingQuestion: before,
    state: emptyState(),
    message: 'How are you?',
    parsedFromMessage: { intentType: 'casual_chat', replyType: 'casual_reply' },
  })
  assertEqual('pending survives unchanged', result.pendingQuestion, before)
  assertEqual('no status writes', result.state.slotStatus, {})
  assertEqual('retryCount unchanged', result.pendingQuestion.retryCount, 1)
}

{
  const before = pending(['budget'])
  const result = resolvePendingAnswer({
    pendingQuestion: before,
    state: emptyState(),
    message: 'can you call me please',
    parsedFromMessage: { intentType: 'contact_request', replyType: 'contact_reply' },
  })
  assertEqual('contact request also preserves pending', result.pendingQuestion, before)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('J. abandonment on new direction')
line()

{
  // Pending listingType; user pivots to a district instead.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType']),
    state: emptyState({ district: 'Büyükçekmece', propertyType: 'Apartment' }),
    message: 'Actually show me Büyükçekmece',
    parsedFromMessage: { intentType: 'property_followup', district: 'Büyükçekmece' },
    newCriteriaCount: 1,
  })
  assertEqual('pending abandoned silently', result.pendingQuestion, null)
  assertEqual('no status written for the abandoned slot', result.state.slotStatus, {})
}

{
  // No new criteria, no signals, property intent — pending survives (NOT
  // classified as an unclear answer; retry accounting happens at re-ask).
  const before = pending(['listingType'], 3, 0)
  const result = resolvePendingAnswer({
    pendingQuestion: before,
    state: emptyState(),
    message: 'hmm okay',
    parsedFromMessage: { intentType: 'property_followup' },
    newCriteriaCount: 0,
  })
  assertEqual('uninterpretable message preserves pending', result.pendingQuestion, before)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('K. show more never becomes a pending answer')
line()

{
  const before = pending(['budget'])
  const result = resolvePendingAnswer({
    pendingQuestion: before,
    state: emptyState({ listingType: 'Sale', propertyType: 'Apartment' }),
    message: 'show me more',
    parsedFromMessage: { intentType: 'property_followup', listingType: 'Sale', propertyType: 'Apartment' },
    isShowMore: true,
    newCriteriaCount: 0,
  })
  assertEqual('pending survives show-more', result.pendingQuestion, before)
  assertEqual('no status writes on show-more', result.state.slotStatus, {})
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('L. no pending target -> vague phrases do nothing here')
line()

{
  const result = resolvePendingAnswer({
    pendingQuestion: null,
    state: emptyState(),
    message: 'not sure, anything is fine, whatever',
    parsedFromMessage: { intentType: 'property_followup', noPreference: true },
  })
  assertEqual('no pending -> state untouched', result.state.slotStatus, {})
  assertEqual('no pending -> stays null', result.pendingQuestion, null)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('M. fallback-parser mode (keyword parser output shapes)')
line()

{
  // Fallback parser always emits intentType property_search + noPreference
  // undefined; deterministic phrase helpers must still work.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType']),
    state: emptyState(),
    message: 'not sure',
    parsedFromMessage: { intentType: 'property_search', replyType: 'search' },
    newCriteriaCount: 0,
  })
  assertEqual('fallback: "not sure" defers pending listingType', deriveSlotStanding(result.state, 'listingType'), 'deferred')
}

{
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['budget']),
    state: emptyState(),
    message: 'no preference',
    parsedFromMessage: { intentType: 'property_search', replyType: 'search' },
    newCriteriaCount: 0,
  })
  assertEqual('fallback: "no preference" declines pending budget', deriveSlotStanding(result.state, 'budget'), 'declined')
}

{
  // Fallback keyword parser set Rent; value wins as an explicit set.
  const result = resolvePendingAnswer({
    pendingQuestion: pending(['listingType']),
    state: emptyState({ listingType: 'Rent' }),
    message: 'rent',
    parsedFromMessage: { intentType: 'property_search', replyType: 'search', listingType: 'Rent' },
    newCriteriaCount: 1,
  })
  assertEqual('fallback: keyword "rent" resolves as explicit set', result.pendingQuestion, null)
  assertEqual('fallback: filled, no status', deriveSlotStanding(result.state, 'listingType'), 'filled')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('N. hostile input + deriveGeminiQuestionSlots')
line()

assertEqual(
  'hostile pending sanitized at normalization',
  normalizePendingQuestion({ type: 'slot_question', slots: ['listingType', 'hacked'], askedAtTurn: { a: 1 }, retryCount: 'many' }, 2),
  pending(['listingType'], 0, 0)
)

assertEqual(
  'Gemini "buy or rent + budget" question maps to both slots',
  deriveGeminiQuestionSlots('Are you looking to buy or rent, and what is your budget?', emptyState()),
  ['listingType', 'budget']
)
assertEqual(
  'Gemini "district or budget" question maps to both slots',
  deriveGeminiQuestionSlots('Do you have a preferred district or budget?', emptyState()),
  ['district', 'budget']
)
assertEqual(
  'filled slots are excluded from derived targets',
  deriveGeminiQuestionSlots('Do you have a preferred district or budget?', emptyState({ maxPrice: 5000000 })),
  ['district']
)
assertEqual('unrecognized prose -> no slots (no pending created)', deriveGeminiQuestionSlots('What color do you like?', emptyState()), [])
assertEqual('empty/null question -> no slots', deriveGeminiQuestionSlots(null, emptyState()), [])

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('O. purity')
line()

{
  const state = emptyState()
  const before = pending(['listingType'], 3, 0)
  resolvePendingAnswer({
    pendingQuestion: before,
    state,
    message: 'not sure',
    parsedFromMessage: { intentType: 'property_followup' },
  })
  assertEqual('resolvePendingAnswer does not mutate state', state.slotStatus, {})
  assertEqual('resolvePendingAnswer does not mutate pending', before, pending(['listingType'], 3, 0))
}

{
  const existing = pending(['budget'], 2, 0)
  createOrRetryPendingQuestion(existing, ['budget'], 4)
  assertEqual('createOrRetry does not mutate existing', existing, pending(['budget'], 2, 0))
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
