import express from 'express'
import { body, validationResult } from 'express-validator'
import ContactSubmission from '../models/ContactSubmission.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { sendContactNotification } from '../utils/email.js'

const router = express.Router()

// POST /api/contact
router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').notEmpty().withMessage('Phone is required'),
    body('interestType')
      .isIn(['Buying', 'Selling', 'Renting', 'Renovation', 'Interior Design', 'Architecture', 'General'])
      .withMessage('Valid interest type is required'),
    body('message').notEmpty().withMessage('Message is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() })
      }

      const submission = await ContactSubmission.create(req.body)
      await sendContactNotification(submission)

      res.status(201).json({ success: true, message: 'Your message has been received. We will be in touch soon.' })
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/contact
router.get(
  '/',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('view_contacts'),
  async (req, res, next) => {
    try {
      const submissions = await ContactSubmission.find().sort({ createdAt: -1 })
      res.json({ success: true, count: submissions.length, submissions })
    } catch (err) {
      next(err)
    }
  }
)

// PATCH /api/contact/:id/status
router.patch(
  '/:id/status',
  protect,
  requirePermission('reply_contacts'),
  async (req, res, next) => {
    try {
      const { status } = req.body
      const submission = await ContactSubmission.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true, runValidators: true }
      )
      if (!submission) {
        return res.status(404).json({ success: false, message: 'Submission not found' })
      }
      res.json({ success: true, submission })
    } catch (err) {
      next(err)
    }
  }
)

// DELETE /api/contact/:id — owner or admin with reply_contacts permission
router.delete(
  '/:id',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('reply_contacts'),
  async (req, res, next) => {
    try {
      const submission = await ContactSubmission.findByIdAndDelete(req.params.id)
      if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' })
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }
)

export default router
