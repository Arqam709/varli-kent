//property
import mongoose from 'mongoose'

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
  currency: { type: String, enum: ['TL', 'USD', 'EUR', 'GBP'], default: 'USD' },

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
  description: { type: String },
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

propertySchema.index(
  {
    title: 'text',
    description: 'text',
    district: 'text',
    address: 'text',
  },
  {
    weights: {
      description: 10,
      title: 5,
      district: 3,
      address: 2,
    },
  }
)

const Property = mongoose.model('Property', propertySchema)
export default Property
