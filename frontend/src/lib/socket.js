/**
 * The website's Socket.IO connection.
 *
 * ── What this is for ────────────────────────────────────────────────────
 * A server → client notification channel for the Agent Portal. REST remains
 * the authoritative API for everything: loading conversations, loading
 * messages, sending, and marking read all still go through lib/api.js exactly
 * as before. Phase RT-0 opens the connection and nothing more — no events are
 * sent or received yet.
 *
 * This is NOT the Gemini assistant (ChatContext / /api/chat) and has nothing to
 * do with it.
 */

import { io } from 'socket.io-client'
import { apiUrl } from './api'

/**
 * Turns the REST base URL into the Socket.IO origin.
 *
 *   https://varli-kent-backend.onrender.com/api  →  https://varli-kent-backend.onrender.com
 *   http://localhost:5000/api                    →  http://localhost:5000
 *   http://localhost:5000/api/                   →  http://localhost:5000
 *
 * Derived from the ONE existing configuration value rather than introducing a
 * second environment variable, because two URLs pointing at the same backend is
 * two things to keep in step and one of them will eventually be wrong.
 *
 * ── Why this regex and not .replace('/api', '') ─────────────────────────
 * A bare replace rewrites the FIRST match anywhere in the string, which would
 * mangle a perfectly valid host like https://api.varlikent.com/api into
 * https://.varlikent.com/api. The anchor makes it strictly a trailing segment,
 * and `(?=\/|$)` ensures only a whole segment matches — a backend served from
 * https://example.com/apiary is left alone.
 */
export const socketOrigin = (baseUrl = apiUrl) => String(baseUrl).replace(/\/api\/?$/, '')

/**
 * Opens an authenticated socket.
 *
 * ── Never write ws:// or wss:// ─────────────────────────────────────────
 * The URL passed in is http(s), and socket.io-client derives the WebSocket
 * scheme itself — https upgrades to wss, http to ws. Hardcoding wss:// breaks
 * local development; hardcoding ws:// breaks production, because a page served
 * over HTTPS is not allowed to open an insecure WebSocket.
 *
 * ── Why the token goes in `auth` ────────────────────────────────────────
 * `auth` travels in the Socket.IO handshake payload. A query string would put a
 * seven-day credential into Render's access logs, every proxy log in between,
 * and browser history.
 */
export const createSocket = (token) =>
  io(socketOrigin(), {
    auth: { token },
    // The browser keeps the default polling → websocket upgrade path, which
    // survives corporate proxies that block raw WebSocket upgrades. (The mobile
    // app pins 'websocket' instead — React Native has no such proxies to worry
    // about and its XHR polling is the slower, flakier option there.)
    withCredentials: true,
    // A rejected handshake is a credential problem, not a network blip, so
    // socket.io-client does not retry it — reconnection applies to a connection
    // that was established and then dropped, which is what we want.
    reconnection: true,
  })
