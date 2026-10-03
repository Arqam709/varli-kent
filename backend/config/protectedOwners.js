const OBJECT_ID_RE = /^[0-9a-f]{24}$/

// The number of protected owners the product is designed around. A different
// count is tolerated (and reported) rather than treated as fatal.
export const EXPECTED_PROTECTED_OWNER_COUNT = 2

let cachedRaw
let cachedIds = new Set()

const parse = (raw) => {
  const entries = String(raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  const ids = new Set(entries.filter((entry) => OBJECT_ID_RE.test(entry)))
  const invalidCount = entries.filter((entry) => !OBJECT_ID_RE.test(entry)).length

  return { ids, invalidCount }
}

const warn = ({ ids, invalidCount }) => {
  // Counts only. The ids are not secrets, but there is no reason for them to
  // sit in a log either.
  if (invalidCount > 0) {
    console.warn(
      `[protected-owners] PROTECTED_OWNER_IDS has ${invalidCount} entr${invalidCount === 1 ? 'y' : 'ies'} that ${invalidCount === 1 ? 'is' : 'are'} not a 24-character ObjectId — ignored`
    )
  }
  if (ids.size === 0) {
    console.warn('[protected-owners] PROTECTED_OWNER_IDS is not configured — no account is treated as a protected owner')
  } else if (ids.size !== EXPECTED_PROTECTED_OWNER_COUNT) {
    console.warn(
      `[protected-owners] expected ${EXPECTED_PROTECTED_OWNER_COUNT} protected owner ids, found ${ids.size} valid`
    )
  }
}

// Read lazily rather than at import: server.js calls dotenv.config() after its
// imports are evaluated, so a value captured at module load would be empty.
// Re-parsed (and re-reported) only when the raw value actually changes.
const load = () => {
  const raw = process.env.PROTECTED_OWNER_IDS ?? ''
  if (raw !== cachedRaw) {
    const parsed = parse(raw)
    cachedRaw = raw
    cachedIds = parsed.ids
    warn(parsed)
  }
  return cachedIds
}

/** The configured protected owner ids, as lowercase hex strings. */
export const getProtectedOwnerIds = () => [...load()]

/**
 * Whether the configuration names exactly the expected number of valid ids.
 * Guards do not need this; a later owner-removal flow will, so that it can
 * refuse to run on a half-configured server.
 */
export const isProtectedOwnerConfigValid = () => load().size === EXPECTED_PROTECTED_OWNER_COUNT

// Accepts a user document, a plain user object, a Mongoose ObjectId or a
// string, and reduces it to a comparable lowercase hex string.
const toIdString = (userOrId) => {
  if (userOrId === null || userOrId === undefined) return ''
  const id = typeof userOrId === 'object' && userOrId._id !== undefined && userOrId._id !== null
    ? userOrId._id
    : userOrId
  return String(id).trim().toLowerCase()
}


export const isProtectedOwner = (userOrId) => {
  const id = toIdString(userOrId)
  /*
  Is it a valid-looking MongoDB ID?
        AND
Is it inside PROTECTED_OWNER_IDS?
  */
  return OBJECT_ID_RE.test(id) && load().has(id)
}

/**
 * A plain copy of a user with the `isProtected` boolean a client may see.
 *
 * Takes a Mongoose document or a plain object. This is the only form in which
 * protection leaves the server.
 */
export const withProtectedFlag = (user) => {
  if (!user) return user
  const plain = typeof user.toObject === 'function' ? user.toObject() : { ...user }
  plain.isProtected = isProtectedOwner(plain._id ?? user._id)
  return plain
}

/**
 * Parses the configuration once at startup so a misconfiguration is reported
 * when the server boots rather than on the first request that happens to need
 * it. Never throws.
 */
export const reportProtectedOwnerConfig = () => {
  const count = load().size
  if (count === EXPECTED_PROTECTED_OWNER_COUNT) {
    console.log(`[protected-owners] ${count} protected owner accounts configured`)
  }
  return count
}
