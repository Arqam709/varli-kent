// Owner removal — the one authorised path by which an owner stops being one.
//
// Everywhere else in the API an owner's role is untouchable:
// services/roleManagement.js refuses any role change on an owner, and
// DELETE /api/users/:id refuses to delete one. Nothing here loosens that. This
// service performs the demotion itself, and only after a code that was emailed
// to the protected owners has been entered by one of them.
//
//   any owner asks                      requestOwnerRemoval()
//        → a 6-digit code is generated, stored only as a bcrypt hash,
//          and emailed separately to each protected owner
//   a protected owner enters the code   confirmOwnerRemoval()
//        → target becomes role 'user' with no permissions. Never deleted.
//
// ── "Removal" is a demotion ──────────────────────────────────────────────
// The account, its email, its history and everything that references it are
// left exactly as they were. Only `role` and `permissions` change.
//
// ── Concurrency, without transactions ────────────────────────────────────
// Every state change is a single conditional update, so the database decides
// the winner rather than a read-then-write in this file:
//
//   one pending request per target   a unique partial index on the model
//   one code in force                re-issuing overwrites codeHash in place
//   bounded guessing                 an attempt is reserved ($inc) with
//                                    attemptCount < MAX in the filter, BEFORE
//                                    the code is compared
//   completes once                   pending → completed with the status and
//                                    the exact codeHash in the filter
//   demotes only an owner            { _id, role: 'owner' } in the filter
//
// The request is claimed BEFORE the demotion runs. If the demotion then fails
// the request is closed and a new code is needed — the failure mode is "no
// change, ask again", never "changed twice" or "changed without a record".
//
// ── What is never written anywhere ───────────────────────────────────────
// The code and its hash appear in no response, no log line and no activity
// entry. The code exists in plaintext only in the outgoing email.

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import OwnerRemovalRequest from '../models/OwnerRemovalRequest.js'
import ActivityLog from '../models/ActivityLog.js'
import {
  EXPECTED_PROTECTED_OWNER_COUNT,
  getProtectedOwnerIds,
  isProtectedOwner,
  isProtectedOwnerConfigValid,
  withProtectedFlag,
} from '../config/protectedOwners.js'
// A namespace import on purpose. Several route test files replace
// utils/email.js with a mock exposing only the one sender they exercise; a
// named import of the two functions below would make routes/users.js fail to
// LINK in those files, though none of them ever reaches this service.
import * as email from '../utils/email.js'

export const OWNER_REMOVAL_CODE_TTL_MS = 10 * 60 * 1000
export const OWNER_REMOVAL_MAX_ATTEMPTS = 5
export const OWNER_REMOVAL_RESEND_COOLDOWN_MS = 60 * 1000
// Across ALL targets: how many codes one owner may cause to be emailed.
export const OWNER_REMOVAL_REQUESTER_LIMIT = 5
export const OWNER_REMOVAL_REQUESTER_WINDOW_MS = 10 * 60 * 1000

// The activity actions this service records — the single definition of these
// strings. routes/activity.js imports them to decide who may see which entry,
// so the labels written and the labels filtered cannot drift apart.
//
// Phrased to read correctly in the Activity page, which renders
// "<actor> <action> a user account".
export const OWNER_REMOVAL_ACTIVITY = Object.freeze({
  requested: 'requested owner removal for',
  deliveryFailed: 'could not send an owner-removal code for',
  incorrectCode: 'entered an incorrect owner-removal code for',
  locked: 'locked the owner-removal request for',
  completed: 'completed owner removal for',
})

// Everything that describes a removal still in progress. Visible to protected
// owners only: an ordinary owner — who may be the one being removed — has no
// need to watch a pending request, its failed codes or its lock. `completed`
// is deliberately absent; a finished removal is ordinary audit history.
export const OWNER_REMOVAL_IN_PROGRESS_ACTIONS = Object.freeze([
  OWNER_REMOVAL_ACTIVITY.requested,
  OWNER_REMOVAL_ACTIVITY.deliveryFailed,
  OWNER_REMOVAL_ACTIVITY.incorrectCode,
  OWNER_REMOVAL_ACTIVITY.locked,
])

const BCRYPT_ROUNDS = 10
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/
const CODE_RE = /^\d{6}$/
const SAFE_USER_FIELDS = '-password -resetPasswordToken -resetPasswordExpires'

const fail = (status, message, extra = {}) => ({ status, body: { success: false, message, ...extra } })

/** A uniformly random six-digit code, leading zeros included. */
export const generateOwnerRemovalCode = () =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')

const sameId = (a, b) => String(a) === String(b)

const isDuplicateKey = (error) => error?.code === 11000

// ── Activity ─────────────────────────────────────────────────────────────
// Written here rather than by middleware/activityLogger.js, which records
// only successful requests and has no notion of a target: a wrong code and a
// lock are failures, and they are exactly what needs to be on record. The
// middleware skips these two routes so nothing is recorded twice.
const record = async (context, actor, { action, statusCode, target, details }) => {
  try {
    await ActivityLog.create({
      actorId: actor._id,
      actorName: actor.name,
      actorEmail: actor.email,
      actorRole: actor.role,
      method: context?.method || 'POST',
      path: context?.path || '/api/users',
      resource: 'users',
      action,
      statusCode,
      targetId: target?._id,
      targetName: target?.name,
      details,
    })
  } catch (error) {
    // An activity write must never decide the outcome of the request.
    console.error('[owner-removal] activity log write failed:', error.message)
  }
}

// ── Recipients ───────────────────────────────────────────────────────────
// WHO is protected comes from the configured ids. WHERE their code goes is
// the email on that account right now — an address a protected owner cannot
// change through the API (PUT /users/me/profile refuses it).
const loadProtectedRecipients = async () => {
  const owners = await User.find({ _id: { $in: getProtectedOwnerIds() } }).select('name email role isActive')

  return owners.filter(
    (owner) => isProtectedOwner(owner) && owner.role === 'owner' && owner.isActive !== false && owner.email
  )
}

const sendToEach = async (recipients, send) => {
  const results = await Promise.all(
    recipients.map((recipient) =>
      Promise.resolve()
        .then(() => send(recipient))
        .then(Boolean)
        .catch(() => false)
    )
  )
  return results.filter(Boolean).length
}

const closeRequest = (request, closedReason) =>
  OwnerRemovalRequest.updateOne(
    { _id: request._id, status: 'pending' },
    { $set: { status: 'cancelled', closedReason } }
  )

/**
 * Starts (or re-issues) the verification for removing `targetId` as an owner.
 *
 * @param {{actor: object, targetId: string, context?: {method: string, path: string}}} input
 *   `actor` is req.user — resolved from the JWT, never from the request body.
 * @returns {Promise<{status: number, body: object}>}
 */
export const requestOwnerRemoval = async ({ actor, targetId, context }) => {
  if (!actor || actor.role !== 'owner') {
    return fail(403, 'Only an owner can request the removal of an owner')
  }

  // Without both protected owners configured there is nobody the code could
  // safely go to, so the flow does not run at all.
  if (!isProtectedOwnerConfigValid()) {
    return fail(503, 'Owner removal is not available: protected owners are not configured')
  }

  if (!OBJECT_ID_RE.test(String(targetId))) return fail(404, 'User not found')

  const target = await User.findById(targetId)
  if (!target) return fail(404, 'User not found')

  if (isProtectedOwner(target)) {
    return fail(403, 'This owner account is protected and can never be removed')
  }
  if (sameId(target._id, actor._id)) {
    return fail(403, 'You cannot request the removal of your own account')
  }
  if (target.role !== 'owner') {
    return fail(400, 'This account is not an owner')
  }
  // A deactivated owner is a valid target. Nothing else in the API can change
  // an owner, so refusing here would leave a deactivated owner holding the
  // role for good. Removal changes role and permissions only — isActive is
  // left exactly as it is, in either state.

  const now = new Date()

  // A code that has run out no longer counts as the pending request.
  await OwnerRemovalRequest.updateMany(
    { targetUser: target._id, status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  )

  // Cooldown: one email per target per minute, whatever state the previous
  // request ended in — so locking a request is not a way around the wait.
  const cooldownStart = new Date(now.getTime() - OWNER_REMOVAL_RESEND_COOLDOWN_MS)
  const recent = await OwnerRemovalRequest.findOne({ targetUser: target._id, lastSentAt: { $gt: cooldownStart } })

  if (recent) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(recent.lastSentAt).getTime() + OWNER_REMOVAL_RESEND_COOLDOWN_MS - now.getTime()) / 1000)
    )
    return fail(429, 'A verification code was sent recently. Please wait before requesting another.', { retryAfterSeconds })
  }

  // Requester limit, on top of the per-target cooldown above: one owner cannot
  // work through several targets (or keep re-issuing for one) to flood the
  // protected owners' inboxes. Counted from the request collection itself —
  // every issued code is recorded there — so it survives a restart and needs
  // no separate store. Confirmation attempts are not counted here; they have
  // their own limit.
  const windowStart = new Date(now.getTime() - OWNER_REMOVAL_REQUESTER_WINDOW_MS)
  const withRecentIssuances = await OwnerRemovalRequest.find({
    issuances: { $elemMatch: { requestedBy: actor._id, at: { $gt: windowStart } } },
  }).select('issuances')

  const recentIssuances = withRecentIssuances
    .flatMap((doc) => doc.issuances || [])
    .filter((issuance) => sameId(issuance.requestedBy, actor._id) && new Date(issuance.at).getTime() > windowStart.getTime())
    .map((issuance) => new Date(issuance.at).getTime())

  if (recentIssuances.length >= OWNER_REMOVAL_REQUESTER_LIMIT) {
    // Allowed again once the oldest counted code leaves the window.
    const oldest = Math.min(...recentIssuances)
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + OWNER_REMOVAL_REQUESTER_WINDOW_MS - now.getTime()) / 1000)
    )
    return fail(429, 'Too many owner-removal requests. Please try again later.', { retryAfterSeconds })
  }

  const recipients = await loadProtectedRecipients()
  if (recipients.length === 0) {
    return fail(503, 'Owner removal is not available: no protected owner account could be reached')
  }

  const code = generateOwnerRemovalCode()
  const issuance = { requestedBy: actor._id, at: now }
  const fresh = {
    codeHash: await bcrypt.hash(code, BCRYPT_ROUNDS),
    requestedBy: actor._id,
    attemptCount: 0,
    expiresAt: new Date(now.getTime() + OWNER_REMOVAL_CODE_TTL_MS),
    lastSentAt: now,
  }

  // Re-issue in place when a request is already pending: the old hash is
  // overwritten, so the old code stops working the moment the new one exists.
  // `lastSentAt` in the filter is what makes two simultaneous re-issues safe —
  // the first moves it to `now`, and the second no longer matches.
  let request = await OwnerRemovalRequest.findOneAndUpdate(
    { targetUser: target._id, status: 'pending', lastSentAt: { $lte: cooldownStart } },
    { $set: fresh, $push: { issuances: issuance } },
    { returnDocument: 'after' }
  )

  if (!request) {
    try {
      request = await OwnerRemovalRequest.create({ targetUser: target._id, status: 'pending', ...fresh, issuances: [issuance] })
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      // Another owner created the pending request between the cooldown check
      // and this insert. Their code is the one in force; none is sent here.
      return fail(429, 'A verification code was sent recently. Please wait before requesting another.', {
        retryAfterSeconds: Math.ceil(OWNER_REMOVAL_RESEND_COOLDOWN_MS / 1000),
      })
    }
  }

  // The same code, sent separately to each protected owner, so one address
  // failing cannot take the other down with it.
  const sent = await sendToEach(recipients, (recipient) =>
    email.sendOwnerRemovalCode({
      to: recipient.email,
      code,
      target,
      requestedBy: actor,
      expiresInMinutes: OWNER_REMOVAL_CODE_TTL_MS / 60000,
    })
  )

  if (sent === 0) {
    // Nobody received the code, so a request nobody can complete must not be
    // left standing. Clearing lastSentAt keeps a failed send from starting
    // the cooldown.
    await OwnerRemovalRequest.updateOne(
      { _id: request._id, status: 'pending', codeHash: fresh.codeHash },
      { $set: { status: 'cancelled', closedReason: 'delivery_failed', lastSentAt: null } }
    )
    await record(context, actor, {
      action: OWNER_REMOVAL_ACTIVITY.deliveryFailed,
      statusCode: 502,
      target,
      details: 'verification email could not be sent to any protected owner',
    })
    return fail(502, 'The verification code could not be sent. Nothing was changed — please try again.')
  }

  // One of the two got it. Either protected owner can complete the request,
  // so it stays valid — and the shortfall is reported, not hidden.
  const delivery = sent >= EXPECTED_PROTECTED_OWNER_COUNT ? 'full' : 'partial'

  await record(context, actor, {
    action: OWNER_REMOVAL_ACTIVITY.requested,
    statusCode: 200,
    target,
    details: `verification code emailed to ${sent} of ${EXPECTED_PROTECTED_OWNER_COUNT} protected owners`,
  })

  return {
    status: 200,
    body: {
      success: true,
      message:
        delivery === 'full'
          ? 'Verification code sent to the protected owners.'
          : 'Verification code sent, but it could not be delivered to one of the protected owners.',
      delivery,
      expiresAt: request.expiresAt,
    },
  }
}

/**
 * Completes an owner removal: demotes `targetId` to a regular user.
 *
 * Requires BOTH a protected-owner caller and the correct code. Either
 * protected owner may confirm, whoever made the request.
 *
 * @param {{actor: object, targetId: string, code: unknown, context?: {method: string, path: string}}} input
 * @returns {Promise<{status: number, body: object}>}
 */
export const confirmOwnerRemoval = async ({ actor, targetId, code, context }) => {
  // Identity first, before the code is even looked at. A correct code in the
  // hands of anyone else gets this answer and uses up no attempt.
  if (!actor || actor.role !== 'owner' || !isProtectedOwner(actor)) {
    return fail(403, 'Only a protected owner can confirm an owner removal')
  }
  if (!isProtectedOwnerConfigValid()) {
    return fail(503, 'Owner removal is not available: protected owners are not configured')
  }

  const submitted = typeof code === 'string' || typeof code === 'number' ? String(code).trim() : ''
  if (!CODE_RE.test(submitted)) {
    return fail(400, 'Enter the 6-digit verification code')
  }

  if (!OBJECT_ID_RE.test(String(targetId))) return fail(404, 'User not found')

  const target = await User.findById(targetId)
  if (!target) return fail(404, 'User not found')

  // Checked again here, not only when the code was requested.
  if (isProtectedOwner(target)) {
    return fail(403, 'This owner account is protected and can never be removed')
  }

  const request = await OwnerRemovalRequest.findOne({ targetUser: target._id, status: 'pending' })

  if (!request) {
    const latest = await OwnerRemovalRequest.findOne({ targetUser: target._id }).sort({ createdAt: -1 })

    if (latest?.status === 'locked') {
      return fail(423, 'Too many incorrect attempts. Request a new verification code.')
    }
    if (latest?.status === 'completed') {
      return fail(409, 'This verification code has already been used')
    }
    return fail(404, 'No pending owner-removal request for this account. Request a new verification code.')
  }

  if (target.role !== 'owner') {
    await closeRequest(request, 'target_changed')
    return fail(409, 'This account is no longer an owner')
  }

  const now = new Date()

  if (new Date(request.expiresAt).getTime() <= now.getTime()) {
    await OwnerRemovalRequest.updateOne(
      { _id: request._id, status: 'pending', codeHash: request.codeHash },
      { $set: { status: 'expired' } }
    )
    return fail(410, 'This verification code has expired. Request a new one.')
  }

  // Reserve the attempt before comparing. The limit lives in the filter, so
  // however many guesses arrive at once, at most MAX of them get this far.
  const reserved = await OwnerRemovalRequest.findOneAndUpdate(
    {
      _id: request._id,
      status: 'pending',
      codeHash: request.codeHash,
      expiresAt: { $gt: now },
      attemptCount: { $lt: OWNER_REMOVAL_MAX_ATTEMPTS },
    },
    { $inc: { attemptCount: 1 } },
    { returnDocument: 'after' }
  )

  if (!reserved) {
    const current = await OwnerRemovalRequest.findOne({ _id: request._id })

    if (current?.status === 'locked') {
      return fail(423, 'Too many incorrect attempts. Request a new verification code.')
    }
    if (current?.status === 'completed') {
      return fail(409, 'This verification code has already been used')
    }
    return fail(409, 'This request changed while the code was being checked. Request a new verification code.')
  }

  const matches = await bcrypt.compare(submitted, reserved.codeHash)

  if (!matches) {
    const attemptsRemaining = Math.max(0, OWNER_REMOVAL_MAX_ATTEMPTS - reserved.attemptCount)

    await record(context, actor, {
      action: OWNER_REMOVAL_ACTIVITY.incorrectCode,
      statusCode: attemptsRemaining === 0 ? 423 : 401,
      target,
      details: `attempt ${reserved.attemptCount} of ${OWNER_REMOVAL_MAX_ATTEMPTS}`,
    })

    if (attemptsRemaining === 0) {
      await OwnerRemovalRequest.updateOne({ _id: request._id, status: 'pending' }, { $set: { status: 'locked' } })
      await record(context, actor, {
        action: OWNER_REMOVAL_ACTIVITY.locked,
        statusCode: 423,
        target,
        details: `${OWNER_REMOVAL_MAX_ATTEMPTS} incorrect attempts`,
      })
      return fail(423, 'Too many incorrect attempts. Request a new verification code.', { attemptsRemaining: 0 })
    }

    return fail(401, 'Incorrect verification code', { attemptsRemaining })
  }

  // The single state transition that makes a request usable exactly once.
  // Two protected owners submitting the right code together both reach this
  // line; only one update matches `status: 'pending'`.
  const claimed = await OwnerRemovalRequest.findOneAndUpdate(
    { _id: request._id, status: 'pending', codeHash: reserved.codeHash },
    { $set: { status: 'completed', confirmedBy: actor._id, confirmedAt: now } },
    { returnDocument: 'after' }
  )

  if (!claimed) {
    return fail(409, 'This verification code has already been used')
  }

  const voidClaim = (closedReason) =>
    OwnerRemovalRequest.updateOne(
      { _id: request._id, status: 'completed' },
      { $set: { status: 'cancelled', closedReason, confirmedBy: null, confirmedAt: null } }
    )

  // Ids are immutable, so this cannot have changed since the check above —
  // it is repeated directly ahead of the write because this is the one line
  // in the codebase that takes the owner role away from an account.
  if (isProtectedOwner(target)) {
    await voidClaim('target_changed')
    return fail(403, 'This owner account is protected and can never be removed')
  }

  let demoted
  try {
    demoted = await User.findOneAndUpdate(
      { _id: target._id, role: 'owner' },
      { $set: { role: 'user', permissions: [] } },
      { returnDocument: 'after' }
    ).select(SAFE_USER_FIELDS)
  } catch (error) {
    await voidClaim('demotion_failed').catch(() => {})
    throw error
  }

  if (!demoted) {
    await voidClaim('target_changed')
    return fail(409, 'This account is no longer an owner')
  }

  let requestedBy = null
  try {
    requestedBy = await User.findById(claimed.requestedBy).select('name email')
  } catch {
    // Only used to name the requester in the log and the notification.
  }

  await record(context, actor, {
    action: OWNER_REMOVAL_ACTIVITY.completed,
    statusCode: 200,
    target,
    details: `demoted from owner to user${requestedBy?.name ? `; requested by ${requestedBy.name}` : ''}`,
  })

  // Tell both protected owners it happened. The demotion is already done and
  // recorded, so a failed notification changes nothing about the outcome.
  try {
    const recipients = await loadProtectedRecipients()
    await sendToEach(recipients, (recipient) =>
      email.sendOwnerRemovalCompleted({ to: recipient.email, target, confirmedBy: actor, requestedBy })
    )
  } catch (error) {
    console.error('[owner-removal] completion notification failed:', error.message)
  }

  return {
    status: 200,
    body: {
      success: true,
      message: `${target.name} is no longer an owner.`,
      user: withProtectedFlag(demoted),
    },
  }
}
