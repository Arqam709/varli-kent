import express from 'express'
import mongoose from 'mongoose'
import PropertyAlert from '../models/PropertyAlert.js'
import { protect } from '../middleware/auth.js'
import { validateAlertPayload } from '../services/propertyAlerts.js'

const router = express.Router()

// Every route is behind `protect`, and every query is scoped by
// `user: req.user._id`. A userId is never read from the request body or
// params, so one user cannot reach another's alerts even by guessing an id —
// a wrong id simply matches nothing and returns 404.

const MAX_ALERTS_PER_USER = 20

// Keeps `user` and `__v` out of API responses.
const publicAlert = (alert) => ({
  _id: alert._id,
  listingType: alert.listingType,
  district: alert.district,
  propertyType: alert.propertyType,
  minPrice: alert.minPrice,
  maxPrice: alert.maxPrice,
  minBeds: alert.minBeds,
  active: alert.active,
  createdAt: alert.createdAt,
})

// GET /api/property-alerts
router.get('/', protect, async (req, res, next) => {
  try {
    const alerts = await PropertyAlert.find({ user: req.user._id }).sort({ createdAt: -1 })

    res.json({ success: true, count: alerts.length, alerts: alerts.map(publicAlert) })
  } catch (err) {
    next(err)
  }
})

// POST /api/property-alerts
router.post('/', protect, async (req, res, next) => {
  try {
    const { errors, value } = validateAlertPayload(req.body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors })
    }

    const existing = await PropertyAlert.countDocuments({ user: req.user._id })
    if (existing >= MAX_ALERTS_PER_USER) {
      return res.status(400).json({
        success: false,
        message: `You can save up to ${MAX_ALERTS_PER_USER} alerts.`,
      })
    }

    // `user` comes from the token, never from `value`.
    const alert = await PropertyAlert.create({ ...value, user: req.user._id })

    res.status(201).json({ success: true, alert: publicAlert(alert) })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/property-alerts/:id
router.patch('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Alert not found' })
    }

    const { errors, value } = validateAlertPayload(req.body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors })
    }

    // Criteria the client omitted are cleared, so editing an alert down to
    // fewer filters actually widens it rather than silently keeping the old
    // values. The `user` clause is what enforces ownership.
    const update = {
      listingType: value.listingType ?? null,
      district: value.district ?? null,
      propertyType: value.propertyType ?? null,
      minPrice: value.minPrice ?? null,
      maxPrice: value.maxPrice ?? null,
      minBeds: value.minBeds ?? null,
    }
    if (value.active !== undefined) update.active = value.active

    const alert = await PropertyAlert.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: update },
      { new: true }
    )

    if (!alert) {
      // Also the response when the alert belongs to someone else — we do not
      // distinguish "not yours" from "does not exist".
      return res.status(404).json({ success: false, message: 'Alert not found' })
    }

    res.json({ success: true, alert: publicAlert(alert) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/property-alerts/:id
router.delete('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Alert not found' })
    }

    const alert = await PropertyAlert.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    })

    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found' })
    }

    res.json({ success: true, message: 'Alert deleted' })
  } catch (err) {
    next(err)
  }
})

export default router
