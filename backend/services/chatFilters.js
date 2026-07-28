// backend/services/chatFilters.js
//
// Moved verbatim out of routes/chat.js (move-only refactor, Phase 2 of the
// approved chat.js split). Turns a resolved `parsed` object into MongoDB
// filter objects. No behavior change from the original routes/chat.js code —
// same conditions, same Mongo operators, same field names, same truthy
// checks. See the architecture-review discussion for why this was the first
// module extracted (pure functions, no DB/Gemini calls, no shared mutable
// state with the rest of the route).

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
export const buildMustHaveFeatureFilter = (mustHave = []) => {
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
export const buildMongoFilter = (parsed) => {
  const filter = { status: 'Available' }

  if (parsed.listingType) filter.listingType = parsed.listingType

  if (Array.isArray(parsed.propertyTypes) && parsed.propertyTypes.length > 1) {
    filter.propertyType = { $in: parsed.propertyTypes }
  } else if (parsed.propertyType) {
    filter.propertyType = parsed.propertyType
  } else if (Array.isArray(parsed.propertyTypes) && parsed.propertyTypes.length === 1) {
    filter.propertyType = parsed.propertyTypes[0]
  }

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

// ─── Description search helpers ───────────────────────────────────────────────
export const buildHardFilterForDescriptionSearch = (filter = {}) => {
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
