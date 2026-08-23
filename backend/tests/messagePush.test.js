// Push notifications for new property messages.
//
// The REAL messagePush service runs here; only the Phase-8A sender is faked, so
// no notification can leave the process and no network call is made. What is
// under test is the decision layer: who gets notified, what the payload says,
// and that a provider failure stays contained.

import test, { before, mock } from 'node:test'
import assert from 'node:assert/strict'

const CUSTOMER = 'customer-id'
const AGENT = 'agent-id'
const CONVERSATION = 'conversation-id'
const PROPERTY = 'property-id'

// ── Faked Phase-8A sender ────────────────────────────────────────────────
let sends = []
let nextResult = { attempted: 1, accepted: 1, failed: 0 }
let nextThrow = null

mock.module('../services/pushNotifications.js', {
  namedExports: {
    sendPushToUsers: async (args) => {
      sends.push(args)
      if (nextThrow) throw nextThrow
      return nextResult
    },
  },
})

let sendNewMessagePush
let messagePushRecipient
let notificationPreview
let MESSAGE_PREVIEW_LENGTH

before(async () => {
  const mod = await import('../services/messagePush.js')
  sendNewMessagePush = mod.sendNewMessagePush
  messagePushRecipient = mod.messagePushRecipient
  notificationPreview = mod.notificationPreview
  ;({ MESSAGE_PREVIEW_LENGTH } = await import('../models/PropertyMessage.js'))
})

test.beforeEach(() => {
  sends = []
  nextResult = { attempted: 1, accepted: 1, failed: 0 }
  nextThrow = null
})

const agentReply = (overrides = {}) => ({
  senderSide: 'agent',
  senderName: 'Ahmet',
  customerId: CUSTOMER,
  currentAgentId: AGENT,
  conversationId: CONVERSATION,
  propertyId: PROPERTY,
  message: { text: 'Hi, this property is still available.' },
  ...overrides,
})

// ── Recipient selection ──────────────────────────────────────────────────
test('an agent reply notifies the CUSTOMER', async () => {
  await sendNewMessagePush(agentReply())

  assert.equal(sends.length, 1)
  assert.deepEqual(sends[0].userIds, [CUSTOMER])
})

test('the sender is never notified about their own message', async () => {
  await sendNewMessagePush(agentReply())

  const targeted = sends.flatMap((s) => s.userIds)
  assert.equal(targeted.includes(AGENT), false, 'the agent sent it; they must not be told')
})

test('a customer message sends NO push — the agent has no mobile app in V1', async () => {
  await sendNewMessagePush(agentReply({ senderSide: 'customer' }))

  assert.equal(sends.length, 0)
})

test('the recipient rule is expressed as "the other side"', () => {
  assert.equal(
    messagePushRecipient({ senderSide: 'agent', customerId: CUSTOMER, currentAgentId: AGENT }),
    CUSTOMER
  )
  assert.equal(
    messagePushRecipient({ senderSide: 'customer', customerId: CUSTOMER, currentAgentId: AGENT }),
    null
  )
})

test('a conversation with no customer notifies nobody rather than crashing', async () => {
  await sendNewMessagePush(agentReply({ customerId: null }))
  assert.equal(sends.length, 0)
})

// ── Payload ──────────────────────────────────────────────────────────────
test('the payload carries type=message and the conversation id', async () => {
  await sendNewMessagePush(agentReply())

  assert.deepEqual(sends[0].data, {
    type: 'message',
    conversationId: CONVERSATION,
    propertyId: PROPERTY,
  })
})

test('the payload contains NOTHING beyond routing ids', async () => {
  await sendNewMessagePush(agentReply())

  const keys = Object.keys(sends[0].data).sort()
  assert.deepEqual(keys, ['conversationId', 'propertyId', 'type'])

  // Nothing private may ride along in the payload.
  const serialised = JSON.stringify(sends[0].data)
  assert.equal(serialised.includes('Ahmet'), false, 'no participant names')
  assert.equal(serialised.includes('still available'), false, 'no message text')
})

test('propertyId is omitted rather than sent as undefined', async () => {
  await sendNewMessagePush(agentReply({ propertyId: null }))

  assert.deepEqual(Object.keys(sends[0].data).sort(), ['conversationId', 'type'])
})

test('ids are stringified, so an ObjectId cannot reach the payload as an object', async () => {
  await sendNewMessagePush(
    agentReply({ conversationId: { toString: () => CONVERSATION } })
  )

  assert.equal(typeof sends[0].data.conversationId, 'string')
  assert.equal(sends[0].data.conversationId, CONVERSATION)
})

// ── Title ────────────────────────────────────────────────────────────────
test('the title names the sender', async () => {
  await sendNewMessagePush(agentReply())
  assert.equal(sends[0].title, 'New message from Ahmet')
})

test('a missing sender name falls back to something still true', async () => {
  for (const name of [undefined, null, '', '   ']) {
    sends = []
    await sendNewMessagePush(agentReply({ senderName: name }))
    assert.equal(sends[0].title, 'New message from your agent', `for ${JSON.stringify(name)}`)
  }
})

// ── Preview ──────────────────────────────────────────────────────────────
test('a short message is used whole', async () => {
  await sendNewMessagePush(agentReply())
  assert.equal(sends[0].body, 'Hi, this property is still available.')
})

test('a long message is bounded by the existing preview length', async () => {
  const long = 'x'.repeat(2000)
  await sendNewMessagePush(agentReply({ message: { text: long } }))

  assert.ok(
    sends[0].body.length <= MESSAGE_PREVIEW_LENGTH,
    `body was ${sends[0].body.length}, limit ${MESSAGE_PREVIEW_LENGTH}`
  )
  assert.ok(sends[0].body.endsWith('…'), 'truncation is visible to the reader')
})

test('whitespace is collapsed so the tray entry is one tidy line', () => {
  assert.equal(notificationPreview('Hello\n\nthere\t  friend  '), 'Hello there friend')
})

test('an empty or missing message body does not crash', async () => {
  for (const text of [undefined, null, '']) {
    sends = []
    await sendNewMessagePush(agentReply({ message: { text } }))
    assert.equal(sends[0].body, '')
  }
})

test('the stored message is never mutated by preview generation', async () => {
  const message = { text: '  Spaced\n\nout  ' }
  await sendNewMessagePush(agentReply({ message }))

  assert.equal(message.text, '  Spaced\n\nout  ')
})

// ── Failure containment ──────────────────────────────────────────────────
test('a provider failure is reported, not thrown', async () => {
  nextResult = { attempted: 1, accepted: 0, failed: 1 }

  const result = await sendNewMessagePush(agentReply())

  assert.equal(result.sent, false)
})

test('an exception inside the sender never escapes to the caller', async () => {
  nextThrow = new Error('database unavailable')

  await assert.doesNotReject(() => sendNewMessagePush(agentReply()))

  const result = await sendNewMessagePush(agentReply())
  assert.equal(result.sent, false)
})

test('a successful send reports sent', async () => {
  const result = await sendNewMessagePush(agentReply())
  assert.equal(result.sent, true)
})
