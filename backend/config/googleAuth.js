// Which Google OAuth clients Varlikent will accept a credential from.
//
// ── Why this file exists ────────────────────────────────────────────────
// Asking Google "is this access token real?" is NOT the same question as
// asking "was this access token issued to US?". Any website can run its own
// Google OAuth client, collect a genuine Google access token from one of its
// own visitors, and POST it to /api/auth/google. That token is perfectly valid
// and belongs to a real Google account — it just was never meant for Varlikent.
// Without an audience check, accepting it would sign that person in here, which
// turns any third-party Google app into a login bypass for this site.
//
// So the backend has to hold a list of the OAuth clients it actually owns, and
// reject a credential whose `aud` is not on it. That list lives here.
//
// ── Why the values are read lazily, inside a function ───────────────────
// server.js calls dotenv.config() AFTER its import block. ESM evaluates every
// imported module before the importing module's first statement runs, so any
// `const x = process.env.FOO` written at the top level of a route or config
// module reads `undefined` during local development — the .env file has not
// been parsed yet. (In production this is masked, because Render injects real
// environment variables into the process before Node starts.)
//
// A config that silently resolves to an empty allowlist on a developer's
// machine — and only there — would fail in the most confusing way possible:
// Google login broken locally, fine in production. Reading process.env per
// call instead of per import removes that whole class of bug, and the cost is
// nothing: it is a string split on a request that already makes two network
// round trips to Google.

/**
 * Every Google OAuth client ID that Varlikent trusts, deduplicated.
 *
 * GOOGLE_CLIENT_ID is the website's client — the one the browser bundle
 * already ships as VITE_GOOGLE_CLIENT_ID, and the only real client that
 * exists today.
 *
 * GOOGLE_CLIENT_IDS is an optional comma-separated list for the clients that
 * do not exist yet. Google issues a SEPARATE client ID per platform, so the
 * Android and iOS apps will each bring their own, and a mobile sign-in
 * presents a token whose `aud` is that platform's ID rather than the
 * website's. Having the list already accept multiple values means shipping
 * mobile Google auth is a deployment-config change, not a code change.
 *
 * It is deliberately empty until those clients are actually created in Google
 * Cloud. A placeholder value here would be worse than nothing: it would sit in
 * the allowlist looking like a trusted client while matching no real token.
 *
 * Client IDs are public identifiers — the website serves its own to every
 * visitor — but they still belong in configuration rather than source, so that
 * the allowlist can differ between staging and production without a code edit.
 *
 * @param {NodeJS.ProcessEnv} [env] Overridable so tests can supply an
 *   allowlist without mutating the real process environment.
 * @returns {string[]}
 */
export const getTrustedGoogleClientIds = (env = process.env) =>
  [
    ...new Set(
      [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_IDS]
        .flatMap((value) => (value || '').split(','))
        .map((clientId) => clientId.trim())
        .filter(Boolean)
    ),
  ]
