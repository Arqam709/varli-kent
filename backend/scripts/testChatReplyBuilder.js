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
  renderSlotQuestion,
  renderRefinementOffer,
  evaluateSoftMatchForProperty,
} from '../services/chatReplyBuilder.js'
import { CHAT_MESSAGES } from '../locales/chatMessages.js'

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
  'I found 2 properties that may match your request by meaning. I looked for properties with a sea view in mind. I also filtered it for sale properties. I also matched the property type: apartment. Do you have a preferred district?'
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
  'I couldn\'t find a strong match for a sea view and school proximity, so here is some general properties for sale instead. Here is 1 apartment — apartment for sale. Do you have a preferred district?'
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
  'This matches because it reflects the preferences you described.'
)
assertEqual(
  'Change B: semantic claims a concept ONLY when THIS property text confirms it',
  buildMatchReason({ ...baseProperty, description: 'A home with sweeping sea views' }, { descriptionQuery: 'sea view' }, false, true),
  'This matches because it has a sea view.'
)
assertEqual(
  'Change B: semantic does NOT claim a concept absent from this property text',
  buildMatchReason(baseProperty, { descriptionQuery: 'sea view' }, false, true),
  'This matches because it reflects the preferences you described.'
)
assertEqual(
  'true generic "matches the meaning" fallback when descriptionQuery maps to no known concept',
  buildMatchReason(baseProperty, { descriptionQuery: 'spacious modern layout' }, false, true),
  'This matches because it reflects the preferences you described.'
)
// SEARCH-EVIDENCE HONESTY FIX: "sea view" maps to the sea_view concept, so
// this is NOT free text with nothing to check — it is a concept-mappable
// soft criterion that came back unconfirmed for this specific property.
// Before the fix, this incorrectly claimed "matches what you described";
// now it honestly says the criterion could not be confirmed. This is the
// exact bug class reported in the real villa/school conversation.
assertEqual(
  'concept-mappable soft criterion unconfirmed for this property -> honest note, not a false match claim',
  buildMatchReason(
    { ...baseProperty, description: 'A lovely home with no matching keywords here' },
    { descriptionQuery: 'sea view' },
    true,
    false
  ),
  'This is one of our available listings that may interest you. A sea view could not be confirmed from the listing description.'
)
assertEqual(
  'genuinely unmappable free text (no concept vocabulary) still gets a generic claim, never the raw descriptionQuery',
  buildMatchReason(
    { ...baseProperty, description: 'A lovely home with no matching keywords here' },
    { descriptionQuery: 'renovated modern kitchen layout' },
    true,
    false
  ),
  'This matches because it reflects the preferences you described.'
)
assertEqual(
  'the real villa/school scenario: pool+listingType+propertyType matched, school unverified',
  buildMatchReason(
    {
      ...baseProperty,
      propertyType: 'Villa',
      pool: true,
      description: 'An exceptional luxury villa with panoramic sea views, a private pool, and a landscaped garden.',
    },
    {
      listingType: 'Sale',
      propertyType: 'Villa',
      pool: true,
      descriptionQuery: 'villa near schools for children',
      lifestyle: ['near schools', 'family-friendly'],
    },
    true,
    false
  ),
  'This matches because it is a villa for sale, and has a pool. Proximity to schools could not be confirmed from the listing description.'
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
  'Change B: semantic lifestyle label requires THIS property text to confirm the concept (no blanket claim)',
  buildMatchReason(
    { ...baseProperty, description: 'nothing relevant here' },
    { lifestyle: ['near schools'] },
    false,
    true
  ),
  'This matches because it reflects the preferences you described.'
)

// ═══════════════════════════════════════════════════════════════════════
// Phase 4: renderSlotQuestion / renderRefinementOffer / followUp-aware
// buildReply — additive only. Every buildReply(...) call above this section
// omits `followUp`, so it exercises (and pins) the pre-Phase-4 fallback
// behavior; these new assertions cover the Phase 4 addition specifically.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Phase 4: renderSlotQuestion')
line()

assertEqual(
  'renderSlotQuestion: single known slot reuses exact legacy wording',
  renderSlotQuestion(['propertyType']),
  buildMissingInfoQuestion({ listingType: 'Sale' })
)
assertEqual('renderSlotQuestion: listingType alone', renderSlotQuestion(['listingType']), 'Are you looking to buy or rent?')
assertEqual(
  'renderSlotQuestion: two slots compose naturally',
  renderSlotQuestion(['listingType', 'budget']),
  'Could you tell me whether you are looking to buy or rent and your budget range?'
)
assertEqual('renderSlotQuestion: unknown slot only -> generic fallback', renderSlotQuestion(['beds']), 'Could you tell me a bit more about what you are looking for?')
assertEqual('renderSlotQuestion: empty slots -> generic fallback', renderSlotQuestion([]), 'Could you tell me a bit more about what you are looking for?')

line()
console.log('Phase 4: renderRefinementOffer')
line()

assertEqual('renderRefinementOffer: null slot -> null', renderRefinementOffer(null), null)
assertEqual('renderRefinementOffer: empty offer, district', renderRefinementOffer('district', { reOffer: false }), 'Do you have a preferred district?')
assertEqual(
  'renderRefinementOffer: soft re-offer, listingType',
  renderRefinementOffer('listingType', { reOffer: true }),
  "Whenever you're ready, I'm happy to narrow this down to buy or rent."
)
assertEqual(
  'renderRefinementOffer: soft re-offer wording differs from the blocking wording',
  renderRefinementOffer('budget', { reOffer: true }) !== renderRefinementOffer('budget', { reOffer: false }),
  true
)

line()
console.log('Phase 4: buildReply with an explicit followUp decision')
line()

assertEqual(
  'buildReply: followUp.offerSlot renders instead of buildNextUsefulQuestion',
  buildReply({
    properties: [baseProperty],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyType: 'Apartment', district: 'Kadıköy', maxPrice: 5000000 },
    followUp: { offerSlot: 'district', reOffer: false },
  }),
  'I found 1 apartment — apartment for sale up to ₺5.000.000 in Kadıköy. Do you have a preferred district?'
)

assertEqual(
  'buildReply: followUp.offerSlot = null appends nothing, even though buildNextUsefulQuestion would have asked',
  buildReply({
    properties: [baseProperty],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyType: 'Apartment' },
    followUp: { offerSlot: null, reOffer: false },
  }),
  'I found 1 apartment — apartment for sale.'
)

assertEqual(
  'buildReply: omitting followUp entirely preserves the pre-Phase-4 fallback',
  buildReply({
    properties: [baseProperty],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyType: 'Apartment' },
  }),
  buildReply({
    properties: [baseProperty],
    fallbackLevel: 0,
    parsed: { listingType: 'Sale', propertyType: 'Apartment' },
    followUp: { offerSlot: 'district', reOffer: false },
  })
)

line()
console.log('Phase 4: mixed Sale/Rent presentation')
line()

const mixedProperties = [
  { ...baseProperty, listingType: 'Sale' },
  { ...baseProperty, listingType: 'Rent' },
]

const mixedReply = buildReply({
  properties: mixedProperties,
  fallbackLevel: 0,
  parsed: { propertyType: 'Apartment', district: 'Büyükçekmece' },
  followUp: { offerSlot: null, reOffer: false },
  mixedListingTypes: { isMixed: true, saleCount: 1, rentCount: 1 },
})

assertEqual('mixed reply acknowledges both sale and rent', /both properties for sale and for rent/i.test(mixedReply), true)
assertEqual('mixed reply does not claim prices are directly comparable', /not on the same scale/i.test(mixedReply), true)

const nonMixedReply = buildReply({
  properties: [baseProperty],
  fallbackLevel: 0,
  parsed: { listingType: 'Sale', propertyType: 'Apartment' },
  followUp: { offerSlot: null, reOffer: false },
  mixedListingTypes: { isMixed: false, saleCount: 1, rentCount: 0 },
})

assertEqual('non-mixed reply has no mixed-type notice', /both properties for sale and for rent/i.test(nonMixedReply), false)

assertEqual(
  'mixed notice omitted when there are zero results, even if isMixed were somehow true',
  buildReply({
    properties: [],
    fallbackLevel: 0,
    parsed: { propertyType: 'Apartment' },
    followUp: { offerSlot: null, reOffer: false },
    mixedListingTypes: { isMixed: true, saleCount: 0, rentCount: 0 },
  }),
  "I couldn't find any available properties right now. Try adjusting your district, budget, or property type."
)

// ═══════════════════════════════════════════════════════════════════════
// Search-evidence honesty fix: evaluateSoftMatchForProperty
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('evaluateSoftMatchForProperty')
line()

assertEqual(
  'no concept vocabulary requested -> empty everything',
  evaluateSoftMatchForProperty(baseProperty, { descriptionQuery: 'modern renovated kitchen' }),
  { requestedConceptIds: [], matchedConceptIds: [], unmatchedConceptIds: [] }
)
assertEqual(
  'concept requested, present in property text -> matched',
  evaluateSoftMatchForProperty({ ...baseProperty, description: 'A home near schools' }, { lifestyle: ['near schools'] }),
  { requestedConceptIds: ['school'], matchedConceptIds: ['school'], unmatchedConceptIds: [] }
)
assertEqual(
  'concept requested, absent from property text -> unmatched',
  evaluateSoftMatchForProperty({ ...baseProperty, description: 'A quiet villa' }, { lifestyle: ['near schools'] }),
  { requestedConceptIds: ['school'], matchedConceptIds: [], unmatchedConceptIds: ['school'] }
)
assertEqual(
  'does not mutate the property object',
  (() => {
    const property = { ...baseProperty, description: 'A quiet villa' }
    const snapshot = JSON.stringify(property)
    evaluateSoftMatchForProperty(property, { lifestyle: ['near schools'] })
    return JSON.stringify(property) === snapshot
  })(),
  true
)

// ═══════════════════════════════════════════════════════════════════════
// Search-evidence honesty fix: buildReply summary wording
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Search-evidence honesty: buildReply summary wording')
line()

const schoolVilla = (overrides = {}) => ({
  _id: 'v1',
  title: 'Villa',
  listingType: 'Sale',
  propertyType: 'Villa',
  pool: true,
  description: 'An exceptional luxury villa with panoramic sea views and a private pool.',
  ...overrides,
})

const villaSearchParsed = {
  listingType: 'Sale',
  propertyType: 'Villa',
  pool: true,
  descriptionQuery: 'villa near schools for children',
  lifestyle: ['near schools', 'family-friendly'],
}

assertEqual(
  'all-verified summary: unchanged "matches based on descriptions" wording',
  buildReply({
    properties: [{ ...schoolVilla(), description: 'A villa near excellent schools, with a private pool.' }],
    fallbackLevel: 0,
    parsed: villaSearchParsed,
    matchedViaDescription: true,
    followUp: { offerSlot: null, reOffer: false },
  }),
  'I found 1 property that may match your request based on the property descriptions. I looked for properties with school proximity in mind. I also filtered it for sale properties. I also matched the property type: villa.'
)

assertEqual(
  'the exact real scenario: none verified -> honest summary, no false claim',
  buildReply({
    properties: [schoolVilla({ _id: 'v1' }), schoolVilla({ _id: 'v2' }), schoolVilla({ _id: 'v3' })],
    fallbackLevel: 0,
    parsed: villaSearchParsed,
    matchedViaDescription: true,
    followUp: { offerSlot: null, reOffer: false },
  }),
  'I could not verify school proximity from the available listing descriptions. Here are 3 properties that match your other requirements. I also filtered it for sale properties. I also matched the property type: villa.'
)

assertEqual(
  'mixed evidence: some verified, some broader alternatives',
  buildReply({
    properties: [
      schoolVilla({ _id: 'v1', description: 'A villa near excellent schools.' }),
      schoolVilla({ _id: 'v2' }),
    ],
    fallbackLevel: 0,
    parsed: villaSearchParsed,
    matchedViaDescription: true,
    followUp: { offerSlot: null, reOffer: false },
  }),
  'I found 1 listing with description-matched details, plus 1 broader alternative that match your structured requirements. I looked for properties with school proximity in mind. I also filtered it for sale properties. I also matched the property type: villa.'
)

assertEqual(
  'semantic matches are always treated as fully verified (score already confirmed relevance)',
  buildReply({
    properties: [schoolVilla()],
    fallbackLevel: 0,
    parsed: villaSearchParsed,
    matchedViaSemantic: true,
    followUp: { offerSlot: null, reOffer: false },
  }),
  'I found 1 property that may match your request by meaning. I looked for properties with school proximity in mind. I also filtered it for sale properties. I also matched the property type: villa.'
)

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
// Phase 3: Turkish/Arabic localization (deterministic reply rendering)
//
// Every assertion ABOVE this section calls buildReply/buildMatchReason/
// buildNonPropertyReply/renderSlotQuestion/renderRefinementOffer/
// getRelaxedFeatureLabels/pluralizePropertyType with NO language argument —
// that is the regression guard proving the Phase 3 facade produces
// byte-identical English output to before. This section adds 'tr'/'ar'
// coverage alongside it, without touching any assertion above.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Phase 3: slot questions in tr/ar')
line()

assertEqual('renderSlotQuestion tr: listingType', renderSlotQuestion(['listingType'], 'tr'), 'Satın almak mı yoksa kiralamak mı istiyorsunuz?')
assertEqual('renderSlotQuestion ar: listingType', renderSlotQuestion(['listingType'], 'ar'), 'هل تبحث عن الشراء أم الإيجار؟')

assertTrue(
  'renderSlotQuestion tr: multi-slot (district + budget) composes naturally, mentions both fragments',
  renderSlotQuestion(['district', 'budget'], 'tr').includes('bölgeyi') && renderSlotQuestion(['district', 'budget'], 'tr').includes('bütçe')
)
assertTrue(
  'renderSlotQuestion ar: multi-slot (district + budget) composes naturally, mentions both fragments',
  renderSlotQuestion(['district', 'budget'], 'ar').includes('المنطقة') && renderSlotQuestion(['district', 'budget'], 'ar').includes('ميزانيتك')
)

line()
console.log('Phase 3: casual / service replies in tr/ar')
line()

assertEqual(
  'buildNonPropertyReply tr: casual',
  buildNonPropertyReply({ intentType: 'casual_chat', replyType: 'search' }, 'tr'),
  'İyiyim, teşekkür ederim. Size doğru mülkü bulmakta yardımcı olmak için buradayım. Satın almak mı, kiralamak mı istiyorsunuz, yoksa sadece göz mü atıyorsunuz?'
)
assertEqual(
  'buildNonPropertyReply ar: casual',
  buildNonPropertyReply({ intentType: 'casual_chat', replyType: 'search' }, 'ar'),
  'بخير، شكراً لك. أنا هنا لمساعدتك في إيجاد العقار المناسب. هل تبحث عن الشراء، أم الإيجار، أم أنك تستكشف فقط؟'
)
assertTrue(
  'buildNonPropertyReply tr: service reply mentions VarliKent',
  buildNonPropertyReply({ intentType: 'website_service_question', replyType: 'search' }, 'tr').includes('VarliKent')
)
assertTrue(
  'buildNonPropertyReply ar: service reply mentions فارلي كنت',
  buildNonPropertyReply({ intentType: 'website_service_question', replyType: 'search' }, 'ar').includes('فارلي كنت')
)

line()
console.log('Phase 3: no-results reply in tr/ar')
line()

assertEqual(
  'buildReply tr: no results, no description search attempted',
  buildReply({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: false, language: 'tr' }),
  'Şu anda uygun bir mülk bulamadım. Bölgenizi, bütçenizi veya mülk türünüzü değiştirmeyi deneyin.'
)
assertEqual(
  'buildReply ar: no results, no description search attempted',
  buildReply({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: false, language: 'ar' }),
  'لم أتمكن من العثور على أي عقارات متاحة حالياً. حاول تعديل المنطقة أو الميزانية أو نوع العقار.'
)

line()
console.log('Phase 3: exact structured search-result summary in tr/ar')
line()

const exactSaleVilla = { properties: [{}], fallbackLevel: 0, parsed: { listingType: 'Sale', propertyType: 'Villa' }, language: 'tr' }
assertTrue('buildReply tr: exact match mentions villa noun ("villa")', buildReply(exactSaleVilla).includes('villa'))
assertTrue('buildReply tr: exact match mentions satılık (for-sale adjective)', buildReply(exactSaleVilla).includes('satılık'))

const exactSaleVillaAr = { properties: [{}], fallbackLevel: 0, parsed: { listingType: 'Sale', propertyType: 'Villa' }, language: 'ar' }
assertTrue('buildReply ar: exact match mentions فيلا (villa)', buildReply(exactSaleVillaAr).includes('فيلا'))
assertTrue('buildReply ar: exact match mentions للبيع (for sale)', buildReply(exactSaleVillaAr).includes('للبيع'))

line()
console.log('Phase 3: semantic / description match summaries in tr/ar')
line()

const semanticReplyTr = buildReply({
  properties: [schoolVilla()],
  fallbackLevel: 0,
  parsed: villaSearchParsed,
  matchedViaSemantic: true,
  followUp: { offerSlot: null, reOffer: false },
  language: 'tr',
})
assertTrue('buildReply tr: semantic match summary has no leftover English marker words', !/\bI found\b|\bmay match\b/i.test(semanticReplyTr))
assertTrue('buildReply tr: semantic match summary never leaks the raw internal descriptionQuery', !semanticReplyTr.includes(villaSearchParsed.descriptionQuery))
assertTrue('buildReply tr: semantic match summary explains the search naturally in Turkish (school proximity concept)', semanticReplyTr.includes('okullara yakınlık'))

const descriptionMatchReplyAr = buildReply({
  properties: [{ ...schoolVilla(), description: 'A villa near excellent schools, with a private pool.' }],
  fallbackLevel: 0,
  parsed: villaSearchParsed,
  matchedViaDescription: true,
  followUp: { offerSlot: null, reOffer: false },
  language: 'ar',
})
assertTrue('buildReply ar: description-match (all verified) never leaks the raw internal descriptionQuery', !descriptionMatchReplyAr.includes(villaSearchParsed.descriptionQuery))
assertTrue('buildReply ar: description-match (all verified) explains the search naturally in Arabic (school proximity concept)', descriptionMatchReplyAr.includes('القرب من المدارس'))

line()
console.log('Phase 3: relaxed/fallback summary + mixed Sale/Rent notice in tr/ar')
line()

const relaxedTr = buildReply({
  properties: [{}],
  fallbackLevel: 1,
  parsed: { listingType: 'Rent', propertyType: 'Studio' },
  relaxedFeatureIds: ['pool'],
  language: 'tr',
})
assertTrue('buildReply tr: fallbackLevel 1 mentions havuz (pool) in the relaxed-feature notice', relaxedTr.includes('havuz'))

const mixedNoticeTr = buildReply({
  properties: [
    { listingType: 'Sale' },
    { listingType: 'Rent' },
  ],
  fallbackLevel: 0,
  parsed: {},
  mixedListingTypes: { isMixed: true },
  language: 'tr',
})
assertTrue('buildReply tr: mixed Sale/Rent notice prepended, mentions satılık and kiralık', mixedNoticeTr.includes('satılık') && mixedNoticeTr.includes('kiralık'))

const mixedNoticeAr = buildReply({
  properties: [
    { listingType: 'Sale' },
    { listingType: 'Rent' },
  ],
  fallbackLevel: 0,
  parsed: {},
  mixedListingTypes: { isMixed: true },
  language: 'ar',
})
assertTrue('buildReply ar: mixed Sale/Rent notice prepended, mentions للبيع and للإيجار', mixedNoticeAr.includes('للبيع') && mixedNoticeAr.includes('للإيجار'))

line()
console.log('Phase 3: verified vs unverified school match reason in tr/ar')
line()

const verifiedSchoolProperty = { propertyType: 'Villa', listingType: 'Sale', pool: true, description: 'Close to top schools, with a private pool.' }
const unverifiedSchoolProperty = { propertyType: 'Villa', listingType: 'Sale', pool: true, description: 'Quiet street, with a private pool.' }
const schoolSearchParsed = { propertyType: 'Villa', listingType: 'Sale', pool: true, lifestyle: ['near schools'] }

const verifiedReasonTr = buildMatchReason(verifiedSchoolProperty, schoolSearchParsed, true, false, 'tr')
assertTrue('buildMatchReason tr: verified school match mentions okullara yakın', verifiedReasonTr.includes('okullara yakın'))
assertTrue('buildMatchReason tr: verified school match does NOT contain the unverified note', !verifiedReasonTr.includes('doğrulanamadı'))

const unverifiedReasonTr = buildMatchReason(unverifiedSchoolProperty, schoolSearchParsed, true, false, 'tr')
assertTrue('buildMatchReason tr: unverified school requirement is honestly flagged (doğrulanamadı)', unverifiedReasonTr.includes('doğrulanamadı'))
assertTrue('buildMatchReason tr: unverified case does NOT falsely claim "okullara yakın"', !unverifiedReasonTr.includes('okullara yakın'))

const verifiedReasonAr = buildMatchReason(verifiedSchoolProperty, schoolSearchParsed, true, false, 'ar')
assertTrue('buildMatchReason ar: verified school match mentions قريب من المدارس', verifiedReasonAr.includes('قريب من المدارس'))
assertTrue('buildMatchReason ar: verified school match does NOT contain the unverified note', !verifiedReasonAr.includes('تعذّر'))

const unverifiedReasonAr = buildMatchReason(unverifiedSchoolProperty, schoolSearchParsed, true, false, 'ar')
assertTrue('buildMatchReason ar: unverified school requirement is honestly flagged (تعذّر)', unverifiedReasonAr.includes('تعذّر'))
assertTrue('buildMatchReason ar: unverified case does NOT falsely claim قريب من المدارس', !unverifiedReasonAr.includes('قريب من المدارس'))

line()
console.log('Phase 3: match reason — Villa + Sale + Pool (structured, verified) in tr/ar')
line()

const villaSalePoolReasonTr = buildMatchReason(
  { propertyType: 'Villa', listingType: 'Sale', pool: true },
  { propertyType: 'Villa', listingType: 'Sale', pool: true },
  false, false, 'tr'
)
assertTrue('buildMatchReason tr: mentions villa', villaSalePoolReasonTr.includes('villa'))
assertTrue('buildMatchReason tr: mentions satılık', villaSalePoolReasonTr.includes('satılık'))
assertTrue('buildMatchReason tr: mentions havuz (pool)', villaSalePoolReasonTr.includes('havuz'))

const villaSalePoolReasonAr = buildMatchReason(
  { propertyType: 'Villa', listingType: 'Sale', pool: true },
  { propertyType: 'Villa', listingType: 'Sale', pool: true },
  false, false, 'ar'
)
assertTrue('buildMatchReason ar: mentions فيلا', villaSalePoolReasonAr.includes('فيلا'))
assertTrue('buildMatchReason ar: mentions للبيع', villaSalePoolReasonAr.includes('للبيع'))
assertTrue('buildMatchReason ar: mentions مسبح (pool)', villaSalePoolReasonAr.includes('مسبح'))

line()
console.log('Phase 3: language fallback to English')
line()

assertEqual(
  'buildNonPropertyReply with unsupported language falls back to English content',
  buildNonPropertyReply({ intentType: 'casual_chat', replyType: 'search' }, 'de'),
  buildNonPropertyReply({ intentType: 'casual_chat', replyType: 'search' }, 'en')
)
assertEqual(
  'renderSlotQuestion with unsupported language falls back to English content',
  renderSlotQuestion(['listingType'], 'fr'),
  renderSlotQuestion(['listingType'], 'en')
)
assertEqual(
  'buildReply with no language argument at all defaults to English (back-compat)',
  buildReply({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: false }),
  buildReply({ properties: [], fallbackLevel: 0, parsed: {}, descriptionSearchAttempted: false, language: 'en' })
)
assertEqual(
  'buildReply with an explicit unsupported language falls back to English content',
  buildReply({ properties: [{}], fallbackLevel: 0, parsed: { listingType: 'Sale', propertyType: 'Villa' }, language: 'de' }),
  buildReply({ properties: [{}], fallbackLevel: 0, parsed: { listingType: 'Sale', propertyType: 'Villa' }, language: 'en' })
)
assertEqual(
  'buildMatchReason with an explicit unsupported language falls back to English content',
  buildMatchReason({ propertyType: 'Villa', listingType: 'Sale', pool: true }, { propertyType: 'Villa', listingType: 'Sale', pool: true }, false, false, 'de'),
  buildMatchReason({ propertyType: 'Villa', listingType: 'Sale', pool: true }, { propertyType: 'Villa', listingType: 'Sale', pool: true }, false, false, 'en')
)

line()
console.log('Phase 3: no mutation of inputs across languages')
line()

assertTrue('buildReply does not mutate parsed when called with language tr', (() => {
  const parsed = { listingType: 'Sale', propertyType: 'Villa' }
  const before = JSON.stringify(parsed)
  buildReply({ properties: [{}], fallbackLevel: 0, parsed, language: 'tr' })
  return JSON.stringify(parsed) === before
})())

assertTrue('buildMatchReason does not mutate property or parsed when called with language ar', (() => {
  const property = { propertyType: 'Villa', listingType: 'Sale', pool: true }
  const parsed = { propertyType: 'Villa', listingType: 'Sale', pool: true }
  const beforeProperty = JSON.stringify(property)
  const beforeParsed = JSON.stringify(parsed)
  buildMatchReason(property, parsed, false, false, 'ar')
  return JSON.stringify(property) === beforeProperty && JSON.stringify(parsed) === beforeParsed
})())

// ═══════════════════════════════════════════════════════════════════════
// Unverified soft-requirement rendering (post-search policy fix).
// buildReply receives followUp.softOutcome from chatPolicyEngine and must
// render the honest, centralized wording — terminal for no-results, broader-
// alternatives when structured fallback properties exist — in every language,
// never leaking the internal descriptionQuery, never appending slot advice on
// the terminal case, never claiming a listing satisfies the requirement.
line()
console.log('unverified soft-requirement rendering (EN/TR/AR)')
line()

// CASE 1 — count 0, softOutcome unverified_no_results: exact terminal message.
for (const lang of ['en', 'tr', 'ar']) {
  const reply = buildReply({
    properties: [],
    fallbackLevel: 0,
    parsed: { descriptionQuery: 'music studio soundproof' },
    descriptionSearchAttempted: true,
    followUp: { offerSlot: null, reOffer: false, softOutcome: 'unverified_no_results' },
    language: lang,
  })
  assertEqual(`CASE 1 (${lang}): exact honest terminal message`, reply, CHAT_MESSAGES[lang].softUnverified.noResults)
  assertTrue(`CASE 1 (${lang}): no raw descriptionQuery leak`, !reply.includes('music studio'))
  assertTrue(`CASE 1 (${lang}): no "try adding" slot advice`, !/try adding|deneyin|جرّب إضافة/i.test(reply))
}

// CASE 2 — count > 0, softOutcome unverified_with_alternatives: broader-
// alternatives notice present, no raw query, properties still described.
for (const lang of ['en', 'tr', 'ar']) {
  const reply = buildReply({
    properties: [{}],
    fallbackLevel: 0,
    parsed: { descriptionQuery: 'music studio soundproof', listingType: 'Sale' },
    matchedViaDescription: false,
    matchedViaSemantic: false,
    descriptionSearchAttempted: true,
    followUp: { offerSlot: null, reOffer: false, softOutcome: 'unverified_with_alternatives' },
    language: lang,
  })
  assertTrue(`CASE 2 (${lang}): includes the honest broader-alternatives notice`, reply.includes(CHAT_MESSAGES[lang].softUnverified.withAlternatives))
  assertTrue(`CASE 2 (${lang}): no raw descriptionQuery leak`, !reply.includes('music studio'))
}

// Backward compatibility: a followUp with NO softOutcome key (absent/null)
// leaves the prior no-results-description message unchanged — the new branch
// only fires on an explicit softOutcome. offerSlot null -> no appended
// question -> the legacy suffix path.
assertEqual(
  'absent softOutcome: legacy no-results-description message unchanged (en)',
  buildReply({
    properties: [],
    fallbackLevel: 0,
    parsed: {},
    descriptionSearchAttempted: true,
    followUp: { offerSlot: null, reOffer: false },
    language: 'en',
  }),
  "I couldn't find a strong match from the property descriptions yet. Try adding a district, budget, or property type."
)

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
