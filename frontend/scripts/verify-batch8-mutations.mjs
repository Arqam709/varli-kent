// Batch 8 mutation verifier. All mutations are applied to in-memory test reads
// and Vite loads (tests/batch8Mutations.js); production files are never written.
// Run from frontend: node scripts/verify-batch8-mutations.mjs [contract|browser]
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { argv, env, execPath } from 'node:process'

const paths = ['src/components/AIChatbot.jsx', 'src/components/PropertyMapView.jsx', 'src/contexts/ChatContext.jsx', 'src/pages/PropertyDetailsPage.jsx']
const hashes = () => paths.map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'))
const before = hashes()
const only = argv[2]
const cases = [
  ['drop-trash-def', 'every JSX component', 'contract'],
  ['direct-fetch', 'sends only through ChatContext', 'contract'],
  ['guest-visible', 'logged-in only', 'contract'],
  ['drop-shown-ids', 'Show More context', 'contract'],
  ['rtl-ar-only', 'direction and date locale', 'contract'],
  ['green-fill', 'theme-aware', 'contract'],
  ['drop-scroll', 'theme-aware', 'contract'],
  ['fixed-header', 'theme-aware', 'contract'],
  ['approx-map', 'approximate location can never', 'contract'],
  ['agent-strings', 'Property.agent', 'contract'],
  ['race', 'Property.agent', 'contract'],
  ['drop-trash-def', 'history and deletion', 'browser'],
  ['direct-fetch', 'send flow', 'browser'],
  ['drop-shown-ids', 'send flow', 'browser'],
  ['drop-scroll', 'send flow', 'browser'],
  ['guest-visible', 'anonymous visitors', 'browser'],
  ['rtl-ar-only', 'direction follows', 'browser'],
  ['green-fill', 'theme brand token', 'browser'],
  ['approx-map', 'approximate listing never', 'browser'],
  ['drop-thumb-scroll', 'exact listing', 'browser'],
  ['fixed-header', 'header follows theme', 'browser'],
  ['race', 'slow earlier', 'browser'],
].filter(([, , kind]) => !only || kind === only)

let failed = false, resource = false
for (const [mutation, pattern, kind] of cases) {
  const file = kind === 'contract' ? 'tests/batch8ChatPropertyDetails.contract.test.js' : 'tests/browser/batch8ChatPropertyDetails.test.js'
  const result = spawnSync(execPath, ['--test', '--test-name-pattern=' + pattern, file], {
    env: { ...env, RAYON_NUM_THREADS: '1', BATCH8_MUTATION: mutation },
    encoding: 'utf8', timeout: 240000,
  })
  const output = (result.stdout || '') + (result.stderr || '')
  if (/memory allocation|insufficient system resources|ERR_CONNECTION_RESET|ENOMEM/i.test(output)) {
    console.log(`${kind} ${mutation}: RESOURCE FAIL`); resource = true; break
  }
  // A crash is not a detected regression: require a real assertion failure.
  const caught = result.status !== 0 && /ERR_ASSERTION|ERR_TEST_FAILURE/.test(output) &&
    /AssertionError|expect\(locator\)|expect\.poll|Expected values|Expected:|toHaveCount|toBeVisible|toHaveCSS|toHaveAttribute/.test(output) &&
    !/hookFailed/.test(output)
  console.log(`${kind} ${mutation}: ${caught ? 'DETECTED' : 'NOT VERIFIED'}`)
  if (!caught) { console.log(output.slice(-4000)); failed = true }
  if (JSON.stringify(before) !== JSON.stringify(hashes())) throw new Error('Production bytes changed')
}
console.log('Monitored production files remain byte-for-byte unchanged.')
if (resource) throw new Error('Resource failure — not a code verdict')
if (failed) throw new Error('One or more mutation checks were not verified')
