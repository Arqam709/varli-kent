import mongoose from 'mongoose'
import {
  ROOM_PHOTO_CONSENT_VERSION,
  ROOM_PHOTO_DELIVERY_TYPE,
  ROOM_PHOTO_OUTPUT_FORMAT,
  ROOM_PHOTO_PURGED_RECORD_TTL_SECONDS,
} from '../config/designRoomPhotos.js'

// A photo of a user's room, uploaded for Design My Space.
//
// One User owns many room photos, in their own collection (not an array on
// User). A photo is deliberately NOT tied to a DesignBoard: the same room can
// be visualized with different boards, and a future DesignGeneration will
// reference both a board and a photo.
//
// What is never stored: the original upload, any URL, EXIF/GPS, the original
// filename, the client's MIME type, or anything about AI processing.
//
// ── Lifecycle ───────────────────────────────────────────────────────────
//
//   uploading ──► ready ──► deleted ──(asset destroyed)──► purgedAt set
//       │                      ▲
//       └──────────────────────┘  (upload failed / stale / expired)
//
// `deleted` hides a photo immediately; `purgedAt` records that the Cloudinary
// asset is actually gone. A MongoDB TTL index only ever removes records that
// are ALREADY purged — it is never what deletes a room photo from Cloudinary.

export const ROOM_PHOTO_STATUSES = ['uploading', 'ready', 'deleted']

const assetSchema = new mongoose.Schema({
  // The Cloudinary public ID. The ONLY link to the stored image; never sent to
  // a client. Built by the server from this record's own _id.
  publicId: { type: String, required: true, immutable: true, maxlength: 256 },
  // Needed to sign delivery and to destroy the asset, and kept per record so
  // photos stored under an older access mode stay reachable and deletable.
  deliveryType: { type: String, required: true, immutable: true, enum: [ROOM_PHOTO_DELIVERY_TYPE] },
  // Always our pipeline's output format; recorded so a future format change
  // does not break older photos.
  format: { type: String, required: true, immutable: true, enum: [ROOM_PHOTO_OUTPUT_FORMAT] },
}, { _id: false })

const designRoomPhotoSchema = new mongoose.Schema({
  // Ownership. Always written from req.user._id, never from request input.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  },

  asset: { type: assetSchema, required: true },

  // Of the NORMALIZED image, measured by sharp on the server — never reported
  // by the client. Lets a UI lay the photo out before downloading it, and is
  // the aspect-ratio input a visualization provider will need.
  width: { type: Number, required: true, immutable: true, min: 1, validate: Number.isSafeInteger },
  height: { type: Number, required: true, immutable: true, min: 1, validate: Number.isSafeInteger },
  // Stored size, for storage accounting per user.
  bytes: { type: Number, required: true, immutable: true, min: 1, validate: Number.isSafeInteger },

  status: { type: String, required: true, enum: ROOM_PHOTO_STATUSES, default: 'uploading' },

  // Which room-photo notice the user accepted for THIS photo.
  consentVersion: { type: String, required: true, immutable: true, enum: [ROOM_PHOTO_CONSENT_VERSION] },

  // The latest moment this photo may still exist; the sweep deletes it after.
  expiresAt: { type: Date, required: true },

  // When the photo stopped being available (user, retention, failed upload).
  deletedAt: { type: Date, default: null },
  // When the Cloudinary asset was confirmed destroyed.
  purgedAt: { type: Date, default: null },
}, { timestamps: true })

// Every user-facing query, and the per-user limits (stored count, uploads per day).
designRoomPhotoSchema.index({ user: 1, status: 1, createdAt: -1 })

// The sweep: deleted-but-not-purged, stale uploads and expired photos.
designRoomPhotoSchema.index({ status: 1, purgedAt: 1 })
designRoomPhotoSchema.index({ status: 1, expiresAt: 1 })
designRoomPhotoSchema.index({ status: 1, createdAt: 1 })

// Removes a record only once its image is gone. Documents with purgedAt null
// are never touched by this index.
designRoomPhotoSchema.index({ purgedAt: 1 }, { expireAfterSeconds: ROOM_PHOTO_PURGED_RECORD_TTL_SECONDS })

// A second record pointing at the same asset would let one deletion orphan the other.
designRoomPhotoSchema.index({ 'asset.publicId': 1 }, { unique: true })

const DesignRoomPhoto = mongoose.model('DesignRoomPhoto', designRoomPhotoSchema, 'designroomphotos')
export default DesignRoomPhoto
