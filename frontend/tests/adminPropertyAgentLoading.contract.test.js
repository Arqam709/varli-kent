// Contract: the Assigned Agent dropdown on the admin property editor.
//
// The bug this pins: the agent list used to be fetched ONCE when the Properties
// page mounted, and any failure was swallowed into an empty list. An account
// promoted to agent after the page loaded — or a request that failed while the
// backend was restarting — left the dropdown showing only "Unassigned" until a
// full page reload, with nothing on screen saying why.
//
// Run: node --test tests/adminPropertyAgentLoading.contract.test.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(resolve(root, 'src/pages/AdminProperties.jsx'), 'utf8')

// Body of `const name = (...) => { ... }` / `async (...) => { ... }`, by brace matching.
const functionBody = (name) => {
  const start = src.indexOf(`const ${name} = `)
  assert.ok(start !== -1, `${name} must exist`)
  const open = src.indexOf('{', src.indexOf('=>', start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const agentSelect = () => {
  const label = src.indexOf("p.assignedAgent || 'Assigned Agent'")
  assert.ok(label !== -1, 'Assigned Agent label must exist')
  const end = src.indexOf('</select>', label)
  return src.slice(label, end)
}

test('agents are loaded from the real endpoint and read from r.data.agents', () => {
  const body = functionBody('loadAgents')
  assert.match(body, /api\.get\('\/users\/agents'\)/)
  assert.match(body, /r\.data\?\.agents \|\| \[\]/)
  assert.match(body, /setAgents\(/)
})

test('opening the editor (add AND edit) refetches the agent list', () => {
  assert.match(functionBody('openAdd'), /loadAgents\(\)/)
  assert.match(functionBody('openEdit'), /loadAgents\(\)/)
})

test('the list is no longer a one-shot mount effect', () => {
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*api\.get\('\/users\/agents'\)/)
})

test('a failed load is surfaced, never silently turned into an empty list', () => {
  const body = functionBody('loadAgents')
  assert.doesNotMatch(src, /\.catch\(\(\) => setAgents\(\[\]\)\)/)
  assert.match(body, /catch\s*\{[\s\S]*toast\.error\(p\.agentsLoadError \|\| '[^']+'\)/)
  assert.match(body, /setAgentsStatus\('error'\)/)
  assert.doesNotMatch(body.slice(body.indexOf('catch')), /setAgents\(/, 'a failure keeps the last good list')
})

test('a slower, older response cannot overwrite a newer one', () => {
  const body = functionBody('loadAgents')
  assert.match(body, /const requestId = \+\+agentsRequest\.current/)
  assert.equal((body.match(/requestId !== agentsRequest\.current/g) || []).length, 2)
})

test('every loaded agent renders as an option keyed and valued by its _id', () => {
  const select = agentSelect()
  assert.match(select, /<option value="">\{p\.unassigned \|\| 'Unassigned'\}<\/option>/)
  assert.match(select, /agents\.map\(a => <option key=\{a\._id\} value=\{a\._id\}>\{a\.name\}<\/option>\)/)
  assert.doesNotMatch(select, /agents\.filter\(/, 'the server already filters; the client must not drop agents')
})

test('selecting an agent stores its id in form.agent', () => {
  assert.match(agentSelect(), /value=\{form\.agent\} onChange=\{e => handleAgentChange\(e\.target\.value\)\}/)
  assert.match(functionBody('handleAgentChange'), /agent: nextAgentId/)
})

test('edit mode normalises a populated or raw agent reference to its id', () => {
  assert.match(src, /const agentIdOf = \(agent\) => \(agent && typeof agent === 'object' \? agent\._id : agent\) \|\| ''/)
  assert.match(functionBody('openEdit'), /agent: agentIdOf\(prop\.agent\)/)
})

test('an assigned agent is not called inactive before the list has loaded', () => {
  const select = agentSelect()
  assert.match(select, /agentsStatus === 'ready' \? 'Currently assigned — no longer an active agent' : 'Currently assigned agent'/)
})

test('save sends the real relationship: the agent id, or null to unassign', () => {
  assert.match(src, /agent: form\.agent \|\| null/)
  assert.doesNotMatch(src, /agentName:\s*form\./, 'no donor-style free-text agent name')
})
