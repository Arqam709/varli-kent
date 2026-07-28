// frontend/scripts/testChatbotTranslations.mjs
//
// Focused, fully deterministic check for the chatbot translation namespace
// (Phase 2 of chatbot multilingual support — frontend UI localization only).
// No build step, no browser, no network — plain Node against the
// translations object.
//
// Verifies:
//   1. chatbot namespace exists for en/tr/ar
//   2. all three languages have identical key structure (deep shape match)
//   3. quickQuestions exists per page and has the same length across languages
//   4. no required string is empty
//   5. no accidental English fallback is missing (en itself must be complete)
//
// Usage: node scripts/testChatbotTranslations.mjs

import translations from '../src/locales/translations.js'

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

const LANGS = ['en', 'tr', 'ar']

line()
console.log('chatbot namespace exists for en/tr/ar')
line()

LANGS.forEach((lang) => {
  assertTrue(`translations.${lang}.chatbot exists`, Boolean(translations[lang]?.chatbot))
})

// Returns the sorted list of every leaf path in an object, e.g.
// ['header.advisor', 'header.assistantName', ...] — arrays are treated as
// leaves (their own length is checked separately), not walked element by
// element, since quickQuestions entries are actual translated sentences,
// not structural keys.
const collectLeafPaths = (obj, prefix = '') => {
  const paths = []

  for (const key of Object.keys(obj).sort()) {
    const value = obj[key]
    const path = prefix ? `${prefix}.${key}` : key

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectLeafPaths(value, path))
    } else {
      paths.push(path)
    }
  }

  return paths
}

line()
console.log('all three languages share identical key structure')
line()

const shapesByLang = Object.fromEntries(
  LANGS.map((lang) => [lang, collectLeafPaths(translations[lang]?.chatbot || {})])
)

const enShape = shapesByLang.en

LANGS.filter((lang) => lang !== 'en').forEach((lang) => {
  const otherShape = shapesByLang[lang]

  const missingInOther = enShape.filter((path) => !otherShape.includes(path))
  const extraInOther = otherShape.filter((path) => !enShape.includes(path))

  assertTrue(
    `${lang} has no missing keys compared to en${missingInOther.length ? ` (missing: ${missingInOther.join(', ')})` : ''}`,
    missingInOther.length === 0
  )
  assertTrue(
    `${lang} has no extra/unexpected keys compared to en${extraInOther.length ? ` (extra: ${extraInOther.join(', ')})` : ''}`,
    extraInOther.length === 0
  )
})

line()
console.log('quickQuestions exists per page and has the same length across languages')
line()

const PAGE_KEYS = ['default', 'sale', 'rent', 'propertyDetail']

const quickQuestionLengths = {}

LANGS.forEach((lang) => {
  PAGE_KEYS.forEach((pageKey) => {
    const questions = translations[lang]?.chatbot?.pages?.[pageKey]?.quickQuestions
    assertTrue(`${lang}.chatbot.pages.${pageKey}.quickQuestions is a non-empty array`, Array.isArray(questions) && questions.length > 0)

    quickQuestionLengths[pageKey] = quickQuestionLengths[pageKey] || {}
    quickQuestionLengths[pageKey][lang] = Array.isArray(questions) ? questions.length : -1
  })
})

PAGE_KEYS.forEach((pageKey) => {
  const lengths = quickQuestionLengths[pageKey]
  const allSame = LANGS.every((lang) => lengths[lang] === lengths.en)

  assertTrue(
    `${pageKey}.quickQuestions has the same length across en/tr/ar (${JSON.stringify(lengths)})`,
    allSame
  )
})

line()
console.log('no required string is empty (deep scan, leaves only)')
line()

const collectEmptyLeaves = (obj, prefix = '') => {
  const empties = []

  for (const key of Object.keys(obj)) {
    const value = obj[key]
    const path = prefix ? `${prefix}.${key}` : key

    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (typeof entry === 'string' && entry.trim() === '') empties.push(`${path}[${index}]`)
      })
    } else if (value !== null && typeof value === 'object') {
      empties.push(...collectEmptyLeaves(value, path))
    } else if (typeof value === 'string' && value.trim() === '') {
      empties.push(path)
    }
  }

  return empties
}

LANGS.forEach((lang) => {
  const emptyLeaves = collectEmptyLeaves(translations[lang]?.chatbot || {})
  assertTrue(
    `${lang}.chatbot has no empty strings${emptyLeaves.length ? ` (empty: ${emptyLeaves.join(', ')})` : ''}`,
    emptyLeaves.length === 0
  )
})

line()
console.log('en itself is complete (no accidental fallback masking a missing key)')
line()

assertTrue('en.chatbot has at least the expected top-level sections', [
  'toggleButton', 'header', 'aria', 'actions', 'history', 'transcript', 'thinking', 'propertyCard', 'pages',
].every((key) => key in (translations.en.chatbot || {})))

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
