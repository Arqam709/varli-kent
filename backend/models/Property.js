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
  agentName: { type: String },
  agentPhone: { type: String },
  agentEmail: { type: String },
  whatsappNumber: { type: String },
  featured: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['Available', 'Sold', 'Rented', 'Pending'],
    default: 'Available',
  },
  createdAt: { type: Date, default: Date.now },
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
