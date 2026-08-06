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

// Narrowed keep patterns: the previously-unsafe bare keep/stay/there no longer
// misfire on unrelated criteria (these must be 'unclear', not 'keep').
assertEqual('"Stay close to the metro." -> unclear (not keep)', resolveDistrictScopeAnswer('Stay close to the metro.'), 'unclear')
assertEqual('"Keep the budget under five million." -> unclear (not keep)', resolveDistrictScopeAnswer('Keep the budget under five million.'), 'unclear')
assertEqual('"There should be a school nearby." -> unclear (not keep)', resolveDistrictScopeAnswer('There should be a school nearby.'), 'unclear')

// Genuine district-continuity phrasings still resolve to keep.
assertEqual('"keep searching here" -> keep', resolveDistrictScopeAnswer('keep searching here'), 'keep')
assertEqual('"stay here" -> keep', resolveDistrictScopeAnswer('stay here'), 'keep')
assertEqual('"keep the same" -> keep', resolveDistrictScopeAnswer('keep the same'), 'keep')

// ═══════════════════════════════════════════════════════════════════════
// C2. resolveDistrictScopeAnswer — parsed-district evidence
//     (second arg: parsedFromMessage, verified against THIS message only)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C2. resolveDistrictScopeAnswer — parsed-district evidence')
line()

// Parsed district outside KNOWN_DISTRICTS but genuinely written this turn.
assertEqual(
  'parsed district genuinely in message ("Şile") -> replace',
  resolveDistrictScopeAnswer('Show me sea-view homes in Şile.', { district: 'Şile', districts: [] }),
  'replace'
)

// Parsed district INHERITED from history (not present in this message) must
// NOT be treated as a new district — this is the canonical sea-view echo case.
assertEqual(
  'parsed district inherited/echoed, absent from message ("Beylikdüzü") -> unclear',
  resolveDistrictScopeAnswer('My wife wants a sea view.', { district: 'Beylikdüzü', districts: [] }),
  'unclear'
)

// An inherited parsed district must never override an explicit broaden answer.
assertEqual(
  'inherited parsed district does not override broaden ("Anywhere is fine.") -> broaden',
  resolveDistrictScopeAnswer('Anywhere is fine.', { district: 'Beylikdüzü', districts: [] }),
  'broaden'
)

// Multiple parsed districts genuinely mentioned this turn.
assertEqual(
  'parsed multiple districts genuinely in message ("Şile or Sarıyer") -> replace',
  resolveDistrictScopeAnswer('Search Şile or Sarıyer.', { district: null, districts: ['Şile', 'Sarıyer'] }),
  'replace'
)

// Multiple parsed districts inherited but not mentioned this turn.
assertEqual(
  'parsed multiple districts inherited, absent from message -> unclear',
  resolveDistrictScopeAnswer('I also want a sea view.', { district: null, districts: ['Beylikdüzü', 'Esenyurt'] }),
  'unclear'
)

// Turkish locative suffix still matches by substring ("şile'de" contains "şile").
assertEqual(
  'parsed district with Turkish suffix ("Şile\'de") -> replace',
  resolveDistrictScopeAnswer("Şile'de deniz manzaralı ev göster.", { district: 'Şile', districts: [] }),
  'replace'
)

// Existing behavior remains unchanged with the second arg present.
assertEqual(
  'known district in message still replace, even with an inherited parsed district',
  resolveDistrictScopeAnswer('Search in Beşiktaş instead.', { district: 'Beylikdüzü', districts: [] }),
  'replace'
)
assertEqual('"Other districts too." -> broaden', resolveDistrictScopeAnswer('Other districts too.', {}), 'broaden')
assertEqual('"Keep the same district." -> keep', resolveDistrictScopeAnswer('Keep the same district.', {}), 'keep')
assertEqual('"I just want something nice." -> unclear', resolveDistrictScopeAnswer('I just want something nice.', { district: null, districts: [] }), 'unclear')

// Missing / undefined / null parsedFromMessage must not crash.
assertEqual('no second arg (undefined) still works', resolveDistrictScopeAnswer('yes'), 'keep')
assertEqual('explicit undefined second arg still works', resolveDistrictScopeAnswer('yes', undefined), 'keep')
assertEqual('null second arg does not crash', resolveDistrictScopeAnswer('Show me homes in Şile.', null), 'unclear')

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

// ═══════════════════════════════════════════════════════════════════════
// O. districtScopeAction integration (consulted only when deterministic is
//    'unclear', and only inside the pending district-scope branch)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('O. districtScopeAction integration')
line()
{
  const pending = () => ({ type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 0 })

  // O1: natural Turkish broaden that the deterministic resolver cannot classify
  // ("Konum önemli değil." -> deterministic 'unclear') is resolved via Gemini's
  // districtScopeAction: 'broaden'.
  const o1 = handleDistrictScopeClarification({
    message: 'Konum önemli değil.',
    currentFilters: { district: 'Kadıköy', pendingClarification: pending() },
    parsedFromMessage: { districtScopeAction: 'broaden' },
    parsed: { district: 'Kadıköy', districts: [], propertyType: 'Apartment', pendingClarification: pending() },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('O1: scopeAction broaden -> handled false (falls through)', o1.handled, false)
  assertEqual('O1: district cleared', o1.parsed.district, null)
  assertEqual('O1: districts cleared', o1.parsed.districts, [])
  assertEqual('O1: pendingClarification cleared', o1.parsed.pendingClarification, null)

  // O2: natural Turkish keep -> retain the district, clear the clarification.
  const o2 = handleDistrictScopeClarification({
    message: 'Aynı bölgede devam edelim.',
    currentFilters: { district: 'Kadıköy', pendingClarification: pending() },
    parsedFromMessage: { districtScopeAction: 'keep' },
    parsed: { district: 'Kadıköy', districts: [], propertyType: 'Apartment', pendingClarification: pending() },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('O2: scopeAction keep -> district retained', o2.parsed.district, 'Kadıköy')
  assertEqual('O2: scopeAction keep -> pendingClarification cleared', o2.parsed.pendingClarification, null)

  // O3: scopeAction replace clears the clarification and retains the parsed
  // district (deterministic 'unclear' because the district is not literally in
  // this message).
  const o3 = handleDistrictScopeClarification({
    message: 'başka bir yer olsun',
    currentFilters: { district: 'Kadıköy', pendingClarification: pending() },
    parsedFromMessage: { district: 'Şile', districts: [], districtScopeAction: 'replace' },
    parsed: { district: 'Şile', districts: [], propertyType: 'Apartment', pendingClarification: pending() },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('O3: scopeAction replace -> parsed district retained', o3.parsed.district, 'Şile')
  assertEqual('O3: scopeAction replace -> pendingClarification cleared', o3.parsed.pendingClarification, null)

  // O4: scopeAction 'unclear' preserves the existing retry flow (retryCount 0).
  const o4 = handleDistrictScopeClarification({
    message: 'hmm',
    currentFilters: { district: 'Kadıköy', pendingClarification: pending() },
    parsedFromMessage: { districtScopeAction: 'unclear' },
    parsed: { district: 'Kadıköy', propertyType: 'Apartment', pendingClarification: pending() },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('O4: scopeAction unclear -> handled true (retry asked)', o4.handled, true)
  assertEqual('O4: retryCount incremented to 1', o4.pendingClarification.retryCount, 1)

  // O5: a high-confidence deterministic result WINS over a conflicting
  // districtScopeAction (deterministic 'broaden' beats scopeAction 'keep').
  const o5 = handleDistrictScopeClarification({
    message: 'Anywhere is fine.',
    currentFilters: { district: 'Kadıköy', pendingClarification: pending() },
    parsedFromMessage: { districtScopeAction: 'keep' },
    parsed: { district: 'Kadıköy', districts: [], propertyType: 'Apartment', pendingClarification: pending() },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('O5: deterministic broaden wins over scopeAction keep -> district cleared', o5.parsed.district, null)
  assertEqual('O5: pendingClarification cleared', o5.parsed.pendingClarification, null)

  // O6: with NO pending district clarification, districtScopeAction must be
  // ignored — an ordinary search must not have its district cleared.
  const o6 = handleDistrictScopeClarification({
    message: 'Show me apartments in Kadıköy',
    currentFilters: {},
    parsedFromMessage: { districtScopeAction: 'broaden', district: 'Kadıköy' },
    parsed: { district: 'Kadıköy', propertyType: 'Apartment' },
    newLifestyleConceptsInMessage: new Set(),
  })
  assertEqual('O6: no pending clarification -> not handled', o6.handled, false)
  assertEqual('O6: ordinary district NOT cleared by districtScopeAction', o6.parsed.district, 'Kadıköy')
}

// ═══════════════════════════════════════════════════════════════════════
// P. Confidence tiering: districtScopeAction corrects unsafe deterministic
//    keep/replace (negation), and false positives no longer silently keep.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('P. Negation correction & false-positive tiering')
line()
{
  const pending = () => ({ type: 'lifestyle_scope', unresolvedFields: ['district'], lifestyleConcepts: ['school'], retryCount: 0 })
  const base = (msg, pf) => ({
    message: msg,
    currentFilters: { district: 'Beylikdüzü', pendingClarification: pending() },
    parsedFromMessage: pf,
    parsed: { district: 'Beylikdüzü', districts: [], propertyType: 'Apartment', pendingClarification: pending() },
    newLifestyleConceptsInMessage: new Set(),
  })

  // P1: English negation — deterministic would say 'keep' ("keep it"); Gemini broaden corrects it.
  const p1 = handleDistrictScopeClarification(base("Don't keep it there.", { districtScopeAction: 'broaden' }))
  assertEqual('P1: "Don\'t keep it there." + action broaden -> district cleared', p1.parsed.district, null)
  assertEqual('P1: districts cleared', p1.parsed.districts, [])

  // P2: Turkish negation WITH a district name — deterministic would say 'replace'; Gemini broaden corrects it.
  const p2 = handleDistrictScopeClarification(base('Beylikdüzü’nde kalmasın.', { district: 'Beylikdüzü', districts: [], districtScopeAction: 'broaden' }))
  assertEqual('P2: "kalmasın" + action broaden -> district cleared (not retained)', p2.parsed.district, null)

  // P3: Turkish negation, no district name.
  const p3 = handleDistrictScopeClarification(base('Aynı ilçede kalmak istemiyorum.', { districtScopeAction: 'broaden' }))
  assertEqual('P3: "kalmak istemiyorum" + action broaden -> district cleared', p3.parsed.district, null)

  // P4: Arabic negation.
  const p4 = handleDistrictScopeClarification(base('لا تبقَ في نفس المنطقة', { districtScopeAction: 'broaden' }))
  assertEqual('P4: Arabic negation + action broaden -> district cleared', p4.parsed.district, null)

  // P5: false-positive guard — "Stay close to the metro." + action unclear stays unclear -> retry (no silent keep).
  const p5 = handleDistrictScopeClarification(base('Stay close to the metro.', { districtScopeAction: 'unclear' }))
  assertEqual('P5: "stay close to the metro" + unclear -> retry asked', p5.handled, true)
  assertEqual('P5: district retained during retry', p5.parsed.district, 'Beylikdüzü')

  // P6: false-positive guard — "Keep the budget under five million." + unclear -> retry (not keep).
  const p6 = handleDistrictScopeClarification(base('Keep the budget under five million.', { districtScopeAction: 'unclear' }))
  assertEqual('P6: "keep the budget" + unclear -> retry asked (not silent keep)', p6.handled, true)

  // P7: Gemini-outage high-confidence broaden fallback (action unclear, clear phrase).
  const p7 = handleDistrictScopeClarification(base('Anywhere is fine.', { districtScopeAction: 'unclear' }))
  assertEqual('P7: outage "anywhere is fine" -> broaden (district cleared)', p7.parsed.district, null)

  // P8: Gemini-outage high-confidence keep fallback.
  const p8 = handleDistrictScopeClarification(base('Keep the same district.', { districtScopeAction: 'unclear' }))
  assertEqual('P8: outage "keep the same district" -> district retained', p8.parsed.district, 'Beylikdüzü')
  assertEqual('P8: clarification cleared', p8.parsed.pendingClarification, null)

  // P9: a clear deterministic BROADEN still beats a conflicting Gemini action (Tier 1).
  const p9 = handleDistrictScopeClarification(base('Anywhere is fine.', { districtScopeAction: 'keep' }))
  assertEqual('P9: deterministic broaden beats conflicting action keep -> district cleared', p9.parsed.district, null)
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 3: district-scope question/retry localization in tr/ar.
// resolveDistrictScopeAnswer/extractConceptIds (and everything above this
// section, which calls buildDistrictScopeQuestion/buildDistrictScopeRetryQuestion
// with no language argument) are completely unchanged — Phase 3 only adds
// a `language` parameter to the two question-rendering functions.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Phase 3: buildDistrictScopeQuestion in tr/ar')
line()

const questionTr = buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, ['school'], 'tr')
assertTrue('tr question mentions the district (Kadıköy)', questionTr.includes('Kadıköy'))
assertTrue('tr question mentions the school concept topic (okullara yakınlık)', questionTr.includes('okullara yakınlık'))

const questionAr = buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, ['school'], 'ar')
assertTrue('ar question mentions the district (Kadıköy)', questionAr.includes('Kadıköy'))
assertTrue('ar question mentions the school concept topic (القرب من المدارس)', questionAr.includes('القرب من المدارس'))

const questionNoConceptsTr = buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, [], 'tr')
assertTrue('tr question with no concept ids falls back to the generic "bunu" phrase', questionNoConceptsTr.includes('bunu'))

const questionNoConceptsAr = buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, [], 'ar')
assertTrue('ar question with no concept ids falls back to the generic "ذلك" phrase', questionNoConceptsAr.includes('ذلك'))

line()
console.log('Phase 3: buildDistrictScopeRetryQuestion in tr/ar')
line()

const retryTr = buildDistrictScopeRetryQuestion({ district: 'Kadıköy' }, 'tr')
assertTrue('tr retry question mentions the district (Kadıköy)', retryTr.includes('Kadıköy'))

const retryAr = buildDistrictScopeRetryQuestion({ district: 'Kadıköy' }, 'ar')
assertTrue('ar retry question mentions the district (Kadıköy)', retryAr.includes('Kadıköy'))

line()
console.log('Phase 3: language fallback and no mutation')
line()

assertEqual(
  'buildDistrictScopeQuestion with unsupported language falls back to English content',
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, ['school'], 'de'),
  buildDistrictScopeQuestion({ district: 'Kadıköy', propertyType: 'Apartment' }, ['school'], 'en')
)

assertTrue('buildDistrictScopeQuestion does not mutate parsed or conceptIds when called with a language', (() => {
  const parsed = { district: 'Kadıköy', propertyType: 'Apartment' }
  const conceptIds = ['school']
  const beforeParsed = JSON.stringify(parsed)
  const beforeConceptIds = JSON.stringify(conceptIds)
  buildDistrictScopeQuestion(parsed, conceptIds, 'ar')
  return JSON.stringify(parsed) === beforeParsed && JSON.stringify(conceptIds) === beforeConceptIds
})())

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
