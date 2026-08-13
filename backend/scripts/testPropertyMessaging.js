// Focused unit tests for human property messaging: schemas, indexes,
// participation rules, serializers, validation and reassignment.
//
// No database connection, no network, no document written. Mongoose schemas
// validate in memory via validateSync(), and the one function that would touch
// Mongo (handlePropertyAgentReassignment) has updateMany stubbed.
// Run with:  node scripts/testPropertyMessaging.js

import mongoose from 'mongoose'
import PropertyConversation from '../models/PropertyConversation.js'
import PropertyMessage, { MAX_MESSAGE_LENGTH, MESSAGE_PREVIEW_LENGTH } from '../models/PropertyMessage.js'
import Property from '../models/Property.js'
import {
  isCustomerOf,
  matchesAgentPointer,
  authorizeConversationAccess,
  conversationScopeFor,
  reconcileConversationAgent,
  participantSummary,
  propertySummary,
  conversationResponse,
  messageResponse,
  validateMessageText,
  previewOf,
  conversationSendability,
  handlePropertyAgentReassignment,
} from '../services/propertyMessaging.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
}

const oid = () => new mongoose.Types.ObjectId()

const customerId = oid()
const agentAId = oid()
const agentBId = oid()
const strangerId = oid()
const propertyId = oid()

const customer = { _id: customerId, role: 'user', name: 'Ahsan', avatar: '' }
const agentA = { _id: agentAId, role: 'agent', name: 'Ahmet Yılmaz', avatar: '' }
const agentB = { _id: agentBId, role: 'agent', name: 'Mehmet Kaya', avatar: '' }
const stranger = { _id: strangerId, role: 'user', name: 'Ali', avatar: '' }
const admin = { _id: oid(), role: 'admin', name: 'Admin' }
const owner = { _id: oid(), role: 'owner', name: 'Owner' }

const conversation = {
  _id: oid(),
  property: propertyId,
  customer: customerId,
  agent: agentAId,
  status: 'open',
}

/* ── Human messaging must not be the AI chatbot ───────────────────────── */

console.log('\n== separate collections from the AI assistant ==')
check('conversation model name', PropertyConversation.modelName, 'PropertyConversation')
check('message model name', PropertyMessage.modelName, 'PropertyMessage')
check('conversation collection', PropertyConversation.collection.name, 'propertyconversations')
check('message collection', PropertyMessage.collection.name, 'propertymessages')
// Admin User Chats queries chatconversations; a different collection cannot
// surface there by accident.
check('not the AI collection', PropertyConversation.collection.name === 'chatconversations', false)

/* ── Schemas ──────────────────────────────────────────────────────────── */

console.log('\n== PropertyConversation schema ==')
const blankConversation = new PropertyConversation({}).validateSync()
check('property required', Boolean(blankConversation.errors.property), true)
check('customer required', Boolean(blankConversation.errors.customer), true)
// Nullable: an unassigned listing clears the agent so the old one loses access.
check('agent NOT required', Boolean(blankConversation.errors.agent), false)

const freshConversation = new PropertyConversation({ property: propertyId, customer: customerId })
check('status defaults to open', freshConversation.status, 'open')
check('agent defaults to null', freshConversation.agent, null)
check('customer unread starts 0', freshConversation.customerUnreadCount, 0)
check('agent unread starts 0', freshConversation.agentUnreadCount, 0)
check('customerLastReadAt starts null', freshConversation.customerLastReadAt, null)
check('agentLastReadAt starts null', freshConversation.agentLastReadAt, null)
// So a conversation with no messages still sorts into the inbox.
check('lastActivityAt is set at creation', freshConversation.lastActivityAt instanceof Date, true)
check('bad status rejected', Boolean(new PropertyConversation({ property: propertyId, customer: customerId, status: 'archived' }).validateSync()?.errors.status), true)
check('negative unread rejected', Boolean(new PropertyConversation({ property: propertyId, customer: customerId, customerUnreadCount: -1 }).validateSync()?.errors.customerUnreadCount), true)

console.log('\n== PropertyMessage schema ==')
const blankMessage = new PropertyMessage({}).validateSync()
check('conversation required', Boolean(blankMessage.errors.conversation), true)
check('sender required', Boolean(blankMessage.errors.sender), true)
check('text required', Boolean(blankMessage.errors.text), true)

const validMessage = new PropertyMessage({ conversation: oid(), sender: customerId, text: '  Is this still available?  ' })
check('valid message passes', validMessage.validateSync(), undefined)
check('text is trimmed', validMessage.text, 'Is this still available?')

const emptyText = new PropertyMessage({ conversation: oid(), sender: customerId, text: '   ' })
check('whitespace-only rejected at schema level', Boolean(emptyText.validateSync()?.errors.text), true)

const atMax = new PropertyMessage({ conversation: oid(), sender: customerId, text: 'x'.repeat(MAX_MESSAGE_LENGTH) })
check('exactly max length accepted', atMax.validateSync(), undefined)
const overMax = new PropertyMessage({ conversation: oid(), sender: customerId, text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })
check('one over max rejected', Boolean(overMax.validateSync()?.errors.text), true)

/* ── Indexes ──────────────────────────────────────────────────────────── */

console.log('\n== indexes ==')
const conversationIndexes = PropertyConversation.schema.indexes()
const findIndex = (indexes, key) =>
  indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify(key))

const uniquePair = findIndex(conversationIndexes, { customer: 1, property: 1 })
check('customer+property index exists', Boolean(uniquePair), true)
check('customer+property is UNIQUE', uniquePair?.[1]?.unique, true)
// Keying on the agent as well would allow a duplicate thread after a
// reassignment, which is exactly what this prevents.
check('agent is NOT part of the unique key', Boolean(findIndex(conversationIndexes, { customer: 1, property: 1, agent: 1 })), false)
check('customer inbox index', Boolean(findIndex(conversationIndexes, { customer: 1, lastActivityAt: -1 })), true)
check('agent inbox index', Boolean(findIndex(conversationIndexes, { agent: 1, lastActivityAt: -1 })), true)
// The unique index starts with `customer`, so it cannot serve reassignment's
// property-only lookup.
check('property index for reassignment', Boolean(findIndex(conversationIndexes, { property: 1 })), true)

const messageIndexes = PropertyMessage.schema.indexes()
check('message pagination index {conversation, _id:-1}', Boolean(findIndex(messageIndexes, { conversation: 1, _id: -1 })), true)

/* ── Participation ────────────────────────────────────────────────────── */

/* ── Authorization ────────────────────────────────────────────────────── */

// Property.agent is the authorization authority, so these tests stub it.
const realPropertyFindById = Property.findById
const realPropertyFind = Property.find

/** Makes Property.findById report a given current agent for the listing. */
const stubPropertyAgent = (agentId) => {
  Property.findById = () => ({
    select: async () => (agentId === undefined ? null : { _id: propertyId, agent: agentId }),
  })
}

const sideFor = async (conv, user) => (await authorizeConversationAccess(conv, user)).side

console.log('\n== authorization: only the two people in the thread ==')
stubPropertyAgent(agentAId) // property and conversation agree
check('customer is authorised', await sideFor(conversation, customer), 'customer')
check('assigned agent is authorised', await sideFor(conversation, agentA), 'agent')
check('another customer is NOT', await sideFor(conversation, stranger), null)
check('another agent is NOT', await sideFor(conversation, agentB), null)
// V1 decision: these are two people talking privately, unlike the AI
// transcripts which are conversations with the company's own software.
check('admin is NOT (no view_chats bypass)', await sideFor(conversation, admin), null)
check('owner is NOT', await sideFor(conversation, owner), null)
check('null user is NOT', await sideFor(conversation, null), null)
check('null conversation is NOT', await sideFor(null, customer), null)

console.log('\n== a demoted agent loses agent-side access immediately ==')
// conversation.agent still equals their id, so an id comparison alone would
// keep letting them read a customer's messages.
const demoted = { ...agentA, role: 'user' }
check('id still matches', String(conversation.agent) === String(demoted._id), true)
check('pointer check fails on role', matchesAgentPointer(conversation, demoted), false)
check('authorization denies', await sideFor(conversation, demoted), null)

console.log('\n== an unassigned conversation has no agent participant ==')
stubPropertyAgent(null)
const orphaned = { ...conversation, agent: null, status: 'closed' }
check('previous agent no longer authorised', await sideFor(orphaned, agentA), null)
check('customer still authorised (read-only history)', await sideFor(orphaned, customer), 'customer')

/* ── THE STALE-POINTER HOLE ───────────────────────────────────────────── */

console.log('\n== STALE POINTER: property says B, conversation still says A ==')
// Reproduces the exact failure the property route tolerates: the listing was
// reassigned, the conversation write that should have followed did not land.
stubPropertyAgent(agentBId)
const stale = { ...conversation, agent: agentAId } // pointer still names A

check('outgoing agent A: pointer STILL matches', matchesAgentPointer(stale, agentA), true)
// ...and that is exactly why the pointer cannot be the final authority.
check('outgoing agent A is DENIED', await sideFor(stale, agentA), null)
// Incoming agent B is denied too — privacy over availability until the
// pointer catches up.
check('incoming agent B is denied until reconciled', await sideFor(stale, agentB), null)
// The customer owns their side regardless of who answers them.
check('customer keeps access to their history', await sideFor(stale, customer), 'customer')

console.log('\n== STALE POINTER: property unassigned, conversation still says A ==')
stubPropertyAgent(null)
check('agent A denied (no current owner)', await sideFor(stale, agentA), null)
check('customer still authorised', await sideFor(stale, customer), 'customer')

console.log('\n== deleted property: agent fails closed, customer keeps history ==')
stubPropertyAgent(undefined) // findById → null
check('agent denied when ownership cannot be verified', await sideFor(stale, agentA), null)
check('customer history survives a deleted listing', await sideFor(stale, customer), 'customer')

/* ── REGRESSION: populated references ─────────────────────────────────────
 *
 * GET /:id loads the conversation with .populate() on customer, agent and
 * property; every other route does not. That single difference shipped a bug:
 * the id comparison was String(a) === String(b), and String() of a populated
 * Mongoose document is its inspect output, not a hex id. A customer opening
 * their own thread got 404 while messages/send/read worked.
 *
 * These use REAL Mongoose documents, not plain objects. The earlier tests
 * above pass raw ObjectIds, which is exactly why they never caught it.
 */
console.log('\n== populated refs authorize identically to raw ones ==')

const UserModel = (await import('../models/User.js')).default

const populatedConversation = {
  _id: conversation._id,
  property: propertyId,
  // What .populate() actually produces — full documents, not ids.
  customer: new UserModel({ _id: customerId, name: 'Ahsan', role: 'user', isActive: true }),
  agent: new UserModel({ _id: agentAId, name: 'Ahmet', role: 'agent', isActive: true }),
  status: 'open',
}

// Proves the trap is real rather than theoretical.
check(
  'String() of a populated doc is NOT the id',
  String(populatedConversation.customer) === String(customerId),
  false
)

stubPropertyAgent(agentAId)
check('customer authorised with a populated customer ref', await sideFor(populatedConversation, customer), 'customer')
check('agent authorised with a populated agent ref', await sideFor(populatedConversation, agentA), 'agent')
check('stranger still denied', await sideFor(populatedConversation, stranger), null)
check('other agent still denied', await sideFor(populatedConversation, agentB), null)
check('admin still denied', await sideFor(populatedConversation, admin), null)

// The security rules must survive the unwrap, not be softened by it.
stubPropertyAgent(agentBId)
check(
  'stale pointer still denies the outgoing agent (populated)',
  await sideFor(populatedConversation, agentA),
  null
)
check(
  'customer keeps access under a stale pointer (populated)',
  await sideFor(populatedConversation, customer),
  'customer'
)

const demotedPopulated = { ...agentA, role: 'user' }
stubPropertyAgent(agentAId)
check('demoted agent still denied (populated)', await sideFor(populatedConversation, demotedPopulated), null)

console.log('\n== a populated property ref resolves too ==')
// conversation.property is populated on the same route.
const PropertyModel = (await import('../models/Property.js')).default
const populatedPropertyRef = {
  ...populatedConversation,
  property: new PropertyModel({ _id: propertyId, title: 'Sarıyer flat' }),
}
stubPropertyAgent(agentAId)
check('agent authorised via a populated property ref', await sideFor(populatedPropertyRef, agentA), 'agent')

console.log('\n== customer authorization never consults the property ==')
stubPropertyAgent(agentBId)
check('customer side ignores role', await sideFor(conversation, { ...customer, role: 'admin' }), 'customer')
check('isCustomerOf is pointer-only', isCustomerOf(conversation, customer), true)

/* ── Inbox / unread scope ─────────────────────────────────────────────── */

console.log('\n== list scope is ownership-aware ==')
Property.find = () => ({ select: async () => [{ _id: propertyId }] })

const customerScope = await conversationScopeFor(customer)
check('customer scope is their own id only', Object.keys(customerScope).join(','), 'customer')
check('customer scope does not query properties', String(customerScope.customer), String(customerId))

const agentScope = await conversationScopeFor(agentA)
check('agent scope requires the pointer', String(agentScope.agent), String(agentAId))
// Both conditions must hold: a stale pointer OR lost ownership excludes the row.
check('agent scope also requires current ownership', Array.isArray(agentScope.property.$in), true)
check('agent scope lists their properties', String(agentScope.property.$in[0]), String(propertyId))

Property.find = () => ({ select: async () => [] })
const noListings = await conversationScopeFor(agentA)
check('agent with no listings matches nothing', noListings.property.$in.length, 0)

/* ── Reconciliation ───────────────────────────────────────────────────── */

console.log('\n== reconciliation points the thread back at the property ==')
let reconcileUpdate = null
const realUpdateOne = PropertyConversation.updateOne
PropertyConversation.updateOne = async (filter, update) => {
  reconcileUpdate = { filter, update }
  return { modifiedCount: 1 }
}

const staleDoc = { _id: conversation._id, agent: agentAId, agentUnreadCount: 9, agentLastReadAt: new Date() }
const didReconcile = await reconcileConversationAgent(staleDoc, String(agentBId))
check('a write was needed', didReconcile, true)
check('pointer moved to the current agent', String(reconcileUpdate.update.$set.agent), String(agentBId))
check('incoming agent unread reset', reconcileUpdate.update.$set.agentUnreadCount, 0)
check('incoming agent lastReadAt reset', reconcileUpdate.update.$set.agentLastReadAt, null)
// The in-memory doc is updated too, so the caller's next write targets B.
check('in-memory doc updated', String(staleDoc.agent), String(agentBId))
check('customer state untouched', 'customerUnreadCount' in reconcileUpdate.update.$set, false)

reconcileUpdate = null
const noop = await reconcileConversationAgent({ _id: conversation._id, agent: agentBId }, String(agentBId))
check('already correct → no write', noop, false)
check('no update issued', reconcileUpdate, null)

PropertyConversation.updateOne = realUpdateOne
Property.findById = realPropertyFindById
Property.find = realPropertyFind

/* ── Serializers ──────────────────────────────────────────────────────── */

console.log('\n== participant summary exposes identity only ==')
const fullUser = {
  _id: agentAId,
  name: 'Ahmet Yılmaz',
  avatar: 'https://cdn/a.png',
  email: 'ahmet@varlikent.com',
  role: 'agent',
  isActive: true,
  permissions: ['user_management'],
  password: 'hashed',
  resetPasswordToken: 'secret',
}
const summary = participantSummary(fullUser)
check('keys', Object.keys(summary).sort().join(','), '_id,avatar,name')
check('email NOT exposed', 'email' in summary, false)
check('role NOT exposed', 'role' in summary, false)
check('isActive NOT exposed', 'isActive' in summary, false)
check('permissions NOT exposed', 'permissions' in summary, false)
check('password NOT exposed', 'password' in summary, false)
check('resetPasswordToken NOT exposed', 'resetPasswordToken' in summary, false)
check('null user → null', participantSummary(null), null)

console.log('\n== property summary ==')
const propertyDoc = {
  _id: propertyId,
  title: 'Luxury Apartment in Sarıyer',
  district: 'Sarıyer',
  listingType: 'Sale',
  propertyType: 'Apartment',
  price: 15000000,
  priceLabel: '₺15,000,000',
  mainImage: '',
  images: ['https://cdn/1.jpg'],
  status: 'Available',
  descriptionEmbedding: [0.1, 0.2],
}
const propSummary = propertySummary(propertyDoc)
check('descriptionEmbedding NOT exposed', 'descriptionEmbedding' in propSummary, false)
check('title', propSummary.title, 'Luxury Apartment in Sarıyer')
check('falls back to first image', propSummary.mainImage, 'https://cdn/1.jpg')
// Properties are hard-deleted, so a thread can outlive its listing.
check('deleted property tolerated', propertySummary(null), null)

console.log('\n== conversation response is per-viewer ==')
const populated = {
  _id: conversation._id,
  status: 'open',
  property: propertyDoc,
  customer: { _id: customerId, name: 'Ahsan', avatar: '' },
  agent: fullUser,
  lastMessage: { text: 'Can I arrange a viewing?', sender: customerId, at: new Date() },
  lastActivityAt: new Date(),
  customerUnreadCount: 2,
  agentUnreadCount: 7,
  createdAt: new Date(),
}

const asCustomer = conversationResponse(populated, 'customer')
const asAgent = conversationResponse(populated, 'agent')

check('customer sees the agent as counterparty', asCustomer.counterparty.name, 'Ahmet Yılmaz')
check('agent sees the customer as counterparty', asAgent.counterparty.name, 'Ahsan')
check('customer gets their own unread', asCustomer.unreadCount, 2)
check('agent gets their own unread', asAgent.unreadCount, 7)
// Exposing the other side's counter would be a read receipt, which V1 does
// not offer.
check('customer cannot see agent unread', JSON.stringify(asCustomer).includes('agentUnreadCount'), false)
check('agent cannot see customer unread', JSON.stringify(asAgent).includes('customerUnreadCount'), false)
check('counterparty carries no email', 'email' in asCustomer.counterparty, false)
check('role echoed for the client', asCustomer.role, 'customer')

const neverMessaged = conversationResponse({ ...populated, lastMessage: { text: '', sender: null, at: null } }, 'customer')
check('no messages yet → lastMessage null', neverMessaged.lastMessage, null)

console.log('\n== message response stays light ==')
const msg = { _id: oid(), conversation: conversation._id, sender: customerId, text: 'Hello', createdAt: new Date() }
const shapedMessage = messageResponse(msg)
check('keys', Object.keys(shapedMessage).sort().join(','), '_id,createdAt,sender,text')
// Two participants only, and the client already holds both summaries — a
// nested user object on every message would be pure weight.
check('sender is a bare id', String(shapedMessage.sender), String(customerId))
check('conversation id omitted (it is the URL)', 'conversation' in shapedMessage, false)

/* ── Text validation ──────────────────────────────────────────────────── */

console.log('\n== message text validation ==')
const text = (raw) => {
  const result = validateMessageText(raw)
  return result.ok ? `ok:${result.text}` : 'rejected'
}
check('normal text', text('Is this still available?'), 'ok:Is this still available?')
check('trimmed', text('  hello  '), 'ok:hello')
check('empty rejected', text(''), 'rejected')
check('whitespace-only rejected', text('     '), 'rejected')
check('newlines-only rejected', text('\n\n\t'), 'rejected')
check('undefined rejected', text(undefined), 'rejected')
check('null rejected', text(null), 'rejected')
check('number rejected', text(42), 'rejected')
check('object rejected', text({ text: 'hi' }), 'rejected')
check('exactly max accepted', validateMessageText('x'.repeat(MAX_MESSAGE_LENGTH)).ok, true)
check('one over max rejected', validateMessageText('x'.repeat(MAX_MESSAGE_LENGTH + 1)).ok, false)
check('long text trims to within max', validateMessageText(`  ${'x'.repeat(MAX_MESSAGE_LENGTH)}  `).ok, true)

console.log('\n== inbox preview is bounded ==')
check('short text unchanged', previewOf('Hello'), 'Hello')
check('long text truncated', previewOf('x'.repeat(500)).length, MESSAGE_PREVIEW_LENGTH + 1)

/* ── Sendability ──────────────────────────────────────────────────────── */

console.log('\n== when a conversation may accept messages ==')
const activeAgent = { role: 'agent', isActive: true }
check('open + active agent', conversationSendability({ status: 'open', agent: agentAId }, activeAgent).ok, true)
check('closed conversation', conversationSendability({ status: 'closed', agent: agentAId }, activeAgent).ok, false)
check('closed → 409', conversationSendability({ status: 'closed', agent: agentAId }, activeAgent).status, 409)
// Would otherwise bank messages into an inbox nobody can open.
check('deactivated agent', conversationSendability({ status: 'open', agent: agentAId }, { role: 'agent', isActive: false }).ok, false)
check('demoted agent', conversationSendability({ status: 'open', agent: agentAId }, { role: 'user', isActive: true }).ok, false)
check('agent deleted', conversationSendability({ status: 'open', agent: agentAId }, null).ok, false)
check('no agent assigned', conversationSendability({ status: 'open', agent: null }, null).ok, false)

/* ── Reassignment ─────────────────────────────────────────────────────── */

console.log('\n== property agent reassignment ==')

let lastCall = null
const realUpdateMany = PropertyConversation.updateMany
PropertyConversation.updateMany = async (filter, update) => {
  lastCall = { filter, update }
  return { modifiedCount: 3 }
}

const reassign = (previousAgentId, nextAgentId) =>
  handlePropertyAgentReassignment({ propertyId, previousAgentId, nextAgentId })

// A → B: transfer.
lastCall = null
const transferred = await reassign(agentAId, agentBId)
check('A→B action', transferred.action, 'transferred')
check('A→B updates all conversations for the property', String(lastCall.filter.property), String(propertyId))
// Scoped to the OUTGOING agent so a thread already moved is not disturbed.
check('A→B scoped to the outgoing agent', String(lastCall.filter.agent), String(agentAId))
check('A→B sets the new agent', String(lastCall.update.$set.agent), String(agentBId))
check('A→B resets incoming agent unread', lastCall.update.$set.agentUnreadCount, 0)
check('A→B resets incoming agent lastReadAt', lastCall.update.$set.agentLastReadAt, null)
// Open stays open, closed stays closed — reopening is the customer's explicit act.
check('A→B does not touch status', 'status' in lastCall.update.$set, false)
check('A→B does not touch customer read state', 'customerUnreadCount' in lastCall.update.$set, false)
check('A→B uses one bulk write', typeof transferred.changed, 'number')

// A → null: close and detach.
lastCall = null
const closed = await reassign(agentAId, null)
check('A→null action', closed.action, 'closed')
check('A→null closes the thread', lastCall.update.$set.status, 'closed')
// Clearing the id is what actually revokes the old agent's access.
check('A→null clears the agent', lastCall.update.$set.agent, null)
check('A→null resets agent unread', lastCall.update.$set.agentUnreadCount, 0)

// null → B: nothing. Creating threads on a customer's behalf would
// manufacture conversations nobody asked for.
lastCall = null
const assignedFresh = await reassign(null, agentBId)
check('null→B action', assignedFresh.action, 'none')
check('null→B writes nothing', lastCall, null)

// Same agent: an ordinary property edit must not disturb messaging.
lastCall = null
const unchanged = await reassign(agentAId, agentAId)
check('A→A action', unchanged.action, 'none')
check('A→A writes nothing', lastCall, null)

// ObjectId vs string identity must not fake a change.
lastCall = null
const sameDifferentTypes = await reassign(agentAId, String(agentAId))
check('ObjectId vs string is not a change', sameDifferentTypes.action, 'none')

PropertyConversation.updateMany = realUpdateMany

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
