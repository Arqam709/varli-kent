import mongoose from 'mongoose'
import {
  CLIENT_ID_PATTERN,
  DESIGN_BOARD_LIMITS,
  DESIGN_BOARD_VERSION,
  DESIGN_LIGHTING_IDS,
  DESIGN_ROOM_IDS,
  DESIGN_STYLE_IDS,
  HEX_COLOR_PATTERN,
} from '../config/designBoardVocabulary.js'


const isHttpUrl = (value) => {
  if (value === undefined) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const finishSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: DESIGN_BOARD_LIMITS.label },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
}, { _id: false })

const materialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: DESIGN_BOARD_LIMITS.label },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
  // Absent when the material had no usable texture, never ''.
  image: {
    type: String,
    trim: true,
    maxlength: DESIGN_BOARD_LIMITS.image,
    validate: { validator: isHttpUrl, message: 'Image must be a valid HTTP(S) URL' },
  },
}, { _id: false })

const designBoardSchema = new mongoose.Schema({
  // Ownership. Always written from req.user._id, never from request input, and
  // immutable so no update path can reassign a board to another account.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
    immutable: true,
  },

  clientId: { type: String, match: CLIENT_ID_PATTERN, immutable: true },

  version: { type: Number, enum: [DESIGN_BOARD_VERSION], default: DESIGN_BOARD_VERSION },

  room: { type: String, required: true, enum: DESIGN_ROOM_IDS },
  style: { type: String, required: true, enum: DESIGN_STYLE_IDS },
  wall: { type: finishSchema, required: true },
  floor: { type: finishSchema, required: true },
  materials: {
    type: [materialSchema],
    default: [],
    validate: {
      validator: (value) => value.length <= DESIGN_BOARD_LIMITS.materials,
      message: `Materials must not contain more than ${DESIGN_BOARD_LIMITS.materials} entries`,
    },
  },
  lighting: { type: String, required: true, enum: DESIGN_LIGHTING_IDS },
}, { timestamps: true })

// The list query: one user's boards, most recently edited first.
designBoardSchema.index({ user: 1, updatedAt: -1 })

designBoardSchema.index(
  { user: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
)

const DesignBoard = mongoose.model('DesignBoard', designBoardSchema, 'designboards')
export default DesignBoard
