import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyShowroomCrop, cropBounds, cropToBlob, emptyCrop } from '../src/lib/imageCrop.js'
import { imageCropLabels } from '../src/locales/imageCrop.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const image = { naturalWidth: 1000, naturalHeight: 500 }
const selection = { unit: '%', x: 10, y: 10, width: 80, height: 80 }

test('percent crop is independent of rendered size and zoom', () => {
  for (const width of [200, 500, 2000]) assert.deepEqual(cropBounds({ ...image, width }, selection), { x: 100, y: 50, width: 800, height: 400 })
})
test('out-of-bounds selection is clipped to the source image', () => {
  assert.deepEqual(cropBounds(image, { unit: '%', x: -20, y: 90, width: 200, height: 50 }), { x: 0, y: 450, width: 1000, height: 50 })
})
test('zero, non-finite, outside, negative, and subpixel crops are rejected', () => {
  for (const change of [{ width: 0 }, { height: -1 }, { x: 101 }, { y: Infinity }, { width: NaN }, { width: 0.00001 }, { unit: 'px' }]) {
    assert.throws(() => cropBounds(image, { ...selection, ...change }), /Invalid crop/)
  }
  assert.throws(() => cropBounds({ naturalWidth: 0, naturalHeight: 0 }, selection))
})
test('canvas produces a JPEG blob with actual output dimensions, bounded allocation', async () => {
  const originalDocument = globalThis.document
  const draws = []
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
  const canvas = { getContext: () => ({ fillRect() {}, drawImage(...args) { draws.push(args) } }), toBlob(callback, type) { assert.equal(type, 'image/jpeg'); callback(blob) } }
  globalThis.document = { createElement: () => canvas }
  try {
    const result = await cropToBlob({ naturalWidth: 20000, naturalHeight: 10000 }, selection)
    assert.deepEqual(result, { blob, width: 4096, height: 2048 })
    assert.deepEqual(draws[0].slice(1, 5), [2000, 1000, 16000, 8000])
    canvas.toBlob = callback => callback(null)
    await assert.rejects(cropToBlob(image, selection), /encoding failed/)
    canvas.getContext = () => null
    await assert.rejects(cropToBlob(image, selection), /Canvas unavailable/)
  } finally { globalThis.document = originalDocument }
})
test('recrop preserves original and localized content without mutating the existing form', () => {
  const form = Object.freeze({ ...emptyCrop, url: 'original.jpg', width: 1000, height: 500, caption: { tr: 'Ev', sourceLang: 'tr' } })
  const result = applyShowroomCrop(form, { cropUrl: 'crop.jpg', cropWidth: 300, cropHeight: 200 })
  assert.equal(result.url, form.url)
  assert.equal(result.caption, form.caption)
  assert.equal(result.width, 1000)
  assert.equal(result.cropUrl, 'crop.jpg')
  assert.equal(form.cropUrl, '')
  assert.throws(() => applyShowroomCrop(form, { cropUrl: '', cropWidth: 0, cropHeight: 0 }))
})
test('fresh upload keeps two distinct URLs and original dimensions', () => {
  const result = applyShowroomCrop({ ...emptyCrop, url: 'old.jpg' }, { originalUrl: 'new.jpg', cropUrl: 'crop.jpg', cropWidth: 400, cropHeight: 300, width: 1200, height: 800 })
  assert.equal(result.url, 'new.jpg')
  assert.equal(result.cropUrl, 'crop.jpg')
  assert.equal(result.width, 1200)
  assert.equal(result.cropWidth, 400)
})
test('crop dependency and realtime dependency both remain in manifest and lock', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  const lock = JSON.parse(await read('../package-lock.json'))
  for (const name of ['react-image-crop', 'socket.io-client']) {
    assert.ok(pkg.dependencies[name])
    assert.equal(pkg.dependencies[name], lock.packages[''].dependencies[name])
    assert.ok(lock.packages[`node_modules/${name}`])
  }
})
test('crop modal confirms only after encoding, awaits upload, and cancel has no result mutation', async () => {
  const src = await read('../src/components/ImageCropModal.jsx')
  assert.match(src, /react-image-crop\/dist\/ReactCrop.css/)
  assert.match(src, /await cropToBlob\(image, crop\)/)
  assert.match(src, /await onConfirm\(result.blob, result.width, result.height/)
  const cancel = src.match(/const cancel = \(\) => \{([\s\S]*?)\n  \}/)[1]
  assert.match(cancel, /onCancel\(\)/)
  assert.doesNotMatch(cancel, /onConfirm|setCrop|fetch|api\./)
  assert.match(src, /key=\{props.imageSrc\}/)
  assert.match(src, /disabled=\{processing \|\| !valid\}/)
})
test('showroom uses existing uploads, preserves original on recrop, and releases object URLs', async () => {
  const src = await read('../src/pages/AdminShowroom.jsx')
  assert.match(src, /URL.revokeObjectURL\(cropSession.src\)/)
  assert.match(src, /src: form.url, file: null/)
  assert.match(src, /applyShowroomCrop\(f,/)
  assert.match(src, /cropUrl: cropResult.data.url, cropWidth, cropHeight/)
  assert.match(src, /originalUrl: originalResult\?\.data.url/)
  assert.match(src, /version !== editorVersion.current/)
  assert.match(src, /api.post\('\/upload', cropFd/)
  assert.match(src, /onCancel=\{\(\) => setCropSession\(null\)\}/)
})
test('lightbox selects crop with legacy fallback; thumbnails and videos retain original', async () => {
  const src = await read('../src/components/ShowroomCarousel.jsx')
  assert.match(src, /src=\{item.cropUrl \|\| item.url\}/)
  assert.match(src, /<video src=\{item.url\}/)
  assert.match(src, /src=\{img.url\}/)
  assert.doesNotMatch(src, /src=\{img.cropUrl/)
  const expression = src.match(/src=\{(item.cropUrl \|\| item.url)\}/)[1]
  const getUrl = new Function('item', `return ${expression}`)
  assert.equal(getUrl({ url: 'original' }), 'original')
  assert.equal(getUrl({ url: 'original', cropUrl: 'crop' }), 'crop')
})
test('crop labels cover all six languages', () => {
  const english = imageCropLabels('en')
  for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    const labels = imageCropLabels(lang)
    assert.deepEqual(Object.keys(labels), Object.keys(english))
    assert.ok(Object.values(labels).every(value => typeof value === 'string' && value.length > 0))
    if (lang !== 'en') assert.notEqual(labels.title, english.title)
  }
})
