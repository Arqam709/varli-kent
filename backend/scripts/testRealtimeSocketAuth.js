// RT-0 verification: Socket.IO handshake authentication and room membership.
//
// The real authenticateSocket / handleConnection functions run against fake
// socket objects and a stubbed User model. NO database connection is opened, NO
// port is bound and NO Socket.IO server is started — the same approach
// testPropertyConversationRoutes.js takes with the Express handlers.
//
// What this proves:
//   A  a valid JWT is accepted
//   B  a missing token is rejected
//   C  a malformed / wrongly-signed token is rejected
//   D  an EXPIRED token is rejected
//   E  a deactivated account is rejected even with a perfectly valid token
//   F  a deleted account is rejected
//   G  an authenticated socket joins exactly one room: its own user:<id>
//   H  no conversation room is ever joined
//   I  there is NO client-to-server event handler to forge identity with
//   J  protect() — the HTTP path — still behaves identically after the refactor
//
// Run with:  node scripts/testRealtimeSocketAuth.js

import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { protect, userFromToken } from '../middleware/auth.js'
import { authenticateSocket, handleConnection, userRoom } from '../realtime/socket.js'

// Set before anything reads it. The real secret is never needed or touched.
process.env.JWT_SECRET = 'test-secret-for-rt0-verification-only'

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

/** A stub satisfying the chainable query API `User.findById(x).select(y)`. */
const query = (value) => {
  const chain = {
    select: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  }
  return chain
}

/**
 * A fake socket recording everything the connection handler does to it.
 *
 * `rooms` and `handlers` are what the assertions below actually inspect: which
 * rooms were joined, and which client events the server agreed to listen for.
 */
const makeSocket = (token) => ({
  id: `sock_${Math.random().toString(36).slice(2, 8)}`,
  handshake: token === undefined ? {} : { auth: { token } },
  data: {},
  rooms: [],
  handlers: [],
  join(room) { this.rooms.push(room) },
  on(event, fn) { this.handlers.push(event) },
})

/** Runs the handshake middleware, returning { ok, error }. */
const handshake = async (socket) => {
  let error = null
  await authenticateSocket(socket, (err) => { error = err || null })
  return { ok: error === null, error }
}

const makeRes = () => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}

/* ── Cast ─────────────────────────────────────────────────────────────── */

const agentId = oid()
const customerId = oid()

const activeAgent = { _id: agentId, name: 'john', role: 'agent', isActive: true }
const activeCustomer = { _id: customerId, name: 'Ayse', role: 'user', isActive: true }
const inactiveAgent = { _id: agentId, name: 'john', role: 'agent', isActive: false }

const sign = (id, options = {}) => jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { expiresIn: '7d', ...options })

/* ── Model stub ───────────────────────────────────────────────────────── */

const realUserFindById = User.findById

/** Whatever `record` is set to becomes the result of every User.findById. */
let record = null
User.findById = () => query(record)

const restore = () => { User.findById = realUserFindById }

/* ── Tests ────────────────────────────────────────────────────────────── */

const run = async () => {
  console.log('\nA · valid JWT is accepted')
  {
    record = activeAgent
    const socket = makeSocket(sign(agentId))
    const { ok } = await handshake(socket)
    check('handshake succeeds', ok, true)
    check('socket.data.user is set', String(socket.data.user?._id), String(agentId))
    check('identity came from the token, not the client', socket.data.user.role, 'agent')
  }

  console.log('\nB · missing token is rejected')
  {
    record = activeAgent

    const noAuth = makeSocket(undefined)
    const a = await handshake(noAuth)
    check('absent handshake.auth rejected', a.ok, false)
    check('error message is opaque', a.error?.message, 'unauthorized')
    check('no identity attached', noAuth.data.user, undefined)

    const emptyToken = makeSocket('')
    check('empty-string token rejected', (await handshake(emptyToken)).ok, false)

    const nonString = makeSocket({ id: String(agentId) })
    check('non-string token rejected', (await handshake(nonString)).ok, false)
  }

  console.log('\nC · forged / malformed token is rejected')
  {
    record = activeAgent

    check('garbage string rejected', (await handshake(makeSocket('not-a-jwt'))).ok, false)

    // Correctly formed, correct payload — signed with the wrong key. This is
    // the one that matters: it proves the signature is actually verified.
    const forged = jwt.sign({ id: String(agentId) }, 'attacker-chosen-secret')
    const result = await handshake(makeSocket(forged))
    check('token signed with a different secret rejected', result.ok, false)
    check('error is still opaque', result.error?.message, 'unauthorized')
  }

  console.log('\nD · expired token is rejected')
  {
    record = activeAgent
    const expired = sign(agentId, { expiresIn: '-1h' })
    const result = await handshake(makeSocket(expired))
    check('expired token rejected', result.ok, false)
    check('no identity attached', result.error?.message, 'unauthorized')
  }

  console.log('\nE · deactivated account is rejected')
  {
    // The token is genuinely valid — this is purely the isActive rule, and it
    // must match what protect() does for HTTP.
    record = inactiveAgent
    const socket = makeSocket(sign(agentId))
    const result = await handshake(socket)
    check('isActive:false rejected despite valid token', result.ok, false)
    check('no identity attached', socket.data.user, undefined)
  }

  console.log('\nF · deleted account is rejected')
  {
    record = null
    check('valid token for a missing user rejected', (await handshake(makeSocket(sign(agentId)))).ok, false)
  }

  console.log('\nG · authenticated socket joins its own room, and only its own')
  {
    record = activeAgent
    const socket = makeSocket(sign(agentId))
    await handshake(socket)
    handleConnection(socket)

    check('joined exactly one room', socket.rooms.length, 1)
    check('room is user:<own id>', socket.rooms[0], `user:${agentId}`)
    check('userRoom() format matches', userRoom(agentId), `user:${agentId}`)
  }

  console.log('\nH · a second account lands in a different room')
  {
    record = activeCustomer
    const socket = makeSocket(sign(customerId))
    await handshake(socket)
    handleConnection(socket)

    check('customer room is their own', socket.rooms[0], `user:${customerId}`)
    check('customer is NOT in the agent room', socket.rooms.includes(`user:${agentId}`), false)
    check('no conversation room joined', socket.rooms.some((r) => r.startsWith('conversation:')), false)
  }

  console.log('\nI · there is no client-to-server API to forge identity with')
  {
    record = activeAgent
    const socket = makeSocket(sign(agentId))
    await handshake(socket)
    handleConnection(socket)

    // 'disconnect' is emitted by the SERVER, not the client, so listening for
    // it grants a client nothing. Any OTHER handler would be a client-callable
    // entry point and must not exist in RT-0.
    const clientCallable = socket.handlers.filter((event) => event !== 'disconnect')
    check('only the disconnect listener is registered', socket.handlers.length, 1)
    check('no client-callable handlers', clientCallable.length, 0)
    check('specifically: no join handler', socket.handlers.includes('join'), false)
    check('specifically: no join-user handler', socket.handlers.includes('join-user'), false)
    check('specifically: no join-conversation handler', socket.handlers.includes('join-conversation'), false)
    check('specifically: no send-message handler', socket.handlers.includes('send-message'), false)
  }

  console.log('\nJ · two sockets for one account share one room (tabs / devices)')
  {
    record = activeAgent

    const tab1 = makeSocket(sign(agentId))
    await handshake(tab1)
    handleConnection(tab1)

    const tab2 = makeSocket(sign(agentId))
    await handshake(tab2)
    handleConnection(tab2)

    check('both sockets joined the same room', tab1.rooms[0] === tab2.rooms[0], true)
    check('they are distinct sockets', tab1.id === tab2.id, false)
  }

  console.log('\nK · protect() still behaves identically after the refactor')
  {
    record = activeAgent

    const withToken = { headers: { authorization: `Bearer ${sign(agentId)}` } }
    let nexted = false
    const res1 = makeRes()
    await protect(withToken, res1, () => { nexted = true })
    check('valid bearer token calls next()', nexted, true)
    check('req.user is populated', String(withToken.user?._id), String(agentId))

    const noHeader = { headers: {} }
    const res2 = makeRes()
    await protect(noHeader, res2, () => {})
    check('no header → 401', res2.statusCode, 401)
    check('no header → original message', res2.body?.message, 'Not authorized, no token')

    const badToken = { headers: { authorization: 'Bearer garbage' } }
    const res3 = makeRes()
    await protect(badToken, res3, () => {})
    check('bad token → 401', res3.statusCode, 401)
    check('bad token → original message', res3.body?.message, 'Not authorized, invalid token')

    record = inactiveAgent
    const inactive = { headers: { authorization: `Bearer ${sign(agentId)}` } }
    const res4 = makeRes()
    await protect(inactive, res4, () => {})
    check('inactive user → 401', res4.statusCode, 401)
    check('inactive user → original message', res4.body?.message, 'Not authorized, user not found or inactive')
  }

  console.log('\nL · HTTP and socket share one resolver, so they cannot drift')
  {
    // Same token, same stubbed record, both transports — the assertion is that
    // one function decided both answers.
    record = inactiveAgent
    const token = sign(agentId)

    const viaResolver = await userFromToken(token)
    const viaSocket = await handshake(makeSocket(token))

    const req = { headers: { authorization: `Bearer ${token}` } }
    const res = makeRes()
    await protect(req, res, () => {})

    check('resolver refuses the inactive account', viaResolver, null)
    check('socket refuses it too', viaSocket.ok, false)
    check('HTTP refuses it too', res.statusCode, 401)
  }

  restore()

  console.log(
    failed === 0
      ? `\nALL PASSED — ${passed} passed, 0 failed\n`
      : `\nFAILURES — ${passed} passed, ${failed} failed\n`
  )
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((err) => {
  restore()
  console.error(err)
  process.exit(1)
})
