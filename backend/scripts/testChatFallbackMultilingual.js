// backend/scripts/testChatFallbackMultilingual.js
//
// Phase 5 (multilingual deterministic fallback property parsing) — focused,
// fully deterministic unit tests. No DB connection, no Gemini call, no
// network. Covers ONLY the safety-net keyword parser (keywordFallbackParser
// in services/chatMessageParsing.js) and its supporting vocabulary
// (locales/chatParsingVocabulary.js) — never a general translator, this
// proves basic structured property-search recognition in English, Turkish,
// Arabic, and mixed-language messages, always resolving to canonical
// English enum output.
//
// Usage: node scripts/testChatFallbackMultilingual.js

import {
  keywordFallbackParser,
  normalizeParsed,
  applyRawTextPropertyTypeSignals,
  detectMentionedDistricts,
  detectMentionedPropertyTypes,
  messageRequestsResidential,
  extractBudgetFromText,
} from '../services/chatMessageParsing.js'
import {
  normalizeDigits,
  normalizeForMatching,
} from '../locales/chatParsingVocabulary.js'

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

// Canonical enum sets — used repeatedly by the "purity" tests below.
const CANONICAL_LISTING_TYPES = ['Sale', 'Rent']
const CANONICAL_PROPERTY_TYPES = [
  'Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office',
  'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm',
]

line()
console.log('A. Listing type — English / Turkish / Arabic / mixed')
line()

assertEqual('EN "I want to rent an apartment" -> Rent', keywordFallbackParser('I want to rent an apartment').listingType, 'Rent')
assertEqual('EN "looking to buy a villa" -> Sale', keywordFallbackParser('looking to buy a villa').listingType, 'Sale')
assertEqual('TR "kiralık daire arıyorum" -> Rent', keywordFallbackParser('kiralık daire arıyorum').listingType, 'Rent')
assertEqual('TR "satılık villa istiyorum" -> Sale', keywordFallbackParser('satılık villa istiyorum').listingType, 'Sale')
assertEqual('TR ASCII-folded "kiralik daire" -> Rent', keywordFallbackParser('kiralik daire').listingType, 'Rent')
assertEqual('TR ASCII-folded "satilik ev" -> Sale', keywordFallbackParser('satilik ev').listingType, 'Sale')
assertEqual('AR "أبحث عن شقة للإيجار" -> Rent', keywordFallbackParser('أبحث عن شقة للإيجار').listingType, 'Rent')
assertEqual('AR "أريد فيلا للبيع" -> Sale', keywordFallbackParser('أريد فيلا للبيع').listingType, 'Sale')
assertEqual(
  'Mixed TR district + EN sentence "Kadıköy\'de apartment for rent" -> Rent',
  keywordFallbackParser("Kadıköy'de apartment for rent").listingType,
  'Rent'
)
assertEqual(
  'Mixed AR + EN "أريد villa for sale in Beylikdüzü" -> Sale',
  keywordFallbackParser('أريد villa for sale in Beylikdüzü').listingType,
  'Sale'
)
assertEqual('no listing-type words -> null', keywordFallbackParser('a nice place please').listingType, null)

line()
console.log('B. Property type — English / Turkish / Arabic / mixed')
line()

assertEqual('EN "a flat please" -> Apartment', keywordFallbackParser('a flat please').propertyType, 'Apartment')
assertEqual('EN "a villa please" -> Villa', keywordFallbackParser('a villa please').propertyType, 'Villa')
assertEqual('TR "daire istiyorum" -> Apartment', keywordFallbackParser('daire istiyorum').propertyType, 'Apartment')
assertEqual('TR "bir villa istiyorum" -> Villa', keywordFallbackParser('bir villa istiyorum').propertyType, 'Villa')
assertEqual('TR "ofis arıyorum" -> Office', keywordFallbackParser('ofis arıyorum').propertyType, 'Office')
assertEqual('TR "arsa arıyorum" -> Land', keywordFallbackParser('arsa arıyorum').propertyType, 'Land')
assertEqual('AR "شقة أبحث عنها" -> Apartment', keywordFallbackParser('شقة أبحث عنها').propertyType, 'Apartment')
assertEqual('AR "فيلا فخمة" -> Villa', keywordFallbackParser('فيلا فخمة').propertyType, 'Villa')
assertEqual('AR "أبحث عن مكتب" -> Office', keywordFallbackParser('أبحث عن مكتب').propertyType, 'Office')
assertEqual('AR "مستودع كبير" -> Warehouse', keywordFallbackParser('مستودع كبير').propertyType, 'Warehouse')
assertEqual('TR "otel arıyorum" -> Hotel', keywordFallbackParser('otel arıyorum').propertyType, 'Hotel')
assertEqual('TR "çiftlik istiyorum" -> Farm', keywordFallbackParser('çiftlik istiyorum').propertyType, 'Farm')

line()
console.log('B2. Ambiguous generic words (home/house/ev/منزل/بيت) must NOT resolve to a specific type')
line()

assertEqual('EN "a nice home" -> propertyType stays null (not auto-mapped to Villa)', keywordFallbackParser('a nice home').propertyType, null)
assertEqual('EN "looking for a house" -> propertyType stays null', keywordFallbackParser('looking for a house').propertyType, null)
assertEqual('TR "güzel bir ev istiyorum" -> propertyType stays null', keywordFallbackParser('güzel bir ev istiyorum').propertyType, null)
assertEqual('AR "أريد منزلاً جميلاً" -> propertyType stays null', keywordFallbackParser('أريد منزلاً جميلاً').propertyType, null)
assertEqual('AR "أبحث عن بيت" -> propertyType stays null', keywordFallbackParser('أبحث عن بيت').propertyType, null)

line()
console.log('C. Districts — accented, ASCII-folded, and Arabic-transliteration aliases')
line()

assertEqual('EN "rent in Kadıköy" -> single district', keywordFallbackParser('rent in Kadıköy').district, 'Kadıköy')
assertEqual(
  'AR transliteration "أبحث عن شقة في كاديكوي" resolves to canonical "Kadıköy" (never the Arabic form)',
  keywordFallbackParser('أبحث عن شقة في كاديكوي').district,
  'Kadıköy'
)
assertEqual(
  'AR transliteration "فيلا للبيع في بيليك دوزو" resolves to canonical "Beylikdüzü"',
  keywordFallbackParser('فيلا للبيع في بيليك دوزو').district,
  'Beylikdüzü'
)
assertEqual(
  'AR transliteration "بشكتاش" resolves to canonical "Beşiktaş"',
  detectMentionedDistricts('شقة في بشكتاش'),
  ['Beşiktaş']
)
assertEqual(
  'AR transliteration "اوسكودار" (no hamza) resolves to canonical "Üsküdar"',
  detectMentionedDistricts('اوسكودار bölgesinde'),
  ['Üsküdar']
)
assertEqual(
  'district alias never leaks the Arabic spelling itself as output',
  keywordFallbackParser('كاديكوي').district !== 'كاديكوي' && keywordFallbackParser('كاديكوي').district === 'Kadıköy',
  true
)
assertEqual(
  'multiple districts (EN) still assign to districts[]',
  keywordFallbackParser('Kadıköy or Beşiktaş').districts,
  ['Kadıköy', 'Beşiktaş']
)

line()
console.log('D. Bedrooms/bathrooms — digits, "N+1", spelled-out numbers, Arabic dual forms')
line()

assertEqual('EN "3 bedroom apartment" -> beds 3', keywordFallbackParser('3 bedroom apartment').beds, 3)
assertEqual('EN "3+1 apartment" -> beds 3', keywordFallbackParser('3+1 apartment').beds, 3)
assertEqual('EN "three bedrooms" -> beds 3', keywordFallbackParser('three bedrooms please').beds, 3)
assertEqual('TR "3 oda" -> beds 3', keywordFallbackParser('3 oda daire').beds, 3)
assertEqual('TR "üç oda istiyorum" -> beds 3', keywordFallbackParser('üç oda istiyorum').beds, 3)
assertEqual('AR "3 غرف نوم" -> beds 3', keywordFallbackParser('شقة فيها 3 غرف نوم').beds, 3)
assertEqual('AR "ثلاث غرف نوم" (spelled-out) -> beds 3', keywordFallbackParser('شقة بثلاث غرف نوم').beds, 3)
assertEqual('AR dual form "غرفتين" -> beds 2', keywordFallbackParser('شقة غرفتين للإيجار').beds, 2)
assertEqual('EN "2 bathrooms" -> baths 2', keywordFallbackParser('2 bathrooms').baths, 2)
assertEqual('TR "2 banyo" -> baths 2', keywordFallbackParser('2 banyo').baths, 2)
assertEqual('AR "حمامين" (dual form) -> baths 2', keywordFallbackParser('شقة حمامين').baths, 2)
assertEqual('AR "2 حمام" -> baths 2', keywordFallbackParser('شقة فيها 2 حمام').baths, 2)

line()
console.log('E. Budget — million/thousand scale words in EN/TR/AR, decimal comma, digit normalization')
line()

assertEqual('EN "under 8 million" -> maxPrice 8000000', keywordFallbackParser('under 8 million').maxPrice, 8000000)
assertEqual('EN "above 5 million" -> minPrice 5000000', keywordFallbackParser('above 5 million').minPrice, 5000000)
assertEqual('EN shorthand "8m budget" -> maxPrice 8000000', keywordFallbackParser('8m budget').maxPrice, 8000000)
assertEqual('TR "5 milyon TL bütçem var" -> maxPrice 5000000', keywordFallbackParser('5 milyon TL bütçem var').maxPrice, 5000000)
assertEqual(
  'TR decimal comma "3,5 milyon TL" -> maxPrice 3500000 (comma treated as decimal point when a scale word follows)',
  keywordFallbackParser('3,5 milyon TL').maxPrice,
  3500000
)
assertEqual('TR "20 bin TL" (thousand) -> maxPrice 20000', keywordFallbackParser('kirası 20 bin TL').maxPrice, 20000)
assertEqual('AR "ميزانيتي خمسة ملايين" is not scaled by number-word (out of scope) but literal "5 مليون" is', keywordFallbackParser('ميزانيتي 5 مليون ليرة').maxPrice, 5000000)
assertEqual('AR "أكثر من 5 مليون" -> minPrice 5000000 (above marker)', keywordFallbackParser('أكثر من 5 مليون ليرة').minPrice, 5000000)
assertEqual('AR "أقل من 8 مليون" -> maxPrice 8000000 (under marker)', keywordFallbackParser('أقل من 8 مليون ليرة').maxPrice, 8000000)
assertEqual(
  'Arabic-Indic digits "٨ مليون" -> maxPrice 8000000',
  keywordFallbackParser('أقل من ٨ مليون ليرة').maxPrice,
  8000000
)
assertEqual(
  'Persian digits "۵ میلیون" style Arabic-Indic mix -> maxPrice 5000000',
  keywordFallbackParser('أقل من ۵ مليون ليرة').maxPrice,
  5000000
)
assertEqual(
  'plain bare Arabic-Indic budget number (no scale word) via extractBudgetFromText: "٢٥٠٠٠"',
  extractBudgetFromText('ميزانيتي ٢٥٠٠٠', {}).maxPrice,
  25000
)

line()
console.log('F. Square meters (new field) — only with an explicit qualifier')
line()

assertEqual('EN "at least 120 sqm" -> minSqm 120', keywordFallbackParser('at least 120 sqm').minSqm, 120)
assertEqual('EN "under 200 sqm" -> maxSqm 200', keywordFallbackParser('under 200 sqm').maxSqm, 200)
assertEqual('TR "en az 100 metrekare" -> minSqm 100', keywordFallbackParser('en az 100 metrekare').minSqm, 100)
assertEqual('TR "150 metrekare altında" -> maxSqm 150', keywordFallbackParser('150 metrekare altında').maxSqm, 150)
assertEqual('AR "على الأقل 100 متر مربع" -> minSqm 100', keywordFallbackParser('على الأقل 100 متر مربع').minSqm, 100)
assertEqual('AR "أقل من 200 متر مربع" -> maxSqm 200', keywordFallbackParser('أقل من 200 متر مربع').maxSqm, 200)
assertEqual(
  'bare "120 sqm" with no qualifier -> neither minSqm nor maxSqm set (no safe default direction)',
  { min: keywordFallbackParser('120 sqm apartment').minSqm, max: keywordFallbackParser('120 sqm apartment').maxSqm },
  { min: null, max: null }
)

line()
console.log('G. Boolean features — English / Turkish / Arabic')
line()

assertTrue('EN "with a pool" -> pool true', keywordFallbackParser('with a pool').pool === true)
assertTrue('TR "havuzlu villa" -> pool true', keywordFallbackParser('havuzlu villa').pool === true)
assertTrue('AR "مع مسبح" -> pool true', keywordFallbackParser('مع مسبح').pool === true)
assertTrue('TR "bahçeli daire" -> garden true', keywordFallbackParser('bahçeli daire').garden === true)
assertTrue('AR "مع حديقة" -> garden true', keywordFallbackParser('مع حديقة').garden === true)
assertTrue('TR "eşyalı daire" -> furnished true', keywordFallbackParser('eşyalı daire').furnished === true)
assertTrue('AR "مفروش" -> furnished true', keywordFallbackParser('شقة مفروشة مفروش').furnished === true)
assertTrue('TR "asansörlü bina" -> elevator true', keywordFallbackParser('asansörlü bina').elevator === true)
assertTrue('AR "مصعد" -> elevator true', keywordFallbackParser('بها مصعد').elevator === true)
assertTrue('TR "otoparklı" -> parking true', keywordFallbackParser('otoparklı bina').parking === true)
assertTrue('AR "موقف سيارات" -> parking true', keywordFallbackParser('مع موقف سيارات').parking === true)
assertTrue('TR "balkonlu" -> balcony true', keywordFallbackParser('balkonlu daire').balcony === true)
assertTrue('AR "شرفة" -> balcony true', keywordFallbackParser('مع شرفة').balcony === true)

line()
console.log('H. Multiple property types mentioned in one message (detectMentionedPropertyTypes)')
line()

assertEqual('EN "apartment or villa" -> both, in vocabulary order', detectMentionedPropertyTypes('apartment or villa'), ['Apartment', 'Villa'])
assertEqual(
  'TR "daire ya da villa" -> both',
  detectMentionedPropertyTypes('daire ya da villa'),
  ['Apartment', 'Villa']
)
assertEqual(
  'AR "شقة أو فيلا" -> both',
  detectMentionedPropertyTypes('شقة أو فيلا'),
  ['Apartment', 'Villa']
)
assertEqual(
  'Mixed "villa or شقة" -> both, no duplicates',
  detectMentionedPropertyTypes('villa or شقة'),
  ['Apartment', 'Villa']
)
assertEqual('none mentioned -> []', detectMentionedPropertyTypes('a nice place'), [])

line()
console.log('H2. messageRequestsResidential — English guard + Turkish/Arabic substrings')
line()

assertTrue('EN "show me residential properties" matches', messageRequestsResidential('show me residential properties'))
assertTrue('EN "nonresidential" does NOT match (word-boundary guard preserved)', !messageRequestsResidential('a nonresidential building'))
assertTrue('TR "konut arıyorum" matches', messageRequestsResidential('konut arıyorum'))
assertTrue('AR "أبحث عن عقار سكني" matches', messageRequestsResidential('أبحث عن عقار سكني'))
assertTrue('no match for unrelated text', !messageRequestsResidential('a nice villa'))

line()
console.log('I. Lifestyle/description fallback signal (optional Phase 5 scope, implemented)')
line()

{
  const result = keywordFallbackParser('I want a house near schools for my kids')
  assertTrue('EN "near schools" -> lifestyle contains a school phrase', result.lifestyle.some((p) => p.includes('school')))
  assertEqual('EN description-only message -> searchMode description (no structured signal present)', result.searchMode, 'description')
}
{
  // "okullara" (dative "to schools") is a Turkish inflected form not in the
  // base keyword list (see the limitation noted in lifestyleConcepts.js) —
  // this uses the bare nominative "okul" instead, which the word-list
  // matcher does recognize.
  const result = keywordFallbackParser('Çocuklarım için okul yakınında güvenli bir ev istiyorum')
  assertTrue('TR "okul" + "güvenli" -> lifestyle recognizes school concept', result.lifestyle.some((p) => p.includes('school')))
  assertTrue('TR "güvenli" -> lifestyle recognizes safety concept', result.lifestyle.some((p) => p.includes('safe')))
}
{
  const result = keywordFallbackParser('أريد شقة للإيجار قريبة من المدارس')
  assertEqual('AR "للإيجار" -> listingType Rent (structured signal present alongside lifestyle)', result.listingType, 'Rent')
  assertTrue('AR "المدارس" -> lifestyle recognizes school concept', result.lifestyle.some((p) => p.includes('school')))
  assertEqual('AR structured + lifestyle together -> searchMode hybrid', result.searchMode, 'hybrid')
}
{
  const result = keywordFallbackParser('a plain apartment for rent in Kadıköy')
  assertEqual('purely structured message (no lifestyle words) -> lifestyle stays empty', result.lifestyle, [])
  assertEqual('purely structured message -> searchMode stays default field', result.searchMode, 'field')
}

line()
console.log('J. Canonicalization / purity — output is ALWAYS a canonical English enum value, never a translation')
line()

for (const message of [
  'kiralık daire',
  'satılık villa',
  'أبحث عن شقة للإيجار',
  'أريد فيلا للبيع',
  'ofis arıyorum',
  'أبحث عن مكتب',
  'مستودع كبير',
  'çiftlik istiyorum',
]) {
  const result = keywordFallbackParser(message)
  if (result.listingType !== null) {
    assertTrue(
      `listingType for "${message}" is a canonical English value (${result.listingType})`,
      CANONICAL_LISTING_TYPES.includes(result.listingType)
    )
  }
  if (result.propertyType !== null) {
    assertTrue(
      `propertyType for "${message}" is a canonical English value (${result.propertyType})`,
      CANONICAL_PROPERTY_TYPES.includes(result.propertyType)
    )
  }
}

assertTrue(
  'district output is always the canonical spelling, never the raw Arabic alias text',
  (() => {
    const result = keywordFallbackParser('كاديكوي')
    return result.district === 'Kadıköy'
  })()
)

assertTrue(
  'normalizeParsed on top of keywordFallbackParser output changes nothing (already canonical)',
  (() => {
    const raw = keywordFallbackParser('أبحث عن فيلا للبيع في بيليك دوزو')
    const normalized = normalizeParsed(raw, 'أبحث عن فيلا للبيع في بيليك دوزو')
    return normalized.listingType === raw.listingType && normalized.propertyType === raw.propertyType && normalized.district === raw.district
  })()
)

line()
console.log('K. Digit normalization helpers (chatParsingVocabulary.js)')
line()

assertEqual('Arabic-Indic digits normalize to Western digits', normalizeDigits('٣٢١'), '321')
assertEqual('Persian digits normalize to Western digits', normalizeDigits('۹۸۷'), '987')
assertEqual('mixed Arabic-Indic + Western digits normalize correctly', normalizeDigits('١2٣'), '123')
assertEqual(
  'Turkish İ (dotted capital I) folds to plain "i", not a stray combining mark',
  normalizeForMatching('KİRALIK'),
  'kiralik'
)
assertEqual(
  'plain ASCII "KIRALIK" also lowercases correctly (no over-correction)',
  normalizeForMatching('KIRALIK'),
  'kiralik'
)

line()
console.log('L. Gemini-failure simulation (routes/chat.js pipeline shape) — no live Gemini call, no DB writes')
line()

// Mirrors routes/chat.js's exact fallback sequence when
// parsePropertyMessageWithGemini returns null/falsy:
//   keywordFallbackParser(message) -> normalizeParsed(...) -> applyRawTextPropertyTypeSignals(...)
// This test never imports or calls parsePropertyMessageWithGemini, never
// touches Mongoose/Property, and never sends an email — it only proves the
// SAME sequence routes/chat.js runs on Gemini failure produces safe,
// canonical output for a multilingual message.
{
  const simulatedGeminiFailureMessage = 'Kadıköy\'de kiralık daire arıyorum, 3+1, havuzlu, en fazla 5 milyon'
  let parsedFromMessage = null // simulated Gemini failure (429/503/timeout/invalid JSON/missing key)

  if (!parsedFromMessage) {
    parsedFromMessage = keywordFallbackParser(simulatedGeminiFailureMessage)
  }

  parsedFromMessage = normalizeParsed(parsedFromMessage, simulatedGeminiFailureMessage)
  applyRawTextPropertyTypeSignals(parsedFromMessage, simulatedGeminiFailureMessage)

  assertEqual('simulated fallback: listingType Rent', parsedFromMessage.listingType, 'Rent')
  assertEqual('simulated fallback: propertyType Apartment', parsedFromMessage.propertyType, 'Apartment')
  assertEqual('simulated fallback: district Kadıköy', parsedFromMessage.district, 'Kadıköy')
  assertEqual('simulated fallback: beds 3 (from 3+1)', parsedFromMessage.beds, 3)
  assertTrue('simulated fallback: pool true', parsedFromMessage.pool === true)
  assertEqual('simulated fallback: maxPrice 5000000', parsedFromMessage.maxPrice, 5000000)
  assertEqual('simulated fallback: intentType still valid (normalizeParsed ran)', parsedFromMessage.intentType, 'property_search')
}

{
  const simulatedGeminiFailureMessageAr = 'أبحث عن فيلا للبيع في بيليك دوزو مع مسبح وحديقة، أقل من 10 مليون'
  let parsedFromMessage = null

  if (!parsedFromMessage) {
    parsedFromMessage = keywordFallbackParser(simulatedGeminiFailureMessageAr)
  }

  parsedFromMessage = normalizeParsed(parsedFromMessage, simulatedGeminiFailureMessageAr)
  applyRawTextPropertyTypeSignals(parsedFromMessage, simulatedGeminiFailureMessageAr)

  assertEqual('simulated AR fallback: listingType Sale', parsedFromMessage.listingType, 'Sale')
  assertEqual('simulated AR fallback: propertyType Villa', parsedFromMessage.propertyType, 'Villa')
  assertEqual('simulated AR fallback: district Beylikdüzü (canonical, not Arabic)', parsedFromMessage.district, 'Beylikdüzü')
  assertTrue('simulated AR fallback: pool true', parsedFromMessage.pool === true)
  assertTrue('simulated AR fallback: garden true', parsedFromMessage.garden === true)
  assertEqual('simulated AR fallback: maxPrice 10000000', parsedFromMessage.maxPrice, 10000000)
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
