// backend/services/propertySemanticSearch.js
//
// Semantic (meaning-based) property search using Gemini embeddings +
// cosine similarity. Wired into chat.js's existing lifestyle/description
// search branch (Phase 3) as a first attempt, before the existing
// $text/concept search — see searchByDescription in routes/chat.js, which
// remains the fallback whenever this returns no strong matches.

import Property from '../models/Property.js'
import { getEmbedding, cosineSimilarity } from '../utils/embeddings.js'

// Builds the free-text query to embed, from the same tagged fields
// getDescriptionSearchQuery (routes/chat.js) already prioritizes — Gemini's
// short, tagged phrases stay closer to what the visitor actually meant than
// the raw message text would.
export const buildSemanticSearchQuery = (parsed = {}) => {
  const parts = [
    parsed.descriptionQuery,
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ].filter(Boolean)

  return parts.join(' ').trim()
}

export const RESIDENTIAL_PROPERTY_TYPES = ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio']

const RESIDENTIAL_HINT_WORDS = ['home', 'family home', 'children', 'kids', 'wife', 'husband', 'living', 'family']

const messageSuggestsResidential = (message = '') => {
  const text = message.toLowerCase()
  return RESIDENTIAL_HINT_WORDS.some((word) => text.includes(word))
}

// Narrows the already-built structured filter down to the same hard-filter
// shape buildHardFilterForDescriptionSearch (routes/chat.js) produces for
// $text search — kept as a small, independent copy here rather than
// imported from the route file, matching the same pattern already used by
// services/chatLeadFlow.js (services don't reach into routes/chat.js's
// internals). Semantic ranking only ever runs on this pre-filtered pool, so
// it can never override listingType/propertyType/district/budget/features.
export const buildSemanticHardFilter = ({ filter = {}, message = '' }) => {
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

  // If no propertyType was specified but the visitor's own words suggest a
  // residential need ("home", "family home", "children", "wife", "living"),
  // exclude non-residential types (office/land/shop/etc.) instead of
  // letting a generic "home" query surface a commercial listing.
  if (!hardFilter.propertyType && messageSuggestsResidential(message)) {
    hardFilter.propertyType = { $in: RESIDENTIAL_PROPERTY_TYPES }
  }

  return hardFilter
}

// Same fields the chatbot's property cards already need (PROPERTY_SELECT in
// routes/chat.js), plus descriptionEmbedding so we can score candidates —
// the embedding itself is stripped from each result before returning.
const CARD_FIELDS = [
  'title', 'listingType', 'price', 'priceLabel', 'district', 'description',
  'address', 'propertyType', 'beds', 'baths', 'sqm', 'mainImage', 'images',
  'featured', 'status', 'pool', 'garden', 'furnished', 'balcony', 'elevator',
  'parking', 'floor', 'createdAt',
]

const SELECT_FIELDS = [...CARD_FIELDS, 'descriptionEmbedding'].join(' ')

// searchPropertiesByMeaning({ query, hardFilter, limit, threshold, relativeMargin })
// - query: the visitor's lifestyle/description text to search by meaning
// - hardFilter: a Mongo filter (status/listingType/propertyType/district/
//   price/etc.) — candidates are fetched from this pool ONLY, never the
//   whole collection, so semantic ranking can never override hard filters
// - limit: max results to return
// - threshold: minimum cosine similarity (0-1) to count as a real match.
//   Calibrated against real test data: same-domain real-estate text tends
//   to score in the 0.55-0.70 range regardless of topic, so 0.45 let
//   generic properties through. 0.60 is a better floor.
// - relativeMargin: on top of the absolute threshold, a candidate must also
//   score within `relativeMargin` of the best match in this candidate pool
//   (topScore - relativeMargin). This keeps genuinely weak/generic matches
//   out even when every candidate clears the absolute threshold, since
//   real-estate descriptions are similar enough to each other that a
//   single fixed cutoff isn't always enough on its own.
export const searchPropertiesByMeaning = async ({
  query,
  hardFilter = {},
  limit = 5,
  threshold = 0.6,
  relativeMargin = 0.05,
}) => {
  if (!query || !query.trim()) {
    console.log('[semanticSearch] no query provided — skipping')
    return []
  }

  console.log(`[semanticSearch] query: "${query}"`)
  console.log(`[semanticSearch] hardFilter: ${JSON.stringify(hardFilter)}`)

  const queryEmbedding = await getEmbedding(query)

  if (!queryEmbedding) {
    console.log('[semanticSearch] embedding failed — skipping')
    return []
  }

  const candidates = await Property.find(hardFilter).select(SELECT_FIELDS)

  console.log(`[semanticSearch] candidate count: ${candidates.length}`)

  const scored = candidates
    .filter((property) => Array.isArray(property.descriptionEmbedding) && property.descriptionEmbedding.length > 0)
    .map((property) => {
      const score = cosineSimilarity(queryEmbedding, property.descriptionEmbedding)
      const plain = property.toObject()
      delete plain.descriptionEmbedding

      return { ...plain, semanticScore: score }
    })
    .sort((a, b) => b.semanticScore - a.semanticScore)

  const topScores = scored
    .slice(0, Math.max(limit, 5))
    .map((property) => `${property.title} (${property.semanticScore.toFixed(3)})`)
  console.log(`[semanticSearch] top scores: ${topScores.join(', ') || 'none'}`)

  const topScore = scored.length > 0 ? scored[0].semanticScore : null
  const relativeFloor = topScore !== null ? topScore - relativeMargin : null

  if (relativeFloor !== null) {
    console.log(
      `[semanticSearch] topScore: ${topScore.toFixed(3)}, relativeFloor: ${relativeFloor.toFixed(3)} (topScore - ${relativeMargin})`
    )
  }

  const matches = scored
    .filter((property) => property.semanticScore >= threshold)
    .filter((property) => relativeFloor === null || property.semanticScore >= relativeFloor)
    .slice(0, limit)

  console.log(`[semanticSearch] matched count (>= ${threshold} and >= relativeFloor): ${matches.length}`)

  return matches
}
