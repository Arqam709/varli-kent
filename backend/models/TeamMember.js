import mongoose from 'mongoose'
import {
  isLocalizedObject,
  isUsableText,
  localizedField,
  resolveLocalized,
} from '../utils/localizedField.js'

const normalizeTeamRole = (value) =>
  typeof value === 'string' ? value.trim() : value

const isValidTeamRole = (value) => {
  if (typeof value === 'string') return isUsableText(value)
  return isLocalizedObject(value) && isUsableText(resolveLocalized(value))
}


const MAX_IMAGE_URL_LENGTH = 2048

const isValidImageUrl = (value) => {
  if (typeof value !== 'string') return false
  if (value.length > MAX_IMAGE_URL_LENGTH) return false
  if (value === '') return true
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const MAX_WORK_IMAGES = 24

const isValidWorkImages = (value) =>
  Array.isArray(value) && value.length <= MAX_WORK_IMAGES && value.every(isValidImageUrl)

const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  role: {
    ...localizedField(),
    required: true,
    set: normalizeTeamRole,
    validate: {
      validator: isValidTeamRole,
      message: 'Role must contain usable text',
    },
  },
  bio: localizedField(),

  photo: { type: String, default: '' },
  secondaryPhoto: {
    type: String,
    default: '',
    trim: true,
    validate: { validator: isValidImageUrl, message: 'Secondary photo must be empty or a valid image URL' },
  },
  longBio: localizedField(),

  workImages: {
    type: [String],
    default: undefined,
    validate: { validator: isValidWorkImages, message: `Work images must be at most ${MAX_WORK_IMAGES} valid image URLs` },
  },
  
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('TeamMember', teamMemberSchema)
