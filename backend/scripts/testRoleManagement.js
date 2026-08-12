// Focused unit tests for the role-assignment hierarchy.
//
// Pure functions only — no database, no network, no real account is read,
// created or modified. Every "user" below is a plain object.
// Run with:  node scripts/testRoleManagement.js

import {
  ROLES,
  API_ASSIGNABLE_ROLES,
  assignableRolesFor,
  validateRoleChange,
  canReceiveAdminPermissions,
} from '../services/roleManagement.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, expected ${expected})`}`)
}

// ── Cast ────────────────────────────────────────────────────────────────────
const owner = { _id: 'owner1', role: 'owner', permissions: [] }
const adminWithUM = { _id: 'admin1', role: 'admin', permissions: ['user_management', 'edit_listing'] }
const adminNoUM = { _id: 'admin2', role: 'admin', permissions: ['edit_listing'] }
const agent = { _id: 'agent1', role: 'agent', permissions: [] }
const plainUser = { _id: 'user1', role: 'user', permissions: [] }

const targetUser = { _id: 'target-user', role: 'user' }
const targetAgent = { _id: 'target-agent', role: 'agent' }
const targetAdmin = { _id: 'target-admin', role: 'admin' }
const targetOwner = { _id: 'target-owner', role: 'owner' }

// Reduces a decision to a comparable token so failures read clearly.
const outcome = (decision) => {
  if (!decision.ok) return `denied:${decision.status}`
  return decision.roleChanged ? `set:${decision.role}` : 'unchanged'
}

const attempt = (actor, target, requestedRole) =>
  outcome(validateRoleChange({ actor, target, requestedRole }))

console.log('\n== the enum knows all four roles, the API offers three ==')
check('ROLES includes agent', ROLES.includes('agent'), true)
check('ROLES length', ROLES.length, 4)
check('owner is NOT API-assignable', API_ASSIGNABLE_ROLES.includes('owner'), false)
check('agent is API-assignable', API_ASSIGNABLE_ROLES.includes('agent'), true)

console.log('\n== assignableRolesFor ==')
check('owner may assign 3 roles', assignableRolesFor(owner).join(','), 'admin,agent,user')
check('admin+user_management may assign 2', assignableRolesFor(adminWithUM).join(','), 'agent,user')
check('admin without user_management may assign none', assignableRolesFor(adminNoUM).length, 0)
check('agent may assign none', assignableRolesFor(agent).length, 0)
check('user may assign none', assignableRolesFor(plainUser).length, 0)
check('null actor may assign none', assignableRolesFor(null).length, 0)

// A: a normal user cannot manage roles.
console.log('\n== A. normal user cannot manage roles ==')
check('user → agent', attempt(plainUser, targetUser, 'agent'), 'denied:403')
check('user → admin', attempt(plainUser, targetUser, 'admin'), 'denied:403')

// B: an agent cannot manage roles.
console.log('\n== B. agent cannot manage roles ==')
check('agent sets user → agent', attempt(agent, targetUser, 'agent'), 'denied:403')
check('agent sets user → admin', attempt(agent, targetUser, 'admin'), 'denied:403')

// C: an admin WITHOUT user_management cannot manage roles.
// (The route's canManageUsers guard rejects these before they ever reach the
// hierarchy; this proves the rules deny them independently of that guard.)
console.log('\n== C. admin without user_management cannot manage roles ==')
check('admin(no UM) → agent', attempt(adminNoUM, targetUser, 'agent'), 'denied:403')
check('admin(no UM) → user', attempt(adminNoUM, targetAgent, 'user'), 'denied:403')

// D: admin + user_management.
console.log('\n== D. admin + user_management ==')
check('user → agent   ALLOWED', attempt(adminWithUM, targetUser, 'agent'), 'set:agent')
check('agent → user   ALLOWED', attempt(adminWithUM, targetAgent, 'user'), 'set:user')
check('user → admin   DENIED', attempt(adminWithUM, targetUser, 'admin'), 'denied:403')
check('user → owner   DENIED', attempt(adminWithUM, targetUser, 'owner'), 'denied:403')

// E: owner.
console.log('\n== E. owner ==')
check('user → agent   ALLOWED', attempt(owner, targetUser, 'agent'), 'set:agent')
check('user → admin   ALLOWED', attempt(owner, targetUser, 'admin'), 'set:admin')
check('agent → user   ALLOWED', attempt(owner, targetAgent, 'user'), 'set:user')
check('admin → agent  ALLOWED', attempt(owner, targetAdmin, 'agent'), 'set:agent')
check('user → owner   DENIED even for owner', attempt(owner, targetUser, 'owner'), 'denied:403')
check('agent → owner  DENIED even for owner', attempt(owner, targetAgent, 'owner'), 'denied:403')

// F: an existing owner is untouchable through this endpoint.
console.log('\n== F. an existing owner cannot be demoted ==')
check('owner demotes another owner → user', attempt(owner, targetOwner, 'user'), 'denied:403')
check('admin+UM demotes an owner', attempt(adminWithUM, targetOwner, 'user'), 'denied:403')
check('owner-target rejected even with no role sent', attempt(owner, targetOwner, undefined), 'denied:403')

console.log('\n== self-escalation ==')
const selfAdmin = { _id: 'admin1', role: 'admin', permissions: ['user_management'] }
const selfAsTarget = { _id: 'admin1', role: 'admin' }
check('admin promotes SELF to owner', attempt(selfAdmin, selfAsTarget, 'owner'), 'denied:403')
check('admin re-asserts SELF as admin (no-op)', attempt(selfAdmin, selfAsTarget, 'admin'), 'unchanged')
check('admin demotes SELF to agent', attempt(selfAdmin, selfAsTarget, 'agent'), 'denied:403')
check(
  'owner promotes SELF (blocked as owner-target)',
  attempt(owner, { _id: 'owner1', role: 'owner' }, 'admin'),
  'denied:403'
)
// ObjectId vs string identity must not create a loophole.
check(
  'self-check survives non-string ids',
  attempt(
    { _id: { toString: () => 'abc' }, role: 'admin', permissions: ['user_management'] },
    { _id: { toString: () => 'abc' }, role: 'user' },
    'agent'
  ),
  'denied:403'
)

// G: activation/deactivation must keep working.
console.log('\n== G. activate/deactivate is not a role change ==')
check('no role sent at all', attempt(adminWithUM, targetUser, undefined), 'unchanged')
check('null role sent', attempt(adminWithUM, targetUser, null), 'unchanged')
check('empty-string role sent', attempt(adminWithUM, targetUser, ''), 'unchanged')
check(
  "UI echoes the target's unchanged role (user)",
  attempt(adminWithUM, targetUser, 'user'),
  'unchanged'
)
check(
  'admin+UM deactivates an ADMIN, echoing role:admin',
  attempt(adminWithUM, targetAdmin, 'admin'),
  'unchanged'
)
check(
  'admin+UM deactivates an AGENT, echoing role:agent',
  attempt(adminWithUM, targetAgent, 'agent'),
  'unchanged'
)
check('owner deactivates an admin, echoing role:admin', attempt(owner, targetAdmin, 'admin'), 'unchanged')

console.log('\n== malformed input ==')
check('unknown role string', attempt(owner, targetUser, 'superuser'), 'denied:400')
check('role sent as a number', attempt(owner, targetUser, 42), 'denied:400')
check('role sent as an object', attempt(owner, targetUser, { role: 'admin' }), 'denied:400')
check('case variant is not accepted', attempt(owner, targetUser, 'Agent'), 'denied:400')
check('missing target', outcome(validateRoleChange({ actor: owner, target: null, requestedRole: 'agent' })), 'denied:404')
check('missing actor', outcome(validateRoleChange({ actor: null, target: targetUser, requestedRole: 'agent' })), 'denied:401')

console.log('\n== agents may not hold admin permissions ==')
check('agent blocked', canReceiveAdminPermissions('agent'), false)
check('admin allowed', canReceiveAdminPermissions('admin'), true)
check('user unchanged from before', canReceiveAdminPermissions('user'), true)
check('owner unchanged from before', canReceiveAdminPermissions('owner'), true)

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
