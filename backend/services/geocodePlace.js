// backend/services/geocodePlace.js
//
// Wave 15B2 — adapted from the donor's services/geocodePlace.js.
//
// One job: turn a PUBLIC place name ("Taksim Square", "Sultanahmet", "Galata
// Tower") into a coordinate, using the free OpenStreetMap Nominatim search
// API — same keyless-OSM philosophy as services/poiSearch.js's Overpass use
// and this site's own Leaflet map. No API key, no billing, no new dependency.
//
// It knows nothing about properties, nothing about POIs and nothing about
// replies. Its coordinates are public geographic facts about landmarks, which
// is a different privacy class from a listing's withheld pin — and the caller
// is what keeps those two apart (see areaInfoAnswer.js).
//
// ── What changed from the donor ────────────────────────────────────────────
//
//   * Tagged result instead of `null` for everything. The donor collapses
//     "no such place" and "Nominatim is down" into one null, which makes it
//     impossible to answer the visitor honestly. Those are now 'none' and
//     'error'.
//   * The query is length-bounded and built with URLSearchParams rather than
//     string concatenation.
//   * Results are validated against the Istanbul box locally, not only by
//     trusting the provider's `bounded=1`. A provider-side change cannot
//     silently widen our scope.
//   * `fetchImpl` is injectable, so tests never touch live Nominatim.
//   * A failure is never cached — otherwise one outage would answer "that
//     place doesn't exist" for the next six hours.

import { ISTANBUL_BBOX } from './poiSearch.js'

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

// Nominatim's usage policy asks for a descriptive User-Agent with a real
// contact point, so OSM can reach out rather than silently block the IP.
// Contains no visitor data of any kind.
const NOMINATIM_USER_AGENT = 'VarliKent-Chatbot/1.0 (https://www.varlikent.com; info@varlikent.com)'

const REQUEST_TIMEOUT_MS = 8000

// A place name, not a paragraph. Anything longer is not a landmark and must
// not be forwarded to a shared public service. The floor matches the target
// extractor's: one character is a typo, not a place.
export const MIN_PLACE_QUERY_LENGTH = 2
export const MAX_PLACE_QUERY_LENGTH = 120

// Ask for a few so an out-of-scope or malformed top hit can be discarded
// rather than sinking the whole lookup. The donor asks for 1 and trusts it.
const RESULT_LIMIT = 5

/*
 * ── The bbox conversion, which is the easy thing to get wrong ─────────────
 *
 * services/poiSearch.js stores ISTANBUL_BBOX in OVERPASS order:
 *
 *     south, west, north, east          e.g. 40.80, 28.40, 41.30, 29.60
 *
 * Nominatim's `viewbox` is a different order entirely:
 *
 *     left, top, right, bottom  =  min_lon, max_lat, max_lon, min_lat
 *     i.e.  west, north, east, south
 *
 * Passing the Overpass string straight through would hand Nominatim
 * "40.80,28.40,41.30,29.60" read as west=40.80 north=28.40 — a box in the
 * Indian Ocean, which combined with bounded=1 would return nothing, forever,
 * silently. Hence one conversion, exported so a test can prove the ordering
 * rather than merely check that the constant is mentioned somewhere.
 */
export const toNominatimViewbox = (overpassBbox = ISTANBUL_BBOX) => {
  const parts = String(overpassBbox).split(',').map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null

  const [south, west, north, east] = parts
  return `${west},${north},${east},${south}`
}

export const ISTANBUL_BOUNDS = (() => {
  const [south, west, north, east] = ISTANBUL_BBOX.split(',').map(Number)
  return { south, west, north, east }
})()

// Defence in depth: `bounded=1` should already do this server-side, but a
// coordinate we are going to measure distances from is worth re-checking.
export const isWithinIstanbul = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= ISTANBUL_BOUNDS.south &&
  lat <= ISTANBUL_BOUNDS.north &&
  lon >= ISTANBUL_BOUNDS.west &&
  lon <= ISTANBUL_BOUNDS.east

/* ── Nominatim asks for at most one request per second ───────────────────── */

export let NOMINATIM_MIN_INTERVAL_MS = 1100

// Test-only hook, so a timing assertion does not need a slow test run.
export const __setNominatimMinIntervalForTests = (ms) => { NOMINATIM_MIN_INTERVAL_MS = ms }

/*
 * ── Why this is a queue and not a timestamp comparison ────────────────────
 *
 * The obvious version — read a shared "last request" timestamp, wait out the
 * remainder, then fetch — is not safe under concurrency, and this codebase
 * genuinely is concurrent: two visitors asking about two different landmarks
 * at the same moment are two simultaneous cache misses.
 *
 * With a bare timestamp, both callers read the same value, both compute the
 * same (often zero) wait, and both fetch together. Measured before this was
 * written: two concurrent lookups started 0 ms apart. Moving the timestamp
 * write to before the fetch does not fix it either — the read and the write
 * are still two separate steps that two callers can interleave.
 *
 * So reservation is serialised through a promise chain. Appending to the
 * chain is synchronous, which is what makes it a real mutex: by the time a
 * second caller runs, its link is already queued behind the first, and it
 * cannot observe a stale timestamp.
 *
 * ── Start-to-start, not finish-to-start ──────────────────────────────────
 *
 * `lastRequestStartedAt` is stamped when the slot is granted, and the fetch
 * itself happens OUTSIDE the chain. So the gap the policy cares about — the
 * rate at which requests leave this process — is exactly the interval, while
 * a slow eight-second response does not also delay the next caller by eight
 * seconds. Spacing from finish would be more conservative than the policy
 * asks and would make a chatbot turn noticeably slower for no benefit.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 *
 * This is PROCESS-LOCAL. It guarantees the rate for one Node process, which
 * is what the current single-instance deployment runs. It would NOT hold
 * across several independently scaled instances; that needs a shared limiter,
 * which is deliberately out of scope here.
 */
let slotChain = Promise.resolve()
let lastRequestStartedAt = 0

const reserveRequestSlot = () => {
  const slot = slotChain.then(async () => {
    const remaining = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastRequestStartedAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))

    // Stamped as the slot is granted — the next caller measures from here.
    lastRequestStartedAt = Date.now()
  })

  /*
   * The chain everyone else queues behind must never be a rejected promise,
   * or one failure would poison every future lookup for the life of the
   * process. The caller still awaits `slot` and sees any error itself.
   */
  slotChain = slot.then(() => {}, () => {})

  return slot
}

/* ── Bounded insertion-order cache ───────────────────────────────────────── */
//
// Keyed by free text a visitor typed, which is an unbounded input space — so
// unlike poiSearch.js's category cache this one needs a hard cap as well as a
// TTL, or a long-running server grows it forever.
//
// Eviction is by INSERTION order, not recency: a cache hit returns the entry
// without re-inserting it, so a Map key keeps its original position and the
// oldest-inserted key is the one dropped when the cap is reached. That is
// FIFO, not LRU — worth naming precisely, because it means a frequently asked
// landmark can still be evicted by 500 one-off names typed after it. Given a
// 6-hour TTL and a 500-entry cap that costs at most one extra lookup, so this
// stays as it is rather than growing a recency list.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 500
const cache = new Map()

const normalizeCacheKey = (placeName = '') => placeName.trim().toLowerCase().replace(/\s+/g, ' ')

const setCacheEntry = (key, value) => {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, value)
}

export const __clearGeocodeCacheForTests = () => cache.clear()

/* ── Response parsing ────────────────────────────────────────────────────── */

// display_name is a full postal-style string ("Taksim Meydanı, Gümüşsuyu,
// Beyoğlu, İstanbul, 34437, Türkiye"). Its leading segment is the place; the
// rest is address context that would read as noise in a chat reply.
const shortLabel = (displayName, fallback) => {
  const first = String(displayName || '').split(',')[0].trim()
  return first || fallback
}

const parseResults = (data, fallbackName) => {
  if (!Array.isArray(data)) return []

  const places = []

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue

    // Nominatim returns coordinates as STRINGS. Convert, then require finite —
    // Number('') is 0, which would otherwise place a landmark off West Africa.
    const lat = typeof entry.lat === 'string' || typeof entry.lat === 'number' ? Number(entry.lat) : NaN
    const lon = typeof entry.lon === 'string' || typeof entry.lon === 'number' ? Number(entry.lon) : NaN

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    if (!isWithinIstanbul(lat, lon)) continue

    places.push({ name: shortLabel(entry.display_name, fallbackName), lat, lon })
  }

  return places
}

/*
 * geocodeIstanbulPlace(placeName, { fetchImpl }) ->
 *   { status: 'resolved', place: { name, lat, lon } }
 *   { status: 'none' }     the provider answered, and had no Istanbul match
 *   { status: 'error' }    the provider could not be reached or made no sense
 *
 * Never throws. Selection is deterministic: Nominatim orders by its own
 * importance ranking, and the first result that survives validation wins —
 * the donor's behaviour, with the invalid and out-of-scope rows removed
 * first rather than trusted.
 */
export const geocodeIstanbulPlace = async (placeName = '', { fetchImpl = fetch } = {}) => {
  const trimmed = typeof placeName === 'string' ? placeName.trim() : ''

  // Nothing to look up, and nothing worth spending a shared public service's
  // request budget on.
  if (trimmed.length < MIN_PLACE_QUERY_LENGTH || trimmed.length > MAX_PLACE_QUERY_LENGTH) {
    return { status: 'none' }
  }

  const cacheKey = normalizeCacheKey(trimmed)
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result

  const viewbox = toNominatimViewbox()
  if (!viewbox) return { status: 'error' }

  try {
    await reserveRequestSlot()

    // URLSearchParams, so a place name containing &, = or # is a value rather
    // than another parameter.
    const params = new URLSearchParams({
      format: 'json',
      q: trimmed,
      limit: String(RESULT_LIMIT),
      countrycodes: 'tr',
      viewbox,
      bounded: '1',
    })

    const response = await fetchImpl(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`Nominatim responded with status ${response.status}`)

    const places = parseResults(await response.json(), trimmed)
    const result = places.length > 0 ? { status: 'resolved', place: places[0] } : { status: 'none' }

    // Only a real answer is cached. Caching a failure would make one outage
    // insist for six hours that a real place does not exist.
    setCacheEntry(cacheKey, { result, fetchedAt: Date.now() })
    return result
  } catch (err) {
    console.log('Named-place geocoding failed:', err.message)
    return { status: 'error' }
  }
}
