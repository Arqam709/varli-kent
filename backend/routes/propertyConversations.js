// Human customer↔agent messaging about a specific listing.
//
// Mounted at /api/property-conversations — NOT under /api/chat (that is the
// Gemini assistant) and NOT under /api/agent (customers and agents share these
// endpoints; authorisation is by participation, not by role). Sharing one API
// is also what lets the website agent inbox and the mobile customer app talk
// to the same backend later without a second authorisation path to keep in
// sync.

import express from 'express'
import PropertyConversation from '../models/PropertyConversation.js'
import PropertyMessage from '../models/PropertyMessage.js'
import Property from '../models/Property.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { parseLimit } from '../utils/pagination.js'
import { isAssignableAgent } from '../services/agentAssignment.js'
import {
  authorizeConversationAccess,
  inboxScopeFor,
  currentPropertyAgentId,
  reconcileConversationAgent,
  conversationResponse,
  messageResponse,
  participantSummary,
  propertySummary,
  validateMessageText,
  previewOf,
  conversationSendability,
  isValidObjectId,
  isDuplicateKeyError,
  PARTICIPANT_FIELDS,
  PROPERTY_SUMMARY_FIELDS,
} from '../services/propertyMessaging.js'
import { emitNewPropertyMessage } from '../services/propertyMessagingRealtime.js'
import { sendNewMessagePush } from '../services/messagePush.js'

const router = express.Router()

// Every route here is private. There is no anonymous messaging.
router.use(protect)

const MESSAGE_PAGE_DEFAULT = 30
const MESSAGE_PAGE_MAX = 50

const notFound = (res) =>
  res.status(404).json({ success: false, message: 'Conversation not found' })

/**
 * Loads a conversation the caller is authorised for, and says which side they
 * are on.
 *
 * Returns { conversation: null, side: null } for a bad id, a missing
 * conversation, AND a conversation the caller has no right to — the three are
 * deliberately indistinguishable from outside, so a probing request cannot
 * confirm that an id exists. This is the idiom chatConversations.js and
 * propertyAlerts.js already use.
 *
 * Authorization is NOT baked into the query, because the agent side depends on
 * the live role (which lives on req.user) and on current Property ownership
 * (which lives on another collection). See authorizeConversationAccess.
 */
const loadAuthorizedConversation = async (conversationId, user, { populate = false } = {}) => {
  const denied = { conversation: null, side: null }

  if (!isValidObjectId(conversationId)) return denied

  let query = PropertyConversation.findById(conversationId)

  if (populate) {
    query = query
      .populate('property', PROPERTY_SUMMARY_FIELDS)
      .populate('customer', PARTICIPANT_FIELDS)
      .populate('agent', PARTICIPANT_FIELDS)
  }

  const conversation = await query
  if (!conversation) return denied

  const { side } = await authorizeConversationAccess(conversation, user)
  if (!side) return denied

  return { conversation, side }
}

/* ───────────────────────── Start / reopen ───────────────────────── */

/**
 * POST /api/property-conversations   { propertyId }
 *
 * The client sends a PROPERTY and nothing else. The agent is whoever the
 * property says it is — there is no agentId or customerId field to forge,
 * because none is ever read.
 */
router.post('/', async (req, res, next) => {
  try {
    const { propertyId } = req.body || {}

    if (!isValidObjectId(propertyId)) {
      return res.status(400).json({ success: false, message: 'A valid propertyId is required' })
    }

    const property = await Property.findById(propertyId).select('agent')
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' })
    }

    if (!property.agent) {
      return res.status(409).json({
        success: false,
        message: 'This property does not have an assigned agent yet.',
      })
    }

    // Re-validated rather than trusted: the stored reference goes stale the
    // moment that account is deactivated or demoted.
    const agentUser = await User.findById(property.agent).select('role isActive')
    if (!isAssignableAgent(agentUser)) {
      return res.status(409).json({
        success: false,
        message: 'The agent for this property is currently unavailable.',
      })
    }

    // No self-conversation. An agent browsing their own listing cannot open a
    // thread with themselves, which would otherwise produce a conversation
    // whose two sides are the same person.
    if (String(req.user._id) === String(agentUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot start a conversation about your own listing.',
      })
    }

    // Agents do not initiate. The business flow starts with a customer viewing
    // a listing and pressing Message Agent; an agent-initiated thread would be
    // an outbound-marketing feature with its own consent questions, and V1
    // does not have one. Agents reply to conversations customers open.
    if (req.user.role === 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Agents cannot start conversations. Customers begin an enquiry from a listing.',
      })
    }

    const existing = await PropertyConversation.findOne({
      customer: req.user._id,
      property: property._id,
    })

    if (existing) {
      // Reopen rather than duplicate. A thread closed when the listing lost its
      // agent comes back to life against whoever holds it now — and the unique
      // index means a second thread was never an option anyway.
      const needsReopen =
        existing.status === 'closed' || String(existing.agent || '') !== String(agentUser._id)

      if (needsReopen) {
        existing.agent = agentUser._id
        existing.status = 'open'
        // The incoming agent has read none of this thread.
        existing.agentUnreadCount = 0
        existing.agentLastReadAt = null
        await existing.save()
      }

      return res.json({ success: true, conversationId: existing._id, created: false })
    }

    try {
      const created = await PropertyConversation.create({
        property: property._id,
        customer: req.user._id,
        agent: agentUser._id,
        status: 'open',
        lastActivityAt: new Date(),
      })

      return res.status(201).json({ success: true, conversationId: created._id, created: true })
    } catch (err) {
      // Two simultaneous taps both missed the find above and both tried to
      // insert. The unique index rejected the loser; return the winner rather
      // than an error the user did nothing to deserve.
      if (isDuplicateKeyError(err)) {
        const raced = await PropertyConversation.findOne({
          customer: req.user._id,
          property: property._id,
        })
        if (raced) {
          return res.json({ success: true, conversationId: raced._id, created: false })
        }
      }
      throw err
    }
  } catch (err) {
    next(err)
  }
})

/* ───────────────────────── Inbox ───────────────────────── */

/**
 * GET /api/property-conversations
 *
 * The caller's own conversations, newest activity first. Which side they are
 * on is derived from participation, never from a query parameter.
 *
 * Threads nobody has written in yet are EXCLUDED. A conversation exists from
 * the moment a customer taps Message — before they have typed anything — so
 * without that condition an agent's inbox showed customers who had not
 * actually contacted them. The thread itself remains fully readable by id; see
 * inboxScopeFor.
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 50)

    // For an agent this requires BOTH the conversation pointer and current
    // ownership of the listing, so a stale pointer cannot keep a thread in the
    // outgoing agent's inbox. Two indexed queries, never one per row.
    const filter = await inboxScopeFor(req.user)

    const conversations = await PropertyConversation.find(filter)
      .populate('property', PROPERTY_SUMMARY_FIELDS)
      .populate('customer', PARTICIPANT_FIELDS)
      .populate('agent', PARTICIPANT_FIELDS)
      .sort({ lastActivityAt: -1 })
      .limit(limit)

    // The filter already established the side, so it is not re-derived per row.
    const side = req.user.role === 'agent' ? 'agent' : 'customer'

    res.json({
      success: true,
      count: conversations.length,
      conversations: conversations.map((conversation) =>
        conversationResponse(conversation, side)
      ),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/property-conversations/unread-count
 *
 * MUST be declared before '/:id', or the wildcard swallows 'unread-count'.
 *
 * Human messages only. Deliberately separate from
 * /api/notifications/unread-count, which counts new LISTINGS — merging them
 * would produce a badge that means two different things.
 */
router.get('/unread-count', async (req, res, next) => {
  try {
    const isAgent = req.user.role === 'agent'

    // Exactly the scope the inbox uses, so the badge can never count a thread
    // the list does not show. An empty thread contributes 0 by construction
    // (only a send increments a counter), so excluding it changes no total —
    // but keeping the two definitions identical means they cannot drift.
    const match = await inboxScopeFor(req.user)
    const field = isAgent ? '$agentUnreadCount' : '$customerUnreadCount'

    const [result] = await PropertyConversation.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: field } } },
    ])

    res.json({ success: true, count: result?.count || 0 })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/property-conversations/:id
 *
 * Header data for a thread. Messages are paginated separately, so this stays
 * a fixed-size response no matter how long the conversation is.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { conversation, side } = await loadAuthorizedConversation(req.params.id, req.user, {
      populate: true,
    })
    if (!conversation) return notFound(res)

    res.json({
      success: true,
      conversation: {
        ...conversationResponse(conversation, side),
        // Both sides by name here (not just the counterparty) so a thread view
        // can label messages without a second request.
        customer: participantSummary(conversation.customer),
        agent: participantSummary(conversation.agent),
        property: propertySummary(conversation.property),
      },
    })
  } catch (err) {
    next(err)
  }
})

/* ───────────────────────── Messages ───────────────────────── */

/**
 * GET /api/property-conversations/:id/messages?limit=30&before=<messageId>
 *
 * Cursor pagination on `_id`, newest-first from the database (which matches
 * the { conversation: 1, _id: -1 } index), then reversed so each page arrives
 * oldest→newest and a chat view can append it directly.
 *
 * `nextCursor` is the id of the OLDEST message in the page — pass it back as
 * `before` to walk further into history. Null means the start of the thread.
 */
router.get('/:id/messages', async (req, res, next) => {
  try {
    const { conversation } = await loadAuthorizedConversation(req.params.id, req.user)
    if (!conversation) return notFound(res)

    const limit = parseLimit(req.query.limit, MESSAGE_PAGE_DEFAULT, MESSAGE_PAGE_MAX)

    const filter = { conversation: conversation._id }

    if (req.query.before) {
      if (!isValidObjectId(req.query.before)) {
        return res.status(400).json({ success: false, message: 'Invalid cursor' })
      }
      filter._id = { $lt: req.query.before }
    }

    // limit + 1 tells us whether another page exists without a second count.
    const page = await PropertyMessage.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)

    const hasMore = page.length > limit
    const slice = hasMore ? page.slice(0, limit) : page

    // Oldest message of the page, which is the cursor for the next one.
    const nextCursor = hasMore ? slice[slice.length - 1]._id : null

    res.json({
      success: true,
      messages: slice.reverse().map(messageResponse),
      nextCursor,
      hasMore,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/property-conversations/:id/messages   { text }
 *
 * The sender is req.user._id, always. Nothing in the body names a sender.
 */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const { conversation, side } = await loadAuthorizedConversation(req.params.id, req.user)
    if (!conversation) return notFound(res)

    const validated = validateMessageText(req.body?.text)
    if (!validated.ok) {
      return res.status(400).json({ success: false, message: validated.message })
    }

    // Who the message should actually route to comes from the PROPERTY, not
    // from the conversation's stored pointer. If a reassignment half-completed,
    // the pointer may still name the outgoing agent — delivering to them, and
    // ringing their unread badge, would leak a new customer message to someone
    // who no longer holds the listing.
    const currentAgentId = await currentPropertyAgentId(conversation.property)

    const agentUser = currentAgentId
      ? await User.findById(currentAgentId).select('role isActive')
      : null

    const sendable = conversationSendability(conversation, agentUser)
    if (!sendable.ok) {
      return res.status(sendable.status).json({ success: false, message: sendable.message })
    }

    // Self-healing: point the thread back at whoever holds the listing before
    // recording anything against it. Safe on a customer-initiated action
    // because the target is read from the property, never from the request —
    // this grants nobody access, it corrects routing. An agent reaching this
    // line was already verified as the current agent, so it is a no-op for
    // them.
    await reconcileConversationAgent(conversation, currentAgentId)

    const message = await PropertyMessage.create({
      conversation: conversation._id,
      sender: req.user._id,
      text: validated.text,
    })

    // ONE atomic update: $inc on the recipient's counter (never the sender's)
    // plus the denormalized preview. Using $inc rather than read-modify-write
    // means two messages arriving at once both count — the classic lost-update
    // race cannot happen here.
    //
    // The $set of lastMessage is last-writer-wins under true simultaneity, so
    // the preview could reflect either of two messages sent in the same
    // instant. Both are real messages and the thread itself is ordered
    // correctly by _id, so the cost is a momentarily stale preview — not worth
    // a transaction in V1.
    const recipientField = side === 'customer' ? 'agentUnreadCount' : 'customerUnreadCount'

    await PropertyConversation.updateOne(
      { _id: conversation._id },
      {
        $inc: { [recipientField]: 1 },
        $set: {
          lastMessage: {
            text: previewOf(validated.text),
            sender: req.user._id,
            at: message.createdAt,
          },
          lastActivityAt: message.createdAt,
        },
      }
    )

    /*
     * Announce it — and only now.
     *
     * This sits AFTER both writes have committed, so the socket can never tell
     * anyone about a message MongoDB did not accept. Every earlier exit from
     * this handler (404 not authorised, 400 invalid text, 409 closed or
     * unassigned) returns before reaching this line, so a rejected send emits
     * nothing at all.
     *
     * The recipient agent is `currentAgentId` — read from the PROPERTY earlier
     * in this handler — never conversation.agent, which is only a routing
     * pointer and can be stale after a reassignment.
     *
     * Not awaited and not error-checked on purpose: emitNewPropertyMessage
     * swallows its own failures. A realtime problem must never turn a
     * successfully stored message into a failed request, and an offline
     * recipient is a normal condition rather than an error.
     *
     * `req.app?.get` rather than `req.app.get` for the same reason. Express
     * always sets req.app, so this is not about production — it is about the
     * failure boundary being real rather than assumed. Looking up the io
     * instance happens AFTER the message is committed, so anything that can
     * throw on this line would report a stored message as failed. The optional
     * chaining makes that impossible instead of unlikely.
     */
    emitNewPropertyMessage(req.app?.get('io'), {
      conversationId: conversation._id,
      customerId: conversation.customer,
      currentAgentId,
      message,
    })

    /*
     * The second delivery channel, for a recipient whose app is not open.
     *
     * Placed here for exactly the reasons the socket emit is: both writes have
     * committed, the recipient is known, and every rejecting path above has
     * already returned — so a message that was refused notifies nobody.
     *
     * NOT awaited. Expo is a third party on the far side of the internet, and
     * the agent pressing Send should not wait on it to learn their message was
     * stored. The promise is still terminated with .catch() rather than left
     * floating: sendNewMessagePush already swallows its own failures, and this
     * makes an unhandled rejection impossible rather than merely unlikely —
     * the same standard req.app?.get uses two lines above.
     *
     * `req.user.name` costs no query: `protect` already loaded the full user
     * for this request, and the sender IS the person whose name the title
     * shows.
     */
    sendNewMessagePush({
      senderSide: side,
      senderName: req.user?.name,
      customerId: conversation.customer,
      currentAgentId,
      conversationId: conversation._id,
      propertyId: conversation.property,
      message,
    }).catch(() => {})

    res.status(201).json({ success: true, message: messageResponse(message) })
  } catch (err) {
    next(err)
  }
})

/* ───────────────────────── Read state ───────────────────────── */

/**
 * PATCH /api/property-conversations/:id/read
 *
 * Which side gets cleared is decided from req.user. The body is ignored
 * entirely, so a client cannot mark the OTHER participant's messages as read.
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const { conversation, side } = await loadAuthorizedConversation(req.params.id, req.user)
    if (!conversation) return notFound(res)

    const now = new Date()

    const update = side === 'customer'
      ? { customerUnreadCount: 0, customerLastReadAt: now }
      : { agentUnreadCount: 0, agentLastReadAt: now }

    await PropertyConversation.updateOne({ _id: conversation._id }, { $set: update })

    res.json({ success: true, unreadCount: 0, readAt: now })
  } catch (err) {
    next(err)
  }
})

export default router
