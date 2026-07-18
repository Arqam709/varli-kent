// backend/scripts/testChatConversationMemory.js
//
// Focused, fully deterministic unit tests for services/chatConversationMemory.js
// — no DB connection, no Gemini call, no network. Fixed inputs, exact
// equality throughout.
//
// Most of the interesting behavior lives inside resolveConversationState(),
// which wraps the private, unexported decision tree (mergeParsedWithContext,
// concept switch/combine, slot-answer detection, etc.) — so most scenarios
// below exercise it end-to-end with fixed {message, currentFilters,
// parsedFromMessage} inputs and assert the resulting `parsed` fields. The
// five directly-exported helpers (messageHasNewCriteria,
// countNewStructuredCriteria, isShowMoreRequest, hasExplicitContinuityPhrase,
// normalizeWord) are also tested directly, since chat.js calls them directly
// too.
//
// Usage: node scripts/testChatConversationMemory.js

import {
  messageHasNewCriteria,
  countNewStructuredCriteria,
  isShowMoreRequest,
  hasExplicitContinuityPhrase,
  normalizeWord,
  resolveConversationState,
} from '../services/chatConversationMemory.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const deepEqual = (a, b) => {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => deepEqual(a[key], b[key]))
}

const assertEqual = (label, actual, expected) => {
  const pass = deepEqual(actual, expected)
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

// Minimal defaultParsed-shaped fixture — mirrors chatMessageParsing.js's
// defaultParsed shape closely enough for these tests (only the fields these
// scenarios touch need to be present).
const emptyParsed = (overrides = {}) => ({
  intent: 'property_search',
  intentType: 'property_search',
  replyType: 'search',
  nextQuestion: null,
  searchMode: 'field',
  descriptionQuery: null,
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
  mustHave: [],
  niceToHave: [],
  lifestyle: [],
  requirements: [],
  needsClarification: false,
  clarifyingQuestion: null,
  ...overrides,
})

// ═══════════════════════════════════════════════════════════════════════
// Directly-exported helpers
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Directly-exported helpers')
line()

assertTrue(
  'messageHasNewCriteria: true when a structured field is set',
  messageHasNewCriteria(emptyParsed({ listingType: 'Sale' }))
)
assertTrue(
  'messageHasNewCriteria: true for non-empty array criteria (districts)',
  messageHasNewCriteria(emptyParsed({ districts: ['Kadıköy', 'Beşiktaş'] }))
)
assertTrue('messageHasNewCriteria: false for an all-empty parsed object', !messageHasNewCriteria(emptyParsed()))

assertEqual(
  'countNewStructuredCriteria: counts only fields that differ from currentFilters',
  countNewStructuredCriteria(emptyParsed({ listingType: 'Sale', district: 'Kadıköy' }), emptyParsed({ listingType: 'Sale' })),
  1
)
assertEqual(
  'countNewStructuredCriteria: zero when nothing differs',
  countNewStructuredCriteria(emptyParsed({ listingType: 'Sale' }), emptyParsed({ listingType: 'Sale' })),
  0
)
assertEqual(
  'countNewStructuredCriteria: districts array counted as +1 when it genuinely differs',
  countNewStructuredCriteria(emptyParsed({ districts: ['Kadıköy'] }), emptyParsed({ districts: ['Beşiktaş'] })),
  1
)

assertTrue('isShowMoreRequest: "show me more" matches', isShowMoreRequest('show me more'))
assertTrue('isShowMoreRequest: "next" matches', isShowMoreRequest('next'))
assertTrue('isShowMoreRequest: unrelated text does not match', !isShowMoreRequest('a nice villa'))

assertTrue('hasExplicitContinuityPhrase: "same district" matches', hasExplicitContinuityPhrase('rent in the same district'))
assertTrue('hasExplicitContinuityPhrase: "there" matches', hasExplicitContinuityPhrase('rent there instead'))
assertTrue('hasExplicitContinuityPhrase: unrelated text does not match', !hasExplicitContinuityPhrase('a nice villa'))

assertEqual('normalizeWord: lowercases and strips punctuation', normalizeWord('Schools!'), 'schools')
assertEqual('normalizeWord: preserves accented letters', normalizeWord('Kadıköy'), 'kadıköy')

// ═══════════════════════════════════════════════════════════════════════
// A. Fresh search
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. Fresh search')
line()
{
  const { parsed } = resolveConversationState({
    message: 'Show me apartments for sale in Kadıköy',
    currentFilters: {},
    parsedFromMessage: emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' }),
  })
  assertEqual('listingType set from fresh search', parsed.listingType, 'Sale')
  assertEqual('propertyType set from fresh search', parsed.propertyType, 'Apartment')
  assertEqual('district set from fresh search', parsed.district, 'Kadıköy')
  assertEqual('lifestyle stays empty (nothing requested)', parsed.lifestyle, [])
}

// ═══════════════════════════════════════════════════════════════════════
// B. Continuation
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. Continuation')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' })
  const { parsed } = resolveConversationState({
    message: 'under 5 million',
    currentFilters,
    parsedFromMessage: emptyParsed({ maxPrice: 5000000 }),
  })
  assertEqual('listingType carried forward from memory', parsed.listingType, 'Sale')
  assertEqual('propertyType carried forward from memory', parsed.propertyType, 'Apartment')
  assertEqual('district carried forward from memory', parsed.district, 'Kadıköy')
  assertEqual('new maxPrice applied', parsed.maxPrice, 5000000)
}

// ═══════════════════════════════════════════════════════════════════════
// C. Show more
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. Show more')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' })
  const { parsed } = resolveConversationState({
    message: 'show me more',
    currentFilters,
    parsedFromMessage: emptyParsed(),
  })
  assertEqual('"show me more" leaves listingType untouched', parsed.listingType, 'Sale')
  assertEqual('"show me more" leaves propertyType untouched', parsed.propertyType, 'Apartment')
  assertEqual('"show me more" leaves district untouched', parsed.district, 'Kadıköy')
}

// ═══════════════════════════════════════════════════════════════════════
// D. Listing-type switch
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. Listing-type switch')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' })

  const { parsed: switched } = resolveConversationState({
    message: 'Actually I want to rent',
    currentFilters,
    parsedFromMessage: emptyParsed({ listingType: 'Rent' }),
  })
  assertEqual('listingType flips to Rent', switched.listingType, 'Rent')
  assertEqual('district reset (no continuity phrase)', switched.district, null)
  assertEqual('propertyType reset (no continuity phrase)', switched.propertyType, null)

  const { parsed: continuity } = resolveConversationState({
    message: 'Actually I want to rent in the same district',
    currentFilters,
    parsedFromMessage: emptyParsed({ listingType: 'Rent' }),
  })
  assertEqual('listingType flips to Rent (continuity variant)', continuity.listingType, 'Rent')
  assertEqual('district retained ("same district" continuity phrase)', continuity.district, 'Kadıköy')
}

// ═══════════════════════════════════════════════════════════════════════
// E. Property-type switch (restating propertyType prevents the district reset)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. Property-type switch')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' })
  const { parsed } = resolveConversationState({
    message: 'Actually I want to rent a villa',
    currentFilters,
    parsedFromMessage: emptyParsed({ listingType: 'Rent', propertyType: 'Villa' }),
  })
  assertEqual('listingType flips to Rent', parsed.listingType, 'Rent')
  assertEqual('propertyType updates to Villa', parsed.propertyType, 'Villa')
  assertEqual(
    'district retained — restating propertyType counts as "repeats old criteria", preventing the reset',
    parsed.district,
    'Kadıköy'
  )
}

// ═══════════════════════════════════════════════════════════════════════
// F. District change
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. District change')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' })
  const { parsed } = resolveConversationState({
    message: 'what about Beşiktaş',
    currentFilters,
    parsedFromMessage: emptyParsed({ district: 'Beşiktaş' }),
  })
  assertEqual('district updates to the new value', parsed.district, 'Beşiktaş')
  assertEqual('listingType carried forward', parsed.listingType, 'Sale')
  assertEqual('propertyType carried forward', parsed.propertyType, 'Apartment')
}

// ═══════════════════════════════════════════════════════════════════════
// G. Lifestyle concept switch
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. Lifestyle concept switch')
line()
{
  const currentFilters = emptyParsed({
    lifestyle: ['near schools'],
    descriptionQuery: 'near schools',
    searchMode: 'description',
  })
  // parsedFromMessage.lifestyle deliberately empty, so the merge alone would
  // carry the OLD lifestyle forward — isolating the concept-switch drop
  // logic itself, which detects the new concept from the raw message text.
  const { parsed } = resolveConversationState({
    message: 'What about sea view apartments?',
    currentFilters,
    parsedFromMessage: emptyParsed({ propertyType: 'Apartment', lifestyle: [] }),
  })
  assertEqual('old "near schools" concept dropped from lifestyle', parsed.lifestyle, [])
  assertEqual('descriptionQuery cleared so it can regenerate', parsed.descriptionQuery, null)
}

// ═══════════════════════════════════════════════════════════════════════
// H. Lifestyle concept combine
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. Lifestyle concept combine')
line()
{
  const currentFilters = emptyParsed({
    lifestyle: ['near schools'],
    descriptionQuery: 'near schools',
  })
  const { parsed } = resolveConversationState({
    message: 'Also with sea view',
    currentFilters,
    parsedFromMessage: emptyParsed({ lifestyle: ['sea view'], descriptionQuery: 'sea view apartment' }),
  })
  assertEqual(
    'lifestyle arrays are unioned, not replaced',
    parsed.lifestyle.slice().sort(),
    ['near schools', 'sea view'].sort()
  )
  assertEqual(
    'descriptionQuery concatenates old + new',
    parsed.descriptionQuery,
    'near schools sea view apartment'
  )
}

// ═══════════════════════════════════════════════════════════════════════
// I. Slot-answer continuation (restores pending lifestyle from memory)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('I. Slot-answer continuation')
line()
{
  const currentFilters = emptyParsed({
    lifestyle: ['near schools'],
    descriptionQuery: 'near schools',
    searchMode: 'description',
  })
  const { parsed } = resolveConversationState({
    message: 'buy',
    currentFilters,
    parsedFromMessage: emptyParsed({ listingType: 'Sale', lifestyle: [] }),
  })
  assertEqual('listingType applied from the slot answer', parsed.listingType, 'Sale')
  assertEqual('pending lifestyle fully restored from memory', parsed.lifestyle, ['near schools'])
  assertEqual('pending descriptionQuery restored from memory', parsed.descriptionQuery, 'near schools')
}

// ═══════════════════════════════════════════════════════════════════════
// J. No-preference answer
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('J. No-preference answer')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Rent', propertyType: 'Apartment', district: 'Kadıköy' })
  const { parsed } = resolveConversationState({
    message: 'no preference, show me what you have',
    currentFilters,
    parsedFromMessage: emptyParsed(),
  })
  assertEqual('district untouched by a no-preference answer (no lifestyle memory to restore either)', parsed.district, 'Kadıköy')
  assertEqual('listingType untouched', parsed.listingType, 'Rent')
}

// ═══════════════════════════════════════════════════════════════════════
// K. Feature continuation
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('K. Feature continuation')
line()
{
  const currentFilters = emptyParsed({ furnished: true, balcony: true })

  const { parsed: keptFeatures } = resolveConversationState({
    message: 'a home near a school, keep the same requirements',
    currentFilters,
    parsedFromMessage: emptyParsed({ descriptionQuery: 'home near school', lifestyle: ['near school'] }),
  })
  assertEqual('features preserved when the message asks to keep them', keptFeatures.furnished, true)
  assertEqual('features preserved when the message asks to keep them (balcony)', keptFeatures.balcony, true)

  const { parsed: resetFeatures } = resolveConversationState({
    message: 'a home near a school',
    currentFilters,
    parsedFromMessage: emptyParsed({ descriptionQuery: 'home near school', lifestyle: ['near school'] }),
  })
  assertEqual('features reset on a fresh lifestyle message with no continuity phrase', resetFeatures.furnished, null)
  assertEqual('features reset on a fresh lifestyle message with no continuity phrase (balcony)', resetFeatures.balcony, null)
}

// ═══════════════════════════════════════════════════════════════════════
// L. Fresh structured search clears stale lifestyle memory
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('L. Fresh structured search clears stale lifestyle memory')
line()
{
  const currentFilters = emptyParsed({ lifestyle: ['near schools'], descriptionQuery: 'near schools' })
  const { parsed } = resolveConversationState({
    message: 'Show me apartments in Büyükçekmece for rent',
    currentFilters,
    parsedFromMessage: emptyParsed({ listingType: 'Rent', propertyType: 'Apartment', district: 'Büyükçekmece', lifestyle: [] }),
  })
  assertEqual('new structured fields applied', parsed.district, 'Büyükçekmece')
  assertEqual('stale lifestyle cleared (not silently carried forward)', parsed.lifestyle, [])
  assertEqual('stale descriptionQuery cleared', parsed.descriptionQuery, null)
}

// ═══════════════════════════════════════════════════════════════════════
// M. Criteria merge (old fields survive when the new message doesn't restate them)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('M. Criteria merge')
line()
{
  const currentFilters = emptyParsed({ listingType: 'Sale', maxPrice: 5000000, mustHave: ['pool'] })
  const { parsed } = resolveConversationState({
    message: 'also want 3 bedrooms',
    currentFilters,
    parsedFromMessage: emptyParsed({ beds: 3 }),
  })
  assertEqual('listingType carried forward', parsed.listingType, 'Sale')
  assertEqual('maxPrice carried forward', parsed.maxPrice, 5000000)
  assertEqual('mustHave carried forward', parsed.mustHave, ['pool'])
  assertEqual('new beds field applied', parsed.beds, 3)
}

// ═══════════════════════════════════════════════════════════════════════
// N. Reset behaviour (fresh description search wipes ALL structured fields)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('N. Reset behaviour')
line()
{
  const currentFilters = emptyParsed({
    listingType: 'Sale',
    propertyType: 'Villa',
    district: 'Kadıköy',
    minPrice: 1000000,
    maxPrice: 5000000,
    beds: 3,
    furnished: true,
  })
  const { parsed } = resolveConversationState({
    message: 'I want a peaceful home for my family',
    currentFilters,
    parsedFromMessage: emptyParsed({ searchMode: 'description', descriptionQuery: 'peaceful family home' }),
  })
  assertEqual('listingType wiped', parsed.listingType, null)
  assertEqual('propertyType wiped', parsed.propertyType, null)
  assertEqual('district wiped', parsed.district, null)
  assertEqual('minPrice wiped', parsed.minPrice, null)
  assertEqual('maxPrice wiped', parsed.maxPrice, null)
  assertEqual('beds wiped', parsed.beds, null)
  assertEqual('furnished wiped', parsed.furnished, null)
}

// ═══════════════════════════════════════════════════════════════════════
// O. Conversation state returned by resolveConversationState()
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('O. Conversation state returned by resolveConversationState()')
line()
{
  const result = resolveConversationState({
    message: 'Show me apartments for sale in Kadıköy',
    currentFilters: {},
    parsedFromMessage: emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' }),
  })
  assertEqual('return shape has exactly {parsed, newLifestyleConceptsInMessage}', Object.keys(result).sort(), ['newLifestyleConceptsInMessage', 'parsed'].sort())
  assertTrue('parsed is a plain object', typeof result.parsed === 'object' && result.parsed !== null && !Array.isArray(result.parsed))
  assertTrue('newLifestyleConceptsInMessage is a Set', result.newLifestyleConceptsInMessage instanceof Set)
  assertEqual('newLifestyleConceptsInMessage is empty for a non-lifestyle message', result.newLifestyleConceptsInMessage.size, 0)

  const lifestyleResult = resolveConversationState({
    message: 'a home near a school',
    currentFilters: {},
    parsedFromMessage: emptyParsed({ descriptionQuery: 'home near school', lifestyle: ['near school'] }),
  })
  assertEqual(
    'newLifestyleConceptsInMessage reflects concepts detected in the raw message',
    Array.from(lifestyleResult.newLifestyleConceptsInMessage),
    ['school']
  )
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
