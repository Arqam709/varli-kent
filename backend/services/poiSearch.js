// backend/services/poiSearch.js
//
// Free geographic-proximity data source for the chatbot ("near BIM", "near
// a metro station", "near a hospital") — OpenStreetMap via the free Overpass
// API, chosen over paid Google Maps Places for exactly the reason this
// codebase already uses free Leaflet/OSM tiles for its own property map
// view (src/components/PropertyMapView.jsx): no API key, no billing.
//
// Fail-soft contract matches this codebase's existing convention EXACTLY
// (see utils/embeddings.js's getEmbedding and utils/autoTranslate.js's
// translateOne): wrap in try/catch, log with console.log, and on ANY
// failure/timeout return [] rather than throw. A POI-search hiccup must
// never break or slow down the base property search — callers treat an
// empty array as "proximity data unavailable, ignore the near-X request".

import { POI_CATEGORIES } from '../utils/poiCategories.js'

// Bounding box covering Greater Istanbul (south, west, north, east) — this
// backend's entire inventory is Istanbul-area, so a single fixed bbox keeps
// the Overpass query small and fast instead of querying all of Turkey.
// Exported so services/geocodePlace.js's free-text landmark lookup can bias/
// bound Nominatim results to the exact same Istanbul area, instead of
// maintaining a second, potentially-drifting copy of this box.
export const ISTANBUL_BBOX = '40.80,28.40,41.30,29.60'

const PRIMARY_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const FALLBACK_ENDPOINT = 'https://overpass.kumi.systems/api/interpreter'

// Overpass is noticeably slower than the 5000ms timeout this backend uses
// elsewhere for MyMemory (utils/autoTranslate.js) — 9s per endpoint attempt.
const REQUEST_TIMEOUT_MS = 9000

// In-memory cache, 24h TTL — POIs (supermarkets, metro stations, hospitals,
// etc.) essentially never move within a day, and this spares Overpass (a
// shared, free, rate-limited public service) from repeat queries for the
// same category within a single day of chatbot traffic.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map()

const SUPERMARKET_BRAND_PATTERNS = {
  bim: 'b[ıi]m',
  a101: 'a[\\s-]?101',
  sok: 'ş?ok',
}

export const buildOverpassQuery = (category, brand) => {
  const nameClause = brand && SUPERMARKET_BRAND_PATTERNS[brand]
    ? `["name"~"${SUPERMARKET_BRAND_PATTERNS[brand]}",i]`
    : ''

  const statements = category.overpassFilters
    .map((filter) => `  node${filter}${nameClause}(${ISTANBUL_BBOX});\n  way${filter}${nameClause}(${ISTANBUL_BBOX});`)
    .join('\n')

  return `[out:json][timeout:25];\n(\n${statements}\n);\nout center;`
}

// Overpass returns nodes with lat/lon directly, and ways/relations with a
// computed `center` (because we asked for `out center;`) instead — normalize
// both shapes to a flat { lat, lon, name } point.
const parseOverpassElements = (elements = []) => {
  // The provider response is untrusted: a body that is not the shape Overpass
  // documents yields no POIs rather than throwing.
  if (!Array.isArray(elements)) return []

  const pois = []

  for (const element of elements) {
    // A null/primitive entry would throw on property access and, because the
    // caller catches, would discard every good POI alongside it. Skipped
    // individually instead.
    if (!element || typeof element !== 'object') continue

    const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat
    const lon = typeof element.lon === 'number' ? element.lon : element.center?.lon

    // Number.isFinite, not typeof: NaN and Infinity are both typeof 'number'
    // and would poison every distance computed downstream.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue

    pois.push({ lat, lon, name: element.tags?.name || null })
  }

  return pois
}

// fetchImpl is injectable so the tests never touch live Overpass — the same
// seam utils/autoTranslate.js already threads through for that reason.
const runOverpassQuery = async (query, endpoint, fetchImpl = fetch) => {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Overpass responded with status ${response.status}`)
  }

  const data = await response.json()
  return parseOverpassElements(data?.elements)
}

// fetchPoisForCategory({ categoryId, brand }) -> Promise<Array<{lat, lon, name}>>
//
// Never throws. On any failure (Overpass down, rate-limited, timed out,
// unknown category) resolves to [] so callers can degrade silently to
// "ignore the near-X request, return normal search results".
export const fetchPoisForCategory = async ({ categoryId, brand = null, fetchImpl = fetch } = {}) => {
  const category = POI_CATEGORIES.find((entry) => entry.id === categoryId)
  if (!category) return []

  const cacheKey = `${categoryId}:${brand || ''}`
  const cached = cache.get(cacheKey)

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pois
  }

  try {
    const query = buildOverpassQuery(category, brand)
    let pois

    try {
      pois = await runOverpassQuery(query, PRIMARY_ENDPOINT, fetchImpl)
    } catch (primaryErr) {
      console.log('Overpass primary endpoint failed, trying fallback mirror:', primaryErr.message)
      pois = await runOverpassQuery(query, FALLBACK_ENDPOINT, fetchImpl)
    }

    cache.set(cacheKey, { pois, fetchedAt: Date.now() })
    return pois
  } catch (err) {
    console.log('POI search failed (Overpass unreachable, both endpoints):', err.message)
    return []
  }
}

// Exported for tests only — lets a test script clear the module-level cache
// between cases instead of needing a fresh process per case.
export const __clearPoiCacheForTests = () => cache.clear()
