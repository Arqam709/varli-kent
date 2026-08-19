import mongoose from 'mongoose'

const PAGE_KEYS = ['renovation', 'interior-design']
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

const isHttpUrl = (value) => {
  if (value === '') return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const materialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
  image: {
    type: String,
    default: '',
    trim: true,
    maxlength: 2048,
    validate: {
      validator: isHttpUrl,
      message: 'Image must be empty or a valid HTTP(S) URL',
    },
  },
}, { _id: false })

const finishSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
}, { _id: false })

const studioPaletteSchema = new mongoose.Schema({
  pageKey: {
    type: String,
    required: true,
    unique: true,
    enum: PAGE_KEYS,
  },
  materials: {
    type: [materialSchema],
    default: undefined,
    validate: {
      validator: (value) => value === undefined || (value.length >= 1 && value.length <= 24),
      message: 'Materials must contain between 1 and 24 entries',
    },
  },
  wallFinishes: {
    type: [finishSchema],
    default: undefined,
    validate: {
      validator: (value) => value === undefined || (value.length >= 1 && value.length <= 16),
      message: 'Wall finishes must contain between 1 and 16 entries',
    },
  },
  floorFinishes: {
    type: [finishSchema],
    default: undefined,
    validate: {
      validator: (value) => value === undefined || (value.length >= 1 && value.length <= 16),
      message: 'Floor finishes must contain between 1 and 16 entries',
    },
  },
}, { timestamps: true })

export default mongoose.model('StudioPalette', studioPaletteSchema)
