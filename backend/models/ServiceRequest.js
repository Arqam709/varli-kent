import mongoose from 'mongoose'
import {
  BUDGET_LABELS,
  INTERIOR_ROOM_LABELS,
  PROPERTY_TYPE_LABELS,
  RENOVATION_AREA_LABELS,
  RENOVATION_WORK_LABELS,
  SERVICE_REQUEST_IDEMPOTENCY_KEY_PATTERN,
  SERVICE_REQUEST_LIMITS,
  SERVICE_REQUEST_PHOTO_KINDS,
  SERVICE_REQUEST_TYPES,
  TIMELINE_LABELS,
} from '../config/serviceRequests.js'
import {
  DESIGN_BOARD_LIMITS,
  DESIGN_BOARD_VERSION,
  DESIGN_LIGHTING_IDS,
  DESIGN_ROOM_IDS,
  DESIGN_STYLE_IDS,
  HEX_COLOR_PATTERN,
} from '../config/designBoardVocabulary.js'

// A structured Interior Design or Renovation request from the mobile app.
//
// ── One model, two types ─────────────────────────────────────────────────
// Both types share everything that matters to how a request LIVES: who owns
// it, how the customer is reached, the property, budget, timeline, photos, the
// linked lead, idempotency and the customer's "My Requests" list. Only a small
// block is specific to each (`interiorDesign`, `renovation`), so two unrelated
// collections would duplicate the whole lifecycle for two or three fields.
//
// ── A record of what was ASKED FOR ───────────────────────────────────────
// Everything here is written once, at submission, and never edited: a request
// is a business record, not a live view of the customer's data. That is why an
// Interior Design request stores a SNAPSHOT of the board it came from, and its
// OWN copies of the room photo and visualization (see `photos`) — the originals
// can be edited, deleted by the user, or expire (room photos after 30 days,
// visualizations after 90), and none of that may change or empty a request.
//
// The customer-facing status is NOT stored: it is derived from the linked
// ContactSubmission, which is what Varlikent staff actually work in. See
// CONTACT_STATUS_TO_REQUEST_STATUS.

const ids = (labels) => Object.keys(labels)

/** One private image owned by this request. */
const photoSchema = new mongoose.Schema({
  kind: { type: String, required: true, enum: SERVICE_REQUEST_PHOTO_KINDS },
  publicId: { type: String, required: true, maxlength: 256 },
  deliveryType: { type: String, required: true },
  format: { type: String, required: true },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
  bytes: { type: Number, required: true, min: 1 },
})

const finishSnapshotSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: DESIGN_BOARD_LIMITS.label },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
}, { _id: false })

const materialSnapshotSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: DESIGN_BOARD_LIMITS.label },
  color: { type: String, required: true, match: HEX_COLOR_PATTERN },
}, { _id: false })

/** The board's choices AS THEY WERE when the customer asked for this design. */
const designSnapshotSchema = new mongoose.Schema({
  version: { type: Number, required: true, enum: [DESIGN_BOARD_VERSION] },
  room: { type: String, required: true, enum: DESIGN_ROOM_IDS },
  style: { type: String, required: true, enum: DESIGN_STYLE_IDS },
  wall: { type: finishSnapshotSchema, required: true },
  floor: { type: finishSnapshotSchema, required: true },
  materials: { type: [materialSnapshotSchema], default: [] },
  lighting: { type: String, required: true, enum: DESIGN_LIGHTING_IDS },
}, { _id: false })

const interiorDesignSchema = new mongoose.Schema({
  rooms: {
    type: [{ type: String, enum: ids(INTERIOR_ROOM_LABELS) }],
    validate: { validator: (value) => value.length >= 1, message: 'Choose at least one room' },
  },
  // Present only for a request made FROM a design. The ids are references for
  // traceability and may later point at nothing (the user deleted the board,
  // or the photo/visualization expired); the snapshot and the photo copies are
  // what the request actually relies on.
  design: {
    type: new mongoose.Schema({
      board: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignBoard', default: null },
      generation: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignGeneration', default: null },
      roomPhoto: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignRoomPhoto', default: null },
      snapshot: { type: designSnapshotSchema, required: true },
    }, { _id: false }),
    default: null,
  },
}, { _id: false })

const renovationSchema = new mongoose.Schema({
  areas: {
    type: [{ type: String, enum: ids(RENOVATION_AREA_LABELS) }],
    validate: { validator: (value) => value.length >= 1, message: 'Choose at least one area' },
  },
  work: {
    type: [{ type: String, enum: ids(RENOVATION_WORK_LABELS) }],
    validate: { validator: (value) => value.length >= 1, message: 'Choose at least one kind of work' },
  },
}, { _id: false })

const serviceRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  type: { type: String, required: true, enum: SERVICE_REQUEST_TYPES, immutable: true },

  // How to reach the customer, as they confirmed it on the form.
  contact: {
    name: { type: String, required: true, trim: true, maxlength: SERVICE_REQUEST_LIMITS.name },
    email: { type: String, required: true, trim: true, maxlength: SERVICE_REQUEST_LIMITS.email },
    phone: { type: String, required: true, trim: true, maxlength: SERVICE_REQUEST_LIMITS.phone },
  },

  property: {
    type: { type: String, required: true, enum: ids(PROPERTY_TYPE_LABELS) },
    sizeSqm: { type: Number, default: null, min: SERVICE_REQUEST_LIMITS.minSqm, max: SERVICE_REQUEST_LIMITS.maxSqm },
    district: { type: String, default: '', trim: true, maxlength: SERVICE_REQUEST_LIMITS.district },
  },

  budget: { type: String, required: true, enum: ids(BUDGET_LABELS) },
  timeline: { type: String, required: true, enum: ids(TIMELINE_LABELS) },
  notes: { type: String, default: '', trim: true, maxlength: SERVICE_REQUEST_LIMITS.notes },

  interiorDesign: { type: interiorDesignSchema, default: null },
  renovation: { type: renovationSchema, default: null },

  photos: { type: [photoSchema], default: [] },

  // The ordinary lead this request created. Null only while the submit is in
  // flight; an admin may later delete the submission, which is read as closed.
  contactSubmission: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactSubmission', default: null },

  idempotencyKey: {
    type: String,
    required: true,
    immutable: true,
    match: SERVICE_REQUEST_IDEMPOTENCY_KEY_PATTERN,
  },
}, { timestamps: true })

// "My Requests", newest first.
serviceRequestSchema.index({ user: 1, createdAt: -1 })
// A retried submit finds the request it already created instead of making another.
serviceRequestSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true })

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema, 'servicerequests')
export default ServiceRequest
