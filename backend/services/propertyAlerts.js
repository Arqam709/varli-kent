// Shared logic for saved property alerts.
//
// Both the validation and the matching rule live here so the create route,
// the update route and the notifications feed cannot drift apart. There is
// exactly ONE definition of "does this property match this alert".

const LISTING_TYPES = ['Sale', 'Rent']

const PROPERTY_TYPES = [
  'Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office',
  'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm',
]

// Guards against absurd input without pretending to know the market.
const MAX_PRICE = 1_000_000_000_000
const MAX_BEDS = 50
const MAX_DISTRICT_LENGTH = 100

const isNil = (v) => v === undefined || v === null || v === ''

// Parses an optional non-negative number. Returns { ok, value } so callers can
// tell "absent" (undefined) from "invalid".
const parseOptionalNumber = (raw, { max }) => {
  if (isNil(raw)) return { ok: true, value: undefined }

  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false }
  if (n < 0) return { ok: false }
  if (n > max) return { ok: false }

  return { ok: true, value: n }
}

// Validates and normalises an alert payload from the client.
//
// Returns { errors: string[], value } — `value` contains ONLY the whitelisted
// criteria fields, so `user`, `_id` or anything else a client might send is
// dropped rather than trusted.
export const validateAlertPayload = (body = {}) => {
  const errors = []
  const value = {}

  if (!isNil(body.listingType)) {
    if (!LISTING_TYPES.includes(body.listingType)) {
      errors.push('listingType must be Sale or Rent')
    } else {
      value.listingType = body.listingType
    }
  }

  if (!isNil(body.propertyType)) {
    if (!PROPERTY_TYPES.includes(body.propertyType)) {
      errors.push('propertyType is not a recognised property type')
    } else {
      value.propertyType = body.propertyType
    }
  }

  if (!isNil(body.district)) {
    const district = String(body.district).trim()
    if (district.length === 0 || district.length > MAX_DISTRICT_LENGTH) {
      errors.push('district is not valid')
    } else {
      value.district = district
    }
  }

  const min = parseOptionalNumber(body.minPrice, { max: MAX_PRICE })
  if (!min.ok) errors.push('minPrice must be a non-negative number')
  else if (min.value !== undefined) value.minPrice = min.value

  const max = parseOptionalNumber(body.maxPrice, { max: MAX_PRICE })
  if (!max.ok) errors.push('maxPrice must be a non-negative number')
  else if (max.value !== undefined) value.maxPrice = max.value

  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    errors.push('minPrice cannot be greater than maxPrice')
  }

  const beds = parseOptionalNumber(body.minBeds, { max: MAX_BEDS })
  if (!beds.ok) errors.push('minBeds must be a non-negative number')
  else if (beds.value !== undefined) {
    if (!Number.isInteger(beds.value)) errors.push('minBeds must be a whole number')
    else value.minBeds = beds.value
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') errors.push('active must be true or false')
    else value.active = body.active
  }

  // An alert with no criteria matches every property, which is just the
  // All New feed wearing a different hat. Rejecting it keeps Matches
  // meaningful.
  const criteriaKeys = ['listingType', 'propertyType', 'district', 'minPrice', 'maxPrice', 'minBeds']
  if (!criteriaKeys.some((key) => value[key] !== undefined)) {
    errors.push('An alert needs at least one filter')
  }

  return { errors, value }
}

// THE matching rule. A property matches only if it satisfies every criterion
// the alert actually specifies; absent criteria are ignored rather than
// treated as a requirement.
//
// Runs in memory against properties the notifications route has already
// fetched, so adding alerts costs no extra database queries.
export const propertyMatchesAlert = (property, alert) => {
  if (!property || !alert) return false

  if (alert.listingType && property.listingType !== alert.listingType) return false

  // Exact, case-sensitive — the same comparison GET /api/properties makes.
  if (alert.district && property.district !== alert.district) return false

  if (alert.propertyType && property.propertyType !== alert.propertyType) return false

  const price = Number(property.price)
  if (alert.minPrice !== undefined && alert.minPrice !== null) {
    if (!Number.isFinite(price) || price < alert.minPrice) return false
  }
  if (alert.maxPrice !== undefined && alert.maxPrice !== null) {
    if (!Number.isFinite(price) || price > alert.maxPrice) return false
  }

  // Minimum, not equality.
  if (alert.minBeds !== undefined && alert.minBeds !== null) {
    const beds = Number(property.beds)
    if (!Number.isFinite(beds) || beds < alert.minBeds) return false
  }

  return true
}

export const ALERT_LISTING_TYPES = LISTING_TYPES
export const ALERT_PROPERTY_TYPES = PROPERTY_TYPES
