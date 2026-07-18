// backend/scripts/testChatReplyBuilder.js
//
// Focused, fully deterministic unit tests for services/chatReplyBuilder.js —
// no DB connection, no Gemini call, no network. Fixed inputs, exact string
// equality throughout (this module is pure visitor-facing text
// construction, so "exact string, unchanged" is the correct bar for a
// move-only refactor — not "close enough").
//
// Every expected string below was harvested by running the actual
// (already-extracted) functions against these exact fixed inputs and
// hand-verified against the implementation's logic before being pinned
// here — see the stage-3 extraction report for the derivation.
//
// Usage: node scripts/testChatReplyBuilder.js

import {
  buildNonPropertyReply,
  shouldSkipGeminiAskQuestion,
  buildMissingInfoQuestion,
  buildNextUsefulQuestion,
  getRelaxedFeatureLabels,
  pluralizePropertyType,
  hasMultiplePropertyTypes,
  describePropertyTypesPhrase,
  buildReply,
  buildMatchReason,
} from '../services/chatReplyBuilder.js'

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

// ═══════════════════════════════════════════════════════════════════════
// A. buildNonPropertyReply
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. buildNonPropertyReply')
line()

assertEqual(
  'casual chat (intentType)',
  buildNonPropertyReply({ intentType: 'casual_chat', replyType: 'search' }),
  "I'm doing well, thank you. I'm here to help you find the right property. Are you looking to buy, rent, or just exploring?"
)
assertEqual(
  'casual chat (replyType)',
  buildNonPropertyReply({ intentType: 'property_search', replyType: 'casual_reply' }),
  "I'm doing well, thank you. I'm here to help you find the right property. Are you looking to buy, rent, or just exploring?"
)
assertEqual(
  'emotional/support',
  buildNonPropertyReply({ intentType: 'emotional_message', replyType: 'search' }),
  "I'm sorry to hear that. I hope your day gets better. I'm mainly here to help with property search, so whenever you're ready, tell me what kind of home you're looking for."
)
assertEqual(
  'contact request',
  buildNonPropertyReply({ intentType: 'contact_request', replyType: 'search' }),
  'Sure. You can contact the VarliKent team through the contact form or WhatsApp details on the property page. If you tell me which property you are interested in, I can help you narrow it down.'
)
assertEqual(
  'website service question',
  buildNonPropertyReply({ intentType: 'website_service_question', replyType: 'search' }),
  'VarliKent can help with real estate, architecture, construction, renovation, and interior design services. Which service would you like to know more about?'
)
assertEqual(
  'unknown',
  buildNonPropertyReply({ intentType: 'unknown', replyType: 'search' }),
  'I can help you search for properties by buy/rent, apartment/villa, district, budget, rooms, or lifestyle needs like sea view, family-friendly community, luxury, or investment. What are you looking for?'
)
assertEqual(
  'property-search input returns null',
  buildNonPropertyReply({ intentType: 'property_search', replyType: 'search' }),
  null
)

// ═══════════════════════════════════════════════════════════════════════
// B. shouldSkipGeminiAskQuestion
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. shouldSkipGeminiAskQuestion')
line()

assertEqual(
  'structured field-only request -> false',
  shouldSkipGeminiAskQuestion({ listingType: 'Sale', propertyType: 'Apartment' }),
  false
)
assertEqual('descriptionQuery -> true', shouldSkipGeminiAskQuestion({ descriptionQuery: 'sea view' }), true)
assertEqual('lifestyle -> true', shouldSkipGeminiAskQuestion({ lifestyle: ['sea view'] }), true)
assertEqual('mustHave -> true', shouldSkipGeminiAskQuestion({ mustHave: ['pool'] }), true)
assertEqual('hybrid mode -> true', shouldSkipGeminiAskQuestion({ searchMode: 'hybrid' }), true)

// ═══════════════════════════════════════════════════════════════════════
// C. buildMissingInfoQuestion
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. buildMissingInfoQuestion')
line()

assertEqual(
  'missing listingType',
  buildMissingInfoQuestion({}, 'hello'),
  'Are you looking to buy or rent?'
)
assertEqual(
  'listingType known, missing property type',
  buildMissingInfoQuestion({ listingType: 'Sale' }, 'I want to buy'),
  'What type of property are you looking for — apartment, villa, office, or something else?'
)
assertEqual(
  'uncertain type wording',
  buildMissingInfoQuestion({ listingType: 'Sale' }, 'not sure what type'),
  'Would you prefer apartment, villa, office, or should I show residential properties?'
)
assertEqual(
  'lifestyle search skips the blocking question',
  buildMissingInfoQuestion({ descriptionQuery: 'sea view' }, 'a home with a sea view'),
  null
)
assertEqual(
  'complete structured criteria returns null',
  buildMissingInfoQuestion({ listingType: 'Sale', propertyType: 'Apartment' }, 'hello'),
  null
)

// ═══════════════════════════════════════════════════════════════════════
// D. buildNextUsefulQuestion
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. buildNextUsefulQuestion')
line()

assertEqual('ask buy/rent first', buildNextUsefulQuestion({}), 'Are you looking to buy or rent?')
assertEqual(
  'then property type',
  buildNextUsefulQuestion({ listingType: 'Sale' }),
  'Do you prefer an apartment, villa, or another property type?'
)
assertEqual(
  'then district',
  buildNextUsefulQuestion({ listingType: 'Sale', propertyType: 'Apartment' }),
  'Do you have a preferred district?'
)
assertEqual(
  'then budget',
  buildNextUsefulQuestion({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy' }),
  'Do you have a budget range in mind?'
)
assertEqual(
  'complete enough -> null',
  buildNextUsefulQuestion({ listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy', maxPrice: 5000000 }),
  null
)

// ═══════════════════════════════════════════════════════════════════════
// E. property-type wording
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. property-type wording')
line()

assertEqual('pluralizePropertyType(Apartment)', pluralizePropertyType('Apartment'), 'apartments')
assertEqual('pluralizePropertyType(Duplex) plural override', pluralizePropertyType('Duplex'), 'duplexes')
assertEqual(
  'describePropertyTypesPhrase: multiple types phrase',
  describePropertyTypesPhrase({ propertyTypes: ['Apartment', 'Villa'] }),
  'apartments and villas'
)
assertEqual(
  'describePropertyTypesPhrase: one type phrase (singular, not pluralized)',
  describePropertyTypesPhrase({ propertyType: 'Villa' }),
  'villa'
)
assertEqual('describePropertyTypesPhrase: no type -> null', describePropertyTypesPhrase({}), null)
assertEqual(
  'hasMultiplePropertyTypes: true for 2+ types',
  hasMultiplePropertyTypes({ propertyTypes: ['Apartment', 'Villa'] }),
  true
)
assertEqual(
  'hasMultiplePropertyTypes: false for exactly 1 type',
  hasMultiplePropertyTypes({ propertyTypes: ['Apartment'] }),
  false
)
assertEqual('hasMultiplePropertyTypes: false for none', hasMultiplePropertyTypes({}), false)

// ═══════════════════════════════════════════════════════════════════════
// F. getRelaxedFeatureLabels
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. getRelaxedFeatureLabels')
line()

assertEqual(
  'returns only requested true features, in SOFT_FEATURE_LABELS order',
  getRelaxedFeatureLabels({ furnished: true, pool: true }, {}),
  ['furnished', 'a pool']
)
assertEqual(
  'excludes strict mustHave features',
  getRelaxedFeatureLabels({ furnished: true, pool: true }, { pool: true }),
  ['furnished']
)
assertEqual('empty result when nothing was relaxed', getRelaxedFeatureLabels({}, {}), [])
assertEqual(
  'correct labels for all six feature toggles',
  getRelaxedFeatureLabels(
    { furnished: true, balcony: true, elevator: true, pool: true, garden: true, parking: true },
    {}
  ),
  ['furnished', 'a balcony', 'an elevator', 'a pool', 'a garden', 'parking']
)

// ═══════════════════════════════════════════════════════════════════════
// G. buildReply
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. buildReply')
line()

assertEqual(
  'zero properties, normal search',
  buildReply({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: false }),
  "I couldn't find any available properties right now. Try adjusting your district, budget, or property type."
)
assertEqual(
  'zero properties after description attempt (nextQuestion present)',
  buildReply({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: true }),
  "I couldn't find a strong match from the property descriptions yet. Are you looking to buy or rent?"
)
assertEqual(
  'zero properties after description attempt (complete parsed, no nextQuestion)',
  buildReply({
    properties: [],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy', maxPrice: 5000000 },
    descriptionSearchAttempted: true,
  }),
  "I couldn't find a strong match from the property descriptions yet. Try adding a district, budget, or property type."
)

const parsedComplete = { listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy', maxPrice: 5000000 }

assertEqual(
  'exact one-result response',
  buildReply({ properties: [{}], fallbackLevel: 0, parsed: parsedComplete }),
  'I found 1 apartment — apartment for sale up to ₺5.000.000 in Kadıköy.'
)
assertEqual(
  'exact multiple-result response',
  buildReply({ properties: [{}, {}, {}], fallbackLevel: 0, parsed: parsedComplete }),
  'I found 3 apartments — apartment for sale up to ₺5.000.000 in Kadıköy.'
)
assertEqual(
  'semantic match response',
  buildReply({
    properties: [{}, {}],
    fallbackLevel: 0,
    parsed: { descriptionQuery: 'sea view', listingType: 'Sale', propertyType: 'Apartment' },
    matchedViaSemantic: true,
    descriptionSearchAttempted: true,
  }),
  'I found 2 properties that may match your request by meaning. I searched for details related to: sea view. I also filtered it for sale properties. I also matched the property type: apartment. Do you have a preferred district?'
)
assertEqual(
  'description match response',
  buildReply({
    properties: [{}],
    fallbackLevel: 0,
    parsed: {},
    matchedViaDescription: true,
    descriptionSearchAttempted: true,
  }),
  'I found 1 property that may match your request based on the property descriptions. Are you looking to buy or rent?'
)

const parsedRentVilla = { listingType: 'Rent', propertyType: 'Villa', district: 'Kadıköy', maxPrice: 40000 }

assertEqual(
  'fallback level 1',
  buildReply({ properties: [{}, {}], fallbackLevel: 1, parsed: parsedRentVilla }),
  "I couldn't find an exact match with all details, but here are 2 villas in the same area that may interest you."
)
assertEqual(
  'fallback level 2',
  buildReply({ properties: [{}], fallbackLevel: 2, parsed: parsedRentVilla }),
  'Nothing matched in that district, but here is 1 villa of that type from other areas.'
)
assertEqual(
  'fallback level 3',
  buildReply({ properties: [{}], fallbackLevel: 3, parsed: parsedRentVilla }),
  "I couldn't find a close match, but here is 1 villa to give you a starting point."
)
assertEqual(
  'relaxed feature notice',
  buildReply({
    properties: [{}, {}],
    fallbackLevel: 1,
    parsed: parsedRentVilla,
    relaxedFeatureLabels: ['a pool', 'parking'],
  }),
  'I could not find rentals with a pool and parking, so these are alternatives without all requested features. Here are 2 villas in the same area that may interest you.'
)
assertEqual(
  'description mismatch notice',
  buildReply({
    properties: [{}],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyType: 'Apartment', descriptionQuery: 'sea view schools' },
    descriptionSearchAttempted: true,
  }),
  'I couldn\'t find a strong match for "sea view schools", so here is some general properties for sale instead. Here is 1 apartment — apartment for sale. Do you have a preferred district?'
)
assertEqual(
  'multiple property types',
  buildReply({
    properties: [{}, {}],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyTypes: ['Apartment', 'Villa'], district: 'Kadıköy', maxPrice: 5000000 },
  }),
  'I found 2 properties — apartments and villas for sale up to ₺5.000.000 in Kadıköy.'
)
assertEqual(
  'Rent wording ("rentals") + next-question appended',
  buildReply({ properties: [{}], fallbackLevel: 1, parsed: { listingType: 'Rent', propertyType: 'Studio' } }),
  "I couldn't find an exact match with all details, but here is 1 studio in the same area that may interest you. Do you have a preferred district?"
)
assertEqual(
  'next-question appended (fallback level 0, incomplete parsed)',
  buildReply({ properties: [{}], fallbackLevel: 0, parsed: { listingType: 'Sale', propertyType: 'Apartment' } }),
  'I found 1 apartment — apartment for sale. Do you have a preferred district?'
)
assertEqual(
  'district and budget phrasing only (no listingType/propertyType)',
  buildReply({ properties: [{}], fallbackLevel: 0, parsed: { district: 'Kadıköy', maxPrice: 5000000 } }),
  'I found 1 property — up to ₺5.000.000 in Kadıköy. Are you looking to buy or rent?'
)

// ═══════════════════════════════════════════════════════════════════════
// H. buildMatchReason
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. buildMatchReason')
line()

const baseProperty = {
  title: 'Test Property',
  description: 'A lovely home',
  address: '1 Test St',
  district: 'Kadıköy',
  listingType: 'Sale',
  propertyType: 'Apartment',
  beds: 3,
  baths: 2,
  price: 4000000,
  furnished: true,
  balcony: true,
  elevator: false,
  pool: false,
  garden: false,
  parking: '1 covered spot',
}

assertEqual(
  'propertyType + listingType + district match',
  buildMatchReason(baseProperty, { propertyType: 'Apartment', listingType: 'Sale', district: 'Kadıköy' }, false, false),
  'This matches because it is an apartment for sale in Kadıköy.'
)
assertEqual(
  'requested type from propertyTypes[]',
  buildMatchReason({ ...baseProperty, propertyType: 'Villa' }, { propertyTypes: ['Apartment', 'Villa'] }, false, false),
  'This matches because it is one of the property types you mentioned.'
)
assertEqual(
  'beds + baths + budget match',
  buildMatchReason(baseProperty, { beds: 3, baths: 2, minPrice: 3000000, maxPrice: 5000000 }, false, false),
  'This matches because it has your requested 3 bedrooms, and has your requested 2 bathrooms, and fits your budget.'
)
assertEqual(
  'boolean features + parking match',
  buildMatchReason(baseProperty, { furnished: true, balcony: true, parking: true }, false, false),
  'This matches because it has furnished, a balcony, parking.'
)
assertEqual(
  'district mismatch sentence',
  buildMatchReason(baseProperty, { district: 'Beşiktaş' }, false, false),
  'This is one of our available listings that may interest you. It is from Kadıköy instead of Beşiktaş, since there was no exact match in your requested district.'
)
assertEqual(
  'no matched clause fallback sentence',
  buildMatchReason(baseProperty, {}, false, false),
  'This is one of our available listings that may interest you.'
)
assertEqual(
  'semantic generic explanation (no descriptionQuery, no concept evidence)',
  buildMatchReason(baseProperty, {}, false, true),
  'This matches because it matches the lifestyle/meaning of what you described.'
)
assertEqual(
  'lifestyle label wins over generic semantic explanation when a concept keyword is found',
  buildMatchReason(baseProperty, { descriptionQuery: 'sea view' }, false, true),
  'This matches because it has a sea view.'
)
assertEqual(
  'true generic "matches the meaning" fallback when descriptionQuery maps to no known concept',
  buildMatchReason(baseProperty, { descriptionQuery: 'spacious modern layout' }, false, true),
  'This matches because it matches the meaning of what you described ("spacious modern layout").'
)
assertEqual(
  'description-query explanation (matchedViaDescription, no concept keywords present in property text)',
  buildMatchReason(
    { ...baseProperty, description: 'A lovely home with no matching keywords here' },
    { descriptionQuery: 'sea view' },
    true,
    false
  ),
  'This matches because it matches what you described ("sea view").'
)
assertEqual(
  'lifestyle label only claimed when this property\'s own text contains the concept keyword (matchedViaDescription)',
  buildMatchReason(
    { ...baseProperty, description: 'A lovely home near schools' },
    { descriptionQuery: 'near schools', lifestyle: ['near schools'] },
    true,
    false
  ),
  'This matches because it is near schools.'
)
assertEqual(
  'lifestyle label for semantic match skips the per-property keyword check',
  buildMatchReason(
    { ...baseProperty, description: 'nothing relevant here' },
    { lifestyle: ['near schools'] },
    false,
    true
  ),
  'This matches because it is near schools.'
)

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
