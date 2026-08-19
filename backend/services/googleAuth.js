// Verifying a Google sign-in, and turning it into a Varlikent user.
//
// ── What the website sends, and why that shapes this file ───────────────
// The browser uses @react-oauth/google's useGoogleLogin(), which runs Google's
// implicit token flow and hands back an ACCESS token — not an ID token. It
// POSTs { accessToken } to /api/auth/google. An access token is an opaque
// bearer string, not a signed JWT, so there is nothing in it to verify
// locally; its meaning only exists on Google's side.
//
// That rules out verifyIdToken(), which is the usual answer and the wrong one
// here. The right one is OAuth2Client#getTokenInfo(), which POSTs the token to
// https://oauth2.googleapis.com/tokeninfo and returns Google's own description
// of it — crucially including `aud`, the OAuth client the token was issued to,
// plus `email` and `email_verified`. That single call gives us both halves of
// what we need: proof the token is live, and proof it is OURS. So the
// website's existing request contract stays exactly as it is.
//
// ── Why the profile fetch is still here, and why it is not trusted ──────
// tokeninfo does not return the display name or avatar, and the User schema
// wants both at creation time. So the userinfo endpoint is still called, with
// the same token, purely for those two cosmetic fields. It runs only AFTER the
// audience check has passed, and it is allowed to fail without failing the
// login: nothing security-relevant is read from it that tokeninfo did not
// already establish.

import { OAuth2Client } from 'google-auth-library'
import { getTrustedGoogleClientIds } from '../config/googleAuth.js'

const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

/**
 * A rejection the /google route can turn straight into an HTTP response.
 *
 * `publicMessage` is the only part the browser sees, and several distinct
 * codes deliberately share the same vague one. Telling a caller whether their
 * token was expired, or valid-but-issued-to-another-app, or valid for a Google
 * account with no email, hands them a free oracle for probing what this
 * endpoint accepts. `code` and `message` carry the real reason to the server
 * log, where the person debugging can see it and a caller cannot.
 */
export class GoogleAuthError extends Error {
  constructor(code, status, publicMessage, detail) {
    super(detail || code)
    this.name = 'GoogleAuthError'
    this.code = code
    this.status = status
    this.publicMessage = publicMessage
  }
}

/**
 * Google is inconsistent about the type of this claim: the tokeninfo endpoint
 * returns the string "true", while the OpenID userinfo endpoint returns a real
 * boolean. A plain truthiness test would be wrong in the opposite direction —
 * the string "false" is also truthy — so both accepted spellings are listed
 * explicitly and everything else counts as unverified.
 */
const isVerified = (value) => value === true || value === 'true'

/**
 * No client ID is passed here on purpose. getTokenInfo only needs the token
 * being asked about; the audience comparison happens below, against an
 * allowlist that is read per request. Passing process.env.GOOGLE_CLIENT_ID
 * would additionally be reading env at import time, which is exactly the
 * dotenv-ordering trap described in config/googleAuth.js.
 */
const tokenInfoClient = new OAuth2Client()

const defaultGetTokenInfo = (accessToken) => tokenInfoClient.getTokenInfo(accessToken)

const defaultFetchProfile = async (accessToken) => {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  return response.ok ? response.json() : null
}

/**
 * Establishes who the holder of a Google access token is, and that Google
 * issued that token to a client Varlikent owns.
 *
 * @param {string} accessToken The `access_token` from the website's
 *   useGoogleLogin() callback.
 * @param {object} [deps] Seams for tests, so the suite can exercise every
 *   verification branch without touching the network.
 * @returns {Promise<{email: string, name: string, picture: string, googleId: string|null, audience: string}>}
 * @throws {GoogleAuthError}
 */
export const verifyGoogleAccessToken = async (
  accessToken,
  {
    getTokenInfo = defaultGetTokenInfo,
    fetchProfile = defaultFetchProfile,
    trustedClientIds = getTrustedGoogleClientIds(),
  } = {}
) => {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new GoogleAuthError('missing_token', 400, 'Google access token is required')
  }

  // An empty allowlist would make every comparison below fail closed anyway,
  // but it fails closed for a reason that is the operator's fault rather than
  // the caller's. Saying so distinctly is the difference between "check the
  // GOOGLE_CLIENT_ID env var" and an afternoon spent suspecting Google.
  if (trustedClientIds.length === 0) {
    throw new GoogleAuthError(
      'not_configured',
      500,
      'Google login is not available',
      'no trusted Google client IDs configured — set GOOGLE_CLIENT_ID'
    )
  }

  let tokenInfo

  try {
    tokenInfo = await getTokenInfo(accessToken)
  } catch (error) {
    // tokeninfo answers 400 for a token that is malformed, revoked or expired.
    // Anything else — a timeout, a 5xx, DNS failure — is Google having a bad
    // day, and reporting that as "your token is bad" would send the user off
    // to fix a credential that is perfectly fine.
    const status = error?.status ?? error?.response?.status

    if (status === 400 || status === 401) {
      throw new GoogleAuthError(
        'invalid_token',
        401,
        'Google authentication failed',
        `Google rejected the access token (HTTP ${status})`
      )
    }

    throw new GoogleAuthError(
      'google_unavailable',
      503,
      'Google authentication is temporarily unavailable',
      `could not reach Google tokeninfo: ${error?.message || 'unknown error'}`
    )
  }

  // ── The check this whole file exists for ──────────────────────────────
  // `aud` is the OAuth client Google issued this token to. If it is not one of
  // ours, the token is a valid credential for somebody else's application and
  // must not authenticate anyone here, however real the Google account behind
  // it is.
  const audience = tokenInfo?.aud

  if (!audience || !trustedClientIds.includes(audience)) {
    throw new GoogleAuthError(
      'untrusted_client',
      401,
      'Google authentication failed',
      `access token was issued to Google OAuth client "${audience || 'unknown'}", which is not in the Varlikent allowlist`
    )
  }

  // Safe to call now: the token has been proven to belong to a Varlikent
  // client, so what comes back describes someone who really did sign in here.
  const profile = await Promise.resolve()
    .then(() => fetchProfile(accessToken))
    .catch(() => null)

  const email = tokenInfo.email || profile?.email

  if (!email) {
    throw new GoogleAuthError(
      'missing_email',
      401,
      'Google authentication failed',
      'Google returned no email address for this token'
    )
  }

  // Varlikent keys accounts on email, so an unverified Google email is a route
  // to claiming an address the signer-in does not control. Google does not
  // promise the address is theirs — it reports whether it checked — so the
  // check has to happen here, before the address is treated as an identity.
  if (!isVerified(tokenInfo.email_verified) && !isVerified(profile?.email_verified)) {
    throw new GoogleAuthError(
      'unverified_email',
      403,
      'Your Google email address is not verified',
      'Google did not report this email address as verified'
    )
  }

  // `sub` is Google's stable, never-reused identifier for the account, and it
  // is what Varlikent now stores as the durable link to that account. Without
  // it there is no provider identity to persist, and the only thing left to
  // match on would be the email address — which is precisely the weaker,
  // reassignable key that storing googleId exists to stop relying on. So a
  // credential that cannot name its subject fails closed rather than quietly
  // degrading to email-only matching.
  //
  // In practice this never fires for the website: useGoogleLogin() requests
  // `openid profile email`, and tokeninfo returns `sub` for any token holding
  // openid. userinfo is a second source for the same claim.
  const googleId = tokenInfo.sub || profile?.sub || null

  if (!googleId) {
    throw new GoogleAuthError(
      'missing_google_id',
      401,
      'Google authentication failed',
      'Google returned no subject identifier (sub) for this token'
    )
  }

  const normalisedEmail = String(email).toLowerCase()

  return {
    email: normalisedEmail,
    // Falls back to the local part rather than letting undefined reach a
    // schema field marked required, which would surface as a mongoose
    // validation error and a 500 instead of a working sign-in.
    name: profile?.name || normalisedEmail.split('@')[0],
    picture: profile?.picture || '',
    googleId: String(googleId),
    audience,
  }
}

// ── The mobile credential ────────────────────────────────────────────────
// Everything below verifies the OTHER kind of Google credential, the one a
// native mobile sign-in produces. It exists as a sibling of
// verifyGoogleAccessToken rather than a branch inside it because the two share
// no verification machinery at all: an access token is opaque and can only be
// described by asking Google over the network, whereas an ID token is a signed
// JWT the library checks locally against Google's published keys.
//
// What they DO share is their output. Both return the same identity object, so
// resolveGoogleUser() below cannot tell — and must never be able to tell —
// which kind of credential produced the person it is resolving.

/**
 * A second client for the ID-token path.
 *
 * A separate instance rather than reusing tokenInfoClient purely so the names
 * keep saying what each one is for; OAuth2Client holds no state across either
 * of these calls, so this costs nothing.
 */
const idTokenClient = new OAuth2Client()

/**
 * The audience is passed INTO verification, not compared afterwards.
 *
 * This matters more than it looks. google-auth-library checks `aud` as part of
 * validating the token — alongside the signature, the issuer and the expiry —
 * and refuses to return a ticket at all if it does not match. Verifying first
 * and comparing `payload.aud` afterwards would be a different and much weaker
 * thing, because by then the code has already decided the token was acceptable.
 *
 * `audience` accepts an array, so the whole allowlist goes in and any one of
 * the trusted clients satisfies it.
 */
const defaultVerifyIdToken = (idToken, audience) =>
  idTokenClient.verifyIdToken({ idToken, audience })

/**
 * Node/gaxios error codes meaning the request never completed, as opposed to
 * completing with an answer we did not like.
 */
const TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
])

/**
 * Separates "Google is unreachable" from "this token is bad".
 *
 * verifyIdToken has to fetch Google's signing certificates the first time it
 * runs (they are cached afterwards), so it has exactly the same two failure
 * modes as the tokeninfo call above, and the same reason to keep them apart: a
 * user whose sign-in failed because Google's CDN was down must not be told
 * their credential is invalid and sent off to fix an account that is fine.
 *
 * A token that fails validation throws a plain Error carrying no transport
 * information; a certificate fetch that failed carries either a socket error
 * code or a 5xx from gaxios.
 */
const isTransportFailure = (error) => {
  if (TRANSPORT_ERROR_CODES.has(error?.code)) return true

  const status = error?.status ?? error?.response?.status

  return typeof status === 'number' && status >= 500
}

/**
 * Establishes who the holder of a Google ID token is, and that Google issued
 * that token to a client Varlikent owns.
 *
 * ── Why there is no userinfo call here ──────────────────────────────────
 * The access-token path has to make a second request to Google for the display
 * name and avatar, because tokeninfo does not return them. An ID token does:
 * `name` and `picture` are claims inside the signed payload. So a profile fetch
 * would not merely be unnecessary here, it would be strictly worse — it would
 * replace claims Google has cryptographically signed with the response to a
 * second, separately-failable request.
 *
 * ── Every claim below comes from the VERIFIED payload ───────────────────
 * Nothing is read from the raw token, and nothing is read from the request
 * body. The mobile app cannot assert who it is; it can only present a
 * credential and let Google's signature speak for it.
 *
 * @param {string} idToken The `idToken` from a native Google sign-in.
 * @param {object} [deps] Seams for tests, so the suite can exercise every
 *   verification branch without touching the network.
 * @returns {Promise<{email: string, name: string, picture: string, googleId: string, audience: string}>}
 * @throws {GoogleAuthError}
 */
export const verifyGoogleIdToken = async (
  idToken,
  {
    verifyIdToken = defaultVerifyIdToken,
    trustedClientIds = getTrustedGoogleClientIds(),
  } = {}
) => {
  if (!idToken || typeof idToken !== 'string') {
    throw new GoogleAuthError('missing_token', 400, 'Google ID token is required')
  }

  // Checked before verification rather than after, because an empty allowlist
  // would otherwise be handed to verifyIdToken as `audience: []`. Same
  // operator-error distinction as the access-token path: this is a
  // misconfiguration, not a bad credential.
  if (trustedClientIds.length === 0) {
    throw new GoogleAuthError(
      'not_configured',
      500,
      'Google login is not available',
      'no trusted Google client IDs configured — set GOOGLE_CLIENT_ID'
    )
  }

  let ticket

  try {
    ticket = await verifyIdToken(idToken, trustedClientIds)
  } catch (error) {
    if (isTransportFailure(error)) {
      throw new GoogleAuthError(
        'google_unavailable',
        503,
        'Google authentication is temporarily unavailable',
        `could not reach Google to verify an ID token: ${error?.message || 'unknown error'}`
      )
    }

    // Deliberately one code for every validation failure. Bad signature,
    // expired, wrong issuer and wrong audience are all just "this credential
    // does not authenticate anyone", and telling a caller which one it was
    // hands them a free oracle for probing what this endpoint accepts.
    throw new GoogleAuthError(
      'invalid_id_token',
      401,
      'Google authentication failed',
      'Google rejected the ID token (signature, issuer, expiry or audience)'
    )
  }

  const payload = ticket?.getPayload?.()

  if (!payload) {
    throw new GoogleAuthError(
      'invalid_id_token',
      401,
      'Google authentication failed',
      'Google returned no payload for an ID token it accepted'
    )
  }

  // ── Defence in depth ──────────────────────────────────────────────────
  // verifyIdToken has already enforced this; the token could not have been
  // accepted carrying a foreign `aud`. Repeating it costs one array lookup and
  // means the audience rule still holds if the call above is ever refactored or
  // re-stubbed. The one thing this check must never become is the ONLY place
  // the audience is enforced.
  const audience = payload.aud

  if (!audience || !trustedClientIds.includes(audience)) {
    throw new GoogleAuthError(
      'untrusted_client',
      401,
      'Google authentication failed',
      'ID token audience is not in the Varlikent allowlist'
    )
  }

  const email = payload.email

  if (!email) {
    throw new GoogleAuthError(
      'missing_email',
      401,
      'Google authentication failed',
      'Google returned no email address in the ID token'
    )
  }

  // The same policy as the access-token path, through the same helper. An
  // unverified address is a route to claiming an account at an address the
  // signer-in does not control, and that is no less true on a phone.
  if (!isVerified(payload.email_verified)) {
    throw new GoogleAuthError(
      'unverified_email',
      403,
      'Your Google email address is not verified',
      'Google did not report this email address as verified'
    )
  }

  // Fails closed for the same reason as the access-token path: a falsy
  // googleId reaching resolveGoogleUser's query would match every unlinked
  // user in the collection.
  const googleId = payload.sub

  if (!googleId) {
    throw new GoogleAuthError(
      'missing_google_id',
      401,
      'Google authentication failed',
      'Google returned no subject identifier (sub) in the ID token'
    )
  }

  const normalisedEmail = String(email).toLowerCase()

  return {
    email: normalisedEmail,
    // Same fallback as the access-token path, so a Google account with no
    // display name produces the same Varlikent name whichever client signed in.
    name: payload.name || normalisedEmail.split('@')[0],
    picture: payload.picture || '',
    googleId: String(googleId),
    audience,
  }
}

/** Mongo's duplicate-key error, however the driver happens to surface it. */
const isDuplicateKey = (error) => error?.code === 11000 || error?.code === 11001

/**
 * Refuses a deactivated account.
 *
 * Called both before linking and after resolving. The early call matters:
 * without it a deactivated account would have a googleId written to it on the
 * way to being told it cannot sign in, which is a pointless write to an
 * account an administrator has deliberately switched off.
 */
const assertActive = (user, email) => {
  if (user?.isActive === false) {
    throw new GoogleAuthError(
      'account_inactive',
      403,
      'Your account is deactivated',
      `deactivated account attempted Google sign-in: ${email}`
    )
  }
}

/**
 * Matches an account that has no Google identity attached yet.
 *
 * `$in: [null, ...]` is doing real work: in MongoDB a null in `$in` also
 * matches documents where the field is ABSENT, which is the state all existing
 * Varlikent users are in. The empty string is listed because a stray '' would
 * otherwise read as "already linked" and lock the user out of linking forever.
 */
const UNLINKED = { $in: [null, ''] }

/**
 * Attaches a Google identity to an account that does not have one.
 *
 * Written as a conditional update rather than `user.googleId = x; user.save()`
 * for three separate reasons, each of which is a real bug avoided:
 *
 *  1. It is a compare-and-swap. The filter repeats "and it is still unlinked",
 *     so if a concurrent request linked this account between our read and our
 *     write, this update matches nothing instead of overwriting their work.
 *  2. save() runs full-document validation. A legacy account holding any value
 *     that no longer satisfies the current schema — a permission string since
 *     removed from the enum, say — would fail validation and be locked out of
 *     logging in, for a reason entirely unrelated to signing in.
 *  3. save() would fire the pre-save hook, which re-hashes `password` when it
 *     looks modified. Linking must never touch a user's password.
 */
const attachGoogleId = async ({ User, existing, googleId }) => {
  const linked = await User.findOneAndUpdate(
    { _id: existing._id, googleId: UNLINKED },
    { $set: { googleId } },
    { new: true }
  )

  if (linked) return linked

  // The compare-and-swap found nothing, so the account stopped being unlinked
  // underneath us. Re-read to see who won: if the winner attached the SAME
  // Google identity this request is presenting, the desired end state was
  // reached anyway and this is a success. Any other value is a genuine
  // conflict and must not be overwritten.
  const current = await User.findOne({ _id: existing._id })

  if (current && current.googleId === googleId) return current

  throw new GoogleAuthError(
    'google_identity_conflict',
    401,
    'Google authentication failed',
    'account was concurrently linked to a different Google identity'
  )
}

/**
 * Creates the Varlikent account for a Google identity seen for the first time.
 *
 * Two unique indexes can reject this: `email`, and now `googleId`. Either
 * rejection means a concurrent request for the same person got there first —
 * two browser tabs, or a double-clicked button. The correct response is to
 * adopt the account that request created, because the alternative is handing
 * the user a 500 for having been slightly too quick.
 */
const createGoogleUser = async ({ User, identity }) => {
  try {
    return await User.create({
      name: identity.name,
      email: identity.email,
      avatar: identity.picture,
      provider: 'google',
      role: 'user',
      googleId: identity.googleId,
      // `password` is deliberately absent, not null and not a placeholder.
      //
      // This account was created by proving control of a Google account, and
      // nobody has chosen a Varlikent password for it. Writing a random string
      // here — as this did until now — made the database claim otherwise: the
      // field held a real bcrypt hash of a value the user had never seen and
      // could never enter, so the record was indistinguishable from an account
      // with a genuine password. Omitting the field states the truth, and
      // `password: { type: String }` is optional so Mongoose stores no key.
      //
      // /login already refuses any account with no password before it reaches
      // bcrypt, so the absence is a closed door rather than an open one. The
      // deliberate way to open it later is Forgot Password → Reset Password,
      // which assigns a password the user actually chose.
    })
  } catch (error) {
    if (!isDuplicateKey(error)) throw error

    // Re-run the lookup the race invalidated, rather than assuming which of
    // the two unique indexes rejected us.
    const byGoogleId = await User.findOne({ googleId: identity.googleId })

    if (byGoogleId) return byGoogleId

    const byEmail = await User.findOne({ email: identity.email })

    if (!byEmail) throw error

    if (!byEmail.googleId) return attachGoogleId({ User, existing: byEmail, googleId: identity.googleId })

    if (byEmail.googleId === identity.googleId) return byEmail

    throw new GoogleAuthError(
      'google_identity_conflict',
      401,
      'Google authentication failed',
      'email address is already linked to a different Google identity'
    )
  }
}

/**
 * Finds, links, or creates the Varlikent user behind a verified Google identity.
 *
 * ── Why googleId is looked up before email ──────────────────────────────
 * An email address is not a stable identifier. People change the address on a
 * Google account, and a released address at a custom domain can later be
 * issued to a different person entirely. Google's `sub` never changes and is
 * never reused, so it is the correct key for "this is the same human as last
 * time". Email is kept only as the fallback that links accounts predating this
 * change — and it is safe in that role precisely because verifyGoogleAccessToken
 * has already refused to hand over an unverified address.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────
 * Linking writes exactly one field: googleId. It never touches provider, role,
 * permissions, password, name, avatar, favourites or theme. A Google sign-in
 * is a way to authenticate an existing account, not a reason to overwrite what
 * that account already says about itself — including when the Google profile
 * has since been renamed, or when the account was originally created through
 * a password or Microsoft sign-in.
 *
 * @param {object} args
 * @param {{email: string, name: string, picture: string, googleId: string}} args.identity
 * @param {import('mongoose').Model} args.User Injected so tests need no database.
 */
export const resolveGoogleUser = async ({ identity, User }) => {
  const { googleId } = identity

  // verifyGoogleAccessToken already guarantees this. Repeated because
  // resolveGoogleUser is separately exported and separately callable, and a
  // falsy googleId reaching the query below would match every unlinked user
  // in the collection — the worst possible failure for this function to have.
  if (!googleId) {
    throw new GoogleAuthError(
      'missing_google_id',
      401,
      'Google authentication failed',
      'refusing to resolve a Google identity with no subject identifier'
    )
  }

  // ── The returning user: matched on identity, not on address ───────────
  // Deliberately not qualified by email. If the Google account's address has
  // changed since last sign-in, this still finds them, and their Varlikent
  // email is left as it is — changing it would silently move which address
  // owns the account, and which address password reset and notifications go
  // to. That is an account-management decision, not a side effect of logging in.
  let user = await User.findOne({ googleId })

  if (!user) {
    const byEmail = await User.findOne({ email: identity.email })

    if (byEmail) {
      // A different Google account claiming an email that is already linked
      // elsewhere. Overwriting would hand this sign-in an account built by
      // someone else, so it fails closed and the existing link stands.
      if (byEmail.googleId && byEmail.googleId !== googleId) {
        throw new GoogleAuthError(
          'google_identity_conflict',
          401,
          'Google authentication failed',
          'email address is already linked to a different Google identity'
        )
      }

      // Before writing, not after: a deactivated account should be turned away
      // without being modified on the way out.
      assertActive(byEmail, identity.email)

      user = byEmail.googleId === googleId
        ? byEmail
        : await attachGoogleId({ User, existing: byEmail, googleId })
    } else {
      user = await createGoogleUser({ User, identity })
    }
  }

  assertActive(user, identity.email)

  return user
}
