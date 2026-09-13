// Run alone: mutations temporarily change dirty files and restore exact bytes.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cases = [
  ['schema field removed', 'backend/models/TeamMember.js', s => s.replace(/^  workSections:.*\r?\n/m, ''), 'backend', 'tests/teamWork.test.js'],
  ['route work persistence removed', 'backend/utils/teamWork.js', s => s.replace('  return out\n}', '  delete out.workSections; return out\n}').replace('  return out\r\n}', '  delete out.workSections; return out\r\n}'), 'backend', 'tests/teamRichProfile.test.js'],
  ['public work rendering removed', 'frontend/src/pages/TeamPage.jsx', s => s.replace('sections={sections} files={files}', 'sections={[]} files={[]}'), 'frontend', 'tests/teamWork.test.js'],
  ['legacy optional array guard removed', 'frontend/src/lib/teamWork.js', s => s.replace(/^const list = .*$/m, 'const list = value => value.filter(Boolean)'), 'frontend', 'tests/teamWork.test.js'],
  ['rich prose AutoGrowTextarea removed', 'frontend/src/components/TeamWorkEditor.jsx', s => s.replaceAll('<AutoGrowTextarea', '<textarea'), 'frontend', 'tests/teamWork.test.js'],
  ['Mixed localization replaced with strict schema', 'backend/models/teamWorkSchemas.js', s => s.replace('...localizedField()', 'type: new mongoose.Schema({ en: String, tr: String })'), 'backend', 'tests/teamWork.test.js'],
  ['malformed work array accepted', 'backend/utils/teamWork.js', s => s.replace("const out = pick(body, allowed)", "const out = pick(body, allowed); if (out.workSections && !Array.isArray(out.workSections)) delete out.workSections"), 'backend', 'tests/teamRichProfile.test.js'],
  ['shared Showroom crop confirmation broken', 'frontend/src/components/ImageCropModal.jsx', s => s.replace('await onConfirm(result.blob', 'await onCancel(result.blob'), 'frontend', 'tests/showroomCrop.test.js'],
]
for (const [name, file, mutate, cwd, test] of cases) {
  const path = resolve(root, file)
  const original = readFileSync(path)
  const changed = mutate(original.toString('utf8'))
  assert.notEqual(changed, original.toString('utf8'), `Mutation did not apply: ${name}`)
  let result
  try {
    writeFileSync(path, changed)
    result = spawnSync(process.execPath, [...(cwd === 'backend' ? ['--experimental-test-module-mocks'] : []), '--test', test], { cwd: resolve(root, cwd), encoding: 'utf8', timeout: 60000 })
  } finally {
    writeFileSync(path, original)
    assert.deepEqual(readFileSync(path), original, `Restore failed: ${name}`)
  }
  assert.equal(result.error, undefined, `Runner failed: ${name}`)
  assert.notEqual(result.status, 0, `Sabotage escaped detection: ${name}`)
  assert.match(result.stdout, /not ok/, `No failing test: ${name}`)
  console.log(`DETECTED and RESTORED: ${name}`)
}
console.log(`${cases.length}/${cases.length} mutations detected; all original bytes restored.`)
