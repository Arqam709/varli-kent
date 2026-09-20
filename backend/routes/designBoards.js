import express from 'express'
import mongoose from 'mongoose'
import DesignBoard from '../models/DesignBoard.js'
import { protect } from '../middleware/auth.js'
import { validateDesignBoardPayload } from '../services/designBoards.js'

const router = express.Router()

// Design My Space boards for the signed-in user.
//
// The same ownership rule as routes/propertyAlerts.js: every route is behind
// `protect`, and every query carries `user: req.user._id`. A user id is never
// read from the body or params, so another user's board id simply matches
// nothing and answers 404 — "not yours" is indistinguishable from "does not
// exist".
//
// Signed-out visitors keep their boards on the device; nothing here serves
// them.

export const MAX_DESIGN_BOARDS_PER_USER = 50

const NOT_FOUND = 'Design board not found'

// Keeps `user` and `__v` out of API responses.
const finish = (value) => ({ label: value.label, color: value.color })

export const publicDesignBoard = (board) => ({
  _id: board._id,
  clientId: board.clientId,
  version: board.version,
  room: board.room,
  style: board.style,
  wall: finish(board.wall),
  floor: finish(board.floor),
  materials: (board.materials ?? []).map((material) => (
    material.image
      ? { name: material.name, color: material.color, image: material.image }
      : { name: material.name, color: material.color }
  )),
  lighting: board.lighting,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
})

const badRequest = (res, errors) => res.status(400).json({ success: false, message: errors[0], errors })

const UPDATE_OPTIONS = { returnDocument: 'after', runValidators: true }

/** Replaces a board's content, scoped by owner. `null` when it is not this user's. */
const replaceOwnedBoard = (filter, userId, value) => {
  const { clientId, ...board } = value
  return DesignBoard.findOneAndUpdate({ ...filter, user: userId }, { $set: board }, UPDATE_OPTIONS)
}

// GET /api/design-boards
router.get('/', protect, async (req, res, next) => {
  try {
    const boards = await DesignBoard.find({ user: req.user._id }).sort({ updatedAt: -1 })
    res.json({ success: true, count: boards.length, boards: boards.map(publicDesignBoard) })
  } catch (err) {
    next(err)
  }
})

// POST /api/design-boards
//
// 201 with a new board, or 200 when `clientId` names a board this user already
// has — then that board is updated instead. That is what makes a save safe to
// retry after a lost response on a mobile connection.
router.post('/', protect, async (req, res, next) => {
  try {
    const { errors, value } = validateDesignBoardPayload(req.body, { allowClientId: true })
    if (errors.length > 0) return badRequest(res, errors)

    if (value.clientId) {
      const existing = await replaceOwnedBoard({ clientId: value.clientId }, req.user._id, value)
      if (existing) return res.json({ success: true, board: publicDesignBoard(existing) })
    }

    const count = await DesignBoard.countDocuments({ user: req.user._id })
    if (count >= MAX_DESIGN_BOARDS_PER_USER) {
      return res.status(400).json({
        success: false,
        message: `You can save up to ${MAX_DESIGN_BOARDS_PER_USER} designs.`,
      })
    }

    try {
      // `user` comes from the token, never from `value`.
      const board = await DesignBoard.create({ ...value, user: req.user._id })
      return res.status(201).json({ success: true, board: publicDesignBoard(board) })
    } catch (err) {
      // Two simultaneous first saves of the same device board: the unique
      // (user, clientId) index let exactly one insert through. Adopt it.
      if (err?.code === 11000 && value.clientId) {
        const winner = await replaceOwnedBoard({ clientId: value.clientId }, req.user._id, value)
        if (winner) return res.json({ success: true, board: publicDesignBoard(winner) })
      }
      throw err
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/design-boards/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: NOT_FOUND })
    }

    const board = await DesignBoard.findOne({ _id: req.params.id, user: req.user._id })
    if (!board) return res.status(404).json({ success: false, message: NOT_FOUND })

    res.json({ success: true, board: publicDesignBoard(board) })
  } catch (err) {
    next(err)
  }
})

// PUT /api/design-boards/:id — send the COMPLETE board; it replaces the old one.
router.put('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: NOT_FOUND })
    }

    // No clientId here: a board's device id is fixed when it is created.
    const { errors, value } = validateDesignBoardPayload(req.body)
    if (errors.length > 0) return badRequest(res, errors)

    const board = await replaceOwnedBoard({ _id: req.params.id }, req.user._id, value)
    if (!board) return res.status(404).json({ success: false, message: NOT_FOUND })

    res.json({ success: true, board: publicDesignBoard(board) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/design-boards/:id
router.delete('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: NOT_FOUND })
    }

    const board = await DesignBoard.findOneAndDelete({ _id: req.params.id, user: req.user._id })
    if (!board) return res.status(404).json({ success: false, message: NOT_FOUND })

    res.json({ success: true, message: 'Design board deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
