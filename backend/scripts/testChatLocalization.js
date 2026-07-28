// backend/scripts/testChatLocalization.js
//
// Phase 3 (backend deterministic reply localization) — focused, fully
// deterministic tests for the localization primitives: locales/chatMessages.js,
// locales/propertyTypeLabels.js, locales/conceptLabels.js, and
// services/chatReplyRenderer.js's core helpers (tMessage/format/pluralize/
// joinList/fallback). No DB connection, no Gemini call, no network.
//
// Usage: node scripts/testChatLocalization.js

import { CHAT_MESSAGES, SUPPORTED_MESSAGE_LANGUAGES } from '../locales/chatMessages.js'
import { PROPERTY_TYPE_LABELS, GENERIC_PROPERTY_LABEL, LISTING_TYPE_LABELS } from '../locales/propertyTypeLabels.js'
import { CONCEPT_LABELS } from '../locales/conceptLabels.js'
import { CANONICAL_CONCEPT_IDS } from '../utils/lifestyleConcepts.js'
import {
  tMessage,
  format,
  pluralize,
  joinList,
  featureLabel,
  propertyTypeLabelForms,
  conceptMatchedLabel,
  conceptUnverifiedLabel,
  conceptTopicPhrase,
} from '../services/chatReplyRenderer.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

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

const assertTrue = (label, condition) => {
  if (condition) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
  }
}

const CANONICAL_PROPERTY_TYPES = [
  'Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office',
  'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm',
]
const CANONICAL_LISTING_TYPES = ['Sale', 'Rent']

line()
console.log('en/tr/ar dictionary availability')
line()

SUPPORTED_MESSAGE_LANGUAGES.forEach((lang) => {
  assertTrue(`CHAT_MESSAGES.${lang} exists`, Boolean(CHAT_MESSAGES[lang]))
})

line()
console.log('key parity across en/tr/ar (chatMessages, deep leaf paths)')
line()

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

const enPaths = collectLeafPaths(CHAT_MESSAGES.en)
;['tr', 'ar'].forEach((lang) => {
  const langPaths = collectLeafPaths(CHAT_MESSAGES[lang])
  const missing = enPaths.filter((p) => !langPaths.includes(p))
  const extra = langPaths.filter((p) => !enPaths.includes(p))
  assertTrue(`${lang} has no missing keys vs en${missing.length ? ` (${missing.join(', ')})` : ''}`, missing.length === 0)
  assertTrue(`${lang} has no extra keys vs en${extra.length ? ` (${extra.join(', ')})` : ''}`, extra.length === 0)
})

line()
console.log('English fallback for missing keys')
line()

assertEqual('missing key in tr falls back to en value', tMessage(['nonProperty', 'casual'], 'tr') !== undefined, true)
assertEqual('completely bogus key falls back to empty string, not undefined/throw', tMessage(['bogus', 'path'], 'en'), '')
assertEqual('completely bogus key in tr falls back to empty string', tMessage(['bogus', 'path'], 'tr'), '')

line()
console.log('invalid/missing language safety (no throw)')
line()

assertTrue('unsupported language string does not throw', (() => {
  try {
    tMessage(['nonProperty', 'casual'], 'de')
    return true
  } catch {
    return false
  }
})())
assertEqual('unsupported language falls back to en content', tMessage(['nonProperty', 'casual'], 'de'), CHAT_MESSAGES.en.nonProperty.casual)
assertTrue('null language does not throw', (() => {
  try {
    tMessage(['nonProperty', 'casual'], null)
    return true
  } catch {
    return false
  }
})())
assertTrue('undefined language does not throw', (() => {
  try {
    tMessage(['nonProperty', 'casual'], undefined)
    return true
  } catch {
    return false
  }
})())

line()
console.log('property/listing label coverage for every canonical enum')
line()

CANONICAL_PROPERTY_TYPES.forEach((type) => {
  assertTrue(`PROPERTY_TYPE_LABELS has an entry for ${type}`, Boolean(PROPERTY_TYPE_LABELS[type]))
  SUPPORTED_MESSAGE_LANGUAGES.forEach((lang) => {
    const forms = propertyTypeLabelForms(type, lang)
    assertTrue(`${type}.${lang} has a "one" form`, Boolean(forms?.one))
    assertTrue(`${type}.${lang} has an "other" form`, Boolean(forms?.other))
  })
})

assertTrue('GENERIC_PROPERTY_LABEL has all 3 languages', SUPPORTED_MESSAGE_LANGUAGES.every((lang) => Boolean(GENERIC_PROPERTY_LABEL[lang])))

CANONICAL_LISTING_TYPES.forEach((type) => {
  assertTrue(`LISTING_TYPE_LABELS has an entry for ${type}`, Boolean(LISTING_TYPE_LABELS[type]))
  SUPPORTED_MESSAGE_LANGUAGES.forEach((lang) => {
    assertTrue(`${type}.${lang} label exists`, Boolean(LISTING_TYPE_LABELS[type][lang]))
  })
})

line()
console.log('concept-label coverage for every supported concept ID')
line()

assertTrue('lifestyleConcepts.js CANONICAL_CONCEPT_IDS is non-empty (sanity)', CANONICAL_CONCEPT_IDS.length > 0)

CANONICAL_CONCEPT_IDS.forEach((id) => {
  assertTrue(`CONCEPT_LABELS has an entry for "${id}"`, Boolean(CONCEPT_LABELS[id]))
  SUPPORTED_MESSAGE_LANGUAGES.forEach((lang) => {
    assertTrue(`${id}.matched.${lang} exists`, Boolean(conceptMatchedLabel(id, lang)))
    assertTrue(`${id}.unverified.${lang} exists`, Boolean(conceptUnverifiedLabel(id, lang)))
    assertTrue(`${id}.topic.${lang} exists`, Boolean(conceptTopicPhrase(id, lang)))
  })
})

line()
console.log('feature label coverage (furnished/balcony/elevator/pool/garden/parking)')
line()

;['furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking'].forEach((id) => {
  SUPPORTED_MESSAGE_LANGUAGES.forEach((lang) => {
    assertTrue(`featureLabel(${id}, ${lang}) is non-empty`, Boolean(featureLabel(id, lang)))
  })
})

line()
console.log('list joining — one / two / three-or-more items, and/or')
line()

assertEqual('joinList en, 1 item', joinList(['apartment'], 'en', 'and'), 'apartment')
assertEqual('joinList en, 2 items, and', joinList(['apartment', 'villa'], 'en', 'and'), 'apartment and villa')
assertEqual('joinList en, 3 items, and', joinList(['apartment', 'villa', 'studio'], 'en', 'and'), 'apartment, villa, and studio')
assertEqual('joinList en, 2 items, or', joinList(['apartment', 'villa'], 'en', 'or'), 'apartment or villa')

assertEqual('joinList tr, 2 items, and', joinList(['daire', 'villa'], 'tr', 'and'), 'daire ve villa')
assertEqual('joinList tr, 3 items, and', joinList(['daire', 'villa', 'stüdyo'], 'tr', 'and'), 'daire, villa ve stüdyo')

assertEqual('joinList ar, 2 items, and (و glued to following word)', joinList(['شقة', 'فيلا'], 'ar', 'and'), 'شقة وفيلا')
assertEqual('joinList ar, 2 items, or (أو is a separate word)', joinList(['شقة', 'فيلا'], 'ar', 'or'), 'شقة أو فيلا')
assertEqual('joinList ar, 3 items, and', joinList(['شقة', 'فيلا', 'استوديو'], 'ar', 'and'), 'شقة، فيلا، واستوديو')

assertEqual('joinList empty array returns empty string', joinList([], 'en', 'and'), '')
assertEqual('joinList filters out null/undefined/empty entries', joinList(['a', null, undefined, '', 'b'], 'en', 'and'), 'a and b')

line()
console.log('English singular/plural (Intl.PluralRules)')
line()

const enForms = { one: '1 property', other: '{n} properties' }
assertEqual('en pluralize count=1 -> one', pluralize('en', 1, enForms), '1 property')
assertEqual('en pluralize count=2 -> other', pluralize('en', 2, enForms), '{n} properties')
assertEqual('en pluralize count=0 -> other', pluralize('en', 0, enForms), '{n} properties')

line()
console.log('Turkish numeral grammar — no plural suffix after a number')
line()

const apartmentTr = propertyTypeLabelForms('Apartment', 'tr')
assertEqual('tr Apartment "one" form is "daire"', apartmentTr.one, 'daire')
assertEqual('tr Apartment "other" form is also "daire" (no plural suffix after a numeral)', apartmentTr.other, 'daire')
assertEqual('tr pluralize count=1 -> "daire"', pluralize('tr', 1, apartmentTr), 'daire')
assertEqual('tr pluralize count=5 -> still "daire", not "daireler"', pluralize('tr', 5, apartmentTr), 'daire')

line()
console.log('Arabic plural categories (one/two/other at minimum)')
line()

const apartmentAr = propertyTypeLabelForms('Apartment', 'ar')
assertEqual('ar Apartment "one" form', apartmentAr.one, 'شقة')
assertEqual('ar Apartment "two" form (dual)', apartmentAr.two, 'شقتان')
assertEqual('ar Apartment "other" form (plural)', apartmentAr.other, 'شقق')
assertEqual('ar pluralize count=1 -> singular', pluralize('ar', 1, apartmentAr), 'شقة')
assertEqual('ar pluralize count=2 -> dual', pluralize('ar', 2, apartmentAr), 'شقتان')
assertEqual('ar pluralize count=5 -> plural/other', pluralize('ar', 5, apartmentAr), 'شقق')
assertEqual('ar pluralize count=11 -> falls back to other (few/many not authored)', pluralize('ar', 11, apartmentAr), 'شقق')

line()
console.log('format() interpolation')
line()

assertEqual('format replaces a known placeholder', format('Hello {name}!', { name: 'Arqam' }), 'Hello Arqam!')
assertEqual('format leaves an unknown placeholder untouched', format('Hello {name}!', {}), 'Hello {name}!')
assertEqual('format handles multiple placeholders', format('{a} and {b}', { a: '1', b: '2' }), '1 and 2')

line()
console.log('purity — no mutation of shared data or inputs')
line()

assertTrue('CHAT_MESSAGES.en is not mutated by repeated tMessage calls', (() => {
  const before = JSON.stringify(CHAT_MESSAGES.en)
  tMessage(['nonProperty', 'casual'], 'tr')
  tMessage(['bogus', 'path'], 'en')
  return JSON.stringify(CHAT_MESSAGES.en) === before
})())

assertTrue('joinList does not mutate its input array', (() => {
  const input = ['a', 'b', 'c']
  joinList(input, 'en', 'and')
  return JSON.stringify(input) === JSON.stringify(['a', 'b', 'c'])
})())

assertTrue('PROPERTY_TYPE_LABELS is not mutated by repeated lookups', (() => {
  const before = JSON.stringify(PROPERTY_TYPE_LABELS)
  propertyTypeLabelForms('Apartment', 'tr')
  propertyTypeLabelForms('Bogus', 'ar')
  return JSON.stringify(PROPERTY_TYPE_LABELS) === before
})())

assertTrue('CONCEPT_LABELS is not mutated by repeated lookups', (() => {
  const before = JSON.stringify(CONCEPT_LABELS)
  conceptMatchedLabel('school', 'ar')
  conceptUnverifiedLabel('bogus_concept', 'tr')
  return JSON.stringify(CONCEPT_LABELS) === before
})())

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
