import express from 'express'
import Property from '../models/Property.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { generatePropertyEmbedding, embeddingSourceFieldsChanged } from '../services/propertyEmbeddingService.js'
import { resolveAgentContact, publicAgent, AGENT_POPULATE_FIELDS } from '../services/agentAssignment.js'
import { handlePropertyAgentReassignment } from '../services/propertyMessaging.js'
import { notifyNewPropertyCreated } from '../services/propertyCreatedPush.js'
// Not called directly — importing it registers the 'User' model with Mongoose,
// which populate('agent') below depends on.
import '../models/User.js'

const router = express.Router()

const PUBLIC_PROPERTY_EXCLUDE = '-descriptionEmbedding -embeddingUpdatedAt'

/* ───────────────────────── Property location ─────────────────────────
 *
 * Three functions, deliberately separate, because they answer three different
 * questions about the same four numbers:
 *
 *   parsePropertyLocation  what may a client WRITE?
 *   publicLocation         what may an anonymous visitor READ?
 *   editableLocation       what may an authorised editor READ?
 *
 * Keeping them apart is what makes the privacy rule auditable: the public
 * reader and the editor reader are different functions, so it is impossible to
 * widen one by accident while editing the other.
 */

const LAT_MIN = -90
const LAT_MAX = 90
const LNG_MIN = -180
const LNG_MAX = 180
const RADIUS_MIN_KM = 1
const RADIUS_MAX_KM = 20
const RADIUS_DEFAULT_KM = 5

/**
 * Strict number test.
 *
 * `typeof x === 'number'` rather than Number(x), because a numeric STRING must
 * be refused too. A JSON API that quietly coerces '41.0082' teaches clients to
 * send strings, and the same coercion then has to be repeated in every reader
 * below — including the two that run against historical documents nobody
 * validated. Number.isFinite additionally rules out NaN and ±Infinity, the
 * values that survive a hand-edited record.
 */
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

const isUsableLat = (v) => isFiniteNumber(v) && v >= LAT_MIN && v <= LAT_MAX
const isUsableLng = (v) => isFiniteNumber(v) && v >= LNG_MIN && v <= LNG_MAX

/** Radius is cosmetic, so a bad STORED value falls back instead of failing. */
const readRadius = (v) =>
  isFiniteNumber(v) && v >= RADIUS_MIN_KM && v <= RADIUS_MAX_KM ? v : RADIUS_DEFAULT_KM

/**
 * Validates a client-supplied `location` and returns what should be stored.
 *
 * The three write outcomes are distinguished by VALUE, not by a flag, so a
 * caller cannot forget to handle one:
 *
 *   { ok: true, value: undefined }  key absent — leave any stored location alone
 *   { ok: true, value: null }       clear      — remove the stored location
 *   { ok: true, value: {...} }      replace    — write this normalised object
 *   { ok: false, message }          reject     — 400, write nothing
 *
 * ── Why 0 must not be treated as missing ────────────────────────
 * Latitude 0 and longitude 0 are real coordinates. Every truthiness check
 * (`if (lat && lng)`) silently discards them, which is why the tests here go
 * through isFiniteNumber and explicit === undefined / === null comparisons.
 *
 * ── Why only an explicit null clears ────────────────────────
 * Removing a pin is destructive and irreversible from the client's point of
 * view, so it is never INFERRED. `location: null` is the one signal, and Wave
 * 9b's "Clear location" button is the one thing that sends it.
 *
 * Everything else that lacks a usable pair — {}, { isApproximate: true },
 * { approxRadiusKm: 10 }, { lat: null, lng: null } — is a malformed payload
 * rather than an instruction, and is refused. A form that failed to attach
 * the coordinates must not be able to erase the coordinates already stored.
 */
export const parsePropertyLocation = (raw) => {
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === null) return { ok: true, value: null }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'location must be an object, or null to clear it' }
  }

  const { lat, lng, isApproximate, approxRadiusKm } = raw
  const hasLat = lat !== undefined && lat !== null
  const hasLng = lng !== undefined && lng !== null

  // Any object that does not carry BOTH coordinates is rejected — including
  // one carrying none at all.
  //
  // A half pair is always a mistake: it cannot be drawn, and storing it would
  // leave a record every reader below has to defend against.
  //
  // A coordinate-less object is refused for a different and stronger reason:
  // erasing a pin is destructive, so it gets exactly one signal — the explicit
  // `location: null` handled above. Inferring "delete the stored location"
  // from { isApproximate: true, approxRadiusKm: 10 } would mean a frontend that
  // merely forgot to attach the coordinates silently destroys data the admin
  // never asked to remove.
  if (!hasLat || !hasLng) {
    return {
      ok: false,
      message: 'location requires both lat and lng; send location: null to clear it',
    }
  }

  if (!isFiniteNumber(lat)) return { ok: false, message: 'location.lat must be a finite number' }
  if (lat < LAT_MIN || lat > LAT_MAX) {
    return { ok: false, message: `location.lat must be between ${LAT_MIN} and ${LAT_MAX}` }
  }
  if (!isFiniteNumber(lng)) return { ok: false, message: 'location.lng must be a finite number' }
  if (lng < LNG_MIN || lng > LNG_MAX) {
    return { ok: false, message: `location.lng must be between ${LNG_MIN} and ${LNG_MAX}` }
  }

  // Strict boolean. 'true' is not accepted: this project has no global string
  // coercion rule, and inventing one here would make the privacy switch below
  // depend on a convention nothing else in the codebase follows.
  let approximate = false
  if (isApproximate !== undefined && isApproximate !== null) {
    if (typeof isApproximate !== 'boolean') {
      return { ok: false, message: 'location.isApproximate must be a boolean' }
    }
    approximate = isApproximate
  }

  let radiusKm = RADIUS_DEFAULT_KM
  if (approxRadiusKm !== undefined && approxRadiusKm !== null) {
    if (!isFiniteNumber(approxRadiusKm)) {
      return { ok: false, message: 'location.approxRadiusKm must be a finite number' }
    }
    if (approxRadiusKm < RADIUS_MIN_KM || approxRadiusKm > RADIUS_MAX_KM) {
      return {
        ok: false,
        message: `location.approxRadiusKm must be between ${RADIUS_MIN_KM} and ${RADIUS_MAX_KM}`,
      }
    }
    radiusKm = approxRadiusKm
  }

  return { ok: true, value: { lat, lng, isApproximate: approximate, approxRadiusKm: radiusKm } }
}

/**
 * What an anonymous visitor is allowed to see.
 *
 * ── The rule that matters ────────────────────────────────
 * When a listing is marked approximate the stored coordinate NEVER leaves this
 * function. Not hidden by the client, not filtered out of a marker list, not
 * handed to a third-party map embed — absent from the payload entirely.
 * Anything less is defeated by opening the network tab.
 *
 * Returns null when there is nothing publishable; the caller then omits the key
 * rather than emitting `location: null`, so "no location" looks the same on the
 * wire as it does in the database.
 *
 * Validity is re-checked here rather than assumed. Documents written before
 * this route existed, or edited by hand in Mongo, can hold a half pair or a
 * numeric string; such a property must still list and open normally, just
 * without usable coordinates.
 */
export const publicLocation = (raw) => {
  if (!raw || typeof raw !== 'object') return null

  const { lat, lng, isApproximate, approxRadiusKm } = raw
  const approximate = isApproximate === true
  const radiusKm = readRadius(approxRadiusKm)

  if (approximate) return { isApproximate: true, approxRadiusKm: radiusKm }
  if (!isUsableLat(lat) || !isUsableLng(lng)) return null

  return { lat, lng, isApproximate: false, approxRadiusKm: radiusKm }
}

/** Reduces one property object to what the public may read. */
const withPublicLocation = (obj) => {
  const location = publicLocation(obj.location)
  if (location === null) {
    const { location: _omitted, ...rest } = obj
    return rest
  }
  return { ...obj, location }
}

/**
 * What an authorised editor is allowed to see — the exact stored coordinate,
 * approximate or not, because they are the person who placed the pin and the
 * only person who can move it.
 *
 * Unusable stored data reads back as null rather than passing through, so a
 * malformed historical record cannot reach an editing form as a half pair.
 */
export const editableLocation = (raw) => {
  if (!raw || typeof raw !== 'object') return null

  const { lat, lng, isApproximate, approxRadiusKm } = raw
  if (!isUsableLat(lat) || !isUsableLng(lng)) return null

  return {
    lat,
    lng,
    isApproximate: isApproximate === true,
    approxRadiusKm: readRadius(approxRadiusKm),
  }
}


/* ───────────────────── Extended listing detail ─────────────────────
 *
 * Validation for the donor-parity fields added in Wave 10B1. Deliberately a
 * separate parser from parsePropertyLocation above, and deliberately NOT a
 * rewrite of how the routes handle req.body — the existing spread stays, and
 * this only inspects the handful of keys it owns.
 *
 * Same contract shape as the location parser, so both read alike at the call
 * site: { ok: true, value } or { ok: false, message }. `value` holds ONLY the
 * keys the caller actually supplied, so an untouched field is never written.
 */

const CURRENCIES = ['TL', 'USD', 'EUR', 'GBP']

/**
 * The one place a currency and its rendered symbol are related.
 *
 * `priceLabel` is what formatPrice() actually prints and predates `currency`,
 * so the two could trivially end up disagreeing ("EUR" stored beside "$").
 * The mapping below is what lets the route keep them consistent instead.
 */
const CURRENCY_TO_SYMBOL = { TL: '₺', USD: '$', EUR: '€', GBP: '£' }

/** Reverse lookup, including the bare "TL" text the old label format allows. */
const symbolToCurrency = (label) => {
  const trimmed = String(label ?? '').trim()
  if (!trimmed) return null
  if (trimmed.toUpperCase() === 'TL') return 'TL'
  const match = Object.entries(CURRENCY_TO_SYMBOL).find(([, symbol]) => symbol === trimmed)
  return match ? match[0] : null
}

const FLOOR_LOCATIONS = ['Ground floor', 'High Entrance', 'Penthouse', 'Duplex', 'Triplex']
const KITCHEN_TYPES = ['Open (American)', 'Closed']
const USAGE_STATUSES = ['Empty', 'Tenant', 'Property Owner']
const TITLE_DEED_STATUSES = [
  'Shared Title Deed',
  'Independent Title Deed',
  'Land with Title Deed',
  'Cooperative Share Title Deed',
  'Established Usufruct Right',
]
const TRANSPORT_OPTIONS = ['Metro', 'Metrobus', 'Bus', 'Ferry', 'Train', 'Tram', 'Highway Access']

const EXTENDED_ENUMS = {
  currency: CURRENCIES,
  floorLocation: FLOOR_LOCATIONS,
  kitchenType: KITCHEN_TYPES,
  usageStatus: USAGE_STATUSES,
  titleDeedStatus: TITLE_DEED_STATUSES,
}

// [field, minimum]. `coefficient` has no minimum because the donor documents no
// business meaning for it, and inventing a bound would be inventing a rule.
const EXTENDED_NUMBERS = [['netSqm', 0], ['openAreaSqm', 0], ['coefficient', null]]

const EXTENDED_BOOLEANS = [
  'sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement',
  'withinSite', 'eligibleForCredit', 'exchange', 'hasVirtualTour',
]

/**
 * Hosts a virtual-tour link may point at.
 *
 * An allowlist rather than "any https URL" because this value is admin-entered
 * and will eventually be rendered as a link. The donor stored it with no
 * validation at all and never displayed it, which is exactly how an unchecked
 * field survives until the day someone does display it.
 *
 * Subdomains are matched by suffix so my.matterport.com passes for
 * matterport.com, while a lookalike like matterport.com.evil.test does not.
 */
const VIRTUAL_TOUR_HOSTS = ['matterport.com', 'kuula.co', 'youtube.com', 'youtu.be', 'vimeo.com']

const isAllowedTourHost = (hostname) =>
  VIRTUAL_TOUR_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host))

/**
 * Numbers may arrive as real numbers or as the numeric strings an HTML number
 * input produces. Nothing else converts: `false`, `null`, `[]` and `{}` are all
 * Number()-coercible to 0 or NaN, and letting any of them through would store a
 * silent zero where the admin supplied nothing meaningful.
 */
const readExtendedNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value } : { error: 'must be a finite number' }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return { skip: true }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? { value: parsed } : { error: 'must be a number' }
  }
  return { error: 'must be a number' }
}

/**
 * Validates and normalises the extended fields present in a request body.
 *
 * ── Absence is never a value ────────────────────────────────────────────
 * A key the caller did not send is not in the result, so an update that only
 * changes the title cannot disturb an amenity. An empty string is treated the
 * same as absence, because that is what a cleared optional form input sends.
 */
/**
 * Every field parseExtendedPropertyFields OWNS.
 *
 * The routes build their write payload from req.body, so a raw value reaches
 * the database unless something removes it first. Without this list a value the
 * parser deliberately SKIPPED — `netSqm: ''`, `sauna: null`, an empty enum —
 * would still be written verbatim, storing a string in a Number field and a
 * null where "not supplied" was meant. Skipping would have meant "leave the raw
 * value alone" rather than "no-op", which is the opposite of the contract.
 *
 * So these keys are stripped from the payload and then re-applied ONLY from the
 * parser's normalised output: raw input -> validator -> database, never raw
 * input -> database.
 *
 * `priceLabel` is deliberately NOT here. It predates this wave, is written by
 * other paths, and may legitimately hold a custom string; the parser only ever
 * ADDS a derived value for it.
 */
export const EXTENDED_OWNED_FIELDS = [
  ...EXTENDED_NUMBERS.map(([field]) => field),
  ...EXTENDED_BOOLEANS,
  ...Object.keys(EXTENDED_ENUMS),
  'nearbyTransport',
  'virtualTourUrl',
]

/** Strips the owned keys so only validated values can be written. */
const stripExtendedFields = (payload) => {
  for (const field of EXTENDED_OWNED_FIELDS) delete payload[field]
}

export const parseExtendedPropertyFields = (body) => {
  if (!body || typeof body !== 'object') return { ok: true, value: {} }

  const out = {}
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key)
  const fail = (message) => ({ ok: false, message })

  for (const [field, min] of EXTENDED_NUMBERS) {
    if (!has(field) || body[field] === null) continue
    const read = readExtendedNumber(body[field])
    if (read.skip) continue
    if (read.error) return fail(`${field} ${read.error}.`)
    if (min !== null && read.value < min) return fail(`${field} must be ${min} or greater.`)
    out[field] = read.value
  }

  for (const field of EXTENDED_BOOLEANS) {
    if (!has(field) || body[field] === null) continue
    // Strict. 'true' and 1 are refused so that an unknown amenity can never be
    // coerced into a confident claim about a property.
    if (typeof body[field] !== 'boolean') return fail(`${field} must be true or false.`)
    out[field] = body[field]
  }

  for (const [field, allowed] of Object.entries(EXTENDED_ENUMS)) {
    if (!has(field) || body[field] === null || body[field] === '') continue
    if (typeof body[field] !== 'string' || !allowed.includes(body[field])) {
      return fail(`${field} must be one of: ${allowed.join(', ')}.`)
    }
    out[field] = body[field]
  }

  if (has('nearbyTransport') && body.nearbyTransport !== null) {
    const raw = body.nearbyTransport
    if (!Array.isArray(raw)) return fail('nearbyTransport must be an array.')
    if (raw.length > TRANSPORT_OPTIONS.length) {
      return fail(`nearbyTransport may contain at most ${TRANSPORT_OPTIONS.length} entries.`)
    }
    for (const entry of raw) {
      if (typeof entry !== 'string' || !TRANSPORT_OPTIONS.includes(entry)) {
        return fail(`nearbyTransport may only contain: ${TRANSPORT_OPTIONS.join(', ')}.`)
      }
    }
    // Deduped rather than rejected: a repeated checkbox value is a client
    // mistake with one obvious correct reading.
    out.nearbyTransport = [...new Set(raw)]
  }

  if (has('virtualTourUrl') && body.virtualTourUrl !== null && body.virtualTourUrl !== '') {
    const raw = body.virtualTourUrl
    if (typeof raw !== 'string') return fail('virtualTourUrl must be text.')

    let parsedUrl
    try {
      parsedUrl = new URL(raw.trim())
    } catch {
      return fail('virtualTourUrl must be a valid URL.')
    }
    // https only — this rejects javascript:, data: and plain http in one test.
    if (parsedUrl.protocol !== 'https:') return fail('virtualTourUrl must use https.')
    if (!isAllowedTourHost(parsedUrl.hostname.toLowerCase())) {
      return fail(`virtualTourUrl host is not allowed. Allowed: ${VIRTUAL_TOUR_HOSTS.join(', ')}.`)
    }
    out.virtualTourUrl = parsedUrl.toString()
  }

  /* ── currency ↔ priceLabel ──────────────────────────────────────────
   *
   * Four cases, chosen so neither field can silently misrepresent the other:
   *
   *   currency only        -> priceLabel derived from it
   *   priceLabel only      -> currency derived, when the label maps cleanly
   *   both, in agreement   -> left alone
   *   both, contradictory  -> 400
   *
   * A priceLabel that maps to no currency (a custom string like "Price on
   * request", which formatPrice passes through verbatim) is deliberately left
   * untouched and does not derive or contradict anything — overwriting it with
   * a symbol would destroy a value the admin chose on purpose.
   */
  const currencyGiven = has('currency') && out.currency
  const labelGiven = has('priceLabel') && typeof body.priceLabel === 'string' && body.priceLabel.trim()
  const labelCurrency = labelGiven ? symbolToCurrency(body.priceLabel) : null

  if (currencyGiven && labelGiven) {
    if (labelCurrency && labelCurrency !== out.currency) {
      return fail(`priceLabel "${body.priceLabel.trim()}" does not match currency ${out.currency}.`)
    }
  } else if (currencyGiven) {
    out.priceLabel = CURRENCY_TO_SYMBOL[out.currency]
  } else if (labelCurrency) {
    out.currency = labelCurrency
  }

  return { ok: true, value: out }
}

/**
 * Builds the write payload with every agent-related field decided by the
 * server rather than the browser.
 *
 * req.body cannot be trusted straight through here: `agent` is a pointer to a
 * user document, and `agentEmail` is supposed to belong to that user. Without
 * this, a request could assign Ahmet while storing someone else's address, or
 * leave the previous agent's phone number attached to a new one.
 *
 * `existingProperty` is null on create. Returns null when the assignment was
 * rejected — the caller has already responded.
 */
const applyAgentContact = async (body, res, existingProperty = null) => {
  const resolved = await resolveAgentContact(body, existingProperty)

  if (!resolved.ok) {
    res.status(400).json({ success: false, message: resolved.message })
    return null
  }

  const data = { ...body }

  // Never write the legacy free-text agent name from this route. Existing
  // documents keep whatever they already have — see the Property model.
  delete data.agentName

  // Fields the server refuses to let this request change at all.
  for (const field of resolved.drop) delete data[field]

  // Server-decided values win over anything the client sent.
  Object.assign(data, resolved.changes)

  return data
}

/* ─────────────────── Public search filters ───────────────────────────
 *
 * Wave 10B4. Every helper below exists because the obvious one-liner is
 * wrong in a way that is invisible from the response:
 *
 *   Number(raw)  — Number("") is 0 and Number("abc") is NaN. A blank input
 *                  would silently become "minimum 0" and a typo would become
 *                  a NaN comparison that matches nothing, with no error.
 *
 *   if (raw)     — drops a legitimate 0, so "ground floor" or "0 open area"
 *                  could never be searched for.
 *
 *   raw === true — an unrecognised value must add NO filter rather than
 *                  quietly filtering on something the caller did not ask for.
 */

/** Repeated params (?x=a&x=b) arrive as an array, single ones as a string. */
const toFilterArray = (raw) =>
  raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw]

/** Only a genuinely numeric, non-blank string becomes a number. */
const filterNumber = (raw) => {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** Adds { $gte, $lte } only for the bounds that actually parsed. */
const applyRangeFilter = (filter, field, minRaw, maxRaw) => {
  const min = filterNumber(minRaw)
  const max = filterNumber(maxRaw)
  if (min === null && max === null) return

  filter[field] = {}
  if (min !== null) filter[field].$gte = min
  if (max !== null) filter[field].$lte = max
}

/*
 * Three-state, and the third state is the point.
 *
 * Wave 10B1 gave these booleans NO schema default so that "nobody ever
 * recorded whether this flat has a sauna" stays distinct from "it has none".
 * A filter that mapped absent to false would collapse that distinction on the
 * public site — searching "no sauna" would return every listing predating the
 * field. So `false` matches ONLY a stored false, and anything other than the
 * two recognised strings adds no filter at all.
 */
const applyTriStateFilter = (filter, field, raw) => {
  if (raw === 'true') filter[field] = true
  else if (raw === 'false') filter[field] = false
}

/*
 * Enum filter, any-of.
 *
 * A value the schema cannot store is dropped rather than passed to Mongo. If
 * the caller supplied the parameter but nothing survived validation the result
 * is `$in: []`, which matches nothing — deliberately, because silently
 * widening the search would show listings the visitor did not ask for.
 */
const applyEnumFilter = (filter, field, raw, allowed) => {
  const supplied = toFilterArray(raw).filter(
    (value) => typeof value === 'string' && value !== ''
  )
  if (!supplied.length) return

  filter[field] = { $in: [...new Set(supplied.filter((value) => allowed.includes(value)))] }
}

/*
 * "Listed since", accepting both encodings:
 *
 *   a whole number of days  ("7")  -> that many days before now
 *   an absolute ISO instant        -> used as given (the donor contract)
 *
 * The day count is what this site's own UI sends, because it survives being
 * bookmarked or shared: a stored absolute instant would keep drifting further
 * into the past for whoever opens the link tomorrow.
 */
const MAX_LISTED_SINCE_DAYS = 3650

const parseListedSince = (raw) => {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const value = raw.trim()

  if (/^\d+$/.test(value)) {
    const days = Number(value)
    if (days < 1 || days > MAX_LISTED_SINCE_DAYS) return null
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  // Date parsing is deliberately NOT left to the Date constructor alone: it
  // accepts '-5' as 2001-04-30 and '2026' as a whole year, so a typo would
  // become a silent, plausible-looking cutoff. Only an ISO-8601 calendar date
  // (optionally with a time) is honoured.
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value)) return null

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// GET /api/properties
router.get('/', async (req, res, next) => {
  try {
    const {
      listingType, district, minPrice, maxPrice, propertyType, beds, baths, featured,
      rooms, minSqm, maxSqm, floor, totalFloors, heating, parking, buildingAge,
      furnished, balcony, elevator, pool, garden,
      // ── Wave 10B4 ──
      minNetSqm, maxNetSqm, minOpenArea, maxOpenArea, minCoefficient, maxCoefficient,
      floorLocation, kitchenType, usageStatus, titleDeedStatus, nearbyTransport,
      sauna, jacuzzi, steamRoom, turkishBath, basement,
      withinSite, eligibleForCredit, exchange, hasVirtualTour,
      listedSince,
    } = req.query
    const filter = {}

    if (listingType) filter.listingType = listingType
    if (district) filter.district = district
    if (propertyType) filter.propertyType = propertyType
    if (beds) filter.beds = Number(beds)
    if (baths) filter.baths = Number(baths)
    if (featured !== undefined) filter.featured = featured === 'true'
    if (rooms) filter.rooms = rooms
    if (floor) filter.floor = Number(floor)
    if (totalFloors) filter.totalFloors = Number(totalFloors)
    if (heating) filter.heating = heating
    if (parking) filter.parking = parking
    if (buildingAge) filter.buildingAge = buildingAge
    if (furnished === 'true') filter.furnished = true
    if (balcony === 'true') filter.balcony = true
    if (elevator === 'true') filter.elevator = true
    if (pool === 'true') filter.pool = true
    if (garden === 'true') filter.garden = true
    if (minPrice || maxPrice) {
      filter.price = {}
      if (minPrice) filter.price.$gte = Number(minPrice)
      if (maxPrice) filter.price.$lte = Number(maxPrice)
    }
    if (minSqm || maxSqm) {
      filter.sqm = {}
      if (minSqm) filter.sqm.$gte = Number(minSqm)
      if (maxSqm) filter.sqm.$lte = Number(maxSqm)
    }

    /* ── Wave 10B4 extended filters ──────────────────────────────────
     *
     * Appended, never interleaved: every line above this point behaves
     * exactly as it did before, so a request carrying none of the
     * parameters below produces byte-identical results to the previous
     * release. The chatbot and the similar-properties call both rely on
     * that.
     */
    applyRangeFilter(filter, 'netSqm', minNetSqm, maxNetSqm)
    applyRangeFilter(filter, 'openAreaSqm', minOpenArea, maxOpenArea)
    applyRangeFilter(filter, 'coefficient', minCoefficient, maxCoefficient)

    applyEnumFilter(filter, 'floorLocation', floorLocation, FLOOR_LOCATIONS)
    applyEnumFilter(filter, 'kitchenType', kitchenType, KITCHEN_TYPES)
    applyEnumFilter(filter, 'usageStatus', usageStatus, USAGE_STATUSES)
    applyEnumFilter(filter, 'titleDeedStatus', titleDeedStatus, TITLE_DEED_STATUSES)
    // On an array field `$in` means "contains any of these", which is the
    // any-of semantic a multi-select asks for.
    applyEnumFilter(filter, 'nearbyTransport', nearbyTransport, TRANSPORT_OPTIONS)

    for (const [field, raw] of [
      ['sauna', sauna], ['jacuzzi', jacuzzi], ['steamRoom', steamRoom],
      ['turkishBath', turkishBath], ['basement', basement],
      ['withinSite', withinSite], ['eligibleForCredit', eligibleForCredit],
      ['exchange', exchange], ['hasVirtualTour', hasVirtualTour],
    ]) {
      applyTriStateFilter(filter, field, raw)
    }

    const listedSinceDate = parseListedSince(listedSince)
    if (listedSinceDate) filter.createdAt = { $gte: listedSinceDate }

    // .lean() because the payload is rewritten below rather than returned as
    // documents; the schema declares no virtuals, getters or toJSON transform,
    // so the serialised result is identical.
    const found = await Property.find(filter)
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .sort({ createdAt: -1 })
      .lean()
    const properties = found.map(withPublicLocation)
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/areas - MUST be before /:id
router.get('/areas', async (req, res, next) => {
  try {
    const areas = await Property.aggregate([
      { $group: { _id: '$district', count: { $sum: 1 } } },
      { $match: { count: { $gte: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, district: '$_id', count: 1 } },
    ])
    res.json({ success: true, areas })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/sale - MUST be before /:id
router.get('/sale', async (req, res, next) => {
  try {
    const found = await Property.find({ listingType: 'Sale' })
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .sort({ createdAt: -1 })
      .lean()
    const properties = found.map(withPublicLocation)
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/rent - MUST be before /:id
router.get('/rent', async (req, res, next) => {
  try {
    const found = await Property.find({ listingType: 'Rent' })
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .sort({ createdAt: -1 })
      .lean()
    const properties = found.map(withPublicLocation)
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/:id/admin-location — MUST be before /:id
//
// The one place the exact stored coordinate of an APPROXIMATE listing is
// readable, and it is deliberately its own endpoint rather than a widening of
// the property payload.
//
// ── Why not simply un-redact the property for admins ───────────────────
// Because the person who may EDIT a pin is a narrower set than the people who
// may see a listing in the admin UI. requirePermission('edit_listing') is the
// permission that actually governs moving a pin, so an admin holding only
// add_listing or delete_listing is refused here — they never receive the exact
// coordinates of every private listing merely by opening the properties page.
//
// ── Why the route order is stated rather than assumed ──────────────────
// Express matches in registration order, and '/:id' matches a SINGLE path
// segment, so '/abc/admin-location' would not be swallowed even if this came
// second. It is placed first anyway, matching the convention already used by
// /areas, /sale and /rent above, so the ordering never has to be re-derived.
//
// The projection is narrowed to `location` at the database, so no embedding,
// no agent pointer and no contact field is read, let alone returned.
router.get(
  '/:id/admin-location',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('edit_listing'),
  async (req, res, next) => {
    try {
      const property = await Property.findById(req.params.id).select('location').lean()

      if (!property) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }

      res.json({ success: true, location: editableLocation(property.location) })
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/properties/:id
//
// The one endpoint that populates the assigned agent, because it is the one
// that renders them. The list endpoints deliberately do not — a card shows no
// agent, and populating there would be one lookup per listing for nothing.
// (The raw `agent` id still rides along in the list payload as an ordinary
// field, which is what lets the admin edit form preselect the current agent
// without a second request.)
router.get('/:id', async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .populate('agent', AGENT_POPULATE_FIELDS)

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' })
    }

    // publicAgent() is a whitelist, not a trim: role and isActive are fetched
    // only so it can decide whether to show the agent at all, and never reach
    // the response. An agent since deactivated or demoted reads back as null.
    const propertyJson = property.toObject()
    propertyJson.agent = publicAgent(property.agent)

    // Same redaction the list endpoints apply. Detail is the page a visitor
    // reaches when they are interested in ONE listing, so it is exactly where
    // an approximate coordinate would be worth harvesting.
    res.json({ success: true, property: withPublicLocation(propertyJson) })
  } catch (err) {
    next(err)
  }
})

// POST /api/properties
router.post(
  '/',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('add_listing'),
  async (req, res, next) => {
    try {
      // Location is checked first because it is the cheapest thing to reject:
      // a bad coordinate costs no agent lookup and no embedding call.
      const parsedLocation = parsePropertyLocation(req.body?.location)
      if (!parsedLocation.ok) {
        return res.status(400).json({ success: false, message: parsedLocation.message })
      }

      // Same reasoning as the location check above: reject a bad detail field
      // before spending an agent lookup or an embedding call on it.
      const parsedExtended = parseExtendedPropertyFields(req.body)
      if (!parsedExtended.ok) {
        return res.status(400).json({ success: false, message: parsedExtended.message })
      }

      // Validate the agent BEFORE any other work, so a bad assignment costs
      // nothing and never reaches the database. No existing property on
      // create, so there is no previous agent whose details could go stale.
      let propertyData = await applyAgentContact(req.body, res, null)
      if (!propertyData) return

      // On create there is nothing to preserve and nothing to clear, so the
      // only two outcomes are "store the normalised object" and "no location".
      if (parsedLocation.value) {
        propertyData.location = parsedLocation.value
      } else {
        delete propertyData.location
      }

      // Strip first, then apply: a skipped value must leave nothing behind.
      stripExtendedFields(propertyData)
      Object.assign(propertyData, parsedExtended.value)

      try {
        const embeddingResult = await generatePropertyEmbedding(req.body)
        if (embeddingResult) {
          propertyData = { ...propertyData, ...embeddingResult }
        }
      } catch (embeddingErr) {
        console.log('Property embedding generation failed (create):', embeddingErr.message)
      }

      const property = await Property.create(propertyData)

      /*
       * Announce it — and only now.
       *
       * Every rejecting path above (bad location, bad detail field, bad agent)
       * has already returned, and Property.create has resolved, so nothing can
       * notify anyone about a listing the database did not accept.
       *
       * There is no draft/publish concept in this schema: `status` is a
       * lifecycle value (Available / Sold / Rented / Pending) and the public
       * listing query applies no status filter at all. A created property is
       * therefore immediately visible and openable, which makes successful
       * creation the correct boundary for "a customer can actually see this".
       *
       * NOT awaited. Expo is a third party on the far side of the internet and
       * the admin pressing Create should not wait on it to learn their listing
       * was saved. The promise is still terminated with .catch() rather than
       * floating: notifyNewPropertyCreated contains matching/provider failures,
       * and this makes an unhandled rejection impossible rather than unlikely.
       *
       * The creator is excluded explicitly — they are looking at the form that
       * created it, and `req.user._id` costs nothing here. Staff accounts are
       * filtered inside the service; this covers the creator even in the
       * unlikely case their role changes mid-session.
       */
      notifyNewPropertyCreated({
        property,
        excludeUserIds: [req.user?._id].filter(Boolean),
      }).catch(() => {})

      res.status(201).json({ success: true, property })
    } catch (err) {
      next(err)
    }
  }
)

// PUT /api/properties/:id
router.put(
  '/:id',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('edit_listing'),
  async (req, res, next) => {
    try {
      // Before the read, before the agent resolution, before the embedding —
      // an invalid location must not be able to cause ANY side effect. Nothing
      // below this line runs unless the coordinate is already known to be good.
      const parsedLocation = parsePropertyLocation(req.body?.location)
      if (!parsedLocation.ok) {
        return res.status(400).json({ success: false, message: parsedLocation.message })
      }

      // Same reasoning as the location check above: reject a bad detail field
      // before spending an agent lookup or an embedding call on it.
      const parsedExtended = parseExtendedPropertyFields(req.body)
      if (!parsedExtended.ok) {
        return res.status(400).json({ success: false, message: parsedExtended.message })
      }

      const existingProperty = await Property.findById(req.params.id)
      if (!existingProperty) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }

      // The existing property is what makes "did the agent actually change?"
      // answerable — which is what decides whether the previous agent's phone
      // and WhatsApp are cleared.
      let updateData = await applyAgentContact(req.body, res, existingProperty)
      if (!updateData) return

      if (embeddingSourceFieldsChanged(existingProperty, req.body)) {
        try {
          const mergedForEmbedding = {
            title: req.body.title ?? existingProperty.title,
            description: req.body.description ?? existingProperty.description,
            district: req.body.district ?? existingProperty.district,
            address: req.body.address ?? existingProperty.address,
          }

          const embeddingResult = await generatePropertyEmbedding(mergedForEmbedding)
          if (embeddingResult) {
            updateData = { ...updateData, ...embeddingResult }
          }
        } catch (embeddingErr) {
          console.log('Property embedding generation failed (update):', embeddingErr.message)
        }
      }

      // Three-way location contract, resolved into Mongo operators:
      //
      //   key absent  -> touch nothing (the client was editing other fields)
      //   null/empty  -> $unset, so the field goes away rather than becoming
      //                  a null that every reader would have to special-case
      //   object      -> $set the normalised value
      delete updateData.location
      const clearLocation = parsedLocation.value === null

      // Strip first, then apply. On an update this is what makes a skipped
      // value a true no-op: the key never reaches $set, so the stored value is
      // preserved rather than being overwritten with '' or null.
      stripExtendedFields(updateData)
      Object.assign(updateData, parsedExtended.value)
      if (parsedLocation.value) updateData.location = parsedLocation.value

      const updateOps = {}
      // $set with an empty object is rejected by MongoDB, which a location-only
      // clear would otherwise produce.
      if (Object.keys(updateData).length > 0) updateOps.$set = updateData
      if (clearLocation) updateOps.$unset = { location: '' }

      const property = await Property.findByIdAndUpdate(req.params.id, updateOps, {
        new: true,
        runValidators: true,
      })
      if (!property) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }

      // Keep existing conversations in step with who now holds this listing.
      // Runs AFTER the property write succeeds, so a rejected update never
      // moves a thread. This route is the natural caller because it is the
      // only place that knows both the previous and the new agent.
      //
      // ── Why a failure here is survivable ─────────────────────────────────
      // The listing is already saved and correct, so failing the admin's edit
      // would be the worse outcome. What makes swallowing it acceptable is
      // that messaging authorization does NOT trust this write: agent access
      // is decided against Property.agent on every request
      // (services/propertyMessaging.js), so a conversation pointer left
      // pointing at the outgoing agent grants them nothing. The pointer then
      // repairs itself the next time the customer sends or reopens.
      //
      // The cost of a failure is therefore availability, not privacy: the
      // incoming agent cannot see the thread until it reconciles.
      try {
        await handlePropertyAgentReassignment({
          propertyId: property._id,
          previousAgentId: existingProperty.agent,
          nextAgentId: property.agent,
        })
      } catch (messagingErr) {
        // Ids only — never message text or conversation content.
        console.error(
          '[messaging] conversation reassignment failed; conversations for this property are stale until reconciled.',
          {
            propertyId: String(property._id),
            previousAgentId: existingProperty.agent ? String(existingProperty.agent) : null,
            nextAgentId: property.agent ? String(property.agent) : null,
            error: messagingErr.message,
          }
        )
      }

      res.json({ success: true, property })
    } catch (err) {
      next(err)
    }
  }
)

// DELETE /api/properties/:id
router.delete(
  '/:id',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('delete_listing'),
  async (req, res, next) => {
    try {
      const property = await Property.findByIdAndDelete(req.params.id)
      if (!property) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }
      res.json({ success: true, message: 'Property deleted' })
    } catch (err) {
      next(err)
    }
  }
)

export default router
