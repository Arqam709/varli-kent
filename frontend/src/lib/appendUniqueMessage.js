/**
 * Appends one persisted message to a thread, ignoring it if that `_id` is
 * already there.
 *
 * ── Why a thread needs this at all ──────────────────────────────────────
 * Since RT-1 a message can reach the same component through TWO paths:
 *
 *   1. the POST response   — the server-persisted message, returned to whoever
 *                            sent it
 *   2. property-message:new — the socket event, which is emitted to BOTH
 *                            participants, the sender included
 *
 * Emitting to the sender as well is deliberate: it is what keeps a second
 * browser tab (or a second signed-in device) in step. The cost is that the
 * sender's own client receives its message twice, and the two can arrive in
 * EITHER order — the socket frequently wins, because it is pushed the moment
 * the write commits while the POST response still has a round trip to finish.
 *
 * Comparing on the server-assigned `_id` makes arrival order irrelevant:
 * whichever copy lands first is appended, the second is dropped, and the result
 * is identical either way. That is why no optimistic-message reconciliation and
 * no temporary client ids are needed anywhere in this feature.
 *
 * ── Why String() on both sides ──────────────────────────────────────────
 * `_id` arrives as a string over JSON from both paths, so this is belt and
 * braces rather than a known mismatch. It costs nothing, and it means a future
 * caller passing a raw ObjectId cannot silently reintroduce duplicates — the
 * exact bug this function exists to prevent. It matches the comparison the
 * older-messages pagination already uses.
 *
 * Returns the ORIGINAL array reference when the message is already present, so
 * React skips the re-render entirely.
 */
export const appendUniqueMessage = (current, message) =>
  current.some((item) => String(item._id) === String(message._id))
    ? current
    : [...current, message]

export default appendUniqueMessage
