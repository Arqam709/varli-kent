// Unit coverage for the Google verification decisions.
//
// Every branch here is driven through the dependency seams on
// verifyGoogleAccessToken, so the suite makes no network request and needs no
// database, no .env and no Google account. What is being tested is the
// decision logic itself — which tokens are accepted and which are refused.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GoogleAuthError,
  resolveGoogleUser,
  verifyGoogleAccessToken,
  verifyGoogleIdToken,
} from '../services/googleAuth.js'
import { getTrustedGoogleClientIds } from '../config/googleAuth.js'

// Stand-ins for real Google OAuth client IDs. The shape matters only in that
// these are opaque strings compared for equality; no real client ID belongs in
// a test file any more than it belongs in source.
const TRUSTED_WEB_CLIENT = 'trusted-web-client.apps.googleusercontent.com'
const TRUSTED_FUTURE_MOBILE_CLIENT = 'trusted-mobile-client.apps.googleusercontent.com'
const ATTACKER_CLIENT = 'someone-elses-app.apps.googleusercontent.com'

/** A tokeninfo response for a good token from the website's own client. */
const validTokenInfo = (overrides = {}) => ({
  aud: TRUSTED_WEB_CLIENT,
  sub: '1098765432100',
  email: 'buyer@example.com',
  // The string spelling is not a typo: this is what oauth2.googleapis.com
  // actually returns, even though the library's TypeScript type says boolean.
  email_verified: 'true',
  scopes: ['openid', 'email', 'profile'],
  expiry_date: Date.now() + 3600_000,
  ...overrides,
})

const validProfile = (overrides = {}) => ({
  sub: '1098765432100',
  name: 'Test Buyer',
  email: 'buyer@example.com',
  email_verified: true,
  picture: 'https://lh3.googleusercontent.com/a/example',
  ...overrides,
})

/** Builds the injected dependency set, defaulting to the happy path. */
const deps = ({ tokenInfo = validTokenInfo(), profile = validProfile(), ...rest } = {}) => ({
  getTokenInfo: async () => tokenInfo,
  fetchProfile: async () => profile,
  trustedClientIds: [TRUSTED_WEB_CLIENT],
  ...rest,
})

/** Asserts the call was refused, and refused for the expected reason. */
const expectRejection = async (promise, { code, status }) => {
  const error = await promise.then(
    () => null,
    (caught) => caught
  )

  assert.ok(error, 'expected the call to be rejected, but it resolved')
  assert.ok(error instanceof GoogleAuthError, `expected GoogleAuthError, got ${error.name}`)
  assert.equal(error.code, code)
  assert.equal(error.status, status)

  return error
}

// ── A. Missing token ─────────────────────────────────────────────────────
test('A. rejects a request with no access token', async () => {
  await expectRejection(verifyGoogleAccessToken(undefined, deps()), {
    code: 'missing_token',
    status: 400,
  })

  await expectRejection(verifyGoogleAccessToken('', deps()), {
    code: 'missing_token',
    status: 400,
  })
})

test('A. rejects a non-string access token rather than passing it to Google', async () => {
  await expectRejection(verifyGoogleAccessToken({ evil: true }, deps()), {
    code: 'missing_token',
    status: 400,
  })
})

// ── B. Invalid token ─────────────────────────────────────────────────────
test('B. rejects a token Google refuses to describe', async () => {
  const httpError = Object.assign(new Error('Request failed with status code 400'), {
    status: 400,
  })

  await expectRejection(
    verifyGoogleAccessToken('expired-or-forged', deps({
      getTokenInfo: async () => {
        throw httpError
      },
    })),
    { code: 'invalid_token', status: 401 }
  )
})

test('B. reads the status off error.response too, since gaxios reports it both ways', async () => {
  await expectRejection(
    verifyGoogleAccessToken('revoked', deps({
      getTokenInfo: async () => {
        throw Object.assign(new Error('bad request'), { response: { status: 400 } })
      },
    })),
    { code: 'invalid_token', status: 401 }
  )
})

test('B. distinguishes Google being unreachable from the token being bad', async () => {
  // A network failure must not be reported to the user as a bad credential —
  // that sends them off to re-authenticate against a problem they cannot fix.
  const error = await expectRejection(
    verifyGoogleAccessToken('perfectly-fine-token', deps({
      getTokenInfo: async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
      },
    })),
    { code: 'google_unavailable', status: 503 }
  )

  assert.notEqual(error.status, 401)
})

// ── C. Valid token from the trusted Varlikent client ─────────────────────
test('C. accepts a valid token issued to the trusted Varlikent client', async () => {
  const identity = await verifyGoogleAccessToken('good-token', deps())

  assert.equal(identity.email, 'buyer@example.com')
  assert.equal(identity.audience, TRUSTED_WEB_CLIENT)
  assert.equal(identity.name, 'Test Buyer')
  assert.equal(identity.picture, 'https://lh3.googleusercontent.com/a/example')
})

test('C. passes the caller-supplied token straight through to Google unmodified', async () => {
  let seen = null

  await verifyGoogleAccessToken('the-exact-token', deps({
    getTokenInfo: async (token) => {
      seen = token
      return validTokenInfo()
    },
  }))

  assert.equal(seen, 'the-exact-token')
})

test('C. lowercases the email so lookup matches the schema', async () => {
  const identity = await verifyGoogleAccessToken('good-token', deps({
    tokenInfo: validTokenInfo({ email: 'Mixed.Case@Example.COM' }),
    profile: validProfile({ email: 'Mixed.Case@Example.COM' }),
  }))

  assert.equal(identity.email, 'mixed.case@example.com')
})

test('C. accepts a boolean email_verified as well as the string form', async () => {
  const identity = await verifyGoogleAccessToken('good-token', deps({
    tokenInfo: validTokenInfo({ email_verified: true }),
  }))

  assert.equal(identity.email, 'buyer@example.com')
})

test('C. still signs in when the cosmetic profile fetch fails', async () => {
  // The profile call supplies only name and avatar. Identity has already been
  // established by tokeninfo, so losing it must not cost the user their login.
  const identity = await verifyGoogleAccessToken('good-token', deps({
    fetchProfile: async () => {
      throw new Error('userinfo timed out')
    },
  }))

  assert.equal(identity.email, 'buyer@example.com')
  assert.equal(identity.name, 'buyer', 'falls back to the local part of the email')
  assert.equal(identity.picture, '')
})

test('C. accepts a second allowlisted client, as a future mobile client would be', async () => {
  const identity = await verifyGoogleAccessToken('good-token', deps({
    tokenInfo: validTokenInfo({ aud: TRUSTED_FUTURE_MOBILE_CLIENT }),
    trustedClientIds: [TRUSTED_WEB_CLIENT, TRUSTED_FUTURE_MOBILE_CLIENT],
  }))

  assert.equal(identity.audience, TRUSTED_FUTURE_MOBILE_CLIENT)
})

// ── D. Valid token from an UNTRUSTED client — the vulnerability ──────────
test('D. rejects a genuine Google token issued to a different application', async () => {
  // This is the whole point of the change. The token is real, live, and backed
  // by a real Google account with a verified email. It was simply issued to
  // somebody else's OAuth client, so it must not authenticate anyone here.
  const error = await expectRejection(
    verifyGoogleAccessToken('a-real-but-foreign-token', deps({
      tokenInfo: validTokenInfo({ aud: ATTACKER_CLIENT }),
    })),
    { code: 'untrusted_client', status: 401 }
  )

  assert.equal(
    error.publicMessage,
    'Google authentication failed',
    'must not tell the caller that the audience was the problem'
  )
})

test('D. rejects a token whose tokeninfo response carries no audience at all', async () => {
  await expectRejection(
    verifyGoogleAccessToken('no-aud', deps({
      tokenInfo: validTokenInfo({ aud: undefined }),
    })),
    { code: 'untrusted_client', status: 401 }
  )
})

test('D. does not fetch the user profile when the audience check fails', async () => {
  // Failing closed means failing early: an untrusted token should never be
  // spent on a second call to Google on Varlikent's behalf.
  let profileFetched = false

  await expectRejection(
    verifyGoogleAccessToken('foreign-token', deps({
      tokenInfo: validTokenInfo({ aud: ATTACKER_CLIENT }),
      fetchProfile: async () => {
        profileFetched = true
        return validProfile()
      },
    })),
    { code: 'untrusted_client', status: 401 }
  )

  assert.equal(profileFetched, false)
})

test('D. an empty allowlist refuses everything instead of accepting everything', async () => {
  await expectRejection(
    verifyGoogleAccessToken('good-token', deps({ trustedClientIds: [] })),
    { code: 'not_configured', status: 500 }
  )
})

// ── E. Verified token, but no email ──────────────────────────────────────
test('E. rejects a verified token that carries no email address', async () => {
  await expectRejection(
    verifyGoogleAccessToken('no-email-scope', deps({
      tokenInfo: validTokenInfo({ email: undefined, email_verified: undefined }),
      profile: { sub: '1098765432100', name: 'No Email' },
    })),
    { code: 'missing_email', status: 401 }
  )
})

// ── F. Unverified email ──────────────────────────────────────────────────
test('F. rejects an email Google reports as unverified', async () => {
  await expectRejection(
    verifyGoogleAccessToken('unverified', deps({
      tokenInfo: validTokenInfo({ email_verified: 'false' }),
      profile: validProfile({ email_verified: false }),
    })),
    { code: 'unverified_email', status: 403 }
  )
})

test('F. treats a missing verification claim as unverified, not as verified', async () => {
  await expectRejection(
    verifyGoogleAccessToken('no-claim', deps({
      tokenInfo: validTokenInfo({ email_verified: undefined }),
      profile: validProfile({ email_verified: undefined }),
    })),
    { code: 'unverified_email', status: 403 }
  )
})

test('F. does not let the truthy string "false" pass as verified', async () => {
  await expectRejection(
    verifyGoogleAccessToken('sneaky', deps({
      tokenInfo: validTokenInfo({ email_verified: 'false' }),
      profile: validProfile({ email_verified: 'false' }),
    })),
    { code: 'unverified_email', status: 403 }
  )
})

// ══ ID-token verification — the mobile credential ════════════════════════
// The same decisions as above, made about the other kind of Google credential.
// These run entirely through the injected verifier, so no network call and no
// real signed token is involved; what is under test is which verified payloads
// are turned into an identity and which are refused.

/** A payload as Google's verifier returns it, for a good mobile sign-in. */
const validIdPayload = (overrides = {}) => ({
  iss: 'https://accounts.google.com',
  aud: TRUSTED_WEB_CLIENT,
  sub: 'G123',
  email: 'User@Example.com',
  // The ID-token spelling is a real boolean, unlike tokeninfo's string.
  email_verified: true,
  name: 'Google Person',
  picture: 'https://lh3.googleusercontent.com/a/mobile',
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...overrides,
})

/**
 * Stands in for the LoginTicket google-auth-library returns. Only getPayload()
 * matters to the service, and the service reads nothing else off it.
 */
const ticketFor = (payload) => ({ getPayload: () => payload })

/** Builds the injected dependency set for the ID-token path. */
const idDeps = ({ payload = validIdPayload(), ...rest } = {}) => ({
  verifyIdToken: async () => ticketFor(payload),
  trustedClientIds: [TRUSTED_WEB_CLIENT],
  ...rest,
})

// ── A. A valid ID token ──────────────────────────────────────────────────
test('ID-A. turns a verified ID-token payload into the identity resolveGoogleUser expects', async () => {
  const identity = await verifyGoogleIdToken('a.signed.jwt', idDeps())

  assert.equal(identity.googleId, 'G123', 'sub is the stable identifier, not email')
  assert.equal(identity.email, 'user@example.com', 'normalised the same way as the access-token path')
  assert.equal(identity.name, 'Google Person')
  assert.equal(identity.picture, 'https://lh3.googleusercontent.com/a/mobile')
  assert.equal(identity.audience, TRUSTED_WEB_CLIENT)
})

test('ID-A. returns exactly the same identity shape as the access-token path', async () => {
  // The invariant the whole phase rests on: resolveGoogleUser must not be able
  // to tell which client signed in. If these key sets ever diverge, one of the
  // two flows is feeding it something it was not written to handle.
  const fromIdToken = await verifyGoogleIdToken('a.signed.jwt', idDeps())
  const fromAccessToken = await verifyGoogleAccessToken('good-token', deps())

  assert.deepEqual(Object.keys(fromIdToken).sort(), Object.keys(fromAccessToken).sort())
})

test('ID-A. never calls the userinfo endpoint, since the payload is already signed', async () => {
  // A second request to Google would replace cryptographically signed claims
  // with the answer to a separately-failable call.
  let profileFetched = false

  await verifyGoogleIdToken('a.signed.jwt', idDeps({
    fetchProfile: async () => {
      profileFetched = true
      return validProfile()
    },
  }))

  assert.equal(profileFetched, false)
})

// ── B. The allowlist reaches the verifier ────────────────────────────────
test('ID-B. passes the trusted client allowlist INTO Google verification', async () => {
  // The load-bearing test for audience enforcement. verifyIdToken checks `aud`
  // as part of validating the token, so the allowlist has to arrive as an
  // argument — checking payload.aud afterwards would be a strictly weaker
  // thing. Deleting the audience from the call must fail here.
  let seenToken = null
  let seenAudience = null

  await verifyGoogleIdToken('the-exact-token', idDeps({
    verifyIdToken: async (idToken, audience) => {
      seenToken = idToken
      seenAudience = audience
      return ticketFor(validIdPayload())
    },
  }))

  assert.equal(seenToken, 'the-exact-token', 'the token is passed through unmodified')
  assert.deepEqual(seenAudience, [TRUSTED_WEB_CLIENT], 'the allowlist must reach the verifier')
})

test('ID-B. passes the whole allowlist, so a second trusted client also works', async () => {
  let seenAudience = null

  const identity = await verifyGoogleIdToken('token', idDeps({
    payload: validIdPayload({ aud: TRUSTED_FUTURE_MOBILE_CLIENT }),
    trustedClientIds: [TRUSTED_WEB_CLIENT, TRUSTED_FUTURE_MOBILE_CLIENT],
    verifyIdToken: async (idToken, audience) => {
      seenAudience = audience
      return ticketFor(validIdPayload({ aud: TRUSTED_FUTURE_MOBILE_CLIENT }))
    },
  }))

  assert.deepEqual(seenAudience, [TRUSTED_WEB_CLIENT, TRUSTED_FUTURE_MOBILE_CLIENT])
  assert.equal(identity.audience, TRUSTED_FUTURE_MOBILE_CLIENT)
})

test('ID-B. refuses to verify at all when the allowlist is empty', async () => {
  // Never call Google with `audience: []`. This is the operator's mistake, and
  // it is reported as one rather than as a bad credential.
  let verifierCalled = false

  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      trustedClientIds: [],
      verifyIdToken: async () => {
        verifierCalled = true
        return ticketFor(validIdPayload())
      },
    })),
    { code: 'not_configured', status: 500 }
  )

  assert.equal(verifierCalled, false, 'an unconfigured server must not ask Google anything')
})

// ── C. Untrusted audience ────────────────────────────────────────────────
test('ID-C. maps Google rejecting a foreign audience to a controlled failure', async () => {
  // How the real library behaves: a token whose `aud` is not in the allowlist
  // never yields a ticket, it throws during verification.
  const error = await expectRejection(
    verifyGoogleIdToken('foreign.id.token', idDeps({
      verifyIdToken: async () => {
        throw new Error(`Wrong recipient, payload audience != requiredAudience`)
      },
    })),
    { code: 'invalid_id_token', status: 401 }
  )

  assert.equal(error.publicMessage, 'Google authentication failed')
})

test('ID-C. also refuses a payload whose aud is foreign, if verification let it through', async () => {
  // Defence in depth. A stubbed or refactored verifier that forgot the
  // audience must still not produce an identity.
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      payload: validIdPayload({ aud: ATTACKER_CLIENT }),
    })),
    { code: 'untrusted_client', status: 401 }
  )
})

test('ID-C. refuses a payload carrying no audience at all', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({ payload: validIdPayload({ aud: undefined }) })),
    { code: 'untrusted_client', status: 401 }
  )
})

test('ID-C. does not disclose the audience or the token in the public message', async () => {
  const error = await expectRejection(
    verifyGoogleIdToken('super-secret.id.token', idDeps({
      payload: validIdPayload({ aud: ATTACKER_CLIENT }),
    })),
    { code: 'untrusted_client', status: 401 }
  )

  assert.equal(error.publicMessage.includes(ATTACKER_CLIENT), false)
  assert.equal(error.publicMessage.includes('super-secret'), false)
  assert.equal(error.publicMessage.toLowerCase().includes('audience'), false)
})

// ── D. Invalid signature / malformed token ───────────────────────────────
test('ID-D. maps a signature failure to a controlled 401 without leaking the reason', async () => {
  const error = await expectRejection(
    verifyGoogleIdToken('tampered.id.token', idDeps({
      verifyIdToken: async () => {
        throw new Error('Invalid token signature: abc.def.ghi')
      },
    })),
    { code: 'invalid_id_token', status: 401 }
  )

  assert.equal(error.publicMessage, 'Google authentication failed')
  assert.equal(error.publicMessage.includes('signature'), false)
  assert.equal(error.publicMessage.includes('abc.def.ghi'), false)
})

test('ID-D. rejects a missing or non-string token before asking Google', async () => {
  for (const bad of [undefined, '', null, { evil: true }, 12345]) {
    await expectRejection(verifyGoogleIdToken(bad, idDeps()), {
      code: 'missing_token',
      status: 400,
    })
  }
})

test('ID-D. rejects a verifier that returns no payload', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({ verifyIdToken: async () => ticketFor(undefined) })),
    { code: 'invalid_id_token', status: 401 }
  )
})

// ── E. Expired token ─────────────────────────────────────────────────────
test('ID-E. maps an expiry rejection from Google to the same controlled failure', async () => {
  // Expiry is the library's job — it is checked during verification, so this
  // asserts the mapping rather than reimplementing a clock comparison.
  await expectRejection(
    verifyGoogleIdToken('stale.id.token', idDeps({
      verifyIdToken: async () => {
        throw new Error('Token used too late, 1700000000 > 1699999999')
      },
    })),
    { code: 'invalid_id_token', status: 401 }
  )
})

test('ID-E. distinguishes Google being unreachable from the token being bad', async () => {
  // verifyIdToken fetches Google's signing certificates on first use, so it has
  // the same two failure modes as tokeninfo — and the same reason not to blame
  // the user's credential for Google's outage.
  const error = await expectRejection(
    verifyGoogleIdToken('perfectly-fine.id.token', idDeps({
      verifyIdToken: async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
      },
    })),
    { code: 'google_unavailable', status: 503 }
  )

  assert.notEqual(error.status, 401)
})

test('ID-E. treats a 5xx from the certificate fetch as Google being unavailable', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      verifyIdToken: async () => {
        throw Object.assign(new Error('backend error'), { response: { status: 503 } })
      },
    })),
    { code: 'google_unavailable', status: 503 }
  )
})

// ── F. Missing email ─────────────────────────────────────────────────────
test('ID-F. rejects a verified payload with no email claim', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      payload: validIdPayload({ email: undefined, email_verified: undefined }),
    })),
    { code: 'missing_email', status: 401 }
  )
})

// ── G. Unverified email ──────────────────────────────────────────────────
test('ID-G. applies the same email_verified policy as the access-token path', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      payload: validIdPayload({ email_verified: false }),
    })),
    { code: 'unverified_email', status: 403 }
  )
})

test('ID-G. treats a missing verification claim as unverified, not as verified', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      payload: validIdPayload({ email_verified: undefined }),
    })),
    { code: 'unverified_email', status: 403 }
  )
})

test('ID-G. does not let the truthy string "false" pass as verified', async () => {
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({
      payload: validIdPayload({ email_verified: 'false' }),
    })),
    { code: 'unverified_email', status: 403 }
  )
})

test('ID-G. accepts the string "true", since isVerified is shared with tokeninfo', async () => {
  const identity = await verifyGoogleIdToken('token', idDeps({
    payload: validIdPayload({ email_verified: 'true' }),
  }))

  assert.equal(identity.email, 'user@example.com')
})

// ── H. Missing sub ───────────────────────────────────────────────────────
test('ID-H. rejects a verified payload with no sub, before any account lookup', async () => {
  // Step 2's fail-closed rule. A falsy googleId reaching resolveGoogleUser's
  // query would match every unlinked user in the collection.
  await expectRejection(
    verifyGoogleIdToken('token', idDeps({ payload: validIdPayload({ sub: undefined }) })),
    { code: 'missing_google_id', status: 401 }
  )

  await expectRejection(
    verifyGoogleIdToken('token', idDeps({ payload: validIdPayload({ sub: '' }) })),
    { code: 'missing_google_id', status: 401 }
  )
})

test('ID-H. never derives the Google identifier from the email address', async () => {
  const identity = await verifyGoogleIdToken('token', idDeps({
    payload: validIdPayload({ sub: 'G-stable-subject', email: 'someone@example.com' }),
  }))

  assert.equal(identity.googleId, 'G-stable-subject')
  assert.notEqual(identity.googleId, identity.email)
})

// ── I. Profile optionality ───────────────────────────────────────────────
test('ID-I. falls back to the local part of the email when the payload has no name', async () => {
  const identity = await verifyGoogleIdToken('token', idDeps({
    payload: validIdPayload({ name: undefined, picture: undefined }),
  }))

  assert.equal(identity.name, 'user', 'same convention as the access-token path')
  assert.equal(identity.picture, '')
  assert.equal(identity.googleId, 'G123', 'and a bare payload is still a valid identity')
})

// ══ Account linking ══════════════════════════════════════════════════════
// The verification tests above decide whether a Google credential is genuine.
// Everything below decides which Varlikent account it maps to — which is where
// the damage lives if it is wrong: the wrong answer here hands one person
// somebody else's account.

const GOOGLE_SUB = 'G123'
const OTHER_GOOGLE_SUB = 'G999'

const identityFor = ({ email = 'buyer@example.com', googleId = GOOGLE_SUB } = {}) => ({
  email,
  googleId,
  name: 'Google Profile Name',
  picture: 'https://lh3.googleusercontent.com/a/from-google',
})

const duplicateKeyError = (field) =>
  Object.assign(new Error(`E11000 duplicate key error collection: users index: ${field}_1`), {
    code: 11000,
  })

/**
 * An in-memory stand-in for the mongoose model.
 *
 * It is more than a stub on purpose. It enforces the two unique indexes the
 * real collection has — email, and the googleId partial index added in
 * models/User.js — and it reproduces the one piece of MongoDB query semantics
 * this code genuinely leans on: a null inside `$in` also matches documents
 * where the field is absent. Without that fidelity the compare-and-swap and
 * duplicate-key tests below would pass while proving nothing.
 */
const fakeUserModel = (seed = []) => {
  const docs = seed.map((doc) => ({ isActive: true, ...doc }))
  const calls = { findOne: [], findOneAndUpdate: [], create: [] }
  let sequence = 0
  let beforeNextCreate = null

  const matches = (doc, query) =>
    Object.entries(query).every(([field, condition]) => {
      const value = doc[field]

      if (condition && typeof condition === 'object' && Array.isArray(condition.$in)) {
        return condition.$in.some((candidate) =>
          candidate === null ? value === null || value === undefined : value === candidate
        )
      }

      return value === condition
    })

  return {
    calls,
    docs,
    /** Simulates another request winning a race, mid-create. */
    onNextCreate(hook) {
      beforeNextCreate = hook
    },
    async findOne(query) {
      calls.findOne.push(query)
      return docs.find((doc) => matches(doc, query)) || null
    },
    async findOneAndUpdate(query, update, options) {
      calls.findOneAndUpdate.push({ query, update })

      const doc = docs.find((candidate) => matches(candidate, query))
      if (!doc) return null

      Object.assign(doc, update.$set)
      return options?.new ? doc : { ...doc }
    },
    async create(doc) {
      calls.create.push(doc)

      if (beforeNextCreate) {
        const hook = beforeNextCreate
        beforeNextCreate = null
        await hook()
      }

      if (docs.some((existing) => existing.email === doc.email)) {
        throw duplicateKeyError('email')
      }

      if (doc.googleId != null && docs.some((existing) => existing.googleId === doc.googleId)) {
        throw duplicateKeyError('googleId')
      }

      const created = { _id: `created-${++sequence}`, isActive: true, ...doc }
      docs.push(created)
      return created
    },
  }
}

// ── A. First-time Google user ────────────────────────────────────────────
test('A. a brand new Google user is created WITH the googleId persisted', async () => {
  // This is the assertion that replaces the step-1 tripwire, which asserted
  // the exact opposite. Persisting googleId is now the correct behaviour.
  const User = fakeUserModel()

  const user = await resolveGoogleUser({ identity: identityFor({ email: 'new@example.com' }), User })

  assert.equal(User.calls.create.length, 1)

  const [created] = User.calls.create
  assert.equal(created.googleId, GOOGLE_SUB, 'the stable Google subject must be stored')
  assert.equal(created.email, 'new@example.com')
  assert.equal(created.provider, 'google')
  assert.equal(created.role, 'user')
  assert.equal(created.name, 'Google Profile Name')
  assert.equal(user.googleId, GOOGLE_SUB)
})

// ── Step 3: no invented password ─────────────────────────────────────────
test('A. a new Google account is created with NO password field at all', async () => {
  const User = fakeUserModel()

  await resolveGoogleUser({ identity: identityFor({ email: 'new@example.com' }), User })

  const [created] = User.calls.create

  // Not "a falsy password" — the key must not be handed to User.create() at
  // all, so Mongoose stores no field rather than an explicit null.
  assert.equal(
    'password' in created,
    false,
    'a Google account has no password until the user deliberately sets one'
  )
})

test('A. the created document exposes exactly the intended fields', async () => {
  // A tripwire on the whole creation shape: if anyone reintroduces a
  // placeholder password, or starts writing extra state during sign-in, this
  // is the test that says so.
  const User = fakeUserModel()

  await resolveGoogleUser({ identity: identityFor({ email: 'new@example.com' }), User })

  assert.deepEqual(Object.keys(User.calls.create[0]).sort(), [
    'avatar',
    'email',
    'googleId',
    'name',
    'provider',
    'role',
  ])
})

// ── B. Returning linked user ─────────────────────────────────────────────
test('B. a returning linked user is found by googleId, with nothing created', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', googleId: GOOGLE_SUB, provider: 'google', role: 'user' },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'u1')
  assert.equal(User.calls.create.length, 0)
  assert.equal(User.calls.findOneAndUpdate.length, 0, 'an already-linked account needs no write')
  assert.deepEqual(User.calls.findOne[0], { googleId: GOOGLE_SUB }, 'googleId is looked up first')
})

test('B. the googleId lookup is not qualified by email', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', googleId: GOOGLE_SUB },
  ])

  await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal('email' in User.calls.findOne[0], false)
})

// ── C. Legacy Google user with no googleId — lazy linking ────────────────
test('C. a pre-step-2 Google account is linked on next sign-in', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', provider: 'google', role: 'user' },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'u1', 'the same account, not a new one')
  assert.equal(user.googleId, GOOGLE_SUB, 'now linked')
  assert.equal(User.calls.create.length, 0)
  assert.equal(User.docs.length, 1)
})

test('C. linking is a compare-and-swap that only matches an unlinked account', async () => {
  // The filter must carry the "still unlinked" condition, or a concurrent link
  // could be silently overwritten.
  const User = fakeUserModel([{ _id: 'u1', email: 'buyer@example.com' }])

  await resolveGoogleUser({ identity: identityFor(), User })

  const [{ query, update }] = User.calls.findOneAndUpdate
  assert.deepEqual(query, { _id: 'u1', googleId: { $in: [null, ''] } })
  assert.deepEqual(update, { $set: { googleId: GOOGLE_SUB } })
})

test('C. linking writes googleId and nothing else', async () => {
  const User = fakeUserModel([{ _id: 'u1', email: 'buyer@example.com' }])

  await resolveGoogleUser({ identity: identityFor(), User })

  const [{ update }] = User.calls.findOneAndUpdate
  assert.deepEqual(Object.keys(update.$set), ['googleId'])
})

// ── D. Password account links Google ─────────────────────────────────────
test('D. a local password account keeps its provider, password and role when linked', async () => {
  const User = fakeUserModel([
    {
      _id: 'u1',
      email: 'buyer@example.com',
      provider: 'local',
      password: 'already-bcrypt-hashed',
      role: 'admin',
      permissions: ['user_management'],
      favourites: ['prop1'],
      themePreference: 'dark',
    },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'u1')
  assert.equal(user.googleId, GOOGLE_SUB, 'Google is now an additional way in')
  assert.equal(user.provider, 'local', 'provider records how the account began')
  assert.equal(user.password, 'already-bcrypt-hashed', 'password sign-in must still work')
  assert.equal(user.role, 'admin', 'a Google sign-in must never demote an admin')
  assert.deepEqual(user.permissions, ['user_management'])
  assert.deepEqual(user.favourites, ['prop1'])
  assert.equal(user.themePreference, 'dark')

  // Step 3: linking writes googleId only. The password is neither removed nor
  // re-hashed — a second hashing pass would silently invalidate it.
  assert.deepEqual(User.calls.findOneAndUpdate[0].update, { $set: { googleId: GOOGLE_SUB } })
})

// ── Step 3: the legacy-data policy ───────────────────────────────────────
test('C. an existing Google account keeps a password it already has', async () => {
  // The three Google-origin accounts that predate step 3 all carry a bcrypt
  // hash of the old random placeholder. Nothing about a hash reveals whether
  // it came from a placeholder or from a reset the user performed deliberately,
  // so signing in must never delete it. Step 3 changes what NEW accounts get,
  // not what existing accounts keep.
  const User = fakeUserModel([
    {
      _id: 'legacy',
      email: 'buyer@example.com',
      provider: 'google',
      googleId: GOOGLE_SUB,
      password: 'legacy-bcrypt-hash',
    },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user.password, 'legacy-bcrypt-hash', 'legacy passwords are left alone')
  assert.equal(User.calls.findOneAndUpdate.length, 0, 'and no write happens at all')
})

test('C. a legacy Google account being lazily linked also keeps its password', async () => {
  const User = fakeUserModel([
    { _id: 'legacy', email: 'buyer@example.com', provider: 'google', password: 'legacy-hash' },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user.googleId, GOOGLE_SUB)
  assert.equal(user.password, 'legacy-hash')
  assert.deepEqual(Object.keys(User.calls.findOneAndUpdate[0].update.$set), ['googleId'])
})

test('H. a Google account that has since set a password still signs in with Google', async () => {
  // Password presence must not interfere with Google sign-in: googleId stays
  // authoritative, and the account keeps both ways in.
  const User = fakeUserModel([
    {
      _id: 'both',
      email: 'buyer@example.com',
      provider: 'google',
      googleId: GOOGLE_SUB,
      password: 'deliberately-set-hash',
    },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'both')
  assert.equal(user.password, 'deliberately-set-hash')
  assert.equal(User.calls.create.length, 0)
})

// ── E. Microsoft-origin account links Google ─────────────────────────────
test('E. a Microsoft-origin account keeps provider and microsoftId when linked', async () => {
  const User = fakeUserModel([
    {
      _id: 'u1',
      email: 'buyer@example.com',
      provider: 'microsoft',
      microsoftId: 'MS-abc',
      role: 'agent',
    },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user.googleId, GOOGLE_SUB)
  assert.equal(user.provider, 'microsoft')
  assert.equal(user.microsoftId, 'MS-abc', 'the Microsoft link is untouched')
  assert.equal(user.role, 'agent')
})

// ── F. Conflicting Google identity ───────────────────────────────────────
test('F. an email already linked to a different Google account is refused', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', googleId: 'G111' },
  ])

  const error = await expectRejection(
    resolveGoogleUser({ identity: identityFor({ googleId: OTHER_GOOGLE_SUB }), User }),
    { code: 'google_identity_conflict', status: 401 }
  )

  assert.equal(error.publicMessage, 'Google authentication failed')
  assert.equal(User.docs[0].googleId, 'G111', 'the existing link must survive intact')
  assert.equal(User.calls.findOneAndUpdate.length, 0, 'no write may be attempted')
  assert.equal(User.calls.create.length, 0)
})

test('F. the conflict rejection does not leak either Google identity', async () => {
  const User = fakeUserModel([{ _id: 'u1', email: 'buyer@example.com', googleId: 'G111' }])

  const error = await expectRejection(
    resolveGoogleUser({ identity: identityFor({ googleId: OTHER_GOOGLE_SUB }), User }),
    { code: 'google_identity_conflict', status: 401 }
  )

  assert.equal(error.publicMessage.includes('G111'), false)
  assert.equal(error.publicMessage.includes(OTHER_GOOGLE_SUB), false)
})

// ── G. Google email changed since last sign-in ───────────────────────────
test('G. a googleId match wins even when the Google email has changed', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'old@example.com', googleId: GOOGLE_SUB, provider: 'google' },
  ])

  const user = await resolveGoogleUser({
    identity: identityFor({ email: 'new@example.com', googleId: GOOGLE_SUB }),
    User,
  })

  assert.equal(user._id, 'u1', 'same human, matched on the stable identifier')
  // Documented step-2 behaviour: the Varlikent address is NOT rewritten.
  // Changing it would move which address owns the account and where password
  // resets go — an account-management decision, not a login side effect.
  assert.equal(user.email, 'old@example.com', 'the Varlikent email is left alone')
  assert.equal(User.calls.create.length, 0, 'and no second account appears')
  assert.equal(User.docs.length, 1)
})

// ── H. No stable Google subject — fail closed ────────────────────────────
test('H. a verified identity with no googleId is refused outright', async () => {
  const User = fakeUserModel([{ _id: 'u1', email: 'buyer@example.com' }])

  await expectRejection(
    resolveGoogleUser({ identity: identityFor({ googleId: null }), User }),
    { code: 'missing_google_id', status: 401 }
  )

  assert.equal(User.calls.findOne.length, 0, 'it must not even reach a query')
})

test('H. a falsy googleId can never become a query matching every unlinked user', async () => {
  // The failure mode being guarded: findOne({ googleId: undefined }) matches
  // the first user with no googleId, handing over a stranger's account.
  // Built literally rather than through identityFor(), whose default parameter
  // would quietly substitute a real googleId for `undefined`.
  for (const googleId of [null, undefined, '', 0, false]) {
    const User = fakeUserModel([
      { _id: 'someone-else', email: 'other@example.com' },
      { _id: 'u1', email: 'buyer@example.com' },
    ])

    const identity = { email: 'buyer@example.com', name: 'X', picture: '', googleId }

    await expectRejection(resolveGoogleUser({ identity, User }), {
      code: 'missing_google_id',
      status: 401,
    })

    assert.equal(User.calls.findOne.length, 0)
  }
})

test('H. verifyGoogleAccessToken refuses a token Google gives no sub for', async () => {
  await expectRejection(
    verifyGoogleAccessToken('no-sub', deps({
      tokenInfo: validTokenInfo({ sub: undefined }),
      profile: validProfile({ sub: undefined }),
    })),
    { code: 'missing_google_id', status: 401 }
  )
})

test('H. falls back to the userinfo sub when tokeninfo omits it', async () => {
  const identity = await verifyGoogleAccessToken('good-token', deps({
    tokenInfo: validTokenInfo({ sub: undefined }),
    profile: validProfile({ sub: '555' }),
  }))

  assert.equal(identity.googleId, '555')
})

// ── I. Inactive account ──────────────────────────────────────────────────
test('I. a deactivated linked account is refused with 403', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', googleId: GOOGLE_SUB, isActive: false },
  ])

  const error = await expectRejection(resolveGoogleUser({ identity: identityFor(), User }), {
    code: 'account_inactive',
    status: 403,
  })

  assert.equal(error.publicMessage, 'Your account is deactivated')
})

test('I. a deactivated account is still refused when reached by email linking', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', isActive: false },
  ])

  await expectRejection(resolveGoogleUser({ identity: identityFor(), User }), {
    code: 'account_inactive',
    status: 403,
  })
})

test('I. a deactivated account is refused WITHOUT being linked first', async () => {
  const User = fakeUserModel([
    { _id: 'u1', email: 'buyer@example.com', isActive: false },
  ])

  await expectRejection(resolveGoogleUser({ identity: identityFor(), User }), {
    code: 'account_inactive',
    status: 403,
  })

  assert.equal(User.calls.findOneAndUpdate.length, 0, 'no write to a switched-off account')
  assert.equal(User.docs[0].googleId, undefined)
})

test('I. treats an undefined isActive as active, matching the previous behaviour', async () => {
  // The original route compared `=== false` rather than testing truthiness, so
  // a legacy document without the field signed in fine. That must not change.
  const User = fakeUserModel()
  User.docs.push({ _id: 'legacy-id', email: 'buyer@example.com', googleId: GOOGLE_SUB })

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'legacy-id')
})

// ── J. Role preservation ─────────────────────────────────────────────────
test('J. every privileged role survives a Google sign-in', async () => {
  for (const role of ['owner', 'admin', 'agent', 'user']) {
    const User = fakeUserModel([
      { _id: `u-${role}`, email: 'buyer@example.com', provider: 'local', role },
    ])

    const user = await resolveGoogleUser({ identity: identityFor(), User })

    assert.equal(user.role, role, `${role} must not be reset by linking`)
  }
})

test('J. an existing profile is not overwritten with the Google profile', async () => {
  const User = fakeUserModel([
    {
      _id: 'u1',
      email: 'buyer@example.com',
      googleId: GOOGLE_SUB,
      name: 'Name They Chose On Varlikent',
      avatar: 'https://varlikent.example/their-upload.png',
    },
  ])

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user.name, 'Name They Chose On Varlikent')
  assert.equal(user.avatar, 'https://varlikent.example/their-upload.png')
})

// ── K. Races and duplicate prevention ────────────────────────────────────
test('K. losing the create race adopts the winner rather than duplicating', async () => {
  const User = fakeUserModel()

  // Another request creates the same account after we looked and found none.
  User.onNextCreate(() => {
    User.docs.push({
      _id: 'winner',
      email: 'buyer@example.com',
      googleId: GOOGLE_SUB,
      isActive: true,
    })
  })

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'winner')
  assert.equal(User.docs.length, 1, 'exactly one account for one Google identity')
})

test('K. losing the create race on email alone still links rather than duplicating', async () => {
  const User = fakeUserModel()

  User.onNextCreate(() => {
    User.docs.push({ _id: 'winner', email: 'buyer@example.com', isActive: true })
  })

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'winner')
  assert.equal(user.googleId, GOOGLE_SUB, 'and the account gets linked')
  assert.equal(User.docs.length, 1)
})

test('K. losing the create race to a CONFLICTING identity is refused, not adopted', async () => {
  const User = fakeUserModel()

  User.onNextCreate(() => {
    User.docs.push({
      _id: 'winner',
      email: 'buyer@example.com',
      googleId: 'G111',
      isActive: true,
    })
  })

  await expectRejection(resolveGoogleUser({ identity: identityFor(), User }), {
    code: 'google_identity_conflict',
    status: 401,
  })

  assert.equal(User.docs[0].googleId, 'G111')
})

test('K. losing the compare-and-swap to the SAME identity succeeds idempotently', async () => {
  const User = fakeUserModel([{ _id: 'u1', email: 'buyer@example.com' }])
  const realFindOneAndUpdate = User.findOneAndUpdate

  // Simulate the concurrent linker committing between our read and our write.
  User.findOneAndUpdate = async (...args) => {
    User.docs[0].googleId = GOOGLE_SUB
    return realFindOneAndUpdate.call(User, ...args)
  }

  const user = await resolveGoogleUser({ identity: identityFor(), User })

  assert.equal(user._id, 'u1')
  assert.equal(user.googleId, GOOGLE_SUB)
})

test('K. losing the compare-and-swap to a DIFFERENT identity is refused', async () => {
  const User = fakeUserModel([{ _id: 'u1', email: 'buyer@example.com' }])
  const realFindOneAndUpdate = User.findOneAndUpdate

  User.findOneAndUpdate = async (...args) => {
    User.docs[0].googleId = 'G111'
    return realFindOneAndUpdate.call(User, ...args)
  }

  await expectRejection(resolveGoogleUser({ identity: identityFor(), User }), {
    code: 'google_identity_conflict',
    status: 401,
  })

  assert.equal(User.docs[0].googleId, 'G111', 'the winner keeps the link')
})

test('K. a non-duplicate create failure is not swallowed', async () => {
  const User = fakeUserModel()
  User.create = async () => {
    throw new Error('database is on fire')
  }

  await assert.rejects(resolveGoogleUser({ identity: identityFor(), User }), /database is on fire/)
})

// ── The allowlist configuration itself ───────────────────────────────────
test('config: reads the website client from GOOGLE_CLIENT_ID', () => {
  assert.deepEqual(getTrustedGoogleClientIds({ GOOGLE_CLIENT_ID: TRUSTED_WEB_CLIENT }), [
    TRUSTED_WEB_CLIENT,
  ])
})

test('config: accepts additional clients, trimmed and deduplicated', () => {
  const trusted = getTrustedGoogleClientIds({
    GOOGLE_CLIENT_ID: TRUSTED_WEB_CLIENT,
    GOOGLE_CLIENT_IDS: ` ${TRUSTED_FUTURE_MOBILE_CLIENT} , ${TRUSTED_WEB_CLIENT} `,
  })

  assert.deepEqual(trusted, [TRUSTED_WEB_CLIENT, TRUSTED_FUTURE_MOBILE_CLIENT])
})

test('config: an unset GOOGLE_CLIENT_ID yields no trusted clients, not a blank one', () => {
  // A [''] allowlist would be catastrophic here, since a tokeninfo response
  // with a missing aud could then compare equal to it.
  assert.deepEqual(getTrustedGoogleClientIds({}), [])
  assert.deepEqual(getTrustedGoogleClientIds({ GOOGLE_CLIENT_ID: '   ' }), [])
})
