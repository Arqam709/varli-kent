// backend/utils/geoDistance.js
//
// Pure geographic distance helpers for chatbot proximity search. No
// dependencies, no DB, no network — a linear scan over a POI list is plenty
// fast at the scale this backend deals with (low hundreds to a few
// thousand OpenStreetMap points per category per search), so this
// deliberately does not add a k-d tree/spatial-index dependency.

const EARTH_RADIUS_KM = 6371

const toRadians = (degrees) => (degrees * Math.PI) / 180

// Standard haversine great-circle distance between two lat/lng points, in
// kilometers.
export const haversineKm = (lat1, lon1, lat2, lon2) => {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const rLat1 = toRadians(lat1)
  const rLat2 = toRadians(lat2)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_KM * c
}

// Nearest POI to a given property coordinate from a list of
// { lat, lon, name, ... } points. Returns { distanceKm, poi } for the
// closest one, or null when the list is empty/invalid. Linear scan — see
// module comment above for why that's fine at this data scale.
export const nearestPoiDistanceKm = (propertyLat, propertyLng, pois = []) => {
  if (!Array.isArray(pois) || pois.length === 0) return null
  if (typeof propertyLat !== 'number' || typeof propertyLng !== 'number') return null

  let nearest = null
  let nearestDistance = Infinity

  for (const poi of pois) {
    if (typeof poi?.lat !== 'number' || typeof poi?.lon !== 'number') continue

    const distanceKm = haversineKm(propertyLat, propertyLng, poi.lat, poi.lon)

    if (distanceKm < nearestDistance) {
      nearestDistance = distanceKm
      nearest = poi
    }
  }

  if (!nearest) return null

  return { distanceKm: nearestDistance, poi: nearest }
}

// nearestNWithinRadius(lat, lon, pois, radiusKm, n) -> Array<{ distanceKm, poi }>
//
// Maps every POI to its real haversine distance from (lat, lon), filters to
// only those within radiusKm (inclusive), sorts ascending by distance, and
// returns the first n. Pass radiusKm = Infinity for an unbounded re-filter
// (still sorted/limited by n) — used by callers that already fetched the
// whole category's POI list and want a "nothing within the normal radius,
// but here's the single nearest one anyway" fallback without a second
// network call. Reuses haversineKm — no duplicated distance math.
export const nearestNWithinRadius = (lat, lon, pois = [], radiusKm = Infinity, n = 1) => {
  if (!Array.isArray(pois) || pois.length === 0) return []
  if (typeof lat !== 'number' || typeof lon !== 'number') return []

  const withDistance = []

  for (const poi of pois) {
    if (typeof poi?.lat !== 'number' || typeof poi?.lon !== 'number') continue

    const distanceKm = haversineKm(lat, lon, poi.lat, poi.lon)
    if (distanceKm <= radiusKm) {
      withDistance.push({ distanceKm, poi })
    }
  }

  withDistance.sort((a, b) => a.distanceKm - b.distanceKm)

  return withDistance.slice(0, n)
}
