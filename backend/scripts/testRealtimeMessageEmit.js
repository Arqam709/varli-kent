// RT-1 verification: the property-message:new event.
//
// The REAL POST /:id/messages handler is pulled out of the router and invoked
// with fake req/res objects and a fake io. The Mongoose models it calls are
// stubbed, so NO database connection is opened, NO document is written and NO
// port is bound — the same approach testPropertyConversationRoutes.js takes.
//
// What this proves:
//   A  a successful send emits exactly one event
//   B  the event is emitted AFTER both writes commit, never before
//   C  a rejected send (validation, authorization, sendability) emits nothing
//   D  recipients are the customer's room and the CURRENT agent's room
//   E  after a reassignment the OUTGOING agent receives nothing
//   F  an unassigned or deleted listing emits nothing (the send is refused)
//   G  the payload carries safe message fields only
//   H  neither side's unread count leaks into the payload
//   I  a realtime failure cannot break a successfully saved REST send
//
// Run with:  node scripts/testRealtimeMessageEmit.js

import mongoose from 'mongoose'
import PropertyConversation from '../models/PropertyConversation.js'
import PropertyMessage from '../models/PropertyMessage.js'
import Property from '../models/Property.js'
import User from '../models/User.js'
import router from '../routes/propertyConversations.js'
import {
  NEW_MESSAGE_EVENT,
  newMessageRooms,
  newMessagePayload,
  emitNewPropertyMessage,
} from '../services/propertyMessagingRealtime.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
}

const oid = () => new mongoose.Types.ObjectId()

/* ── Harness ──────────────────────────────────────────────────────────── */

const handlerFor = (method, path) => {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  )
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

const makeRes = () => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}

const call = async (handler, req) => {
  const res = makeRes()
  let thrown = null
  await handler(req, res, (err) => { thrown = err })
  if (thrown) throw thrown
  return res
}

const query = (value) => {
  const chain = {
    populate: () => chain,
    select: () => chain,
    sort: () => chain,
    limit: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  }
  return chain
}

/**
 * A fake io recording every emit, plus the ORDER of operations relative to the
 * database writes — which is the whole point of test B.
 */
const makeIo = ({ throwOnEmit = false } = {}) => {
  const io = {
    emits: [],
    to(rooms) {
      return {
        emit: (event, payload) => {
          if (throwOnEmit) throw new Error('socket transport exploded')
          io.emits.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], event, payload })
          timeline.push('emit')
        },
      }
    },
  }
  return io
}

/** Records the sequence of writes and emits within a single request. */
let timeline = []

/* ── Cast ─────────────────────────────────────────────────────────────── */

const customerId = oid()
const agentAId = oid()
const agentBId = oid()
const propertyId = oid()
const conversationId = oid()

const customer = { _id: customerId, role: 'user' }
const agentA = { _id: agentAId, role: 'agent' }

const activeAgentA = { _id: agentAId, role: 'agent', isActive: true }
const activeAgentB = { _id: agentBId, role: 'agent', isActive: true }

const openConversation = (overrides = {}) => ({
  _id: conversationId,
  property: propertyId,
  customer: customerId,
  agent: agentAId,
  status: 'open',
  customerUnreadCount: 0,
  agentUnreadCount: 0,
  ...overrides,
})

/* ── Model stubs ──────────────────────────────────────────────────────── */

const real = {
  convFindById: PropertyConversation.findById,
  convUpdateOne: PropertyConversation.updateOne,
  msgCreate: PropertyMessage.create,
  propFindById: Property.findById,
  userFindById: User.findById,
}

const restoreAll = () => {
  PropertyConversation.findById = real.convFindById
  PropertyConversation.updateOne = real.convUpdateOne
  PropertyMessage.create = real.msgCreate
  Property.findById = real.propFindById
  User.findById = real.userFindById
}

const createdMessage = () => ({
  _id: oid(),
  conversation: conversationId,
  sender: customerId,
  text: 'Hello John',
  createdAt: new Date('2026-08-16T20:42:03.221Z'),
})

/**
 * Wires up a send. `propertyAgent` is what Property.findById reports — the
 * CURRENT owner, which is the value the emit must use.
 */
const stubSend = ({
  conversation = openConversation(),
  propertyAgent = agentAId,
  agentAccount = activeAgentA,
  message = createdMessage(),
  failMessageCreate = false,
  failConversationUpdate = false,
} = {}) => {
  timeline = []

  PropertyConversation.findById = () => query(conversation)
  Property.findById = () => query(propertyAgent ? { _id: propertyId, agent: propertyAgent } : null)
  User.findById = () => query(agentAccount)

  PropertyMessage.create = async (doc) => {
    if (failMessageCreate) throw new Error('message write failed')
    timeline.push('createMessage')
    return { ...message, ...doc, _id: message._id, createdAt: message.createdAt }
  }

  PropertyConversation.updateOne = async () => {
    if (failConversationUpdate) throw new Error('conversation update failed')
    timeline.push('updateConversation')
    return { modifiedCount: 1 }
  }

  return message
}

const sendHandler = handlerFor('post', '/:id/messages')

/** Runs a send as `user`, returning { res, io }. */
const send = async (user, body = { text: 'Hello John' }, ioOptions) => {
  const io = makeIo(ioOptions)
  const req = {
    user,
    params: { id: String(conversationId) },
    body,
    app: { get: (key) => (key === 'io' ? io : undefined) },
  }
  const res = await call(sendHandler, req)
  return { res, io }
}

/* ── Tests ────────────────────────────────────────────────────────────── */

const run = async () => {
  console.log('\nA · a successful send emits exactly one event')
  {
    stubSend()
    const { res, io } = await send(customer)
    check('send succeeded', res.statusCode, 201)
    check('exactly one emit', io.emits.length, 1)
    check('event name', io.emits[0]?.event, 'property-message:new')
    check('exported constant matches', NEW_MESSAGE_EVENT, 'property-message:new')
  }

  console.log('\nB · the event is emitted AFTER both writes commit')
  {
    stubSend()
    const { io } = await send(customer)
    check('order is create → update → emit', timeline.join(' → '), 'createMessage → updateConversation → emit')
    check('emit is last', timeline[timeline.length - 1], 'emit')
    check('one emit recorded', io.emits.length, 1)
  }

  console.log('\nC · a rejected send emits nothing')
  {
    stubSend()
    const empty = await send(customer, { text: '   ' })
    check('blank text → 400', empty.res.statusCode, 400)
    check('no emit', empty.io.emits.length, 0)

    stubSend()
    const tooLong = await send(customer, { text: 'x'.repeat(2001) })
    check('over-length text → 400', tooLong.res.statusCode, 400)
    check('no emit', tooLong.io.emits.length, 0)

    stubSend()
    const stranger = await send({ _id: oid(), role: 'user' })
    check('non-participant → 404', stranger.res.statusCode, 404)
    check('no emit', stranger.io.emits.length, 0)

    stubSend({ conversation: openConversation({ status: 'closed' }) })
    const closed = await send(customer)
    check('closed conversation → 409', closed.res.statusCode, 409)
    check('no emit', closed.io.emits.length, 0)

    stubSend({ propertyAgent: null })
    const unassigned = await send(customer)
    check('unassigned listing → 409', unassigned.res.statusCode, 409)
    check('no emit', unassigned.io.emits.length, 0)

    stubSend({ propertyAgent: null, agentAccount: null })
    const deleted = await send(customer)
    check('deleted listing → 409', deleted.res.statusCode, 409)
    check('no emit', deleted.io.emits.length, 0)

    stubSend({ agentAccount: { _id: agentAId, role: 'agent', isActive: false } })
    const inactive = await send(customer)
    check('deactivated agent → 409', inactive.res.statusCode, 409)
    check('no emit', inactive.io.emits.length, 0)
  }

  console.log('\nD · a failed write emits nothing')
  {
    stubSend({ failMessageCreate: true })
    let io1 = null
    try {
      const r = await send(customer)
      io1 = r.io
    } catch {
      // The handler forwards to next(err); either way no emit may have happened.
    }
    check('message write failure → no emit', io1 ? io1.emits.length : 0, 0)

    stubSend({ failConversationUpdate: true })
    let io2 = null
    try {
      const r = await send(customer)
      io2 = r.io
    } catch {
      // ignored
    }
    check('conversation update failure → no emit', io2 ? io2.emits.length : 0, 0)
    check('emit never ran in the timeline', timeline.includes('emit'), false)
  }

  console.log('\nE · recipients are the customer and the CURRENT agent')
  {
    stubSend()
    const { io } = await send(customer)
    const rooms = io.emits[0].rooms

    check('two rooms', rooms.length, 2)
    check('customer room present', rooms.includes(`user:${customerId}`), true)
    check('current agent room present', rooms.includes(`user:${agentAId}`), true)
    check('no conversation room', rooms.some((r) => r.startsWith('conversation:')), false)
    check('every room is a user room', rooms.every((r) => r.startsWith('user:')), true)
  }

  console.log('\nF · the sender also receives it (multi-tab / multi-device)')
  {
    // The agent sends; both rooms are still addressed, including the agent's.
    stubSend()
    const { io } = await send(agentA)
    check('agent send still reaches the agent room', io.emits[0].rooms.includes(`user:${agentAId}`), true)
    check('agent send reaches the customer room', io.emits[0].rooms.includes(`user:${customerId}`), true)
  }

  console.log('\nG · after reassignment the OUTGOING agent receives nothing')
  {
    // The conversation POINTER still names agent A (a half-completed
    // reassignment), but the PROPERTY now says agent B. The emit must follow
    // the property.
    stubSend({
      conversation: openConversation({ agent: agentAId }),
      propertyAgent: agentBId,
      agentAccount: activeAgentB,
    })

    const { res, io } = await send(customer)
    const rooms = io.emits[0].rooms

    check('send succeeded', res.statusCode, 201)
    check('customer still notified', rooms.includes(`user:${customerId}`), true)
    check('INCOMING agent B notified', rooms.includes(`user:${agentBId}`), true)
    check('OUTGOING agent A NOT notified', rooms.includes(`user:${agentAId}`), false)
    check('exactly two recipients', rooms.length, 2)
  }

  console.log('\nH · payload carries safe message fields only')
  {
    stubSend()
    const { io } = await send(customer)
    const payload = io.emits[0].payload

    check('top-level keys', Object.keys(payload).sort().join(','), 'conversationId,lastActivityAt,lastMessage,message')
    check('message keys match messageResponse', Object.keys(payload.message).sort().join(','), '_id,createdAt,sender,text')
    check('conversationId is a string', typeof payload.conversationId, 'string')
    check('conversationId is correct', payload.conversationId, String(conversationId))
    check('text is the sent text', payload.message.text, 'Hello John')
    check('sender is the authenticated user', String(payload.message.sender), String(customerId))

    const serialized = JSON.stringify(payload)
    check('no email in payload', serialized.includes('@'), false)
    check('no password field', serialized.toLowerCase().includes('password'), false)
    check('no role field', serialized.includes('role'), false)
    check('no isActive field', serialized.includes('isActive'), false)
    check('no property document', serialized.includes('propertyType'), false)
  }

  console.log('\nI · no unread count leaks into the payload (would be a read receipt)')
  {
    stubSend({
      conversation: openConversation({ customerUnreadCount: 7, agentUnreadCount: 4 }),
    })
    const { io } = await send(customer)
    const serialized = JSON.stringify(io.emits[0].payload)

    check('no customerUnreadCount key', serialized.includes('customerUnreadCount'), false)
    check('no agentUnreadCount key', serialized.includes('agentUnreadCount'), false)
    check('no unreadCount key at all', serialized.includes('unreadCount'), false)
    // The counts themselves must not appear under any other name either.
    check('payload has exactly 4 top-level keys', Object.keys(io.emits[0].payload).length, 4)
  }

  console.log('\nJ · lastMessage mirrors what was written to the conversation')
  {
    stubSend()
    const { io } = await send(customer)
    const { lastMessage, lastActivityAt, message } = io.emits[0].payload

    check('lastMessage.text matches', lastMessage.text, 'Hello John')
    check('lastMessage.sender matches', String(lastMessage.sender), String(customerId))
    check('lastMessage.at matches createdAt', String(lastMessage.at), String(message.createdAt))
    check('lastActivityAt matches createdAt', String(lastActivityAt), String(message.createdAt))
  }

  console.log('\nK · long text is truncated in the preview but NOT in the message')
  {
    const long = 'y'.repeat(300)
    stubSend()
    const { io } = await send(customer, { text: long })
    const { lastMessage, message } = io.emits[0].payload

    check('preview truncated to 140 + ellipsis', lastMessage.text.length, 141)
    check('preview ends with an ellipsis', lastMessage.text.endsWith('…'), true)
    check('full message text is NOT truncated', message.text.length, 300)
  }

  console.log('\nL · a realtime failure cannot break a saved REST send')
  {
    stubSend()
    const { res } = await send(customer, { text: 'Hello John' }, { throwOnEmit: true })

    check('REST still returns 201', res.statusCode, 201)
    check('REST still returns the message', Boolean(res.body?.message?._id), true)
    check('REST reports success', res.body?.success, true)
    check('both writes still happened', timeline.join(' → '), 'createMessage → updateConversation')
  }

  console.log('\nM · a missing io cannot break a saved REST send')
  {
    stubSend()
    const noIo = {
      user: customer,
      params: { id: String(conversationId) },
      body: { text: 'Hello John' },
      app: { get: () => undefined },   // no io registered at all
    }
    const res1 = await call(sendHandler, noIo)
    check('no io registered → REST still 201', res1.statusCode, 201)
    check('both writes still happened', timeline.join(' → '), 'createMessage → updateConversation')

    /*
     * `req.app` entirely absent.
     *
     * Express always provides it, so this can only happen in a harness — but
     * the lookup runs AFTER the message is committed, so anything that throws
     * here would report a STORED message as failed. That is the exact failure
     * this phase must not have, so it is asserted rather than assumed. This
     * case is not hypothetical: it is what the pre-existing route tests caught.
     */
    stubSend()
    const noApp = {
      user: customer,
      params: { id: String(conversationId) },
      body: { text: 'Hello John' },
    }
    const res2 = await call(sendHandler, noApp)
    check('no req.app → REST still 201', res2.statusCode, 201)
    check('no req.app → message still returned', Boolean(res2.body?.message?._id), true)
    check('no req.app → both writes still happened', timeline.join(' → '), 'createMessage → updateConversation')

    check('emit helper reports no delivery', emitNewPropertyMessage(undefined, {
      conversationId, customerId, currentAgentId: agentAId, message: createdMessage(),
    }), false)
  }

  console.log('\nN · room builder is defensive on its own')
  {
    check('null agent yields the customer alone',
      newMessageRooms({ customerId, currentAgentId: null }).join(','), `user:${customerId}`)
    check('duplicate ids collapse',
      newMessageRooms({ customerId, currentAgentId: customerId }).length, 1)
    check('both present when distinct',
      newMessageRooms({ customerId, currentAgentId: agentAId }).length, 2)
    check('always user rooms',
      newMessageRooms({ customerId, currentAgentId: agentAId }).every((r) => r.startsWith('user:')), true)
  }

  console.log('\nO · payload builder survives JSON transport unchanged')
  {
    // Socket.IO serializes with JSON.stringify, exactly as res.json does — so
    // the client must receive the same shape from both paths.
    const message = createdMessage()
    const payload = newMessagePayload({ conversationId, message })
    const roundTripped = JSON.parse(JSON.stringify(payload))

    check('_id survives as a string', typeof roundTripped.message._id, 'string')
    check('sender survives as a string', typeof roundTripped.message.sender, 'string')
    check('createdAt is an ISO string', roundTripped.message.createdAt, '2026-08-16T20:42:03.221Z')
    check('matches the REST createdAt format', roundTripped.message.createdAt, message.createdAt.toISOString())
  }

  restoreAll()

  console.log(
    failed === 0
      ? `\nALL PASSED — ${passed} passed, 0 failed\n`
      : `\nFAILURES — ${passed} passed, ${failed} failed\n`
  )
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((err) => {
  restoreAll()
  console.error(err)
  process.exit(1)
})
