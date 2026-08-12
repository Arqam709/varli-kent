//property
import mongoose from 'mongoose'

const propertySchema = new mongoose.Schema({
  title: { type: String, required: true },
  listingType: { type: String, enum: ['Sale', 'Rent'], required: true },
  price: { type: Number, required: true },
  priceLabel: { type: String },
  district: { type: String, required: true },
  address: { type: String, required: true },
  propertyType: {
    type: String,
    enum: ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm'],
    default: 'Apartment',
  },
  beds: { type: Number, required: true },
  baths: { type: Number, required: true },
  sqm: { type: Number, required: true },
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
