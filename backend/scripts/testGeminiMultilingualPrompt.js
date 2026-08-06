// backend/scripts/testGeminiMultilingualPrompt.js
//
// Phase 4 (multilingual Gemini parsing) — focused, fully deterministic
// tests for the PROMPT TEXT itself: no Gemini call, no network, no API key
// needed. Verifies structure/content of buildPropertyParserPrompt() and
// parses every "Correct JSON:" example embedded in the prompt to confirm
// none of them ever uses a translated/non-canonical enum value.
//
// This does NOT prove Gemini actually understands Turkish/Arabic input —
// only a live call can prove that (see testGeminiMultilingualSmoke.js).
// This proves the prompt itself is complete, well-formed, and internally
// consistent.
//
// Usage: node scripts/testGeminiMultilingualPrompt.js

import { buildPropertyParserPrompt } from '../utils/geminiPropertyParser.js'
import { CANONICAL_CONCEPT_IDS } from '../utils/lifestyleConcepts.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const assertTrue = (label, condition) => {
  if (condition) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
  }
}

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

const promptEn = buildPropertyParserPrompt('Show me apartments for rent', [], 'en')
const promptTr = buildPropertyParserPrompt('Kiralık daireleri göster', [], 'tr')
const promptAr = buildPropertyParserPrompt('أرني الشقق المعروضة للإيجار', [], 'ar')

line()
console.log('1. Prompt explicitly mentions English, Turkish, Arabic')
line()

assertTrue('mentions "English"', promptEn.includes('English'))
assertTrue('mentions "Turkish"', promptEn.includes('Turkish'))
assertTrue('mentions "Arabic"', promptEn.includes('Arabic'))

line()
console.log('2. Prompt explicitly requires canonical English enums / forbids translated output')
line()

assertTrue('has a CANONICAL OUTPUT DISCIPLINE instruction', promptEn.includes('CANONICAL OUTPUT DISCIPLINE'))
assertTrue('explicitly says never to translate an enum value', /never translate an enum value/i.test(promptEn))
assertTrue('gives a concrete negative example (Kiralık) of what NOT to output', promptEn.includes('Kiralık'))

line()
console.log('3. Prompt contains representative Turkish examples')
line()

assertTrue('contains a full Turkish example sentence (Kadıköy\'de kiralık daire göster)', promptEn.includes("Kadıköy'de kiralık daire göster"))
assertTrue('contains a Turkish lifestyle example (Çocuklarım için okullara yakın)', promptEn.includes('Çocuklarım için okullara yakın'))
assertTrue('contains a Turkish cross-language follow-up example (Kadıköy olsun)', promptEn.includes('Kadıköy olsun'))
assertTrue('contains Turkish vocabulary equivalents (kiralık, satılık, daire)', promptEn.includes('kiralık') && promptEn.includes('satılık') && promptEn.includes('daire'))

line()
console.log('4. Prompt contains representative Arabic examples')
line()

assertTrue('contains a full Arabic example sentence (فيلا للبيع)', promptEn.includes('فيلا للبيع'))
assertTrue('contains an Arabic emotional-context example (زوجتي تعرضت للسرقة)', promptEn.includes('زوجتي تعرضت للسرقة'))
assertTrue('contains Arabic vocabulary equivalents (للإيجار, للبيع, شقة)', promptEn.includes('للإيجار') && promptEn.includes('للبيع') && promptEn.includes('شقة'))
assertTrue('contains Arabic district transliteration examples', promptEn.includes('بيليك دوزو') && promptEn.includes('كاديكوي'))

line()
console.log('5. Prompt contains mixed-language guidance')
line()

assertTrue('explicitly mentions mixed-language messages', /mix languages|mixed-language/i.test(promptEn))
assertTrue('contains a mixed-language example sentence (Beylikdüzü\'nde apartment for rent)', promptEn.includes("Beylikdüzü'nde apartment for rent"))

line()
console.log('6. Prompt still includes all canonical enum values')
line()

const EXPECTED_INTENT_TYPES = ['property_search', 'property_followup', 'casual_chat', 'emotional_message', 'contact_request', 'website_service_question', 'unknown']
const EXPECTED_REPLY_TYPES = ['search', 'ask_question', 'casual_reply', 'support_reply', 'contact_reply', 'service_reply', 'unknown_reply']
const EXPECTED_SEARCH_MODES = ['field', 'description', 'hybrid']
const EXPECTED_LISTING_TYPES = ['Sale', 'Rent']
const EXPECTED_PROPERTY_TYPES = ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm']

EXPECTED_INTENT_TYPES.forEach((v) => assertTrue(`intentType "${v}" present`, promptEn.includes(`"${v}"`)))
EXPECTED_REPLY_TYPES.forEach((v) => assertTrue(`replyType "${v}" present`, promptEn.includes(`"${v}"`)))
EXPECTED_SEARCH_MODES.forEach((v) => assertTrue(`searchMode "${v}" present`, promptEn.includes(`"${v}"`)))
EXPECTED_LISTING_TYPES.forEach((v) => assertTrue(`listingType "${v}" present`, promptEn.includes(`"${v}"`)))
EXPECTED_PROPERTY_TYPES.forEach((v) => assertTrue(`propertyType "${v}" present`, promptEn.includes(`"${v}"`)))
assertTrue('closed lifestyleConcepts vocabulary is embedded', CANONICAL_CONCEPT_IDS.every((id) => promptEn.includes(id)))

line()
console.log('7. Prompt still requires JSON-only output')
line()

assertTrue('says "Return ONLY valid JSON"', promptEn.includes('Return ONLY valid JSON'))
assertTrue('says "No markdown"', promptEn.includes('No markdown'))

line()
console.log('8. Prompt still includes history/context instructions')
line()

assertTrue('has CRITICAL RULES FOR MEMORY section', promptEn.includes('CRITICAL RULES FOR MEMORY'))
assertTrue('instructs reading the entire conversation history', /entire conversation history/i.test(promptEn))
assertTrue('explicitly extends memory continuity across language switches', /language switches between turns/i.test(promptEn))

line()
console.log('9. Prompt length stays within a documented reasonable threshold')
line()

const MAX_PROMPT_LENGTH = 60000
console.log(`  prompt length: ${promptEn.length} characters (threshold: ${MAX_PROMPT_LENGTH})`)
assertTrue(`prompt length (${promptEn.length}) is under the documented threshold (${MAX_PROMPT_LENGTH})`, promptEn.length < MAX_PROMPT_LENGTH)

line()
console.log('10. Existing English examples remain present')
line()

assertTrue('Example 1 (I want an apartment) still present', promptEn.includes('Visitor: I want an apartment'))
assertTrue('Example 4 (casual chat) still present', promptEn.includes('Visitor: how are you?'))
assertTrue('Example 5 (emotional message) still present', promptEn.includes('Visitor: my day was bad'))
assertTrue('Example 9 (uncertain property type) still present', promptEn.includes('Visitor: buy but I am not sure apartment or villa'))
assertTrue('original memory example (Esenyurt follow-up) still present', promptEn.includes('Visitor: what about esenyurt'))
assertTrue('original contact/appointment memory example still present', promptEn.includes('Visitor: can you make an appointment for me'))

line()
console.log('11. No schema field was accidentally removed')
line()

const EXPECTED_SCHEMA_FIELDS = [
  'intent', 'intentType', 'replyType', 'searchMode', 'descriptionQuery', 'nextQuestion',
  'listingType', 'propertyType', 'propertyTypes', 'uncertainPropertyType', 'district', 'districts',
  'beds', 'baths', 'minPrice', 'maxPrice', 'minSqm', 'maxSqm',
  'furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking',
  'mustHave', 'niceToHave', 'lifestyle', 'lifestyleConcepts', 'excludedConcepts',
  'changedMind', 'noPreference', 'requirements', 'needsClarification', 'clarifyingQuestion',
  'districtScopeAction',
]

EXPECTED_SCHEMA_FIELDS.forEach((field) => assertTrue(`schema field "${field}" present`, promptEn.includes(`"${field}"`)))

line()
console.log('13. districtScopeAction rule and examples are present (all languages)')
line()

assertTrue('schema includes districtScopeAction', promptEn.includes('"districtScopeAction"'))
assertTrue('has a DISTRICT SCOPE ANSWER rule section', promptEn.includes('DISTRICT SCOPE ANSWER'))
assertTrue('rule lists all four actions as quoted values', ['keep', 'broaden', 'replace', 'unclear'].every((a) => promptEn.includes(`"${a}"`)))
assertTrue('rule instructs understanding negation', /negation/i.test(promptEn))
assertTrue('has a Turkish broaden-with-negation example', promptEn.includes('Beylikdüzü ile sınırlı kalmana gerek yok'))
assertTrue('has a not-a-district-answer example (stay close to the metro)', /Stay close to the metro/i.test(promptEn))
assertTrue('has an Arabic broaden example', promptEn.includes('لا أريد البقاء في نفس المنطقة'))
assertTrue('has an ordinary-search example that must stay unclear', promptEn.includes('Show me apartments in Kadıköy'))

line()
console.log('12. No "Correct JSON:" example ever uses a non-canonical (translated) enum value')
line()

// Extract every JSON object that follows a "Correct JSON:" marker and parse
// it for real — this is the strongest possible offline check: every
// worked example embedded in the prompt is itself validated against the
// canonical enum lists, not just grepped for as substrings.
const extractCorrectJsonBlocks = (promptText) => {
  const blocks = []
  const marker = 'Correct JSON:\n{'
  let searchFrom = 0

  while (true) {
    const markerIndex = promptText.indexOf(marker, searchFrom)
    if (markerIndex === -1) break

    const jsonStart = markerIndex + 'Correct JSON:\n'.length
    let depth = 0
    let jsonEnd = -1

    for (let i = jsonStart; i < promptText.length; i++) {
      if (promptText[i] === '{') depth++
      if (promptText[i] === '}') {
        depth--
        if (depth === 0) {
          jsonEnd = i + 1
          break
        }
      }
    }

    if (jsonEnd === -1) break

    blocks.push(promptText.slice(jsonStart, jsonEnd))
    searchFrom = jsonEnd
  }

  return blocks
}

const jsonBlocks = extractCorrectJsonBlocks(promptEn)
assertTrue(`found at least 14 "Correct JSON:" example blocks (11 original + new multilingual ones)`, jsonBlocks.length >= 14)

let allBlocksValid = true
let allBlocksCanonical = true

jsonBlocks.forEach((block, index) => {
  let parsed
  try {
    parsed = JSON.parse(block)
  } catch (err) {
    allBlocksValid = false
    console.log(`  ✗ example block #${index + 1} is not valid JSON: ${err.message}`)
    return
  }

  if (parsed.listingType !== null && !EXPECTED_LISTING_TYPES.includes(parsed.listingType)) {
    allBlocksCanonical = false
    console.log(`  ✗ example block #${index + 1} has non-canonical listingType: ${JSON.stringify(parsed.listingType)}`)
  }
  if (parsed.propertyType !== null && !EXPECTED_PROPERTY_TYPES.includes(parsed.propertyType)) {
    allBlocksCanonical = false
    console.log(`  ✗ example block #${index + 1} has non-canonical propertyType: ${JSON.stringify(parsed.propertyType)}`)
  }
  if (parsed.intentType && !EXPECTED_INTENT_TYPES.includes(parsed.intentType)) {
    allBlocksCanonical = false
    console.log(`  ✗ example block #${index + 1} has non-canonical intentType: ${JSON.stringify(parsed.intentType)}`)
  }
  if (parsed.replyType && !EXPECTED_REPLY_TYPES.includes(parsed.replyType)) {
    allBlocksCanonical = false
    console.log(`  ✗ example block #${index + 1} has non-canonical replyType: ${JSON.stringify(parsed.replyType)}`)
  }
  if (parsed.searchMode && !EXPECTED_SEARCH_MODES.includes(parsed.searchMode)) {
    allBlocksCanonical = false
    console.log(`  ✗ example block #${index + 1} has non-canonical searchMode: ${JSON.stringify(parsed.searchMode)}`)
  }
})

assertTrue('every embedded example block is valid, parseable JSON', allBlocksValid)
assertTrue('every embedded example block uses only canonical enum values', allBlocksCanonical)

line()
console.log('Language parameter behavior')
line()

assertTrue('language="en" produces the English website-language hint', promptEn.includes('currently set to English'))
assertTrue('language="tr" produces the Turkish website-language hint', promptTr.includes('currently set to Turkish'))
assertTrue('language="ar" produces the Arabic website-language hint', promptAr.includes('currently set to Arabic'))
assertTrue('an unsupported language falls back to the English hint', buildPropertyParserPrompt('hello', [], 'de').includes('currently set to English'))
assertEqual('omitting language entirely defaults to English (back-compat)', buildPropertyParserPrompt('hello'), buildPropertyParserPrompt('hello', [], 'en'))

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
