// backend/services/chatFilters.js
//
// Moved verbatim out of routes/chat.js (move-only refactor, Phase 2 of the
// approved chat.js split). Turns a resolved `parsed` object into MongoDB
// filter objects. No behavior change from the original routes/chat.js code —
// same conditions, same Mongo operators, same field names, same truthy
// checks. See the architecture-review discussion for why this was the first
// module extracted (pure functions, no DB/Gemini calls, no shared mutable
// state with the rest of the route).

import {
  normalizeForMatching,
  AMENITY_TERMS,
  CANONICAL_FLOOR_LOCATIONS,
  CANONICAL_KITCHEN_TYPES,
  CANONICAL_USAGE_STATUSES,
  CANONICAL_TITLE_DEED_STATUSES,
  CANONICAL_TRANSPORT_OPTIONS,
  CANONICAL_CURRENCIES,
  CANONICAL_HEATING,
  CANONICAL_PARKING_TYPES,
  CANONICAL_ROOMS,
  BUILDING_AGE_BUCKET_LABELS,
} from '../locales/chatParsingVocabulary.js'

// ─── mustHave enforcement (deterministic, no AI) ──────────────────────────────
// Maps mustHave phrases (e.g. "parking", "pool") to the real Property fields
// they refer to. Only features that actually exist on the Property schema
// are handled — everything else in mustHave stays as a text-search signal only.
//
// Wave 11B appends the nine tri-state amenities. Their keyword lists are
// pulled from AMENITY_TERMS rather than written out here, so a Turkish or
// Arabic phrasing ("hamam", "حمام تركي") enforces the requirement just as
// "turkish bath" does. The donor kept this map English-only; that would have
// made a strict requirement silently optional for two of the three languages
// the chat pipeline supports.
const MUST_HAVE_FEATURE_MAP = [
  { field: 'parking', keywords: ['parking', 'garage'] },
  { field: 'pool', keywords: ['pool'] },
  { field: 'garden', keywords: ['garden'] },
  { field: 'balcony', keywords: ['balcony'] },
  { field: 'elevator', keywords: ['elevator', 'lift'] },
  { field: 'furnished', keywords: ['furnished'] },
  ...Object.entries(AMENITY_TERMS).map(([field, keywords]) => ({ field, keywords })),
]

// Builds a strict filter fragment from parsed.mustHave. This is enforced as a
// hard requirement (rule: mustHave is strict) and must be re-applied at every
// fallback level, unlike the optional feature toggles that fallback relaxes.
export const buildMustHaveFeatureFilter = (mustHave = []) => {
  const musts = {}

  if (!Array.isArray(mustHave) || mustHave.length === 0) return musts

  // normalizeForMatching replaces the previous .toLowerCase(): it lowercases
  // the same way, and additionally folds İ->i, strips Arabic diacritics and
  // normalizes alef variants. For the six original ASCII keyword lists the
  // two are equivalent (asserted in tests/chatFilters.test.js); for the
  // Turkish and Arabic terms it is the difference between matching and not.
  const text = normalizeForMatching(mustHave.join(' '))

  MUST_HAVE_FEATURE_MAP.forEach(({ field, keywords }) => {
    const matched = keywords.some((keyword) => text.includes(normalizeForMatching(keyword)))
    if (!matched) return

    if (field === 'parking') {
      musts.parking = { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] }
    } else {
      musts[field] = true
    }
  })

  return musts
}

/* ═══════════════════════════════════════════════════════════════════════
 * Wave 11B validation helpers
 *
 * Gemini's output is untrusted input. It reaches this module as a plain
 * object that nothing has type-checked, so every extended value is proven
 * here before it can become a Mongo operator.
 *
 * The donor did none of this — it wrote `filter.usageStatus = { $in:
 * parsed.usageStatus }` and `Number(parsed.minFloor)` directly. That admits
 * `$in: [{$ne: null}]` from a hallucinated object and `$gte: NaN` from a
 * hallucinated number, the latter of which silently matches zero documents
 * and looks exactly like "no listings available".
 * ═══════════════════════════════════════════════════════════════════════ */

/*
 * A bound is usable only if it is a finite number.
 *
 * Truthiness is deliberately NOT used, which is the whole point: `floor` and
 * `coefficient` can legitimately be 0, and `if (parsed.minFloor)` would drop
 * "ground floor or above" on the floor. Number(null) is 0 and Number('') is
 * 0, so null/'' are rejected before conversion rather than after — otherwise
 * an absent bound would arrive as a real 0 bound.
 */
const finiteNumber = (value) => {
  // Only a number or a numeric string may become a bound. Number() is far
  // too willing otherwise: Number([]) is 0 and Number(['5']) is 5, so an
  // array — a perfectly plausible thing for a model to emit for a field
  // documented as a pair of scalars — would silently become a real bound.
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null

  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

// Applies a $gte/$lte pair, omitting the field entirely when neither bound
// survives validation. Mirrors routes/properties.js's applyRangeFilter.
const applyRange = (filter, field, minRaw, maxRaw) => {
  const min = finiteNumber(minRaw)
  const max = finiteNumber(maxRaw)
  if (min === null && max === null) return

  filter[field] = {}
  if (min !== null) filter[field].$gte = min
  if (max !== null) filter[field].$lte = max
}

/*
 * Allowlisted, deduplicated $in — any-of semantics.
 *
 * A value the schema cannot store is dropped rather than passed to Mongo.
 * When the parser supplied values but none survive, the field is left OFF
 * the filter rather than set to `$in: []`.
 *
 * That is the one place this deliberately differs from routes/properties.js,
 * which sets `$in: []` (matching nothing) in the same situation. The
 * reasoning differs because the source differs: a REST caller typed those
 * values, so honouring them literally and returning nothing is honest. Here
 * the values came from a language model, so an unrecognised value means the
 * model produced something outside the vocabulary — not that the visitor
 * asked for an impossible listing. Dropping the constraint lets the rest of
 * the query answer; `$in: []` would return nothing and read as an empty
 * inventory. The visitor's actual words still reach the description/semantic
 * search either way.
 */
const applyEnumArray = (filter, field, raw, allowed) => {
  if (!Array.isArray(raw) || raw.length === 0) return

  const valid = [...new Set(raw.filter((value) => typeof value === 'string' && allowed.includes(value)))]
  if (valid.length === 0) return

  filter[field] = { $in: valid }
}

// Only an exact `true` turns a boolean amenity into a filter.
//
// The chat parser has no way to express "must NOT have a sauna" — the
// prompt asks for true-or-null and nothing downstream produces false — so
// no `=== false` branch is written here. Adding one would invent a negative
// search the visitor cannot actually request, and on Wave 10B1 tri-state
// fields `false` and "never recorded" are different facts. The public REST
// route does support the negative case, because its UI has a No control.
const applyBoolean = (filter, field, value) => {
  if (value === true) filter[field] = true
}

/*
 * `listedSince` is produced by chatMessageParsing.js's
 * extractListedSinceFromText as an ISO string, never by Gemini. It is
 * re-validated anyway: it round-trips through the frontend inside
 * currentFilters between turns, so by the time it arrives here it is
 * caller-supplied data again.
 *
 * `new Date(arbitrary)` is exactly what routes/properties.js's
 * parseListedSince exists to avoid — it reads '-5' as a real date in 2001.
 * Requiring a full ISO-8601 timestamp is stricter than the REST route's
 * calendar-date rule and matches what the extractor actually emits.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const safeListedSinceDate = (raw) => {
  if (typeof raw !== 'string' || !ISO_TIMESTAMP.test(raw)) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
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

  /* ── Wave 11B extended fields ────────────────────────────────────────
   *
   * Appended, never interleaved — the same discipline routes/properties.js
   * used for Wave 10B4. Every line above this point behaves exactly as it
   * did before, so a `parsed` carrying only the classic fields produces a
   * byte-identical filter. tests/chatFilters.test.js asserts that against a
   * fixture list rather than trusting the reading.
   *
   * These are all OPTIONAL preferences. searchWithFallback rebuilds each
   * fallback step from listingType/propertyType/district/$or/_id plus
   * mustHaveFilter, so everything added here is dropped automatically from
   * step 2 onward. Nothing below turns into a permanent constraint, and
   * mustHave stays the only strict channel.
   */

  // Boolean amenities — same shape as furnished/balcony/... above.
  applyBoolean(filter, 'sauna', parsed.sauna)
  applyBoolean(filter, 'jacuzzi', parsed.jacuzzi)
  applyBoolean(filter, 'steamRoom', parsed.steamRoom)
  applyBoolean(filter, 'turkishBath', parsed.turkishBath)
  applyBoolean(filter, 'basement', parsed.basement)
  applyBoolean(filter, 'withinSite', parsed.withinSite)
  applyBoolean(filter, 'eligibleForCredit', parsed.eligibleForCredit)
  applyBoolean(filter, 'exchange', parsed.exchange)
  applyBoolean(filter, 'hasVirtualTour', parsed.hasVirtualTour)
  applyBoolean(filter, 'featured', parsed.featured)

  // Enum / multi-value fields. On `nearbyTransport`, which is an array field
  // on the document, $in means "contains any of these" — the any-of semantic
  // a multi-select asks for.
  applyEnumArray(filter, 'usageStatus', parsed.usageStatus, CANONICAL_USAGE_STATUSES)
  applyEnumArray(filter, 'kitchenType', parsed.kitchenType, CANONICAL_KITCHEN_TYPES)
  applyEnumArray(filter, 'heating', parsed.heating, CANONICAL_HEATING)
  applyEnumArray(filter, 'titleDeedStatus', parsed.titleDeedStatus, CANONICAL_TITLE_DEED_STATUSES)
  applyEnumArray(filter, 'floorLocation', parsed.floorLocation, CANONICAL_FLOOR_LOCATIONS)
  applyEnumArray(filter, 'buildingAge', parsed.buildingAge, BUILDING_AGE_BUCKET_LABELS)
  applyEnumArray(filter, 'rooms', parsed.rooms, CANONICAL_ROOMS)
  applyEnumArray(filter, 'nearbyTransport', parsed.nearbyTransport, CANONICAL_TRANSPORT_OPTIONS)

  /*
   * parkingType is a PARSER field, not a schema field — it narrows the same
   * Property.parking string the boolean `parking` above already targets.
   *
   * A named kind ("closed garage") is more specific than "has some parking",
   * so it overrides. This is written as an override AFTER the classic
   * `parsed.parking === true` block rather than as the donor's if/else
   * BEFORE it, which keeps the classic branch textually untouched and makes
   * the no-parkingType path provably identical to the pre-Wave-11B code.
   */
  const parkingTypes = Array.isArray(parsed.parkingType)
    ? [...new Set(parsed.parkingType.filter((value) => CANONICAL_PARKING_TYPES.includes(value)))]
    : []
  if (parkingTypes.length > 0) filter.parking = { $in: parkingTypes }

  // Currency is a stored field on the document, not an FX instruction —
  // nothing here converts between denominations.
  if (typeof parsed.currency === 'string' && CANONICAL_CURRENCIES.includes(parsed.currency)) {
    filter.currency = parsed.currency
  }

  // Numeric ranges. The chat parser's minOpenAreaSqm/maxOpenAreaSqm carry the
  // Sqm suffix (the donor's chat contract); the REST route's query params are
  // minOpenArea/maxOpenArea. Both write the same `openAreaSqm` document field.
  applyRange(filter, 'netSqm', parsed.minNetSqm, parsed.maxNetSqm)
  applyRange(filter, 'openAreaSqm', parsed.minOpenAreaSqm, parsed.maxOpenAreaSqm)
  applyRange(filter, 'coefficient', parsed.minCoefficient, parsed.maxCoefficient)
  applyRange(filter, 'floor', parsed.minFloor, parsed.maxFloor)
  applyRange(filter, 'totalFloors', parsed.minTotalFloors, parsed.maxTotalFloors)

  const listedSinceDate = safeListedSinceDate(parsed.listedSince)
  if (listedSinceDate) filter.createdAt = { $gte: listedSinceDate }

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

  /* ── Wave 11B extended fields ────────────────────────────────────────
   *
   * Without this block a query would parse perfectly and then silently lose
   * its requirement the moment searchMode switched to description/hybrid:
   * "villa with a sauna near the sea" would field-filter on `sauna` for the
   * structured search, then run the description search with the sauna
   * requirement dropped and present the results as matches.
   *
   * Copied by reference from the already-validated filter, exactly as the
   * classic fields above are — buildMongoFilter is the only thing that can
   * put these keys here, and it has already allowlisted every value.
   *
   * Truthiness is safe for every key below: each is either `true`, a
   * non-empty `{$in: [...]}`, a `{$gte/$lte}` object, a Date wrapper, or a
   * non-empty currency string. buildMongoFilter never writes a falsy value
   * into any of them — an unset field is absent, not present-and-falsy.
   */
  if (filter.sauna) hardFilter.sauna = filter.sauna
  if (filter.jacuzzi) hardFilter.jacuzzi = filter.jacuzzi
  if (filter.steamRoom) hardFilter.steamRoom = filter.steamRoom
  if (filter.turkishBath) hardFilter.turkishBath = filter.turkishBath
  if (filter.basement) hardFilter.basement = filter.basement
  if (filter.withinSite) hardFilter.withinSite = filter.withinSite
  if (filter.eligibleForCredit) hardFilter.eligibleForCredit = filter.eligibleForCredit
  if (filter.exchange) hardFilter.exchange = filter.exchange
  if (filter.hasVirtualTour) hardFilter.hasVirtualTour = filter.hasVirtualTour
  if (filter.featured) hardFilter.featured = filter.featured

  if (filter.usageStatus) hardFilter.usageStatus = filter.usageStatus
  if (filter.kitchenType) hardFilter.kitchenType = filter.kitchenType
  if (filter.heating) hardFilter.heating = filter.heating
  if (filter.titleDeedStatus) hardFilter.titleDeedStatus = filter.titleDeedStatus
  if (filter.floorLocation) hardFilter.floorLocation = filter.floorLocation
  if (filter.buildingAge) hardFilter.buildingAge = filter.buildingAge
  if (filter.rooms) hardFilter.rooms = filter.rooms
  if (filter.nearbyTransport) hardFilter.nearbyTransport = filter.nearbyTransport

  if (filter.netSqm) hardFilter.netSqm = filter.netSqm
  if (filter.openAreaSqm) hardFilter.openAreaSqm = filter.openAreaSqm
  if (filter.coefficient) hardFilter.coefficient = filter.coefficient
  if (filter.floor) hardFilter.floor = filter.floor
  if (filter.totalFloors) hardFilter.totalFloors = filter.totalFloors
  if (filter.currency) hardFilter.currency = filter.currency
  if (filter.createdAt) hardFilter.createdAt = filter.createdAt

  if (filter._id) hardFilter._id = filter._id

  return hardFilter
}
