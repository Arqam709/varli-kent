import sharp from 'sharp'
import {
  ROOM_PHOTO_ACCEPTED_FORMATS,
  ROOM_PHOTO_JPEG_QUALITY,
  ROOM_PHOTO_MAX_ACTIVE_PROCESSING,
  ROOM_PHOTO_MAX_ASPECT_RATIO,
  ROOM_PHOTO_MAX_INPUT_PIXELS,
  ROOM_PHOTO_MAX_LONG_EDGE,
  ROOM_PHOTO_MAX_QUEUED_PROCESSING,
  ROOM_PHOTO_MIN_SHORT_EDGE,
  ROOM_PHOTO_OUTPUT_FORMAT,
} from '../../config/designRoomPhotos.js'


sharp.cache(false)

export class RoomPhotoError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'RoomPhotoError'
    this.code = code
    this.status = status
  }
}

const rejected = {
  missing: () => new RoomPhotoError('PHOTO_REQUIRED', 'A room photo is required.'),
  unreadable: () => new RoomPhotoError('PHOTO_UNREADABLE', 'This file is not a readable image.'),
  unsupported: () => new RoomPhotoError('PHOTO_UNSUPPORTED_FORMAT', 'Please use a JPEG, PNG or WebP photo.'),
  tooManyPixels: () => new RoomPhotoError('PHOTO_DIMENSIONS_TOO_LARGE', 'This photo\'s dimensions are too large.'),
  tooSmall: () => new RoomPhotoError('PHOTO_TOO_SMALL', 'This photo is too small to use for a room.'),
  aspect: () => new RoomPhotoError('PHOTO_ASPECT_RATIO', 'Please use a normal photo of the room, not a panorama or narrow strip.'),
}

//does the first byte of the file match the jpeg signature ?
const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte)
const ascii = (text) => [...text].map((c) => c.charCodeAt(0))

export function sniffImageFormat(buffer) {
  if (buffer.length < 12) return null
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(buffer, ascii('RIFF')) && startsWith(buffer, ascii('WEBP'), 8)) return 'webp'
  // Recognised, so they get a precise "unsupported format" rather than "unreadable".
  if (startsWith(buffer, ascii('GIF8'))) return 'gif'
  if (startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (startsWith(buffer, ascii('ftyp'), 4)) return 'heif' // HEIC, HEIF and AVIF containers
  if (startsWith(buffer, ascii('BM'))) return 'bmp'
  return null
}


let active = 0
const waiting = []

async function withProcessingSlot(work) {
  if (active >= ROOM_PHOTO_MAX_ACTIVE_PROCESSING) {
    if (waiting.length >= ROOM_PHOTO_MAX_QUEUED_PROCESSING) {
      throw new RoomPhotoError('ROOM_PHOTO_BUSY', 'Photo processing is busy. Please try again in a moment.', 503)
    }
    await new Promise((resolve) => waiting.push(resolve))
  } else {
    active += 1
  }

  try {
    return await work()
  } finally {
    const next = waiting.shift()
    // The slot passes straight to the next waiter; `active` is unchanged.
    if (next) next()
    else active -= 1
  }
}

/** Test seam: how many requests hold or await a slot. */
export const processingLoad = () => ({ active, waiting: waiting.length })

/* ── The pipeline ──────────────────────────────────────────────────────── */

/**
 * Validates an uploaded room photo and returns a normalized JPEG.
 *
 * @param {Buffer} buffer the uploaded bytes, exactly as received
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, bytes: number, format: 'jpg' }>}
 * @throws {RoomPhotoError}
 */
export function normalizeRoomPhoto(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return Promise.reject(rejected.missing())

  const sniffed = sniffImageFormat(buffer)
  if (!sniffed) return Promise.reject(rejected.unreadable())
  if (!ROOM_PHOTO_ACCEPTED_FORMATS.includes(sniffed)) return Promise.reject(rejected.unsupported())

  return withProcessingSlot(() => normalize(buffer, sniffed))
}

async function normalize(buffer, sniffed) {
  const input = {
    // Refuse pixel data libvips reports as damaged, including truncation —
    // the setting sharp recommends for untrusted input.
    failOn: 'warning',
    // A second, decoder-level bound. It trusts header dimensions, which is
    // why the same limit is also checked explicitly below.
    limitInputPixels: ROOM_PHOTO_MAX_INPUT_PIXELS,
    // Only the first frame of any multi-frame file.
    pages: 1,
  }

  let metadata
  try {
    // Reads the header only; no pixel data is decoded here. The decoder pixel
    // limit is lifted for THIS call only, so an oversized header reaches the
    // explicit dimension check below and gets a precise answer instead of a
    // generic "unreadable". Nothing is decoded, so there is nothing to bound.
    metadata = await sharp(buffer, { limitInputPixels: false }).metadata()
  } catch {
    throw rejected.unreadable()
  }

  // The signature and the decoder must agree (e.g. a PNG header on JPEG data).
  if (metadata.format !== sniffed) throw rejected.unreadable()
  // Animated WebP/PNG are not photos of a room.
  if ((metadata.pages ?? 1) > 1) throw rejected.unsupported()

  const { width, height } = metadata

  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw rejected.unreadable()
  }

  // Header dimensions, before a single pixel is decoded: this is what stops a
  // small file that claims to be enormous.
  if (width * height > ROOM_PHOTO_MAX_INPUT_PIXELS) throw rejected.tooManyPixels()
  if (Math.min(width, height) < ROOM_PHOTO_MIN_SHORT_EDGE) throw rejected.tooSmall()
  if (Math.max(width, height) / Math.min(width, height) > ROOM_PHOTO_MAX_ASPECT_RATIO) throw rejected.aspect()

  try {
    const { data, info } = await sharp(buffer, input)
      // Rotates the pixels upright from the EXIF Orientation tag. Must happen
      // before re-encoding drops that tag, or the photo would turn sideways.
      .autoOrient()
      // Constrain the long edge; never upscale a photo that is already small.
      .resize({
        width: ROOM_PHOTO_MAX_LONG_EDGE,
        height: ROOM_PHOTO_MAX_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // JPEG has no transparency; composite any alpha onto white instead of black.
      .flatten({ background: '#ffffff' })
      // Wide-gamut (e.g. Display P3) and CMYK inputs become plain sRGB.
      .toColourspace('srgb')
      // Output metadata is empty by default: nothing from the input — EXIF
      // (including GPS), XMP, IPTC or the ICC profile — is copied. There is
      // deliberately no keepMetadata()/withMetadata() call here.
      .jpeg({ quality: ROOM_PHOTO_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true })

    return {
      buffer: data,
      width: info.width,
      height: info.height,
      bytes: data.length,
      format: ROOM_PHOTO_OUTPUT_FORMAT,
    }
  } catch (err) {
    if (err instanceof RoomPhotoError) throw err
    // Truncated or corrupt pixel data, or the decoder's own pixel limit.
    throw rejected.unreadable()
  }
}
