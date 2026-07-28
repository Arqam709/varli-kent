// backend/scripts/testGeminiMultilingualSmoke.js
//
// Phase 4 (multilingual Gemini parsing) — SMALL, CONTROLLED LIVE SMOKE TEST.
// Calls the real Gemini API a limited number of times to sanity-check that
// the updated prompt actually parses Turkish/Arabic/mixed-language messages
// into canonical English enum values. This is NOT part of CI, NOT run
// automatically, and deliberately capped well under the project's free-tier
// quota.
//
// Bypasses routes/chat.js entirely (same safe pattern as the existing
// scripts/testGeminiConceptParsing.js): calls parsePropertyMessageWithGemini
// directly. Never touches the database, never sends an email, never
// exercises the lead-capture/confirmation flow.
//
// Throttled between calls to stay under typical free-tier requests-per-
// minute limits. Stops immediately on the first 429/RESOURCE_EXHAUSTED.
//
// Usage: node scripts/testGeminiMultilingualSmoke.js

import dotenv from 'dotenv'
import { parsePropertyMessageWithGemini } from '../utils/geminiPropertyParser.js'
import { canonicalizeListingType, canonicalizePropertyType, normalizeParsed } from '../services/chatMessageParsing.js'

dotenv.config()

const MODEL_NAME = 'gemini-3.1-flash-lite'
const THROTTLE_MS = 4500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Captures console.log output produced DURING a single call (the parser
// itself logs "Gemini raw text: ..." on success and "Gemini parser failed:
// ..." on any error — missing key, invalid JSON, 429, 503, timeout — all
// indistinguishable from the return value alone, since the parser always
// returns null on failure by design). This lets the smoke test report which
// kind of event happened without changing the parser's own error contract.
const captureConsoleLogs = async (fn) => {
  const lines = []
  const originalLog = console.log
  console.log = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  let result
  try {
    result = await fn()
  } finally {
    console.log = originalLog
  }

  return { result, lines }
}

const classifyEvent = (lines) => {
  const joined = lines.join('\n')
  if (/429|RESOURCE_EXHAUSTED/i.test(joined)) return '429_RESOURCE_EXHAUSTED'
  if (/503|UNAVAILABLE/i.test(joined)) return '503_UNAVAILABLE'
  if (/API key missing/i.test(joined)) return 'MISSING_API_KEY'
  if (/Gemini parser failed/i.test(joined)) return 'OTHER_FAILURE'
  if (/Gemini raw text/i.test(joined)) return 'SUCCESS'
  return 'UNKNOWN'
}

// Each case's `expect` only checks the fields that matter for that case —
// Gemini is free to fill other fields as it judges appropriate; this is not
// a byte-exact JSON match the way the offline facade tests are.
const TEST_CASES = [
  {
    label: '1. EN — basic structured rent search',
    message: 'Show apartments for rent in Kadıköy.',
    history: [],
    expect: (p) => p.listingType === 'Rent' && p.propertyType === 'Apartment' && p.district === 'Kadıköy',
  },
  {
    label: '2. TR — basic structured rent search',
    message: "Kadıköy'de kiralık daire göster.",
    history: [],
    expect: (p) => p.listingType === 'Rent' && p.propertyType === 'Apartment' && p.district === 'Kadıköy',
  },
  {
    label: '3. TR — sale search with pool',
    message: "Beylikdüzü'nde havuzlu satılık villa arıyorum.",
    history: [],
    expect: (p) => p.listingType === 'Sale' && p.propertyType === 'Villa' && p.district === 'Beylikdüzü' && p.pool === true,
  },
  {
    label: '4. TR — budget only',
    message: 'Bütçem 5 milyon TL.',
    history: [],
    expect: (p) => p.maxPrice === 5000000,
  },
  {
    label: '5. TR — lifestyle/description (school, family, safety)',
    message: 'Çocuklarım için okullara yakın güvenli bir ev istiyorum.',
    history: [],
    expect: (p) =>
      ['description', 'hybrid'].includes(p.searchMode) &&
      Array.isArray(p.lifestyleConcepts) &&
      p.lifestyleConcepts.includes('school'),
  },
  {
    label: '6. AR — basic structured rent search',
    message: 'أرني شققاً للإيجار في كاديكوي.',
    history: [],
    expect: (p) => p.listingType === 'Rent' && p.propertyType === 'Apartment',
  },
  {
    label: '7. AR — sale search with pool',
    message: 'أبحث عن فيلا للبيع مع مسبح في بيليك دوزو.',
    history: [],
    expect: (p) => p.listingType === 'Sale' && p.propertyType === 'Villa' && p.pool === true,
  },
  {
    label: '8. AR — budget only',
    message: 'ميزانيتي خمسة ملايين ليرة.',
    history: [],
    expect: (p) => p.maxPrice === 5000000,
  },
  {
    label: '9. AR — lifestyle/description (school, safety)',
    message: 'أريد منزلاً آمناً قريباً من المدارس لأطفالي.',
    history: [],
    expect: (p) =>
      ['description', 'hybrid'].includes(p.searchMode) &&
      Array.isArray(p.lifestyleConcepts) &&
      p.lifestyleConcepts.includes('school'),
  },
  {
    label: '10. Mixed language — Turkish district + English sentence',
    message: "Beylikdüzü'nde apartment for rent.",
    history: [],
    expect: (p) => p.listingType === 'Rent' && p.propertyType === 'Apartment' && p.district === 'Beylikdüzü',
  },
  {
    label: '11. History in English, follow-up in Arabic',
    message: 'ويكون قريباً من المترو.',
    history: [
      { role: 'user', text: 'Show apartments for rent.' },
      { role: 'assistant', text: 'Do you have a preferred district?' },
    ],
    expect: (p) =>
      p.listingType === 'Rent' &&
      p.propertyType === 'Apartment' &&
      Array.isArray(p.lifestyleConcepts) &&
      p.lifestyleConcepts.includes('metro_transport'),
  },
]

const run = async () => {
  console.log('='.repeat(78))
  console.log(`Model: ${MODEL_NAME}`)
  console.log(`Cases: ${TEST_CASES.length} (max allowed: 18)`)
  console.log(`Throttle: ${THROTTLE_MS}ms between calls`)
  console.log('No database writes. No emails. No lead-flow exercised.')
  console.log('='.repeat(78))

  let passCount = 0
  let failCount = 0
  let nullCount = 0

  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i]

    console.log('')
    console.log('-'.repeat(78))
    console.log(testCase.label)
    console.log(`MESSAGE: "${testCase.message}"`)
    if (testCase.history.length > 0) {
      console.log(`HISTORY: ${JSON.stringify(testCase.history)}`)
    }

    const { result: raw, lines } = await captureConsoleLogs(() =>
      parsePropertyMessageWithGemini(testCase.message, testCase.history, 'en')
    )
    const event = classifyEvent(lines)

    console.log(`EVENT: ${event}`)

    if (event === '429_RESOURCE_EXHAUSTED') {
      console.log('')
      console.log('STOPPING: hit 429 RESOURCE_EXHAUSTED — not continuing to further cases, per instructions.')
      console.log(`Cases run before stopping: ${i} / ${TEST_CASES.length}`)
      break
    }

    if (raw === null) {
      nullCount++
      console.log('RESULT: null (Gemini call failed or API key missing — see EVENT above)')
      continue
    }

    // Same normalization the real request pipeline applies (message text is
    // irrelevant here since normalizeParsed's only other job,
    // extractBudgetFromText, is redundant with what Gemini already filled;
    // passing the real message keeps this representative).
    const normalized = normalizeParsed(raw, testCase.message)

    console.log('RAW (key fields):')
    console.log(`  intentType: ${raw.intentType}, replyType: ${raw.replyType}, searchMode: ${raw.searchMode}`)
    console.log(`  listingType: ${JSON.stringify(raw.listingType)}, propertyType: ${JSON.stringify(raw.propertyType)}`)
    console.log(`  district: ${JSON.stringify(raw.district)}, maxPrice: ${JSON.stringify(raw.maxPrice)}, pool: ${JSON.stringify(raw.pool)}`)
    console.log(`  lifestyleConcepts: ${JSON.stringify(raw.lifestyleConcepts)}`)

    console.log('NORMALIZED (after canonicalization guard):')
    console.log(`  listingType: ${JSON.stringify(normalized.listingType)}, propertyType: ${JSON.stringify(normalized.propertyType)}`)

    const rawWasAlreadyCanonical =
      canonicalizeListingType(raw.listingType) === raw.listingType &&
      canonicalizePropertyType(raw.propertyType) === raw.propertyType

    console.log(`CANONICAL DISCIPLINE: raw output already canonical (guard was not needed): ${rawWasAlreadyCanonical}`)

    const passed = Boolean(testCase.expect(normalized))
    console.log(`PASS/FAIL vs expected canonical fields: ${passed ? 'PASS' : 'FAIL'}`)

    if (passed) passCount++
    else failCount++

    if (i < TEST_CASES.length - 1) {
      await sleep(THROTTLE_MS)
    }
  }

  console.log('')
  console.log('='.repeat(78))
  console.log('SMOKE TEST SUMMARY')
  console.log('='.repeat(78))
  console.log(`Passed: ${passCount}`)
  console.log(`Failed: ${failCount}`)
  console.log(`Null (call failed / no API key): ${nullCount}`)
  console.log('This script never wrote to the database, sent an email, or exercised lead capture.')
}

run().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
