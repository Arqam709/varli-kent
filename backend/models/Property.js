//property
import mongoose from 'mongoose'
import { localizedField } from '../utils/localizedField.js'

// Optional geographic position for the property map.
//
// `_id: false` because this is a value object, not a document — a stored
// location is a coordinate, not something worth addressing separately.
//
// None of the four keys carries a schema-level default ON PURPOSE. A default
// here would make Mongoose materialise `location: { isApproximate: false,
// approxRadiusKm: 5 }` on every property that has never had a location set,
// which would turn "this listing has no location" into "this listing has a
// location with no coordinates". The route layer supplies the defaults when
// a real coordinate pair is written, so absent stays genuinely absent.
const propertyLocationSchema = new mongoose.Schema(
  {
    lat: { type: Number },
    lng: { type: Number },
    isApproximate: { type: Boolean },
    approxRadiusKm: { type: Number },
  },
  { _id: false }
)

const propertySchema = new mongoose.Schema({
  title: { type: String, required: true },
  listingType: { type: String, enum: ['Sale', 'Rent'], required: true },
  price: { type: Number, required: true },
  priceLabel: { type: String },
  district: { type: String, required: true },
  address: { type: String, required: true },
  // Optional. Validated and normalised by routes/properties.js before it is
  // ever written — the schema deliberately does not range-check, so that the
  // one authority on what a valid coordinate is stays in the route layer
  // alongside the public redaction rules that depend on the same definition.
  location: { type: propertyLocationSchema, default: undefined },
  propertyType: {
    type: String,
    enum: ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm'],
    default: 'Apartment',
  },
  beds: { type: Number, required: true },
  baths: { type: Number, required: true },
  sqm: { type: Number, required: true },
  // ── Donor-parity size fields ──────────────────────────────────────────
  // Optional. Range-checked in routes/properties.js rather than here, matching
  // how `location` is handled: one authority for what a valid value is.
  netSqm: { type: Number },
  openAreaSqm: { type: Number },
  rooms: { type: String },
  floor: { type: Number },
  totalFloors: { type: Number },
  buildingAge: { type: String },
  heating: { type: String },
  parking: { type: String },
  furnished: { type: Boolean, default: false },
  balcony: { type: Boolean, default: false },
  elevator: { type: Boolean, default: false },
  pool: { type: Boolean, default: false },
  garden: { type: Boolean, default: false },

  /* ─────────────────── Donor-parity listing detail ───────────────────
   *
   * Every field below is OPTIONAL and, with the single deliberate exception
   * of `currency`, carries NO default.
   *
   * ── Why the new booleans must not default to false ──────────────────
   * A default would rewrite history. Every property already in the database
   * predates these fields, so defaulting `sauna` to false would silently
   * assert "this listing has no sauna" about listings whose sauna state
   * nobody has ever recorded. Absent must stay absent, so that "unknown" and
   * "explicitly does not have it" remain different facts — the same
   * distinction routes/propertyAssistant.js already relies on when it refuses
   * to turn an unmentioned amenity into `false`.
   *
   * The five older booleans (furnished, balcony, elevator, pool, garden) keep
   * their existing `default: false`; changing them would be a data migration
   * dressed up as a schema edit.
   */

  // Layout / specification
  floorLocation: {
    type: String,
    enum: ['Ground floor', 'High Entrance', 'Penthouse', 'Duplex', 'Triplex'],
  },
  kitchenType: { type: String, enum: ['Open (American)', 'Closed'] },
  usageStatus: { type: String, enum: ['Empty', 'Tenant', 'Property Owner'] },
  titleDeedStatus: {
    type: String,
    // The donor left this an unconstrained String even though its admin form
    // offered a fixed list. Enforced here, because an unrecognised deed status
    // is unusable to every reader and impossible to filter on later.
    enum: [
      'Shared Title Deed',
      'Independent Title Deed',
      'Land with Title Deed',
      'Cooperative Share Title Deed',
      'Established Usufruct Right',
    ],
  },

  // Pricing metadata. `currency` is the one new field with a default, because
  // it describes how an amount is denominated rather than claiming a feature.
  // `priceLabel` remains what formatPrice() actually renders; the route layer
  // keeps the two from contradicting each other.
  //
  // NO default, for the same reason the booleans below have none — and this one
  // was proven rather than assumed. With `default: 'USD'`, Mongoose materialises
  // the value on HYDRATION, not just on create: a legacy listing stored with
  // `priceLabel: '€'` and no currency read back as `{ priceLabel: '€',
  // currency: 'USD' }`, inventing a contradiction the moment the schema shipped.
  // New listings get their currency from the admin form, which sends it
  // explicitly; legacy listings stay honestly unknown until someone edits them.
  currency: { type: String, enum: ['TL', 'USD', 'EUR', 'GBP'] },

  // Donor-compatible numeric metadata. The donor documents no business meaning
  // and no bounds for this, so nothing is invented here beyond "must be a
  // finite number" — it is preserved for parity, not interpreted.
  coefficient: { type: Number },

  // Amenities — see the no-default note above.
  sauna: { type: Boolean },
  jacuzzi: { type: Boolean },
  steamRoom: { type: Boolean },
  turkishBath: { type: Boolean },
  basement: { type: Boolean },
  withinSite: { type: Boolean },
  eligibleForCredit: { type: Boolean },
  exchange: { type: Boolean },

  // `default: undefined` keeps Mongoose from materialising an empty array on
  // every legacy property, so "no transport recorded" stays distinguishable
  // from "recorded as none nearby".
  nearbyTransport: {
    type: [{ type: String, enum: ['Metro', 'Metrobus', 'Bus', 'Ferry', 'Train', 'Tram', 'Highway Access'] }],
    default: undefined,
  },

  // Virtual tour. The URL is validated in the route (https + host allowlist)
  // and is only ever stored — nothing in this project embeds it.
  hasVirtualTour: { type: Boolean },
  virtualTourUrl: { type: String },
  /*
   * Write-time localized, the same shape and mechanism as TeamMember bios,
   * ShowroomImage captions and AboutContent prose: routes/properties.js runs
   * the admin's one plain-language sentence through localizeText() once, at
   * save time, so a visitor's page view never costs a translation call.
   *
   * localizedField() rather than a strict sub-schema ON PURPOSE. This is
   * `Mixed`, so the plain strings every property written before this change
   * still holds read back untouched instead of failing to cast against a
   * nested shape. Both forms are resolved by the same readers — unwrapLocalized
   * on the server, localizedText on the client — and
   * scripts/backfillPropertyDescriptions.js converts the legacy ones when you
   * choose to run it. Nothing breaks if you never do.
   *
   * No default text, so an unset description stays genuinely absent.
   */
  description: localizedField(),
  images: [{ type: String }],
  mainImage: { type: String },
  // LEGACY. Nothing writes this any more — the property routes strip it and
  // the admin form no longer offers the input. Kept because existing listings
  // still carry a name here and both clients fall back to it when no `agent`
  // is assigned. Stored values are left untouched; no migration, no erasure.
  agentName: { type: String },
  agentPhone: { type: String },
  // Server-derived from the assigned agent's User.email, never accepted from
  // the client. A copy, not a live link: if the agent changes their account
  // email this does not follow until the property is saved again.
  agentEmail: { type: String },
  whatsappNumber: { type: String },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  featured: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['Available', 'Sold', 'Rented', 'Pending'],
    default: 'Available',
  },

  /* ── Closing record ───────────────────────────────────────────────────
   *
   * The price actually achieved, kept DISTINCT from `price` so the asking
   * price stays as it was listed — a closed listing is only interesting next
   * to what it was originally offered at.
   *
   * Both optional, both without a default, and only meaningful once `status`
   * is Sold or Rented. Range-checked in routes/properties.js rather than here,
   * matching how `location`, `netSqm` and the rest of the detail fields are
   * handled: one authority for what a valid value is, in the route layer.
   *
   * Nothing is inferred from `status` alone — a listing marked Sold with no
   * soldPrice means "we did not record it", not "it sold for nothing".
   */
  soldPrice: { type: Number },
  soldDate: { type: Date },

  createdAt: { type: Date, default: Date.now },
  // Optional — populated by scripts/backfillPropertyEmbeddings.js for
  // semantic (meaning-based) lifestyle search. `default: undefined` keeps
  // Mongoose from auto-initializing this array field to `[]`, so it stays
  // genuinely absent on properties that haven't been embedded yet.
  descriptionEmbedding: {
    type: [Number],
    default: undefined,
  },
  embeddingUpdatedAt: { type: Date },
})

/*
 * The $text index behind searchByDescription and propertyNameResolver.
 *
 * `description` is listed TWICE, deliberately, because it now holds one of two
 * shapes. MongoDB's text index only indexes string values, so:
 *
 *   description       matches a legacy plain-string description, and is simply
 *                     ignored on a document where the value is an object.
 *   'description.en'  matches a localized one via its English copy — which
 *                     every localized description has, whatever language it
 *                     was typed in, because localizeText always fills `en`.
 *
 * Covering both means keyword search keeps working on migrated and
 * un-migrated properties alike, so running
 * scripts/backfillPropertyDescriptions.js is an improvement you can schedule
 * rather than a prerequisite. Indexing only `description.en` — which is what
 * a nested-only index would do — would make every un-migrated property
 * invisible to $text the moment this shipped.
 *
 * Equal weights on the two, since they are the same field in two storage
 * shapes and a document only ever matches through one of them.
 *
 * MIGRATION NOTE: this replaces an existing text index, and MongoDB permits
 * only one per collection. The old one must be dropped before this definition
 * can be created — scripts/backfillPropertyDescriptions.js does that via
 * Property.syncIndexes().
 */
propertySchema.index(
  {
    title: 'text',
    description: 'text',
    'description.en': 'text',
    district: 'text',
    address: 'text',
  },
  {
    weights: {
      description: 10,
      'description.en': 10,
      title: 5,
      district: 3,
      address: 2,
    },
  }
)

const Property = mongoose.model('Property', propertySchema)
export default Property
