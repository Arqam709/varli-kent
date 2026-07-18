// backend/scripts/testChatDistrictScope.js
//
// Focused, fully deterministic unit tests for services/chatDistrictScope.js
// — no DB connection, no Gemini call, no network. Fixed inputs, exact
// equality throughout.
//
// Every expected value below was harvested by running the actual extracted
// functions against these exact fixed inputs first, then checked against
// the implementation's own logic before being pinned here — see the stage-6
// extraction report for two subtleties this process caught: (1)
// "keep it in Beylikdüzü" actually resolves to 'replace', not 'keep',
// because resolveDistrictScopeAnswer checks for a named district FIRST; (2)
// "broaden the search" resolves to 'unclear', since DISTRICT_BROADEN_PATTERNS
// has no pattern matching the bare word "broaden".
//
// Usage: node scripts/testChatDistrictScope.js

import {
  resolveDistrictScopeAnswer,
  extractConceptIds,
  buildDistrictScopeQuestion,
  buildDistrictScopeRetryQuestion,
  handleDistrictScopeClarification,
} from '../services/chatDistrictScope.js'

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

// ═══════════════════════════════════════════════════════════════════════
// A. resolveDistrictScopeAnswer — keep
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. resolveDistrictScopeAnswer — keep')
line()

assertEqual('"same district"', resolveDistrictScopeAnswer('same district'), 'keep')
assertEqual('"same area"', resolveDistrictScopeAnswer('same area'), 'keep')
assertEqual('"stay there"', resolveDistrictScopeAnswer('stay there'), 'keep')
assertEqual('"keep it"', resolveDistrictScopeAnswer('keep it'), 'keep')
assertEqual('"yes"', resolveDistrictScopeAnswer('yes'), 'keep')
assertEqual('explicit continuity phrase "still in the same location"', resolveDistrictScopeAnswer('still in the same location'), 'keep')
assertEqual(
  '"keep it in Beylikdüzü" resolves to "replace" (names a district — checked BEFORE the keep patterns)',
  resolveDistrictScopeAnswer('keep it in Beylikdüzü'),
  'replace'
)

// ═══════════════════════════════════════════════════════════════════════
// B. resolveDistrictScopeAnswer — broaden
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. resolveDistrictScopeAnswer — broaden')
line()

assertEqual('"other districts please"', resolveDistrictScopeAnswer('other districts please'), 'broaden')
assertEqual('"anywhere is fine"', resolveDistrictScopeAnswer('anywhere is fine'), 'broaden')
assertEqual('"search all districts"', resolveDistrictScopeAnswer('search all districts'), 'broaden')
assertEqual('"everywhere works"', resolveDistrictScopeAnswer('everywhere works'), 'broaden')
assertEqual('"any district is fine"', resolveDistrictScopeAnswer('any district is fine'), 'broaden')
assertEqual(
  '"broaden the search" resolves to "unclear" (no DISTRICT_BROADEN_PATTERNS entry matches the bare word "broaden")',
  resolveDistrictScopeAnswer('broaden the search'),
  'unclear'
)
assertEqual(
  '"outside Beylikdüzü" resolves to "replace" (names a district)',
  resolveDistrictScopeAnswer('outside Beylikdüzü'),
  'replace'
)

// ═══════════════════════════════════════════════════════════════════════
// C. resolveDistrictScopeAnswer — unclear
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. resolveDistrictScopeAnswer — unclear')
line()

assertEqual('"maybe"', resolveDistrictScopeAnswer('maybe'), 'unclear')
assertEqual('"show me something nice"', resolveDistrictScopeAnswer('show me something nice'), 'unclear')
assertEqual('"I don\'t know"', resolveDistrictScopeAnswer("I don't know"), 'unclear')

// ═══════════════════════════════════════════════════════════════════════
// D. Concept extraction
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. Concept extraction')
line()

assertEqual(
  'school phrase (also picks up "children" -> family concept)',
  extractConceptIds('near schools for my children'),
  ['school', 'family']
)
assertEqual('sea-view phrase', extractConceptIds('a home with a sea view'), ['sea_view'])
assertEqual(
  'multiple concepts',
  extractConceptIds('near schools with a sea view, peaceful area'),
  ['school', 'sea_view', 'peaceful_safe']
)
assertEqual('unknown phrase -> empty', extractConceptIds('modern kitchen and spacious layout'), [])
assertEqual(
  'duplicate concept words produce unique ids',
  extractConceptIds('sea view sea view seaside'),
  ['sea_view']
)

// ═══════════════════════════════════════════════════════════════════════
// E. Question wording
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. Question wording')
line()

assertEqual(
  'one district',
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, ['school']),
  'Should I keep searching in Kadıköy, or include other districts with school apartments?'
)
assertEqual(
  'multiple districts',
  buildDistrictScopeQuestion({ districts: ['Kadıköy', 'Beşiktaş'], propertyType: 'Apartment' }, ['school']),
  'Should I keep searching in Kadıköy or Beşiktaş, or include other districts with school apartments?'
)
assertEqual(
  'no district (existing behavior: literal "null" in the sentence)',
  buildDistrictScopeQuestion({ propertyType: 'Apartment' }, ['school']),
  'Should I keep searching in null, or include other districts with school apartments?'
)
assertEqual(
  'one property type',
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Villa' }, ['sea_view']),
  'Should I keep searching in Kadıköy, or include other districts with sea-view villas?'
)
assertEqual(
  'multiple property types',
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyTypes: ['Apartment', 'Villa'] }, ['sea_view']),
  'Should I keep searching in Kadıköy, or include other districts with sea-view apartments and villas?'
)
assertEqual(
  'no property type at all falls back to "properties"',
  buildDistrictScopeQuestion({ district: 'Kadıköy' }, ['school']),
  'Should I keep searching in Kadıköy, or include other districts with school properties?'
)
assertEqual(
  'multiple lifestyle concept labels joined with "and"',
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, ['school', 'sea_view']),
  'Should I keep searching in Kadıköy, or include other districts with school and sea-view apartments?'
)
assertEqual(
  'fallback wording ("that") when concept ids are empty',
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, []),
  'Should I keep searching in Kadıköy, or include other districts with that apartments?'
)

// ═══════════════════════════════════════════════════════════════════════
// F. Retry wording
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. Retry wording')
line()

assertEqual(
  'same exact current text, district phrase preserved (one district)',
  buildDistrictScopeRetryQuestion({ district: 'Kadıköy' }),
  'Sorry, just to confirm — should I keep searching in Kadıköy, or search other districts too?'
)
assertEqual(
  'district phrase preserved (multiple districts)',
  buildDistrictScopeRetryQuestion({ districts: ['Kadıköy', 'Beşiktaş'] }),
  'Sorry, just to confirm — should I keep searching in Kadıköy or Beşiktaş, or search other districts too?'
)
assertEqual(
  'no district (existing behavior: literal "null")',
  buildDistrictScopeRetryQuestion({}),
  'Sorry, just to confirm — should I keep searching in null, or search other districts too?'
)

// ═══════════════════════════════════════════════════════════════════════
// G. Pending clarification: keep district
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. Pending clarification: keep district')
line()
{
  const pendingClarification = { type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 0 }
  const currentFilters = { district: 'Kadıköy', pendingClarification }
  const parsed = { district: 'Kadıköy', propertyType: 'Apartment', lifestyle: ['near schools'] }

  const result = handleDistrictScopeClarification({
    message: 'keep it',
    currentFilters,
    parsedFromMessage: {},
    parsed,
    newLifestyleConceptsInMessage: new Set(),
  })

  assertEqual('handled: false (no new reply — falls through to normal search)', result.handled, false)
  assertEqual('district retained', result.parsed.district, 'Kadıköy')
  assertEqual('pendingClarification cleared on parsed', result.parsed.pendingClarification, null)
  assertEqual('reply: null', result.reply, null)
  assertEqual('event: null', result.event, null)
  assertEqual('lifestyle untouched (not this module\'s concern)', result.parsed.lifestyle, ['near schools'])
}

// ═══════════════════════════════════════════════════════════════════════
// H. Pending clarification: broaden
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. Pending clarification: broaden')
line()
{
  const pendingClarification = { type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 0 }
  const currentFilters = { district: 'Kadıköy', pendingClarification }
  const parsed = { district: 'Kadıköy', districts: [], propertyType: 'Apartment', lifestyle: ['near schools'] }

  const result = handleDistrictScopeClarification({
    message: 'anywhere is fine',
    currentFilters,
    parsedFromMessage: {},
    parsed,
    newLifestyleConceptsInMessage: new Set(),
  })

  assertEqual('handled: false', result.handled, false)
  assertEqual('district cleared', result.parsed.district, null)
  assertEqual('districts cleared', result.parsed.districts, [])
  assertEqual('pendingClarification cleared', result.parsed.pendingClarification, null)
  assertEqual('lifestyle criteria preserved (not this module\'s concern)', result.parsed.lifestyle, ['near schools'])
}

// ═══════════════════════════════════════════════════════════════════════
// I. Pending clarification: unclear
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('I. Pending clarification: unclear')
line()
{
  const pendingClarification = { type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 0 }
  const currentFilters = { district: 'Kadıköy', pendingClarification }
  // In the real route, `parsed` originates from resolveConversationState(),
  // which spreads currentFilters (including pendingClarification) into it
  // before this module ever runs — reproduced here so this fixture matches
  // what the wrapper actually receives in production.
  const parsed = { district: 'Kadıköy', propertyType: 'Apartment', pendingClarification }

  const result = handleDistrictScopeClarification({
    message: 'maybe',
    currentFilters,
    parsedFromMessage: {},
    parsed,
    newLifestyleConceptsInMessage: new Set(),
  })

  assertEqual('handled: true (retry question returned)', result.handled, true)
  assertEqual(
    'exact retry reply text',
    result.reply,
    'Sorry, just to confirm — should I keep searching in Kadıköy, or search other districts too?'
  )
  assertEqual('event: clarification_requested', result.event, 'clarification_requested')
  assertEqual('returned pendingClarification retryCount incremented to 1', result.pendingClarification.retryCount, 1)
  assertEqual('returned pendingClarification preserves lifestyleConcepts', result.pendingClarification.lifestyleConcepts, ['school'])
  assertEqual(
    'parsed.pendingClarification itself is NOT mutated in this branch (matches original inline behavior)',
    result.parsed.pendingClarification.retryCount,
    0
  )

  // Already retried once -> stop asking, fall back to the safe default (keep).
  const secondPendingClarification = { type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 1 }
  const secondResult = handleDistrictScopeClarification({
    message: 'maybe',
    currentFilters: { district: 'Kadıköy', pendingClarification: secondPendingClarification },
    parsedFromMessage: {},
    parsed: { district: 'Kadıköy', propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('retryCount >= 1 -> handled: false (stop asking)', secondResult.handled, false)
  assertEqual('retryCount >= 1 -> pendingClarification cleared', secondResult.parsed.pendingClarification, null)
}

// ═══════════════════════════════════════════════════════════════════════
// J. Fresh trigger
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('J. Fresh trigger')
line()
{
  const parsed = { district: 'Beylikdüzü', propertyType: 'Apartment', lifestyle: ['near schools'] }

  const result = handleDistrictScopeClarification({
    message: 'my wife wants a home near schools',
    currentFilters: {},
    parsedFromMessage: {},
    parsed,
    newLifestyleConceptsInMessage: new Set(['school']),
  })

  assertEqual('clarification triggered: handled true', result.handled, true)
  assertEqual(
    'exact clarification question',
    result.reply,
    'Should I keep searching in Beylikdüzü, or include other districts with school apartments?'
  )
  assertEqual('event: clarification_requested', result.event, 'clarification_requested')
  assertEqual(
    'pendingClarification shape exact',
    result.pendingClarification,
    { type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 0 }
  )
}

// ═══════════════════════════════════════════════════════════════════════
// K. No trigger
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('K. No trigger')
line()
{
  const base = { currentFilters: {}, parsedFromMessage: {} }

  const ordinary = handleDistrictScopeClarification({
    ...base,
    message: 'Show me apartments for sale',
    parsed: { district: 'Kadıköy', propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('ordinary structured search: not handled', ordinary.handled, false)
  assertEqual('ordinary structured search: district untouched', ordinary.parsed.district, 'Kadıköy')

  const showMore = handleDistrictScopeClarification({
    ...base,
    message: 'show me more',
    parsed: { district: 'Kadıköy', propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(['school']),
  })
  assertEqual('"show me more" never triggers, even with a new concept detected', showMore.handled, false)
  assertEqual('"show me more": district untouched', showMore.parsed.district, 'Kadıköy')

  const noPreviousDistrict = handleDistrictScopeClarification({
    ...base,
    message: 'a home near schools',
    parsed: { district: null, districts: [], propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(['school']),
  })
  assertEqual('no previous district: not handled', noPreviousDistrict.handled, false)

  const noNewConcept = handleDistrictScopeClarification({
    ...base,
    message: 'under 5 million',
    parsed: { district: 'Kadıköy', propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('no new lifestyle concept: not handled', noNewConcept.handled, false)

  const explicitNewDistrict = handleDistrictScopeClarification({
    ...base,
    message: 'what about sea view villas in Beşiktaş',
    parsed: { district: 'Beşiktaş', propertyType: 'Villa' },
    newLifestyleConceptsInMessage: new Set(['sea_view']),
  })
  assertEqual(
    'message explicitly names a district ("replace") -> no clarification, parsed.district already correct',
    explicitNewDistrict.handled,
    false
  )
  assertEqual('explicit new district: district stays as already-resolved', explicitNewDistrict.parsed.district, 'Beşiktaş')
}

// ═══════════════════════════════════════════════════════════════════════
// L. Multiple districts
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('L. Multiple districts (wrapper level)')
line()
{
  const parsed = { districts: ['Kadıköy', 'Beşiktaş'], district: null, propertyType: 'Apartment' }

  const result = handleDistrictScopeClarification({
    message: 'my wife wants a home near schools',
    currentFilters: {},
    parsedFromMessage: {},
    parsed,
    newLifestyleConceptsInMessage: new Set(['school']),
  })

  assertEqual(
    'exact question wording with multiple districts',
    result.reply,
    'Should I keep searching in Kadıköy or Beşiktaş, or include other districts with school apartments?'
  )
}

// ═══════════════════════════════════════════════════════════════════════
// M. Multiple property types
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('M. Multiple property types (wrapper level)')
line()
{
  const parsed = { district: 'Kadıköy', propertyTypes: ['Apartment', 'Villa'], propertyType: null }

  const result = handleDistrictScopeClarification({
    message: 'my wife wants a home near schools',
    currentFilters: {},
    parsedFromMessage: {},
    parsed,
    newLifestyleConceptsInMessage: new Set(['school']),
  })

  assertEqual(
    'exact question wording with multiple property types',
    result.reply,
    'Should I keep searching in Kadıköy, or include other districts with school apartments and villas?'
  )
}

// ═══════════════════════════════════════════════════════════════════════
// N. Wrapper return shape
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('N. Wrapper return shape')
line()
{
  const notHandled = handleDistrictScopeClarification({
    message: 'Show me apartments for sale',
    currentFilters: {},
    parsedFromMessage: {},
    parsed: { district: 'Kadıköy' },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual(
    'not-handled result has exactly {handled, parsed, reply, event, pendingClarification}',
    Object.keys(notHandled).sort(),
    ['event', 'handled', 'parsed', 'pendingClarification', 'reply'].sort()
  )
  assertEqual('not-handled: reply is null', notHandled.reply, null)
  assertEqual('not-handled: event is null', notHandled.event, null)
  assertEqual('not-handled: pendingClarification is null', notHandled.pendingClarification, null)

  const handled = handleDistrictScopeClarification({
    message: 'my wife wants a home near schools',
    currentFilters: {},
    parsedFromMessage: {},
    parsed: { district: 'Beylikdüzü', propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(['school']),
  })
  assertEqual(
    'handled result has exactly the same key set',
    Object.keys(handled).sort(),
    ['event', 'handled', 'parsed', 'pendingClarification', 'reply'].sort()
  )
  assertTrue('handled: reply is a non-empty string', typeof handled.reply === 'string' && handled.reply.length > 0)
  assertEqual('handled: event is clarification_requested', handled.event, 'clarification_requested')
  assertTrue('handled: pendingClarification is a plain object', typeof handled.pendingClarification === 'object' && handled.pendingClarification !== null)
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
