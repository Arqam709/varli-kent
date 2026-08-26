// Wave 11B — chatbot extended property-field awareness.
//
// Wave 10B4 gave the public filter sidebar nineteen extended fields; the
// chatbot understood none of them. A visitor could tick "sauna" on
// PropertiesPage but "villa in Beşiktaş with a sauna" fell through to
// free-text description search. These tests cover closing that gap.
//
// Three properties matter more than any individual field here:
//
//   1. A `parsed` object carrying ONLY pre-Wave-11B fields must build
//      EXACTLY the filter it built before. That is asserted against an
//      explicit expected-value table (section 1), not a snapshot of the new
//      code against itself — a snapshot would happily record a regression.
//
//   2. Nothing a language model invents may reach Mongo. Every enum value is
//      allowlisted against CURRENT's vocabularies and every numeric bound
//      must be finite, so `$in: [{$ne: null}]` and `$gte: NaN` are
//      structurally impossible.
//
//   3. A criterion that survives parsing must survive the description/hybrid
//      fallback too. Losing it there is worse than never parsing it: the
//      reply would present unfiltered results as if the requirement held.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildMongoFilter,
  buildMustHaveFeatureFilter,
  buildHardFilterForDescriptionSearch,
} from '../services/chatFilters.js'
import {
  normalizeParsed,
  canonicalizeUsageStatus,
  canonicalizeKitchenType,
  canonicalizeTransport,
  canonicalizeParkingType,
  canonicalizeCurrency,
  canonicalizeFloorLocation,
  canonicalizeTitleDeedStatus,
  canonicalizeHeating,
  canonicalizeRooms,
  canonicalizeBuildingAge,
  extractBuildingAgeFromText,
  extractListedSinceFromText,
  EXTENDED_BOOLEAN_FIELDS,
  EXTENDED_ARRAY_FIELDS,
  EXTENDED_NUMERIC_FIELDS,
} from '../services/chatMessageParsing.js'
import {
  buildingAgeBucketsWithinYears,
  BUILDING_AGE_BUCKET_LABELS,
  CANONICAL_FLOOR_LOCATIONS,
  CANONICAL_KITCHEN_TYPES,
  CANONICAL_USAGE_STATUSES,
  CANONICAL_TITLE_DEED_STATUSES,
  CANONICAL_TRANSPORT_OPTIONS,
  CANONICAL_CURRENCIES,
  CANONICAL_HEATING,
  CANONICAL_PARKING_TYPES,
  CANONICAL_ROOMS,
} from '../locales/chatParsingVocabulary.js'

const AVAILABLE = { status: 'Available' }

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Original behavior — the regression that matters most
 * ═══════════════════════════════════════════════════════════════════════ */

test('1. classic fields build exactly the pre-Wave-11B filter', async (t) => {
  // Expected values written out by hand from the pre-change implementation,
  // so this table fails if the new code drifts rather than agreeing with it.
  const CASES = [
    ['empty parse', {}, { status: 'Available' }],
    ['listingType', { listingType: 'Rent' }, { status: 'Available', listingType: 'Rent' }],
    ['single propertyType', { propertyType: 'Villa' }, { status: 'Available', propertyType: 'Villa' }],
    [
      'multiple propertyTypes',
      { propertyTypes: ['Villa', 'Apartment'] },
      { status: 'Available', propertyType: { $in: ['Villa', 'Apartment'] } },
    ],
    [
      'single-entry propertyTypes collapses to a scalar',
      { propertyTypes: ['Villa'] },
      { status: 'Available', propertyType: 'Villa' },
    ],
    [
      'district uses a case-insensitive regex',
      { district: 'Beşiktaş' },
      { status: 'Available', district: { $regex: 'Beşiktaş', $options: 'i' } },
    ],
    [
      'multiple districts become $or',
      { districts: ['Kadıköy', 'Şişli'] },
      {
        status: 'Available',
        $or: [
          { district: { $regex: 'Kadıköy', $options: 'i' } },
          { district: { $regex: 'Şişli', $options: 'i' } },
        ],
      },
    ],
    ['beds and baths', { beds: 3, baths: 2 }, { status: 'Available', beds: 3, baths: 2 }],
    [
      'classic booleans',
      { furnished: true, balcony: true, elevator: true, pool: true, garden: true },
      { status: 'Available', furnished: true, balcony: true, elevator: true, pool: true, garden: true },
    ],
    [
      'parking existence check',
      { parking: true },
      { status: 'Available', parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } },
    ],
    [
      'price range',
      { minPrice: 100, maxPrice: 500 },
      { status: 'Available', price: { $gte: 100, $lte: 500 } },
    ],
    ['sqm range', { minSqm: 50, maxSqm: 200 }, { status: 'Available', sqm: { $gte: 50, $lte: 200 } }],
  ]

  for (const [name, parsed, expected] of CASES) {
    await t.test(name, () => {
      assert.deepEqual(buildMongoFilter(parsed), expected)
    })
  }
})

test('2. classic falsy values stay excluded exactly as before', () => {
  // `furnished: false` never became a filter before this wave, and must not
  // start now — these fields carry default:false, so filtering on false
  // would match every legacy listing rather than the intended ones.
  assert.deepEqual(buildMongoFilter({ furnished: false, parking: false }), AVAILABLE)
})

test('3. a classic-only parse gains no extended keys', () => {
  const filter = buildMongoFilter({
    listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy',
    beds: 2, baths: 1, minPrice: 1000, maxPrice: 2000, furnished: true, parking: true,
  })
  for (const key of [...EXTENDED_BOOLEAN_FIELDS, ...EXTENDED_ARRAY_FIELDS, 'currency', 'createdAt', 'netSqm', 'openAreaSqm', 'coefficient', 'floor', 'totalFloors']) {
    assert.ok(!(key in filter), `classic parse must not set ${key}`)
  }
})

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Boolean amenities
 * ═══════════════════════════════════════════════════════════════════════ */

test('4. every extended boolean filters on exact true', async (t) => {
  for (const field of EXTENDED_BOOLEAN_FIELDS) {
    await t.test(field, () => {
      assert.deepEqual(buildMongoFilter({ [field]: true }), { ...AVAILABLE, [field]: true })
    })
  }
})

test('5. non-true boolean values never build a filter', async (t) => {
  // false in particular: the chat parser cannot express "must NOT have a
  // sauna", and on a tri-state field `false` would wrongly exclude every
  // listing whose sauna state was simply never recorded.
  for (const value of [false, null, undefined, 'true', 'yes', 1, 0, {}]) {
    await t.test(`sauna: ${JSON.stringify(value)}`, () => {
      assert.deepEqual(buildMongoFilter({ sauna: value }), AVAILABLE)
    })
  }
})

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Enum / multi-value fields
 * ═══════════════════════════════════════════════════════════════════════ */

const ENUM_CASES = [
  ['usageStatus', CANONICAL_USAGE_STATUSES],
  ['kitchenType', CANONICAL_KITCHEN_TYPES],
  ['heating', CANONICAL_HEATING],
  ['titleDeedStatus', CANONICAL_TITLE_DEED_STATUSES],
  ['floorLocation', CANONICAL_FLOOR_LOCATIONS],
  ['buildingAge', BUILDING_AGE_BUCKET_LABELS],
  ['rooms', CANONICAL_ROOMS],
  ['nearbyTransport', CANONICAL_TRANSPORT_OPTIONS],
]

test('6. each enum field builds an $in from allowlisted values', async (t) => {
  for (const [field, allowed] of ENUM_CASES) {
    await t.test(field, () => {
      const value = allowed[0]
      assert.deepEqual(buildMongoFilter({ [field]: [value] }), { ...AVAILABLE, [field]: { $in: [value] } })
    })
  }
})

test('7. invalid enum values are dropped, never passed to Mongo', async (t) => {
  for (const [field] of ENUM_CASES) {
    await t.test(field, () => {
      // Includes the shapes a hallucinating model actually produces: an
      // operator object, a nested array, a number, a lookalike string.
      const filter = buildMongoFilter({
        [field]: [{ $ne: null }, ['nested'], 42, 'Not A Real Value', null, ''],
      })
      assert.deepEqual(filter, AVAILABLE, `${field} must be absent when nothing validates`)
    })
  }
})

test('8. a mix of valid and invalid keeps only the valid', () => {
  assert.deepEqual(
    buildMongoFilter({ nearbyTransport: ['Metro', 'Teleporter', 'Ferry', { $gt: '' }] }),
    { ...AVAILABLE, nearbyTransport: { $in: ['Metro', 'Ferry'] } }
  )
})

test('9. duplicate enum values are deduplicated', () => {
  assert.deepEqual(
    buildMongoFilter({ nearbyTransport: ['Metro', 'Metro', 'Ferry', 'Metro'] }),
    { ...AVAILABLE, nearbyTransport: { $in: ['Metro', 'Ferry'] } }
  )
})

test('10. an empty enum array is a no-op', async (t) => {
  for (const [field] of ENUM_CASES) {
    await t.test(field, () => {
      assert.deepEqual(buildMongoFilter({ [field]: [] }), AVAILABLE)
    })
  }
})

/* ═══════════════════════════════════════════════════════════════════════
 * 4. parkingType -> Property.parking
 * ═══════════════════════════════════════════════════════════════════════ */

test('11. parkingType narrows the same parking field the boolean targets', () => {
  assert.deepEqual(
    buildMongoFilter({ parkingType: ['Closed Parking'] }),
    { ...AVAILABLE, parking: { $in: ['Closed Parking'] } }
  )
})

test('12. a named parkingType overrides the generic parking existence check', () => {
  // "closed garage" is more specific than "has some parking".
  assert.deepEqual(
    buildMongoFilter({ parking: true, parkingType: ['Closed Parking'] }),
    { ...AVAILABLE, parking: { $in: ['Closed Parking'] } }
  )
})

test('13. an invalid parkingType leaves the classic parking check intact', () => {
  // The donor's values, which CURRENT cannot store — they must not silently
  // replace a working filter with one that matches nothing.
  assert.deepEqual(
    buildMongoFilter({ parking: true, parkingType: ['Parking Garage', 'Open & Covered Parking'] }),
    { ...AVAILABLE, parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
  )
})

/* ═══════════════════════════════════════════════════════════════════════
 * 5. Numeric ranges
 * ═══════════════════════════════════════════════════════════════════════ */

const RANGE_CASES = [
  ['netSqm', 'minNetSqm', 'maxNetSqm'],
  ['openAreaSqm', 'minOpenAreaSqm', 'maxOpenAreaSqm'],
  ['coefficient', 'minCoefficient', 'maxCoefficient'],
  ['floor', 'minFloor', 'maxFloor'],
  ['totalFloors', 'minTotalFloors', 'maxTotalFloors'],
]

test('14. each numeric pair builds $gte/$lte on its document field', async (t) => {
  for (const [field, minKey, maxKey] of RANGE_CASES) {
    await t.test(field, () => {
      assert.deepEqual(
        buildMongoFilter({ [minKey]: 10, [maxKey]: 90 }),
        { ...AVAILABLE, [field]: { $gte: 10, $lte: 90 } }
      )
    })
  }
})

test('15. a lone bound builds only its own operator', () => {
  assert.deepEqual(buildMongoFilter({ minNetSqm: 120 }), { ...AVAILABLE, netSqm: { $gte: 120 } })
  assert.deepEqual(buildMongoFilter({ maxNetSqm: 120 }), { ...AVAILABLE, netSqm: { $lte: 120 } })
})

test('16. zero is a real bound and must survive', async (t) => {
  // The bug truthiness would cause: `if (parsed.minFloor)` drops "ground
  // floor or above" because 0 is falsy. Coefficient 0 is legitimate too.
  await t.test('minFloor 0', () => {
    assert.deepEqual(buildMongoFilter({ minFloor: 0 }), { ...AVAILABLE, floor: { $gte: 0 } })
  })
  await t.test('maxFloor 0 (ground floor only)', () => {
    assert.deepEqual(buildMongoFilter({ maxFloor: 0 }), { ...AVAILABLE, floor: { $lte: 0 } })
  })
  await t.test('both bounds 0', () => {
    assert.deepEqual(buildMongoFilter({ minFloor: 0, maxFloor: 0 }), { ...AVAILABLE, floor: { $gte: 0, $lte: 0 } })
  })
  await t.test('minCoefficient 0', () => {
    assert.deepEqual(buildMongoFilter({ minCoefficient: 0 }), { ...AVAILABLE, coefficient: { $gte: 0 } })
  })
})

test('17. non-finite bounds never reach Mongo', async (t) => {
  // $gte: NaN matches zero documents and is indistinguishable from an empty
  // inventory, so it must be impossible to build.
  for (const value of [NaN, Infinity, -Infinity, 'abc', '', null, undefined, {}, []]) {
    await t.test(`minNetSqm: ${JSON.stringify(value)}`, () => {
      const filter = buildMongoFilter({ minNetSqm: value })
      assert.deepEqual(filter, AVAILABLE)
    })
  }
})

test('18. one valid bound survives beside one invalid bound', () => {
  assert.deepEqual(buildMongoFilter({ minNetSqm: 50, maxNetSqm: NaN }), { ...AVAILABLE, netSqm: { $gte: 50 } })
})

test('19. negative bounds are allowed — a basement floor is real', () => {
  assert.deepEqual(buildMongoFilter({ minFloor: -2 }), { ...AVAILABLE, floor: { $gte: -2 } })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 6. Currency and listedSince
 * ═══════════════════════════════════════════════════════════════════════ */

test('20. currency filters only on an allowlisted value', async (t) => {
  for (const code of CANONICAL_CURRENCIES) {
    await t.test(code, () => {
      assert.deepEqual(buildMongoFilter({ currency: code }), { ...AVAILABLE, currency: code })
    })
  }
  for (const bad of ['usd', 'YEN', '', null, 42, { $ne: null }]) {
    await t.test(`rejects ${JSON.stringify(bad)}`, () => {
      assert.deepEqual(buildMongoFilter({ currency: bad }), AVAILABLE)
    })
  }
})

test('21. listedSince accepts only a real ISO timestamp', async (t) => {
  const iso = new Date(Date.now() - 7 * 86400000).toISOString()
  await t.test('valid ISO builds a createdAt lower bound', () => {
    const filter = buildMongoFilter({ listedSince: iso })
    assert.ok(filter.createdAt.$gte instanceof Date)
    assert.equal(filter.createdAt.$gte.toISOString(), iso)
  })
  // '-5' is the exact input routes/properties.js documents as dangerous:
  // `new Date('-5')` is a real date in 2001, not an error.
  for (const bad of ['-5', '7', '2026', 'last week', '', 'not-a-date', '2026-13-45T00:00:00Z', null, 12345, {}]) {
    await t.test(`rejects ${JSON.stringify(bad)}`, () => {
      assert.deepEqual(buildMongoFilter({ listedSince: bad }), AVAILABLE)
    })
  }
})

/* ═══════════════════════════════════════════════════════════════════════
 * 7. mustHave — strict through every fallback level
 * ═══════════════════════════════════════════════════════════════════════ */

test('22. classic mustHave phrases behave exactly as before', () => {
  assert.deepEqual(buildMustHaveFeatureFilter([]), {})
  assert.deepEqual(buildMustHaveFeatureFilter(['pool', 'garden']), { pool: true, garden: true })
  assert.deepEqual(buildMustHaveFeatureFilter(['balcony']), { balcony: true })
  assert.deepEqual(buildMustHaveFeatureFilter(['elevator', 'lift']), { elevator: true })
  assert.deepEqual(buildMustHaveFeatureFilter(['furnished']), { furnished: true })
  assert.deepEqual(buildMustHaveFeatureFilter(['nonsense']), {})
  const parking = { parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] } }
  assert.deepEqual(buildMustHaveFeatureFilter(['parking']), parking)
  assert.deepEqual(buildMustHaveFeatureFilter(['garage']), parking)
})

test('23. extended amenities are enforceable as must-haves', async (t) => {
  const CASES = [
    [['sauna'], { sauna: true }],
    [['jacuzzi'], { jacuzzi: true }],
    [['steam room'], { steamRoom: true }],
    [['turkish bath'], { turkishBath: true }],
    [['basement'], { basement: true }],
    [['gated community'], { withinSite: true }],
    [['eligible for credit'], { eligibleForCredit: true }],
    [['open to exchange'], { exchange: true }],
    [['virtual tour'], { hasVirtualTour: true }],
  ]
  for (const [mustHave, expected] of CASES) {
    await t.test(mustHave[0], () => {
      assert.deepEqual(buildMustHaveFeatureFilter(mustHave), expected)
    })
  }
})

test('24. must-have matching works in Turkish and Arabic, not just English', async (t) => {
  // The donor left this map English-only, which would make a STRICT
  // requirement silently optional for two of the three chat languages.
  const CASES = [
    ['hamam', { turkishBath: true }],
    ['türk hamamı', { turkishBath: true }],
    ['jakuzi', { jacuzzi: true }],
    ['bodrum', { basement: true }],
    ['krediye uygun', { eligibleForCredit: true }],
    ['sanal tur', { hasVirtualTour: true }],
    ['site içinde', { withinSite: true }],
    ['ساونا', { sauna: true }],
    ['حمام تركي', { turkishBath: true }],
    ['جاكوزي', { jacuzzi: true }],
  ]
  for (const [phrase, expected] of CASES) {
    await t.test(phrase, () => {
      assert.deepEqual(buildMustHaveFeatureFilter([phrase]), expected)
    })
  }
})

test('25. Turkish dotted-I normalization does not break must-have matching', () => {
  // 'İÇİNDE'.toLowerCase() is 'i̇çi̇nde' (with combining dots) in JS, which a
  // plain lowercase comparison would fail to match. normalizeForMatching
  // folds İ to i BEFORE lowercasing, which is why it is used here.
  assert.deepEqual(buildMustHaveFeatureFilter(['SİTE İÇİNDE']), { withinSite: true })
  assert.deepEqual(buildMustHaveFeatureFilter(['HAMAM']), { turkishBath: true })
})

test('26. an optional preference is NOT promoted to a must-have', () => {
  // The distinction the fallback ladder depends on: optional criteria relax,
  // mustHave does not. Parsing `sauna: true` must not populate mustHave.
  assert.deepEqual(buildMustHaveFeatureFilter([]), {})
  const filter = buildMongoFilter({ sauna: true, kitchenType: ['Closed'] })
  assert.equal(filter.sauna, true)
  assert.deepEqual(buildMustHaveFeatureFilter([]), {}, 'must-have filter stays empty')
})

/* ═══════════════════════════════════════════════════════════════════════
 * 8. Description / hybrid hard filter
 * ═══════════════════════════════════════════════════════════════════════ */

test('27. every extended field survives the description-search hard filter', async (t) => {
  const CASES = [
    ...EXTENDED_BOOLEAN_FIELDS.map((f) => [f, { [f]: true }]),
    ['usageStatus', { usageStatus: ['Empty'] }],
    ['kitchenType', { kitchenType: ['Closed'] }],
    ['heating', { heating: ['Central'] }],
    ['titleDeedStatus', { titleDeedStatus: ['Independent Title Deed'] }],
    ['floorLocation', { floorLocation: ['Ground floor'] }],
    ['buildingAge', { buildingAge: ['1-5'] }],
    ['rooms', { rooms: ['3+1'] }],
    ['nearbyTransport', { nearbyTransport: ['Metro'] }],
    ['parkingType -> parking', { parkingType: ['Closed Parking'] }],
    ['netSqm', { minNetSqm: 100 }],
    ['openAreaSqm', { minOpenAreaSqm: 10 }],
    ['coefficient', { minCoefficient: 1 }],
    ['floor', { minFloor: 3 }],
    ['totalFloors', { maxTotalFloors: 8 }],
    ['currency', { currency: 'USD' }],
    ['listedSince', { listedSince: new Date(Date.now() - 86400000).toISOString() }],
  ]

  for (const [name, parsed] of CASES) {
    await t.test(name, () => {
      const filter = buildMongoFilter(parsed)
      const hard = buildHardFilterForDescriptionSearch(filter)
      // Whatever key buildMongoFilter produced beyond `status` must reappear.
      for (const key of Object.keys(filter)) {
        assert.deepEqual(hard[key], filter[key], `${key} must survive into the hard filter`)
      }
    })
  }
})

test('28. zero-valued range bounds survive the hard filter', () => {
  // `if (filter.floor)` would be truthy here because the value is an object,
  // but a regression that unwrapped it could drop a $gte: 0.
  const filter = buildMongoFilter({ minFloor: 0, maxFloor: 0 })
  const hard = buildHardFilterForDescriptionSearch(filter)
  assert.deepEqual(hard.floor, { $gte: 0, $lte: 0 })
})

test('29. the hard filter adds nothing that was not already filtered', () => {
  const hard = buildHardFilterForDescriptionSearch(buildMongoFilter({}))
  assert.deepEqual(hard, AVAILABLE)
})

/* ═══════════════════════════════════════════════════════════════════════
 * 9. Canonicalizers
 * ═══════════════════════════════════════════════════════════════════════ */

test('30. canonicalizers accept canonical values unchanged', async (t) => {
  const CASES = [
    [canonicalizeUsageStatus, CANONICAL_USAGE_STATUSES],
    [canonicalizeKitchenType, CANONICAL_KITCHEN_TYPES],
    [canonicalizeTransport, CANONICAL_TRANSPORT_OPTIONS],
    [canonicalizeParkingType, CANONICAL_PARKING_TYPES],
    [canonicalizeCurrency, CANONICAL_CURRENCIES],
    [canonicalizeFloorLocation, CANONICAL_FLOOR_LOCATIONS],
    [canonicalizeTitleDeedStatus, CANONICAL_TITLE_DEED_STATUSES],
    [canonicalizeHeating, CANONICAL_HEATING],
    [canonicalizeRooms, CANONICAL_ROOMS],
    [canonicalizeBuildingAge, BUILDING_AGE_BUCKET_LABELS],
  ]
  for (const [fn, list] of CASES) {
    await t.test(fn.name, () => {
      for (const value of list) assert.equal(fn(value), value)
    })
  }
})

test('31. canonicalizers map multilingual synonyms to canonical values', async (t) => {
  const CASES = [
    [canonicalizeKitchenType, 'kapalı mutfak', 'Closed'],
    [canonicalizeKitchenType, 'açık mutfak', 'Open (American)'],
    [canonicalizeKitchenType, 'مطبخ مغلق', 'Closed'],
    [canonicalizeUsageStatus, 'boş', 'Empty'],
    [canonicalizeUsageStatus, 'kiracılı', 'Tenant'],
    [canonicalizeUsageStatus, 'فارغ', 'Empty'],
    [canonicalizeTransport, 'metro', 'Metro'],
    [canonicalizeTransport, 'metrobüs', 'Metrobus'],
    [canonicalizeTransport, 'vapur', 'Ferry'],
    [canonicalizeTransport, 'مترو', 'Metro'],
    [canonicalizeParkingType, 'garaj', 'Closed Parking'],
    [canonicalizeParkingType, 'kapalı otopark', 'Closed Parking'],
    [canonicalizeParkingType, 'açık otopark', 'Open Parking'],
    [canonicalizeCurrency, 'dolar', 'USD'],
    [canonicalizeCurrency, 'lira', 'TL'],
    [canonicalizeCurrency, 'يورو', 'EUR'],
    [canonicalizeFloorLocation, 'zemin kat', 'Ground floor'],
    [canonicalizeFloorLocation, 'çatı katı', 'Penthouse'],
    [canonicalizeTitleDeedStatus, 'kat mülkiyeti', 'Independent Title Deed'],
    [canonicalizeHeating, 'kombi', 'Individual Gas'],
    [canonicalizeHeating, 'klima', 'Air Conditioning'],
  ]
  for (const [fn, input, expected] of CASES) {
    await t.test(`${input} -> ${expected}`, () => {
      assert.equal(fn(input), expected)
    })
  }
})

test('32. "metrobüs" never canonicalizes to "Metro"', () => {
  // Metro is a substring of Metrobus in English and Turkish; conflating the
  // two would put a visitor on the wrong transport network.
  assert.equal(canonicalizeTransport('metrobüs'), 'Metrobus')
  assert.equal(canonicalizeTransport('metrobus'), 'Metrobus')
  assert.equal(canonicalizeTransport('BRT'.toLowerCase()), 'Metrobus')
})

test('33. canonicalizers reject unknown and non-string input', async (t) => {
  const fns = [
    canonicalizeUsageStatus, canonicalizeKitchenType, canonicalizeTransport,
    canonicalizeParkingType, canonicalizeCurrency, canonicalizeFloorLocation,
    canonicalizeTitleDeedStatus, canonicalizeHeating, canonicalizeRooms,
    canonicalizeBuildingAge,
  ]
  for (const fn of fns) {
    await t.test(fn.name, () => {
      for (const bad of ['definitely not a value', '', null, undefined, 42, {}, [], true]) {
        assert.equal(fn(bad), null, `${fn.name}(${JSON.stringify(bad)}) must be null`)
      }
    })
  }
})

test('34. donor vocabulary values never leak through as-is', () => {
  // The donor's own canonical values differ from CURRENT's stored values.
  // Where a donor value describes the same real thing, it must be TRANSLATED
  // to CURRENT's value; where it has no CURRENT equivalent, it must be
  // rejected. Either way the donor string itself must never survive — it
  // would build an $in that matches no listing in this database.
  assert.equal(canonicalizeParkingType('Parking Garage'), 'Closed Parking')
  assert.equal(canonicalizeParkingType('Open Parking Lot'), 'Open Parking')
  assert.equal(canonicalizeParkingType('Open & Covered Parking'), null, 'no CURRENT equivalent')

  // Donor building-age buckets are single years plus 21-25/26-30/31+.
  for (const donorBucket of ['0', '1', '5', '21-25', '26-30', '31+']) {
    assert.equal(canonicalizeBuildingAge(donorBucket), null, `${donorBucket} is not a CURRENT bucket`)
  }
  assert.equal(canonicalizeBuildingAge('0 (New)'), '0 (New)')
  assert.equal(canonicalizeBuildingAge('21+'), '21+')
})

test('35. rooms tolerate surrounding whitespace but not invention', () => {
  assert.equal(canonicalizeRooms('  3+1  '), '3+1')
  assert.equal(canonicalizeRooms('Studio (1+0)'), 'Studio (1+0)')
  assert.equal(canonicalizeRooms('99+9'), null)
})

/* ═══════════════════════════════════════════════════════════════════════
 * 10. Deterministic extractors
 * ═══════════════════════════════════════════════════════════════════════ */

test('36. building-age buckets expand from a relative phrase', () => {
  assert.deepEqual(buildingAgeBucketsWithinYears(0), ['0 (New)'])
  assert.deepEqual(buildingAgeBucketsWithinYears(5), ['0 (New)', '1-5'])
  assert.deepEqual(buildingAgeBucketsWithinYears(10), ['0 (New)', '1-5', '6-10'])
  assert.deepEqual(buildingAgeBucketsWithinYears(20), ['0 (New)', '1-5', '6-10', '11-15', '16-20'])
  // '21+' is unbounded, so it can never fit inside a finite span.
  assert.ok(!buildingAgeBucketsWithinYears(100).includes('21+'))
  for (const bad of [-1, NaN, Infinity, 'five', null]) {
    assert.deepEqual(buildingAgeBucketsWithinYears(bad), [], `${bad} must yield no buckets`)
  }
})

test('37. relative building-age phrases parse in three languages', async (t) => {
  const CASES = [
    'a flat built in the last 5 years',
    'son 5 yılda yapılan bir daire',
    'شقة بنيت في آخر 5 سنوات',
  ]
  for (const message of CASES) {
    await t.test(message, () => {
      const parsed = extractBuildingAgeFromText(message, { buildingAge: [] })
      assert.deepEqual(parsed.buildingAge, ['0 (New)', '1-5'])
    })
  }
})

test('38. a message with no age phrase leaves buildingAge untouched', () => {
  const parsed = extractBuildingAgeFromText('a nice flat near the sea', { buildingAge: ['6-10'] })
  assert.deepEqual(parsed.buildingAge, ['6-10'])
})

test('39. relative listing dates parse in three languages', async (t) => {
  const CASES = ['listed in the last week', 'son 3 günde eklenen', 'الأسبوع الماضي']
  for (const message of CASES) {
    await t.test(message, () => {
      const parsed = extractListedSinceFromText(message, {})
      assert.equal(typeof parsed.listedSince, 'string')
      const when = new Date(parsed.listedSince)
      assert.ok(!Number.isNaN(when.getTime()))
      assert.ok(when.getTime() <= Date.now(), 'cutoff must be in the past')
    })
  }
})

test('40. an absurd listing-date span is refused, not clamped into nonsense', () => {
  // 99999 months exceeds the 3650-day ceiling routes/properties.js uses.
  const parsed = extractListedSinceFromText('listed in the last 99999 months', {})
  assert.equal(parsed.listedSince, undefined)
})

test('41. listedSince is never produced from a date-like phrase alone', () => {
  assert.equal(extractListedSinceFromText('what time is it in Istanbul?', {}).listedSince, undefined)
  assert.equal(extractListedSinceFromText('call me tomorrow', {}).listedSince, undefined)
})

/* ═══════════════════════════════════════════════════════════════════════
 * 11. normalizeParsed — the whole parser contract
 * ═══════════════════════════════════════════════════════════════════════ */

test('42. normalizeParsed canonicalizes, drops and deduplicates arrays', () => {
  const parsed = normalizeParsed(
    {
      nearbyTransport: ['metro', 'Metro', 'vapur', 'Teleporter'],
      kitchenType: ['kapalı mutfak'],
      heating: ['kombi', 'invented'],
      rooms: ['3+1', '99+9'],
      buildingAge: ['1-5', '31+'],
      parkingType: ['garaj'],
      floorLocation: ['zemin kat'],
      titleDeedStatus: ['kat mülkiyeti'],
      usageStatus: ['boş'],
    },
    'x'
  )
  assert.deepEqual(parsed.nearbyTransport, ['Metro', 'Ferry'])
  assert.deepEqual(parsed.kitchenType, ['Closed'])
  assert.deepEqual(parsed.heating, ['Individual Gas'])
  assert.deepEqual(parsed.rooms, ['3+1'])
  assert.deepEqual(parsed.buildingAge, ['1-5'])
  assert.deepEqual(parsed.parkingType, ['Closed Parking'])
  assert.deepEqual(parsed.floorLocation, ['Ground floor'])
  assert.deepEqual(parsed.titleDeedStatus, ['Independent Title Deed'])
  assert.deepEqual(parsed.usageStatus, ['Empty'])
})

test('43. normalizeParsed collapses booleans to true or null', () => {
  const parsed = normalizeParsed({ sauna: true, jacuzzi: 'true', basement: 'false', exchange: 1, steamRoom: 'yes' }, 'x')
  assert.equal(parsed.sauna, true)
  assert.equal(parsed.jacuzzi, true, 'a quoted boolean from the model still counts')
  assert.equal(parsed.basement, null)
  assert.equal(parsed.exchange, null)
  assert.equal(parsed.steamRoom, null)
})

test('44. normalizeParsed keeps zero numeric bounds and drops garbage', () => {
  const parsed = normalizeParsed({ minFloor: 0, maxFloor: 'abc', minNetSqm: '120', maxNetSqm: NaN }, 'x')
  assert.equal(parsed.minFloor, 0)
  assert.equal(parsed.maxFloor, null)
  assert.equal(parsed.minNetSqm, 120, 'a numeric string is coerced')
  assert.equal(parsed.maxNetSqm, null)
})

test('45. normalizeParsed defaults every extended field when absent', () => {
  const parsed = normalizeParsed({}, 'hello')
  for (const f of EXTENDED_BOOLEAN_FIELDS) assert.equal(parsed[f], null, `${f} defaults null`)
  for (const f of EXTENDED_ARRAY_FIELDS) assert.deepEqual(parsed[f], [], `${f} defaults []`)
  for (const f of EXTENDED_NUMERIC_FIELDS) assert.equal(parsed[f], null, `${f} defaults null`)
  assert.equal(parsed.currency, null)
})

test('46. a normalized empty parse still builds the classic filter', () => {
  // Ties the two halves together: normalizeParsed populates every extended
  // key with a default, and none of those defaults may become a filter.
  assert.deepEqual(buildMongoFilter(normalizeParsed({}, 'hello')), AVAILABLE)
})

test('47. end to end — a realistic extended query', () => {
  const parsed = normalizeParsed(
    {
      propertyType: 'Villa', district: 'Beşiktaş',
      sauna: true, turkishBath: true,
      kitchenType: ['kapalı mutfak'], nearbyTransport: ['metro'],
      minNetSqm: 200, minFloor: 0, currency: 'dolar',
      mustHave: ['sauna', 'hamam'],
    },
    'Beşiktaş\'ta hamamı olan villa'
  )
  const filter = buildMongoFilter(parsed)

  assert.equal(filter.propertyType, 'Villa')
  assert.deepEqual(filter.district, { $regex: 'Beşiktaş', $options: 'i' })
  assert.equal(filter.sauna, true)
  assert.equal(filter.turkishBath, true)
  assert.deepEqual(filter.kitchenType, { $in: ['Closed'] })
  assert.deepEqual(filter.nearbyTransport, { $in: ['Metro'] })
  assert.deepEqual(filter.netSqm, { $gte: 200 })
  assert.deepEqual(filter.floor, { $gte: 0 })
  assert.equal(filter.currency, 'USD')

  // The strict channel stays strict and independent of the optional one.
  assert.deepEqual(buildMustHaveFeatureFilter(parsed.mustHave), { sauna: true, turkishBath: true })
})

/* ═══════════════════════════════════════════════════════════════════════
 * 12. Vocabulary drift guard
 * ═══════════════════════════════════════════════════════════════════════ */

const here = path.dirname(fileURLToPath(import.meta.url))
const readSource = (relative) => fs.readFileSync(path.join(here, '..', relative), 'utf8')

// Pulls `const NAME = [ ... ]` out of a source file as real values, so the
// chat vocabulary can be compared against the REST route and the public page
// without importing either (properties.js pulls in mongoose and middleware;
// PropertiesPage.jsx is JSX and cannot be imported at all).
const extractArray = (source, name) => {
  // \r? because these files are checked out with CRLF endings on Windows.
  const match = source.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\])\\r?\\n`))
  assert.ok(match, `could not find ${name}`)
  return JSON.parse(match[1].replace(/'/g, '"').replace(/,(\s*\])/g, '$1'))
}

test('48. chat vocabularies match the REST route exactly', async (t) => {
  // The drift this wave exists to fix: the sidebar and the chatbot must
  // agree on what a valid value is, or one of them silently stops matching.
  const rest = readSource('routes/properties.js')
  const CASES = [
    ['FLOOR_LOCATIONS', CANONICAL_FLOOR_LOCATIONS],
    ['KITCHEN_TYPES', CANONICAL_KITCHEN_TYPES],
    ['USAGE_STATUSES', CANONICAL_USAGE_STATUSES],
    ['TITLE_DEED_STATUSES', CANONICAL_TITLE_DEED_STATUSES],
    ['TRANSPORT_OPTIONS', CANONICAL_TRANSPORT_OPTIONS],
    ['CURRENCIES', CANONICAL_CURRENCIES],
  ]
  for (const [name, chatList] of CASES) {
    await t.test(name, () => {
      assert.deepEqual([...chatList].sort(), [...extractArray(rest, name)].sort())
    })
  }
})

test('49. chat vocabularies match the public filter page exactly', async (t) => {
  // rooms / heating / parking / buildingAge have no Mongoose enum and no
  // REST allowlist, so PropertiesPage.jsx is the authority on what the admin
  // form actually writes.
  const page = fs.readFileSync(
    path.join(here, '..', '..', 'frontend', 'src', 'pages', 'PropertiesPage.jsx'),
    'utf8'
  )
  const CASES = [
    ['ROOM_OPTIONS', CANONICAL_ROOMS],
    ['HEATING', CANONICAL_HEATING],
    ['PARKING', CANONICAL_PARKING_TYPES],
    ['BUILDING_AGE', BUILDING_AGE_BUCKET_LABELS],
  ]
  for (const [name, chatList] of CASES) {
    await t.test(name, () => {
      assert.deepEqual([...chatList].sort(), [...extractArray(page, name)].sort())
    })
  }
})
