import mongoose from 'mongoose'
import { CONTACT_INTEREST_ID_PATTERN, CONTACT_INTEREST_LIMITS } from '../config/contactInterests.js'

const optionalLabel = () => ({
  type: String,
  trim: true,
  maxlength: [CONTACT_INTEREST_LIMITS.label, `Labels must not exceed ${CONTACT_INTEREST_LIMITS.label} characters`],
})

const labelsSchema = new mongoose.Schema({
  en: { ...optionalLabel(), required: [true, 'An English label is required'] },
  tr: optionalLabel(),
  ar: optionalLabel(),
  de: optionalLabel(),
  ru: optionalLabel(),
  ur: optionalLabel(),
}, { _id: false })

const contactInterestSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    match: [CONTACT_INTEREST_ID_PATTERN, 'id must start with a lowercase letter and contain only a–z, 0–9 and _'],
    maxlength: CONTACT_INTEREST_LIMITS.id,
  },
  value: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    trim: true,
    maxlength: CONTACT_INTEREST_LIMITS.value,
  },
  labels: { type: labelsSchema, required: true },
  order: {
    type: Number,
    required: true,
    min: 0,
    max: CONTACT_INTEREST_LIMITS.order,
    validate: { validator: Number.isInteger, message: 'order must be a whole number' },
  },
  enabled: { type: Boolean, default: true },
}, {
  timestamps: true,
  // This schema has its own `id` field. Mongoose would otherwise add an `id`
  // virtual returning the ObjectId string; a real `id` path already suppresses
  // that, and this makes the intent explicit.
  id: false,
})

export default mongoose.model('ContactInterest', contactInterestSchema)
