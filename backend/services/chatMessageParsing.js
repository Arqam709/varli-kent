import { RESIDENTIAL_PROPERTY_TYPES } from './propertySemanticSearch.js'

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
  needsClarification: false,
  clarifyingQuestion: null,
}

export const extractBudgetFromText = (message, parsed) => {
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

  safe.districts = Array.isArray(safe.districts) ? safe.districts : []
  safe.propertyTypes = Array.isArray(safe.propertyTypes) ? safe.propertyTypes : []
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
  return KNOWN_DISTRICTS.filter((d) => text.includes(d.toLowerCase()))
}

// ─── Keyword fallback parser ──────────────────────────────────────────────────
export const keywordFallbackParser = (message) => {
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

  const matched = detectMentionedDistricts(message)

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

// ─── Multiple/uncertain property type detection (deterministic) ──────────────
// Gemini's JSON schema only has a single `propertyType` field, so it has no
// way to express "apartment or villa" — it must pick one and silently drop
// the uncertainty. Detected here from the raw message text instead, and used
// to OVERRIDE whatever single guess Gemini/keywordFallbackParser made.
export const PROPERTY_TYPE_KEYWORDS = [
  ['apartment', 'Apartment'],
  ['flat', 'Apartment'],
  ['villa', 'Villa'],
  ['penthouse', 'Penthouse'],
  ['duplex', 'Duplex'],
  ['studio', 'Studio'],
  ['office', 'Office'],
  ['land', 'Land'],
  ['shop', 'Shop'],
]

export const detectMentionedPropertyTypes = (message = '') => {
  const text = message.toLowerCase()
  const found = []

  PROPERTY_TYPE_KEYWORDS.forEach(([keyword, type]) => {
    if (text.includes(keyword) && !found.includes(type)) {
      found.push(type)
    }
  })

  return found
}

const RESIDENTIAL_REQUEST_PATTERNS = [/\bresidential\b/]

export const messageRequestsResidential = (message = '') => {
  const text = message.trim().toLowerCase()
  return RESIDENTIAL_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
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
