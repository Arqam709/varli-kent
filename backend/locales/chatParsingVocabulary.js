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

/* ═══════════════════════════════════════════════════════════════════════
 * Wave 11B — extended property-field vocabulary
 *
 * Wave 10B4 gave the public filter sidebar nineteen extended fields. The
 * chatbot could not understand any of them, so "villa in Beşiktaş with a
 * sauna" fell through to free-text description search while the identical
 * request typed into the sidebar filtered exactly. Everything below exists
 * to close that gap.
 *
 * ── Where these canonical values come from ─────────────────────────────
 * CURRENT's own vocabularies, NOT the donor's. That distinction is
 * load-bearing: the donor's parking list is ['Open Parking Lot','Parking
 * Garage','Open & Covered Parking','None'] and its building-age list is
 * twelve single-year buckets, while CURRENT stores ['Open Parking','Closed
 * Parking','None'] and six ranged buckets. Adopting the donor's values
 * would build filters that match nothing in this database — the search
 * would return zero results and read as an empty inventory.
 *
 * The lists below mirror, exactly:
 *   - backend/models/Property.js    enum-enforced: floorLocation,
 *                                   kitchenType, usageStatus,
 *                                   titleDeedStatus, nearbyTransport,
 *                                   currency
 *   - backend/routes/properties.js  the same set, as REST allowlists
 *   - src/pages/PropertiesPage.jsx  rooms, heating, parking, buildingAge —
 *                                   no Mongoose enum, but the closed
 *                                   vocabulary the admin form writes
 *
 * tests/chatFilters.test.js asserts these lists against
 * routes/properties.js and PropertiesPage.jsx, so drift fails the suite
 * instead of silently degrading search.
 * ═══════════════════════════════════════════════════════════════════════ */

// ─── Canonical value lists ───────────────────────────────────────────────
export const CANONICAL_FLOOR_LOCATIONS = ['Ground floor', 'High Entrance', 'Penthouse', 'Duplex', 'Triplex']
export const CANONICAL_KITCHEN_TYPES = ['Open (American)', 'Closed']
export const CANONICAL_USAGE_STATUSES = ['Empty', 'Tenant', 'Property Owner']
export const CANONICAL_TITLE_DEED_STATUSES = [
  'Shared Title Deed',
  'Independent Title Deed',
  'Land with Title Deed',
  'Cooperative Share Title Deed',
  'Established Usufruct Right',
]
export const CANONICAL_TRANSPORT_OPTIONS = ['Metro', 'Metrobus', 'Bus', 'Ferry', 'Train', 'Tram', 'Highway Access']
export const CANONICAL_CURRENCIES = ['TL', 'USD', 'EUR', 'GBP']
export const CANONICAL_HEATING = ['Central', 'Individual Gas', 'Floor Heating', 'Air Conditioning', 'None']
export const CANONICAL_PARKING_TYPES = ['Open Parking', 'Closed Parking', 'None']
export const CANONICAL_ROOMS = [
  'Studio (1+0)', '1+1', '1.5+1', '2+0', '2+1', '2.5+1', '2+2',
  '3+0', '3+1', '3.5+1', '3+2', '3+3',
  '4+0', '4+1', '4.5+1', '4.5+2', '4+2', '4+3', '4+4',
  '5+1', '5.5+1', '5+2', '5+3', '5+4',
  '6+1', '6+2', '6.5+1', '6+3', '6+4',
  '7+1', '7+2', '7+3',
  '8+1', '8+2', '8+3', '8+4',
  '9+1', '9+2', '9+3', '9+4', '9+5', '9+6',
  '10+1', '10+2', 'Out of 10',
]

// ─── Multilingual term maps ──────────────────────────────────────────────
// Same { Canonical: [terms] } shape as LISTING_TYPE_TERMS/FEATURE_TERMS
// above, so findFirstCanonicalMatch/findAllCanonicalMatches work unchanged.

// The nine Wave 10B1 tri-state amenities, keyed by Property field name
// rather than by a display value because each resolves to a boolean.
export const AMENITY_TERMS = {
  sauna: ['sauna', 'ساونا'],
  jacuzzi: ['jacuzzi', 'jakuzi', 'jaküzi', 'جاكوزي'],
  steamRoom: ['steam room', 'steamroom', 'buhar odası', 'buhar odasi', 'حمام بخار'],
  // "hamam" always means a Turkish bath here — never the pool boolean and
  // never a bathroom count, which is what a looser match would do with it.
  turkishBath: ['turkish bath', 'hamam', 'türk hamamı', 'turk hamami', 'حمام تركي'],
  basement: ['basement', 'bodrum', 'قبو', 'بدروم'],
  withinSite: [
    'within site', 'within a site', 'gated site', 'gated community', 'inside a complex',
    'site içinde', 'site icinde', 'sitede', 'kapalı site', 'kapali site',
    'ضمن مجمع', 'مجمع سكني مغلق', 'داخل مجمع',
  ],
  eligibleForCredit: [
    'eligible for credit', 'mortgage eligible', 'suitable for credit', 'credit eligible',
    'krediye uygun', 'kredi uygun', 'مؤهل للقرض', 'قابل للقرض',
  ],
  exchange: [
    'open to exchange', 'trade-in', 'trade in', 'takaslı', 'takasli', 'takas',
    'قابل للمقايضة', 'مقايضة',
  ],
  hasVirtualTour: ['virtual tour', 'sanal tur', 'جولة افتراضية', 'جولة ثلاثية'],
}

export const USAGE_STATUS_TERMS = {
  Empty: ['empty', 'vacant', 'boş', 'bos', 'فارغ', 'خالي'],
  Tenant: [
    'tenant', 'tenant-occupied', 'occupied by tenant',
    'kiracı', 'kiracili', 'kiracılı', 'kiracı oturuyor', 'مستأجر', 'مؤجر',
  ],
  'Property Owner': [
    'property owner', 'owner occupied', 'owner-occupied',
    'sahibi oturuyor', 'mal sahibi oturuyor', 'يسكنها المالك', 'يملكها المالك',
  ],
}

export const KITCHEN_TYPE_TERMS = {
  'Open (American)': [
    'open kitchen', 'open (american)', 'american kitchen', 'open plan kitchen',
    'açık mutfak', 'acik mutfak', 'amerikan mutfak', 'مطبخ مفتوح', 'مطبخ أمريكي',
  ],
  Closed: ['closed kitchen', 'separate kitchen', 'kapalı mutfak', 'kapali mutfak', 'مطبخ مغلق'],
}

// CURRENT's three stored parking values. 'Closed Parking' absorbs the
// garage/indoor phrasings the donor routed to its own 'Parking Garage'.
export const PARKING_TYPE_TERMS = {
  'Closed Parking': [
    'closed parking', 'closed garage', 'indoor parking', 'covered parking', 'parking garage',
    'kapalı otopark', 'kapali otopark', 'garaj', 'kapalı garaj',
    'كراج مغلق', 'موقف مغلق', 'جراج', 'موقف مسقوف',
  ],
  'Open Parking': [
    'open parking', 'open parking lot', 'outdoor parking',
    'açık otopark', 'acik otopark', 'موقف مكشوف', 'موقف مفتوح',
  ],
  None: ['no parking', 'without parking', 'otopark yok', 'بدون موقف'],
}

export const TRANSPORT_TERMS = {
  // Metrobus is listed before Metro so that key order alone prevents
  // "metrobüs" from also registering as "Metro" on a substring match.
  Metrobus: ['metrobus', 'metrobüs', 'metrobuse', 'metrobüse yakın', 'bus rapid transit', 'brt', 'مترو باص', 'مترباص'],
  Metro: ['metro station', 'metro istasyonu', 'metroya yakın', 'metroya yakin', 'the metro', 'محطة مترو', 'مترو'],
  Ferry: ['ferry', 'ferry terminal', 'vapur', 'iskele', 'عبارة', 'معدية'],
  Tram: ['tram', 'tramway', 'tramvay', 'ترام'],
  Train: ['train station', 'train', 'railway', 'tren istasyonu', 'tren', 'قطار', 'محطة قطار'],
  Bus: ['bus stop', 'bus station', 'otobüs', 'otobus', 'otobüs durağı', 'باص', 'حافلة'],
  'Highway Access': [
    'highway access', 'highway', 'motorway', 'otoyol', 'otoyol bağlantısı', 'otoyol baglantisi',
    'طريق سريع', 'الطريق السريع',
  ],
}

export const CURRENCY_TERMS = {
  TL: ['tl', 'try', 'lira', 'türk lirası', 'turk lirasi', '₺', 'ليرة', 'ليرة تركية'],
  USD: ['usd', 'dollar', 'dollars', 'dolar', '$', 'دولار'],
  EUR: ['eur', 'euro', 'euros', 'avro', '€', 'يورو'],
  GBP: ['gbp', 'pound', 'pounds', 'sterlin', '£', 'جنيه', 'باوند'],
}

export const FLOOR_LOCATION_TERMS = {
  'Ground floor': ['ground floor', 'zemin kat', 'الطابق الأرضي', 'طابق أرضي'],
  'High Entrance': ['high entrance', 'yüksek giriş', 'yuksek giris', 'مدخل مرتفع'],
  Penthouse: ['penthouse', 'çatı katı', 'cati kati', 'بنتهاوس', 'شقة السطح'],
  Duplex: ['duplex', 'dubleks', 'دوبلكس'],
  Triplex: ['triplex', 'tripleks', 'تريبلكس'],
}

export const TITLE_DEED_TERMS = {
  'Shared Title Deed': ['shared title deed', 'hisseli tapu', 'سند مشترك', 'طابو مشترك'],
  'Independent Title Deed': [
    'independent title deed', 'kat mülkiyeti', 'kat mulkiyeti', 'müstakil tapu',
    'سند مستقل', 'طابو مستقل',
  ],
  'Land with Title Deed': ['land with title deed', 'arsa tapulu', 'arsa tapusu', 'سند أرض'],
  'Cooperative Share Title Deed': ['cooperative share title deed', 'kooperatif hisseli tapu', 'سند تعاوني'],
  'Established Usufruct Right': ['established usufruct right', 'intifa hakkı', 'intifa hakki', 'حق الانتفاع'],
}

export const HEATING_TERMS = {
  Central: ['central heating', 'central', 'merkezi ısıtma', 'merkezi isitma', 'merkezi', 'تدفئة مركزية'],
  'Individual Gas': [
    'individual gas', 'combi boiler', 'combi', 'natural gas', 'kombi', 'doğalgaz', 'dogalgaz',
    'غاز طبيعي', 'غلاية',
  ],
  'Floor Heating': ['floor heating', 'underfloor heating', 'yerden ısıtma', 'yerden isitma', 'تدفئة أرضية'],
  'Air Conditioning': ['air conditioning', 'air-conditioning', 'klima', 'تكييف'],
  None: ['no heating', 'without heating', 'ısıtma yok', 'isitma yok', 'بدون تدفئة'],
}

/* ─── Building age buckets ─────────────────────────────────────────────
 *
 * CURRENT's six stored buckets, each with the maximum age it covers. The
 * donor's twelve single-year buckets ('0','1','2',...,'31+') are NOT used:
 * no listing in this database carries one, so an $in against them matches
 * nothing.
 *
 * `maxYears` exists so a relative phrase ("built in the last 10 years")
 * can expand to every bucket that fits entirely inside the stated span,
 * which is what an $in query needs. '21+' is unbounded, so it can never
 * fit inside any finite span — Infinity makes that fall out of the
 * comparison rather than needing a special case.
 */
export const BUILDING_AGE_BUCKETS = [
  { label: '0 (New)', maxYears: 0 },
  { label: '1-5', maxYears: 5 },
  { label: '6-10', maxYears: 10 },
  { label: '11-15', maxYears: 15 },
  { label: '16-20', maxYears: 20 },
  { label: '21+', maxYears: Infinity },
]

export const BUILDING_AGE_BUCKET_LABELS = BUILDING_AGE_BUCKETS.map((bucket) => bucket.label)

// buildingAgeBucketsWithinYears(10) -> ['0 (New)', '1-5', '6-10'].
// Returns [] for a non-finite or negative input rather than throwing.
export const buildingAgeBucketsWithinYears = (years) => {
  if (!Number.isFinite(years) || years < 0) return []
  return BUILDING_AGE_BUCKETS.filter((bucket) => bucket.maxYears <= years).map((bucket) => bucket.label)
}

// Builds a { term: canonical } lookup from a { canonical: [terms] } map, so
// each closed-vocabulary field does not need a hand-written synonym object
// duplicating the term map above it. Terms are normalized with the same
// normalizeForMatching the rest of this module uses, so an İ or an Arabic
// alef variant inside a term list resolves the way it does in visitor text.
export const buildSynonymsFromTermMap = (termMap) => {
  const synonyms = {}
  Object.entries(termMap).forEach(([canonical, terms]) => {
    terms.forEach((term) => {
      synonyms[normalizeForMatching(term)] = canonical
    })
  })
  return synonyms
}
