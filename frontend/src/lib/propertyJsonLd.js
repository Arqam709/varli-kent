import { SITE_URL } from './useSeo.js'

// Property structured data (schema.org JSON-LD) for /properties/:id.
//
// Transplanted from the donor's PropertyDetailsPage, with four corrections
// noted inline. It lives here rather than inline in the page component for
// one reason: it is the only part of this wave that can state a FACT about a
// listing to a search engine, so it needs real tests — and this project has
// a deterministic frontend verifier in tests/seoParity.test.js.
//
// ── What this must never do ───────────────────────────────────────────────
// Claim anything the public page does not already show. Every field below is
// either omitted or drawn from a value the visitor can read on the page, and
// nothing is generated, inferred or defaulted into existence.

/*
 * schema.org has no generic "RealEstateListing" type, so the listing is
 * modelled as the residence itself with price attached via an Offer — the
 * correct vocabulary for "this specific place, at this price". Donor mapping,
 * unchanged.
 */
const residenceType = (propertyType) => {
  const pt = String(propertyType || '').toLowerCase()
  if (pt.includes('villa') || pt.includes('house')) return 'House'
  if (pt.includes('apartment') || pt.includes('flat')) return 'Apartment'
  return 'Residence'
}

/*
 * CORRECTION 1 — currency.
 *
 * The donor sniffed the currency out of the `priceLabel` SYMBOL and fell back
 * to 'USD' for anything it did not recognise. That silently misprices every
 * GBP listing, and any listing whose label is blank, as US dollars.
 *
 * CURRENT stores a canonical `currency` enum (Wave 10B4, Property.js:
 * ['TL','USD','EUR','GBP']), which is the actual answer. TL maps to the
 * ISO 4217 code TRY, which is what schema.org's priceCurrency expects.
 * An absent or unrecognised currency omits the field rather than guessing —
 * a price with no currency is incomplete, a price in the wrong currency is
 * wrong.
 */
const ISO_CURRENCY = { TL: 'TRY', USD: 'USD', EUR: 'EUR', GBP: 'GBP' }

// Finite numbers only, and ZERO IS VALID — `beds: 0` is a real studio, so a
// truthiness check here would silently drop it.
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

// A positive finite number. Used for floorSize, where 0 m² is not a fact
// about the property but a missing measurement.
const positive = (value) => {
  const n = finite(value)
  return n !== undefined && n > 0 ? n : undefined
}

// A non-empty trimmed string, or undefined. JSON.stringify drops undefined
// keys, which is how every optional field below disappears cleanly.
const text = (value) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

// Only a real http(s) URL may be published as an image. An empty string, a
// relative fragment or a data: URI is dropped rather than emitted broken.
const imageUrl = (value) => {
  const candidate = text(value)
  if (!candidate) return undefined
  return /^https?:\/\//i.test(candidate) ? candidate : undefined
}

const propertyImages = (property) => {
  const candidates = [
    property.mainImage,
    ...(Array.isArray(property.images) ? property.images : []),
  ]
  const images = [...new Set(candidates.map(imageUrl).filter(Boolean))]
  if (images.length === 0) return undefined
  return images.length === 1 ? images[0] : images
}


// Removes undefined values so JSON.stringify never emits an empty shell like
// `"address": {}`.
const compact = (obj) => {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Builds the JSON-LD object for one property, or null when there is nothing
 * honest to say about it.
 *
 * Returns null — never a partial or placeholder object — for a missing,
 * still-loading or deleted property, so a 404 cannot publish structured data
 * for a listing that does not exist.
 */
export const buildPropertyJsonLd = (property, id) => {
  if (!property || typeof property !== 'object') return null

  const propertyId = text(property._id)
  const routeId = text(id)
  const title = text(property.title)

  // Without a title and a canonical URL there is no listing to describe.
  if (!propertyId || !title || (routeId && routeId !== propertyId)) return null

  const district = text(property.district)
  const isRent = property.listingType === 'Rent'

  const isSale = property.listingType === 'Sale'
  /*
   * CORRECTION 2 — availability.
   *
   * The donor hard-coded `availability: InStock` for every listing, which
   * tells a search engine that a Sold or Rented property is still on the
   * market. CURRENT has a real `status` enum, so InStock is asserted only
   * when the listing genuinely is Available; every other status omits the
   * field rather than making a claim the data does not support.
   */
  const availability =
    property.status === 'Available' ? 'https://schema.org/InStock' : undefined

  const price = finite(property.price)
  const priceCurrency = ISO_CURRENCY[property.currency]

  /*
   * An Offer is only meaningful with a price. `priceCurrency` may still be
   * absent on a legacy listing that predates the currency field — schema.org
   * tolerates that, and it is honest, whereas inventing USD is not.
   */
  const offers = price !== undefined
    ? compact({
        '@type': 'Offer',
        price,
        priceCurrency,
        availability,
        businessFunction: isRent
          ? 'http://purl.org/goodrelations/v1#LeaseOut'
          : isSale
            ? 'http://purl.org/goodrelations/v1#Sell'
            : undefined,
        url: `${SITE_URL}/properties/${propertyId}`,
      })
    : undefined

  /*
   * CORRECTION 3 — address.
   *
   * The donor emitted a PostalAddress whose sub-fields could all be
   * undefined, producing a shell object. Each field is validated here, and
   * the whole block is omitted when nothing survives.
   *
   * `streetAddress` is safe to publish: PropertyDetailsPage already renders
   * "{property.address}, {property.district}, Istanbul" to every visitor, and
   * the public API returns `address` unredacted. Structured data therefore
   * reveals nothing a reader of the page cannot already see — which is the
   * standard this wave holds itself to.
   */
  const streetAddress = text(property.address)
  const address = streetAddress || district
    ? {
        '@type': 'PostalAddress',
        ...(streetAddress ? { streetAddress } : {}),
        ...(district ? { addressLocality: district } : {}),
        addressRegion: 'Istanbul',
        addressCountry: 'TR',
      }
    : undefined

  /*
   * CORRECTION 4 — no geo, deliberately.
   *
   * The donor emits no GeoCoordinates and neither does this, but for CURRENT
   * the omission is load-bearing rather than incidental.
   *
   * routes/properties.js's publicLocation() strips lat/lng entirely from any
   * listing marked isApproximate, and returns exact coordinates only for a
   * listing whose owner chose exact disclosure. Publishing coordinates here
   * would mean re-deciding that per listing in the SEO layer, and a single
   * mistake would put a redacted address into Google's index permanently.
   * The approximate-map system is not evidence of intended exact disclosure,
   * so no coordinate of any kind is emitted. See tests/seoParity.test.js.
   */

  return compact({
    '@context': 'https://schema.org',
    '@type': residenceType(property.propertyType),
    name: title,
    description:
      text(property.description) ||
      (district && (isRent || isSale)
        ? `${isRent ? 'For Rent' : 'For Sale'}: ${title} in ${district}, Istanbul.`
        : undefined),
    image: propertyImages(property),
    numberOfRooms: finite(property.beds),
    numberOfBathroomsTotal: finite(property.baths),
    floorSize: positive(property.sqm)
      ? { '@type': 'QuantitativeValue', value: positive(property.sqm), unitCode: 'MTK' }
      : undefined,
    address,
    offers,
    url: `${SITE_URL}/properties/${propertyId}`,
  })
}

export default buildPropertyJsonLd
