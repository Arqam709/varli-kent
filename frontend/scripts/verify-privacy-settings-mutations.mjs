// All mutations are applied to in-memory test reads/Vite loads, never source files.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { env, execPath } from 'node:process'

const paths = ['src/components/PrivacyBanner.jsx', 'src/pages/SettingsPage.jsx', 'src/locales/translations.js', 'src/App.jsx', 'src/contexts/LanguageContext.jsx']
const hashes = () => paths.map(path => createHash('sha256').update(readFileSync(path)).digest('hex'))
const before = hashes()
const cases = [
  ['unprotect-settings', 'real settings route', 'contract'],
  ['duplicate-storage', 'context-owned preferences', 'contract'],
  ['remove-rtl', 'canonical RTL state', 'contract'],
  ['no-persist', 'privacy acknowledgement', 'browser'],
  ['no-hide', 'privacy acknowledgement', 'browser'],
  ['no-scrollbar', 'policy reader scrolls', 'browser'],
  ['no-escape', 'policy reader scrolls', 'browser'],
  ['english-only', 'six complete dictionaries', 'browser'],
]
let failed = false
for (const [mutation, pattern, kind] of cases) {
  const file = kind === 'contract' ? 'tests/privacySettings.contract.test.js' : 'tests/browser/privacySettings.test.js'
  const result = spawnSync(execPath, ['--test', '--test-name-pattern=' + pattern, file], {
    env: { ...env, RAYON_NUM_THREADS: '1', BATCH5_MUTATION: mutation },
    encoding: 'utf8', timeout: 90000,
  })
  const output = result.stdout + result.stderr
  // Crashes/resource failures do not count as detected regressions.
  const caught = result.status !== 0 && /ERR_ASSERTION|ERR_TEST_FAILURE/.test(output) &&
    /AssertionError|expect\(locator\)|Expected values|Expected:|assert\./.test(output) &&
    !/hookFailed|memory allocation|insufficient system resources|ERR_CONNECTION_RESET/i.test(output)
  console.log(mutation + ': ' + (caught ? 'DETECTED' : 'NOT VERIFIED'))
  if (!caught) { console.log(output); failed = true; break }
  if (JSON.stringify(before) !== JSON.stringify(hashes())) throw new Error('Production bytes changed')
  if (/memory allocation|insufficient system resources|ERR_CONNECTION_RESET/i.test(output)) break
}
console.log('All five monitored production files remain byte-for-byte unchanged.')
if (failed) throw new Error('One or more mutation checks were not verified')