// Role assignment rules — the single source of truth for "who may set whom to
// which role".
//
// Pure functions, no database and no Express, so the entire hierarchy can be
// unit-tested without touching a real account. The route layer does the
// lookups and the saving; this file decides whether it is allowed.
//
// Two invariants drive everything here:
//
//   1. 'owner' is NEVER assignable through the API. The only path to owner is
//      scripts/createOwner.js, which needs shell + database access. Before
//      this file existed, PUT /api/users/:id/role assigned req.body.role
//      directly and the Mongoose enum was the only check — and 'owner' is in
//      that enum, so any admin holding user_management could mint an owner.
//
//   2. Nobody may raise another account to their own level. An admin with
//      user_management creates agents and users, never more admins.

// Every role the system knows about. Mirrors the User schema enum.
export const ROLES = ['owner', 'admin', 'agent', 'user']

// The roles a request may ever ask for. 'owner' is deliberately absent — it is
// not an oversight, it is the rule.
export const API_ASSIGNABLE_ROLES = ['admin', 'agent', 'user']

/**
 * Which roles this actor is permitted to hand out.
 *
 * Reads the actor from `req.user` (the JWT-resolved account), never from the
 * request body, so a client cannot describe itself into a higher tier.
 */
export const assignableRolesFor = (actor) => {
  if (!actor) return []

  // Owner may create admins, agents and users — but not another owner.
  if (actor.role === 'owner') return ['admin', 'agent', 'user']

  // An admin delegated user_management staffs the ground floor only.
  if (actor.permissions?.includes('user_management')) return ['agent', 'user']

  return []
}

const deny = (status, message) => ({ ok: false, status, message })

/**
 * Decides whether `actor` may set `target` to `requestedRole`.
 *
 * Returns either
 *   { ok: true, roleChanged: false }            → leave the role alone
 *   { ok: true, roleChanged: true, role }       → apply this role
 *   { ok: false, status, message }              → reject with this status
 *
 * `roleChanged: false` is what keeps activate/deactivate working. The admin UI
 * toggles isActive by PUTting the target's CURRENT role alongside the new
 * isActive value; that is not a role mutation and must not be run through the
 * hierarchy, or an admin with user_management would lose the ability to
 * deactivate an admin purely because the payload echoed the word "admin".
 */
export const validateRoleChange = ({ actor, target, requestedRole }) => {
  if (!actor) return deny(401, 'Not authenticated')
  if (!target) return deny(404, 'User not found')

  // Owners are untouchable through this endpoint, in either direction.
  if (target.role === 'owner') {
    return deny(403, 'Cannot change the role of another owner')
  }

  // Absent means "not part of this request" — an isActive-only update.
  if (requestedRole === undefined || requestedRole === null || requestedRole === '') {
    return { ok: true, roleChanged: false }
  }

  if (typeof requestedRole !== 'string' || !ROLES.includes(requestedRole)) {
    return deny(400, 'Invalid role')
  }

  // Checked before the hierarchy so the caller gets the real reason rather
  // than a generic "not allowed" — and so this holds even for an owner.
  if (requestedRole === 'owner') {
    return deny(403, 'The owner role cannot be assigned through the API')
  }

  // Re-asserting the role a user already has is a no-op, not an escalation.
  // Same path as the isActive-only case above.
  if (requestedRole === target.role) {
    return { ok: true, roleChanged: false }
  }

  // Only reachable once we know the role would genuinely change, so this
  // blocks self-promotion and self-demotion without blocking an admin from
  // toggling their own active state the way they can today.
  if (String(actor._id) === String(target._id)) {
    return deny(403, 'You cannot change your own role')
  }

  if (!assignableRolesFor(actor).includes(requestedRole)) {
    return deny(403, `You are not allowed to assign the '${requestedRole}' role`)
  }

  return { ok: true, roleChanged: true, role: requestedRole }
}

/**
 * Whether an account in this role may hold admin permissions at all.
 *
 * Deliberately narrow: it names 'agent' and nothing else. An agent's future
 * messaging ability comes from being a participant in a conversation, not from
 * a permission flag, so there is never a reason to grant them one. Existing
 * behaviour for every other role is left exactly as it was.
 */
export const canReceiveAdminPermissions = (targetRole) => targetRole !== 'agent'
