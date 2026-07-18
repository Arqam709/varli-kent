// backend/scripts/testChatMessageParsing.js
//
// Focused, fully deterministic unit tests for services/chatMessageParsing.js
// — no DB connection, no Gemini call, no network. Mirrors the same standard
// as testChatFilters.js: fixed inputs, exact expected outputs, order-
// independent deep equality for object comparisons.
//
// Usage: node scripts/testChatMessageParsing.js

import {
  defaultParsed,
  normalizeParsed,
  extractBudgetFromText,
  hasSoftDescriptionSearch,
  hasKnownPropertyType,
  detectMentionedDistricts,
  keywordFallbackParser,
  detectMentionedPropertyTypes,
  messageRequestsResidential,
  messageExpressesTypeUncertainty,
  applyRawTextPropertyTypeSignals,
} from '../services/chatMessageParsing.js'
import { RESIDENTIAL_PROPERTY_TYPES } from '../services/propertySemanticSearch.js'

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

line()
console.log('defaultParsed')
line()

assertEqual('defaultParsed.listingType is null', defaultParsed.listingType, null)
assertEqual('defaultParsed.propertyTypes is []', defaultParsed.propertyTypes, [])
assertEqual('defaultParsed.intentType is property_search', defaultParsed.intentType, 'property_search')
assertEqual('defaultParsed.replyType is search', defaultParsed.replyType, 'search')
assertEqual('defaultParsed.searchMode is field', defaultParsed.searchMode, 'field')

line()
console.log('extractBudgetFromText')
line()

assertEqual(
  'explicit "budget is 15000"',
  extractBudgetFromText('my budget is 15000', {}).maxPrice,
  15000
)
assertEqual('"under 15000"', extractBudgetFromText('under 15000', {}).maxPrice, 15000)
assertEqual('"max 15000"', extractBudgetFromText('max 15000', {}).maxPrice, 15000)
assertEqual('"up to 15000"', extractBudgetFromText('up to 15000', {}).maxPrice, 15000)
assertEqual('"₺15000" raw currency prefix', extractBudgetFromText('₺15000', {}).maxPrice, 15000)
assertEqual('bare 5-digit number "25000"', extractBudgetFromText('25000', {}).maxPrice, 25000)
assertEqual(
  'no budget-shaped number -> parsed object returned unchanged',
  extractBudgetFromText('hello there', { maxPrice: null }).maxPrice,
  null
)
assertEqual(
  'commas/dots in the number are stripped',
  extractBudgetFromText('budget 15,000', {}).maxPrice,
  15000
)

line()
console.log('normalizeParsed')
line()

{
  const result = normalizeParsed({ intentType: 'not_a_real_type', replyType: 'not_a_real_reply' }, 'hello')
  assertEqual('invalid intentType falls back to property_search', result.intentType, 'property_search')
  assertEqual('invalid replyType falls back to search', result.replyType, 'search')
}
{
  const result = normalizeParsed({ nextQuestion: '   Are you buying?   ' }, 'hello')
  assertEqual('nextQuestion is trimmed', result.nextQuestion, 'Are you buying?')
}
{
  const result = normalizeParsed({ nextQuestion: '   ' }, 'hello')
  assertEqual('whitespace-only nextQuestion becomes null', result.nextQuestion, null)
}
{
  const result = normalizeParsed({ searchMode: 'not_a_real_mode' }, 'hello')
  assertEqual('invalid searchMode falls back to field', result.searchMode, 'field')
}
{
  const result = normalizeParsed({ districts: 'not-an-array', mustHave: 'not-an-array' }, 'hello')
  assertEqual('non-array districts coerced to []', result.districts, [])
  assertEqual('non-array mustHave coerced to []', result.mustHave, [])
}
{
  const result = normalizeParsed({}, 'under 25000')
  assertEqual('normalizeParsed also runs extractBudgetFromText on the message', result.maxPrice, 25000)
}
{
  const result = normalizeParsed(null, 'hello')
  assertEqual('null parsed input falls back to defaultParsed shape (listingType null)', result.listingType, null)
}

line()
console.log('detectMentionedDistricts')
line()

assertEqual('single district (accented)', detectMentionedDistricts('apartments in Beylikdüzü'), ['Beylikdüzü'])
assertEqual(
  'multiple districts',
  detectMentionedDistricts('Kadıköy or Beşiktaş'),
  ['Kadıköy', 'Beşiktaş']
)
assertEqual('no district mentioned', detectMentionedDistricts('a nice apartment'), [])
assertEqual(
  'ASCII variant also matches (Beylikduzu)',
  detectMentionedDistricts('flat in Beylikduzu'),
  ['Beylikduzu']
)

line()
console.log('keywordFallbackParser')
line()

assertEqual('"rent" sets listingType Rent', keywordFallbackParser('rent an apartment').listingType, 'Rent')
assertEqual('"buy" sets listingType Sale', keywordFallbackParser('buy a villa').listingType, 'Sale')
assertEqual('"kiralık" sets listingType Rent', keywordFallbackParser('kiralık daire').listingType, 'Rent')
assertEqual('"satılık" sets listingType Sale', keywordFallbackParser('satılık ev').listingType, 'Sale')
assertEqual('"villa" sets propertyType Villa', keywordFallbackParser('a villa please').propertyType, 'Villa')
assertEqual('"flat" maps to propertyType Apartment', keywordFallbackParser('a flat please').propertyType, 'Apartment')
assertEqual(
  'single district gets assigned to district (not districts)',
  keywordFallbackParser('rent in Kadıköy').district,
  'Kadıköy'
)
assertEqual(
  'multiple districts get assigned to districts[]',
  keywordFallbackParser('Kadıköy or Beşiktaş').districts,
  ['Kadıköy', 'Beşiktaş']
)
assertEqual('"3 bedroom" sets beds 3', keywordFallbackParser('3 bedroom apartment').beds, 3)
assertEqual('"3+1" sets beds 3', keywordFallbackParser('3+1 apartment').beds, 3)
assertEqual('"2 bathrooms" sets baths 2', keywordFallbackParser('2 bathrooms').baths, 2)
assertEqual('"under 8 million" sets maxPrice 8000000', keywordFallbackParser('under 8 million').maxPrice, 8000000)
assertEqual('"above 5 million" sets minPrice 5000000', keywordFallbackParser('above 5 million').minPrice, 5000000)
assertEqual('"max 3 million" sets maxPrice 3000000', keywordFallbackParser('max 3 million').maxPrice, 3000000)
assertTrue('"pool" sets pool true', keywordFallbackParser('with a pool').pool === true)
assertTrue('"garden" sets garden true', keywordFallbackParser('with a garden').garden === true)
assertTrue('"furnished" sets furnished true', keywordFallbackParser('furnished apartment').furnished === true)
assertTrue('"balcony" sets balcony true', keywordFallbackParser('with balcony').balcony === true)
assertTrue('"lift" also sets elevator true', keywordFallbackParser('with a lift').elevator === true)
assertTrue('"garage" also sets parking true', keywordFallbackParser('with a garage').parking === true)
assertEqual(
  'no keywords matched -> defaultParsed shape (listingType stays null)',
  keywordFallbackParser('asdkfjaskldfj').listingType,
  null
)

line()
console.log('detectMentionedPropertyTypes')
line()

assertEqual('single type', detectMentionedPropertyTypes('a nice villa'), ['Villa'])
assertEqual('two types', detectMentionedPropertyTypes('apartment or villa'), ['Apartment', 'Villa'])
assertEqual('"flat" maps to Apartment (no duplicate if apartment also said)', detectMentionedPropertyTypes('flat or apartment'), ['Apartment'])
assertEqual('none mentioned', detectMentionedPropertyTypes('a nice place'), [])

line()
console.log('messageRequestsResidential / messageExpressesTypeUncertainty')
line()

assertTrue('"show me residential properties" matches', messageRequestsResidential('show me residential properties'))
assertTrue('"residential" (bare) matches', messageRequestsResidential('residential'))
assertTrue('no match for unrelated text', !messageRequestsResidential('a nice villa'))
assertTrue('"not sure" matches uncertainty', messageExpressesTypeUncertainty('not sure what I want'))
assertTrue('"don\'t know" matches uncertainty', messageExpressesTypeUncertainty("I don't know yet"))
assertTrue('"whatever" matches uncertainty', messageExpressesTypeUncertainty('whatever works'))
assertTrue('no match for unrelated text', !messageExpressesTypeUncertainty('a nice villa'))

line()
console.log('applyRawTextPropertyTypeSignals')
line()

{
  const parsedFromMessage = { propertyType: 'Apartment', propertyTypes: [] }
  applyRawTextPropertyTypeSignals(parsedFromMessage, 'show me residential properties')
  assertEqual(
    '"show me residential properties" sets propertyTypes to the residential set',
    parsedFromMessage.propertyTypes,
    RESIDENTIAL_PROPERTY_TYPES
  )
  assertEqual('and clears the single propertyType', parsedFromMessage.propertyType, null)
}
{
  const parsedFromMessage = { propertyType: 'Studio', propertyTypes: [] }
  applyRawTextPropertyTypeSignals(parsedFromMessage, 'apartment or villa for sale')
  assertEqual(
    'two mentioned types set propertyTypes[] (overriding the stray propertyType)',
    parsedFromMessage.propertyTypes,
    ['Apartment', 'Villa']
  )
  assertEqual('and clears the single propertyType', parsedFromMessage.propertyType, null)
}
{
  const parsedFromMessage = { propertyType: 'Villa', propertyTypes: [] }
  applyRawTextPropertyTypeSignals(parsedFromMessage, 'a villa for sale')
  assertEqual(
    'a single mentioned type leaves propertyType/propertyTypes untouched',
    parsedFromMessage.propertyType,
    'Villa'
  )
  assertEqual('propertyTypes stays empty', parsedFromMessage.propertyTypes, [])
}

line()
console.log('hasSoftDescriptionSearch')
line()

assertTrue('descriptionQuery present -> true', hasSoftDescriptionSearch({ descriptionQuery: 'sea view' }))
assertTrue('searchMode description -> true', hasSoftDescriptionSearch({ searchMode: 'description' }))
assertTrue('searchMode hybrid -> true', hasSoftDescriptionSearch({ searchMode: 'hybrid' }))
assertTrue('non-empty lifestyle[] -> true', hasSoftDescriptionSearch({ lifestyle: ['sea view'] }))
assertTrue('non-empty mustHave[] -> true', hasSoftDescriptionSearch({ mustHave: ['pool'] }))
assertTrue('non-empty niceToHave[] -> true', hasSoftDescriptionSearch({ niceToHave: ['balcony'] }))
assertTrue('non-empty requirements[] -> true', hasSoftDescriptionSearch({ requirements: ['quiet'] }))
assertTrue(
  'plain structured search with none of the above -> false',
  !hasSoftDescriptionSearch({ listingType: 'Sale', propertyType: 'Apartment', searchMode: 'field' })
)
assertTrue('empty object -> false', !hasSoftDescriptionSearch({}))

line()
console.log('hasKnownPropertyType')
line()

assertTrue('propertyType set -> true', hasKnownPropertyType({ propertyType: 'Villa' }))
assertTrue('propertyTypes non-empty -> true', hasKnownPropertyType({ propertyTypes: ['Apartment', 'Villa'] }))
assertTrue('neither set -> false', !hasKnownPropertyType({ propertyType: null, propertyTypes: [] }))
assertTrue('empty object -> false', !hasKnownPropertyType({}))

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
