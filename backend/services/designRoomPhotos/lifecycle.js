// Room photo deletion, retention and cleanup.
//
// Two steps, always in this order:
//
//   1. LOGICAL  status → 'deleted', deletedAt set.  The photo disappears from
//               every API response immediately. Needs only MongoDB.
//   2. PHYSICAL the Cloudinary asset is destroyed, then purgedAt is set.
//               Needs Cloudinary, may fail, and is retried by the sweep.
//
// A MongoDB TTL index is NOT part of deleting a photo: it only removes records
// whose asset is already confirmed destroyed (see models/DesignRoomPhoto.js).
//
// Every operation here is idempotent and uses conditional updates, so
// overlapping calls — a user delete racing the sweep, two instances, a retry
// after a crash — converge on the same end state.

import DesignRoomPhoto from '../../models/DesignRoomPhoto.js'
import { destroyRoomPhoto } from './storage.js'
import { failGenerationsForRoomPhoto } from '../designGenerations/generationState.js'
import {
  ROOM_PHOTO_STALE_UPLOAD_MS,
  ROOM_PHOTO_SWEEP_BATCH_SIZE,
  ROOM_PHOTO_SWEEP_FIRST_RUN_MS,
  ROOM_PHOTO_SWEEP_INTERVAL_MS,
} from '../../config/designRoomPhotos.js'

const LIVE_STATUSES = ['uploading', 'ready']

/**
 * Physically removes one logically deleted photo's asset.
 *
 * @returns {Promise<boolean>} true when the asset is confirmed gone
 */
export async function purgeRoomPhotoAsset(photo) {
  if (!photo || photo.status !== 'deleted' || photo.purgedAt) return Boolean(photo?.purgedAt)

  try {
    await destroyRoomPhoto(photo.asset.publicId, photo.asset.deliveryType)
  } catch {
    // Left unpurged on purpose; the sweep will try again.
    return false
  }

  await DesignRoomPhoto.updateOne(
    { _id: photo._id, status: 'deleted', purgedAt: null },
    { $set: { purgedAt: new Date() } }
  )
  return true
}

/**
 * Ends the unfinished visualizations that depend on a photo being deleted.
 *
 * A queued or processing generation cannot run without its source image.
 * Finished ones are untouched: a succeeded generation owns a SEPARATE result
 * asset, so its history survives the original photo.
 */
export async function releaseGenerationsForDeletedRoomPhoto(photoId) {
  try {
    return await failGenerationsForRoomPhoto(photoId)
  } catch (err) {
    // Never block a deletion the user asked for; the sweep fails these jobs
    // anyway once they can no longer run.
    console.error(`[room-photos] could not release visualizations for a deleted photo: ${err.message}`)
    return 0
  }
}

/**
 * Hides every live photo a user owns, then tries to destroy the assets.
 *
 * For permanent account deletion. The logical step throws on a database
 * error, so the caller can refuse to delete the account while that user's
 * photos are still visible; physical failures are left for the sweep.
 *
 * @returns {Promise<{ deleted: number, purged: number, pending: number }>}
 */
export async function deleteAllRoomPhotosForUser(userId) {
  const now = new Date()
  const { modifiedCount = 0 } = await DesignRoomPhoto.updateMany(
    { user: userId, status: { $in: LIVE_STATUSES } },
    { $set: { status: 'deleted', deletedAt: now } }
  )

  const unpurged = await DesignRoomPhoto.find({ user: userId, status: 'deleted', purgedAt: null })
  let purged = 0
  for (const photo of unpurged) {
    if (await purgeRoomPhotoAsset(photo)) purged += 1
  }
  return { deleted: modifiedCount, purged, pending: unpurged.length - purged }
}

/**
 * One cleanup pass. Safe to run at any time, any number of times.
 *
 *   1. uploads stuck in 'uploading' past the stale timeout → deleted
 *      (their request crashed; the asset may or may not exist)
 *   2. ready photos past expiresAt → deleted (retention)
 *   3. up to one batch of deleted-but-unpurged photos → assets destroyed
 */
export async function sweepRoomPhotos({ now = new Date() } = {}) {
  const stale = await DesignRoomPhoto.updateMany(
    { status: 'uploading', createdAt: { $lt: new Date(now.getTime() - ROOM_PHOTO_STALE_UPLOAD_MS) } },
    { $set: { status: 'deleted', deletedAt: now } }
  )
  const expired = await DesignRoomPhoto.updateMany(
    { status: 'ready', expiresAt: { $lte: now } },
    { $set: { status: 'deleted', deletedAt: now } }
  )

  const batch = await DesignRoomPhoto.find({ status: 'deleted', purgedAt: null })
    .sort({ deletedAt: 1 })
    .limit(ROOM_PHOTO_SWEEP_BATCH_SIZE)

  let purged = 0
  for (const photo of batch) {
    if (await purgeRoomPhotoAsset(photo)) purged += 1
  }

  return {
    staleUploads: stale.modifiedCount ?? 0,
    expired: expired.modifiedCount ?? 0,
    purged,
    failed: batch.length - purged,
  }
}

/* ── The in-process sweep ──────────────────────────────────────────────── */

let timer = null
let firstRun = null
let running = false

/** Runs one sweep unless one is already running in this process. Never throws. */
export async function runRoomPhotoSweepOnce() {
  if (running) return null
  running = true
  try {
    const result = await sweepRoomPhotos()
    if (result.staleUploads || result.expired || result.purged || result.failed) {
      // Counts only — no ids, public IDs or URLs.
      console.log(
        `[room-photos] sweep: ${result.staleUploads} stale, ${result.expired} expired, ${result.purged} purged, ${result.failed} awaiting retry`
      )
    }
    return result
  } catch (err) {
    console.error(`[room-photos] sweep failed: ${err.message}`)
    return null
  } finally {
    running = false
  }
}

/**
 * Starts the periodic sweep. Returns immediately and never blocks startup.
 *
 * Render can put the service to sleep, and every restart resets the timer, so
 * cleanup is eventual rather than scheduled: an expired or deleted photo is
 * purged on the first sweep after the process is awake again. Timers are
 * unref'd so they never keep the process alive on their own.
 */
export function startRoomPhotoSweeper() {
  if (timer || firstRun) return
  firstRun = setTimeout(() => {
    firstRun = null
    void runRoomPhotoSweepOnce()
    timer = setInterval(() => void runRoomPhotoSweepOnce(), ROOM_PHOTO_SWEEP_INTERVAL_MS)
    timer.unref?.()
  }, ROOM_PHOTO_SWEEP_FIRST_RUN_MS)
  firstRun.unref?.()
}

/** Test seam. */
export function stopRoomPhotoSweeper() {
  clearTimeout(firstRun)
  clearInterval(timer)
  firstRun = null
  timer = null
}
