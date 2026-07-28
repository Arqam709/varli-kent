import express from 'express'
import mongoose from 'mongoose'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import User from '../models/User.js'
// Neither is called directly — importing them registers the 'ContactSubmission'
// and 'Property' models with Mongoose, which populate('lead') and
// populate('propertyIds') depend on respectively.
import '../models/ContactSubmission.js'
import '../models/Property.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { parsePage, parseLimit } from '../utils/pagination.js'

const router = express.Router()

router.use(protect, requireRole('owner', 'admin'), requirePermission('view_chats'))

const VALID_STATUSES = ['active', 'archived', 'all']

const parseStatus = (value) => (VALID_STATUSES.includes(value) ? value : 'active')

const parseLeadCaptured = (value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

const parseDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// GET /api/admin/chats
router.get('/', async (req, res, next) => {
  try {
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const status = parseStatus(req.query.status)
    const leadCaptured = parseLeadCaptured(req.query.leadCaptured)
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to)
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const userId = typeof req.query.user === 'string' ? req.query.user.trim() : ''

    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' })
    }

    const filter = {}

    if (status !== 'all') {
      filter.status = status
    }

    if (leadCaptured !== undefined) {
      filter.leadCaptured = leadCaptured
    }

    if (from || to) {
      filter.lastActivityAt = {}
      if (from) filter.lastActivityAt.$gte = from
      if (to) filter.lastActivityAt.$lte = to
    }

    if (userId) {
      // Level 2 — a specific user's conversations. `user` wins outright:
      // search is ignored here rather than combined with it, since
      // searching by name/email inside an already-selected single user's
      // list is meaningless, and skipping it entirely avoids any risk of
      // accidentally widening the query beyond that one user.
      filter.user = userId
    } else if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i')
      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { email: searchRegex }],
      }).select('_id')

      filter.user = { $in: matchingUsers.map((matchedUser) => matchedUser._id) }
    }

    const totalCount = await ChatConversation.countDocuments(filter)
    const totalPages = Math.max(Math.ceil(totalCount / limit), 1)

    const conversations = await ChatConversation.find(filter)
      .select('status messageCount lastMessage lastActivityAt leadCaptured user')
      .populate('user', 'name email avatar')
      .sort({ lastActivityAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)

    res.json({
      success: true,
      conversations,
      pagination: { page, limit, totalCount, totalPages },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/chats/users
//
// Level 1 of the admin chat dashboard — one row per user, grouped from
// ChatConversation documents, not one row per conversation. Registered
// before '/:conversationId' so that wildcard route doesn't swallow the
// literal 'users' path segment.
//
// Pipeline shape: $match the same conversation-level filters the flat list
// endpoint already uses, $sort by lastActivityAt descending BEFORE
// grouping (so the $first accumulator below deterministically picks each
// user's newest matching conversation — this is the standard, documented
// Mongo pattern for "get a field from the extremal row of a group"), then
// $group by user computing the summary fields, then a second $sort on the
// grouped lastActivityAt (grouping does not preserve input order), then
// $facet to paginate the grouped rows and get a total user count in the
// same round trip.
router.get('/users', async (req, res, next) => {
  try {
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const status = parseStatus(req.query.status)
    const leadCaptured = parseLeadCaptured(req.query.leadCaptured)
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to)
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

    const matchStage = {}

    if (status !== 'all') {
      matchStage.status = status
    }

    if (leadCaptured !== undefined) {
      matchStage.leadCaptured = leadCaptured
    }

    if (from || to) {
      matchStage.lastActivityAt = {}
      if (from) matchStage.lastActivityAt.$gte = from
      if (to) matchStage.lastActivityAt.$lte = to
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i')
      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { email: searchRegex }],
      }).select('_id')

      matchStage.user = { $in: matchingUsers.map((matchedUser) => matchedUser._id) }
    }

    const [result] = await ChatConversation.aggregate([
      { $match: matchStage },
      { $sort: { lastActivityAt: -1 } },
      {
        $group: {
          _id: '$user',
          conversationCount: { $sum: 1 },
          lastActivityAt: { $max: '$lastActivityAt' },
          // Boolean $max: false < true in Mongo's comparison order, so this
          // is true as soon as any conversation in the group has a
          // captured lead — no 0/1 conversion needed.
          hasLead: { $max: '$leadCaptured' },
          latestMessage: { $first: '$lastMessage' },
        },
      },
      { $sort: { lastActivityAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'userDoc',
              },
            },
            // preserveNullAndEmptyArrays: true — a conversation whose user
            // was later deleted must not silently vanish from this list. A
            // strict $unwind would drop the whole group when the lookup
            // finds nothing; this keeps it, with the fallback fields below
            // filling in for the missing user document.
            {
              $unwind: {
                path: '$userDoc',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 0,
                conversationCount: 1,
                lastActivityAt: 1,
                hasLead: 1,
                latestMessage: 1,
                user: {
                  _id: '$_id',
                  name: { $ifNull: ['$userDoc.name', 'Deleted user'] },
                  email: { $ifNull: ['$userDoc.email', ''] },
                  avatar: { $ifNull: ['$userDoc.avatar', ''] },
                },
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ])

    const users = result?.data || []
    const totalCount = result?.totalCount?.[0]?.count || 0
    const totalPages = Math.max(Math.ceil(totalCount / limit), 1)

    res.json({
      success: true,
      users,
      pagination: { page, limit, totalCount, totalPages },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/chats/:conversationId
router.get('/:conversationId', async (req, res, next) => {
  try {
    const { conversationId } = req.params

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation id' })
    }

    const conversation = await ChatConversation.findById(conversationId)
      .populate('user', 'name email avatar')
      .populate('lead')

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' })
    }

    const messages = await ChatMessage.find({ conversation: conversationId })
      .sort({ createdAt: 1 })
      .populate('propertyIds', 'title district propertyType listingType price priceLabel mainImage status')

    const normalizedMessages = messages.map((message) => ({
      _id: message._id,
      role: message.role,
      text: message.text,
      event: message.event,
      pageKey: message.pageKey,
      createdAt: message.createdAt,
      properties: message.propertyIds,
    }))

    res.json({
      success: true,
      conversation,
      messages: normalizedMessages,
    })
  } catch (err) {
    next(err)
  }
})

export default router
