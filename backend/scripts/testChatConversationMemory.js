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
// H2. Change A — a bare "and" conjunction no longer forces a lifestyle
// combine. Removing /\band\b/ from LIFESTYLE_COMBINE_PATTERNS lets a genuine
// new descriptive request take the SWITCH path (replace stale criteria)
// instead of the union path.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H2. bare "and" does not force combine (switch replaces stale criteria)')
line()

// Test A — a new descriptive request whose text contains "and" REPLACES the
// old family/schools lifestyle rather than accumulating it.
{
  const currentFilters = emptyParsed({
    descriptionQuery: 'family friendly home near schools',
    lifestyle: ['family-friendly', 'near schools'],
    turn: 1,
  })
  const { parsed } = resolveConversationState({
    message:
      'What about I need a music studio and a soundproof room. A sea view would be nice. Do you have a house like that?',
    currentFilters,
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      searchMode: 'hybrid',
      descriptionQuery: 'house with music studio soundproof room sea view',
      propertyType: 'Villa',
      mustHave: ['music studio', 'soundproof room'],
      niceToHave: ['sea view'],
      lifestyle: ['sea view'],
      requirements: ['music studio', 'soundproof room'],
    }),
  })

  assertEqual('Test A: lifestyle replaced, no stale family/schools', parsed.lifestyle, ['sea view'])
  assertEqual('Test A: mustHave = current request only', parsed.mustHave, ['music studio', 'soundproof room'])
  assertEqual('Test A: niceToHave = current request only', parsed.niceToHave, ['sea view'])
  assertEqual('Test A: requirements = current request only', parsed.requirements, ['music studio', 'soundproof room'])
  assertEqual('Test A: propertyType Villa carried forward', parsed.propertyType, 'Villa')
  assertTrue('Test A: no stale "family-friendly" anywhere in merged state', !JSON.stringify(parsed).includes('family-friendly'))
  assertTrue('Test A: no stale "near schools" anywhere in merged state', !JSON.stringify(parsed).includes('near schools'))
  assertTrue(
    'Test A: descriptionQuery does NOT concatenate old + new',
    !(parsed.descriptionQuery || '').includes('family friendly home near schools')
  )
}

// Test B — a hard-filter-only follow-up ("also make it a villa") PRESERVES the
// old lifestyle (slot-answer restore path), and adds the property type.
{
  const currentFilters = emptyParsed({
    lifestyle: ['family-friendly', 'near schools'],
    descriptionQuery: 'family friendly home near schools',
  })
  const { parsed } = resolveConversationState({
    message: 'Also make it a villa.',
    currentFilters,
    parsedFromMessage: emptyParsed({ propertyType: 'Villa' }),
  })

  assertEqual('Test B: old lifestyle preserved', parsed.lifestyle, ['family-friendly', 'near schools'])
  assertEqual('Test B: propertyType Villa added', parsed.propertyType, 'Villa')
}

// Test C — an explicit additive soft follow-up ("also, a sea view would be
// nice") still COMBINES old + new (proves "also" is untouched).
{
  const currentFilters = emptyParsed({
    lifestyle: ['family-friendly', 'near schools'],
    descriptionQuery: 'family friendly home near schools',
  })
  const { parsed } = resolveConversationState({
    message: 'Also, a sea view would be nice.',
    currentFilters,
    parsedFromMessage: emptyParsed({ lifestyle: ['sea view'], niceToHave: ['sea view'] }),
  })

  assertEqual(
    'Test C: old + new unioned (no duplicates)',
    parsed.lifestyle.slice().sort(),
    ['family-friendly', 'near schools', 'sea view'].sort()
  )
}

// Test D — the pre-existing explicit-combine case ("Also with sea view",
// section H above) still unions. Re-asserted here directly so the "and"
// removal is provably scoped to bare "and" only.
{
  const currentFilters = emptyParsed({ lifestyle: ['near schools'], descriptionQuery: 'near schools' })
  const { parsed } = resolveConversationState({
    message: 'Also with sea view',
    currentFilters,
    parsedFromMessage: emptyParsed({ lifestyle: ['sea view'], descriptionQuery: 'sea view apartment' }),
  })
  assertEqual('Test D: "also" still combines', parsed.lifestyle.slice().sort(), ['near schools', 'sea view'].sort())
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

// ═══════════════════════════════════════════════════════════════════════
// P. Phase 1 boundary: per-turn dialogue fields never survive from old state
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('P. Phase 1 boundary: per-turn dialogue fields never survive from old state')
line()
{
  // P1. Stale nextQuestion must die even when the new turn's value is null
  // (hasValue(null) is false — the exact mechanism of the production bug).
  const staleQuestion = resolveConversationState({
    message: 'I am not sure yet',
    currentFilters: emptyParsed({
      replyType: 'ask_question',
      nextQuestion: 'Are you looking to buy or rent?',
      listingType: 'Sale',
      propertyType: 'Apartment',
    }),
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      replyType: 'search',
      nextQuestion: null,
      listingType: 'Sale',
      propertyType: 'Apartment',
    }),
  }).parsed

  assertEqual('P1: old nextQuestion does not survive', staleQuestion.nextQuestion, null)
  assertEqual('P1: replyType comes from the current turn', staleQuestion.replyType, 'search')

  // P2/P3. Stale replyType and intentType must not override the current turn.
  const staleActs = resolveConversationState({
    message: 'show me apartments',
    currentFilters: emptyParsed({ intentType: 'casual_chat', replyType: 'casual_reply' }),
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      replyType: 'search',
      propertyType: 'Apartment',
    }),
  }).parsed

  assertEqual('P2: stale replyType removed', staleActs.replyType, 'search')
  assertEqual('P3: stale intentType removed', staleActs.intentType, 'property_followup')

  // P4. Clarification flags reset.
  const staleClarification = resolveConversationState({
    message: 'apartment',
    currentFilters: emptyParsed({
      needsClarification: true,
      clarifyingQuestion: 'old clarification text',
      listingType: 'Sale',
    }),
    parsedFromMessage: emptyParsed({ propertyType: 'Apartment' }),
  }).parsed

  assertEqual('P4: needsClarification reset', staleClarification.needsClarification, false)
  assertEqual('P4: clarifyingQuestion reset', staleClarification.clarifyingQuestion, null)

  // P5/P6. noPreference, changedMind, uncertainPropertyType are per-turn.
  const stalePerTurnFlags = resolveConversationState({
    message: 'what about Esenyurt',
    currentFilters: emptyParsed({
      listingType: 'Sale',
      propertyType: 'Apartment',
      noPreference: true,
      changedMind: true,
      uncertainPropertyType: true,
      excludedConcepts: ['sea_view'],
    }),
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: 'Esenyurt',
    }),
  }).parsed

  assertEqual('P5: stale noPreference expires', stalePerTurnFlags.noPreference, false)
  assertEqual('P6: stale changedMind expires', stalePerTurnFlags.changedMind, false)
  assertEqual('P6: stale uncertainPropertyType expires', stalePerTurnFlags.uncertainPropertyType, false)
  assertEqual('P6: stale excludedConcepts expire', stalePerTurnFlags.excludedConcepts, [])

  // P5b. Current-turn noPreference still comes through.
  const currentNoPreference = resolveConversationState({
    message: 'no preference',
    currentFilters: emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      noPreference: true,
    }),
  }).parsed

  assertEqual('P5b: current-turn noPreference is kept', currentNoPreference.noPreference, true)

  // P7. Durable criteria still merge: old criteria retained + new budget added.
  const durableMerge = resolveConversationState({
    message: 'my budget is 5000000',
    currentFilters: emptyParsed({
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
    }),
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', maxPrice: 5000000 }),
  }).parsed

  assertEqual('P7: old listingType retained', durableMerge.listingType, 'Sale')
  assertEqual('P7: old propertyType retained', durableMerge.propertyType, 'Apartment')
  assertEqual('P7: old district retained', durableMerge.district, 'Büyükçekmece')
  assertEqual('P7: new budget merged in', durableMerge.maxPrice, 5000000)

  // P8. Explicit current-turn change still wins.
  const explicitChange = resolveConversationState({
    message: 'actually I want to rent',
    currentFilters: emptyParsed({ listingType: 'Sale' }),
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('P8: new listingType wins', explicitChange.listingType, 'Rent')

  // P9. pendingLead and pendingClarification remain durable (ride the seed).
  const pendingLead = { status: 'collecting', name: 'Arqam', phone: null }
  const pendingClarification = { type: 'lifestyle_scope', unresolvedFields: ['district'], retryCount: 0 }
  const durableSpecials = resolveConversationState({
    message: 'apartment',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', nextQuestion: 'stale question' }),
      pendingLead,
      pendingClarification,
    },
    parsedFromMessage: emptyParsed({ propertyType: 'Apartment' }),
  }).parsed

  assertEqual('P9: pendingLead survives the merge', durableSpecials.pendingLead, pendingLead)
  assertEqual('P9: pendingClarification survives the merge', durableSpecials.pendingClarification, pendingClarification)
  assertEqual('P9: while stale nextQuestion still dies', durableSpecials.nextQuestion, null)

  // P10. Exact Büyükçekmece debug case (captured production values).
  const buyukcekmece = resolveConversationState({
    message: "I am not sure. I just want to see the apartments and later I'll decide whether buying or renting is better.",
    currentFilters: emptyParsed({
      intentType: 'property_search',
      replyType: 'ask_question',
      nextQuestion: 'Are you looking to buy or rent, and what is your budget?',
      listingType: null,
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
    }),
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      replyType: 'search',
      nextQuestion: null,
      listingType: null,
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
      uncertainPropertyType: true,
      noPreference: false,
    }),
  }).parsed

  assertEqual('P10: intentType = property_followup', buyukcekmece.intentType, 'property_followup')
  assertEqual('P10: replyType = search', buyukcekmece.replyType, 'search')
  assertEqual('P10: nextQuestion = null (old question gone)', buyukcekmece.nextQuestion, null)
  assertEqual('P10: propertyType = Apartment', buyukcekmece.propertyType, 'Apartment')
  assertEqual('P10: district = Büyükçekmece', buyukcekmece.district, 'Büyükçekmece')
  assertTrue(
    'P10: old question text appears nowhere in the resolved state',
    !JSON.stringify(buyukcekmece).includes('Are you looking to buy or rent, and what is your budget?')
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Q. Phase 2 shadow mode: slotStatus + turn round-trip through resolution
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Q. Phase 2 shadow mode: slotStatus + turn round-trip through resolution')
line()
{
  // Q1. Valid slotStatus round-trips; turn increments exactly once.
  const roundTrip = resolveConversationState({
    message: 'what about Esenyurt',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
      slotStatus: { budget: { status: 'declined', turn: 2 } },
      turn: 4,
    },
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: 'Esenyurt',
    }),
  }).parsed

  assertEqual('Q1: valid slotStatus round-trips', roundTrip.slotStatus, { budget: { status: 'declined', turn: 2 } })
  assertEqual('Q1: turn increments once (4 -> 5)', roundTrip.turn, 5)
  assertEqual('Q1: durable criteria still merge (district)', roundTrip.district, 'Esenyurt')
  assertEqual('Q1: durable criteria still merge (listingType)', roundTrip.listingType, 'Sale')

  // Q2. Invalid client slotStatus is sanitized; missing turn defaults then increments.
  const hostile = resolveConversationState({
    message: 'apartment',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale' }),
      slotStatus: {
        hacked: { status: 'deferred', turn: 1 },
        district: { status: 'DROP', turn: 1 },
        budget: 'declined',
      },
      turn: 'seven',
    },
    parsedFromMessage: emptyParsed({ propertyType: 'Apartment' }),
  }).parsed

  assertEqual('Q2: hostile slotStatus sanitized to {}', hostile.slotStatus, {})
  assertEqual('Q2: invalid turn defaults to 0 then increments to 1', hostile.turn, 1)

  // Q3. Stale status is removed when a durable value exists — including a
  // value set by THIS turn (value-wins runs post-merge).
  const valueWins = resolveConversationState({
    message: 'I want to rent',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      slotStatus: { listingType: { status: 'deferred', turn: 2 } },
      turn: 3,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('Q3: this-turn value deletes stale deferred status', valueWins.slotStatus, {})
  assertEqual('Q3: value applied normally', valueWins.listingType, 'Rent')

  // Q4. Shadow write from the captured Büyükçekmece message: listingType
  // deferred is recorded (slot valueless), values untouched.
  const shadowWrite = resolveConversationState({
    message: "I am not sure. I just want to see the apartments and later I'll decide whether buying or renting is better.",
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment', district: 'Büyükçekmece' }),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      replyType: 'search',
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
    }),
  }).parsed

  assertEqual('Q4: shadow deferred recorded for listingType', shadowWrite.slotStatus, {
    listingType: { status: 'deferred', turn: 3 },
  })
  assertEqual('Q4: listingType value untouched (still null)', shadowWrite.listingType, null)
  assertEqual('Q4: propertyType value untouched', shadowWrite.propertyType, 'Apartment')
  assertEqual('Q4: district value untouched', shadowWrite.district, 'Büyükçekmece')

  // Q4b. Shadow write is skipped when the slot has a value: "anywhere" while
  // a district is still remembered must not create a status (and must not
  // clear the value — shadow mode never touches values).
  const shadowSkip = resolveConversationState({
    message: 'anywhere is fine',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' }),
      turn: 3,
    },
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
    }),
  }).parsed

  assertEqual('Q4b: no status written while district value present', shadowSkip.slotStatus, {})
  assertEqual('Q4b: district value untouched', shadowSkip.district, 'Kadıköy')

  // Q4c. "any district" with no remembered district -> declined recorded.
  const shadowDecline = resolveConversationState({
    message: 'any district is fine, show me what you have',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
      turn: 3,
    },
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      noPreference: true,
    }),
  }).parsed

  assertEqual('Q4c: district declined recorded', shadowDecline.slotStatus, {
    district: { status: 'declined', turn: 4 },
  })

  // Q5. Per-turn fields remain clean (Phase 1 boundary intact alongside Phase 2).
  const perTurnClean = resolveConversationState({
    message: 'apartment',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', nextQuestion: 'stale question', noPreference: true }),
      slotStatus: { budget: { status: 'deferred', turn: 1 } },
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ propertyType: 'Apartment' }),
  }).parsed

  assertEqual('Q5: stale nextQuestion still dies', perTurnClean.nextQuestion, null)
  assertEqual('Q5: stale noPreference still expires', perTurnClean.noPreference, false)
  assertEqual('Q5: slotStatus round-trips alongside', perTurnClean.slotStatus, { budget: { status: 'deferred', turn: 1 } })

  // Q6. pendingLead / pendingClarification unaffected by Phase 2 fields.
  const pendingLead = { status: 'collecting', name: 'Arqam' }
  const pendingClarification = { type: 'lifestyle_scope', retryCount: 0 }
  const specials = resolveConversationState({
    message: 'apartment',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale' }),
      pendingLead,
      pendingClarification,
      slotStatus: { budget: { status: 'declined', turn: 1 } },
      turn: 6,
    },
    parsedFromMessage: emptyParsed({ propertyType: 'Apartment' }),
  }).parsed

  assertEqual('Q6: pendingLead survives with slotStatus present', specials.pendingLead, pendingLead)
  assertEqual('Q6: pendingClarification survives with slotStatus present', specials.pendingClarification, pendingClarification)
  assertEqual('Q6: slotStatus survives alongside specials', specials.slotStatus, { budget: { status: 'declined', turn: 1 } })

  // Q7. No user-visible routing values change because of slotStatus: the
  // resolved criteria are identical with and without a slotStatus present.
  const withoutStatus = resolveConversationState({
    message: 'show me more',
    currentFilters: emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Sale', propertyType: 'Apartment' }),
  }).parsed

  const withStatus = resolveConversationState({
    message: 'show me more',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
      slotStatus: { budget: { status: 'declined', turn: 1 }, district: { status: 'deferred', turn: 2 } },
      turn: 3,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Sale', propertyType: 'Apartment' }),
  }).parsed

  const stripPhase2 = ({ slotStatus, turn, ...rest }) => rest
  assertEqual(
    'Q7: resolved state identical apart from the shadow fields themselves',
    stripPhase2(withStatus),
    stripPhase2(withoutStatus)
  )
}

// ═══════════════════════════════════════════════════════════════════════
// R. Phase 3: pendingQuestion resolution inside resolveConversationState
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('R. Phase 3: pendingQuestion resolution inside resolveConversationState')
line()
{
  const slotPending = (slots, askedAtTurn = 2, retryCount = 0) => ({
    type: 'slot_question',
    slots,
    askedAtTurn,
    retryCount,
  })

  // R1. Büyükçekmece with the pending question anchored: listingType deferred,
  // budget stays pending, criteria retained.
  const buyukcekmece = resolveConversationState({
    message: "I am not sure. I just want to see the apartments and decide later whether buying or renting is better.",
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment', district: 'Büyükçekmece' }),
      pendingQuestion: slotPending(['listingType', 'budget']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      replyType: 'search',
      propertyType: 'Apartment',
      district: 'Büyükçekmece',
      uncertainPropertyType: true,
    }),
  }).parsed

  assertEqual('R1: listingType deferred', buyukcekmece.slotStatus.listingType, { status: 'deferred', turn: 3 })
  assertEqual('R1: budget untargeted -> no status', buyukcekmece.slotStatus.budget, undefined)
  assertEqual('R1: pending partially resolved to budget', buyukcekmece.pendingQuestion, slotPending(['budget']))
  assertEqual('R1: propertyType retained', buyukcekmece.propertyType, 'Apartment')
  assertEqual('R1: district retained', buyukcekmece.district, 'Büyükçekmece')
  assertEqual('R1: listingType value untouched (null)', buyukcekmece.listingType, null)

  // R2. "Rent, but I don't know my budget."
  const rentNoBudget = resolveConversationState({
    message: "Rent, but I don't know my budget.",
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['listingType', 'budget']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('R2: listingType filled', rentNoBudget.listingType, 'Rent')
  assertEqual('R2: budget deferred', rentNoBudget.slotStatus.budget, { status: 'deferred', turn: 3 })
  assertEqual('R2: pending fully cleared', rentNoBudget.pendingQuestion, null)

  // R3. "Rent." — partial resolution, budget stays pending.
  const rentOnly = resolveConversationState({
    message: 'Rent.',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['listingType', 'budget']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('R3: pending shrinks to budget', rentOnly.pendingQuestion, slotPending(['budget']))
  assertEqual('R3: budget stays statusless', rentOnly.slotStatus.budget, undefined)

  // R4. "No, I want to rent." — explicit value beats the vague "No".
  const noIWantRent = resolveConversationState({
    message: 'No, I want to rent.',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['listingType']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('R4: listingType set to Rent', noIWantRent.listingType, 'Rent')
  assertEqual('R4: no decline/defer status', noIWantRent.slotStatus, {})
  assertEqual('R4: pending cleared', noIWantRent.pendingQuestion, null)

  // R5. "Anywhere is fine." with pending district -> declined, no double
  // write from the shadow signal (precedence guard).
  const anywhere = resolveConversationState({
    message: 'Anywhere is fine.',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['district']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({
      intentType: 'property_followup',
      listingType: 'Sale',
      propertyType: 'Apartment',
      noPreference: true,
    }),
  }).parsed

  assertEqual('R5: district declined', anywhere.slotStatus.district, { status: 'declined', turn: 3 })
  assertEqual('R5: pending cleared', anywhere.pendingQuestion, null)

  // R6. Casual interruption preserves pending, writes nothing.
  const casual = resolveConversationState({
    message: 'How are you?',
    currentFilters: {
      ...emptyParsed({ listingType: 'Sale', propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['district'], 2, 1),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'casual_chat', replyType: 'casual_reply' }),
  }).parsed

  assertEqual('R6: pending survives casual turn unchanged', casual.pendingQuestion, slotPending(['district'], 2, 1))
  assertEqual('R6: no status writes', casual.slotStatus, {})

  // R7. "Actually show Esenyurt." — new direction abandons pending listingType.
  const newDirection = resolveConversationState({
    message: 'Actually show Esenyurt.',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['listingType']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', district: 'Esenyurt' }),
  }).parsed

  assertEqual('R7: pending abandoned', newDirection.pendingQuestion, null)
  assertEqual('R7: district applied', newDirection.district, 'Esenyurt')
  assertEqual('R7: no status written for abandoned slot', newDirection.slotStatus, {})

  // R8. Fallback-parser equivalent (Gemini down): keyword-parser shape still
  // resolves the pending answer deterministically.
  const fallback = resolveConversationState({
    message: 'not sure',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment', district: 'Büyükçekmece' }),
      pendingQuestion: slotPending(['listingType']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_search', replyType: 'search' }),
  }).parsed

  assertEqual('R8: fallback "not sure" defers pending listingType', fallback.slotStatus.listingType, {
    status: 'deferred',
    turn: 3,
  })
  assertEqual('R8: pending cleared', fallback.pendingQuestion, null)

  // R9/R10. pendingLead and pendingClarification ride along untouched.
  const pendingLead = { status: 'collecting', name: 'Arqam' }
  const pendingClarification = { type: 'lifestyle_scope', retryCount: 0 }
  const specials = resolveConversationState({
    message: 'Rent.',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      pendingQuestion: slotPending(['listingType']),
      pendingLead,
      pendingClarification,
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('R9: pendingLead unaffected', specials.pendingLead, pendingLead)
  assertEqual('R10: pendingClarification unaffected', specials.pendingClarification, pendingClarification)
  assertEqual('R9/10: pendingQuestion still resolved alongside', specials.pendingQuestion, null)

  // R11. Stale nextQuestion remains impossible with pendingQuestion around.
  const staleNext = resolveConversationState({
    message: 'Rent.',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment', nextQuestion: 'Are you looking to buy or rent, and what is your budget?' }),
      pendingQuestion: slotPending(['listingType']),
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent', nextQuestion: null }),
  }).parsed

  assertEqual('R11: stale nextQuestion still dies', staleNext.nextQuestion, null)

  // R12. Turn increments exactly once with pending present.
  assertEqual('R12: turn incremented once (2 -> 3)', staleNext.turn, 3)

  // R13. Hostile pendingQuestion sanitized to null.
  const hostile = resolveConversationState({
    message: 'Rent.',
    currentFilters: {
      ...emptyParsed({ propertyType: 'Apartment' }),
      pendingQuestion: { type: 'slot_question', slots: ['hacked'], askedAtTurn: 99, retryCount: 'x' },
      turn: 2,
    },
    parsedFromMessage: emptyParsed({ intentType: 'property_followup', listingType: 'Rent' }),
  }).parsed

  assertEqual('R13: hostile pendingQuestion -> null', hostile.pendingQuestion, null)
}

line()
console.log('R14: districtScopeAction per-turn discipline')
line()
{
  // A stale 'broaden' round-tripped in currentFilters must never survive: the
  // current turn's value wins, and an absent current value collapses to 'unclear'.
  const staleToUnclear = resolveConversationState({
    message: 'what is the price',
    currentFilters: { districtScopeAction: 'broaden', turn: 2 },
    parsedFromMessage: emptyParsed({ districtScopeAction: 'unclear' }),
  }).parsed
  assertEqual('R14a: stale broaden + current unclear -> unclear', staleToUnclear.districtScopeAction, 'unclear')

  const currentWins = resolveConversationState({
    message: 'aynı bölgede devam edelim',
    currentFilters: { districtScopeAction: 'broaden', turn: 2 },
    parsedFromMessage: emptyParsed({ districtScopeAction: 'keep' }),
  }).parsed
  assertEqual('R14b: current-turn keep wins over stale broaden', currentWins.districtScopeAction, 'keep')

  const absentCurrent = resolveConversationState({
    message: 'show me more',
    currentFilters: { districtScopeAction: 'broaden', turn: 2 },
    parsedFromMessage: emptyParsed({}),
  }).parsed
  assertEqual('R14c: stale broaden + absent current -> unclear', absentCurrent.districtScopeAction, 'unclear')
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
