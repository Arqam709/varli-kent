import { RESIDENTIAL_PROPERTY_TYPES } from './propertySemanticSearch.js'
import { extractConceptIdsFromText } from '../utils/lifestyleConcepts.js'
import {
  normalizeDigits,
  normalizeForMatching,
  findFirstCanonicalMatch,
  matchesAnyTerm,
  LISTING_TYPE_TERMS,
  PROPERTY_TYPE_TERMS,
  FEATURE_TERMS,
  RESIDENTIAL_TERMS,
  DISTRICT_ALIASES,
  NUMBER_WORDS,
  ARABIC_DUAL_ROOM_WORDS,
  ARABIC_DUAL_BATHROOM_WORDS,
  MILLION_WORDS,
  THOUSAND_WORDS,
} from '../locales/chatParsingVocabulary.js'

export const defaultParsed = {
  intent: 'property_search',
  intentType: 'property_search',
replyType: 'search',
nextQuestion: null,
  searchMode: 'field',
  descriptionQuery: null,
  listingType: null,
  propertyType: null,
  propertyTypes: [],
  district: null,
  districts: [],
  beds: null,
  baths: null,
  minPrice: null,
  maxPrice: null,
  minSqm: null,
  maxSqm: null,
  furnished: null,
  balcony: null,
  elevator: null,
  pool: null,
  garden: null,
  parking: null,
  mustHave: [],
  niceToHave: [],
  lifestyle: [],
  requirements: [],
  noPreference: false,
  needsClarification: false,
  clarifyingQuestion: null,
}

// ─── Per-turn dialogue fields (Phase 1 boundary) ──────────────────────────────
// These fields describe only the CURRENT message (what the visitor just did,
// what the parser suggested for this turn) — they are dialogue acts, not
// search memory. They must never survive from an older turn: stale values
// round-trip back from the frontend inside currentFilters, and a stale
// nextQuestion/replyType replayed as if current caused real conversation
// bugs. stripPerTurnFields() removes them from old state before it seeds
// conversation memory; the merge then re-fills them from the current turn's
// parse only.
export const PER_TURN_DIALOGUE_FIELDS = [
  'intent',
  'intentType',
  'replyType',
  'nextQuestion',
  'needsClarification',
  'clarifyingQuestion',
  'noPreference',
  'changedMind',
  'uncertainPropertyType',
  'excludedConcepts',
]

// Returns a copy of old round-tripped state with every per-turn dialogue
// field removed. Durable fields — search criteria, lifestyle memory,
// searchMode/descriptionQuery, pendingLead, pendingClarification, and any
// future durable additions — pass through untouched.
export const stripPerTurnFields = (state = {}) => {
  const durable = { ...state }

  for (const field of PER_TURN_DIALOGUE_FIELDS) {
    delete durable[field]
  }

  return durable
}

export const extractBudgetFromText = (message, parsed) => {
  // Arabic-Indic/Persian digits (e.g. "٢٥٠٠٠") fold to plain Western digits
  // before matching — everything else about this function is unchanged.
  const text = normalizeDigits(message).toLowerCase()

  // Examples:
  // "my budget is 15000"
  // "budget 15000"
  // "under 15000"
  // "max 15000"
  // "up to 15000"
  // "₺15000"
  // "15000 rent"
  const budgetMatch =
    text.match(/(?:budget|under|max|maximum|up to|around)\s*(?:is)?\s*₺?\s*(\d[\d,.]*)/) ||
    text.match(/₺\s*(\d[\d,.]*)/) ||
    text.match(/\b(\d{4,9})\b/)

  if (!budgetMatch) return parsed

  const number = Number(String(budgetMatch[1]).replace(/[,.]/g, ''))

  if (!Number.isNaN(number)) {
    // In normal real estate chat, "budget" usually means maximum price/rent.
    parsed.maxPrice = number
  }

  return parsed
}

// ─── Phase 4 (multilingual Gemini parsing): canonicalization guard ─────────
// normalizeParsed already validated intentType/replyType/searchMode against
// allow-lists (below) — listingType/propertyType had NO such check before
// Phase 4, so a value that somehow arrived translated (e.g. the Gemini
// prompt's own canonical-output instruction being ignored) would have
// flowed straight into buildMongoFilter and silently matched nothing. This
// is a small, closed safety net over the SAME canonical enum set already
// used everywhere else in the app — not a general translation layer, and it
// does not change how the deterministic parser/prompt behave: the prompt is
// the primary defense; this only guarantees the field VALUE itself can never
// leak a non-canonical string past this boundary, regardless of source.
const CANONICAL_LISTING_TYPES = ['Sale', 'Rent']
const LISTING_TYPE_SYNONYMS = {
  kiralık: 'Rent', kiralik: 'Rent', 'للإيجار': 'Rent',
  satılık: 'Sale', satilik: 'Sale', 'للبيع': 'Sale',
}

const CANONICAL_PROPERTY_TYPES = [
  'Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office',
  'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm',
]
const PROPERTY_TYPE_SYNONYMS = {
  daire: 'Apartment', 'شقة': 'Apartment',
  villa: 'Villa', 'فيلا': 'Villa',
  'çatı katı': 'Penthouse', 'بنتهاوس': 'Penthouse',
  dubleks: 'Duplex', 'دوبلكس': 'Duplex',
  stüdyo: 'Studio', 'استوديو': 'Studio',
  ofis: 'Office', 'مكتب': 'Office',
  arsa: 'Land', 'أرض': 'Land',
  dükkan: 'Shop', dukkan: 'Shop', 'محل': 'Shop',
  depo: 'Warehouse', 'مستودع': 'Warehouse',
  otel: 'Hotel', 'فندق': 'Hotel',
  çiftlik: 'Farm', 'مزرعة': 'Farm',
}

const canonicalizeEnumValue = (value, canonicalList, synonyms) => {
  if (canonicalList.includes(value)) return value
  if (typeof value !== 'string') return null

  const key = value.trim().toLowerCase()
  return synonyms[key] || null
}

export const canonicalizeListingType = (value) =>
  canonicalizeEnumValue(value, CANONICAL_LISTING_TYPES, LISTING_TYPE_SYNONYMS)

export const canonicalizePropertyType = (value) =>
  canonicalizeEnumValue(value, CANONICAL_PROPERTY_TYPES, PROPERTY_TYPE_SYNONYMS)

export const normalizeParsed = (parsed, message) => {
  const safe = {
    ...defaultParsed,
    ...(parsed || {}),
  }
  const allowedIntentTypes = [
  'property_search',
  'property_followup',
  'casual_chat',
  'emotional_message',
  'contact_request',
  'website_service_question',
  'unknown',
]

const allowedReplyTypes = [
  'search',
  'ask_question',
  'casual_reply',
  'support_reply',
  'contact_reply',
  'service_reply',
  'unknown_reply',
]

safe.intentType = allowedIntentTypes.includes(safe.intentType)
  ? safe.intentType
  : 'property_search'

safe.replyType = allowedReplyTypes.includes(safe.replyType)
  ? safe.replyType
  : 'search'

safe.nextQuestion =
  typeof safe.nextQuestion === 'string' && safe.nextQuestion.trim()
    ? safe.nextQuestion.trim()
    : null


  safe.searchMode = ['field', 'description', 'hybrid'].includes(safe.searchMode)
  ? safe.searchMode
  : 'field'

safe.descriptionQuery =
  typeof safe.descriptionQuery === 'string' && safe.descriptionQuery.trim()
    ? safe.descriptionQuery.trim()
    : null

  safe.noPreference = safe.noPreference === true

  // Canonicalize (or null out) listingType/propertyType — see the guard
  // defined above. A value already canonical passes through unchanged; a
  // recognized Turkish/Arabic synonym is mapped back; anything else
  // (including gibberish) becomes null rather than silently reaching the
  // Mongo filter as an unmatchable string.
  safe.listingType = canonicalizeListingType(safe.listingType)
  safe.propertyType = canonicalizePropertyType(safe.propertyType)

  safe.districts = Array.isArray(safe.districts) ? safe.districts : []
  safe.propertyTypes = (Array.isArray(safe.propertyTypes) ? safe.propertyTypes : [])
    .map(canonicalizePropertyType)
    .filter(Boolean)
  safe.mustHave = Array.isArray(safe.mustHave) ? safe.mustHave : []
  safe.niceToHave = Array.isArray(safe.niceToHave) ? safe.niceToHave : []
  safe.lifestyle = Array.isArray(safe.lifestyle) ? safe.lifestyle : []
  safe.requirements = Array.isArray(safe.requirements) ? safe.requirements : []

  return extractBudgetFromText(message, safe)
}

export const hasSoftDescriptionSearch = (parsed = {}) => {
  return Boolean(
    parsed.descriptionQuery ||
      parsed.searchMode === 'description' ||
      parsed.searchMode === 'hybrid' ||
      parsed.lifestyle?.length ||
      parsed.mustHave?.length ||
      parsed.niceToHave?.length ||
      parsed.requirements?.length
  )
}

export const hasKnownPropertyType = (parsed) =>
  Boolean(parsed.propertyType) || (Array.isArray(parsed.propertyTypes) && parsed.propertyTypes.length > 0)

// District list, shared by keywordFallbackParser here and the district-scope
// clarification logic in routes/chat.js (extracted so both stay in sync off
// one list).
export const KNOWN_DISTRICTS = [
  'Esenyurt',
  'Büyükçekmece',
  'Buyukcekmece',
  'Beylikdüzü',
  'Beylikduzu',
  'Başakşehir',
  'Basaksehir',
  'Kadıköy',
  'Kadikoy',
  'Beşiktaş',
  'Besiktas',
  'Şişli',
  'Sisli',
  'Üsküdar',
  'Uskudar',
  'Sarıyer',
  'Sariyer',
  'Bakırköy',
  'Bakirkoy',
  'Kağıthane',
  'Kagithane',
  'Fatih',
  'Zeytinburnu',
  'Avcılar',
  'Avcilar',
  'Bahçelievler',
  'Bahcelievler',
]

export const detectMentionedDistricts = (message = '') => {
  const text = message.toLowerCase()
  const directMatches = KNOWN_DISTRICTS.filter((d) => text.includes(d.toLowerCase()))

  // Arabic transliteration aliases (locales/chatParsingVocabulary.js) resolve
  // to their canonical Latin/Turkish spelling — the alias itself is never
  // returned, only the canonical district name KNOWN_DISTRICTS already uses.
  const normalizedText = normalizeForMatching(message)
  const aliasMatches = Object.entries(DISTRICT_ALIASES)
    .filter(([alias]) => normalizedText.includes(normalizeForMatching(alias)))
    .map(([, canonical]) => canonical)

  return Array.from(new Set([...directMatches, ...aliasMatches]))
}

// ─── keywordFallbackParser helpers (Phase 5: multilingual fallback) ────────
// A unit word may itself contain a literal space ("yatak odası") — escape it
// to \s+ so the built regex still matches across the normalized whitespace.
const escapeUnitForRegex = (term) => normalizeForMatching(term).replace(/ /g, '\\s+')

const BEDROOM_UNIT_TERMS = ['bed', 'beds', 'bedroom', 'bedrooms', 'room', 'rooms', 'oda', 'yatak odası', 'yatak odasi', 'غرف نوم', 'غرفة نوم', 'غرفة']
const BATHROOM_UNIT_TERMS = ['bath', 'baths', 'bathroom', 'bathrooms', 'banyo', 'حمام', 'حمامات']
const SQM_UNIT_TERMS = ['sqm', 'sq m', 'square meters', 'square meter', 'm2', 'm²', 'metrekare', 'metre kare', 'متر مربع', 'مترمربع']
const UNDER_MARKER_TERMS = ['under', 'max', 'maximum', 'up to', 'en fazla', 'maksimum', 'altında', 'altinda', 'أقل من', 'بحد أقصى', 'أقصى']
const ABOVE_MARKER_TERMS = ['above', 'at least', 'en az', 'üzerinde', 'uzerinde', 'أكثر من', 'على الأقل']

// digit + unit ("3 bedrooms" / "3 oda" / "3 غرف نوم")
const extractCountBeforeUnit = (normalizedText, unitTerms) => {
  for (const unit of unitTerms) {
    const match = normalizedText.match(new RegExp(`(\\d+)\\s*${escapeUnitForRegex(unit)}`))
    if (match) return Number(match[1])
  }
  return null
}

// spelled-out number + unit ("three bedrooms" / "üç oda" / "ثلاث غرف نوم") —
// bounded to the small closed NUMBER_WORDS map (1-10), not a general
// natural-language number parser.
const extractNumberWordBeforeUnit = (normalizedText, unitTerms) => {
  for (const lang of ['en', 'tr', 'ar']) {
    for (const [word, value] of Object.entries(NUMBER_WORDS[lang])) {
      for (const unit of unitTerms) {
        if (new RegExp(`${escapeUnitForRegex(word)}\\s*${escapeUnitForRegex(unit)}`).test(normalizedText)) {
          return value
        }
      }
    }
  }
  return null
}

// Million/thousand-scaled budget number in any supported language, e.g.
// "8 million" / "8m" / "5 milyon" / "3,5 milyon" / "20 bin" / "20 ألف". A
// decimal comma (Turkish) is only ever treated as a decimal point HERE, where
// a scale word follows — a bare grouping comma ("15,000") is a different,
// unscaled case handled separately by extractBudgetFromText.
const extractScaledNumber = (normalizedText) => {
  const scales = [
    { terms: MILLION_WORDS, multiplier: 1000000 },
    { terms: THOUSAND_WORDS, multiplier: 1000 },
  ]

  for (const { terms, multiplier } of scales) {
    for (const term of terms) {
      // Short (<=2 char) scale shorthand ("m", "k") needs a trailing word
      // boundary so it doesn't swallow the first letter of an unrelated word
      // ("10 meters"); longer words ("million", "milyon", "مليون") are
      // specific enough that this isn't a real risk, and \b is unsafe for
      // Arabic text anyway (JS \b relies on \w, which excludes Arabic
      // letters, so it would fail to match mid-Arabic-text entirely).
      const pattern = term.length <= 2
        ? new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${escapeUnitForRegex(term)}\\b`)
        : new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${escapeUnitForRegex(term)}`)

      const match = normalizedText.match(pattern)
      if (match) {
        const numeric = Number(match[1].replace(',', '.'))
        if (!Number.isNaN(numeric)) return Math.round(numeric * multiplier)
      }
    }
  }

  return null
}

// Fixed, minimal English phrase per lifestyle concept id — matches Gemini's
// own established phrasing (see geminiPropertyParser.js's worked examples).
// This is the ENTIRE lifestyle-fallback surface: never a translation of the
// visitor's own words, just a canonical English description query/lifestyle
// tag once a concept is recognized via the same strict word-list matcher
// (extractConceptIdsFromText) the rest of the pipeline already trusts.
const CONCEPT_FALLBACK_PHRASES = {
  school: 'near schools',
  sea_view: 'sea view',
  metro_transport: 'near metro',
  family: 'family-friendly',
  peaceful_safe: 'safe area',
  park_green: 'near park',
  investment: 'good investment',
  luxury: 'luxury',
}

const hasAnyStructuredSignal = (parsed) =>
  Boolean(
    parsed.listingType || parsed.propertyType || parsed.district ||
    (parsed.districts && parsed.districts.length) ||
    parsed.beds || parsed.baths || parsed.minPrice || parsed.maxPrice ||
    parsed.minSqm || parsed.maxSqm ||
    parsed.pool || parsed.garden || parsed.balcony || parsed.elevator || parsed.parking || parsed.furnished
  )

// ─── Keyword fallback parser ──────────────────────────────────────────────────
// SAFETY NET ONLY — used exclusively when Gemini fails (429/503/timeout/
// invalid JSON/missing key). Recognizes basic structured property-search
// criteria in English, Turkish, and Arabic via the centralized vocabulary in
// locales/chatParsingVocabulary.js. Not a translator: every value this
// function assigns comes directly from a canonical map KEY (Rent/Sale/
// Apartment/Villa/...), never from the visitor's own words, so no additional
// canonicalization step is needed for this parser's own output (though
// normalizeParsed's Phase 4 guard still runs afterward regardless, as the
// final safety boundary shared with Gemini's output).
export const keywordFallbackParser = (message) => {
  const normalizedText = normalizeForMatching(message)
  const parsed = { ...defaultParsed }

  // Preserves the original precedence exactly: a Rent-family term sets Rent,
  // then a Sale-family term (checked second, unconditionally) overwrites it
  // if the message also contains one — same as the original two-if-block
  // English-only implementation.
  if (matchesAnyTerm(normalizedText, LISTING_TYPE_TERMS.Rent)) parsed.listingType = 'Rent'
  if (matchesAnyTerm(normalizedText, LISTING_TYPE_TERMS.Sale)) parsed.listingType = 'Sale'

  parsed.propertyType = findFirstCanonicalMatch(normalizedText, PROPERTY_TYPE_TERMS)

  const matched = detectMentionedDistricts(message)

  if (matched.length === 1) parsed.district = matched[0]
  if (matched.length > 1) parsed.districts = matched

  // Beds: digit+unit wins, then "3+1" notation, then a spelled-out number
  // word, then an Arabic dual-form fused word ("غرفتين" = 2 rooms) — same
  // digit-then-plusOne precedence the original implementation already used.
  const plusOneMatch = normalizedText.match(/(\d+)\+1/)
  const bedsDigit = extractCountBeforeUnit(normalizedText, BEDROOM_UNIT_TERMS)
  const bedsWord = extractNumberWordBeforeUnit(normalizedText, BEDROOM_UNIT_TERMS)
  const bedsDual = ARABIC_DUAL_ROOM_WORDS.some((word) => normalizedText.includes(normalizeForMatching(word)))

  if (bedsDigit !== null) parsed.beds = bedsDigit
  else if (plusOneMatch) parsed.beds = Number(plusOneMatch[1])
  else if (bedsWord !== null) parsed.beds = bedsWord
  else if (bedsDual) parsed.beds = 2

  const bathsDigit = extractCountBeforeUnit(normalizedText, BATHROOM_UNIT_TERMS)
  const bathsWord = extractNumberWordBeforeUnit(normalizedText, BATHROOM_UNIT_TERMS)
  const bathsDual = ARABIC_DUAL_BATHROOM_WORDS.some((word) => normalizedText.includes(normalizeForMatching(word)))

  if (bathsDigit !== null) parsed.baths = bathsDigit
  else if (bathsWord !== null) parsed.baths = bathsWord
  else if (bathsDual) parsed.baths = 2

  // Budget — scaled (million/thousand) mentions only. A bare, unscaled
  // number (e.g. a plain "15000") is extractBudgetFromText's job, called
  // unconditionally afterward in normalizeParsed on both Gemini's and this
  // parser's output alike — "budget usually means maximum" is that
  // function's own established convention, reused here for consistency.
  const scaledNumber = extractScaledNumber(normalizedText)

  if (scaledNumber !== null) {
    if (matchesAnyTerm(normalizedText, ABOVE_MARKER_TERMS)) parsed.minPrice = scaledNumber
    else parsed.maxPrice = scaledNumber
  }

  // Sqm (new) — only when an explicit "at least"/"under" qualifier is
  // present; unlike price, a bare size number has no safe default direction.
  const sqmValue = extractCountBeforeUnit(normalizedText, SQM_UNIT_TERMS)

  if (sqmValue !== null) {
    if (matchesAnyTerm(normalizedText, ABOVE_MARKER_TERMS)) parsed.minSqm = sqmValue
    else if (matchesAnyTerm(normalizedText, UNDER_MARKER_TERMS)) parsed.maxSqm = sqmValue
  }

  Object.keys(FEATURE_TERMS).forEach((feature) => {
    if (matchesAnyTerm(normalizedText, FEATURE_TERMS[feature])) parsed[feature] = true
  })

  // Basic lifestyle signal — reuses the same strict, language-aware concept
  // extractor the rest of the pipeline already trusts for search evidence
  // (utils/lifestyleConcepts.js), and only ever emits the fixed English
  // phrase already associated with each concept id above — never a
  // translation of the visitor's own words.
  const conceptIds = extractConceptIdsFromText(message)

  if (conceptIds.length > 0) {
    const phrases = conceptIds.map((id) => CONCEPT_FALLBACK_PHRASES[id]).filter(Boolean)

    if (phrases.length > 0) {
      parsed.lifestyle = phrases
      parsed.descriptionQuery = phrases.join(' ')
      parsed.searchMode = hasAnyStructuredSignal(parsed) ? 'hybrid' : 'description'
    }
  }

  return parsed
}

// ─── Multiple/uncertain property type detection (deterministic) ──────────────
// Gemini's JSON schema only has a single `propertyType` field, so it has no
// way to express "apartment or villa" — it must pick one and silently drop
// the uncertainty. Detected here from the raw message text instead, and used
// to OVERRIDE whatever single guess Gemini/keywordFallbackParser made.
// Derived from the same PROPERTY_TYPE_TERMS vocabulary keywordFallbackParser
// uses (locales/chatParsingVocabulary.js) — one source of truth, now also
// multilingual. Key order matches PROPERTY_TYPE_TERMS (Apartment/Villa
// families first), preserving the original list's apartment-before-villa
// ordering for these purposes.
export const PROPERTY_TYPE_KEYWORDS = Object.entries(PROPERTY_TYPE_TERMS).flatMap(
  ([type, terms]) => terms.map((term) => [term, type])
)

export const detectMentionedPropertyTypes = (message = '') => {
  const normalizedText = normalizeForMatching(message)
  const found = []

  PROPERTY_TYPE_KEYWORDS.forEach(([keyword, type]) => {
    if (normalizedText.includes(normalizeForMatching(keyword)) && !found.includes(type)) {
      found.push(type)
    }
  })

  return found
}

// English "residential" keeps its original \b word-boundary guard (so
// "nonresidential" does not false-positive-match as a request for
// residential properties); Turkish/Arabic terms are checked as plain
// substrings since JS's \b relies on \w, which does not recognize Arabic
// letters and would never match inside Arabic text.
const RESIDENTIAL_ENGLISH_PATTERN = /\bresidential\b/
const RESIDENTIAL_NON_ENGLISH_TERMS = RESIDENTIAL_TERMS.filter((term) => term !== 'residential')

export const messageRequestsResidential = (message = '') => {
  const text = message.trim().toLowerCase()
  if (RESIDENTIAL_ENGLISH_PATTERN.test(text)) return true
  return matchesAnyTerm(normalizeForMatching(message), RESIDENTIAL_NON_ENGLISH_TERMS)
}

const TYPE_UNCERTAINTY_PATTERNS = [/\bnot sure\b/, /\bdon'?t know\b/, /\bno idea\b/, /\bany type\b/, /\bwhatever\b/]

export const messageExpressesTypeUncertainty = (message = '') => {
  const text = message.trim().toLowerCase()
  return TYPE_UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(text))
}

// Mutates parsedFromMessage in place — called right after normalizeParsed,
// before it's merged into the conversation's remembered parsed filters.
// "show residential properties" wins outright; otherwise, 2+ distinct
// property types mentioned in the same message ("apartment or villa", "not
// sure apartment or villa", "either apartment or villa") set propertyTypes[]
// and clear the single propertyType, so neither parser's arbitrary pick wins.
export const applyRawTextPropertyTypeSignals = (parsedFromMessage, message) => {
  if (messageRequestsResidential(message)) {
    parsedFromMessage.propertyTypes = RESIDENTIAL_PROPERTY_TYPES
    parsedFromMessage.propertyType = null
    return
  }

  const mentionedTypes = detectMentionedPropertyTypes(message)

  if (mentionedTypes.length > 1) {
    parsedFromMessage.propertyTypes = mentionedTypes
    parsedFromMessage.propertyType = null
  }
}
