// Focused unit tests for the Agent Portal: route guarding and ownership
// scoping.
//
// Pure functions only — no database, no network, no server started, no real
// user or property touched. The Express middleware is exercised with fake
// req/res objects, which is enough to prove the guard decisions because the
// guards are pure functions of req.user.
// Run with:  node scripts/testAgentPortal.js

import { requireRole } from '../middleware/checkPermission.js'

let passed = 0
let failed = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
}

// ── Harness ────────────────────────────────────────────────────────────────
// Runs a middleware against a fake request and reports what it decided.
const runGuard = (middleware, user) => {
  let outcome = 'no-decision'

  const res = {
    status(code) {
      outcome = `denied:${code}`
      return { json: () => {} }
    },
  }

  middleware({ user }, res, () => { outcome = 'allowed' })
  return outcome
}

// This is the exact guard routes/agent.js installs via router.use().
const agentGuard = requireRole('agent')

const owner = { _id: 'o1', role: 'owner', permissions: [] }
const admin = { _id: 'a1', role: 'admin', permissions: ['user_management', 'edit_listing'] }
const agentA = { _id: 'ag1', role: 'agent', permissions: [] }
const agentB = { _id: 'ag2', role: 'agent', permissions: [] }
const plainUser = { _id: 'u1', role: 'user', permissions: [] }

console.log('\n== /api/agent/* is STRICTLY agent-only ==')
check('agent      → allowed', runGuard(agentGuard, agentA), 'allowed')
check('normal user→ 403', runGuard(agentGuard, plainUser), 'denied:403')
check('admin      → 403', runGuard(agentGuard, admin), 'denied:403')
check('owner      → 403', runGuard(agentGuard, owner), 'denied:403')
// `protect` rejects an absent user with 401 before this guard ever runs; this
// asserts the guard itself does not admit one either.
check('anonymous  → denied', runGuard(agentGuard, undefined), 'denied:403')

console.log('\n== the admin portal guard still excludes agents ==')
const adminGuard = requireRole('owner', 'admin')
check('agent  → 403 on /admin', runGuard(adminGuard, agentA), 'denied:403')
check('admin  → allowed on /admin', runGuard(adminGuard, admin), 'allowed')
check('owner  → allowed on /admin', runGuard(adminGuard, owner), 'allowed')
check('user   → 403 on /admin', runGuard(adminGuard, plainUser), 'denied:403')

console.log('\n== ownership scoping comes from req.user._id, never the request ==')
// Mirrors the filter in routes/agent.js: Property.find({ agent: req.user._id }).
const buildPropertyFilter = (req) => ({ agent: req.user._id })

const fixtures = [
  { _id: 'p1', title: 'Sarıyer flat', agent: 'ag1' },
  { _id: 'p2', title: 'Beykoz villa', agent: 'ag2' },
  { _id: 'p3', title: 'Levent office', agent: 'ag1' },
  { _id: 'p4', title: 'Unassigned loft', agent: null },
]
// Models Mongo's matching semantics for an ObjectId ref: an unassigned
// property (agent: null) is assigned to NOBODY, so it matches no agent's
// filter. The explicit null checks matter — plain String() comparison would
// make String(null) === String(null) true and wrongly hand every unassigned
// property to a caller with no id.
const applyFilter = (filter) => fixtures
  .filter((p) => p.agent != null && filter.agent != null && String(p.agent) === String(filter.agent))
  .map((p) => p._id)
  .join(',')

check('Agent A sees only their own', applyFilter(buildPropertyFilter({ user: agentA })), 'p1,p3')
check('Agent B sees only their own', applyFilter(buildPropertyFilter({ user: agentB })), 'p2')
check('unassigned properties belong to nobody', applyFilter(buildPropertyFilter({ user: { _id: null } })), '')

// The key property: the filter is built from req.user alone, so nothing a
// client sends can widen or redirect it.
check(
  'query agentId cannot override identity',
  buildPropertyFilter({ user: agentA, query: { agent: 'ag2' }, body: { agent: 'ag2' }, params: { agent: 'ag2' } }).agent,
  'ag1'
)
check(
  'Agent B cannot reach Agent A rows via the body',
  applyFilter(buildPropertyFilter({ user: agentB, body: { agent: 'ag1' } })),
  'p2'
)

console.log('\n== the agent portal API surface is one route ==')
// Agent-scoped ownership views belong under /api/agent. Human messaging will
// NOT: conversations are authorised by participation and shared with the
// mobile app, so they get a participant-based route both clients call.
const agentRouter = (await import('../routes/agent.js')).default
const agentPaths = agentRouter.stack.filter((l) => l.route).map((l) => l.route.path)
check('exposes /properties', agentPaths.includes('/properties'), true)
check('exposes nothing else yet', agentPaths.length, 1)

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
