// Focused unit tests for saved-alert matching and validation.
//
// Pure functions only — no database, no network, nothing created or deleted.
// Run with:  node scripts/testPropertyAlertMatching.js

import { propertyMatchesAlert, validateAlertPayload } from '../services/propertyAlerts.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, expected ${expected})`}`)
}

// The worked example from the spec.
const sariyerAlert = {
  listingType: 'Sale',
  district: 'Sarıyer',
  propertyType: 'Apartment',
  minPrice: 5_000_000,
  maxPrice: 15_000_000,
  minBeds: 3,
}

const base = {
  listingType: 'Sale',
  district: 'Sarıyer',
  propertyType: 'Apartment',
  price: 11_500_000,
  beds: 3,
}

console.log('\n== matching: the spec example ==')
check('exact match', propertyMatchesAlert(base, sariyerAlert), true)
check('wrong district (Kadıköy)', propertyMatchesAlert({ ...base, district: 'Kadıköy' }, sariyerAlert), false)
check('wrong listingType (Rent)', propertyMatchesAlert({ ...base, listingType: 'Rent' }, sariyerAlert), false)
check('too few bedrooms (2)', propertyMatchesAlert({ ...base, beds: 2 }, sariyerAlert), false)
check('wrong propertyType (Villa)', propertyMatchesAlert({ ...base, propertyType: 'Villa' }, sariyerAlert), false)

console.log('\n== price bounds are inclusive ==')
check('price == minPrice', propertyMatchesAlert({ ...base, price: 5_000_000 }, sariyerAlert), true)
check('price == maxPrice', propertyMatchesAlert({ ...base, price: 15_000_000 }, sariyerAlert), true)
check('price below min', propertyMatchesAlert({ ...base, price: 4_999_999 }, sariyerAlert), false)
check('price above max', propertyMatchesAlert({ ...base, price: 15_000_001 }, sariyerAlert), false)

console.log('\n== minBeds is a MINIMUM, not equality ==')
check('more bedrooms than asked (5)', propertyMatchesAlert({ ...base, beds: 5 }, sariyerAlert), true)

console.log('\n== absent criteria are ignored, not required ==')
check('district-only alert matches any price', propertyMatchesAlert(base, { district: 'Sarıyer' }), true)
check('district-only alert rejects other district', propertyMatchesAlert({ ...base, district: 'Beşiktaş' }, { district: 'Sarıyer' }), false)
check('listingType-only alert', propertyMatchesAlert(base, { listingType: 'Sale' }), true)
check('minPrice-only alert', propertyMatchesAlert(base, { minPrice: 10_000_000 }), true)

console.log('\n== district matching is exact and case-sensitive ==')
check('lowercase variant does NOT match', propertyMatchesAlert({ ...base, district: 'sarıyer' }, sariyerAlert), false)

console.log('\n== defensive ==')
check('null property', propertyMatchesAlert(null, sariyerAlert), false)
check('null alert', propertyMatchesAlert(base, null), false)
check('non-numeric price vs price bound', propertyMatchesAlert({ ...base, price: undefined }, sariyerAlert), false)
check('missing beds vs minBeds', propertyMatchesAlert({ ...base, beds: undefined }, sariyerAlert), false)

console.log('\n== validation ==')
const ok = validateAlertPayload({ listingType: 'Sale', district: 'Sarıyer', minBeds: 3 })
check('valid payload has no errors', ok.errors.length, 0)
check('valid payload keeps district', ok.value.district, 'Sarıyer')

check('empty alert rejected', validateAlertPayload({}).errors.length > 0, true)
check('negative minPrice rejected', validateAlertPayload({ minPrice: -1 }).errors.length > 0, true)
check('negative maxPrice rejected', validateAlertPayload({ maxPrice: -5 }).errors.length > 0, true)
check('min > max rejected', validateAlertPayload({ minPrice: 900, maxPrice: 100 }).errors.length > 0, true)
check('min == max allowed', validateAlertPayload({ minPrice: 500, maxPrice: 500 }).errors.length, 0)
check('bad listingType rejected', validateAlertPayload({ listingType: 'Lease' }).errors.length > 0, true)
check('bad propertyType rejected', validateAlertPayload({ propertyType: 'Castle' }).errors.length > 0, true)
check('fractional minBeds rejected', validateAlertPayload({ minBeds: 2.5 }).errors.length > 0, true)
check('negative minBeds rejected', validateAlertPayload({ minBeds: -1 }).errors.length > 0, true)
check('non-numeric price rejected', validateAlertPayload({ minPrice: 'cheap' }).errors.length > 0, true)

// Ownership cannot be smuggled in through the payload.
const injected = validateAlertPayload({ district: 'Sarıyer', user: 'someone-else', _id: 'forged' })
check('user stripped from payload', injected.value.user, undefined)
check('_id stripped from payload', injected.value._id, undefined)

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
