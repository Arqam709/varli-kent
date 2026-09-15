import express from 'express'
import { body, validationResult } from 'express-validator'
import ContactSubmission from '../models/ContactSubmission.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { sendContactNotification } from '../utils/email.js'
import { CLIENT_CONTACT_SOURCES } from '../config/contactInterests.js'
import { isRegisteredContactInterestValue } from '../services/contactInterests.js'

const router = express.Router()

// The interest vocabulary (GET /api/contact/interests and its admin API) lives
// in routes/contactInterests.js, mounted ahead of this router in server.js.

// POST /api/contact
router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').notEmpty().withMessage('Phone is required'),
    body('message').notEmpty().withMessage('Message is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req).array()

      // interestType is checked against the ContactInterest collection rather
      // than a fixed list, so admin-created interests are accepted — and so are
      // DISABLED ones, which older apps and old links may still send. An id or
      // a translated label is not a registered value and is refused.
      // Reported in the same express-validator shape as the checks above.
      const { interestType } = req.body
      if (!(await isRegisteredContactInterestValue(interestType))) {
        errors.push({
          type: 'field',
          value: interestType,
          msg: 'Valid interest type is required',
          path: 'interestType',
          location: 'body',
        })
      }

      if (errors.length > 0) {
        return res.status(400).json({ success: false, errors })
      }

      // Only the fields a public visitor is entitled to set. Passing req.body
      // straight through let any caller also write status, createdAt, or an
      // ai_assistant source onto their own submission.
      const { name, email, phone, message } = req.body
      const source = CLIENT_CONTACT_SOURCES.includes(req.body.source) ? req.body.source : undefined

      const submission = await ContactSubmission.create({
        name,
        email,
        phone,
        interestType,
        message,
        // Omitted rather than defaulted here, so the schema default stays the
        // single meaning of "a client that sent nothing" — which is every
        // build released before Phase 1.
        ...(source ? { source } : {}),
      })
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
