// backend/scripts/testChatSlotState.js
//
// Focused, fully deterministic unit tests for services/chatSlotState.js —
// no DB connection, no Gemini call, no network. Same conventions as
// testChatConversationMemory.js: fixed inputs, exact assertions.
//
// Usage: node scripts/testChatSlotState.js

import {
  GOVERNED_SLOTS,
  VALID_SLOT_STATUSES,
  SLOT_VALUE_FIELDS,
  slotHasValue,
  normalizeTurn,
  normalizeSlotStatus,
  getSlotStatus,
  deriveSlotStanding,
  setSlotStatus,
  clearSlotStatus,
  applySlotAction,
  detectShadowSlotSignals,
} from '../services/chatSlotState.js'

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

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. normalizeSlotStatus — shape and record sanitization')
line()

assertEqual('missing slotStatus -> {}', normalizeSlotStatus(undefined, {}), {})
assertEqual('null slotStatus -> {}', normalizeSlotStatus(null, {}), {})
assertEqual('array slotStatus -> {}', normalizeSlotStatus([{ status: 'deferred' }], {}), {})
assertEqual('string slotStatus -> {}', normalizeSlotStatus('deferred', {}), {})

assertEqual(
  'unknown slot keys dropped',
  normalizeSlotStatus({ beds: { status: 'deferred', turn: 1 }, parking: { status: 'declined', turn: 2 } }, {}),
  {}
)

assertEqual(
  'invalid status values dropped',
  normalizeSlotStatus(
    {
      listingType: { status: 'filled', turn: 1 },
      district: { status: 'empty', turn: 1 },
      budget: { status: 'whatever', turn: 1 },
      propertyType: { status: null, turn: 1 },
    },
    {}
  ),
  {}
)

assertEqual(
  'malformed records dropped (non-object, array, missing status)',
  normalizeSlotStatus(
    { listingType: 'deferred', district: [{ status: 'deferred' }], budget: { turn: 3 } },
    {}
  ),
  {}
)

assertEqual(
  'valid records preserved with normalized turn',
  normalizeSlotStatus(
    { listingType: { status: 'deferred', turn: 3 }, budget: { status: 'declined', turn: 4 } },
    {}
  ),
  { listingType: { status: 'deferred', turn: 3 }, budget: { status: 'declined', turn: 4 } }
)

assertEqual(
  'invalid record turn coerced to 0, record kept',
  normalizeSlotStatus({ district: { status: 'declined', turn: 'soon' } }, {}),
  { district: { status: 'declined', turn: 0 } }
)

assertEqual(
  'negative/float record turns coerced to 0',
  normalizeSlotStatus(
    { district: { status: 'declined', turn: -2 }, budget: { status: 'deferred', turn: 1.5 } },
    {}
  ),
  { district: { status: 'declined', turn: 0 }, budget: { status: 'deferred', turn: 0 } }
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. value-wins invariant')
line()

const deferredEverything = {
  listingType: { status: 'deferred', turn: 1 },
  propertyType: { status: 'deferred', turn: 1 },
  district: { status: 'deferred', turn: 1 },
  budget: { status: 'deferred', turn: 1 },
}

assertEqual(
  'listingType value removes listingType status',
  normalizeSlotStatus(deferredEverything, { listingType: 'Rent' }).listingType,
  undefined
)
assertEqual(
  'propertyType value removes propertyType status',
  normalizeSlotStatus(deferredEverything, { propertyType: 'Apartment' }).propertyType,
  undefined
)
assertEqual(
  'propertyTypes array removes propertyType status',
  normalizeSlotStatus(deferredEverything, { propertyTypes: ['Apartment', 'Villa'] }).propertyType,
  undefined
)
assertEqual(
  'district value removes district status',
  normalizeSlotStatus(deferredEverything, { district: 'Kadıköy' }).district,
  undefined
)
assertEqual(
  'districts array removes district status',
  normalizeSlotStatus(deferredEverything, { districts: ['Kadıköy'] }).district,
  undefined
)
assertEqual(
  'minPrice removes budget status',
  normalizeSlotStatus(deferredEverything, { minPrice: 1000000 }).budget,
  undefined
)
assertEqual(
  'maxPrice removes budget status',
  normalizeSlotStatus(deferredEverything, { maxPrice: 5000000 }).budget,
  undefined
)
assertEqual(
  'valueless slots keep their statuses when others are filled',
  normalizeSlotStatus(deferredEverything, { listingType: 'Rent' }),
  {
    propertyType: { status: 'deferred', turn: 1 },
    district: { status: 'deferred', turn: 1 },
    budget: { status: 'deferred', turn: 1 },
  }
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. deriveSlotStanding')
line()

assertEqual('value exists -> filled', deriveSlotStanding({ listingType: 'Sale' }, 'listingType'), 'filled')
assertEqual(
  'status deferred -> deferred',
  deriveSlotStanding({ slotStatus: { budget: { status: 'deferred', turn: 2 } } }, 'budget'),
  'deferred'
)
assertEqual(
  'status declined -> declined',
  deriveSlotStanding({ slotStatus: { district: { status: 'declined', turn: 2 } } }, 'district'),
  'declined'
)
assertEqual('neither -> empty', deriveSlotStanding({}, 'propertyType'), 'empty')
assertEqual(
  'value wins over (stale) status in derivation too',
  deriveSlotStanding(
    { listingType: 'Rent', slotStatus: { listingType: { status: 'deferred', turn: 1 } } },
    'listingType'
  ),
  'filled'
)
assertEqual('getSlotStatus returns null for missing entry', getSlotStatus({}, 'budget'), null)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. transition table via applySlotAction')
line()

// empty + set(v) -> filled(v), status removed
{
  const next = applySlotAction({}, { slot: 'listingType', action: 'set', value: 'Rent' }, 5)
  assertEqual('empty + set -> filled', next.listingType, 'Rent')
  assertEqual('empty + set -> no status entry', next.slotStatus, {})
}

// empty + defer -> deferred
{
  const next = applySlotAction({}, { slot: 'listingType', action: 'defer' }, 5)
  assertEqual('empty + defer -> deferred', next.slotStatus, { listingType: { status: 'deferred', turn: 5 } })
}

// empty + decline -> declined
{
  const next = applySlotAction({}, { slot: 'budget', action: 'decline' }, 5)
  assertEqual('empty + decline -> declined', next.slotStatus, { budget: { status: 'declined', turn: 5 } })
}

// filled + set(new) -> filled(new), status removed
{
  const next = applySlotAction({ listingType: 'Sale' }, { slot: 'listingType', action: 'set', value: 'Rent' }, 6)
  assertEqual('filled + set -> new value', next.listingType, 'Rent')
  assertEqual('filled + set -> no status', next.slotStatus, {})
}

// filled + clear -> empty, status removed
{
  const next = applySlotAction({ listingType: 'Sale' }, { slot: 'listingType', action: 'clear' }, 6)
  assertEqual('filled + clear -> value null', next.listingType, null)
  assertEqual('filled + clear -> no status', next.slotStatus, {})
  assertEqual('filled + clear -> derived standing empty', deriveSlotStanding(next, 'listingType'), 'empty')
}

// filled + defer -> value cleared, deferred
{
  const next = applySlotAction({ listingType: 'Sale' }, { slot: 'listingType', action: 'defer' }, 6)
  assertEqual('filled + defer -> value cleared', next.listingType, null)
  assertEqual('filled + defer -> deferred', next.slotStatus, { listingType: { status: 'deferred', turn: 6 } })
}

// filled + decline -> value cleared, declined
{
  const next = applySlotAction({ district: 'Kadıköy', districts: [] }, { slot: 'district', action: 'decline' }, 6)
  assertEqual('filled + decline -> value cleared', next.district, null)
  assertEqual('filled + decline -> declined', next.slotStatus, { district: { status: 'declined', turn: 6 } })
}

// deferred + set(v) -> filled(v), deferred removed
{
  const state = { slotStatus: { listingType: { status: 'deferred', turn: 3 } } }
  const next = applySlotAction(state, { slot: 'listingType', action: 'set', value: 'Rent' }, 7)
  assertEqual('deferred + set -> filled', next.listingType, 'Rent')
  assertEqual('deferred + set -> status removed', next.slotStatus, {})
}

// deferred + decline -> declined
{
  const state = { slotStatus: { budget: { status: 'deferred', turn: 3 } } }
  const next = applySlotAction(state, { slot: 'budget', action: 'decline' }, 7)
  assertEqual('deferred + decline -> declined', next.slotStatus, { budget: { status: 'declined', turn: 7 } })
}

// declined + set(v) -> filled(v), declined removed
{
  const state = { slotStatus: { district: { status: 'declined', turn: 3 } } }
  const next = applySlotAction(state, { slot: 'district', action: 'set', value: 'Esenyurt' }, 8)
  assertEqual('declined + set -> filled', next.district, 'Esenyurt')
  assertEqual('declined + set -> status removed', next.slotStatus, {})
}

// any + clear -> empty, status removed
{
  const state = { minPrice: 1000, maxPrice: 5000, slotStatus: { budget: { status: 'deferred', turn: 3 } } }
  const next = applySlotAction(state, { slot: 'budget', action: 'clear' }, 8)
  assertEqual('any + clear -> min cleared', next.minPrice, null)
  assertEqual('any + clear -> max cleared', next.maxPrice, null)
  assertEqual('any + clear -> status removed', next.slotStatus, {})
}

// defensive cases
assertEqual(
  'unknown slot -> state unchanged',
  applySlotAction({ listingType: 'Sale' }, { slot: 'beds', action: 'defer' }, 5),
  { listingType: 'Sale' }
)
assertEqual(
  'unknown action -> state unchanged',
  applySlotAction({ listingType: 'Sale' }, { slot: 'listingType', action: 'freeze' }, 5),
  { listingType: 'Sale' }
)
assertEqual(
  'set with no meaningful value -> state unchanged (no accidental clear)',
  applySlotAction({ listingType: 'Sale' }, { slot: 'listingType', action: 'set', value: null }, 5),
  { listingType: 'Sale' }
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. logical-field clearing across mapped fields')
line()

{
  const next = applySlotAction(
    { propertyType: 'Apartment', propertyTypes: ['Apartment', 'Villa'] },
    { slot: 'propertyType', action: 'clear' },
    2
  )
  assertEqual('propertyType clear -> propertyType null', next.propertyType, null)
  assertEqual('propertyType clear -> propertyTypes []', next.propertyTypes, [])
}

{
  const next = applySlotAction(
    { district: 'Kadıköy', districts: ['Beşiktaş'] },
    { slot: 'district', action: 'clear' },
    2
  )
  assertEqual('district clear -> district null', next.district, null)
  assertEqual('district clear -> districts []', next.districts, [])
}

{
  const next = applySlotAction({ minPrice: 1, maxPrice: 2 }, { slot: 'budget', action: 'clear' }, 2)
  assertEqual('budget clear -> minPrice null', next.minPrice, null)
  assertEqual('budget clear -> maxPrice null', next.maxPrice, null)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. set one value vs multiple values')
line()

{
  const next = applySlotAction({}, { slot: 'propertyType', action: 'set', value: 'Apartment' }, 1)
  assertEqual('single propertyType set', next.propertyType, 'Apartment')
  assertEqual('single propertyType clears propertyTypes', next.propertyTypes, [])
}

{
  const next = applySlotAction(
    { propertyType: 'Apartment' },
    { slot: 'propertyType', action: 'set', value: ['Apartment', 'Villa'] },
    1
  )
  assertEqual('multiple propertyTypes set', next.propertyTypes, ['Apartment', 'Villa'])
  assertEqual('multiple propertyTypes clears single', next.propertyType, null)
}

{
  const next = applySlotAction({}, { slot: 'district', action: 'set', value: 'Büyükçekmece' }, 1)
  assertEqual('single district set', next.district, 'Büyükçekmece')
  assertEqual('single district clears districts', next.districts, [])
}

{
  const next = applySlotAction(
    { district: 'Kadıköy' },
    { slot: 'district', action: 'set', value: ['Kadıköy', 'Beşiktaş'] },
    1
  )
  assertEqual('multiple districts set', next.districts, ['Kadıköy', 'Beşiktaş'])
  assertEqual('multiple districts clears single', next.district, null)
}

{
  const next = applySlotAction({}, { slot: 'budget', action: 'set', value: { maxPrice: 5000000 } }, 1)
  assertEqual('budget set maxPrice only', next.maxPrice, 5000000)
  assertEqual('budget set leaves minPrice untouched', next.minPrice, undefined)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. turn counter normalization')
line()

assertEqual('missing -> 0', normalizeTurn(undefined), 0)
assertEqual('null -> 0', normalizeTurn(null), 0)
assertEqual('string -> 0', normalizeTurn('7'), 0)
assertEqual('negative -> 0', normalizeTurn(-3), 0)
assertEqual('float -> 0', normalizeTurn(2.5), 0)
assertEqual('NaN -> 0', normalizeTurn(NaN), 0)
assertEqual('Infinity -> 0', normalizeTurn(Infinity), 0)
assertEqual('valid preserved', normalizeTurn(12), 12)
assertEqual('zero preserved', normalizeTurn(0), 0)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. hostile/stale client input')
line()

assertEqual(
  'hostile mixed garbage sanitized to only the valid record',
  normalizeSlotStatus(
    {
      listingType: { status: 'deferred', turn: 2 },
      hacked: { status: 'deferred', turn: 2 },
      district: { status: 'DROP TABLE', turn: 2 },
      budget: 42,
      propertyType: { status: 'declined', turn: { nested: true } },
    },
    {}
  ),
  {
    listingType: { status: 'deferred', turn: 2 },
    propertyType: { status: 'declined', turn: 0 },
  }
)

assertEqual(
  'value + stale status conflict resolves to value (status deleted)',
  normalizeSlotStatus(
    { listingType: { status: 'declined', turn: 2 } },
    { listingType: 'Rent' }
  ),
  {}
)

assertEqual(
  'extra unknown record properties are not carried through',
  normalizeSlotStatus({ budget: { status: 'deferred', turn: 1, exploit: 'x' } }, {}),
  { budget: { status: 'deferred', turn: 1 } }
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('I. purity — no mutation of caller data')
line()

{
  const rawStatus = { listingType: { status: 'deferred', turn: 2 }, beds: { status: 'declined', turn: 1 } }
  const criteria = { listingType: 'Rent' }
  normalizeSlotStatus(rawStatus, criteria)
  assertEqual('normalizeSlotStatus does not mutate raw input', rawStatus.beds, { status: 'declined', turn: 1 })
  assertEqual('normalizeSlotStatus does not delete from raw input', rawStatus.listingType, { status: 'deferred', turn: 2 })
}

{
  const state = { listingType: 'Sale', slotStatus: { budget: { status: 'deferred', turn: 1 } } }
  applySlotAction(state, { slot: 'listingType', action: 'defer' }, 3)
  assertEqual('applySlotAction does not mutate input state value', state.listingType, 'Sale')
  assertEqual('applySlotAction does not mutate input slotStatus', state.slotStatus, { budget: { status: 'deferred', turn: 1 } })
}

{
  const slotStatus = { budget: { status: 'deferred', turn: 1 } }
  setSlotStatus(slotStatus, 'district', 'declined', 2)
  clearSlotStatus(slotStatus, 'budget')
  assertEqual('setSlotStatus/clearSlotStatus do not mutate input', slotStatus, { budget: { status: 'deferred', turn: 1 } })
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('J. shadow-signal detection (conservative rules only)')
line()

assertEqual(
  '"any district is fine" -> district declined',
  detectShadowSlotSignals('any district is fine', {}),
  [{ slot: 'district', status: 'declined' }]
)
assertEqual(
  'noPreference + budget mention -> budget deferred',
  detectShadowSlotSignals("I don't know my budget yet", { noPreference: true }),
  [{ slot: 'budget', status: 'deferred' }]
)
assertEqual(
  'captured Büyükçekmece message -> listingType deferred',
  detectShadowSlotSignals(
    "I am not sure. I just want to see the apartments and later I'll decide whether buying or renting is better.",
    { noPreference: false }
  ),
  [{ slot: 'listingType', status: 'deferred' }]
)
assertEqual(
  '"show both sale and rent" -> listingType deferred',
  detectShadowSlotSignals('show both sale and rent', {}),
  [{ slot: 'listingType', status: 'deferred' }]
)
assertEqual('bare noPreference with no slot mention -> no writes', detectShadowSlotSignals('no preference', { noPreference: true }), [])
assertEqual('"No parking needed" -> no writes', detectShadowSlotSignals('No parking needed', {}), [])
assertEqual('"No, I want a villa instead" -> no writes', detectShadowSlotSignals('No, I want a villa instead', {}), [])
assertEqual('plain search message -> no writes', detectShadowSlotSignals('Show me apartments in Büyükçekmece', {}), [])
assertEqual(
  '"rent, not sure about my budget" -> budget deferred only (rent word alone never defers listingType)',
  detectShadowSlotSignals('rent, not sure about my budget', {}),
  [{ slot: 'budget', status: 'deferred' }]
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('K. constants sanity')
line()

assertEqual('governed slots', GOVERNED_SLOTS, ['listingType', 'propertyType', 'district', 'budget'])
assertEqual('valid statuses', VALID_SLOT_STATUSES, ['deferred', 'declined'])
assertEqual('budget maps to min/max price', SLOT_VALUE_FIELDS.budget, ['minPrice', 'maxPrice'])
assertTrue('slotHasValue: empty arrays are not values', !slotHasValue({ propertyTypes: [], districts: [] }, 'propertyType'))
assertTrue('slotHasValue: number values count', slotHasValue({ maxPrice: 5000000 }, 'budget'))

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
