// Focused unit tests for Property.agent validation and the public agent shape.
//
// Pure functions only — no database, no network, no property or user is
// created, read or deleted. resolveAgentContact() is the one function here
// that reads the database, and User.findById is stubbed for the cases that
// exercise it.
// Run with:  node scripts/testAgentAssignment.js

import mongoose from 'mongoose'
import {
  parseAgentAssignment,
  isAssignableAgent,
  publicAgent,
  adminAgentOption,
  resolveAgentContact,
  AGENT_POPULATE_FIELDS,
  ADMIN_AGENT_OPTION_FIELDS,
} from '../services/agentAssignment.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
}

// A syntactically valid id that belongs to nobody.
const validId = new mongoose.Types.ObjectId().toString()

// Reduces a parse result to a comparable token.
const parsed = (body) => {
  const result = parseAgentAssignment(body)
  if (!result.ok) return 'rejected'
  if (!result.present) return 'absent'
  return result.value === null ? 'unassign' : `id:${result.value}`
}

console.log('\n== accepted shapes ==')
check('valid ObjectId string', parsed({ agent: validId }), `id:${validId}`)
check('actual ObjectId instance', parsed({ agent: new mongoose.Types.ObjectId(validId) }), `id:${validId}`)
check('populated object with _id', parsed({ agent: { _id: validId, name: 'Ahmet' } }), `id:${validId}`)

console.log('\n== unassigning is valid ==')
check('explicit null', parsed({ agent: null }), 'unassign')
check('empty string (what an unselected <select> sends)', parsed({ agent: '' }), 'unassign')

console.log('\n== absent is different from null ==')
check('field missing entirely', parsed({ title: 'A house' }), 'absent')
check('empty body', parsed({}), 'absent')
check('undefined body', parsed(undefined), 'absent')
// This distinction is what makes a partial update safe: absent must leave an
// existing agent alone, null must clear it.
check('absent !== unassign', parsed({}) === parsed({ agent: null }), false)

console.log('\n== rejected shapes ==')
check('not a valid ObjectId', parsed({ agent: 'not-a-valid-id' }), 'rejected')
check('number', parsed({ agent: 12345 }), 'rejected')
check('boolean', parsed({ agent: true }), 'rejected')
check('array', parsed({ agent: [validId] }), 'rejected')
check('object without _id', parsed({ agent: { name: 'Ahmet' } }), 'rejected')
// A NoSQL-injection style payload must not survive parsing.
check('mongo operator object', parsed({ agent: { $ne: null } }), 'rejected')

console.log('\n== eligibility: only an ACTIVE user with role agent ==')
check('active agent', isAssignableAgent({ role: 'agent', isActive: true }), true)
check('inactive agent', isAssignableAgent({ role: 'agent', isActive: false }), false)
check('normal user', isAssignableAgent({ role: 'user', isActive: true }), false)
check('admin', isAssignableAgent({ role: 'admin', isActive: true }), false)
check('owner', isAssignableAgent({ role: 'owner', isActive: true }), false)
check('nonexistent (null lookup result)', isAssignableAgent(null), false)
check('undefined', isAssignableAgent(undefined), false)
// isActive must be a real boolean, not merely truthy — a missing field on a
// legacy document must not read as eligible.
check('isActive missing', isAssignableAgent({ role: 'agent' }), false)

console.log('\n== publicAgent exposes identity only ==')
const populated = {
  _id: validId,
  name: 'Ahmet Yılmaz',
  avatar: 'https://cdn/avatar.png',
  role: 'agent',
  isActive: true,
  email: 'ahmet@varlikent.com',
  permissions: ['user_management'],
  password: 'hashed',
  resetPasswordToken: 'secret',
}
const shaped = publicAgent(populated)

check('keys returned', Object.keys(shaped).sort().join(','), '_id,avatar,name')
check('name', shaped.name, 'Ahmet Yılmaz')
// Email reaches the ADMIN selector, never a public listing response.
check('email NOT exposed publicly', 'email' in shaped, false)
check('role NOT exposed', 'role' in shaped, false)
check('isActive NOT exposed', 'isActive' in shaped, false)
check('permissions NOT exposed', 'permissions' in shaped, false)
check('password NOT exposed', 'password' in shaped, false)
check('resetPasswordToken NOT exposed', 'resetPasswordToken' in shaped, false)
check('agentTitle is gone entirely', 'agentTitle' in shaped, false)

console.log('\n== publicAgent hides a stale assignment ==')
check('unassigned property', publicAgent(null), null)
check('agent since deactivated', publicAgent({ ...populated, isActive: false }), null)
check('agent since demoted to user', publicAgent({ ...populated, role: 'user' }), null)

console.log('\n== adminAgentOption adds email, and nothing more ==')
const option = adminAgentOption(populated)
check('keys returned', Object.keys(option).sort().join(','), '_id,avatar,email,name')
check('email included for the selector', option.email, 'ahmet@varlikent.com')
check('permissions NOT exposed', 'permissions' in option, false)
check('password NOT exposed', 'password' in option, false)
check('role NOT exposed', 'role' in option, false)
check('isActive NOT exposed', 'isActive' in option, false)
check('inactive agent excluded', adminAgentOption({ ...populated, isActive: false }), null)
check('non-agent excluded', adminAgentOption({ ...populated, role: 'admin' }), null)

console.log('\n== missing optional fields degrade to empty strings, not undefined ==')
const bare = publicAgent({ _id: validId, name: 'Mehmet', role: 'agent', isActive: true })
check('avatar defaults to empty string', bare.avatar, '')

console.log('\n== the populate field lists cover what each serializer reads ==')
for (const field of ['name', 'avatar', 'role', 'isActive']) {
  check(`AGENT_POPULATE_FIELDS includes ${field}`, AGENT_POPULATE_FIELDS.split(' ').includes(field), true)
}
check('AGENT_POPULATE_FIELDS does NOT fetch email', AGENT_POPULATE_FIELDS.includes('email'), false)
for (const field of ['name', 'email', 'avatar', 'role', 'isActive']) {
  check(`ADMIN_AGENT_OPTION_FIELDS includes ${field}`, ADMIN_AGENT_OPTION_FIELDS.split(' ').includes(field), true)
}

/* ── Agent contact resolution ──────────────────────────────────────────────
 * resolveAgentContact() is the one function here that reads the database, so
 * User.findById is stubbed for these cases. Nothing real is queried, created
 * or modified.
 */
console.log('\n== agent email is derived server-side, never taken from the client ==')

const ahmetId = new mongoose.Types.ObjectId().toString()
const mehmetId = new mongoose.Types.ObjectId().toString()

const ACCOUNTS = {
  [ahmetId]: { _id: ahmetId, role: 'agent', isActive: true, email: 'ahmet@varlikent.com' },
  [mehmetId]: { _id: mehmetId, role: 'agent', isActive: true, email: 'mehmet@varlikent.com' },
}

const User = (await import('../models/User.js')).default
const realFindById = User.findById
User.findById = (id) => ({ select: async () => ACCOUNTS[String(id)] || null })

const resolve = (body, existing) => resolveAgentContact(body, existing)

// A malicious client naming Ahmet but supplying someone else's address.
const forged = await resolve({ agent: ahmetId, agentEmail: 'attacker@example.com' }, null)
check('forged email is overwritten', forged.changes.agentEmail, 'ahmet@varlikent.com')
check('agent stored as chosen', String(forged.changes.agent), ahmetId)

const created = await resolve({ agent: ahmetId, agentPhone: '+90 500', whatsappNumber: '+90 500' }, null)
check('create derives email', created.changes.agentEmail, 'ahmet@varlikent.com')
check('create keeps typed phone', created.changes.agentPhone, undefined)
check('create keeps typed whatsapp', created.changes.whatsappNumber, undefined)

console.log('\n== same agent: contact details stay editable ==')
const sameAgent = await resolve(
  { agent: ahmetId, agentPhone: '+90 555 NEW', whatsappNumber: '+90 555 NEW' },
  { agent: ahmetId }
)
check('email still derived', sameAgent.changes.agentEmail, 'ahmet@varlikent.com')
check('phone NOT force-cleared', sameAgent.changes.agentPhone, undefined)
check('whatsapp NOT force-cleared', sameAgent.changes.whatsappNumber, undefined)

console.log('\n== agent A → agent B ==')
const swapped = await resolve({ agent: mehmetId }, { agent: ahmetId })
check('new agent stored', String(swapped.changes.agent), mehmetId)
check('email becomes the new agent\'s', swapped.changes.agentEmail, 'mehmet@varlikent.com')
// The failure this guards against: a client that simply omits the fields,
// leaving the previous agent's numbers attached to the new one.
check('stale phone cleared', swapped.changes.agentPhone, '')
check('stale whatsapp cleared', swapped.changes.whatsappNumber, '')

const swappedWithNew = await resolve(
  { agent: mehmetId, agentPhone: '+90 999', whatsappNumber: '+90 999' },
  { agent: ahmetId }
)
check('admin can set the new agent\'s numbers in the same save', swappedWithNew.changes.agentPhone, undefined)

console.log('\n== unassigning ==')
const unassigned = await resolve({ agent: '' }, { agent: ahmetId })
check('agent cleared', unassigned.changes.agent, null)
check('email cleared', unassigned.changes.agentEmail, '')
check('phone cleared', unassigned.changes.agentPhone, '')
check('whatsapp cleared', unassigned.changes.whatsappNumber, '')

console.log('\n== legacy listings are NOT wiped by an ordinary save ==')
// 30-odd live properties have no `agent` but do have contact details driving
// the public Email/Call/WhatsApp buttons. Saving one while it stays
// unassigned is not an unassignment and must leave them alone.
const legacy = await resolve({ agent: '' }, { agent: null })
check('agent still null', legacy.changes.agent, null)
check('legacy email untouched', 'agentEmail' in legacy.changes, false)
check('legacy phone untouched', 'agentPhone' in legacy.changes, false)
check('legacy whatsapp untouched', 'whatsappNumber' in legacy.changes, false)

console.log('\n== agent absent from the request changes nothing ==')
const untouched = await resolve({ title: 'Renamed' }, { agent: ahmetId })
check('no agent change', Object.keys(untouched.changes).length, 0)
// ...but the client still may not rewrite a server-owned email.
check('agentEmail dropped from payload', untouched.drop.join(','), 'agentEmail')

const untouchedLegacy = await resolve({ title: 'Renamed' }, { agent: null })
check('legacy listing keeps manual email editable', untouchedLegacy.drop.length, 0)

console.log('\n== assignment rules still enforced ==')
check('non-agent rejected', (await resolve({ agent: 'x'.repeat(24) }, null)).ok, false)
User.findById = () => ({ select: async () => ({ role: 'user', isActive: true, email: 'u@x.com' }) })
check('normal user rejected', (await resolve({ agent: ahmetId }, null)).ok, false)
User.findById = () => ({ select: async () => ({ role: 'agent', isActive: false, email: 'a@x.com' }) })
check('inactive agent rejected', (await resolve({ agent: ahmetId }, null)).ok, false)
User.findById = () => ({ select: async () => null })
check('nonexistent rejected', (await resolve({ agent: ahmetId }, null)).ok, false)

User.findById = realFindById

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
