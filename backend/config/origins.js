// Which browser origins may talk to this backend.
//
// ── Why this file exists ────────────────────────────────────────────────
// Socket.IO does NOT inherit the Express `cors()` configuration. It performs
// its own CORS check during the handshake, from its own options object. So the
// allowlist has to be stated somewhere both can read, or the two will drift and
// the failure mode is miserable to debug: REST keeps working while the socket
// handshake is rejected by the browser with an opaque CORS error.
//
// ── Why an array and not FRONTEND_URL alone ─────────────────────────────
// FRONTEND_URL holds exactly one value (in production,
// https://www.varlikent.com). That is enough for the deployed website, but a
// developer running `npm run dev` serves from http://localhost:5173 and would
// otherwise be unable to open a socket at all — against either a local backend
// or the deployed one.
//
// ── Is allowing localhost in production a risk? ─────────────────────────
// Very little, and worth being explicit about rather than quietly assuming.
// CORS decides which ORIGIN may read a response; it does not hand anyone a
// credential. This API authenticates with `Authorization: Bearer <JWT>`, which
// a browser never attaches automatically — unlike a cookie, it must be read
// from localStorage by same-origin JavaScript and set deliberately. A page on
// someone else's localhost cannot read this site's localStorage, so it has no
// token to send and every request it makes is unauthenticated.
//
// If you later want to remove the development origins from production anyway,
// the one-line change is documented at DEV_ORIGINS below.

/**
 * The Vite dev server, on both hostnames it can be reached by.
 *
 * 127.0.0.1 is included because a browser treats it as a DIFFERENT origin from
 * localhost — visiting the 127.0.0.1 form with only localhost allowlisted
 * fails, which reads as "sockets are broken" rather than "wrong hostname".
 *
 * To drop these in production, guard this constant with
 * `process.env.NODE_ENV !== 'production'`. Note that Render does not set
 * NODE_ENV for you, so set it explicitly there first or the guard silently
 * keeps them.
 */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/**
 * Extra origins, comma-separated. Optional.
 *
 * Exists so a Vercel preview deployment or a second domain can be allowed
 * without a code change:
 *
 *   EXTRA_CORS_ORIGINS=https://staging.varlikent.com,https://varlikent.com
 */
const extraOrigins = (process.env.EXTRA_CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/**
 * The allowlist, deduplicated.
 *
 * FRONTEND_URL comes first because it is the production website and the value
 * most likely to be checked by a human reading a log. There is deliberately no
 * '*' fallback: with `credentials: true` the wildcard is not even a legal
 * combination, and a permissive default is exactly the kind of thing that
 * survives to production unnoticed.
 */
export const ALLOWED_ORIGINS = [
  ...new Set([process.env.FRONTEND_URL, ...DEV_ORIGINS, ...extraOrigins].filter(Boolean)),
]

/**
 * Whether a given Origin header may connect.
 *
 * `undefined` is allowed on purpose, and this is not a loophole. React Native
 * sends no Origin header at all — it is not a browser page and is not subject
 * to the same-origin policy, so there is no origin to check and nothing CORS
 * could protect. Refusing origin-less requests would block the mobile app
 * while protecting nobody: any non-browser client (curl, a script, another
 * server) can send whatever Origin string it likes. CORS defends browser
 * users from other websites; it is not an access-control mechanism, and the
 * JWT remains the only thing that actually grants access.
 */
export const isAllowedOrigin = (origin) => !origin || ALLOWED_ORIGINS.includes(origin)
