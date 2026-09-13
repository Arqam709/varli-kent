// Run explicitly with no other tests/builds editing these files concurrently.
// Every mutation is restored byte-for-byte in finally, including dirty files.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../../', import.meta.url))
const frontendTests = ['tests/showroomCrop.test.js', 'tests/autoGrowTextarea.contract.test.js', 'tests/adminShowroomModal.contract.test.js']
const cases = [
  ['crop URL schema persistence', 'backend/models/ShowroomImage.js', s => s.replace(/^  cropUrl:.*\r?\n/m, ''), 'backend', ['tests/showroomCrop.test.js']],
  ['original overwritten by crop', 'frontend/src/lib/imageCrop.js', s => s.replace('url: result.originalUrl || form.url', 'url: result.cropUrl'), 'frontend', frontendTests],
  ['legacy lightbox fallback removed', 'frontend/src/components/ShowroomCarousel.jsx', s => s.replace('src={item.cropUrl || item.url}', 'src={item.cropUrl}'), 'frontend', frontendTests],
  ['AutoGrowTextarea removed', 'frontend/src/pages/AdminShowroom.jsx', s => s.replaceAll('<AutoGrowTextarea', '<textarea'), 'frontend', frontendTests],
  ['viewport modal bound removed', 'frontend/src/pages/AdminShowroom.jsx', s => s.replaceAll('max-h-[90dvh]', ''), 'frontend', frontendTests],
  ...['react-image-crop', 'socket.io-client'].map(name => [name + ' removed', 'frontend/package.json', s => {
    const pkg = JSON.parse(s); delete pkg.dependencies[name]; return JSON.stringify(pkg)
  }, 'frontend', frontendTests]),
  ['zero crop accepted', 'frontend/src/lib/imageCrop.js', s => s.replace('crop.width <= 0 || crop.height <= 0', 'crop.width < 0 || crop.height < 0').replace('if (right - x < 1 || bottom - y < 1)', 'if (false)'), 'frontend', frontendTests],
]

let caught = 0
for (const [name, relativePath, mutate, cwd, tests] of cases) {
  const path = resolve(root, relativePath)
  const original = readFileSync(path)
  const changed = mutate(original.toString('utf8'))
  assert.notEqual(changed, original.toString('utf8'), `Mutation did not apply: ${name}`)
  let result
  try {
    writeFileSync(path, changed)
    result = spawnSync(process.execPath, ['--test', ...tests], { cwd: resolve(root, cwd), encoding: 'utf8', timeout: 30000 })
  } finally {
    writeFileSync(path, original)
    assert.deepEqual(readFileSync(path), original, `Restore failed: ${name}`)
  }
  assert.equal(result.error, undefined, `Test runner failed: ${name}`)
  assert.notEqual(result.status, 0, `Sabotage escaped detection: ${name}`)
  assert.match(result.stdout, /not ok/, `No failing assertion: ${name}`)
  caught++
  console.log(`DETECTED and RESTORED: ${name}`)
}
console.log(`${caught}/${cases.length} mutations detected; all original bytes restored.`)
