// The generation state machine and the job boundary.
//
// Status is changed HERE and nowhere else: routes create and delete, the
// (future) worker claims and finishes, and the sweep recovers. No route
// handler ever writes `status` directly, and no client value reaches it.
//
//        create                claim                 provider result
//   ──────────────▶ queued ──────────────▶ processing ──────────────▶ succeeded
//                     │                      │  │
//                     │                      │  └── lease expired ──▶ queued
//                     │                      │        (attempts left)
//                     └───────── failed ◀────┘
//                                  ▲
//                     never claimed in time
//
//   any non-deleted status ──── user deletes ────▶ deleted
//
// ── Concurrency ────────────────────────────────────────────────────────
// A claim is ONE atomic findOneAndUpdate whose filter includes the status and
// the lease. Two workers racing for the same generation issue the same update;
// MongoDB applies them one at a time, so the second no longer matches and the
// loser simply gets the next job. A worker that dies mid-job leaves a lease
// that expires, and the sweep returns the generation to the queue (or fails it
// once its attempts are spent). No Redis, no external queue: at this scale the
// collection IS the queue.

import DesignGeneration from '../../models/DesignGeneration.js'
import {
  DESIGN_GENERATION_ACTIVE_STATUSES,
  DESIGN_GENERATION_LEASE_MS,
  DESIGN_GENERATION_MAX_ATTEMPTS,
  DESIGN_GENERATION_TRANSITIONS,
} from '../../config/designGenerations.js'

/** Whether the state machine allows this move at all. Pure. */
export function canTransitionGeneration(from, to) {
  return Boolean(DESIGN_GENERATION_TRANSITIONS[from]?.includes(to))
}

export const isActiveGenerationStatus = (status) => DESIGN_GENERATION_ACTIVE_STATUSES.includes(status)

/**
 * Claims the oldest waiting generation for one worker.
 *
 * Matches a queued generation, or a `processing` one whose lease has expired
 * (its worker is gone). Sets the lease and counts the attempt in the same
 * atomic update, so exactly one caller can ever win a given generation.
 *
 * Phase 1 has no worker calling this in production; it exists so Phase 2 adds
 * a provider without redesigning the boundary.
 *
 * @returns {Promise<object|null>} the claimed generation, or null when idle
 */
export async function claimNextGeneration({ now = new Date(), leaseMs = DESIGN_GENERATION_LEASE_MS } = {}) {
  return DesignGeneration.findOneAndUpdate(
    {
      $or: [
        { status: 'queued' },
        { status: 'processing', leaseUntil: { $lte: now } },
      ],
      attempts: { $lt: DESIGN_GENERATION_MAX_ATTEMPTS },
    },
    {
      $set: { status: 'processing', startedAt: now, leaseUntil: new Date(now.getTime() + leaseMs) },
      $inc: { attempts: 1 },
    },
    // Oldest first, so nothing can starve behind newer work.
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  )
}

/**
 * Records a real, stored result. The ONLY route to `succeeded`.
 *
 * Refuses to mark success without a result asset, which is what keeps Phase 1
 * from ever claiming a visualization exists.
 */
export async function completeGeneration(id, { result, now = new Date() } = {}) {
  if (!result || !result.publicId) {
    throw new Error('A generation cannot succeed without a stored result asset')
  }

  return DesignGeneration.findOneAndUpdate(
    { _id: id, status: 'processing' },
    { $set: { status: 'succeeded', result, completedAt: now, leaseUntil: null, error: {} } },
    { returnDocument: 'after' }
  )
}

/**
 * Ends an attempt with a failure.
 *
 * A retryable failure with attempts remaining goes back to the queue instead
 * of ending the generation. `code` is one of the stable codes the app
 * translates; a provider's own message is never stored.
 */
export async function failGeneration(id, { code, retryable = false, now = new Date() } = {}) {
  const generation = await DesignGeneration.findOne({ _id: id, status: { $in: DESIGN_GENERATION_ACTIVE_STATUSES } })
  if (!generation) return null

  const canRetry = retryable && generation.attempts < DESIGN_GENERATION_MAX_ATTEMPTS
  const update = canRetry
    ? { $set: { status: 'queued', leaseUntil: null, error: { code, retryable: true } } }
    : { $set: { status: 'failed', completedAt: now, leaseUntil: null, error: { code, retryable } } }

  return DesignGeneration.findOneAndUpdate(
    { _id: id, status: generation.status },
    update,
    { returnDocument: 'after' }
  )
}

/**
 * Returns abandoned work to the queue, and gives up on what has exhausted its
 * attempts. Idempotent, so it is safe to run on every sweep.
 */
export async function recoverStaleGenerations({ now = new Date() } = {}) {
  const expired = { status: 'processing', leaseUntil: { $lte: now } }

  const exhausted = await DesignGeneration.updateMany(
    { ...expired, attempts: { $gte: DESIGN_GENERATION_MAX_ATTEMPTS } },
    { $set: { status: 'failed', completedAt: now, leaseUntil: null, error: { code: 'LEASE_EXPIRED', retryable: false } } }
  )

  const requeued = await DesignGeneration.updateMany(
    { ...expired, attempts: { $lt: DESIGN_GENERATION_MAX_ATTEMPTS } },
    { $set: { status: 'queued', leaseUntil: null } }
  )

  return { failed: exhausted.modifiedCount ?? 0, requeued: requeued.modifiedCount ?? 0 }
}

/** Fails generations that waited too long without ever being claimed. */
export async function failStaleQueuedGenerations({ now = new Date(), maxAgeMs }) {
  const { modifiedCount = 0 } = await DesignGeneration.updateMany(
    { status: 'queued', createdAt: { $lte: new Date(now.getTime() - maxAgeMs) } },
    { $set: { status: 'failed', completedAt: now, leaseUntil: null, error: { code: 'NOT_PROCESSED_IN_TIME', retryable: false } } }
  )
  return modifiedCount
}

/**
 * Ends the unfinished generations that depend on a room photo.
 *
 * Called when that photo is deleted: a queued or processing job can no longer
 * run without its source image. Generations that already finished keep their
 * own history — a succeeded one owns its result asset, which is a separate
 * image from the room photo.
 */
export async function failGenerationsForRoomPhoto(roomPhotoId, { now = new Date() } = {}) {
  const { modifiedCount = 0 } = await DesignGeneration.updateMany(
    { roomPhoto: roomPhotoId, status: { $in: DESIGN_GENERATION_ACTIVE_STATUSES } },
    { $set: { status: 'failed', completedAt: now, leaseUntil: null, error: { code: 'SOURCE_PHOTO_UNAVAILABLE', retryable: false } } }
  )
  return modifiedCount
}
