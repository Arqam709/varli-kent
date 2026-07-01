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
const searchWithFallback = async (filter) => {
  // Step 1: exact search
  let properties = await Property.find(filter)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 0 }
  }

  // Step 2: keep listingType + propertyType + district, drop price/beds/features
  const step2 = { status: 'Available' }

  if (filter.listingType) step2.listingType = filter.listingType
  if (filter.propertyType) step2.propertyType = filter.propertyType
  if (filter.district) step2.district = filter.district
  if (filter.$or) step2.$or = filter.$or

  properties = await Property.find(step2)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 1 }
  }

  // Step 3: drop district, keep listingType + propertyType
  const step3 = { status: 'Available' }

  if (filter.listingType) step3.listingType = filter.listingType
  if (filter.propertyType) step3.propertyType = filter.propertyType

  properties = await Property.find(step3)
    .select(PROPERTY_SELECT)
    .sort({ featured: -1, createdAt: -1 })
    .limit(5)

  if (properties.length > 0) {
    return { properties, fallbackLevel: 2 }
  }

  // Step 4: just listingType
  const step4 = { status: 'Available' }

  if (filter.listingType) step4.listingType = filter.listingType

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

const getDescriptionSearchQuery = (parsed = {}, message = '') => {
  const parts = [
    parsed.descriptionQuery,
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ].filter(Boolean)

  if (parts.length > 0) {
    return parts.join(' ')
  }

  return message
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

    const properties = await Property.find(searchFilter, {
      score: { $meta: 'textScore' },
    })
      .select(PROPERTY_SELECT)
      .sort({
        score: { $meta: 'textScore' },
        featured: -1,
        createdAt: -1,
      })
      .limit(10)

    return {
      properties,
      descriptionSearchUsed: true,
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

// ─── Build reply text ─────────────────────────────────────────────────────────
const buildReply = ({
  properties,
  fallbackLevel,
  parsed,
  descriptionSearchUsed = false,
  descriptionSearchQuery = null,
}) => {
  const count = properties.length
  const nextQuestion = buildNextUsefulQuestion(parsed)

  const isDescriptionSearch =
    descriptionSearchUsed ||
    parsed.searchMode === 'description' ||
    parsed.searchMode === 'hybrid'

  if (count === 0) {
    if (isDescriptionSearch) {
      return nextQuestion
        ? `I couldn't find a strong match from the property descriptions yet. ${nextQuestion}`
        : "I couldn't find a strong match from the property descriptions yet. Try adding a district, budget, or property type."
    }

    return "I couldn't find any available properties right now. Try adjusting your district, budget, or property type."
  }

  if (isDescriptionSearch) {
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

  if (fallbackLevel === 0) {
    return nextQuestion
      ? `I found ${n}${description}. ${nextQuestion}`
      : `I found ${n}${description}.`
  }

  if (fallbackLevel === 1) {
    return nextQuestion
      ? `I couldn't find an exact match with all details, but here ${count === 1 ? 'is' : 'are'} ${n} in the same area that may interest you. ${nextQuestion}`
      : `I couldn't find an exact match with all details, but here ${count === 1 ? 'is' : 'are'} ${n} in the same area that may interest you.`
  }

  if (fallbackLevel === 2) {
    return nextQuestion
      ? `Nothing matched in that district, but here ${count === 1 ? 'is' : 'are'} ${n} of that type from other areas. ${nextQuestion}`
      : `Nothing matched in that district, but here ${count === 1 ? 'is' : 'are'} ${n} of that type from other areas.`
  }

  return nextQuestion
    ? `I couldn't find a close match, but here ${count === 1 ? 'is' : 'are'} ${n} to give you a starting point. ${nextQuestion}`
    : `I couldn't find a close match, but here ${count === 1 ? 'is' : 'are'} ${n} to give you a starting point.`
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

    const validShownPropertyIds = Array.isArray(shownPropertyIds)
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

if (hasSoftDescriptionSearch(parsed)) {
  const descriptionResult = await searchByDescription({
    parsed,
    filter,
    message,
  })

  properties = descriptionResult.properties
  descriptionSearchUsed = descriptionResult.descriptionSearchUsed
  descriptionSearchQuery = descriptionResult.descriptionSearchQuery
  descriptionSearchError = descriptionResult.descriptionSearchError

  // If description search finds nothing, fall back to normal field search.
  if (properties.length === 0) {
    const fallbackResult = await searchWithFallback(filter)
    properties = fallbackResult.properties
    fallbackLevel = fallbackResult.fallbackLevel
  }
} else {
  const fallbackResult = await searchWithFallback(filter)
  properties = fallbackResult.properties
  fallbackLevel = fallbackResult.fallbackLevel
}

const reply = buildReply({
  properties,
  fallbackLevel,
  parsed,
  descriptionSearchUsed,
  descriptionSearchQuery,
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
