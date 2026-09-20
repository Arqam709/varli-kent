// Generation deletion, retention and cleanup.
//
// The same two steps as room photos:
//
//   1. LOGICAL   status → 'deleted'. Gone from the user's history at once.
//   2. PHYSICAL  the generated image is destroyed, then purgedAt is set.
//
// A generation that never produced an image has nothing to destroy and is
// purged immediately; one that did gets its PRIVATE result asset deleted
// first, and is marked purged only once that is confirmed. The source room
// photo is never touched here: it is a separate asset with its own lifecycle.
//
// A MongoDB TTL index only ever removes records that are ALREADY purged.

import DesignGeneration from '../../models/DesignGeneration.js'
import {
  DESIGN_GENERATION_ACTIVE_STATUSES,
  DESIGN_GENERATION_QUEUED_MAX_AGE_MS,
  DESIGN_GENERATION_SWEEP_BATCH_SIZE,
  DESIGN_GENERATION_SWEEP_FIRST_RUN_MS,
  DESIGN_GENERATION_SWEEP_INTERVAL_MS,
} from '../../config/designGenerations.js'
import { failStaleQueuedGenerations, recoverStaleGenerations } from './generationState.js'
import { destroyGenerationResultAsset } from './resultStorage.js'

const DELETABLE_STATUSES = [...DESIGN_GENERATION_ACTIVE_STATUSES, 'succeeded', 'failed']

/**
 * Destroys a generation's stored image.
 *
 * Resolves true ONLY when nothing of the image remains — including when there
 * was never one — so a record is never marked purged while an image still
 * exists. A storage failure leaves it unpurged for the sweep to retry.
 */
async function destroyGenerationResult(generation) {
  if (!generation?.result?.publicId) return true

  try {
    await destroyGenerationResultAsset(generation.result.publicId, generation.result.deliveryType)
    return true
  } catch (error) {
    // Id and reason only: never the public id, a URL or image data.
    console.error(`[design-generations] result purge failed for ${generation._id}: ${error.message}`)
    return false
  }
}

/**
 * Removes the image of one logically deleted generation and records the purge.
 * @returns {Promise<boolean>} true when nothing of the image remains
 */
export async function purgeGenerationResult(generation) {
  if (!generation || generation.status !== 'deleted' || generation.purgedAt) {
    return Boolean(generation?.purgedAt)
  }

  if (!(await destroyGenerationResult(generation))) return false

  await DesignGeneration.updateOne(
    { _id: generation._id, status: 'deleted', purgedAt: null },
    { $set: { purgedAt: new Date() } }
  )
  return true
}

/**
 * Deletes one generation for its owner. Ownership is part of the query, so a
 * generation belonging to someone else simply does not match.
 *
 * Deliberately does NOT touch the source room photo: that photo is its own
 * entity, may be used by other generations, and has its own retention.
 *
 * @returns {Promise<object|null>} the deleted generation, or null
 */
export async function deleteGenerationForUser(generationId, userId, { now = new Date() } = {}) {
  const generation = await DesignGeneration.findOneAndUpdate(
    { _id: generationId, user: userId, status: { $in: DELETABLE_STATUSES } },
    { $set: { status: 'deleted', deletedAt: now, leaseUntil: null } },
    { returnDocument: 'after' }
  )
  if (!generation) return null

  await purgeGenerationResult(generation)
  return generation
}

/**
 * Hides every generation a user owns and purges what it can. For permanent
 * account deletion: the logical step throws on a database error so the caller
 * can refuse to delete the account while history is still visible.
 */
export async function deleteAllGenerationsForUser(userId, { now = new Date() } = {}) {
  const { modifiedCount = 0 } = await DesignGeneration.updateMany(
    { user: userId, status: { $in: DELETABLE_STATUSES } },
    { $set: { status: 'deleted', deletedAt: now, leaseUntil: null } }
  )

  const unpurged = await DesignGeneration.find({ user: userId, status: 'deleted', purgedAt: null })
  let purged = 0
  for (const generation of unpurged) {
    if (await purgeGenerationResult(generation)) purged += 1
  }
  return { deleted: modifiedCount, purged, pending: unpurged.length - purged }
}

/**
 * One cleanup pass. Idempotent, and safe to run at any time.
 *
 *   1. abandoned claims → back to the queue, or failed once attempts are spent
 *   2. generations nobody ever claimed → failed (never silently stuck)
 *   3. generations past their retention → deleted
 *   4. a batch of deleted generations → images destroyed, purge recorded
 */
export async function sweepDesignGenerations({ now = new Date() } = {}) {
  const recovered = await recoverStaleGenerations({ now })
  const abandoned = await failStaleQueuedGenerations({ now, maxAgeMs: DESIGN_GENERATION_QUEUED_MAX_AGE_MS })

  const expired = await DesignGeneration.updateMany(
    { status: { $in: [...DESIGN_GENERATION_ACTIVE_STATUSES, 'succeeded', 'failed'] }, expiresAt: { $lte: now } },
    { $set: { status: 'deleted', deletedAt: now, leaseUntil: null } }
  )

  const batch = await DesignGeneration.find({ status: 'deleted', purgedAt: null })
    .sort({ deletedAt: 1 })
    .limit(DESIGN_GENERATION_SWEEP_BATCH_SIZE)

  let purged = 0
  for (const generation of batch) {
    if (await purgeGenerationResult(generation)) purged += 1
  }

  return {
    requeued: recovered.requeued,
    leaseExpired: recovered.failed,
    abandoned,
    expired: expired.modifiedCount ?? 0,
    purged,
    failedToPurge: batch.length - purged,
  }
}

/* ── The in-process sweep ──────────────────────────────────────────────── */

let timer = null
let firstRun = null
let running = false

/** Runs one sweep unless one is already running in this process. Never throws. */
export async function runDesignGenerationSweepOnce() {
  if (running) return null
  running = true
  try {
    const result = await sweepDesignGenerations()
    if (Object.values(result).some(Boolean)) {
      // Counts only: never ids, snapshots, prompts or image data.
      console.log(
        `[design-generations] sweep: ${result.requeued} requeued, ${result.leaseExpired} lease-expired, ` +
        `${result.abandoned} never claimed, ${result.expired} expired, ${result.purged} purged, ${result.failedToPurge} awaiting retry`
      )
    }
    return result
  } catch (err) {
    console.error(`[design-generations] sweep failed: ${err.message}`)
    return null
  } finally {
    running = false
  }
}

/**
 * Starts the periodic sweep. Returns immediately and never blocks startup.
 * Render may sleep, so cleanup is eventual rather than scheduled.
 */
export function startDesignGenerationSweeper() {
  if (timer || firstRun) return
  firstRun = setTimeout(() => {
    firstRun = null
    void runDesignGenerationSweepOnce()
    timer = setInterval(() => void runDesignGenerationSweepOnce(), DESIGN_GENERATION_SWEEP_INTERVAL_MS)
    timer.unref?.()
  }, DESIGN_GENERATION_SWEEP_FIRST_RUN_MS)
  firstRun.unref?.()
}

/** Test seam. */
export function stopDesignGenerationSweeper() {
  clearTimeout(firstRun)
  clearInterval(timer)
  firstRun = null
  timer = null
}
