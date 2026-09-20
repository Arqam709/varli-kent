// The room photo pipeline against real, generated images and real sharp.

import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  normalizeRoomPhoto,
  processingLoad,
  RoomPhotoError,
  sniffImageFormat,
} from '../services/designRoomPhotos/imagePipeline.js'
import {
  ROOM_PHOTO_MAX_INPUT_PIXELS,
  ROOM_PHOTO_MAX_LONG_EDGE,
  ROOM_PHOTO_MAX_QUEUED_PROCESSING,
  ROOM_PHOTO_MIN_SHORT_EDGE,
} from '../config/designRoomPhotos.js'
import * as fixtures from './helpers/roomPhotoFixtures.js'

const rejectsWith = async (buffer, code) => {
  await assert.rejects(normalizeRoomPhoto(buffer), (err) => {
    assert.ok(err instanceof RoomPhotoError, `expected RoomPhotoError, got ${err}`)
    assert.equal(err.code, code)
    return true
  })
}

/* ═══════════════ Accepted inputs ═══════════════ */

test('a valid JPEG becomes a normalized JPEG with measured dimensions', async () => {
  const result = await normalizeRoomPhoto(await fixtures.jpeg(1600, 1200))
  const meta = await sharp(result.buffer).metadata()

  assert.equal(result.format, 'jpg')
  assert.equal(meta.format, 'jpeg')
  assert.deepEqual([result.width, result.height], [1600, 1200])
  assert.deepEqual([meta.width, meta.height], [1600, 1200])
  assert.equal(result.bytes, result.buffer.length)
})

test('PNG (with transparency) and WebP are accepted and re-encoded as opaque sRGB JPEG', async () => {
  for (const input of [await fixtures.png(1200, 900, { alpha: true }), await fixtures.webp(1200, 900)]) {
    const result = await normalizeRoomPhoto(input)
    const meta = await sharp(result.buffer).metadata()
    assert.equal(meta.format, 'jpeg')
    assert.equal(meta.channels, 3, 'alpha survived into a JPEG')
    assert.equal(meta.space, 'srgb')
  }
})

test('the output is new bytes, never the uploaded original', async () => {
  const original = await fixtures.jpeg(1600, 1200)
  const result = await normalizeRoomPhoto(original)
  assert.equal(result.buffer.equals(original), false)
})

/* ═══════════════ Processing ═══════════════ */

test('EXIF, GPS, XMP and the ICC profile are all removed; colour becomes sRGB', async () => {
  const input = await fixtures.jpegWithPrivateMetadata()
  const before = await sharp(input).metadata()
  // The fixture really carries what we claim to strip.
  assert.ok(before.exif?.includes(fixtures.GPS_IFD_POINTER_TAG), 'fixture has no GPS IFD')
  assert.ok(before.xmp && before.icc, 'fixture has no XMP or ICC profile')

  const result = await normalizeRoomPhoto(input)
  const after = await sharp(result.buffer).metadata()

  assert.equal(after.exif, undefined, 'EXIF (and with it GPS) survived')
  assert.equal(after.xmp, undefined, 'XMP survived')
  assert.equal(after.icc, undefined, 'the ICC profile survived')
  assert.equal(after.iptc, undefined, 'IPTC survived')
  assert.equal(after.space, 'srgb')
  assert.equal(result.buffer.includes(Buffer.from('Fixture Author')), false, 'author text is still in the bytes')
})

test('EXIF orientation is applied to the pixels before the tag is dropped', async () => {
  const input = await fixtures.jpegWithOrientation6(1200, 800)
  assert.equal((await sharp(input).metadata()).orientation, 6)

  const result = await normalizeRoomPhoto(input)
  const meta = await sharp(result.buffer).metadata()

  // Stored 1200×800 landscape, displayed rotated: the output is upright portrait.
  assert.deepEqual([result.width, result.height], [800, 1200])
  assert.equal(meta.orientation, undefined)
})

test('an oversized photo is constrained to the maximum long edge, keeping its aspect ratio', async () => {
  const result = await normalizeRoomPhoto(await fixtures.jpeg(4000, 3000))
  assert.deepEqual([result.width, result.height], [ROOM_PHOTO_MAX_LONG_EDGE, 1536])

  const portrait = await normalizeRoomPhoto(await fixtures.jpeg(2400, 3200))
  assert.deepEqual([portrait.width, portrait.height], [1536, ROOM_PHOTO_MAX_LONG_EDGE])
})

test('a photo within limits is never enlarged', async () => {
  const result = await normalizeRoomPhoto(await fixtures.jpeg(900, ROOM_PHOTO_MIN_SHORT_EDGE))
  assert.deepEqual([result.width, result.height], [900, ROOM_PHOTO_MIN_SHORT_EDGE])
})

/* ═══════════════ Rejections ═══════════════ */

test('a text file is rejected however it is named — the bytes are what count', async () => {
  await rejectsWith(fixtures.textFile(), 'PHOTO_UNREADABLE')
})

test('SVG is rejected by signature, before any decoder sees it', async () => {
  assert.equal(sniffImageFormat(fixtures.svg()), null)
  await rejectsWith(fixtures.svg(), 'PHOTO_UNREADABLE')
})

test('a truncated JPEG is rejected', async () => {
  await rejectsWith(await fixtures.truncatedJpeg(), 'PHOTO_UNREADABLE')
})

test('recognised but unsupported formats get a precise answer', async () => {
  await rejectsWith(await fixtures.gif(), 'PHOTO_UNSUPPORTED_FORMAT')
  await rejectsWith(await fixtures.tiff(), 'PHOTO_UNSUPPORTED_FORMAT')
  await rejectsWith(fixtures.heicSignature(), 'PHOTO_UNSUPPORTED_FORMAT')
})

test('a header claiming enormous dimensions is rejected before decoding', async () => {
  const bomb = fixtures.pngClaimingDimensions(30000, 30000)
  assert.ok(bomb.length < 1024, 'the fixture should be tiny')
  assert.ok(30000 * 30000 > ROOM_PHOTO_MAX_INPUT_PIXELS)
  await rejectsWith(bomb, 'PHOTO_DIMENSIONS_TOO_LARGE')
})

test('a photo too small to be useful is rejected', async () => {
  await rejectsWith(await fixtures.jpeg(ROOM_PHOTO_MIN_SHORT_EDGE + 400, ROOM_PHOTO_MIN_SHORT_EDGE - 1), 'PHOTO_TOO_SMALL')
})

test('panoramas and narrow strips are rejected', async () => {
  await rejectsWith(await fixtures.jpeg(3100, 1000), 'PHOTO_ASPECT_RATIO')
  await rejectsWith(await fixtures.jpeg(600, 1900), 'PHOTO_ASPECT_RATIO')
  // Exactly 3:1 is still allowed.
  await normalizeRoomPhoto(await fixtures.jpeg(1800, 600))
})

test('an empty or missing buffer is rejected', async () => {
  await rejectsWith(Buffer.alloc(0), 'PHOTO_REQUIRED')
  await rejectsWith(undefined, 'PHOTO_REQUIRED')
})

test('the signature and the decoded format must agree', async () => {
  // A PNG signature glued onto JPEG data.
  const jpegBytes = await fixtures.jpeg()
  const forged = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpegBytes])
  await rejectsWith(forged, 'PHOTO_UNREADABLE')
})

/* ═══════════════ Processing slots ═══════════════ */

test('only one image decodes at a time, a short queue waits, and overflow gets 503', async () => {
  const input = await fixtures.jpeg(4000, 3000)
  const attempts = Array.from({ length: 1 + ROOM_PHOTO_MAX_QUEUED_PROCESSING + 2 }, () =>
    normalizeRoomPhoto(input).then(() => 'ok', (err) => err.code))

  const outcomes = await Promise.all(attempts)
  assert.equal(outcomes.filter((o) => o === 'ok').length, 1 + ROOM_PHOTO_MAX_QUEUED_PROCESSING)
  assert.deepEqual(outcomes.filter((o) => o !== 'ok'), ['ROOM_PHOTO_BUSY', 'ROOM_PHOTO_BUSY'])
  assert.deepEqual(processingLoad(), { active: 0, waiting: 0 }, 'a slot leaked')
})

test('a failing image releases its slot', async () => {
  await rejectsWith(await fixtures.truncatedJpeg(), 'PHOTO_UNREADABLE')
  assert.deepEqual(processingLoad(), { active: 0, waiting: 0 })
})
