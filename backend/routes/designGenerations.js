import express from 'express'
import mongoose from 'mongoose'
import DesignBoard from '../models/DesignBoard.js'
import DesignGeneration from '../models/DesignGeneration.js'
import DesignRoomPhoto from '../models/DesignRoomPhoto.js'
import SiteSettings from '../models/SiteSettings.js'
import { protect } from '../middleware/auth.js'
import { parseLimit, parsePage } from '../utils/pagination.js'
import { buildBoardSnapshot, BoardSnapshotError } from '../services/designGenerations/boardSnapshot.js'
import { DESIGN_PROMPT_VERSION } from '../services/designGenerations/prompt.js'
import { deleteGenerationForUser } from '../services/designGenerations/lifecycle.js'
import { openGenerationResultStream, RESULT_CONTENT_TYPE } from '../services/designGenerations/resultStorage.js'
import {
  DESIGN_GENERATION_ACTIVE_STATUSES,
  DESIGN_GENERATION_IDEMPOTENCY_KEY_PATTERN,
  DESIGN_GENERATION_MAX_ACTIVE_PER_USER,
  DESIGN_GENERATION_MAX_PAGE_SIZE,
  DESIGN_GENERATION_MAX_PER_DAY,
  DESIGN_GENERATION_PAGE_SIZE,
  DESIGN_GENERATION_RETENTION_DAYS,
  DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS,
} from '../config/designGenerations.js'

const router = express.Router()

// Design My Space visualizations for the signed-in user.
//
// The DesignBoard/DesignRoomPhoto ownership rule throughout: every route is
// behind `protect`, and every query carries `user: req.user._id`. A board,
// photo or generation belonging to someone else matches nothing and answers
// the same 404 as one that does not exist.
//
// Creation NEVER runs a visualization: it validates, records the request and
// returns 202. The job boundary lives in services/designGenerations.
//
// The generated image is served by GET /:id/image, streamed through this API
// for its owner alone — the same rule as a room photo. A client never receives
// a storage id or a signed URL.

const DAY_MS = 24 * 60 * 60 * 1000
const NOT_FOUND = 'Visualization not found'

const notFound = (res) => res.status(404).json({ success: false, code: 'GENERATION_NOT_FOUND', message: NOT_FOUND })
const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message })

/**
 * What a client may know about a generation.
 *
 * Never included: the result's storage identity (publicId, delivery type,
 * format, size), lease/attempt bookkeeping, the prompt, or whether the error
 * is retryable — all of that is server business. `hasResult` is the single bit
 * the app needs about the image.
 */
export const publicDesignGeneration = (generation) => ({
  _id: generation._id,
  status: generation.status,
  boardId: generation.board,
  roomPhotoId: generation.roomPhoto,
  // The historical receipt, which is exactly what the history list renders.
  board: {
    room: generation.boardSnapshot.room,
    style: generation.boardSnapshot.style,
    wall: { label: generation.boardSnapshot.wall.label, color: generation.boardSnapshot.wall.color },
    floor: { label: generation.boardSnapshot.floor.label, color: generation.boardSnapshot.floor.color },
    materials: (generation.boardSnapshot.materials ?? []).map((material) => ({ name: material.name, color: material.color })),
    lighting: generation.boardSnapshot.lighting,
  },
  hasResult: Boolean(generation.result?.publicId),
  errorCode: generation.error?.code ?? null,
  createdAt: generation.createdAt,
  startedAt: generation.startedAt ?? null,
  completedAt: generation.completedAt ?? null,
  expiresAt: generation.expiresAt,
})

/** Visualizations exist for the user until they are deleted. */
const VISIBLE_STATUSES = [...DESIGN_GENERATION_ACTIVE_STATUSES, 'succeeded', 'failed']

const designGenerationsEnabled = async () => {
  const settings = await SiteSettings.findOne().select('designGenerationsEnabled').lean()
  return Boolean(settings?.designGenerationsEnabled)
}

// POST /api/design-generations
router.post('/', protect, async (req, res, next) => {
  try {
    // Phase 1 ships without a worker, so creation stays off until an owner
    // turns it on (Admin → Site Settings). Reading history is unaffected.
    if (!(await designGenerationsEnabled())) {
      return fail(res, 503, 'FEATURE_DISABLED', 'Room visualization is not available yet.')
    }

    const { boardId, roomPhotoId, idempotencyKey } = req.body ?? {}

    if (typeof idempotencyKey !== 'string' || !DESIGN_GENERATION_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return fail(res, 400, 'INVALID_REQUEST', 'A valid idempotencyKey is required.')
    }
    if (!mongoose.isValidObjectId(boardId) || !mongoose.isValidObjectId(roomPhotoId)) {
      return fail(res, 400, 'INVALID_REQUEST', 'A valid boardId and roomPhotoId are required.')
    }

    // A repeat of the same request (a retry, a double tap) returns the first
    // generation instead of queueing a second. Scoped to this user by the
    // query, so one person's key can never reach another's work.
    const existing = await DesignGeneration.findOne({ user: req.user._id, idempotencyKey })
    if (existing) return replayOrConflict(res, existing, boardId, roomPhotoId)

    const board = await DesignBoard.findOne({ _id: boardId, user: req.user._id })
    if (!board) return fail(res, 404, 'BOARD_NOT_FOUND', 'That design could not be found.')

    // `ready` only: an upload still in flight, a deleted photo and an expired
    // one are all unusable, and all answer the same way.
    const photo = await DesignRoomPhoto.findOne({ _id: roomPhotoId, user: req.user._id, status: 'ready' })
    if (!photo) return fail(res, 404, 'ROOM_PHOTO_NOT_FOUND', 'That room photo could not be found.')
    if (photo.expiresAt && photo.expiresAt.getTime() <= Date.now()) {
      return fail(res, 409, 'ROOM_PHOTO_EXPIRED', 'That room photo has expired. Please add it again.')
    }

    const active = await DesignGeneration.countDocuments({
      user: req.user._id,
      status: { $in: DESIGN_GENERATION_ACTIVE_STATUSES },
    })
    if (active >= DESIGN_GENERATION_MAX_ACTIVE_PER_USER) {
      return fail(res, 429, 'GENERATION_ACTIVE_LIMIT', 'Please wait for your current visualizations to finish.')
    }

    const today = await DesignGeneration.countDocuments({
      user: req.user._id,
      createdAt: { $gte: new Date(Date.now() - DAY_MS) },
    })
    if (today >= DESIGN_GENERATION_MAX_PER_DAY) {
      return fail(res, 429, 'GENERATION_DAILY_LIMIT', 'You have requested many visualizations today. Please try again tomorrow.')
    }

    // Built from the STORED board, never from the request body.
    let boardSnapshot
    try {
      boardSnapshot = buildBoardSnapshot(board)
    } catch (err) {
      if (err instanceof BoardSnapshotError) {
        return fail(res, 409, 'BOARD_UNUSABLE', 'This design cannot be used for a visualization. Please edit and save it again.')
      }
      throw err
    }

    const now = new Date()

    // The job must not lose its input: hold the source photo for the job
    // window. `$max` only ever extends the photo's expiry, so a photo that
    // already lives longer keeps its own date and none of them becomes
    // permanent.
    await DesignRoomPhoto.updateOne(
      { _id: photo._id, user: req.user._id, status: 'ready' },
      { $max: { expiresAt: new Date(now.getTime() + DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS) } }
    )

    let generation
    try {
      generation = await DesignGeneration.create({
        user: req.user._id,
        board: board._id,
        boardSnapshot,
        roomPhoto: photo._id,
        status: 'queued',
        promptVersion: DESIGN_PROMPT_VERSION,
        idempotencyKey,
        expiresAt: new Date(now.getTime() + DESIGN_GENERATION_RETENTION_DAYS * DAY_MS),
      })
    } catch (err) {
      // Two identical requests raced; the unique (user, idempotencyKey) index
      // let exactly one through. Adopt it rather than failing the retry.
      if (err?.code === 11000) {
        const winner = await DesignGeneration.findOne({ user: req.user._id, idempotencyKey })
        if (winner) return replayOrConflict(res, winner, boardId, roomPhotoId)
      }
      throw err
    }

    // 202: accepted and queued. Nothing has been generated.
    return res.status(202).json({ success: true, generation: publicDesignGeneration(generation) })
  } catch (err) {
    next(err)
  }
})

/** The same key must mean the same request; reusing it for another means 409. */
function replayOrConflict(res, generation, boardId, roomPhotoId) {
  const sameInputs = String(generation.board) === String(boardId) && String(generation.roomPhoto) === String(roomPhotoId)
  if (!sameInputs) {
    return fail(res, 409, 'IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different visualization.')
  }
  return res.status(200).json({ success: true, generation: publicDesignGeneration(generation) })
}

// GET /api/design-generations — this user's history, newest first.
router.get('/', protect, async (req, res, next) => {
  try {
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit, DESIGN_GENERATION_PAGE_SIZE, DESIGN_GENERATION_MAX_PAGE_SIZE)
    const filter = { user: req.user._id, status: { $in: VISIBLE_STATUSES } }

    const [generations, total] = await Promise.all([
      DesignGeneration.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      DesignGeneration.countDocuments(filter),
    ])

    res.json({
      success: true,
      page,
      limit,
      total,
      hasMore: page * limit < total,
      generations: generations.map(publicDesignGeneration),
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/design-generations/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res)

    const generation = await DesignGeneration.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: { $in: VISIBLE_STATUSES },
    })
    if (!generation) return notFound(res)

    res.json({ success: true, generation: publicDesignGeneration(generation) })
  } catch (err) {
    next(err)
  }
})

// GET /api/design-generations/:id/image — the generated visualization, for
// its owner only. Nothing else in the API exposes the result asset.
router.get('/:id/image', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res)

    // Ownership, status and a real result are all part of the query: a
    // generation that is queued, processing, failed, deleted or somebody
    // else's answers exactly the same 404.
    const generation = await DesignGeneration.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: 'succeeded',
      'result.publicId': { $exists: true },
    })
    if (!generation) return notFound(res)

    let image
    try {
      image = await openGenerationResultStream(generation.result.publicId, {
        deliveryType: generation.result.deliveryType,
        format: generation.result.format,
      })
    } catch {
      return fail(res, 502, 'RESULT_UNAVAILABLE', 'This visualization is temporarily unavailable.')
    }

    res.status(200)
    res.set({
      // Our own pipeline's format, not whatever the upstream reported.
      'Content-Type': RESULT_CONTENT_TYPE,
      // A private image: no shared cache may keep it, and the device is not
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

// DELETE /api/design-generations/:id — removes the visualization, never the
// room photo it was made from.
router.delete('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res)

    const generation = await deleteGenerationForUser(req.params.id, req.user._id)
    if (!generation) return notFound(res)

    res.json({ success: true, message: 'Visualization deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
