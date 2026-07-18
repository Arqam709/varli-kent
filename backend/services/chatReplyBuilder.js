import { findConceptForWord } from '../utils/lifestyleConcepts.js'
import {
  hasSoftDescriptionSearch,
  hasKnownPropertyType,
  messageExpressesTypeUncertainty,
} from './chatMessageParsing.js'

export const shouldSkipGeminiAskQuestion = (parsed) => hasSoftDescriptionSearch(parsed)

export const buildNonPropertyReply = (parsed) => {
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

export const buildMissingInfoQuestion = (parsed, message = '') => {
  
  if (hasSoftDescriptionSearch(parsed)) {
    return null
  }

  if (!parsed.listingType) {
    return 'Are you looking to buy or rent?'
  }

  if (!hasKnownPropertyType(parsed)) {
    if (messageExpressesTypeUncertainty(message)) {
      return 'Would you prefer apartment, villa, office, or should I show residential properties?'
    }

    return 'What type of property are you looking for — apartment, villa, office, or something else?'
  }

  return null
}

// ─── Next useful question helper ──────────────────────────────────────────────
// Exported (though chat.js never imports it — it's only used internally by
// buildReply below) so it can be characterization-tested directly, in
// isolation from buildReply's own surrounding wording.
export const buildNextUsefulQuestion = (parsed = {}) => {
  if (!parsed.listingType) {
    return 'Are you looking to buy or rent?'
  }

  if (!hasKnownPropertyType(parsed)) {
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

export const getRelaxedFeatureLabels = (parsed = {}, mustHaveFilter = {}) => {
  return SOFT_FEATURE_LABELS.filter(
    ([field]) => parsed[field] === true && !mustHaveFilter[field]
  ).map(([, label]) => label)
}

const PROPERTY_TYPE_PLURAL_OVERRIDES = { Duplex: 'Duplexes' }

export const pluralizePropertyType = (type) =>
  (PROPERTY_TYPE_PLURAL_OVERRIDES[type] || `${type}s`).toLowerCase()

export const hasMultiplePropertyTypes = (parsed = {}) =>
  Array.isArray(parsed.propertyTypes) && parsed.propertyTypes.length > 1

export const describePropertyTypesPhrase = (parsed = {}) => {
  if (hasMultiplePropertyTypes(parsed)) {
    return parsed.propertyTypes.map(pluralizePropertyType).join(' and ')
  }

  return parsed.propertyType ? parsed.propertyType.toLowerCase() : null
}

// ─── Build reply text ─────────────────────────────────────────────────────────
export const buildReply = ({
  properties,
  fallbackLevel,
  parsed,
  matchedViaDescription = false,
  matchedViaSemantic = false,
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
  if (matchedViaDescription || matchedViaSemantic) {
    const propertyText = count === 1 ? '1 property' : `${count} properties`

    let reply = matchedViaSemantic
      ? `I found ${propertyText} that may match your request by meaning.`
      : `I found ${propertyText} that may match your request based on the property descriptions.`

    if (parsed.descriptionQuery) {
      reply += ` I searched for details related to: ${parsed.descriptionQuery}.`
    }

    if (parsed.listingType) {
      reply += ` I also filtered it for ${parsed.listingType.toLowerCase()} properties.`
    }

    const semanticPropertyTypesPhrase = describePropertyTypesPhrase(parsed)
    if (semanticPropertyTypesPhrase) {
      reply += hasMultiplePropertyTypes(parsed)
        ? ` I also matched the property types: ${semanticPropertyTypesPhrase}.`
        : ` I also matched the property type: ${semanticPropertyTypesPhrase}.`
    }

    if (nextQuestion) {
      reply += ` ${nextQuestion}`
    }

    return reply
  }


  const propertyLabel = !hasMultiplePropertyTypes(parsed) && parsed.propertyType
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

  const propertyTypesPhrase = describePropertyTypesPhrase(parsed)
  if (propertyTypesPhrase) parts.push(propertyTypesPhrase)
  if (parsed.listingType) parts.push(`for ${parsed.listingType.toLowerCase()}`)
  if (parsed.maxPrice) parts.push(`up to ₺${Number(parsed.maxPrice).toLocaleString('tr-TR')}`)
  if (allDistricts.length > 0) parts.push(`in ${allDistricts.join(' or ')}`)

  const description = parts.length ? ` — ${parts.join(' ')}` : ''

  const listingWord =
    parsed.listingType === 'Rent' ? 'rentals' : parsed.listingType === 'Sale' ? 'properties for sale' : 'properties'

  const descriptionMismatchNotice = descriptionSearchAttempted
    ? `I couldn't find a strong match for ${
        parsed.descriptionQuery ? `"${parsed.descriptionQuery}"` : 'that specific request'
      }, so here ${count === 1 ? 'is' : 'are'} some general ${listingWord} instead.`
    : ''


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

const normalizeWord = (word = '') => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')


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

const extractConceptIds = (text = '') => {
  const ids = new Set()

  text
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeWord)
    .forEach((word) => {
      const concept = findConceptForWord(word)
      if (concept) ids.add(concept.id)
    })

  return Array.from(ids)
}

const LIFESTYLE_CONCEPT_MATCH_LABELS = {
  school: 'is near schools',
  sea_view: 'has a sea view',
  metro_transport: 'is close to metro and transport links',
  family: 'is family-friendly',
  peaceful_safe: 'is in a peaceful, safe area',
  park_green: 'is near a park or green space',
  investment: 'looks like a good investment opportunity',
  luxury: 'has a luxury feel',
}


const getLifestyleMatchLabels = (property, parsed, matchedViaDescription, matchedViaSemantic) => {
  if (!matchedViaDescription && !matchedViaSemantic) return []

  const requestedConceptIds = extractConceptIds(getConceptSourcePhrases(parsed).join(' '))
  if (requestedConceptIds.length === 0) return []

  let confirmedConceptIds = requestedConceptIds

  if (matchedViaDescription) {
    const propertyText = [property.title, property.description, property.address, property.district]
      .filter(Boolean)
      .join(' ')
    const presentConceptIds = extractConceptIds(propertyText)
    confirmedConceptIds = requestedConceptIds.filter((id) => presentConceptIds.includes(id))
  }

  return confirmedConceptIds.map((id) => LIFESTYLE_CONCEPT_MATCH_LABELS[id]).filter(Boolean)
}

export const buildMatchReason = (property, parsed = {}, matchedViaDescription = false, matchedViaSemantic = false) => {
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
  const propertyTypeInRequestedSet =
    !propertyTypeMatches &&
    Array.isArray(parsed.propertyTypes) &&
    parsed.propertyTypes.length > 1 &&
    parsed.propertyTypes.includes(property.propertyType)
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
  if (propertyTypeInRequestedSet) extraParts.push('is one of the property types you mentioned')
  if (bedsMatches) extraParts.push(`has your requested ${property.beds} bedrooms`)
  if (bathsMatches) extraParts.push(`has your requested ${property.baths} bathrooms`)
  if (budgetMatches) extraParts.push('fits your budget')
  if (matchedFeatures.length > 0) extraParts.push(`has ${matchedFeatures.join(', ')}`)

  const lifestyleLabels = getLifestyleMatchLabels(property, parsed, matchedViaDescription, matchedViaSemantic)

  if (lifestyleLabels.length > 0) {
    extraParts.push(...lifestyleLabels)
  } else if (matchedViaSemantic) {
    extraParts.push(
      parsed.descriptionQuery
        ? `matches the meaning of what you described ("${parsed.descriptionQuery}")`
        : 'matches the lifestyle/meaning of what you described'
    )
  } else if (matchedViaDescription && parsed.descriptionQuery) {
    extraParts.push(`matches what you described ("${parsed.descriptionQuery}")`)
  }

  const clauses = []
  if (primaryParts.length > 0) clauses.push(`it is ${primaryParts.join(' ')}`)
  clauses.push(...extraParts)

  let reason
  if (clauses.length === 0) {
    reason = 'This is one of our available listings that may interest you.'
  } else {
    const body = primaryParts.length > 0 ? clauses.join(', and ') : `it ${clauses.join(', and ')}`
    reason = `This matches because ${body}.`
  }

  if (requestedDistricts.length > 0 && !districtMatches) {
    reason += ` It is from ${
      property.district || 'another area'
    } instead of ${requestedDistricts.join(' or ')}, since there was no exact match in your requested district.`
  }

  return reason
}
