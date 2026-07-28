// backend/scripts/testChatReplyPlan.js
//
// Phase 3 (backend deterministic reply localization) — focused, fully
// deterministic tests for services/chatReplyPlan.js: the two
// language-independent reply plans (search-result, match-reason), purity
// (no mutation of inputs), and — critically — that plans carry no
// visitor-facing prose, only ids/booleans/numbers a renderer can localize.
// No DB connection, no Gemini call, no network.
//
// Usage: node scripts/testChatReplyPlan.js

import {
  buildSearchResultPlan,
  buildMatchReasonPlan,
  getRelaxedFeatureIds,
  evaluateSoftMatchForProperty,
  hasMultiplePropertyTypes,
} from '../services/chatReplyPlan.js'

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

// A plan field counts as "prose" if it's a string containing a space AND is
// not one of the known data fields (descriptionQuery/propertyDistrict echo
// visitor/DB text verbatim — that's data, not authored prose — so they're
// allowed to contain spaces). Every OTHER string field must be a bare
// enum/id (no spaces) or null.
const ALLOWED_MULTI_WORD_STRING_FIELDS = new Set(['descriptionQuery', 'propertyDistrict'])

const assertNoProseStrings = (label, plan) => {
  const offending = []

  const walk = (obj, path) => {
    if (obj === null || obj === undefined) return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => walk(value, path ? `${path}.${key}` : key))
      return
    }
    if (typeof obj === 'string' && / /.test(obj)) {
      const leafKey = path.split('.').pop().replace(/\[\d+\]$/, '')
      if (!ALLOWED_MULTI_WORD_STRING_FIELDS.has(leafKey)) {
        offending.push(`${path}="${obj}"`)
      }
    }
  }

  walk(plan, '')
  assertTrue(`${label} (no unexpected multi-word strings: ${offending.join(', ') || 'none'})`, offending.length === 0)
}

line()
console.log('buildSearchResultPlan — no_results')
line()

const noResultsPlan = buildSearchResultPlan({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: false })
assertEqual('type is no_results', noResultsPlan.type, 'no_results')
assertEqual('descriptionSearchAttempted carried through', noResultsPlan.descriptionSearchAttempted, false)
assertEqual('followUp is null when not passed', noResultsPlan.followUp, null)
assertNoProseStrings('no_results plan', noResultsPlan)

const noResultsWithFollowUp = buildSearchResultPlan({
  properties: [],
  fallbackLevel: 0,
  parsed: {},
  descriptionSearchAttempted: true,
  followUp: { offerSlot: 'district', reOffer: true },
})
assertEqual('followUp offerSlot carried through', noResultsWithFollowUp.followUp, { offerSlot: 'district', reOffer: true })

line()
console.log('buildSearchResultPlan — soft_match')
line()

const softMatchProperties = [
  { title: 'Sea view villa', description: 'near schools and quiet', district: 'Beylikdüzü' },
  { title: 'City apartment', description: 'busy area', district: 'Esenyurt' },
]

const softMatchPlan = buildSearchResultPlan({
  properties: softMatchProperties,
  fallbackLevel: 0,
  parsed: { descriptionQuery: 'near schools', lifestyle: ['near schools'], listingType: 'Sale' },
  matchedViaDescription: true,
  matchedViaSemantic: false,
})

assertEqual('type is soft_match', softMatchPlan.type, 'soft_match')
assertEqual('count matches properties length', softMatchPlan.count, 2)
assertTrue('verifiedCount is a number', typeof softMatchPlan.verifiedCount === 'number')
assertEqual('listingType carried through as canonical enum', softMatchPlan.listingType, 'Sale')
assertTrue('requestedConceptIds is an array', Array.isArray(softMatchPlan.requestedConceptIds))
assertTrue('requestedConceptIds contains only bare ids (no spaces)', softMatchPlan.requestedConceptIds.every((id) => !/ /.test(id)))
assertNoProseStrings('soft_match plan', softMatchPlan)

const semanticPlan = buildSearchResultPlan({
  properties: softMatchProperties,
  fallbackLevel: 0,
  parsed: { descriptionQuery: 'peaceful family home' },
  matchedViaSemantic: true,
})
assertEqual('matchedViaSemantic -> verifiedCount === count (all trusted)', semanticPlan.verifiedCount, semanticPlan.count)
assertEqual('matchedViaSemantic -> noneVerified is always false', semanticPlan.noneVerified, false)

line()
console.log('buildSearchResultPlan — structured')
line()

const structuredPlan = buildSearchResultPlan({
  properties: [{ _id: '1' }, { _id: '2' }, { _id: '3' }],
  fallbackLevel: 1,
  parsed: { listingType: 'Rent', propertyType: 'Villa', district: 'Kadıköy', maxPrice: 25000 },
  relaxedFeatureIds: ['pool', 'garden'],
})

assertEqual('type is structured', structuredPlan.type, 'structured')
assertEqual('count matches properties length', structuredPlan.count, 3)
assertEqual('fallbackLevel carried through', structuredPlan.fallbackLevel, 1)
assertEqual('propertyType carried through as canonical enum', structuredPlan.propertyType, 'Villa')
assertEqual('districts array built from single district', structuredPlan.districts, ['Kadıköy'])
assertEqual('relaxedFeatureIds carried through as ids (fallbackLevel > 0)', structuredPlan.relaxedFeatureIds, ['pool', 'garden'])
assertTrue('relaxedFeatureIds contains only bare ids (no spaces)', structuredPlan.relaxedFeatureIds.every((id) => !/ /.test(id)))
assertNoProseStrings('structured plan', structuredPlan)

const exactLevelPlan = buildSearchResultPlan({
  properties: [{ _id: '1' }],
  fallbackLevel: 0,
  parsed: { listingType: 'Sale' },
  relaxedFeatureIds: ['pool'],
})
assertEqual('relaxedFeatureIds dropped when fallbackLevel === 0 (nothing was actually relaxed)', exactLevelPlan.relaxedFeatureIds, [])

const multiTypePlan = buildSearchResultPlan({
  properties: [{ _id: '1' }],
  fallbackLevel: 0,
  parsed: { propertyTypes: ['Apartment', 'Villa'] },
})
assertEqual('multi-type: propertyType is null, propertyTypes carries the array', multiTypePlan.propertyType, null)
assertEqual('multi-type: propertyTypes array carried through', multiTypePlan.propertyTypes, ['Apartment', 'Villa'])

line()
console.log('buildMatchReasonPlan — verified structured criteria')
line()

const property = {
  propertyType: 'Villa', listingType: 'Sale', district: 'Büyükçekmece',
  beds: 3, baths: 2, price: 5000000, pool: true, garden: true,
}
const parsedStructured = { propertyType: 'Villa', listingType: 'Sale', district: 'Büyükçekmece', beds: 3, baths: 2, maxPrice: 6000000, pool: true }

const structuredReasonPlan = buildMatchReasonPlan(property, parsedStructured, false, false)

assertEqual('propertyTypeMatches true', structuredReasonPlan.propertyTypeMatches, true)
assertEqual('listingTypeMatches true', structuredReasonPlan.listingTypeMatches, true)
assertEqual('districtMatches true', structuredReasonPlan.districtMatches, true)
assertEqual('bedsMatches true', structuredReasonPlan.bedsMatches, true)
assertEqual('bathsMatches true', structuredReasonPlan.bathsMatches, true)
assertEqual('budgetMatches true (within maxPrice)', structuredReasonPlan.budgetMatches, true)
assertEqual('matchedFeatureIds contains pool only (garden not requested)', structuredReasonPlan.matchedFeatureIds, ['pool'])
assertEqual('matchedConceptIds empty (no soft search ran)', structuredReasonPlan.matchedConceptIds, [])
assertEqual('unverifiedConceptId null (no soft search ran)', structuredReasonPlan.unverifiedConceptId, null)
assertNoProseStrings('structured match-reason plan', structuredReasonPlan)

line()
console.log('buildMatchReasonPlan — verified vs unverified soft concepts (evidence separation)')
line()

const propertyWithSchool = { propertyType: 'Villa', listingType: 'Sale', description: 'Close to top schools', pool: true }
const propertyWithoutSchool = { propertyType: 'Villa', listingType: 'Sale', description: 'Quiet street', pool: true }
const parsedSoft = { propertyType: 'Villa', listingType: 'Sale', lifestyle: ['near schools'], pool: true }

const verifiedPlan = buildMatchReasonPlan(propertyWithSchool, parsedSoft, true, false)
assertTrue('verified case: school concept ends up in matchedConceptIds', verifiedPlan.matchedConceptIds.includes('school'))
assertEqual('verified case: unverifiedConceptId is null', verifiedPlan.unverifiedConceptId, null)

const unverifiedPlan = buildMatchReasonPlan(propertyWithoutSchool, parsedSoft, true, false)
assertEqual('unverified case: matchedConceptIds empty (this property never mentions schools)', unverifiedPlan.matchedConceptIds, [])
assertEqual('unverified case: unverifiedConceptId is "school"', unverifiedPlan.unverifiedConceptId, 'school')
assertTrue(
  'evidence separation: verified and unverified plans for the SAME requested concept disagree only because the PROPERTY TEXT differs, not because of any language input',
  verifiedPlan.matchedConceptIds.length !== unverifiedPlan.matchedConceptIds.length
)

// Change B: a semantic match now claims ONLY concepts the property text
// actually confirms — the embedding score retrieves the candidate but is no
// longer treated as per-concept verification. This property never mentions
// schools, so the semantic match confirms no specific concept and carries the
// generic "by meaning" claim instead. unverifiedConceptId stays a
// description-only note (never set on the semantic path).
const semanticReasonPlan = buildMatchReasonPlan(propertyWithoutSchool, parsedSoft, false, true)
assertEqual('semantic match: unconfirmed concept is NOT trusted (matchedConceptIds empty)', semanticReasonPlan.matchedConceptIds, [])
assertTrue('semantic match with nothing confirmed sets the generic by-meaning claim', semanticReasonPlan.semanticGenericClaim === true)
assertEqual('semantic match: unverifiedConceptId never set (that is a description-only note)', semanticReasonPlan.unverifiedConceptId, null)

// A semantic match whose text DOES confirm the concept still claims it.
const semanticConfirmedPlan = buildMatchReasonPlan(propertyWithSchool, parsedSoft, false, true)
assertTrue('semantic match: a genuinely-present concept IS claimed', semanticConfirmedPlan.matchedConceptIds.includes('school'))
assertTrue('semantic match with a confirmed concept does not fall back to the generic claim', semanticConfirmedPlan.semanticGenericClaim === false)

line()
console.log('getRelaxedFeatureIds')
line()

assertEqual('relaxed feature ids in field order', getRelaxedFeatureIds({ furnished: true, pool: true }, {}), ['furnished', 'pool'])
assertEqual('excludes strict mustHave features', getRelaxedFeatureIds({ furnished: true, pool: true }, { pool: true }), ['furnished'])
assertEqual('empty result when nothing relaxed', getRelaxedFeatureIds({}, {}), [])

line()
console.log('evaluateSoftMatchForProperty / hasMultiplePropertyTypes (re-exported, unchanged)')
line()

assertEqual(
  'evaluateSoftMatchForProperty: no lifestyle vocabulary -> all empty',
  evaluateSoftMatchForProperty({ title: 'x' }, {}),
  { requestedConceptIds: [], matchedConceptIds: [], unmatchedConceptIds: [] }
)
assertEqual('hasMultiplePropertyTypes: true for 2+ types', hasMultiplePropertyTypes({ propertyTypes: ['Apartment', 'Villa'] }), true)
assertEqual('hasMultiplePropertyTypes: false for 1 type', hasMultiplePropertyTypes({ propertyTypes: ['Apartment'] }), false)

line()
console.log('purity — no mutation of inputs')
line()

assertTrue('buildSearchResultPlan does not mutate parsed', (() => {
  const parsed = { listingType: 'Sale', propertyType: 'Villa', district: 'Kadıköy' }
  const before = JSON.stringify(parsed)
  buildSearchResultPlan({ properties: [{ _id: '1' }], fallbackLevel: 0, parsed })
  return JSON.stringify(parsed) === before
})())

assertTrue('buildSearchResultPlan does not mutate the properties array', (() => {
  const properties = [{ _id: '1' }, { _id: '2' }]
  const before = JSON.stringify(properties)
  buildSearchResultPlan({ properties, fallbackLevel: 0, parsed: {} })
  return JSON.stringify(properties) === before
})())

assertTrue('buildMatchReasonPlan does not mutate property or parsed', (() => {
  const prop = { propertyType: 'Villa', listingType: 'Sale', pool: true }
  const parsed = { propertyType: 'Villa', listingType: 'Sale', pool: true }
  const beforeProp = JSON.stringify(prop)
  const beforeParsed = JSON.stringify(parsed)
  buildMatchReasonPlan(prop, parsed, false, false)
  return JSON.stringify(prop) === beforeProp && JSON.stringify(parsed) === beforeParsed
})())

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
