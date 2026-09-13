// In-memory Vite mutations: production files are never written.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { env, execPath } from 'node:process'
const paths = ['src/index.css', 'src/components/AdminLayout.jsx', 'src/components/Navbar.jsx']
const hashes = () => paths.map(path => createHash('sha256').update(readFileSync(path)).digest('hex'))
const before = hashes()
const cases = [
  ['remove-scrollbar', 'admin scrolling'],
  ['remove-admin-usage', 'admin scrolling'],
  ['remove-desktop-reset', 'desktop language panel'],
  ['remove-mobile-reset', 'mobile scroll,'],
  ['restore-fixed-accent', 'navbar and selection'],
  ['drop-agent-portal', 'desktop and mobile keep'],
  ['global-scrollbar', 'navbar and selection'],
]
let failed = false
for (const [mutation, pattern] of cases) {
  const result = spawnSync(execPath, ['--test', '--test-name-pattern=' + pattern, 'tests/browser/globalLayout.test.js'], {
    env: { ...env, RAYON_NUM_THREADS: '1', BATCH4_MUTATION: mutation },
    encoding: 'utf8', timeout: 90000,
  })
  // A startup crash is NOT a killed mutation: require an actual assertion failure.
  const caught = result.status !== 0 && /ERR_ASSERTION|ERR_TEST_FAILURE/.test(result.stdout) &&
    /expect\(locator\)|AssertionError|scrollbar must|public body/.test(result.stdout)
  console.log(mutation + ': ' + (caught ? 'DETECTED' : 'NOT VERIFIED'))
  if (!caught) { console.log(result.stdout, result.stderr); failed = true }
}
if (JSON.stringify(before) !== JSON.stringify(hashes())) throw new Error('Production bytes changed')
console.log('All three production files remain byte-for-byte unchanged.')
if (failed) throw new Error('One or more mutation checks were not verified')
