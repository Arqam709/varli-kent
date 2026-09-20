import express from 'express'
import mongoose from 'mongoose'
import DesignRoomPhoto from '../models/DesignRoomPhoto.js'
import { protect } from '../middleware/auth.js'
import { receiveRoomPhoto } from '../middleware/roomPhotoUpload.js'
import { normalizeRoomPhoto, RoomPhotoError } from '../services/designRoomPhotos/imagePipeline.js'
import { openRoomPhotoStream, roomPhotoPublicId, uploadRoomPhoto } from '../services/designRoomPhotos/storage.js'
import { purgeRoomPhotoAsset, releaseGenerationsForDeletedRoomPhoto } from '../services/designRoomPhotos/lifecycle.js'
import {
  ROOM_PHOTO_CONSENT_VERSION,
  ROOM_PHOTO_DELIVERY_TYPE,
  ROOM_PHOTO_MAX_STORED_PER_USER,
  ROOM_PHOTO_MAX_UPLOADS_PER_DAY,
  ROOM_PHOTO_OUTPUT_CONTENT_TYPE,
  ROOM_PHOTO_RETENTION_DAYS,
} from '../config/designRoomPhotos.js'

const router = express.Router()

// Design My Space room photos for the signed-in user.
//
// The DesignBoard ownership rule: every route is behind `protect`, and every
// query carries `user: req.user._id`. Another user's photo id and a malformed
// id get the same 404. The owner is never read from the request.
//
// A photo is only ever the SOURCE image. Visualizations live in their own
// collection (DesignGeneration), reference photos by id, and store their
// generated image separately — nothing here is ever overwritten by a result.

const NOT_FOUND = 'Room photo not found'
const DAY_MS = 24 * 60 * 60 * 1000

const notFound = (res) => res.status(404).json({ success: false, message: NOT_FOUND })

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message })

/** What a client may know about a photo: never the storage identity or a URL. */
export const publicRoomPhoto = (photo) => ({
  _id: photo._id,
  status: photo.status,
  width: photo.width,
  height: photo.height,
  format: photo.asset.format,
  createdAt: photo.createdAt,
  expiresAt: photo.expiresAt,
})

/** Only `ready` photos exist as far as their owner is concerned. */
const findOwnedReadyPhoto = (req) => DesignRoomPhoto.findOne({
  _id: req.params.id,
  user: req.user._id,
  status: 'ready',
})

/**
 * Per-user limits, counted in MongoDB before any of the body is read, so a
 * user over a limit costs no upload buffering and no image decoding.
 */
async function enforceUploadLimits(req, res, next) {
  try {
    const user = req.user._id
    const stored = await DesignRoomPhoto.countDocuments({ user, status: { $in: ['uploading', 'ready'] } })
    if (stored >= ROOM_PHOTO_MAX_STORED_PER_USER) {
      return fail(res, 400, 'ROOM_PHOTO_LIMIT_REACHED',
        `You can keep up to ${ROOM_PHOTO_MAX_STORED_PER_USER} room photos. Remove one to add another.`)
    }

    const today = await DesignRoomPhoto.countDocuments({ user, createdAt: { $gte: new Date(Date.now() - DAY_MS) } })
    if (today >= ROOM_PHOTO_MAX_UPLOADS_PER_DAY) {
      return fail(res, 429, 'ROOM_PHOTO_DAILY_LIMIT', 'You have added many room photos today. Please try again tomorrow.')
    }
    next()
  } catch (err) {
    next(err)
  }
}

// POST /api/design-room-photos — multipart: consentVersion, then photo.
router.post('/', protect, enforceUploadLimits, receiveRoomPhoto, async (req, res, next) => {
  // Re-checked after parsing: a request with no file never reached the filter.
  if (req.body?.consentVersion !== ROOM_PHOTO_CONSENT_VERSION) {
    return fail(res, 400, 'CONSENT_REQUIRED', 'Please accept the room photo notice before uploading.')
  }
  if (!req.file?.buffer?.length) {
    return fail(res, 400, 'PHOTO_REQUIRED', 'A room photo is required.')
  }

  let normalized
  try {
    normalized = await normalizeRoomPhoto(req.file.buffer)
  } catch (err) {
    if (err instanceof RoomPhotoError) return fail(res, err.status, err.code, err.message)
    return next(err)
  } finally {
    // Drop the original bytes as early as possible; they are never stored.
    req.file.buffer = null
  }

  // The record is written BEFORE the upload. If this process dies mid-upload,
  // an `uploading` record — with the exact public ID — is left for the sweep
  // to clean up, instead of an asset nothing in MongoDB knows about.
  const photoId = new mongoose.Types.ObjectId()
  const publicId = roomPhotoPublicId(photoId)
  const now = new Date()

  let photo
  try {
    photo = await DesignRoomPhoto.create({
      _id: photoId,
      user: req.user._id,
      asset: { publicId, deliveryType: ROOM_PHOTO_DELIVERY_TYPE, format: normalized.format },
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.bytes,
      status: 'uploading',
      consentVersion: ROOM_PHOTO_CONSENT_VERSION,
      expiresAt: new Date(now.getTime() + ROOM_PHOTO_RETENTION_DAYS * DAY_MS),
    })
  } catch (err) {
    return next(err) // nothing was uploaded yet
  }

  try {
    await uploadRoomPhoto(publicId, normalized.buffer)
  } catch {
    // The upload may still have landed (e.g. a timeout after Cloudinary stored
    // it). Mark the record deleted; purging destroys the asset if it exists.
    await abandonUpload(photo)
    return fail(res, 502, 'ROOM_PHOTO_STORAGE_FAILED', 'Your photo could not be saved. Please try again.')
  }

  try {
    // Conditional: if the sweep already gave up on this upload, do not revive it.
    const ready = await DesignRoomPhoto.findOneAndUpdate(
      { _id: photoId, user: req.user._id, status: 'uploading' },
      { $set: { status: 'ready' } },
      { returnDocument: 'after' }
    )
    if (!ready) {
      await abandonUpload(photo)
      return fail(res, 502, 'ROOM_PHOTO_STORAGE_FAILED', 'Your photo could not be saved. Please try again.')
    }
    return res.status(201).json({ success: true, photo: publicRoomPhoto(ready) })
  } catch (err) {
    // The asset exists but the record is still `uploading`: the sweep will
    // mark it stale and destroy the asset. The user sees a failure, not a
    // photo that might vanish.
    return next(err)
  }
})

/** Best effort: hide a failed upload and destroy whatever may have been stored. */
async function abandonUpload(photo) {
  try {
    const deleted = await DesignRoomPhoto.findOneAndUpdate(
      { _id: photo._id, status: 'uploading' },
      { $set: { status: 'deleted', deletedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (deleted) await purgeRoomPhotoAsset(deleted)
  } catch {
    // Still `uploading`: the stale-upload sweep covers it.
  }
}

router.get('/', protect, async (req, res, next) => {
  try {
    const photos = await DesignRoomPhoto.find({ user: req.user._id, status: 'ready' })
      .sort({ createdAt: -1 })
      .limit(ROOM_PHOTO_MAX_STORED_PER_USER)
    res.json({ success: true, photos: photos.map(publicRoomPhoto) })
  } catch (err) {
    next(err)
  }
})

// GET /api/design-room-photos/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res)
    const photo = await findOwnedReadyPhoto(req)
    if (!photo) return notFound(res)
    res.json({ success: true, photo: publicRoomPhoto(photo) })
  } catch (err) {
    next(err)
  }
})



// GET /api/design-room-photos/:id/image — the image bytes, for the owner only.
router.get('/:id/image', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res)
    const photo = await findOwnedReadyPhoto(req)
    if (!photo) return notFound(res)

    let image
    try {
      image = await openRoomPhotoStream(photo.asset.publicId, {
        deliveryType: photo.asset.deliveryType,
        format: photo.asset.format,
      })
    } catch {
      return fail(res, 502, 'ROOM_PHOTO_UNAVAILABLE', 'This room photo is temporarily unavailable.')
    }

    res.status(200)
    res.set({
      // Our own pipeline's format, not whatever the upstream said.
      'Content-Type': ROOM_PHOTO_OUTPUT_CONTENT_TYPE,
      // A private photo: no shared cache may keep it, and the device is not
      // asked to store it either.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    })
    if (image.contentLength) res.set('Content-Length', String(image.contentLength))

    image.stream.on('error', () => res.destroy())
    image.stream.pipe(res)
  } catch (err) {
    next(err)
  }
})



// DELETE /api/design-room-photos/:id
router.delete('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res)

    // Logical deletion first, scoped to the owner: from this moment the photo
    // is gone from every endpoint, whatever happens to the physical delete.
    const photo = await DesignRoomPhoto.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, status: 'ready' },
      { $set: { status: 'deleted', deletedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (!photo) return notFound(res)

    // Visualizations still waiting on this photo can no longer run. Finished
    // ones keep their own history and their own result asset.
    await releaseGenerationsForDeletedRoomPhoto(photo._id)

    // Physical deletion; a failure is retried by the sweep, not reported as
    // "not deleted" — the user's photo is already unavailable.
    const purged = await purgeRoomPhotoAsset(photo)
    res.json({ success: true, message: 'Room photo deleted', purged })
  } catch (err) {
    next(err)
  }
})

export default router
