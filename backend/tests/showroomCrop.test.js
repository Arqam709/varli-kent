import test from 'node:test'
import assert from 'node:assert/strict'
import ShowroomImage from '../models/ShowroomImage.js'
import { normalizeShowroomCrop } from '../utils/showroomCrop.js'

const metadata = { width: 1000, height: 800, cropUrl: 'https://example.com/crop.jpg', cropWidth: 400, cropHeight: 300 }
const original = { serviceType: 'architecture', url: 'https://example.com/original.jpg', caption: 'Legacy caption' }

test('real schema persists all five crop fields and preserves original and Mixed localization', () => {
  const item = new ShowroomImage({ ...original, ...metadata })
  assert.equal(item.validateSync(), undefined)
  const data = item.toObject()
  for (const [key, value] of Object.entries(metadata)) assert.equal(data[key], value)
  assert.equal(data.url, original.url)
  assert.equal(data.caption, original.caption)
  assert.equal(ShowroomImage.schema.path('caption').instance, 'Mixed')
  assert.equal(ShowroomImage.schema.path('title').instance, 'Mixed')
  assert.equal(ShowroomImage.schema.path('detailText').instance, 'Mixed')
})
test('legacy schema document needs no migration or backfill', () => {
  const item = new ShowroomImage(original)
  assert.equal(item.validateSync(), undefined)
  assert.equal(item.cropUrl, '')
  for (const key of ['width', 'height', 'cropWidth', 'cropHeight']) assert.equal(item[key], 0)
})
test('schema rejects negative, fractional, non-finite, oversized crop dimensions and non-http crop URLs', () => {
  for (const change of [{ width: -1 }, { height: 1.5 }, { cropWidth: Infinity }, { cropHeight: 4097 }, { cropUrl: 'blob:temporary' }]) {
    assert.ok(new ShowroomImage({ ...original, ...metadata, ...change }).validateSync())
  }
})
test('metadata survives a partial visibility update without changing localized content', () => {
  const data = normalizeShowroomCrop({ visible: false }, { ...original, ...metadata })
  for (const [key, value] of Object.entries(metadata)) assert.equal(data[key], value)
  assert.equal(data.visible, false)
  assert.equal(data.caption, undefined)
  assert.equal(data.url, undefined)
})
test('replacing original without a new crop resets stale dimensions and crop URL', () => {
  const result = normalizeShowroomCrop({ url: 'https://example.com/new.jpg' }, { ...original, ...metadata })
  assert.equal(result.cropUrl, '')
  for (const key of ['width', 'height', 'cropWidth', 'cropHeight']) assert.equal(result[key], 0)
})
test('invalid crop URL/dimensions and video crops produce 400', () => {
  for (const change of [{ cropWidth: 0 }, { cropHeight: -1 }, { cropHeight: 1.2 }, { cropWidth: 4097 }, { width: 100 }, { cropUrl: 'https://' }, { cropUrl: 'data:image/png,x' }, { cropUrl: 'https://user:pass@example.com/a' }, { width: null }, { height: '800' }, { url: 'https://example.com/video/a.mp4' }]) {
    assert.throws(() => normalizeShowroomCrop({ ...original, ...metadata, ...change }), error => error.status === 400)
  }
})
test('removing crop clears its dimensions but retains original dimensions', () => {
  const result = normalizeShowroomCrop({ cropUrl: '' }, { ...original, ...metadata })
  assert.equal(result.width, 1000)
  assert.equal(result.height, 800)
  assert.equal(result.cropWidth, 0)
  assert.equal(result.cropHeight, 0)
})
