// backend/scripts/testChatLanguage.js
//
// Focused, fully deterministic unit tests for utils/chatLanguage.js (Phase 1
// of chatbot multilingual support — language plumbing only). No DB
// connection, no Gemini call, no network. Mirrors the same standard as
// testChatMessageParsing.js.
//
// Also includes a request-level offline test proving the exact integration
// point used by routes/chat.js ("const language = normalizeChatLanguage(
// req.body.language)") behaves correctly for frontend-shaped request bodies
// — without booting the real Express app, DB, or Gemini call the actual
// route depends on.
//
// Usage: node scripts/testChatLanguage.js

import {
  SUPPORTED_CHAT_LANGUAGES,
  DEFAULT_CHAT_LANGUAGE,
  normalizeChatLanguage,
} from '../utils/chatLanguage.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const assertEqual = (label, actual, expected) => {
  const pass = actual === expected
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
console.log('normalizeChatLanguage — supported values preserved')
line()

assertEqual("'en' preserved", normalizeChatLanguage('en'), 'en')
assertEqual("'tr' preserved", normalizeChatLanguage('tr'), 'tr')
assertEqual("'ar' preserved", normalizeChatLanguage('ar'), 'ar')

line()
console.log('normalizeChatLanguage — invalid/missing values fall back to en')
line()

assertEqual("unsupported string 'de' falls back to en", normalizeChatLanguage('de'), 'en')
assertEqual('null falls back to en', normalizeChatLanguage(null), 'en')
assertEqual('undefined falls back to en', normalizeChatLanguage(undefined), 'en')
assertEqual('empty string falls back to en', normalizeChatLanguage(''), 'en')
assertEqual('whitespace-only string falls back to en', normalizeChatLanguage('   '), 'en')

line()
console.log('normalizeChatLanguage — non-string input falls back to en')
line()

assertEqual('number falls back to en', normalizeChatLanguage(42), 'en')
assertEqual('plain object {} falls back to en', normalizeChatLanguage({}), 'en')
assertEqual('array falls back to en', normalizeChatLanguage(['tr']), 'en')
assertEqual('boolean falls back to en', normalizeChatLanguage(true), 'en')

line()
console.log('normalizeChatLanguage — chosen rule: trim + lowercase before matching')
line()

assertEqual("'TR' normalizes to tr", normalizeChatLanguage('TR'), 'tr')
assertEqual("'AR' normalizes to ar", normalizeChatLanguage('AR'), 'ar')
assertEqual("' TR ' (padded) normalizes to tr", normalizeChatLanguage(' TR '), 'tr')
assertEqual("'En' (mixed case) normalizes to en", normalizeChatLanguage('En'), 'en')
assertEqual("'DE' (unsupported, uppercase) falls back to en", normalizeChatLanguage('DE'), 'en')

line()
console.log('normalizeChatLanguage — purity')
line()

assertTrue('does not mutate a string input (primitives are immutable, sanity check only)', (() => {
  const input = 'tr'
  normalizeChatLanguage(input)
  return input === 'tr'
})())

assertTrue('does not mutate an object input passed by mistake', (() => {
  const input = { value: 'tr' }
  const before = JSON.stringify(input)
  normalizeChatLanguage(input)
  return JSON.stringify(input) === before
})())

assertTrue(
  'SUPPORTED_CHAT_LANGUAGES constant is not mutated by repeated calls',
  (() => {
    const before = JSON.stringify(SUPPORTED_CHAT_LANGUAGES)
    normalizeChatLanguage('tr')
    normalizeChatLanguage('ar')
    normalizeChatLanguage('bogus')
    return JSON.stringify(SUPPORTED_CHAT_LANGUAGES) === before
  })()
)

assertEqual('DEFAULT_CHAT_LANGUAGE is en', DEFAULT_CHAT_LANGUAGE, 'en')
assertEqual('SUPPORTED_CHAT_LANGUAGES is exactly [en, tr, ar]', JSON.stringify(SUPPORTED_CHAT_LANGUAGES), JSON.stringify(['en', 'tr', 'ar']))

line()
console.log('Request-level offline test (mirrors routes/chat.js integration point)')
line()

// Exercises the exact line used in routes/chat.js:
//   const language = normalizeChatLanguage(req.body.language)
// against frontend-shaped request bodies, without booting Express, a DB
// connection, or calling Gemini — the route itself cannot be exercised this
// way since it depends on all three, so the normalization boundary is
// isolated and tested directly instead.
const simulateRouteLanguageExtraction = (requestBody) => normalizeChatLanguage(requestBody.language)

const frontendStyleRequestBody = {
  message: 'Show me apartments for rent',
  pageKey: 'rent',
  history: [{ role: 'user', text: 'hello' }],
  currentFilters: {},
  shownPropertyIds: [],
  lastShownProperties: [],
  conversationId: null,
  language: 'tr',
}

assertEqual(
  'frontend-style request body with language: "tr" reaches route normalization as tr',
  simulateRouteLanguageExtraction(frontendStyleRequestBody),
  'tr'
)

const requestBodyMissingLanguage = { ...frontendStyleRequestBody }
delete requestBodyMissingLanguage.language

assertEqual(
  'request body missing language entirely normalizes to en',
  simulateRouteLanguageExtraction(requestBodyMissingLanguage),
  'en'
)

const requestBodyInvalidLanguage = { ...frontendStyleRequestBody, language: 'fr' }

assertEqual(
  'request body with invalid language "fr" normalizes to en',
  simulateRouteLanguageExtraction(requestBodyInvalidLanguage),
  'en'
)

const requestBodyArLanguage = { ...frontendStyleRequestBody, language: 'ar' }

assertEqual(
  'request body with language: "ar" reaches route normalization as ar',
  simulateRouteLanguageExtraction(requestBodyArLanguage),
  'ar'
)

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
