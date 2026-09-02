// backend/services/areaInfoAnswer.js
//
// Wave 15B — "what schools are near Marina Residence?"
//
// Adapted from the donor's utils/areaInfoAnswer.js (its "stage 2"), built on
// the same stage-1 pieces: utils/poiCategories.js's deterministic category
// registry, services/poiSearch.js's Overpass lookup, utils/geoDistance.js's
// haversine ranking — all three direct copies of the donor's.
//
// ── The one substantive divergence: which coordinate we rank from ──────────
//
// The donor ranks distances from the property's STORED EXACT coordinate. It
// can, because it has no location-privacy model. CURRENT does: Wave 9 splits
// a listing's location into what an editor may see and what the public may
// see, and routes/properties.js's `publicLocation` is the single definition
// of that line. For a listing an owner marked approximate, publicLocation
// returns NO coordinate at all — only { isApproximate: true, approxRadiusKm }.
//
// So this module ranks from `publicLocation(...)`, never from the raw stored
// value, and a listing with no publishable coordinate simply gets the "not
// enough location information" answer instead of a POI answer. Publishing a
// set of precise distances to known landmarks is publishing the coordinate —
// three of them trilaterate it — so a listing whose coordinate is withheld
// must not get distances either.
//
// That reuses CURRENT's one privacy definition rather than inventing a second
// one (no jitter, no rounding, no fixed offset invented here).
//
// ── What reaches the network ──────────────────────────────────────────────
//
// Nothing about the property. The Overpass query is by CATEGORY over a fixed
// Istanbul bounding box — the donor's design, kept — so the provider is asked
// "where are the schools in Istanbul", never "what is near this listing".
// Ranking happens locally. No property coordinate, id or title is ever sent
// to a third party.
//
// ── Answer generation ─────────────────────────────────────────────────────
//
// The donor phrases its answer with a grounded Gemini call and falls back to
// a deterministic template. CURRENT keeps only the deterministic path: the
// facts are already computed, chatReplyRenderer is where reply text belongs,
// and removing the model call removes the last surface on which a place name
// or a distance could be invented.
//
// Fail-soft throughout: this never throws to its caller.

import Property from '../models/Property.js'
import { publicLocation } from '../routes/properties.js'
import { resolvePropertyByPhrase, PUBLIC_STATUS } from './propertyNameResolver.js'
import { isShowMoreRequest } from './chatConversationMemory.js'
import { fetchPoisForCategory as defaultFetchPoisForCategory } from './poiSearch.js'
import { resolvePoiCategory, getCategoryRadiusKm } from '../utils/poiCategories.js'
import { nearestNWithinRadius } from '../utils/geoDistance.js'

// The donor returns its three nearest matches; kept.
const MAX_RESULTS = 3

/*
 * Intent: is this a question ABOUT nearby places, or a search FOR properties?
 *
 * The distinction the whole feature turns on:
 *
 *   "Find apartments near schools"        → the thing sought is a PROPERTY.
 *                                           utils/lifestyleConcepts.js already
 *                                           handles this; it must keep doing so.
 *   "What schools are near Marina Residence?" → the thing sought is a SCHOOL,
 *                                           around a named target.
 *
 * So the patterns below require an interrogative shape (what/which/are there
 * … near X, what's near X, and the Turkish/Arabic equivalents). A message
 * that asks to find/show LISTINGS never matches, because it is not a question
 * about what exists around a place.
 */

// Explicitly asking for listings — never an area-info question, whatever else
// the sentence contains.
const PROPERTY_SEARCH_VERBS = /\b(find|show|search|look(ing)?\s+for|i\s+want|i\s+need|do\s+you\s+have)\b/i
const PROPERTY_NOUNS = /\b(apartment|apartments|flat|flats|villa|villas|house|houses|penthouse|property|properties|listing|listings|daire|ev|villa|konut|shqqa|شقة|شقق|فيلا|عقار)\b/i

/*
 * Target extraction. `[1]` is the phrase naming the place the visitor is
 * asking around.
 *
 * English handles both orders ("what is near X" and "what schools are near
 * X"). Turkish puts the target first ("X yakınında/yakınındaki … var mı"),
 * Arabic uses "قريب من X" / "بالقرب من X" — the same three phrasings the
 * donor's own near-place patterns cover.
 */
const TARGET_PATTERNS = [
  // English
  /\b(?:what|which|are\s+there|is\s+there|any)\b[^?]*?\bnear(?:by)?\s+(?:to\s+)?(.+?)\s*\??$/i,
  /\bwhat(?:'?s| is)\s+(?:near|nearby|around|close\s+to)\s+(.+?)\s*\??$/i,
  /\bclose\s+to\s+(.+?)\s*\??$/i,
  // Turkish — "X yakınında ... var mı", "X'e yakın ... var mı"
  // The dative suffix is only accepted after an apostrophe ("Residence'e
  // yakın"); without that guard the optional suffix swallows the final
  // letter of the target itself. "yakın" must also follow whitespace.
  /^(.+?)(?:['’](?:e|a|ye|ya|ne|na))?\s+yakın(?:ında|ındaki|larda)?\b/i,
  // Arabic
  /(?:بالقرب\s+من|قريب\s+من|قرب)\s+(.+?)\s*\؟?$/,
]

const TRAILING_NOISE = /[\s.,!?;:'"«»؟]+$/

// Words that are part of the question, not part of the target name. Trimmed
// from the front of a captured phrase so "…near the Marina Residence" and
// "…near Marina Residence" resolve alike.
const LEADING_FILLER = /^(?:the|a|an|this|that|our|my)\s+/i

export const extractAreaInfoTarget = (message = '') => {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return null

  for (const pattern of TARGET_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue

    const phrase = (match[1] || '').replace(TRAILING_NOISE, '').replace(LEADING_FILLER, '').trim()
    if (phrase.length >= 2) return phrase
  }

  return null
}

/*
 * detectAreaInfoQuestion(message) -> { categoryId, brand, targetPhrase } | null
 *
 * All three must be present. A category with no target is an ordinary
 * lifestyle search ("near schools"); a target with no category is 15A's
 * "tell me about X". Only the pair is an area-info question.
 */
export const detectAreaInfoQuestion = (message = '') => {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return null

  // Pagination is never a question about a place.
  if (isShowMoreRequest(text)) return null

  // "Find apartments near schools" — the object sought is a listing.
  if (PROPERTY_SEARCH_VERBS.test(text) && PROPERTY_NOUNS.test(text)) return null

  const targetPhrase = extractAreaInfoTarget(text)
  if (!targetPhrase) return null

  // Category is resolved from the QUESTION, with the target removed — so a
  // listing called "Marina Park Residence" cannot make every question about
  // it look like a question about parks.
  const questionWithoutTarget = text.replace(targetPhrase, ' ')
  const category = resolvePoiCategory(questionWithoutTarget)

  // A bare "what's near X" resolves no category. The donor answers that by
  // asking which kind of place; so does renderAreaInfoNoCategory.
  if (!category?.categoryId) return { categoryId: null, brand: null, targetPhrase }

  return { categoryId: category.categoryId, brand: category.brand || null, targetPhrase }
}

/*
 * buildAreaInfoAnswer -> a tagged result; routes/chat.js renders it.
 *
 *   { status: 'not-an-area-question' }            not our turn
 *   { status: 'no-category', targetPhrase }       "what's near X" — which kind?
 *   { status: 'ambiguous', candidates, phrase }   several listings match
 *   { status: 'no-property', phrase }             no listing by that name
 *   { status: 'lookup-error', phrase }            the listing lookup failed
 *   { status: 'no-location', title }              nothing publishable to rank from
 *   { status: 'provider-error', ... }             POI provider unreachable
 *   { status: 'no-results', ... }                 provider fine, nothing in range
 *   { status: 'results', title, categoryId, matches, approximate }
 *
 * `matches` carry name and distance only — never a coordinate.
 */
export const buildAreaInfoAnswer = async ({
  message = '',
  PropertyModel = Property,
  fetchPoisForCategoryFn = defaultFetchPoisForCategory,
} = {}) => {
  const intent = detectAreaInfoQuestion(message)
  if (!intent) return { status: 'not-an-area-question' }

  if (!intent.categoryId) {
    return { status: 'no-category', targetPhrase: intent.targetPhrase }
  }

  // ── 1. Resolve the target against our own inventory ─────────────────────
  // 15A's resolver, reused whole: same escaping, same Available-only filter,
  // same public projection, same ambiguity rule.
  const resolution = await resolvePropertyByPhrase(intent.targetPhrase, PropertyModel)

  if (resolution.status === 'ambiguous') {
    // No POI call: we do not know which listing was meant, and searching
    // around a guess would attach real distances to the wrong property.
    return { status: 'ambiguous', candidates: resolution.candidates, phrase: intent.targetPhrase }
  }
  if (resolution.status === 'error') return { status: 'lookup-error', phrase: intent.targetPhrase }
  if (resolution.status !== 'resolved') return { status: 'no-property', phrase: intent.targetPhrase }

  const property = resolution.property

  /*
   * ── 2. The privacy boundary ───────────────────────────────────────────
   *
   * `property` came back through PROPERTY_SELECT, which is an INCLUSION
   * projection that does not name `location` — so MongoDB does not return it
   * and `property.location` is genuinely undefined here. That is correct and
   * deliberate: the public projection must never carry a coordinate, because
   * whatever it carries can end up in a chat response.
   *
   * So the coordinate is read by its own explicit, single-purpose query
   * below, keyed by the id we just resolved and projected down to `location`
   * alone. Consequences worth stating:
   *
   *   - resolvePropertyByPhrase's contract is untouched. It cannot return a
   *     location to anyone, including a future caller who forgets that it
   *     must not, so 15A's named-property responses stay location-free by
   *     construction rather than by discipline.
   *   - the only code that ever sees a stored coordinate is the four lines
   *     below, and the very next thing that happens to it is publicLocation.
   *   - the cost is one indexed single-document read, paid only after a real
   *     nearby question has already resolved a real listing. An ordinary
   *     message, a 15A title question, an ambiguous target and an unknown
   *     name all pay nothing.
   *
   * Everything after this block may only ever see `center`.
   */
  let storedLocation = null

  try {
    /*
     * The eligibility rule is re-applied here, not inherited from the first
     * query.
     *
     * Between resolving the title and reading the coordinate there are two
     * round trips, and a listing can be sold, rented or unpublished in
     * between. Keying this read on `_id` alone would happily return the
     * location of a listing that is no longer public, and 15B would answer
     * with real distances for it. Matching on `_id` AND status closes that
     * window in the database rather than in a timing assumption — the same
     * PUBLIC_STATUS the resolver used, imported rather than restated so the
     * two cannot drift apart.
     */
    const locationOnly = await PropertyModel
      .findOne({ _id: property._id, status: PUBLIC_STATUS })
      .select('location')

    /*
     * No currently-public document. Either it was deleted or it stopped being
     * Available since the first read. Answered exactly as a name we do not
     * carry — deliberately the same reply, so the response cannot be used to
     * learn that a non-public record exists internally.
     */
    if (!locationOnly) return { status: 'no-property', phrase: intent.targetPhrase }

    storedLocation = locationOnly.location ?? null
  } catch {
    // A failed read is not an absent coordinate, and not an absent listing.
    // Saying either would be a false statement about our own data when the
    // truth is that the query did not run.
    return { status: 'lookup-error', phrase: intent.targetPhrase }
  }

  // publicLocation remains the single authority on whether a stored
  // coordinate may be published — approximate listings get no coordinate back
  // from it, and therefore get no distances.
  const safeLocation = publicLocation(storedLocation)
  const center =
    safeLocation && Number.isFinite(safeLocation.lat) && Number.isFinite(safeLocation.lng)
      ? { lat: safeLocation.lat, lng: safeLocation.lng }
      : null

  if (!center) {
    return { status: 'no-location', title: property.title }
  }

  // ── 3. POIs for the category, from the provider ─────────────────────────
  let pois = []
  let providerFailed = false

  try {
    pois = await fetchPoisForCategoryFn({ categoryId: intent.categoryId, brand: intent.brand })
  } catch {
    providerFailed = true
  }

  /*
   * fetchPoisForCategory is fail-soft and returns [] for both "Overpass is
   * down" and "this category genuinely has nothing". Those must not read the
   * same to a visitor, so an empty list is reported as a provider problem
   * rather than as a confident "there are none" — the honest reading when we
   * cannot tell the two apart, and Istanbul has at least one of every
   * category in this registry.
   */
  if (providerFailed || !Array.isArray(pois) || pois.length === 0) {
    return { status: 'provider-error', title: property.title, categoryId: intent.categoryId }
  }

  // ── 4. Rank locally, by real distance ───────────────────────────────────
  const radiusKm = getCategoryRadiusKm(intent.categoryId)
  let ranked = nearestNWithinRadius(center.lat, center.lng, pois, radiusKm, MAX_RESULTS)

  if (ranked.length === 0) {
    return {
      status: 'no-results',
      title: property.title,
      categoryId: intent.categoryId,
      radiusKm,
    }
  }

  return {
    status: 'results',
    title: property.title,
    categoryId: intent.categoryId,
    // Name and distance only. POI coordinates were needed to compute the
    // distance and are dropped here, so nothing the frontend does not need
    // reaches the wire.
    matches: ranked.map(({ poi, distanceKm }) => ({
      // null when OSM has no name tag; the renderer substitutes the category
      // label, as the donor does, rather than printing "Unnamed place".
      name: poi?.name || null,
      distanceKm,
    })),
  }
}

/*
 * A note on what is NOT in that result: there is no `approximate` flag,
 * deliberately. publicLocation returns EITHER an exact coordinate with
 * isApproximate:false, OR no coordinate at all with isApproximate:true — so by
 * the time the results branch is reached the coordinate is always the
 * published exact one and such a flag would be dead. Distances are still
 * reported as "about N km": they are straight-line to a mapped point, not a
 * walking route.
 */
