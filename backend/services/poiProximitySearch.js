// backend/services/poiProximitySearch.js
//
// Wave 17 — "find apartments near a metro station".
//
// The third and last of the three nearby operations, and the only one that
// searches INVENTORY:
//
//   15B   what POIs are near ONE property   -> areaInfoAnswer
//   15B2  what POIs are near ONE place      -> areaInfoAnswer + geocodePlace
//   17    which PROPERTIES are near a POI   -> this file
//
// Adapted from the donor's services/chatPropertySearch.js (resolveNearPoi,
// extractNamedPlaceQuery, resolveNamedPlaceNearPoi, applyPoiProximity,
// POI_PROXIMITY_THRESHOLD_KM). Kept in its own module rather than swelling
// chatPropertySearch.js, which is already the busiest file in the pipeline.
//
// ── Two things the donor gets wrong, and why this differs ──────────────────
//
// 1. THE DONOR FEATURE DOES NOT ACTUALLY WORK.
//
//    applyPoiProximity reads `property.location`, but every property reaching
//    it came through `.select(PROPERTY_SELECT)` — an inclusion projection
//    that does not name `location`. So `location` is always undefined, every
//    property falls into the unranked bucket, and nothing is ever filtered or
//    ordered. Its own scripts/testGeoProximity.js passes only because it
//    states it "deliberately never touches Property.find()" and calls the
//    function with hand-built objects that carry a location the real query
//    never returns. This is the same projection bug Wave 15B hit; the fix is
//    the same shape — read the coordinate through its own explicit query.
//
// 2. THE DONOR RANKS FROM PRIVATE COORDINATES.
//
//    It computes a distance from a listing whose location is marked
//    approximate, tags it confidence:'approximate', and sorts it into its own
//    bucket. In the donor that is defensible: its stored coordinate for such
//    a listing IS a fuzzed point. In CURRENT it is not — Wave 9 stores the
//    REAL coordinate and has publicLocation withhold it. Ranking from it, or
//    publishing a distance derived from it, leaks the exact pin: a handful of
//    distances to known landmarks trilaterates it.
//
//    So there is no approximate bucket here. A listing is either publicly
//    located (ranked, and may carry a proximity claim) or it is not (kept,
//    never ranked, never claimed). Two buckets, one rule, and the rule is
//    publicLocation's.

import Property from '../models/Property.js'
import { publicLocation } from '../routes/properties.js'
import { PUBLIC_STATUS } from './propertyNameResolver.js'
import { fetchPoisForCategory as defaultFetchPoisForCategory } from './poiSearch.js'
import { geocodeIstanbulPlace as defaultGeocodePlace } from './geocodePlace.js'
import { resolvePoiCategory, isValidPoiCategoryId } from '../utils/poiCategories.js'
import { nearestPoiDistanceKm } from '../utils/geoDistance.js'

/*
 * The donor's flat 4 km, transplanted unchanged and deliberately NOT the
 * per-category radii Wave 15B uses. They answer different questions:
 *
 *   15B  "what is near this listing?"      — a pharmacy at 1.5km, an airport
 *                                            at 8km; what counts as "nearby"
 *                                            depends on the errand.
 *   17   "does this listing satisfy        — one generous radius, so a real
 *         'near a metro station'?"           match is never dropped for being
 *                                            a short drive rather than a walk.
 */
export const POI_PROXIMITY_THRESHOLD_KM = 4

// How many extra candidates the widened pool may add. The donor's 300.
const WIDE_POOL_LIMIT = 300

/*
 * resolveNearPoi(parsed, message) -> { categoryId, brand } | null
 *
 * Deterministic first, exactly as the donor has it: the category registry is
 * consulted against the raw text, and Gemini's `parsed.nearPoi` is only ever
 * a fallback — so this keeps working when the model fails entirely. A
 * model-supplied category is validated against the registry before use, so it
 * can never introduce a category the Overpass allowlist does not contain.
 */
export const resolveNearPoi = (parsed = {}, message = '') => {
  const deterministic = resolvePoiCategory(typeof message === 'string' ? message : '')
  if (deterministic?.categoryId) return deterministic

  const secondary = parsed?.nearPoi
  if (secondary?.categoryId && isValidPoiCategoryId(secondary.categoryId)) {
    return { categoryId: secondary.categoryId, brand: secondary.brand || null }
  }

  return null
}

/*
 * extractNamedPlaceQuery(text) -> phrase | null
 *
 * "near X" / "close to X" / "X yakın" / "قريب من X". Only the phrase after
 * (or before, in Turkish) the trigger word.
 *
 * The donor has a fourth pattern this deliberately drops: if no trigger word
 * appears at all and the message is six words or fewer, it geocodes the WHOLE
 * message. That would send "Find apartments in Kadıköy" — an ordinary
 * district search — to Nominatim and then filter the results by distance to
 * whatever came back. An explicit proximity trigger is required here instead,
 * which is also what keeps ordinary searches at zero provider calls.
 */
const NAMED_PLACE_PATTERNS = [
  /\b(?:near|nearby|close\s+to|next\s+to|around)\s+(.+)$/i,
  /(?:بالقرب\s+من|قريب\s+من|قرب)\s+(.+)$/,
  /^(.+?)(?:['’](?:e|a|ye|ya|ne|na))?\s+yakın(?:ında|ındaki|larda)?\b/i,
]

// Clause punctuation ends the place name; the donor splits on the same set.
const CLAUSE_END = /[,.?!;:؟]/
const LEADING_FILLER = /^(?:a|an|the|any|some|bir)\s+/i

export const extractNamedPlaceQuery = (text = '') => {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return null

  for (const pattern of NAMED_PLACE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (!match) continue

    const phrase = (match[1] || '').split(CLAUSE_END)[0].replace(LEADING_FILLER, '').trim()
    if (phrase.length >= 2) return phrase
  }

  return null
}

/*
 * resolveNamedPlaceNearPoi -> { categoryId: 'named_place', lat, lon, placeName } | null
 *
 * Tried only when no registry category matched. Uses CURRENT's Wave 15B2
 * geocoder rather than the donor's own — that one is already Istanbul-bounded,
 * Türkiye-restricted, length-bounded, response-validated, timeout-bounded,
 * cached and behind a concurrency-safe 1100 ms limiter. Bypassing it with a
 * second raw client would undo all of that.
 *
 * Fail-soft: any failure resolves to null, and a null here is exactly as
 * inert as no proximity request at all.
 */
export const resolveNamedPlaceNearPoi = async (message = '', geocodePlaceFn = defaultGeocodePlace) => {
  const placeQuery = extractNamedPlaceQuery(message)
  if (!placeQuery) return null

  let geocoded = null
  try {
    geocoded = await geocodePlaceFn(placeQuery)
  } catch {
    return null
  }

  if (geocoded?.status !== 'resolved' || !geocoded.place) return null

  const { lat, lon, name } = geocoded.place
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  return { categoryId: 'named_place', brand: null, placeName: name || placeQuery, lat, lon }
}

/*
 * The one place a stored coordinate is read.
 *
 * ONE bounded batch query for every candidate at once — not a query per
 * property. The ids come from documents the search already returned, never
 * from user input, so the `$in` cannot be steered. `status` is re-checked for
 * the same reason Wave 15B re-checks it: a listing can stop being public
 * between the search and this read, and a sold listing must not be ranked.
 *
 * Returns a Map of id -> PUBLIC coordinate. A listing whose coordinate
 * publicLocation withholds is simply absent from the map, which is what makes
 * "no public coordinate" and "not near anything" impossible to confuse.
 */
export const loadPublicLocationState = async (propertyIds = [], PropertyModel = Property) => {
  const eligibleIds = new Set()
  const coordinates = new Map()

  if (!Array.isArray(propertyIds) || propertyIds.length === 0) return { eligibleIds, coordinates }

  const rows = await PropertyModel
    .find({ _id: { $in: propertyIds }, status: PUBLIC_STATUS })
    .select('_id location')

  for (const row of rows || []) {
    const id = String(row._id)

    /*
     * Returned by a query filtered on PUBLIC_STATUS, so this listing is
     * public RIGHT NOW — whatever its location situation. That is the half
     * the earlier version threw away.
     */
    eligibleIds.add(id)

    const safe = publicLocation(row?.location)

    // publicLocation returns { isApproximate: true } with NO coordinate for a
    // withheld listing. Only a published pair gets in here.
    if (safe && Number.isFinite(safe.lat) && Number.isFinite(safe.lng)) {
      coordinates.set(id, { lat: safe.lat, lng: safe.lng })
    }
  }

  return { eligibleIds, coordinates }
}

/*
 * applyPoiProximity — the post-filter and re-rank.
 *
 * Buckets, following the donor minus its approximate one:
 *
 *   ranked     still public, coordinate published, within 4 km — sorted
 *              nearest first, carrying the fact the reply may cite
 *   dropped    still public, coordinate published, confidently beyond 4 km
 *   dropped    NO LONGER PUBLIC — sold, rented or deleted since the search
 *              returned it. A public reply must reflect the inventory as it
 *              is now, not as it was two round trips ago.
 *   unverified still public, no publishable coordinate — kept, in original
 *              order, after the ranked ones, NEVER described as near anything
 *
 * The two dropped cases and the unverified one are why `eligibleIds` exists
 * separately from `coordinates`. An id missing from `coordinates` alone is
 * ambiguous — it can mean "public but private pin" or "no longer public" —
 * and those must not share an outcome.
 *
 * Fail-soft: no POIs, a provider failure, or no coordinates at all returns
 * the candidate list untouched rather than emptying a search.
 */
export const applyPoiProximity = async ({
  properties = [],
  nearPoi,
  eligibleIds,
  coordinates,
  fetchPoisForCategoryFn = defaultFetchPoisForCategory,
}) => {
  if (!nearPoi?.categoryId) return { properties, verified: false, poisAvailable: false }

  let pois = []

  if (nearPoi.categoryId === 'named_place') {
    // A geocoded landmark is a one-item POI list — the same ranking path, not
    // a parallel one. The donor's idea, kept.
    pois = Number.isFinite(nearPoi.lat) && Number.isFinite(nearPoi.lon)
      ? [{ lat: nearPoi.lat, lon: nearPoi.lon, name: nearPoi.placeName || null }]
      : []
  } else {
    try {
      pois = await fetchPoisForCategoryFn({ categoryId: nearPoi.categoryId, brand: nearPoi.brand || null })
    } catch {
      pois = []
    }
  }

  // Provider down, rate-limited, or genuinely empty. Degrade to the ordinary
  // result set rather than filtering against nothing — but report that the
  // requirement went unverified, so the reply cannot imply otherwise.
  if (!Array.isArray(pois) || pois.length === 0) {
    return { properties, verified: false, poisAvailable: false }
  }

  const ranked = []
  const unverified = []

  for (const property of properties) {
    const plain = typeof property?.toObject === 'function' ? property.toObject() : property
    const id = String(plain?._id)

    /*
     * Public eligibility as of the location read, not as of the search. A
     * listing sold, rented or deleted in between is gone — it must not reach
     * a visitor just because a query a moment earlier still had it.
     */
    if (eligibleIds && !eligibleIds.has(id)) continue

    const center = coordinates?.get(id)

    if (!center) {
      // Still public, but nothing publishable to measure from: never ranked,
      // never claimed, never dropped.
      unverified.push(plain)
      continue
    }

    const nearest = nearestPoiDistanceKm(center.lat, center.lng, pois)

    if (nearest && nearest.distanceKm <= POI_PROXIMITY_THRESHOLD_KM) {
      ranked.push({
        ...plain,
        poiProximity: {
          distanceKm: nearest.distanceKm,
          poiName: nearest.poi?.name || null,
          categoryId: nearPoi.categoryId,
          placeName: nearPoi.placeName || null,
        },
      })
    }
    // Public coordinate, beyond the threshold: dropped. The only bucket we
    // can honestly exclude, because it is the only one we actually measured.
  }

  ranked.sort((a, b) => a.poiProximity.distanceKm - b.poiProximity.distanceKm)

  return { properties: [...ranked, ...unverified], verified: true, poisAvailable: true, matched: ranked.length }
}

/*
 * runProximityPass — the whole stage, called once at the end of the search.
 *
 * Returns the candidate list untouched, with `applied: false`, whenever the
 * visitor did not ask to be near anything — which is almost every search, and
 * costs exactly nothing: no provider call, no geocode, no location read.
 */
export const runProximityPass = async ({
  properties = [],
  parsed = {},
  message = '',
  filter = {},
  mustHaveFilter = {},
  PropertyModel = Property,
  fetchPoisForCategoryFn = defaultFetchPoisForCategory,
  geocodePlaceFn = defaultGeocodePlace,
  propertySelect,
}) => {
  let nearPoi = resolveNearPoi(parsed, message)

  if (!nearPoi) {
    nearPoi = await resolveNamedPlaceNearPoi(message, geocodePlaceFn)
  }

  if (!nearPoi) return { properties, applied: false, verified: false, nearPoi: null }

  /*
   * Widen the pool, the donor's step and its reasoning: the waterfall above
   * chose these candidates by text and semantic relevance, which has nothing
   * to do with distance. The listing actually closest to a metro station
   * usually never mentions the metro at all, so without this it is never even
   * considered. Additive only — it cannot remove what the waterfall found.
   *
   * District is dropped from the widened filter for the donor's reason: it is
   * often Gemini's guess derived from the very landmark being searched
   * around, and the point of "near X" is what is genuinely closest, not what
   * is tagged with a particular district string. Every other hard constraint
   * — listingType, propertyType, budget, mustHave — still applies.
   */
  let pool = properties

  try {
    const { district, districts, ...widePoolFilter } = filter
    const widePool = await PropertyModel
      .find({ ...widePoolFilter, ...mustHaveFilter, status: PUBLIC_STATUS })
      .select(propertySelect)
      .limit(WIDE_POOL_LIMIT)

    const seen = new Set(properties.map((p) => String(p._id)))
    const extra = (widePool || [])
      .map((doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : doc))
      .filter((doc) => !seen.has(String(doc._id)))

    pool = [...properties, ...extra]
  } catch {
    // Widening is an optimisation, not a requirement.
    pool = properties
  }

  /*
   * The location read is the one database call this stage adds, and the base
   * search has already succeeded by the time it runs. A hiccup here must
   * degrade the proximity requirement, not fail a chat turn that otherwise
   * had an answer — the same fail-soft contract every other step in this
   * pipeline keeps.
   *
   * Returning early also means NO provider call: with no coordinates there is
   * nothing to rank, so an Overpass request would be spent for nothing.
   */
  let locationState = null

  try {
    locationState = await loadPublicLocationState(pool.map((p) => p._id), PropertyModel)
  } catch {
    return { properties, applied: true, verified: false, nearPoi }
  }

  const result = await applyPoiProximity({
    properties: pool,
    nearPoi,
    eligibleIds: locationState.eligibleIds,
    coordinates: locationState.coordinates,
    fetchPoisForCategoryFn,
  })

  /*
   * If nothing could be verified, hand back the ORIGINAL candidates rather
   * than the widened pool — the widening only existed to give proximity
   * ranking a fair chance, and without ranking it is just an arbitrary 300
   * extra listings the visitor did not ask for.
   */
  if (!result.verified) {
    return { properties, applied: true, verified: false, nearPoi }
  }

  return {
    properties: result.properties,
    applied: true,
    verified: true,
    matched: result.matched,
    nearPoi,
  }
}
