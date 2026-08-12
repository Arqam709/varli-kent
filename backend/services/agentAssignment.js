import mongoose from 'mongoose'
import User from '../models/User.js'


export const parseAgentAssignment = (body = {}) => {
  if (!body || typeof body !== 'object' || !('agent' in body)) {
    return { ok: true, present: false }
  }

  const raw = body.agent

  // The empty string is what an unselected <select> submits.
  if (raw === null || raw === '') {
    return { ok: true, present: true, value: null }
  }

  // A client that echoed a populated detail response back at us sends the
  // whole agent object. Accept its _id rather than failing the round trip.
  const candidate = raw && typeof raw === 'object' ? raw._id : raw

  if (typeof candidate !== 'string' && !(candidate instanceof mongoose.Types.ObjectId)) {
    return { ok: false, message: 'agent must be an agent user id, or null to unassign' }
  }

  const id = String(candidate)
  if (!mongoose.isValidObjectId(id)) {
    return { ok: false, message: 'agent is not a valid user id' }
  }

  return { ok: true, present: true, value: id }
}

/**
 * THE rule for "may this user be assigned to a property, or shown as its
 * agent". One definition, used by both the write path and the read path, so
 * they cannot drift.
 *
 * Re-checked on read as well as on write because a stored agent reference goes
 * stale the moment someone is deactivated or demoted.
 */
export const isAssignableAgent = (user) =>
  Boolean(user) && user.role === 'agent' && user.isActive === true

// What a PUBLIC visitor may learn about a listing's agent: who they are, and
// nothing else. Email is deliberately absent — the admin selector below has a
// separate serializer for that, because "an authorised admin picking an agent"
// and "anyone browsing a listing" are different privacy questions.
export const publicAgent = (agent) => {
  if (!isAssignableAgent(agent)) return null

  return {
    _id: agent._id,
    name: agent.name || '',
    avatar: agent.avatar || '',
  }
}

// Everything publicAgent() needs, including the two fields it uses to decide
// and then discards. Kept here so the route cannot forget one.
export const AGENT_POPULATE_FIELDS = 'name avatar role isActive'

// The agent selector on the admin property form. Includes email because the
// form auto-fills Property.agentEmail from it — a value the admin would
// otherwise have to retype, and retype correctly. Reachable only by
// owner/admin with property-management permission.
export const adminAgentOption = (agent) => {
  if (!isAssignableAgent(agent)) return null

  return {
    _id: agent._id,
    name: agent.name || '',
    email: agent.email || '',
    avatar: agent.avatar || '',
  }
}

export const ADMIN_AGENT_OPTION_FIELDS = 'name email avatar role isActive'

/**
 * Works out every agent-related field a property write should end up with.
 *
 * This exists because three values are entangled and only the server can be
 * trusted to keep them consistent:
 *
 *   agent           — chosen by the admin
 *   agentEmail      — DERIVED from that agent's account, never typed
 *   agentPhone
 *   whatsappNumber  — typed by the admin, but must not outlive an agent change
 *
 * Returns { ok, changes, drop } where `changes` is applied over the request
 * body and `drop` lists fields to remove from it so the stored value survives
 * untouched.
 *
 * ── Why "changed" is a transition, not a state ───────────────────────────
 * Clearing is keyed on the agent actually CHANGING, not on the agent being
 * absent. That distinction protects the 30-odd legacy listings that have no
 * `agent` but do have a working agentEmail/agentPhone/whatsappNumber driving
 * the public Email/Call/WhatsApp buttons: opening one and pressing Save is not
 * an unassignment, so their contact details are left alone.
 */
export const resolveAgentContact = async (body = {}, existingProperty = null) => {
  const parsed = parseAgentAssignment(body)
  if (!parsed.ok) return parsed

  // Absent from the request — this write says nothing about the agent, so it
  // must not disturb any agent field.
  if (!parsed.present) {
    // ...except that agentEmail is server-owned whenever an agent is assigned.
    // Dropping it stops a client rewriting the email without touching `agent`.
    return { ok: true, changes: {}, drop: existingProperty?.agent ? ['agentEmail'] : [] }
  }

  const previousId = existingProperty?.agent ? String(existingProperty.agent) : null
  const nextId = parsed.value ? String(parsed.value) : null
  const agentChanged = previousId !== nextId

  const changes = { agent: parsed.value }

  if (nextId) {
    // Look the agent up rather than believing anything the client said about
    // them. This is also where Phase 0's assignment rules are enforced.
    const user = await User.findById(nextId).select('role isActive email')

    if (!user) {
      return { ok: false, message: 'Assigned agent not found' }
    }
    if (!isAssignableAgent(user)) {
      return { ok: false, message: 'Assigned agent must be an active user with the agent role' }
    }

    // THE source of truth for agentEmail. A request carrying
    // { agent: <Ahmet>, agentEmail: 'attacker@example.com' } stores Ahmet's
    // real address, because this overwrites whatever the body contained.
    changes.agentEmail = user.email || ''

    if (agentChanged) {
      // A different person now owns this listing, so the previous agent's
      // phone and WhatsApp must not silently carry over. Only fields the
      // request did NOT supply are blanked: the admin form clears and resends
      // them in the same save, and an administrator is entitled to type
      // whatever numbers they like — the risk being guarded against is a stale
      // value surviving by OMISSION, not an authorised admin's deliberate
      // input.
      if (!('agentPhone' in body)) changes.agentPhone = ''
      if (!('whatsappNumber' in body)) changes.whatsappNumber = ''
    }
  } else if (agentChanged) {
    // A genuine unassignment: there was an agent, now there is none, so every
    // value describing them goes with them.
    changes.agentEmail = ''
    changes.agentPhone = ''
    changes.whatsappNumber = ''
  }

  return { ok: true, changes, drop: [] }
}
