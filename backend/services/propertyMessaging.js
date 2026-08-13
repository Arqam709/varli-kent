// Shared rules for human customer↔agent messaging.
//
// The route layer does HTTP; this file decides who may see what, what a
// response looks like, and what happens to a conversation when a listing
// changes hands. Keeping it here means the participant rule and the
// serializers have exactly one definition each — the two things most likely to
// drift and leak if copy-pasted around a router.

import mongoose from 'mongoose'
import PropertyConversation from '../models/PropertyConversation.js'
import Property from '../models/Property.js'
import { MESSAGE_PREVIEW_LENGTH, MAX_MESSAGE_LENGTH } from '../models/PropertyMessage.js'
import { isAssignableAgent } from './agentAssignment.js'

/* ── Authorization ─────────────────────────────────────────────────────────
 *
 * TWO SOURCES OF TRUTH, AND THEY ARE NOT EQUAL:
 *
 *   Property.agent              — who is CURRENTLY responsible for the listing.
 *                                 This is the authorization authority.
 *
 *   PropertyConversation.agent  — a denormalized routing pointer, kept in step
 *                                 by handlePropertyAgentReassignment(). It says
 *                                 where new messages go and whose unread
 *                                 counter moves. It is NOT an access grant.
 *
 * Normally they agree. They can disagree for a window if the property write
 * succeeds and the conversation write that follows it fails — the property
 * route deliberately does not fail a saved listing edit over a messaging
 * error. In that window the pointer is stale, and trusting it alone would
 * leave the OUTGOING agent reading a customer's private thread about a listing
 * they no longer hold.
 *
 * So agent-side authorization asks the property, every time. Consistency is
 * repaired separately (see reconcileConversationAgent) — but access does not
 * wait for that repair, and never depends on it having worked.
 */

/**
 * Unwraps an id that may arrive raw or as a populated document.
 *
 * A conversation reference is an ObjectId until someone calls .populate() on
 * it, after which it is a full Mongoose document. Both shapes reach the
 * comparisons below — GET /:id populates, every other route does not — so an
 * id comparison MUST normalise before comparing.
 */
const idOf = (value) => {
  if (!value) return null
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

/**
 * Compares two ids that may each be an ObjectId, a hex string, or a populated
 * document.
 *
 * ── Why this cannot be String(a) === String(b) ───────────────────────────
 * That was the original implementation, and it silently broke the one route
 * that populates. `String(objectId)` gives the hex id, but `String()` of a
 * populated Mongoose document gives its inspect output:
 *
 *   "{ name: 'john', _id: new ObjectId('68f2...') }"
 *
 * which never equals a hex id. The customer check therefore returned false on
 * GET /:id, and a customer opening their own thread got 404 Conversation not
 * found — while messages, send and read (none of which populate) worked.
 */
const sameId = (a, b) => {
  const left = idOf(a)
  const right = idOf(b)
  return Boolean(left) && Boolean(right) && left === right
}

/**
 * The customer side is pointer-only, and correctly so: a customer owns their
 * half of the conversation permanently. Reassigning the listing changes who
 * answers them, never their right to their own history.
 */
export const isCustomerOf = (conversation, user) =>
  Boolean(conversation) && Boolean(user) && sameId(conversation.customer, user._id)

/**
 * The conversation's stored agent pointer matches this user, and they are
 * still an agent at all.
 *
 * NOT SUFFICIENT ON ITS OWN — deliberately named to say so. It ignores whether
 * the property is still theirs, which is exactly the stale-pointer hole. Route
 * code must call authorizeConversationAccess() instead; this is one of its
 * three conditions.
 */
export const matchesAgentPointer = (conversation, user) =>
  Boolean(conversation) &&
  Boolean(user) &&
  user.role === 'agent' &&
  sameId(conversation.agent, user._id)

/** Who currently owns this listing, or null (also null if it was deleted). */
export const currentPropertyAgentId = async (propertyRef) => {
  const propertyId = idOf(propertyRef)
  if (!propertyId || !mongoose.isValidObjectId(propertyId)) return null

  const property = await Property.findById(propertyId).select('agent')
  return property?.agent ? String(property.agent) : null
}

/**
 * THE authorization entry point for a single conversation.
 *
 * Returns { side: 'customer' | 'agent' | null }. A null side means the caller
 * gets a 404 — indistinguishable from "no such conversation", so probing
 * cannot confirm a thread exists.
 *
 * Agent access requires ALL THREE of:
 *   1. user.role === 'agent'                  (a demoted account loses access)
 *   2. conversation.agent === user._id        (they are this thread's agent)
 *   3. Property.agent === user._id            (they still hold the listing)
 *
 * These are additive, not alternatives — adding the property check does not
 * relax the role or pointer checks that were already there.
 *
 * A deleted property fails closed for the agent: current ownership can no
 * longer be established, so it is not assumed. The customer keeps their
 * history either way.
 */
export const authorizeConversationAccess = async (conversation, user) => {
  if (!conversation || !user) return { side: null }

  // Checked first: the customer's right does not depend on the property at
  // all, so this costs no query and cannot be disturbed by a stale pointer.
  if (isCustomerOf(conversation, user)) return { side: 'customer' }

  if (!matchesAgentPointer(conversation, user)) return { side: null }

  const currentAgentId = await currentPropertyAgentId(conversation.property)
  if (!sameId(currentAgentId, user._id)) return { side: null }

  return { side: 'agent' }
}

/**
 * Admins and owners get NO special access. That is a decision, not an
 * oversight: the AI transcripts are visible to `view_chats` holders because
 * those conversations are with the company's own bot, whereas these are two
 * people talking privately. Support access, if it is ever wanted, should be a
 * new permission with an audit trail rather than an inherited one.
 */

/**
 * The listing ids this agent currently holds.
 *
 * Used to intersect the inbox and the unread badge with real ownership. One
 * indexed query (Property.agent is indexed), not one per conversation.
 */
export const currentAgentPropertyIds = async (agentId) => {
  const properties = await Property.find({ agent: agentId }).select('_id')
  return properties.map((property) => property._id)
}

/**
 * The filter behind both the inbox and the unread count.
 *
 * For an agent it requires BOTH the conversation pointer AND current listing
 * ownership. Either one being stale excludes the row, which is the fail-closed
 * behaviour we want in both directions:
 *
 *   outgoing agent — the property is no longer in their list → hidden
 *   incoming agent — the pointer has not moved to them yet   → hidden
 *
 * The incoming agent briefly seeing nothing is the acceptable half of that
 * trade: privacy over availability, and the customer's next action repairs it.
 */
export const conversationScopeFor = async (user) => {
  if (user.role !== 'agent') return { customer: user._id }

  const propertyIds = await currentAgentPropertyIds(user._id)
  return { agent: user._id, property: { $in: propertyIds } }
}

/* ── Serializers ───────────────────────────────────────────────────────── */

/** The only shape a conversation participant is ever exposed as. */
export const participantSummary = (user) => {
  if (!user) return null
  return {
    _id: user._id,
    name: user.name || '',
    avatar: user.avatar || '',
  }
}

export const PARTICIPANT_FIELDS = 'name avatar role isActive'

/**
 * The listing, as shown on a conversation row or header.
 *
 * Tolerates null: properties are hard-deleted, so an old conversation can
 * outlive its listing. The thread stays readable and the client renders a
 * "listing removed" state rather than crashing.
 */
export const propertySummary = (property) => {
  if (!property) return null
  return {
    _id: property._id,
    title: property.title || '',
    district: property.district || '',
    listingType: property.listingType,
    propertyType: property.propertyType,
    price: property.price,
    priceLabel: property.priceLabel || '',
    mainImage: property.mainImage || property.images?.[0] || '',
    status: property.status,
  }
}

// An inclusion list: descriptionEmbedding (a large ML vector) and every future
// Property field are excluded by default rather than by remembering to add
// them to an exclusion string.
export const PROPERTY_SUMMARY_FIELDS =
  'title district listingType propertyType price priceLabel mainImage images status'

/**
 * One conversation, shaped for the requesting participant.
 *
 * `unreadCount` is THIS user's own count. The other side's is deliberately
 * withheld — exposing it would be a read receipt, which V1 does not offer.
 *
 * Expects `property`, `customer` and `agent` to be populated documents.
 */
export const conversationResponse = (conversation, side) => {
  const counterparty = side === 'customer' ? conversation.agent : conversation.customer

  return {
    _id: conversation._id,
    status: conversation.status,
    property: propertySummary(conversation.property),
    // "The other person", already resolved — the client never has to work out
    // which of two ids is theirs.
    counterparty: participantSummary(counterparty),
    role: side,
    lastMessage: conversation.lastMessage?.at
      ? {
          text: conversation.lastMessage.text || '',
          sender: conversation.lastMessage.sender || null,
          at: conversation.lastMessage.at,
        }
      : null,
    lastActivityAt: conversation.lastActivityAt,
    unreadCount: side === 'customer'
      ? conversation.customerUnreadCount || 0
      : conversation.agentUnreadCount || 0,
    createdAt: conversation.createdAt,
  }
}

/**
 * One message.
 *
 * `sender` stays a bare id rather than a nested user object: a conversation
 * has exactly two participants and the client already holds both summaries
 * from the conversation payload, so repeating a name and avatar on all thirty
 * messages of a page is pure weight. `conversation` is omitted too — it is the
 * id in the URL that produced this list.
 */
export const messageResponse = (message) => ({
  _id: message._id,
  sender: message.sender,
  text: message.text,
  createdAt: message.createdAt,
})

/* ── Text validation ───────────────────────────────────────────────────── */

export const validateMessageText = (raw) => {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Message text is required' }
  }

  const text = raw.trim()

  if (text.length === 0) {
    return { ok: false, message: 'Message text is required' }
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }
  }

  return { ok: true, text }
}

export const previewOf = (text) =>
  text.length > MESSAGE_PREVIEW_LENGTH ? `${text.slice(0, MESSAGE_PREVIEW_LENGTH)}…` : text

/* ── Agent availability ────────────────────────────────────────────────── */

/**
 * Whether this conversation can currently accept messages.
 *
 * `agentUser` is the account currently responsible for the LISTING (not
 * whoever the conversation pointer happens to name), freshly loaded. Re-checked
 * on every send because a stored reference goes stale the moment someone is
 * deactivated, demoted or reassigned — without it a customer would keep
 * sending into a thread whose agent cannot log in, or worse, whose agent has
 * moved on, incrementing an unread counter that routes to the wrong person.
 */
export const conversationSendability = (conversation, agentUser) => {
  if (conversation.status !== 'open') {
    return { ok: false, status: 409, message: 'This conversation is closed.' }
  }

  if (!isAssignableAgent(agentUser)) {
    return {
      ok: false,
      status: 409,
      message: 'This conversation is unavailable until an agent is assigned to the property.',
    }
  }

  return { ok: true }
}

/**
 * Points a conversation back at whoever currently holds the listing.
 *
 * This is the RECOVERY half of the design. Authorization already refuses to
 * trust a stale pointer, so nothing is unsafe while it is wrong — but the
 * thread is invisible to the incoming agent until the pointer catches up, and
 * this is what makes it catch up without a background job or a repair
 * endpoint.
 *
 * Safe to call on a customer-initiated action because it grants nobody
 * anything: it moves the pointer TOWARDS the property, which is the
 * authorization authority. It cannot be used to hand a conversation to an
 * arbitrary user, because the target is read from the property, never from a
 * request.
 *
 * Returns true when a write was needed.
 */
export const reconcileConversationAgent = async (conversation, currentAgentId) => {
  if (sameId(conversation.agent, currentAgentId)) return false

  await PropertyConversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        agent: currentAgentId,
        // The incoming agent has read none of this thread, and the outgoing
        // agent's counter was counting for a different person.
        agentUnreadCount: 0,
        agentLastReadAt: null,
      },
    }
  )

  // Keep the in-memory document in step so the caller's subsequent writes
  // (the unread $inc below it, for instance) target the right agent.
  conversation.agent = currentAgentId
  conversation.agentUnreadCount = 0
  conversation.agentLastReadAt = null

  return true
}

/* ── Reassignment ──────────────────────────────────────────────────────── */

/**
 * Keeps conversations in step when a listing changes hands.
 *
 * Called by the property route AFTER the property update succeeds — not from
 * agentAssignment.js, which would then have to import conversation models and
 * would couple "validate an agent id" to "rewrite messaging state". The
 * property route already knows both the before and after agent, so it is the
 * natural place to trigger this.
 *
 * All four transitions, and why:
 *
 *   A → B     transfer. One thread per customer per listing is the rule, so
 *             the existing conversation moves rather than a second being
 *             created. Message senders are immutable, so the record of who
 *             said what is untouched — only the routing pointer changes.
 *
 *   A → null  close and detach. Clearing `agent` is what actually removes the
 *             old agent's access; leaving the id would keep them matching the
 *             participant check on a listing they no longer hold.
 *
 *   null → B  nothing. Creating conversations on the customer's behalf would
 *             manufacture threads nobody asked for. A closed thread reopens
 *             when the customer presses Message Agent again — an explicit act.
 *
 *   A → A     nothing.
 *
 * Uses updateMany: a popular listing can have many customers, and this is one
 * indexed write regardless of how many.
 */
export const handlePropertyAgentReassignment = async ({
  propertyId,
  previousAgentId,
  nextAgentId,
}) => {
  const previous = previousAgentId ? String(previousAgentId) : null
  const next = nextAgentId ? String(nextAgentId) : null

  if (previous === next) return { changed: 0, action: 'none' }
  if (!previous) return { changed: 0, action: 'none' }

  // Scoped to conversations still pointing at the OUTGOING agent, so a thread
  // already moved by an earlier edit is not disturbed.
  const filter = { property: propertyId, agent: previous }

  if (next) {
    const result = await PropertyConversation.updateMany(filter, {
      $set: {
        agent: next,
        // The incoming agent has read none of this thread, and inheriting a
        // counter that was counting for someone else would be meaningless.
        // Starting at zero understates the backlog — the thread still surfaces
        // near the top of their inbox by lastActivityAt — and V1 does not try
        // to reconstruct per-person unread history.
        agentUnreadCount: 0,
        agentLastReadAt: null,
      },
    })
    return { changed: result.modifiedCount ?? 0, action: 'transferred' }
  }

  const result = await PropertyConversation.updateMany(filter, {
    $set: {
      agent: null,
      status: 'closed',
      agentUnreadCount: 0,
      agentLastReadAt: null,
    },
  })
  return { changed: result.modifiedCount ?? 0, action: 'closed' }
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

export const isValidObjectId = (id) => mongoose.isValidObjectId(id)

/** Mongo's duplicate-key error, raised by the unique customer+property index. */
export const isDuplicateKeyError = (err) => err && err.code === 11000
