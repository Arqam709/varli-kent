// backend/locales/chatParsingVocabulary.js
//
// Phase 5 (multilingual deterministic fallback parsing). Centralized
// vocabulary and text-normalization helpers for the SAFETY-NET keyword
// parser only (keywordFallbackParser in chatMessageParsing.js) — used
// exclusively when Gemini fails (429/503/timeout/invalid JSON/missing key).
// Gemini remains the preferred, more capable parser; this module is not a
// translator and does not attempt to understand arbitrary sentences.
//
// Canonical enum values (Rent/Sale/Apartment/Villa/...) are always the MAP
// KEYS here — language-specific words are only ever recognized as INPUT,
// never produced as output. Nothing in this file is imported by
// geminiPropertyParser.js, routes/chat.js, or any dialogue-pattern module
// (conversation memory, pending-question, policy engine, district-scope
// answer interpretation, lead confirmation/cancellation) — this is
// structured-field recognition only.

// ─── Text normalization (matching only — NEVER applied to output values,
// district names, or anything that gets returned to the caller) ───────────
const ARABIC_DIACRITICS_AND_TATWEEL = /[ً-ٰٟـ]/g
const ARABIC_ALEF_VARIANTS = /[أإآ]/g
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

// Arabic-Indic and Persian digits -> plain Western digits. Safe to apply
// unconditionally: these characters never appear in canonical output values.
export const normalizeDigits = (text = '') =>
  text
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))

// Turkish capital İ (U+0130, dotted capital I) must be folded to plain "i"
// BEFORE the generic lowercase call: JS's default (locale-unaware)
// `.toLowerCase()` expands "İ" into "i" + a combining-dot-above character
// (U+0307) instead of plain "i" — silently breaking substring matching
// against lowercase Turkish vocabulary like "kiralık" (confirmed directly:
// 'Kİralık'.toLowerCase() === 'ki̇ralık', an 8-character string with a
// stray combining mark). Plain ASCII "I" needs NO special handling — it
// already lowercases to a normal "i" — which is exactly why every Turkish
// vocabulary entry in this module is listed in BOTH its accented form
// ("kiralık") and its plain-ASCII-typed form ("kiralik", what a visitor
// typing "KIRALIK" on an ASCII keyboard actually produces): the same
// established pattern KNOWN_DISTRICTS already uses (Beylikdüzü/Beylikduzu).
// Arabic alef variants (أ/إ/آ) are folded to bare ا for matching only, and
// diacritics (harakat) + tatweel (ـ) are stripped — none of this touches the
// message the visitor actually sent; it only affects the copy used for
// keyword lookups inside this file.
export const normalizeForMatching = (text = '') =>
  normalizeDigits(String(text))
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(ARABIC_DIACRITICS_AND_TATWEEL, '')
    .replace(ARABIC_ALEF_VARIANTS, 'ا')
    .trim()

// ─── Listing type ───────────────────────────────────────────────────────
export const LISTING_TYPE_TERMS = {
  Rent: [
    'rent', 'rental', 'for rent', 'renting',
    'kiralık', 'kiralik', 'kiraya', 'kiralamak',
    'للإيجار', 'للايجار', 'إيجار', 'ايجار', 'استئجار',
  ],
  Sale: [
    'sale', 'for sale', 'buy', 'buying', 'purchase',
    'satılık', 'satilik', 'satın almak', 'satin almak',
    'للبيع', 'بيع', 'شراء',
  ],
}

// ─── Property types ──────────────────────────────────────────────────────
// Deliberately excludes generic words like "home"/"ev"/"منزل"/"بيت" — those
// stay ambiguous by design (see messageRequestsResidential/RESIDENTIAL_TERMS
// below for the one safe generic case the existing architecture already
// represents: RESIDENTIAL_PROPERTY_TYPES).
export const PROPERTY_TYPE_TERMS = {
  Apartment: ['apartment', 'apartments', 'flat', 'flats', 'daire', 'شقة', 'شقق'],
  Villa: ['villa', 'villas', 'فيلا', 'فلل'],
  Penthouse: ['penthouse', 'penthouses', 'çatı katı', 'cati kati', 'بنتهاوس'],
  Duplex: ['duplex', 'duplexes', 'dubleks', 'دوبلكس'],
  Studio: ['studio', 'studios', 'stüdyo', 'studyo', 'استوديو'],
  Office: ['office', 'offices', 'ofis', 'مكتب', 'مكاتب'],
  Commercial: ['commercial', 'ticari', 'تجاري', 'عقار تجاري'],
  Land: ['land', 'arsa', 'أرض', 'ارض'],
  Shop: ['shop', 'shops', 'dükkan', 'dukkan', 'محل', 'محلات'],
  Warehouse: ['warehouse', 'warehouses', 'depo', 'مستودع', 'مخزن'],
  Hotel: ['hotel', 'hotels', 'otel', 'فندق'],
  Farm: ['farm', 'farms', 'çiftlik', 'ciftlik', 'مزرعة'],
}

// ─── Boolean features ────────────────────────────────────────────────────
export const FEATURE_TERMS = {
  pool: ['pool', 'swimming pool', 'havuz', 'yüzme havuzu', 'yuzme havuzu', 'مسبح', 'حمام سباحة'],
  garden: ['garden', 'bahçe', 'bahce', 'حديقة'],
  balcony: ['balcony', 'balkon', 'شرفة', 'بلكونة'],
  elevator: ['elevator', 'lift', 'asansör', 'asansor', 'مصعد'],
  parking: ['parking', 'garage', 'otopark', 'garaj', 'موقف سيارات', 'كراج'],
  furnished: ['furnished', 'eşyalı', 'esyali', 'مفروش', 'مؤثث'],
}

// ─── Residential (generic) request ──────────────────────────────────────
export const RESIDENTIAL_TERMS = ['residential', 'konut', 'konut tipi', 'سكني', 'عقار سكني']

// ─── District aliases ────────────────────────────────────────────────────
// Arabic-script transliterations of Istanbul districts already present in
// chatMessageParsing.js's KNOWN_DISTRICTS list. This is an ALIAS map, not a
// second canonical list: a match here always resolves to the SAME canonical
// Latin/Turkish spelling KNOWN_DISTRICTS already uses — the Arabic key
// itself must never be returned as `district`. Deliberately not exhaustive
// (a handful of common districts only); anything else is Gemini's job.
export const DISTRICT_ALIASES = {
  'بيليك دوزو': 'Beylikdüzü',
  'كاديكوي': 'Kadıköy',
  'بشكتاش': 'Beşiktaş',
  'اسنيورت': 'Esenyurt',
  'ساريير': 'Sarıyer',
  'بويوك شكمجة': 'Büyükçekmece',
  'باشاك شهير': 'Başakşehir',
  'شيشلي': 'Şişli',
  'أوسكودار': 'Üsküdar',
  'اوسكودار': 'Üsküdar',
  'بكر كوي': 'Bakırköy',
}

// ─── Small closed number-word maps (1-10) — NOT a general number parser.
// Arabic real-estate listings commonly use dual forms ("غرفتين" = 2 rooms,
// "حمامين" = 2 bathrooms) as a single fused word rather than "two rooms";
// those are handled as direct fixed lookups in chatMessageParsing.js
// alongside this map, not folded in here (they are not a cardinal number +
// noun pattern the way the others are). ─────────────────────────────────
export const NUMBER_WORDS = {
  en: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 },
  tr: { bir: 1, iki: 2, üç: 3, uc: 3, dört: 4, dort: 4, beş: 5, bes: 5, altı: 6, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10 },
  ar: {
    'واحد': 1, 'واحدة': 1,
    'اثنان': 2, 'اثنين': 2,
    'ثلاثة': 3, 'ثلاث': 3,
    'أربعة': 4, 'اربعة': 4, 'أربع': 4, 'اربع': 4,
    'خمسة': 5, 'خمس': 5,
    'ستة': 6, 'ست': 6,
    'سبعة': 7, 'سبع': 7,
    'ثمانية': 8, 'ثمان': 8,
    'تسعة': 9, 'تسع': 9,
    'عشرة': 10, 'عشر': 10,
  },
}

// Arabic dual-form room/bathroom words — fused single words meaning
// "two X", not decomposable into a number + noun the way the rest of this
// module works. Small, closed, explicit.
export const ARABIC_DUAL_ROOM_WORDS = ['غرفتين', 'غرفتان']
export const ARABIC_DUAL_BATHROOM_WORDS = ['حمامين', 'حمامان']

export const wordToNumber = (word = '') => {
  const normalized = normalizeForMatching(word)
  for (const lang of ['en', 'tr', 'ar']) {
    if (NUMBER_WORDS[lang][normalized] !== undefined) return NUMBER_WORDS[lang][normalized]
  }
  return null
}

// ─── Budget scale words (million/thousand) ──────────────────────────────
export const MILLION_WORDS = ['million', 'm', 'milyon', 'مليون', 'ملايين']
export const THOUSAND_WORDS = ['thousand', 'k', 'bin', 'ألف', 'الف', 'آلاف', 'الاف']

// ─── Generic matching helpers ────────────────────────────────────────────
// `termMap` shape: { CanonicalValue: ['term1', 'term2', ...], ... }. Terms
// are normalized once here so callers never have to remember to do it.
export const findFirstCanonicalMatch = (normalizedText, termMap) => {
  for (const [canonical, terms] of Object.entries(termMap)) {
    if (terms.some((term) => normalizedText.includes(normalizeForMatching(term)))) {
      return canonical
    }
  }
  return null
}

export const findAllCanonicalMatches = (normalizedText, termMap) => {
  const found = []
  for (const [canonical, terms] of Object.entries(termMap)) {
    if (terms.some((term) => normalizedText.includes(normalizeForMatching(term)))) {
      found.push(canonical)
    }
  }
  return found
}

export const matchesAnyTerm = (normalizedText, terms = []) =>
  terms.some((term) => normalizedText.includes(normalizeForMatching(term)))
