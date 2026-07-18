import express from 'express'
import mongoose from 'mongoose'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
// Not called directly — importing it registers the 'Property' model with
// Mongoose, which populate('propertyIds') below depends on.
import '../models/Property.js'
import { protect } from '../middleware/auth.js'
import { parsePage, parseLimit } from '../utils/pagination.js'

const router = express.Router()

router.use(protect)

const VALID_STATUSES = ['active', 'archived', 'all']

// Unlike the admin inbox (which defaults to 'active' for triage), a user's
// own conversation list defaults to 'all' — this list exists to show every
// conversation they've ever had, active or archived, like a ChatGPT-style
// history sidebar, not to surface only currently-live ones.
const parseStatus = (value) => (VALID_STATUSES.includes(value) ? value : 'all')

const CONVERSATION_LIST_FIELDS = 'status messageCount lastMessage lastActivityAt createdAt updatedAt'

// GET /api/chat/conversations
router.get('/', async (req, res, next) => {
  try {
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const status = parseStatus(req.query.status)

    const filter = { user: req.user._id }

    if (status !== 'all') {
      filter.status = status
    }

    const totalCount = await ChatConversation.countDocuments(filter)
    const totalPages = Math.max(Math.ceil(totalCount / limit), 1)

    const conversations = await ChatConversation.find(filter)
      .select(CONVERSATION_LIST_FIELDS)
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

// GET /api/chat/conversations/:conversationId
router.get('/:conversationId', async (req, res, next) => {
  try {
    const { conversationId } = req.params

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation id' })
    }

    // Ownership is baked into the query itself, not a separate
    // fetch-then-compare step — a foreign conversation id is
    // indistinguishable from a nonexistent one, both from this query and in
    // the response sent back below.
    const conversation = await ChatConversation.findOne({
      _id: conversationId,
      user: req.user._id,
    }).select(CONVERSATION_LIST_FIELDS)

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
