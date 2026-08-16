// Socket.IO foundation: authenticate the handshake, put the socket in its
// owner's room, and stop there.
//
// ── What this layer is, and is not ──────────────────────────────────────
// It is a SERVER → CLIENT notification channel. REST remains the authoritative
// write path and the source of truth; MongoDB is unchanged. Phase RT-0
// deliberately emits nothing at all — no message events, no presence, no
// typing. Its entire job is to prove that an authenticated socket can exist.
//
// ── Why there is no client → server API ─────────────────────────────────
// There is not a single `socket.on(...)` handler for a client-sent event
// below, and that is a security property rather than an omission. A
// conventional design exposes something like `socket.emit('join', { userId })`
// — which is a request to be given access, phrased by the party asking for it.
// Here, room membership is derived entirely from a verified JWT, so there is no
// message a client can send to influence what it receives. The attack surface
// is not defended; it does not exist.
//
// ── Why user rooms and not conversation rooms ───────────────────────────
// A conversation room would have to be joined after an authorization check,
// and then LEFT again when a listing is reassigned to another agent — because
// Property.agent is the live authority and it can change at any moment (see
// services/propertyMessaging.js). Any missed eviction leaves the outgoing agent
// silently subscribed to a customer's private thread.
//
// User rooms have no such failure mode. A socket is only ever in the room of
// the account that authenticated it, and recipients are computed at emit time
// from current database state. There is no membership that can go stale,
// because there is no membership that encodes access.

import { userFromToken } from '../middleware/auth.js'

/** The one room name format. `user:<mongo id>`, never anything else. */
export const userRoom = (userId) => `user:${userId}`

/**
 * Rejects the handshake unless it carries a JWT for an existing active account.
 *
 * Reuses userFromToken(), the SAME resolver protect() uses for HTTP, so the two
 * transports cannot diverge on what counts as authenticated. A deactivated
 * account is refused here exactly as it is refused there.
 *
 * ── Why handshake.auth and not the query string ─────────────────────────
 * A query string is part of the URL, and URLs are written to Render's access
 * logs, to any intermediate proxy log, and to browser history. These tokens
 * last seven days. `handshake.auth` travels in the Socket.IO handshake payload
 * instead, which is not logged as a URL.
 *
 * The client is told only 'unauthorized'. Distinguishing "expired" from
 * "malformed" from "no such user" would tell an attacker which half of a guess
 * was right, and the client has the same recovery either way: sign in again.
 */
export const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token

    if (typeof token !== 'string' || !token) {
      return next(new Error('unauthorized'))
    }

    const user = await userFromToken(token)

    if (!user) {
      return next(new Error('unauthorized'))
    }

    // The socket's identity, fixed for its lifetime. This is the socket's
    // equivalent of req.user, and — exactly as on the HTTP side — nothing the
    // client sends is ever consulted to determine who it is.
    socket.data.user = user

    next()
  } catch {
    // jwt.verify throws on an expired or tampered token; a database failure can
    // throw too. Both are refused, because neither established an identity.
    next(new Error('unauthorized'))
  }
}

/**
 * Everything that happens once a socket is authenticated.
 *
 * Note what is absent: no client event handlers. `disconnect` is emitted by the
 * server itself, not by the client, so listening for it grants nobody anything.
 */
export const handleConnection = (socket) => {
  const userId = String(socket.data.user._id)

  // The socket joins its OWN room and no other. Multiple sockets for one
  // account — two browser tabs, two phones — all land in the same room, which
  // is how a future emit reaches every session of a user without any
  // per-device bookkeeping.
  socket.join(userRoom(userId))

  // Ids only. Never the token, never the Authorization header, never the User
  // document — a log line is not a place for a name or an email address.
  console.log(`[realtime] connected socket=${socket.id} user=${userId}`)

  socket.on('disconnect', (reason) => {
    // Socket.IO removes the socket from its rooms automatically on disconnect;
    // there is nothing to clean up by hand.
    console.log(`[realtime] disconnected socket=${socket.id} user=${userId} reason=${reason}`)
  })
}

/**
 * Wires the two pieces above onto an io instance.
 *
 * Kept separate from server.js so the transport setup (ports, CORS, HTTP
 * server) and the authentication rules stay independently readable, and so the
 * rules can be unit-tested without opening a port —
 * see scripts/testRealtimeSocketAuth.js.
 */
export const registerRealtime = (io) => {
  io.use(authenticateSocket)
  io.on('connection', handleConnection)

  return io
}
