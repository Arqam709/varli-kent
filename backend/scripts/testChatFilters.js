// backend/scripts/testChatFilters.js
//
// Focused, fully deterministic unit tests for services/chatFilters.js — no
// DB connection, no Gemini call, no network. Every case feeds a fixed,
// hand-crafted `parsed` (or raw filter, for buildHardFilterForDescriptionSearch)
// object and asserts the exact resulting filter object by deep equality.
//
// This is the primary safety net for the chatFilters.js extraction: since
// these are pure functions, "byte-identical output for byte-identical input"
// is a real, checkable guarantee — independent of any Gemini non-determinism
// that affects the live end-to-end characterization baseline
// (testChatRefactorBaseline.js).
//
// Usage: node scripts/testChatFilters.js

import {
  buildMustHaveFeatureFilter,
  buildMongoFilter,
  buildHardFilterForDescriptionSearch,
} from '../services/chatFilters.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

// Order-independent structural equality — object key order must never
// matter for a Mongo filter, so a naive JSON.stringify comparison (which IS
// key-order-sensitive) would produce false failures whenever the same filter
// is built by inserting keys in a different order.
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

const assertDeepEqual = (label, actual, expected) => {
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

line()
console.log('buildMongoFilter')
line()

// 1. Empty parsed object
assertDeepEqual('empty parsed -> status: Available only', buildMongoFilter({}), { status: 'Available' })

// 2. listingType
assertDeepEqual(
  'listingType Sale',
  buildMongoFilter({ listingType: 'Sale' }),
  { status: 'Available', listingType: 'Sale' }
)
assertDeepEqual(
  'listingType Rent',
  buildMongoFilter({ listingType: 'Rent' }),
  { status: 'Available', listingType: 'Rent' }
)

// 3. Single propertyType
assertDeepEqual(
  'single propertyType',
  buildMongoFilter({ propertyType: 'Apartment' }),
  { status: 'Available', propertyType: 'Apartment' }
)
assertDeepEqual(
  'propertyTypes with exactly one entry behaves like single propertyType',
  buildMongoFilter({ propertyTypes: ['Villa'] }),
  { status: 'Available', propertyType: 'Villa' }
)

// 4. Multiple propertyTypes
assertDeepEqual(
  'multiple propertyTypes uses $in',
  buildMongoFilter({ propertyTypes: ['Apartment', 'Villa'] }),
  { status: 'Available', propertyType: { $in: ['Apartment', 'Villa'] } }
)
assertDeepEqual(
  'propertyTypes with 2+ entries wins over a stray propertyType value',
  buildMongoFilter({ propertyType: 'Studio', propertyTypes: ['Apartment', 'Villa'] }),
  { status: 'Available', propertyType: { $in: ['Apartment', 'Villa'] } }
)

// 5. Single district regex
assertDeepEqual(
  'single district uses case-insensitive regex',
  buildMongoFilter({ district: 'Beylikdüzü' }),
  { status: 'Available', district: { $regex: 'Beylikdüzü', $options: 'i' } }
)

// 6. Multiple districts using $or
assertDeepEqual(
  'multiple districts uses $or of regexes',
  buildMongoFilter({ districts: ['Kadıköy', 'Beşiktaş'] }),
  {
    status: 'Available',
    $or: [
      { district: { $regex: 'Kadıköy', $options: 'i' } },
      { district: { $regex: 'Beşiktaş', $options: 'i' } },
    ],
  }
)
assertDeepEqual(
  'district + districts combined still produces $or (list length > 1)',
  buildMongoFilter({ district: 'Kadıköy', districts: ['Beşiktaş'] }),
  {
    status: 'Available',
    $or: [
      { district: { $regex: 'Kadıköy', $options: 'i' } },
      { district: { $regex: 'Beşiktaş', $options: 'i' } },
    ],
  }
)

// 7. beds and baths
assertDeepEqual(
  'beds and baths coerced to Number',
  buildMongoFilter({ beds: '3', baths: '2' }),
  { status: 'Available', beds: 3, baths: 2 }
)
assertDeepEqual('beds falsy (0) is not included', buildMongoFilter({ beds: 0 }), { status: 'Available' })

// 8. minPrice/maxPrice
assertDeepEqual(
  'minPrice only',
  buildMongoFilter({ minPrice: 1000000 }),
  { status: 'Available', price: { $gte: 1000000 } }
)
assertDeepEqual(
  'maxPrice only',
  buildMongoFilter({ maxPrice: 5000000 }),
  { status: 'Available', price: { $lte: 5000000 } }
)
assertDeepEqual(
  'minPrice and maxPrice together',
  buildMongoFilter({ minPrice: 1000000, maxPrice: 5000000 }),
  { status: 'Available', price: { $gte: 1000000, $lte: 5000000 } }
)

// 9. minSqm/maxSqm
assertDeepEqual(
  'minSqm and maxSqm together',
  buildMongoFilter({ minSqm: 80, maxSqm: 150 }),
  { status: 'Available', sqm: { $gte: 80, $lte: 150 } }
)

// 10. boolean features
assertDeepEqual(
  'furnished/balcony/elevator/pool/garden all true',
  buildMongoFilter({ furnished: true, balcony: true, elevator: true, pool: true, garden: true }),
  { status: 'Available', furnished: true, balcony: true, elevator: true, pool: true, garden: true }
)
assertDeepEqual(
  'boolean features false or absent are never included',
  buildMongoFilter({ furnished: false, balcony: null, elevator: undefined }),
  { status: 'Available' }
)

// 11. parking true — exact existing $exists/$nin structure
assertDeepEqual(
  'parking true uses the exact $exists/$nin structure',
  buildMongoFilter({ parking: true }),
  { status: 'Available', parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
)
assertDeepEqual('parking false is not included', buildMongoFilter({ parking: false }), { status: 'Available' })

// combined structured search (mirrors the "Basic structured search" baseline scenario)
assertDeepEqual(
  'combined Sale + Apartment + district (matches scenario A of the baseline)',
  buildMongoFilter({ listingType: 'Sale', propertyType: 'Apartment', district: 'Beylikdüzü' }),
  {
    status: 'Available',
    listingType: 'Sale',
    propertyType: 'Apartment',
    district: { $regex: 'Beylikdüzü', $options: 'i' },
  }
)

line()
console.log('buildMustHaveFeatureFilter')
line()

// 12. mustHave
assertDeepEqual('mustHave: empty array -> {}', buildMustHaveFeatureFilter([]), {})
assertDeepEqual('mustHave: non-array -> {}', buildMustHaveFeatureFilter(undefined), {})
assertDeepEqual(
  'mustHave: parking',
  buildMustHaveFeatureFilter(['parking']),
  { parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
)
assertDeepEqual(
  'mustHave: garage synonym also matches parking',
  buildMustHaveFeatureFilter(['garage']),
  { parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
)
assertDeepEqual('mustHave: pool', buildMustHaveFeatureFilter(['pool']), { pool: true })
assertDeepEqual('mustHave: garden', buildMustHaveFeatureFilter(['garden']), { garden: true })
assertDeepEqual('mustHave: balcony', buildMustHaveFeatureFilter(['balcony']), { balcony: true })
assertDeepEqual('mustHave: elevator', buildMustHaveFeatureFilter(['elevator']), { elevator: true })
assertDeepEqual('mustHave: lift synonym also matches elevator', buildMustHaveFeatureFilter(['lift']), { elevator: true })
assertDeepEqual('mustHave: furnished', buildMustHaveFeatureFilter(['furnished']), { furnished: true })
assertDeepEqual(
  'mustHave: multiple recognized phrases combine',
  buildMustHaveFeatureFilter(['pool', 'parking']),
  { pool: true, parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
)
assertDeepEqual(
  'mustHave: unsupported text creates no field',
  buildMustHaveFeatureFilter(['sea view', 'quiet street']),
  {}
)

line()
console.log('buildHardFilterForDescriptionSearch')
line()

// 13. buildHardFilterForDescriptionSearch
assertDeepEqual('empty filter -> status: Available only', buildHardFilterForDescriptionSearch({}), { status: 'Available' })
assertDeepEqual(
  'copies only the exact existing hard fields (listingType/propertyType)',
  buildHardFilterForDescriptionSearch({ listingType: 'Rent', propertyType: 'Villa', unrelatedField: 'ignored' }),
  { status: 'Available', listingType: 'Rent', propertyType: 'Villa' }
)
assertDeepEqual(
  'preserves district as already-built regex object',
  buildHardFilterForDescriptionSearch({ district: { $regex: 'Kadıköy', $options: 'i' } }),
  { status: 'Available', district: { $regex: 'Kadıköy', $options: 'i' } }
)
assertDeepEqual(
  'preserves $or (multi-district) untouched',
  buildHardFilterForDescriptionSearch({
    $or: [{ district: { $regex: 'A', $options: 'i' } }, { district: { $regex: 'B', $options: 'i' } }],
  }),
  { status: 'Available', $or: [{ district: { $regex: 'A', $options: 'i' } }, { district: { $regex: 'B', $options: 'i' } }] }
)
assertDeepEqual(
  'preserves price and sqm range objects',
  buildHardFilterForDescriptionSearch({ price: { $gte: 1000000, $lte: 5000000 }, sqm: { $gte: 80 } }),
  { status: 'Available', price: { $gte: 1000000, $lte: 5000000 }, sqm: { $gte: 80 } }
)
assertDeepEqual(
  'preserves beds/baths',
  buildHardFilterForDescriptionSearch({ beds: 3, baths: 2 }),
  { status: 'Available', beds: 3, baths: 2 }
)
assertDeepEqual(
  'preserves all boolean feature filters',
  buildHardFilterForDescriptionSearch({ furnished: true, balcony: true, elevator: true, pool: true, garden: true }),
  { status: 'Available', furnished: true, balcony: true, elevator: true, pool: true, garden: true }
)
assertDeepEqual(
  'preserves parking filter object untouched',
  buildHardFilterForDescriptionSearch({ parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }),
  { status: 'Available', parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
)
assertDeepEqual(
  'preserves _id exclusion (used by the show-more path)',
  buildHardFilterForDescriptionSearch({ _id: { $nin: ['507f1f77bcf86cd799439011'] } }),
  { status: 'Available', _id: { $nin: ['507f1f77bcf86cd799439011'] } }
)
assertDeepEqual(
  'falsy values (0, false, "") for hard fields are NOT copied — mirrors the original `if (filter.x)` truthy checks',
  buildHardFilterForDescriptionSearch({ beds: 0, furnished: false, district: '' }),
  { status: 'Available' }
)

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
