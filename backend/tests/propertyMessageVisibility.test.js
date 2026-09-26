// "Delete for me" in PROPERTY customer↔agent messaging — the pure rules.
//
// No database: the serializers, the visibility filter and the realtime
// fan-out, exercised directly. The end-to-end behaviour against a real MongoDB
// lives in propertyMessageVisibility.mongo.test.js.
//
// The central promise tested here: a participant with NO private view — every
// agent on the website — gets byte-for-byte the output they got before this
// feature existed.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import {
  conversationResponse,
  effectiveLastMessage,
  inboxScopeFor,
  isMessageSender,
  lastMessageResponse,
  messageResponse,
  participantViewOf,
} from '../services/propertyMessaging.js'
import { visibleMessagesFilter } from '../services/propertyMessageVisibility.js'
import {
  CONVERSATION_CLEARED_EVENT,
  MESSAGE_HIDDEN_EVENT,
  NEW_MESSAGE_EVENT,
  emitToOwnDevices,
} from '../services/propertyMessagingRealtime.js'

const id = () => new mongoose.Types.ObjectId()

const CUSTOMER = id()
const AGENT = id()
const M1 = id()
const M2 = id()

const sharedPreview = { text: "I'm interested", sender: CUSTOMER, at: new Date('2026-01-01T10:02:00Z'), message: M2 }

const conversation = (extra = {}) => ({
  _id: id(),
  status: 'open',
  property: null,
  customer: CUSTOMER,
  agent: AGENT,
  lastMessage: sharedPreview,
  lastActivityAt: sharedPreview.at,
  customerUnreadCount: 0,
  agentUnreadCount: 1,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  ...extra,
})

const customerHidNewest = {
  user: CUSTOMER,
  clearedThrough: null,
  previewThrough: M2,
  preview: { text: 'Hello', sender: AGENT, at: new Date('2026-01-01T10:01:00Z') },
}

// ── The other participant is unaffected ──────────────────────────────────

test('without a private view, the response is exactly the pre-feature shape', () => {
  const doc = conversation()
  const out = conversationResponse(doc, 'agent', AGENT)

  assert.deepEqual(Object.keys(out).sort(), [
    '_id', 'counterparty', 'createdAt', 'lastActivityAt', 'lastMessage', 'property', 'role', 'status', 'unreadCount',
  ])
  // No private-state fields leak, and the internal message id is not exposed.
  assert.deepEqual(out.lastMessage, { text: "I'm interested", sender: CUSTOMER, at: sharedPreview.at })
  assert.equal(out.unreadCount, 1)
})

test("the customer's private view never changes what the agent is served", () => {
  const base = conversation()
  const withCustomerState = { ...base, participantViews: [customerHidNewest], hiddenFromInbox: [CUSTOMER] }
  assert.deepEqual(conversationResponse(withCustomerState, 'agent', AGENT), conversationResponse(base, 'agent', AGENT))
})

test('messages serialize exactly as before: hiddenFor is never exposed', () => {
  const out = messageResponse({ _id: M1, sender: CUSTOMER, text: 'Hello', createdAt: new Date(), hiddenFor: [CUSTOMER] })
  assert.deepEqual(Object.keys(out).sort(), ['_id', 'createdAt', 'sender', 'text'])
  assert.equal(out.text, 'Hello')
})

// ── The customer sees their own preview ──────────────────────────────────

test("a valid private preview replaces the shared one for that user only", () => {
  const doc = conversation({ participantViews: [customerHidNewest] })
  assert.equal(conversationResponse(doc, 'customer', CUSTOMER).lastMessage.text, 'Hello')
  assert.equal(conversationResponse(doc, 'agent', AGENT).lastMessage.text, "I'm interested")
})

test('a private preview stops applying once a newer message moves the shared one on', () => {
  const next = { text: 'Are you still interested?', sender: AGENT, at: new Date('2026-01-02T09:00:00Z'), message: id() }
  const doc = conversation({ lastMessage: next, participantViews: [customerHidNewest] })
  assert.equal(effectiveLastMessage(doc, CUSTOMER).text, 'Are you still interested?')
})

test('a valid override with no preview means nothing is visible to that user', () => {
  const doc = conversation({ participantViews: [{ ...customerHidNewest, preview: null }] })
  assert.equal(effectiveLastMessage(doc, CUSTOMER), null)
  assert.equal(conversationResponse(doc, 'customer', CUSTOMER).lastMessage, null)
})

test('an older row without lastMessage.message never matches an override', () => {
  const { message, ...legacy } = sharedPreview
  assert.ok(message)
  const doc = conversation({ lastMessage: legacy, participantViews: [customerHidNewest] })
  assert.equal(effectiveLastMessage(doc, CUSTOMER).text, "I'm interested")
})

test('views are looked up by user, whatever shape the ids arrive in', () => {
  const doc = conversation({ participantViews: [customerHidNewest] })
  assert.equal(participantViewOf(doc, String(CUSTOMER)), customerHidNewest)
  assert.equal(participantViewOf(doc, AGENT), null)
  assert.equal(participantViewOf({}, CUSTOMER), null)
})

test('the public preview shape is { text, sender, at } or null', () => {
  assert.equal(lastMessageResponse(null), null)
  assert.equal(lastMessageResponse({ text: 'x', at: null }), null)
  assert.deepEqual(Object.keys(lastMessageResponse(sharedPreview)).sort(), ['at', 'sender', 'text'])
})

// ── Filters ──────────────────────────────────────────────────────────────

test("the message filter excludes only the caller's hidden messages", () => {
  const doc = conversation()
  const filter = visibleMessagesFilter(doc, CUSTOMER)
  assert.equal(String(filter.conversation), String(doc._id))
  assert.equal(String(filter.hiddenFor.$ne), String(CUSTOMER))
  assert.equal('_id' in filter, false)
})

test("a clear cutoff applies to that user and nobody else", () => {
  const cutoff = id()
  const doc = conversation({ participantViews: [{ user: CUSTOMER, clearedThrough: cutoff }] })
  assert.equal(String(visibleMessagesFilter(doc, CUSTOMER)._id.$gt), String(cutoff))
  assert.equal('_id' in visibleMessagesFilter(doc, AGENT), false)
})

test("the inbox excludes rows the caller removed, in the query", async () => {
  const scope = await inboxScopeFor({ _id: CUSTOMER, role: 'user' })
  assert.equal(String(scope.hiddenFromInbox.$ne), String(CUSTOMER))
  assert.deepEqual(scope['lastMessage.at'], { $ne: null })
})

test('only the sender may hide a message', () => {
  assert.equal(isMessageSender({ sender: CUSTOMER }, { _id: CUSTOMER }), true)
  assert.equal(isMessageSender({ sender: CUSTOMER }, { _id: String(CUSTOMER) }), true)
  assert.equal(isMessageSender({ sender: AGENT }, { _id: CUSTOMER }), false)
  assert.equal(isMessageSender(null, { _id: CUSTOMER }), false)
})

// ── Realtime ─────────────────────────────────────────────────────────────

test("visibility events go to the acting user's own room and nowhere else", () => {
  const calls = []
  const io = { to: (rooms) => ({ emit: (event, payload) => calls.push({ rooms, event, payload }) }) }

  assert.equal(emitToOwnDevices(io, CUSTOMER, MESSAGE_HIDDEN_EVENT, { conversationId: 'c' }), true)
  assert.deepEqual(calls[0].rooms, `user:${CUSTOMER}`)
  assert.equal(calls[0].event, 'property-message:hidden')
})

test('visibility event names are distinct from the new-message event', () => {
  assert.equal(MESSAGE_HIDDEN_EVENT, 'property-message:hidden')
  assert.equal(CONVERSATION_CLEARED_EVENT, 'property-conversation:cleared')
  assert.notEqual(MESSAGE_HIDDEN_EVENT, NEW_MESSAGE_EVENT)
})

test('a realtime failure never throws', () => {
  const originalError = console.error
  console.error = () => {}
  try {
    assert.equal(emitToOwnDevices({ to: () => { throw new Error('down') } }, CUSTOMER, MESSAGE_HIDDEN_EVENT, {}), false)
    assert.equal(emitToOwnDevices(undefined, CUSTOMER, MESSAGE_HIDDEN_EVENT, {}), false)
    assert.equal(emitToOwnDevices({ to: () => ({ emit() {} }) }, null, MESSAGE_HIDDEN_EVENT, {}), false)
  } finally {
    console.error = originalError
  }
})
