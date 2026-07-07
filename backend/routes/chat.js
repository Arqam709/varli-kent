//chat.js
import express from 'express'
import Property from '../models/Property.js'
import { parsePropertyMessageWithGemini } from '../utils/geminiPropertyParser.js'
import mongoose from 'mongoose'

const router = express.Router()

const PROPERTY_SELECT =
  'title listingType price priceLabel district description address propertyType beds baths sqm mainImage images featured status pool garden furnished balcony elevator parking floor createdAt'

const defaultParsed = {
  intent: 'property_search',
  intentType: 'property_search',
replyType: 'search',
nextQuestion: null,
  searchMode: 'field',
  descriptionQuery: null,
  listingType: null,
  propertyType: null,
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
  needsClarification: false,
  clarifyingQuestion: null,
}

// ─── Helpers for chat memory ──────────────────────────────────────────────────
const hasValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

// Fields that represent the visitor stating a new/changed search criterion
// in THIS message (as opposed to a plain "show me more" continuation).
const CRITERIA_FIELDS = [
  'listingType',
  'propertyType',
  'district',
  'beds',
  'baths',
  'minPrice',
  'maxPrice',
  'minSqm',
  'maxSqm',
  'furnished',
  'balcony',
  'elevator',
  'pool',
  'garden',
  'parking',
  'descriptionQuery',
]

const messageHasNewCriteria = (parsedFromMessage = {}) => {
  const hasArrayCriteria = ['districts', 'lifestyle', 'mustHave', 'niceToHave', 'requirements'].some(
    (field) => Array.isArray(parsedFromMessage[field]) && parsedFromMessage[field].length > 0
  )

  return CRITERIA_FIELDS.some((field) => hasValue(parsedFromMessage[field])) || hasArrayCriteria
}

// Structured (non-lifestyle) fields that count toward deciding whether a
// message is a short single-slot answer ("buy", "Beylikdüzü") versus a
// fresh, self-contained structured search ("Show me apartments in
// Büyükçekmece", which states TWO things at once).
const STRUCTURED_CRITERIA_FIELDS = CRITERIA_FIELDS.filter((field) => field !== 'descriptionQuery')

const countNewStructuredCriteria = (parsedFromMessage = {}) => {
  let count = STRUCTURED_CRITERIA_FIELDS.filter((field) => hasValue(parsedFromMessage[field])).length

  if (Array.isArray(parsedFromMessage.districts) && parsedFromMessage.districts.length > 0) {
    count += 1
  }

  return count
}

// Detects a plain "show me more" style continuation directly from the raw
// message text. This must win over parsedFromMessage, because Gemini/keyword
// parsing tends to repeat old filters from conversation memory even when the
// visitor only asked to see more results.
const SHOW_MORE_PATTERNS = [
  /^show( me)? more( properties)?$/,
  /^show another$/,
  /^more$/,
  /^more properties$/,
  /^next$/,
  /^another$/,
  /^any more\??$/,
  /^load more$/,
]

const isShowMoreRequest = (message = '') => {
  const text = message.trim().toLowerCase()
  return SHOW_MORE_PATTERNS.some((pattern) => pattern.test(text))
}

// Phrases that mean "yes, I still mean the same place" when the visitor
// switches Sale <-> Rent without repeating the district. Without one of
// these, a listingType change is treated as a new request (see rule 8).
const CONTINUITY_PATTERNS = [
  /same district/,
  /same area/,
  /same place/,
  /same location/,
  /\bthere\b/,
  /still in/,
  /keep (it |the search )?in/,
]

const hasExplicitContinuityPhrase = (message = '') => {
  const text = message.trim().toLowerCase()
  return CONTINUITY_PATTERNS.some((pattern) => pattern.test(text))
}

// Feature toggles that a stale search may have left active.
const FEATURE_FIELDS = ['furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking']

// Phrases that mean "yes, keep applying my earlier feature requirements" when
// a new lifestyle/description-style message doesn't repeat them itself.
const FEATURE_CONTINUITY_PATTERNS = [
  /same requirements/,
  /same features/,
  /same criteria/,
  /also with/,
  /also have/,
  /also need/,
  /still (need|want|require)/,
  /keep the same/,
  /\bkeep\b/,
]

const hasFeatureContinuityPhrase = (message = '') => {
  const text = message.trim().toLowerCase()
  return FEATURE_CONTINUITY_PATTERNS.some((pattern) => pattern.test(text))
}

const extractBudgetFromText = (message, parsed) => {
  const text = message.toLowerCase()

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

const normalizeParsed = (parsed, message) => {
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

  safe.districts = Array.isArray(safe.districts) ? safe.districts : []
  safe.mustHave = Array.isArray(safe.mustHave) ? safe.mustHave : []
  safe.niceToHave = Array.isArray(safe.niceToHave) ? safe.niceToHave : []
  safe.lifestyle = Array.isArray(safe.lifestyle) ? safe.lifestyle : []
  safe.requirements = Array.isArray(safe.requirements) ? safe.requirements : []

  return extractBudgetFromText(message, safe)
}

const mergeParsedWithContext = (currentFilters = {}, newParsed = {}) => {
  const merged = {
    ...defaultParsed,
    ...currentFilters,
  }

  const fieldsToMerge = [
    'intent',
    'intentType',
'replyType',
'nextQuestion',
    'searchMode',
  'descriptionQuery',
    'listingType',
    'propertyType',
    'district',
    'beds',
    'baths',
    'minPrice',
    'maxPrice',
    'minSqm',
    'maxSqm',
    'furnished',
    'balcony',
    'elevator',
    'pool',
    'garden',
    'parking',
  ]

  for (const field of fieldsToMerge) {
    if (hasValue(newParsed[field])) {
      merged[field] = newParsed[field]
    }
  }

  // If user gives multiple districts, use districts[] and clear single district
  if (Array.isArray(newParsed.districts) && newParsed.districts.length > 0) {
    merged.districts = newParsed.districts
    merged.district = null
  }

  // Keep previous arrays unless Gemini gives new meaningful arrays
  merged.mustHave =
    Array.isArray(newParsed.mustHave) && newParsed.mustHave.length > 0
      ? newParsed.mustHave
      : merged.mustHave || []

  merged.niceToHave =
    Array.isArray(newParsed.niceToHave) && newParsed.niceToHave.length > 0
      ? newParsed.niceToHave
      : merged.niceToHave || []

  merged.lifestyle =
    Array.isArray(newParsed.lifestyle) && newParsed.lifestyle.length > 0
      ? newParsed.lifestyle
      : merged.lifestyle || []

  merged.requirements =
    Array.isArray(newParsed.requirements) && newParsed.requirements.length > 0
      ? newParsed.requirements
      : merged.requirements || []

  // Do not blindly trust Gemini clarification after we already have memory.
  // We will decide missing info ourselves.
  merged.needsClarification = false
  merged.clarifyingQuestion = null

  return merged
}

const hasSoftDescriptionSearch = (parsed = {}) => {
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

const buildNonPropertyReply = (parsed) => {
  if (parsed.intentType === 'casual_chat' || parsed.replyType === 'casual_reply') {
    return "I'm doing well, thank you. I'm here to help you find the right property. Are you looking to buy, rent, or just exploring?"
  }

  if (parsed.intentType === 'emotional_message' || parsed.replyType === 'support_reply') {
    return "I'm sorry to hear that. I hope your day gets better. I'm mainly here to help with property search, so whenever you're ready, tell me what kind of home you're looking for."
  }

  if (parsed.intentType === 'contact_request' || parsed.replyType === 'contact_reply') {
    return 'Sure. You can contact the VarliKent team through the contact form or WhatsApp details on the property page. If you tell me which property you are interested in, I can help you narrow it down.'
  }

  if (parsed.intentType === 'website_service_question' || parsed.replyType === 'service_reply') {
    return 'VarliKent can help with real estate, architecture, construction, renovation, and interior design services. Which service would you like to know more about?'
  }

  if (parsed.intentType === 'unknown' || parsed.replyType === 'unknown_reply') {
    return 'I can help you search for properties by buy/rent, apartment/villa, district, budget, rooms, or lifestyle needs like sea view, family-friendly community, luxury, or investment. What are you looking for?'
  }

  return null
}

const buildMissingInfoQuestion = (parsed) => {
  // If user gave a lifestyle/description request, search descriptions first.
  // Example: "I want a safe home for my children"
  if (hasSoftDescriptionSearch(parsed)) {
    return null
  }

  if (!parsed.listingType) {
    return 'Are you looking to buy or rent?'
  }

  if (!parsed.propertyType) {
    return 'What type of property are you looking for — apartment, villa, office, or something else?'
  }

  return null
}

// ─── Keyword fallback parser ──────────────────────────────────────────────────
const keywordFallbackParser = (message) => {
  const text = message.toLowerCase()
  const parsed = { ...defaultParsed }

  if (text.includes('rent') || text.includes('rental') || text.includes('kiralık')) {
    parsed.listingType = 'Rent'
  }

  if (
    text.includes('sale') ||
    text.includes('buy') ||
    text.includes('buying') ||
    text.includes('purchase') ||
    text.includes('satılık')
  ) {
    parsed.listingType = 'Sale'
  }

  const typeMap = {
    villa: 'Villa',
    apartment: 'Apartment',
    flat: 'Apartment',
    penthouse: 'Penthouse',
    duplex: 'Duplex',
    studio: 'Studio',
    office: 'Office',
    land: 'Land',
    shop: 'Shop',
  }

  for (const [keyword, type] of Object.entries(typeMap)) {
    if (text.includes(keyword)) {
      parsed.propertyType = type
      break
    }
  }

  const districts = [
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

  const matched = districts.filter((d) => text.includes(d.toLowerCase()))

  if (matched.length === 1) parsed.district = matched[0]
  if (matched.length > 1) parsed.districts = matched

  const bedroomMatch = text.match(/(\d+)\s*(bed|beds|bedroom|bedrooms|room|rooms|oda)/)
  const plusOneMatch = text.match(/(\d+)\+1/)

  if (bedroomMatch) parsed.beds = Number(bedroomMatch[1])
  else if (plusOneMatch) parsed.beds = Number(plusOneMatch[1])

  const bathroomMatch = text.match(/(\d+)\s*(bath|baths|bathroom|bathrooms)/)
  if (bathroomMatch) parsed.baths = Number(bathroomMatch[1])

  const underM = text.match(/under\s+(\d+)\s*m(illion)?/)
  const aboveM = text.match(/above\s+(\d+)\s*m(illion)?/)
  const maxM = text.match(/max\s+(\d+)\s*m(illion)?/)

  if (underM || maxM) parsed.maxPrice = Number((underM || maxM)[1]) * 1000000
  if (aboveM) parsed.minPrice = Number(aboveM[1]) * 1000000

  if (text.includes('pool')) parsed.pool = true
  if (text.includes('garden')) parsed.garden = true
  if (text.includes('furnished')) parsed.furnished = true
  if (text.includes('balcony')) parsed.balcony = true
  if (text.includes('elevator') || text.includes('lift')) parsed.elevator = true
  if (text.includes('parking') || text.includes('garage')) parsed.parking = true

  return parsed
}

// ─── mustHave enforcement (deterministic, no AI) ──────────────────────────────
// Maps mustHave phrases (e.g. "parking", "pool") to the real Property fields
// they refer to. Only features that actually exist on the Property schema
// are handled — everything else in mustHave stays as a text-search signal only.
const MUST_HAVE_FEATURE_MAP = [
  { field: 'parking', keywords: ['parking', 'garage'] },
  { field: 'pool', keywords: ['pool'] },
  { field: 'garden', keywords: ['garden'] },
  { field: 'balcony', keywords: ['balcony'] },
  { field: 'elevator', keywords: ['elevator', 'lift'] },
  { field: 'furnished', keywords: ['furnished'] },
]

// Builds a strict filter fragment from parsed.mustHave. This is enforced as a
// hard requirement (rule: mustHave is strict) and must be re-applied at every
// fallback level, unlike the optional feature toggles that fallback relaxes.
const buildMustHaveFeatureFilter = (mustHave = []) => {
  const musts = {}

  if (!Array.isArray(mustHave) || mustHave.length === 0) return musts

  const text = mustHave.join(' ').toLowerCase()

  MUST_HAVE_FEATURE_MAP.forEach(({ field, keywords }) => {
    const matched = keywords.some((keyword) => text.includes(keyword))
    if (!matched) return

    if (field === 'parking') {
      musts.parking = { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] }
    } else {
      musts[field] = true
    }
  })

  return musts
}

// ─── Build MongoDB filter ─────────────────────────────────────────────────────
const buildMongoFilter = (parsed) => {
  const filter = { status: 'Available' }

  if (parsed.listingType) filter.listingType = parsed.listingType
  if (parsed.propertyType) filter.propertyType = parsed.propertyType

  const districtList = [
    ...(parsed.district ? [parsed.district] : []),
    ...(Array.isArray(parsed.districts) ? parsed.districts : []),
  ]

  if (districtList.length === 1) {
    filter.district = { $regex: districtList[0], $options: 'i' }
  } else if (districtList.length > 1) {
    filter.$or = districtList.map((d) => ({
      district: { $regex: d, $options: 'i' },
    }))
  }

  if (parsed.beds) filter.beds = Number(parsed.beds)
  if (parsed.baths) filter.baths = Number(parsed.baths)

  if (parsed.furnished === true) filter.furnished = true
  if (parsed.balcony === true) filter.balcony = true
  if (parsed.elevator === true) filter.elevator = true
  if (parsed.pool === true) filter.pool = true
  if (parsed.garden === true) filter.garden = true

  if (parsed.parking === true) {
    filter.parking = {
      $exists: true,
      $nin: ['', null, 'No', 'no', 'None', 'none'],
    }
  }

  if (parsed.minPrice || parsed.maxPrice) {
    filter.price = {}

    if (parsed.minPrice) filter.price.$gte = Number(parsed.minPrice)
    if (parsed.maxPrice) filter.price.$lte = Number(parsed.maxPrice)
  }

  if (parsed.minSqm || parsed.maxSqm) {
    filter.sqm = {}

    if (parsed.minSqm) filter.sqm.$gte = Number(parsed.minSqm)
    if (parsed.maxSqm) filter.sqm.$lte = Number(parsed.maxSqm)
  }

  return filter
}

// ─── Progressive fallback search ──────────────────────────────────────────────
const searchWithFallback = async (filter, mustHaveFilter = {}) => {
  // Step 1: exact search
  let properties = await Property.find(filter)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 0 }
  }

  // Step 2: keep listingType + propertyType + district, drop price/beds/features
  // (mustHave stays enforced — it is strict, unlike the optional feature toggles)
  const step2 = { status: 'Available', ...mustHaveFilter }

  if (filter.listingType) step2.listingType = filter.listingType
  if (filter.propertyType) step2.propertyType = filter.propertyType
  if (filter.district) step2.district = filter.district
  if (filter.$or) step2.$or = filter.$or
  if (filter._id) step2._id = filter._id

  properties = await Property.find(step2)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 1 }
  }

  // Step 3: drop district, keep listingType + propertyType (+ mustHave)
  const step3 = { status: 'Available', ...mustHaveFilter }

  if (filter.listingType) step3.listingType = filter.listingType
  if (filter.propertyType) step3.propertyType = filter.propertyType
  if (filter._id) step3._id = filter._id

  properties = await Property.find(step3)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 2 }
  }

  // Step 4: just listingType + propertyType (+ mustHave) — never drop propertyType
  // or mustHave once specified
  const step4 = { status: 'Available', ...mustHaveFilter }

  if (filter.listingType) step4.listingType = filter.listingType
  if (filter.propertyType) step4.propertyType = filter.propertyType
  if (filter._id) step4._id = filter._id

  properties = await Property.find(step4)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  return { properties, fallbackLevel: 3 }
}

// ─── Description search helpers ───────────────────────────────────────────────
const buildHardFilterForDescriptionSearch = (filter = {}) => {
  const hardFilter = { status: 'Available' }

  if (filter.listingType) hardFilter.listingType = filter.listingType
  if (filter.propertyType) hardFilter.propertyType = filter.propertyType
  if (filter.district) hardFilter.district = filter.district
  if (filter.$or) hardFilter.$or = filter.$or

  if (filter.beds) hardFilter.beds = filter.beds
  if (filter.baths) hardFilter.baths = filter.baths
  if (filter.price) hardFilter.price = filter.price
  if (filter.sqm) hardFilter.sqm = filter.sqm

  if (filter.furnished) hardFilter.furnished = filter.furnished
  if (filter.balcony) hardFilter.balcony = filter.balcony
  if (filter.elevator) hardFilter.elevator = filter.elevator
  if (filter.pool) hardFilter.pool = filter.pool
  if (filter.garden) hardFilter.garden = filter.garden
  if (filter.parking) hardFilter.parking = filter.parking
  if (filter._id) hardFilter._id = filter._id

  return hardFilter
}

// Structured/generic dwelling words that are already enforced as hard field
// filters (propertyType/listingType) elsewhere. Keeping them in the free-text
// $text query only causes false-positive matches — e.g. every apartment
// listing's title contains "Apartment", so a "near school" search would
// otherwise match every apartment in the database, not just ones about schools.
const STRUCTURED_TERMS_TO_STRIP = new Set([
  'apartment', 'apartments', 'villa', 'villas', 'penthouse', 'penthouses',
  'duplex', 'duplexes', 'studio', 'studios', 'office', 'offices',
  'commercial', 'land', 'shop', 'shops', 'warehouse', 'warehouses',
  'hotel', 'hotels', 'farm', 'farms', 'flat', 'flats', 'home', 'homes',
  'house', 'houses', 'property', 'properties',
  'rent', 'rental', 'rentals', 'sale', 'sell', 'selling', 'buy', 'buying',
  'buys', 'purchase', 'kiralık', 'satılık',
])

// Common connector/filler words that are too generic to prove a listing is
// actually relevant to what the visitor described, even though they aren't
// structured field terms (e.g. "near" appears in both "near school" and
// "near metro" listings — it doesn't tell them apart).
const CONNECTOR_WORDS_TO_IGNORE = new Set([
  'near', 'nearby', 'close', 'closer', 'to', 'for', 'with', 'and', 'or',
  'a', 'an', 'the', 'of', 'is', 'are', 'that', 'this', 'some', 'good',
  'any', 'have', 'has', 'does', 'do', 'want', 'need', 'looking', 'like',
  'area', 'place', 'around', 'from', 'into', 'your', 'you', 'me', 'my',
  'we', 'our', 'there', 'here', 'also', 'still', 'same', 'general',
])

const normalizeWord = (word = '') => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const stripStructuredTerms = (text = '') => {
  const cleaned = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STRUCTURED_TERMS_TO_STRIP.has(normalizeWord(word)))
    .join(' ')
    .trim()

  return cleaned
}

// Simple singular/plural tolerance so "schools" (from Gemini) still matches
// a property whose description only says "school", and vice versa.
const toSingular = (word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

// ─── Lifestyle concept groups (deterministic, no AI) ──────────────────────────
// A property is only a genuine lifestyle match if it contains a keyword from
// a concept the visitor actually asked about — not just any word that
// happened to appear in Gemini's expanded free-text description query (which
// tends to pad in loosely-related synonyms, e.g. "family friendly" for a
// plain "near school" request).
const LIFESTYLE_CONCEPTS = [
  { name: 'school', keywords: ['school', 'schools', 'educational', 'education', 'kindergarten', 'university', 'campus'] },
  { name: 'seaView', keywords: ['sea', 'seaside', 'view', 'deniz', 'manzara', 'waterfront', 'coast', 'coastal'] },
  { name: 'metroTransport', keywords: ['metro', 'subway', 'transport', 'transportation', 'bus', 'station', 'marmaray'] },
  { name: 'family', keywords: ['family', 'families', 'children', 'child', 'kids', 'childfriendly'] },
  { name: 'peacefulSafe', keywords: ['peaceful', 'quiet', 'calm', 'secure', 'security', 'safe', 'safety'] },
  { name: 'parkGreen', keywords: ['park', 'parks', 'green', 'garden', 'gardens'] },
  { name: 'investment', keywords: ['investment', 'yield', 'rentalincome', 'appreciation', 'roi'] },
  { name: 'luxury', keywords: ['luxury', 'premium', 'highend', 'prestigious'] },
]

const findConceptForWord = (word) => {
  const singular = toSingular(word)
  return LIFESTYLE_CONCEPTS.find(
    (concept) => concept.keywords.includes(word) || concept.keywords.includes(singular)
  )
}

// Prefer Gemini's short, tagged lifestyle/requirement phrases — they stay
// close to what the visitor actually said. Only fall back to the broader
// descriptionQuery (which Gemini tends to pad with loosely-related
// synonyms) when nothing more specific was tagged at all.
const getConceptSourcePhrases = (parsed = {}) => {
  const taggedPhrases = [
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ]

  if (taggedPhrases.length > 0) return taggedPhrases

  return parsed.descriptionQuery ? [parsed.descriptionQuery] : []
}

// Builds the pool of words a property's content must contain at least one of
// to count as a genuine lifestyle match. Words that map to a known concept
// expand to that concept's full synonym set (so "school" also matches
// "educational"/"campus"/etc); words that don't map to any known concept
// fall back to being checked literally, still excluding structured/connector
// noise — so the system stays general for concepts not yet in the dictionary.
const getRelevanceCheckTerms = (parsed = {}) => {
  const words = getConceptSourcePhrases(parsed)
    .join(' ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter((word) => word.length >= 3 && !STRUCTURED_TERMS_TO_STRIP.has(word) && !CONNECTOR_WORDS_TO_IGNORE.has(word))

  const terms = new Set()

  words.forEach((word) => {
    const concept = findConceptForWord(word)

    if (concept) {
      concept.keywords.forEach((keyword) => terms.add(keyword))
    } else {
      terms.add(word)
    }
  })

  return Array.from(terms)
}

// Words/phrases that mean "yes, combine this with what I already asked for"
// when a NEW lifestyle concept appears alongside an OLD one already active in
// memory. Without one of these, a new concept REPLACES the old one instead
// of stacking on top of it (see isLifestyleConceptSwitch in the main route).
const LIFESTYLE_COMBINE_PATTERNS = [
  /\balso\b/,
  /\bsame requirements\b/,
  /\bsame criteria\b/,
  /\bsame features\b/,
  /\bboth\b/,
  /\bplus\b/,
  /\bkeep the same\b/,
  /\btoo\b/,
  /\bas well\b/,
  /\band\b/,
]

const hasLifestyleCombinePhrase = (message = '') => {
  const text = message.trim().toLowerCase()
  return LIFESTYLE_COMBINE_PATTERNS.some((pattern) => pattern.test(text))
}

// A short answer to a pending clarifying question ("buy", "Beylikdüzü",
// "under 5 million", "no district yet") introduces no lifestyle concept of
// its own and states at most one new structured detail. A message stating
// two or more structured details at once ("Show me apartments in
// Büyükçekmece") is a fresh, self-contained search instead. An explicit
// continuity phrase ("same requirements in Kadıköy") always counts as a
// slot answer regardless of how many structured details it also states,
// since the visitor is explicitly saying "change only this."
const isShortSlotAnswer = (message = '', parsedFromMessage = {}, newLifestyleConceptsCount = 0) => {
  if (newLifestyleConceptsCount > 0) return false
  if (hasLifestyleCombinePhrase(message)) return true
  return countNewStructuredCriteria(parsedFromMessage) <= 1
}

// Detects which known lifestyle concepts are literally invoked by a piece of
// text. Used on the VISITOR'S OWN raw message text (not Gemini's parsed
// output), so it stays reliable even if Gemini blends an old concept into
// this turn's JSON on its own initiative.
const detectConceptsInText = (text = '') => {
  const concepts = new Set()

  text
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeWord)
    .forEach((word) => {
      const concept = findConceptForWord(word)
      if (concept) concepts.add(concept.name)
    })

  return concepts
}

const phraseConceptNames = (phrase = '') => {
  return phrase
    .split(/\s+/)
    .map(normalizeWord)
    .map(findConceptForWord)
    .filter(Boolean)
    .map((concept) => concept.name)
}

// Drops phrases that are entirely about a concept the visitor is moving away
// from. A phrase that also touches a still-relevant concept is kept, and any
// phrase this dictionary can't classify is left untouched (safe default).
const dropConceptsFromPhrases = (phrases = [], conceptsToDrop) => {
  if (!Array.isArray(phrases) || !conceptsToDrop || conceptsToDrop.size === 0) return phrases || []

  return phrases.filter((phrase) => {
    const names = phraseConceptNames(phrase)
    if (names.length === 0) return true
    return !names.every((name) => conceptsToDrop.has(name))
  })
}

const propertyMatchesSignificantTerm = (property, terms = []) => {
  // No meaningful vocabulary to check against (e.g. everything was a
  // structured/connector word) — don't reject results we have no way to verify.
  if (terms.length === 0) return true

  const haystack = [property.title, property.description, property.address, property.district]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return terms.some((term) => haystack.includes(toSingular(term)))
}

const getDescriptionSearchQuery = (parsed = {}, message = '') => {
  const parts = [
    parsed.descriptionQuery,
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ].filter(Boolean)

  const rawQuery = parts.length > 0 ? parts.join(' ') : message
  const cleanedQuery = stripStructuredTerms(rawQuery)

  // Never search for literally nothing — if cleaning removed every word
  // (e.g. the raw query was just "apartment for rent"), fall back to the
  // uncleaned text rather than losing the search entirely.
  return cleanedQuery || rawQuery
}

const searchByDescription = async ({ parsed, filter, message }) => {
  const descriptionSearchQuery = getDescriptionSearchQuery(parsed, message)

  if (!descriptionSearchQuery || !descriptionSearchQuery.trim()) {
    return {
      properties: [],
      descriptionSearchUsed: false,
      descriptionSearchQuery: null,
      descriptionSearchError: null,
    }
  }

  try {
    const hardFilter = buildHardFilterForDescriptionSearch(filter)

    const searchFilter = {
      ...hardFilter,
      $text: {
        $search: descriptionSearchQuery,
      },
    }

    const rawMatches = await Property.find(searchFilter, {
      score: { $meta: 'textScore' },
    })
      .select(PROPERTY_SELECT)
      .sort({
        score: { $meta: 'textScore' },
        featured: -1,
        createdAt: -1,
      })
      .limit(10)

    // $text can match purely on a generic word (e.g. "apartment" in the
    // title), and Gemini's expanded descriptionQuery can pad in loosely
    // related synonyms (e.g. "family friendly" for a plain "near school"
    // request). Verify relevance using the concept(s) actually tagged by the
    // visitor's request, not every word in the expanded search string.
    const relevanceTerms = getRelevanceCheckTerms(parsed)
    const strongMatches = rawMatches.filter((property) =>
      propertyMatchesSignificantTerm(property, relevanceTerms)
    )

    return {
      properties: strongMatches,
      descriptionSearchUsed: strongMatches.length > 0,
      descriptionSearchQuery,
      descriptionSearchError: null,
    }
  } catch (err) {
    console.log('Description search failed:', err.message)

    return {
      properties: [],
      descriptionSearchUsed: false,
      descriptionSearchQuery,
      descriptionSearchError: err.message,
    }
  }
}

// ─── Next useful question helper ──────────────────────────────────────────────
const buildNextUsefulQuestion = (parsed = {}) => {
  if (!parsed.listingType) {
    return 'Are you looking to buy or rent?'
  }

  if (!parsed.propertyType) {
    return 'Do you prefer an apartment, villa, or another property type?'
  }

  if (!parsed.district && (!parsed.districts || parsed.districts.length === 0)) {
    return 'Do you have a preferred district?'
  }

  if (!parsed.maxPrice && !parsed.minPrice) {
    return 'Do you have a budget range in mind?'
  }

  return null
}

// Requested feature toggles that fallback is allowed to relax (unlike
// mustHave, which stays enforced at every level — see buildMustHaveFeatureFilter).
// Used only to tell the visitor honestly when that relaxation actually happened.
const SOFT_FEATURE_LABELS = [
  ['furnished', 'furnished'],
  ['balcony', 'a balcony'],
  ['elevator', 'an elevator'],
  ['pool', 'a pool'],
  ['garden', 'a garden'],
  ['parking', 'parking'],
]

const joinWithAnd = (items) => {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// Computes which requested feature toggles are not guaranteed once fallback
// drops them (i.e. they were requested directly, not via mustHave, which is
// preserved separately and never actually relaxed).
const getRelaxedFeatureLabels = (parsed = {}, mustHaveFilter = {}) => {
  return SOFT_FEATURE_LABELS.filter(
    ([field]) => parsed[field] === true && !mustHaveFilter[field]
  ).map(([, label]) => label)
}

// ─── Build reply text ─────────────────────────────────────────────────────────
const buildReply = ({
  properties,
  fallbackLevel,
  parsed,
  matchedViaDescription = false,
  descriptionSearchAttempted = false,
  relaxedFeatureLabels = [],
}) => {
  const count = properties.length
  const nextQuestion = buildNextUsefulQuestion(parsed)

  if (count === 0) {
    if (descriptionSearchAttempted) {
      return nextQuestion
        ? `I couldn't find a strong match from the property descriptions yet. ${nextQuestion}`
        : "I couldn't find a strong match from the property descriptions yet. Try adding a district, budget, or property type."
    }

    return "I couldn't find any available properties right now. Try adjusting your district, budget, or property type."
  }

  // Only claim a "description match" when every one of these properties was
  // actually verified to contain the requested lifestyle content (see
  // searchByDescription's significant-term filtering) — never just because a
  // $text query technically ran.
  if (matchedViaDescription) {
    const propertyText = count === 1 ? '1 property' : `${count} properties`

    let reply = `I found ${propertyText} that may match your request based on the property descriptions.`

    if (parsed.descriptionQuery) {
      reply += ` I searched for details related to: ${parsed.descriptionQuery}.`
    }

    if (parsed.listingType) {
      reply += ` I also filtered it for ${parsed.listingType.toLowerCase()} properties.`
    }

    if (parsed.propertyType) {
      reply += ` I also matched the property type: ${parsed.propertyType.toLowerCase()}.`
    }

    if (nextQuestion) {
      reply += ` ${nextQuestion}`
    }

    return reply
  }

  const propertyLabel = parsed.propertyType
    ? parsed.propertyType.toLowerCase()
    : 'property'

  const n =
    count === 1
      ? `1 ${propertyLabel}`
      : `${count} ${propertyLabel === 'property' ? 'properties' : `${propertyLabel}s`}`

  const allDistricts = [
    ...(parsed.district ? [parsed.district] : []),
    ...(Array.isArray(parsed.districts) ? parsed.districts : []),
  ]

  const parts = []

  if (parsed.propertyType) parts.push(parsed.propertyType.toLowerCase())
  if (parsed.listingType) parts.push(`for ${parsed.listingType.toLowerCase()}`)
  if (parsed.maxPrice) parts.push(`up to ₺${Number(parsed.maxPrice).toLocaleString('tr-TR')}`)
  if (allDistricts.length > 0) parts.push(`in ${allDistricts.join(' or ')}`)

  const description = parts.length ? ` — ${parts.join(' ')}` : ''

  const listingWord =
    parsed.listingType === 'Rent' ? 'rentals' : parsed.listingType === 'Sale' ? 'properties for sale' : 'properties'

  // The visitor asked a lifestyle/description question but we couldn't
  // confirm any listing actually matches that detail — say so plainly
  // instead of presenting these general fallback results as if they did.
  const descriptionMismatchNotice = descriptionSearchAttempted
    ? `I couldn't find a strong match for ${
        parsed.descriptionQuery ? `"${parsed.descriptionQuery}"` : 'that specific request'
      }, so here ${count === 1 ? 'is' : 'are'} some general ${listingWord} instead.`
    : ''

  // From fallbackLevel 1 onward, the requested feature toggles (parking,
  // pool, garden, balcony, elevator, furnished) were dropped from the query
  // to find any results — say so plainly instead of staying silent about it.
  const relaxedFeaturesNotice =
    fallbackLevel > 0 && relaxedFeatureLabels.length > 0
      ? `I could not find ${listingWord} with ${joinWithAnd(relaxedFeatureLabels)}, so these are alternatives without all requested features.`
      : ''

  const leadNotice = descriptionMismatchNotice || relaxedFeaturesNotice

  const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1)

  const composeFallbackSentence = (base, defaultLead) => {
    return leadNotice
      ? `${leadNotice} ${capitalize(base)}`
      : `${defaultLead}${base}`
  }

  if (fallbackLevel === 0) {
    if (leadNotice) {
      const sentence = composeFallbackSentence(`here ${count === 1 ? 'is' : 'are'} ${n}${description}`, '')
      return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
    }

    return nextQuestion
      ? `I found ${n}${description}. ${nextQuestion}`
      : `I found ${n}${description}.`
  }

  if (fallbackLevel === 1) {
    const sentence = composeFallbackSentence(
      `here ${count === 1 ? 'is' : 'are'} ${n} in the same area that may interest you`,
      "I couldn't find an exact match with all details, but "
    )

    return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
  }

  if (fallbackLevel === 2) {
    const sentence = composeFallbackSentence(
      `here ${count === 1 ? 'is' : 'are'} ${n} of that type from other areas`,
      'Nothing matched in that district, but '
    )

    return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
  }

  const sentence = composeFallbackSentence(
    `here ${count === 1 ? 'is' : 'are'} ${n} to give you a starting point`,
    "I couldn't find a close match, but "
  )

  return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
}

// ─── Match reason (deterministic, no AI) ──────────────────────────────────────
// Built purely from `parsed` filters + real property fields — never from Gemini —
// so it always stays truthful to what was actually searched and found.
const buildMatchReason = (property, parsed = {}, matchedViaDescription = false) => {
  const requestedDistricts = [
    ...(parsed.district ? [parsed.district] : []),
    ...(Array.isArray(parsed.districts) ? parsed.districts : []),
  ]

  const propertyDistrict = String(property.district || '')
  const districtMatches =
    requestedDistricts.length > 0 &&
    requestedDistricts.some((d) => propertyDistrict.toLowerCase().includes(String(d).toLowerCase()))

  const listingTypeMatches = Boolean(parsed.listingType) && property.listingType === parsed.listingType
  const propertyTypeMatches = Boolean(parsed.propertyType) && property.propertyType === parsed.propertyType
  const bedsMatches = Boolean(parsed.beds) && Number(property.beds) === Number(parsed.beds)
  const bathsMatches = Boolean(parsed.baths) && Number(property.baths) === Number(parsed.baths)

  const withinBudget =
    (!parsed.minPrice || Number(property.price) >= Number(parsed.minPrice)) &&
    (!parsed.maxPrice || Number(property.price) <= Number(parsed.maxPrice))
  const budgetMatches = Boolean(parsed.minPrice || parsed.maxPrice) && withinBudget

  const featureChecks = [
    ['furnished', 'furnished'],
    ['balcony', 'a balcony'],
    ['elevator', 'an elevator'],
    ['pool', 'a pool'],
    ['garden', 'a garden'],
  ]

  const matchedFeatures = featureChecks
    .filter(([field]) => parsed[field] === true && property[field])
    .map(([, label]) => label)

  if (
    parsed.parking === true &&
    property.parking &&
    !['', 'no', 'none'].includes(String(property.parking).toLowerCase())
  ) {
    matchedFeatures.push('parking')
  }

  const article = /^[aeiou]/i.test(parsed.propertyType || '') ? 'an' : 'a'

  const primaryParts = []
  if (propertyTypeMatches) primaryParts.push(`${article} ${parsed.propertyType.toLowerCase()}`)
  if (listingTypeMatches) primaryParts.push(`for ${parsed.listingType.toLowerCase()}`)
  if (districtMatches) primaryParts.push(`in ${property.district}`)

  const extraParts = []
  if (bedsMatches) extraParts.push(`has your requested ${property.beds} bedrooms`)
  if (bathsMatches) extraParts.push(`has your requested ${property.baths} bathrooms`)
  if (budgetMatches) extraParts.push('fits your budget')
  if (matchedFeatures.length > 0) extraParts.push(`has ${matchedFeatures.join(', ')}`)
  if (matchedViaDescription && parsed.descriptionQuery) {
    extraParts.push(`matches what you described ("${parsed.descriptionQuery}")`)
  }

  const clauses = []
  if (primaryParts.length > 0) clauses.push(`it is ${primaryParts.join(' ')}`)
  clauses.push(...extraParts)

  let reason =
    clauses.length > 0
      ? `This matches because ${clauses.join(', and ')}.`
      : 'This is one of our available listings that may interest you.'

  if (requestedDistricts.length > 0 && !districtMatches) {
    reason += ` It is from ${
      property.district || 'another area'
    } instead of ${requestedDistricts.join(' or ')}, since there was no exact match in your requested district.`
  }

  return reason
}

// ─── Main route ───────────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const {
      message,
      pageKey,
      history = [],
      currentFilters = {},
      shownPropertyIds = [],
    } = req.body

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      })
    }

    const isPropertyPage =
      !pageKey ||
      pageKey === 'properties' ||
      pageKey === 'sale' ||
      pageKey === 'rent' ||
      pageKey.startsWith('/properties/')

    if (!isPropertyPage) {
      return res.json({
        success: true,
        reply: 'For now, I can help with property searches. Service pages will be supported soon.',
        properties: [],
        parsed: currentFilters,
      })
    }

    // ChatContext usually sends history including current message.
    // We remove the current message before passing history to Gemini.
    const historyWithoutCurrentMessage = Array.isArray(history)
      ? history.slice(0, -1)
      : []

    // 1. Parse only the latest user message
    let parsedFromMessage = await parsePropertyMessageWithGemini(
      message,
      historyWithoutCurrentMessage
    )

    const aiUsed = Boolean(parsedFromMessage)

    // 2. If Gemini fails, use keyword fallback
    if (!parsedFromMessage) {
      parsedFromMessage = keywordFallbackParser(message)
    }

    // 3. Normalize and extract simple budget numbers
    parsedFromMessage = normalizeParsed(parsedFromMessage, message)

    // 4. Merge previous search memory with the latest message
    let parsed = mergeParsedWithContext(currentFilters, parsedFromMessage)
    // If Gemini clearly says this is a fresh description search,
// do not allow old frontend filters like "Villa" to accidentally narrow it.
if (
  parsedFromMessage.searchMode === 'description' &&
  parsedFromMessage.descriptionQuery &&
  !parsedFromMessage.listingType &&
  !parsedFromMessage.propertyType &&
  !parsedFromMessage.district &&
  (!Array.isArray(parsedFromMessage.districts) || parsedFromMessage.districts.length === 0)
) {
  parsed.listingType = null
  parsed.propertyType = null
  parsed.district = null
  parsed.districts = []
  parsed.beds = null
  parsed.baths = null
  parsed.minPrice = null
  parsed.maxPrice = null
  parsed.minSqm = null
  parsed.maxSqm = null
  parsed.furnished = null
  parsed.balcony = null
  parsed.elevator = null
  parsed.pool = null
  parsed.garden = null
  parsed.parking = null
}

// If the visitor switches listingType (Sale <-> Rent) — a major intent
// change — without repeating the district/property type or signaling they
// want the same area ("same district", "there", etc.), do not blindly keep
// the old district/propertyType forever. Treat it as a fresh search in the
// new listingType instead (rule 8).
const listingTypeChanged =
  Boolean(currentFilters.listingType) &&
  Boolean(parsedFromMessage.listingType) &&
  currentFilters.listingType !== parsedFromMessage.listingType

const messageRepeatsOldCriteria =
  hasValue(parsedFromMessage.district) ||
  (Array.isArray(parsedFromMessage.districts) && parsedFromMessage.districts.length > 0) ||
  hasValue(parsedFromMessage.propertyType) ||
  hasExplicitContinuityPhrase(message)

if (listingTypeChanged && !messageRepeatsOldCriteria) {
  parsed.district = null
  parsed.districts = []
  parsed.propertyType = null
}

// If this message is a genuine lifestyle/description-style search (e.g.
// "near a school"), it's a new angle on the conversation, not a request to
// keep enforcing every earlier feature toggle forever. Clear only the
// feature fields this message did NOT itself restate, and only if the
// visitor didn't ask to keep them ("same requirements", "also with", etc.).
// listingType/propertyType/district are untouched here — they already have
// their own reset rules above.
const isFreshLifestyleMessage = !isShowMoreRequest(message) && hasSoftDescriptionSearch(parsedFromMessage)

if (isFreshLifestyleMessage && !hasFeatureContinuityPhrase(message)) {
  FEATURE_FIELDS.forEach((field) => {
    if (!hasValue(parsedFromMessage[field])) {
      parsed[field] = null
    }
  })
}

// Concepts (school, seaView, metroTransport, ...) detected directly from the
// raw message text — used below to decide whether a new lifestyle concept
// should REPLACE or COMBINE WITH whatever concept is already active in
// currentFilters, and whether this message is a short slot answer at all.
// Detected from raw text, not Gemini's parse, so this stays reliable even
// if Gemini blends old + new concepts together on its own, or fails to tag
// a concept it should have.
const oldLifestyleConcepts = detectConceptsInText(getConceptSourcePhrases(currentFilters).join(' '))
const newLifestyleConceptsInMessage = detectConceptsInText(message)
const conceptsToDrop = new Set(
  [...oldLifestyleConcepts].filter((concept) => !newLifestyleConceptsInMessage.has(concept))
)

// General pending-search memory: a short slot-filling answer ("buy",
// "apartment", a district name, a budget number, "same requirements in
// Kadıköy") is very likely completing a PENDING request rather than
// starting a fresh one — restore the previously gathered lifestyle from
// memory. A message stating multiple new structured details at once ("Show
// me apartments in Büyükçekmece") is a fresh, self-contained search
// instead, and should NOT inherit stale lifestyle content just because it
// didn't repeat it.
const isSlotFillingAnswer = isShortSlotAnswer(message, parsedFromMessage, newLifestyleConceptsInMessage.size)

const isLifestyleConceptSwitch =
  newLifestyleConceptsInMessage.size > 0 &&
  conceptsToDrop.size > 0 &&
  !hasLifestyleCombinePhrase(message)

const shouldCombineLifestyle =
  newLifestyleConceptsInMessage.size > 0 && hasLifestyleCombinePhrase(message)

if (isSlotFillingAnswer && hasSoftDescriptionSearch(currentFilters)) {
  // Slot-filling answer — nothing new about lifestyle was said, so fully
  // restore the pending lifestyle/description criteria from memory.
  parsed.lifestyle = Array.isArray(currentFilters.lifestyle) ? currentFilters.lifestyle : []
  parsed.mustHave = Array.isArray(currentFilters.mustHave) ? currentFilters.mustHave : []
  parsed.niceToHave = Array.isArray(currentFilters.niceToHave) ? currentFilters.niceToHave : []
  parsed.requirements = Array.isArray(currentFilters.requirements) ? currentFilters.requirements : []
  parsed.descriptionQuery = currentFilters.descriptionQuery || null
  parsed.searchMode = currentFilters.searchMode || parsed.searchMode
} else if (isLifestyleConceptSwitch) {
  // A genuinely different lifestyle concept was named with no combine
  // phrase — replace the old concept's content rather than stacking onto it
  // (e.g. "near school" -> "what about sea view apartment").
  parsed.lifestyle = dropConceptsFromPhrases(parsed.lifestyle, conceptsToDrop)
  parsed.mustHave = dropConceptsFromPhrases(parsed.mustHave, conceptsToDrop)
  parsed.niceToHave = dropConceptsFromPhrases(parsed.niceToHave, conceptsToDrop)
  parsed.requirements = dropConceptsFromPhrases(parsed.requirements, conceptsToDrop)
  // Let the $text query regenerate from the now-filtered arrays (or the
  // current message) instead of keeping the old, now-stale free-text phrase.
  parsed.descriptionQuery = null
} else if (shouldCombineLifestyle) {
  // An explicit combine phrase was used ("also", "same requirements",
  // "both", "plus", "too", "and", ...) — union old + new rather than
  // trusting either Gemini's array or the plain merge alone.
  const unionArrays = (a, b) => Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]))

  parsed.lifestyle = unionArrays(currentFilters.lifestyle, parsedFromMessage.lifestyle)
  parsed.mustHave = unionArrays(currentFilters.mustHave, parsedFromMessage.mustHave)
  parsed.niceToHave = unionArrays(currentFilters.niceToHave, parsedFromMessage.niceToHave)
  parsed.requirements = unionArrays(currentFilters.requirements, parsedFromMessage.requirements)
  parsed.descriptionQuery =
    [currentFilters.descriptionQuery, parsedFromMessage.descriptionQuery].filter(Boolean).join(' ') ||
    parsed.descriptionQuery
} else if (!isSlotFillingAnswer && newLifestyleConceptsInMessage.size === 0 && hasSoftDescriptionSearch(currentFilters)) {
  // A fresh, self-contained structured search (multiple new structured
  // details, no lifestyle concept of its own, no continuity phrase) —
  // clear stale lifestyle memory instead of silently carrying it forward
  // via the default merge's "keep old if new is empty" behavior.
  parsed.lifestyle = []
  parsed.mustHave = []
  parsed.niceToHave = []
  parsed.requirements = []
  parsed.descriptionQuery = null
}

    // 5. Page context wins
    if (pageKey === 'sale') parsed.listingType = 'Sale'
    if (pageKey === 'rent') parsed.listingType = 'Rent'

    const nonPropertyReply = buildNonPropertyReply(parsed)

if (nonPropertyReply) {
  return res.json({
    success: true,
    reply: nonPropertyReply,
    properties: [],
    parsed,
    filterUsed: null,
    exactMatch: null,
    aiUsed,
  })
}

if (parsed.replyType === 'ask_question' && parsed.nextQuestion) {
  return res.json({
    success: true,
    reply: parsed.nextQuestion,
    properties: [],
    parsed,
    filterUsed: null,
    exactMatch: null,
    aiUsed,
  })
}

    console.log('Message:', message)
    console.log('Parsed from current message:', parsedFromMessage)
    console.log('Old filters from frontend:', currentFilters)
    console.log('Final merged parsed:', parsed)

    // 6. Ask only if important info is still missing after merging memory
    const missingQuestion = buildMissingInfoQuestion(parsed)

    if (missingQuestion) {
      return res.json({
        success: true,
        reply: missingQuestion,
        properties: [],
        parsed,
        filterUsed: null,
        exactMatch: null,
        aiUsed,
      })
    }

    // 7. Build MongoDB filter and search
    const filter = buildMongoFilter(parsed)

    // mustHave is strict: enforce it as a real hard filter now, and carry it
    // through every fallback relaxation step below (niceToHave stays soft —
    // it is only used as a text-search signal, not a hard requirement, for now).
    const mustHaveFilter = buildMustHaveFeatureFilter(parsed.mustHave)
    Object.assign(filter, mustHaveFilter)

    // Feature toggles requested directly (not via mustHave) that fallback is
    // allowed to drop — used only to tell the visitor honestly if that happens.
    const relaxedFeatureLabels = getRelaxedFeatureLabels(parsed, mustHaveFilter)

    // Only exclude previously shown properties on a plain "show me more"
    // continuation. If this message itself introduces new/changed criteria,
    // treat it as a fresh search and let previously shown properties reappear.
    const isShowMore = isShowMoreRequest(message)
    const isFreshSearch = !isShowMore && messageHasNewCriteria(parsedFromMessage)

    const validShownPropertyIds = isShowMore && Array.isArray(shownPropertyIds)
  ? shownPropertyIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
  : []

if (validShownPropertyIds.length > 0) {
  filter._id = { $nin: validShownPropertyIds }
}

    console.log('Filter:', JSON.stringify(filter, null, 2))

let properties = []
let fallbackLevel = 0
let descriptionSearchUsed = false
let descriptionSearchQuery = null
let descriptionSearchError = null
let matchedViaDescription = false

const descriptionSearchAttempted = hasSoftDescriptionSearch(parsed)

if (descriptionSearchAttempted) {
  const descriptionResult = await searchByDescription({
    parsed,
    filter,
    message,
  })

  properties = descriptionResult.properties
  descriptionSearchUsed = descriptionResult.descriptionSearchUsed
  descriptionSearchQuery = descriptionResult.descriptionSearchQuery
  descriptionSearchError = descriptionResult.descriptionSearchError

  // If description search finds no VERIFIED match, fall back to normal
  // field search rather than showing unrelated "description matches".
  if (properties.length === 0) {
    const fallbackResult = await searchWithFallback(filter, mustHaveFilter)
    properties = fallbackResult.properties
    fallbackLevel = fallbackResult.fallbackLevel
  } else {
    matchedViaDescription = true
  }
} else {
  const fallbackResult = await searchWithFallback(filter, mustHaveFilter)
  properties = fallbackResult.properties
  fallbackLevel = fallbackResult.fallbackLevel
}

// Attach a short, deterministic "why this matches you" reason to each
// property — computed from real property fields + the parsed filters that
// were actually used, never from Gemini.
properties = properties.map((property) => {
  const plain = typeof property.toObject === 'function' ? property.toObject() : property

  return {
    ...plain,
    matchReason: buildMatchReason(plain, parsed, matchedViaDescription),
  }
})

const reply = buildReply({
  properties,
  fallbackLevel,
  parsed,
  matchedViaDescription,
  descriptionSearchAttempted,
  relaxedFeatureLabels,
})
    return res.json({
  success: true,
  reply,
  properties,
  parsed,
  filterUsed: filter,
  descriptionSearchUsed,
  descriptionSearchQuery,
  descriptionSearchError,
  exactMatch: fallbackLevel === 0,
  aiUsed,
})
  } catch (err) {
    next(err)
  }
})

export default router
