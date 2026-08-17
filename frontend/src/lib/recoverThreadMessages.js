/**
 * Recovering a thread's messages after the socket was away.
 *
 * While connected, `property-message:new` keeps a thread current. While
 * disconnected — flaky Wi-Fi, a sleeping laptop, Render waking up — nothing
 * arrives, and MongoDB quietly moves ahead of the client. This module works out
 * what the client missed using the EXISTING cursor API, with no new endpoint and
 * no server-side event storage.
 *
 * ── Ordering rule ───────────────────────────────────────────────────────
 * `_id` is the canonical chronology, not `createdAt`. That is a decision the
 * backend already made and documented (models/PropertyMessage.js): two messages
 * can share a millisecond, so a createdAt sort can tie and reorder, while
 * ObjectIds are unique and monotonic. ObjectId hex strings are fixed width, so
 * a plain string comparison sorts them chronologically.
 */

/** Chronological id comparison. Safe because ObjectId hex is fixed-width. */
const byId = (a, b) => (String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0)

/**
 * Unions two message lists on `_id`, chronologically ordered.
 *
 * Pure, and it never mutates either input — `sort` runs on a fresh array.
 * Existing entries win over incoming ones so a re-fetch cannot replace an
 * object the UI is already rendering with an identical copy.
 */
export const mergeMessagesById = (current, incoming) => {
  if (!incoming?.length) return current
  if (!current?.length) return [...incoming].sort(byId)

  const seen = new Set(current.map((m) => String(m._id)))
  const additions = incoming.filter((m) => m && !seen.has(String(m._id)))

  if (additions.length === 0) return current

  return [...current, ...additions].sort(byId)
}

/** The newest id in a list, or null. Assumes nothing about ordering. */
const newestIdOf = (messages) =>
  messages.reduce((max, m) => (max === null || String(m._id) > max ? String(m._id) : max), null)

/**
 * Walks backwards from the newest page until it reconnects with what the client
 * already has.
 *
 * ── Why one page is not enough ──────────────────────────────────────────
 * A page is 30 messages. If the client holds [1..30] and 80 arrive while it is
 * offline, the newest page is [81..110]. Merging that alone leaves a HOLE at
 * 31..80 that the user can never fill: "Load older" pages backwards from
 * message 1, so it walks away from the gap rather than into it. The hole would
 * survive until the screen was remounted.
 *
 * So this keeps requesting older pages (via the existing `before` cursor) until
 * a page overlaps something already known — at which point the recovered range
 * is contiguous with local state and a merge is safe.
 *
 * ── When the gap is too wide ────────────────────────────────────────────
 * `maxPages` bounds the work. If the overlap is still not found, this reports
 * `contiguous: false` and the caller REPLACES its list with the recovered block
 * rather than merging a hole into it — keeping the newest messages, dropping
 * the stale older ones, and handing back a fresh cursor so "Load older" can
 * walk back through the gap normally. That way there is never a permanent hole,
 * only a bounded number of requests.
 *
 * `fetchPage({ before })` must resolve to { messages, nextCursor, hasMore } —
 * the existing getPropertyMessages shape, oldest→newest.
 */
export const collectRecoveryPages = async ({ current = [], fetchPage, maxPages = 5 }) => {
  const knownIds = new Set(current.map((m) => String(m._id)))

  let collected = []
  let before
  let lastPage = null
  let contiguous = current.length === 0 // nothing to bridge to

  for (let page = 0; page < maxPages; page += 1) {
    // Sequential on purpose: each request needs the cursor returned by the
    // previous one, so these cannot be parallelised.
    const result = await fetchPage({ before })
    lastPage = result

    const messages = Array.isArray(result?.messages) ? result.messages : []
    collected = [...messages, ...collected]

    // Reached the start of the thread: everything there is, is now collected.
    if (messages.length === 0 || !result?.hasMore || !result?.nextCursor) {
      contiguous = true
      break
    }

    // Any shared message means the recovered range now touches local state.
    if (messages.some((m) => knownIds.has(String(m._id)))) {
      contiguous = true
      break
    }

    if (current.length === 0) {
      contiguous = true
      break
    }

    before = result.nextCursor
  }

  return {
    messages: collected,
    contiguous,
    // Only meaningful when contiguous === false, where the caller adopts it.
    nextCursor: lastPage?.nextCursor ?? null,
    hasMore: Boolean(lastPage?.hasMore),
  }
}

/**
 * Folds a recovery result into the current list.
 *
 * ── The race this is built around ───────────────────────────────────────
 * A socket event can land WHILE the recovery request is in flight. The REST
 * response is a snapshot from slightly earlier, so assigning it directly
 * (`setMessages(page.messages)`) would silently drop that newer message. This
 * always merges instead, and in the replace path it explicitly carries over
 * anything newer than the recovered block — which can only be a socket arrival
 * from during the fetch.
 *
 * Returns { messages, adoptCursor } where `adoptCursor` tells the caller
 * whether its older-history cursor must be replaced.
 */
export const applyRecovery = (current, recovery) => {
  const collected = recovery?.messages ?? []
  if (collected.length === 0) return { messages: current, adoptCursor: false }

  if (recovery.contiguous) {
    /*
     * Contiguous: merge, and KEEP the existing older-history cursor.
     *
     * Recovery only ever adds messages NEWER than the oldest one already
     * loaded, so the cursor — which points before that oldest message — is
     * still exactly right. Overwriting it with the newest page's cursor would
     * be the bug: it would make "Load older" re-fetch history the user already
     * has, or skip past it.
     *
     * The one exception is a list that was empty, where there is no older
     * history to protect and the fetched cursor is the only correct one.
     */
    return {
      messages: mergeMessagesById(current, collected),
      adoptCursor: current.length === 0,
    }
  }

  // Gap too wide to bridge within maxPages. Keep the contiguous recovered block
  // plus any message newer than it (a socket arrival during the fetch), and let
  // the fresh cursor page back through the gap.
  const newestCollected = newestIdOf(collected)
  const newerThanBlock = current.filter((m) => String(m._id) > newestCollected)

  return {
    messages: mergeMessagesById([...collected].sort(byId), newerThanBlock),
    adoptCursor: true,
  }
}
