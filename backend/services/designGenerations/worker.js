// The generation worker: the only thing that turns a queued request into a
// stored visualization.
//
//   claim (atomic, leased)                         generationState.claimNextGeneration
//     └─ load the source room photo                DesignRoomPhoto + room-photo storage
//         └─ build the prompt                      prompt.js, from boardSnapshot only
//             └─ call the provider                 providers/, the ONLY external call
//                 └─ validate + normalize          resultImage.js (the photo pipeline)
//                     └─ store privately           resultStorage.js, a NEW asset
//                         └─ complete              generationState.completeGeneration
//
// Every status change goes through the Phase 1 state machine; this module
// never writes `status` itself. Failures are classified into the stable error
// codes, and only genuinely transient ones are marked retryable — the state
// machine then decides whether attempts remain.
//
// ── Running it safely ──────────────────────────────────────────────────
// A poll, not a busy loop: when nothing is queued the worker sleeps until the
// next tick. Concurrency is bounded (one job by default) because a job holds a
// photo, a generated image and a sharp pipeline in memory at once. The claim
// is a single atomic update with a lease, so a second instance — or a second
// process after a restart — cannot run the same generation; that is what keeps
// horizontal scaling safe without Redis.

import DesignRoomPhoto from '../../models/DesignRoomPhoto.js'
import {
  DESIGN_GENERATION_MAX_SOURCE_BYTES,
  DESIGN_GENERATION_RESULT_DELIVERY_TYPE,
  DESIGN_GENERATION_WORKER_CONCURRENCY,
  DESIGN_GENERATION_WORKER_ENABLED,
  DESIGN_GENERATION_WORKER_FIRST_RUN_MS,
  DESIGN_GENERATION_WORKER_POLL_MS,
} from '../../config/designGenerations.js'
import { ROOM_PHOTO_OUTPUT_CONTENT_TYPE } from '../../config/designRoomPhotos.js'
import { readRoomPhotoBuffer } from '../designRoomPhotos/storage.js'
import { claimNextGeneration, completeGeneration, failGeneration } from './generationState.js'
import { buildRoomVisualizationPrompt } from './prompt.js'
import { editRoomImage, isProviderConfigured, ProviderError, providerName } from './providers/index.js'
import { normalizeGeneratedImage } from './resultImage.js'
import {
  designGenerationResultPublicId,
  destroyGenerationResultAsset,
  RESULT_FORMAT,
  uploadGenerationResult,
} from './resultStorage.js'

/** Logs carry ids and codes only — never prompts, photos or generated images. */
const log = (message) => console.log(`[design-generations] ${message}`)
const logError = (message) => console.error(`[design-generations] ${message}`)

/**
 * Loads the source photo's bytes, or explains why the job cannot run.
 * @throws {ProviderError} SOURCE_PHOTO_UNAVAILABLE (never retryable: the photo
 *   is gone or unusable, and waiting will not bring it back)
 */
async function loadSourcePhoto(generation) {
  const photo = await DesignRoomPhoto.findOne({
    _id: generation.roomPhoto,
    // Defence in depth: the photo must still belong to the same account.
    user: generation.user,
    status: 'ready',
  })

  if (!photo) throw new ProviderError('SOURCE_PHOTO_UNAVAILABLE', { detail: 'source photo is gone or not ready' })
  if (photo.expiresAt && photo.expiresAt.getTime() <= Date.now()) {
    throw new ProviderError('SOURCE_PHOTO_UNAVAILABLE', { detail: 'source photo has expired' })
  }

  let buffer
  try {
    buffer = await readRoomPhotoBuffer(photo.asset.publicId, {
      deliveryType: photo.asset.deliveryType,
      format: photo.asset.format,
      maxBytes: DESIGN_GENERATION_MAX_SOURCE_BYTES,
    })
  } catch (error) {
    // Storage being unreachable IS worth another attempt.
    throw new ProviderError('SOURCE_PHOTO_UNAVAILABLE', {
      retryable: true,
      detail: `source photo could not be read: ${error.message}`,
    })
  }

  return { photo, buffer }
}

/**
 * Runs one claimed generation to completion.
 *
 * Takes a generation ALREADY in `processing` with a live lease.
 * @returns {Promise<'succeeded' | 'failed'>}
 */
export async function processGeneration(generation) {
  const id = String(generation._id)
  let uploaded = null

  try {
    const { photo, buffer } = await loadSourcePhoto(generation)

    // Built here, from the immutable snapshot. Never from the request, never
    // stored: only `promptVersion` is recorded on the generation.
    const prompt = buildRoomVisualizationPrompt(generation.boardSnapshot)

    const produced = await editRoomImage({
      imageBuffer: buffer,
      mimeType: ROOM_PHOTO_OUTPUT_CONTENT_TYPE,
      prompt,
      width: photo.width,
      height: photo.height,
    })

    // Untrusted output: decoded, bounded, stripped and re-encoded.
    const normalized = await normalizeGeneratedImage(produced.buffer)

    // A NEW private asset. The room photo is untouched.
    const publicId = designGenerationResultPublicId(id)
    try {
      await uploadGenerationResult(publicId, normalized.buffer)
      uploaded = publicId
    } catch (error) {
      throw new ProviderError('RESULT_STORAGE_FAILED', {
        retryable: true,
        detail: `result upload failed: ${error.message}`,
      })
    }

    const completed = await completeGeneration(generation._id, {
      result: {
        publicId,
        deliveryType: DESIGN_GENERATION_RESULT_DELIVERY_TYPE,
        format: RESULT_FORMAT,
        width: normalized.width,
        height: normalized.height,
        bytes: normalized.bytes,
      },
    })

    if (!completed) {
      // The generation moved on while we worked — deleted by its owner, or
      // recovered after our lease expired. The image we just stored belongs to
      // nobody, so it must not be left behind.
      throw new ProviderError('RESULT_STORAGE_FAILED', {
        retryable: false,
        detail: 'generation was no longer processing at completion',
      })
    }

    uploaded = null // adopted by the generation; no longer orphaned
    log(`generation ${id} succeeded (${normalized.width}x${normalized.height}, ${normalized.bytes} bytes)`)
    return 'succeeded'
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'PROVIDER_FAILED'
    const retryable = error instanceof ProviderError ? error.retryable : false

    // Never leave a stored image that no record points at.
    if (uploaded) {
      try {
        await destroyGenerationResultAsset(uploaded)
      } catch {
        logError(`generation ${id}: an orphaned result asset could not be removed; the sweep will not see it`)
      }
    }

    logError(`generation ${id} failed: ${code}${retryable ? ' (retryable)' : ''} — ${error.message}`)
    // The state machine decides between another attempt and a final failure.
    await failGeneration(generation._id, { code, retryable })
    return 'failed'
  }
}

/* ── The loop ──────────────────────────────────────────────────────────── */

let timer = null
let firstRun = null
let active = 0
let running = false
let stopped = false

/** Claims and runs jobs until the queue is empty or concurrency is reached. */
async function drain() {
  if (running || stopped) return
  running = true
  try {
    while (!stopped && active < DESIGN_GENERATION_WORKER_CONCURRENCY) {
      const generation = await claimNextGeneration()
      if (!generation) return // nothing queued; wait for the next tick

      active += 1
      log(`claimed generation ${generation._id} (attempt ${generation.attempts})`)
      // Not awaited: concurrency is what bounds the work, and the loop
      // continues claiming while a slot remains.
      void processGeneration(generation)
        .catch((error) => logError(`generation ${generation._id}: unexpected worker error — ${error.message}`))
        .finally(() => {
          active -= 1
          // A finished job frees a slot; look for more without waiting.
          if (!stopped) void drain()
        })
    }
  } catch (error) {
    logError(`worker poll failed: ${error.message}`)
  } finally {
    running = false
  }
}

/** Test seam: one poll, awaited. */
export async function runGenerationWorkerOnce() {
  await drain()
  return { active }
}

/**
 * Starts polling for work. Returns immediately and never blocks startup.
 *
 * Stays idle — and says so once — when this instance is not a worker or no
 * provider is configured, so a misconfigured deployment cannot quietly claim
 * jobs it could never finish.
 */
export function startGenerationWorker() {
  if (timer || firstRun) return false
  if (!DESIGN_GENERATION_WORKER_ENABLED) {
    log('worker disabled on this instance (DESIGN_GENERATION_WORKER_ENABLED=false)')
    return false
  }
  if (!isProviderConfigured()) {
    log(`worker idle: no image provider configured (DESIGN_GENERATION_PROVIDER=${providerName()})`)
    return false
  }

  stopped = false
  log(`worker starting: provider=${providerName()}, concurrency=${DESIGN_GENERATION_WORKER_CONCURRENCY}`)
  firstRun = setTimeout(() => {
    firstRun = null
    void drain()
    timer = setInterval(() => void drain(), DESIGN_GENERATION_WORKER_POLL_MS)
    timer.unref?.()
  }, DESIGN_GENERATION_WORKER_FIRST_RUN_MS)
  firstRun.unref?.()

  // On shutdown, stop claiming. Work already in flight keeps its lease; if the
  // process dies before finishing, the sweep recovers that generation.
  process.once('SIGTERM', stopGenerationWorker)
  process.once('SIGINT', stopGenerationWorker)
  return true
}

/** Stops claiming new work. In-flight jobs are left to finish or be recovered. */
export function stopGenerationWorker() {
  stopped = true
  clearTimeout(firstRun)
  clearInterval(timer)
  firstRun = null
  timer = null
}

/** Test seam. */
export const workerLoad = () => ({ active, polling: Boolean(timer || firstRun) })
