import mongoose from 'mongoose'
import {
  DESIGN_GENERATION_ERROR_CODES,
  DESIGN_GENERATION_IDEMPOTENCY_KEY_PATTERN,
  DESIGN_GENERATION_PURGED_RECORD_TTL_SECONDS,
  DESIGN_GENERATION_STATUSES,
} from '../config/designGenerations.js'
import {
  DESIGN_BOARD_LIMITS,
  DESIGN_BOARD_VERSION,
  DESIGN_LIGHTING_IDS,
  DESIGN_ROOM_IDS,
  DESIGN_STYLE_IDS,
  HEX_COLOR_PATTERN,
} from '../config/designBoardVocabulary.js'

const finishSnapshotSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: DESIGN_BOARD_LIMITS.label },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
}, { _id: false })

const materialSnapshotSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: DESIGN_BOARD_LIMITS.label },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
  image: { type: String, trim: true, maxlength: DESIGN_BOARD_LIMITS.image },
}, { _id: false })

const boardSnapshotSchema = new mongoose.Schema({
  version: { type: Number, required: true, enum: [DESIGN_BOARD_VERSION] },
  room: { type: String, required: true, enum: DESIGN_ROOM_IDS },
  style: { type: String, required: true, enum: DESIGN_STYLE_IDS },
  wall: { type: finishSnapshotSchema, required: true },
  floor: { type: finishSnapshotSchema, required: true },
  materials: {
    type: [materialSnapshotSchema],
    default: [],
    validate: {
      validator: (value) => value.length <= DESIGN_BOARD_LIMITS.materials,
      message: `A board snapshot may not hold more than ${DESIGN_BOARD_LIMITS.materials} materials`,
    },
  },
  lighting: { type: String, required: true, enum: DESIGN_LIGHTING_IDS },
}, { _id: false })

/**
 * The generated image, once one exists.
 *
 * Phase 1 never writes this: no provider runs, so no result can be real, and a
 * generation without it can never be `succeeded`. Phase 2 fills it in with a
 * PRIVATE asset of its own — separate from the room photo, which keeps its own
 * asset and its own lifecycle. None of these fields is ever sent to a client.
 */
const resultAssetSchema = new mongoose.Schema({
  publicId: { type: String, required: true, maxlength: 256 },
  deliveryType: { type: String, required: true },
  format: { type: String, required: true },
  width: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  height: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  bytes: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false })

const designGenerationSchema = new mongoose.Schema({
  // Ownership. Always from req.user._id, never from request input.
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },

  // Which board this came from. Kept even if that board is later edited or
  // deleted, which is why the snapshot below is what describes the design.
  board: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignBoard', required: true, immutable: true },
  boardSnapshot: { type: boardSnapshotSchema, required: true, immutable: true },

  // The source image. Its bytes stay owned by DesignRoomPhoto; this is only a
  // reference, so a result never overwrites the original.
  roomPhoto: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignRoomPhoto', required: true, immutable: true },

  status: { type: String, required: true, enum: DESIGN_GENERATION_STATUSES, default: 'queued' },

  // Which prompt-building logic this generation belongs to. The prompt TEXT is
  // deliberately not stored (see services/designGenerations/prompt.js).
  promptVersion: { type: String, required: true, immutable: true, maxlength: 64 },

  // Scoped to the user by the unique index below, so one person's key can
  // never affect another's.
  idempotencyKey: { type: String, required: true, immutable: true, match: DESIGN_GENERATION_IDEMPOTENCY_KEY_PATTERN },

  // Job bookkeeping. `leaseUntil` is what stops two workers running one job.
  attempts: { type: Number, default: 0, min: 0 },
  leaseUntil: { type: Date, default: null },

  result: { type: resultAssetSchema, default: null },
  error: {
    code: { type: String, enum: DESIGN_GENERATION_ERROR_CODES, default: undefined },
    // Whether the worker may try again; not shown to the client.
    retryable: { type: Boolean, default: undefined },
  },

  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  deletedAt: { type: Date, default: null },
  purgedAt: { type: Date, default: null },
}, { timestamps: true })

designGenerationSchema.index({ user: 1, status: 1, createdAt: -1 })

designGenerationSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true })

designGenerationSchema.index({ status: 1, leaseUntil: 1, createdAt: 1 })

designGenerationSchema.index({ status: 1, expiresAt: 1 })

designGenerationSchema.index({ status: 1, purgedAt: 1 })

designGenerationSchema.index({ roomPhoto: 1, status: 1 })

designGenerationSchema.index({ purgedAt: 1 }, { expireAfterSeconds: DESIGN_GENERATION_PURGED_RECORD_TTL_SECONDS })

const DesignGeneration = mongoose.model('DesignGeneration', designGenerationSchema, 'designgenerations')
export default DesignGeneration
