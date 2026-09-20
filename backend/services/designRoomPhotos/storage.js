// Private Cloudinary storage for room photos — the ONLY module that calls
// Cloudinary for this feature.
//
// Differences from the public admin media pipeline (routes/upload.js), on purpose:
//
//   routes/upload.js                      here
//   ─────────────────────────────────     ───────────────────────────────────────
//   type 'upload' (public forever)        type 'authenticated' (signed URL needed
//                                         for the original and every derivative)
//   random id in the shared folder        varlikent/<env>/design-room-photos/<photoId>
//   URL returned and stored in Mongo      nothing returned to clients; only the
//                                         public ID is stored, server-side
//   never deleted                         destroyed with cache invalidation
//
// Delivery: the backend builds a signed URL, fetches the image itself and
// streams the bytes to the owner. The signed URL never leaves this process and
// is never logged. Signed Cloudinary URLs do not expire on their own, so
// handing one to a client would create a permanent link; streaming avoids that
// on every Cloudinary plan.

import { Readable } from 'node:stream'
import cloudinary from '../../config/cloudinary.js'
import {
  ROOM_PHOTO_DELIVERY_TYPE,
  ROOM_PHOTO_OUTPUT_FORMAT,
  ROOM_PHOTO_STORAGE_TIMEOUT_MS,
  roomPhotoStorageEnvironment,
} from '../../config/designRoomPhotos.js'

const OBJECT_ID = /^[0-9a-f]{24}$/i

/**
 * The Cloudinary public ID for a room photo.
 *
 * Only the environment and the photo's own record id — no user id, name,
 * email, filename or room description. The id is unique per record, which
 * together with `overwrite: false` means an upload can never replace another
 * photo. It is not a secret either: without a signature it opens nothing.
 */
export function roomPhotoPublicId(photoId, env = process.env) {
  const id = String(photoId)
  if (!OBJECT_ID.test(id)) throw new Error('A room photo public ID needs a record ObjectId')
  return `varlikent/${roomPhotoStorageEnvironment(env)}/design-room-photos/${id}`
}

/** Thrown for any storage failure. Carries no URL, signature or credential. */
export class RoomPhotoStorageError extends Error {
  constructor(message, { notFound = false } = {}) {
    super(message)
    this.name = 'RoomPhotoStorageError'
    this.notFound = notFound
  }
}

/**
 * Uploads NORMALIZED JPEG bytes privately.
 *
 * Deliberately no `folder` option: the full path lives in `public_id`, which
 * Cloudinary honours identically in fixed-folder and dynamic-folder accounts,
 * so this does not depend on how the account is configured.
 */
export function uploadRoomPhoto(publicId, buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'image',
        type: ROOM_PHOTO_DELIVERY_TYPE,
        // Never replace an existing asset, even if an id were somehow reused.
        overwrite: false,
        // Our pipeline already produced a JPEG; nothing else is acceptable.
        allowed_formats: [ROOM_PHOTO_OUTPUT_FORMAT],
        // Lets the Cloudinary console identify these assets. No personal data.
        tags: ['design-room-photo'],
        timeout: ROOM_PHOTO_STORAGE_TIMEOUT_MS,
      },
      (error, result) => {
        if (error || !result) {
          // Cloudinary's message is not forwarded: it may echo request details.
          return reject(new RoomPhotoStorageError('Room photo upload to storage failed'))
        }
        // `overwrite: false` reports an existing asset as success rather than
        // an error. Treat it as a failure: that asset is not the one we sent.
        if (result.existing) {
          return reject(new RoomPhotoStorageError('A room photo already exists at this storage path'))
        }
        resolve({ publicId: result.public_id, bytes: result.bytes, format: result.format })
      }
    )
    stream.end(buffer)
  })
}

/**
 * Destroys a room photo asset and invalidates CDN copies.
 *
 * Resolves `true` when the asset is gone — including when it was ALREADY gone,
 * which is exactly the state the caller wants. Rejects on anything else, so the
 * record stays unpurged and the sweep retries.
 */
export async function destroyRoomPhoto(publicId, deliveryType = ROOM_PHOTO_DELIVERY_TYPE) {
  let result
  try {
    result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      type: deliveryType,
      invalidate: true,
    })
  } catch {
    throw new RoomPhotoStorageError('Room photo could not be deleted from storage')
  }

  if (result?.result === 'ok' || result?.result === 'not found') return true
  throw new RoomPhotoStorageError('Room photo could not be deleted from storage')
}

/**
 * Reads a stored room photo into memory, for server-side work that needs the
 * bytes themselves — the generation worker handing the photo to a provider.
 *
 * Deliberately NOT a weakening of private delivery: it is server-only, it
 * returns bytes rather than a URL, and it stops reading past `maxBytes` so a
 * surprising object cannot exhaust a small instance.
 *
 * @returns {Promise<Buffer>}
 */
export async function readRoomPhotoBuffer(publicId, { maxBytes, ...options } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RoomPhotoStorageError('A byte limit is required to read a room photo')
  }

  const { stream } = await openRoomPhotoStream(publicId, options)
  const chunks = []
  let total = 0

  try {
    for await (const chunk of stream) {
      total += chunk.length
      if (total > maxBytes) {
        stream.destroy()
        throw new RoomPhotoStorageError('The stored room photo is larger than expected')
      }
      chunks.push(chunk)
    }
  } catch (error) {
    if (error instanceof RoomPhotoStorageError) throw error
    throw new RoomPhotoStorageError('The stored room photo could not be read')
  }

  return Buffer.concat(chunks, total)
}

/**
 * Opens the stored image for streaming to its owner.
 *
 * @returns {Promise<{ stream: Readable, contentLength: number | null }>}
 */
export async function openRoomPhotoStream(publicId, { deliveryType = ROOM_PHOTO_DELIVERY_TYPE, format = ROOM_PHOTO_OUTPUT_FORMAT } = {}) {
  // Built, used and discarded inside this function. Never returned or logged.
  const signedUrl = cloudinary.url(publicId, {
    resource_type: 'image',
    type: deliveryType,
    format,
    sign_url: true,
    secure: true,
  })

  let response
  try {
    response = await fetch(signedUrl, { signal: AbortSignal.timeout(ROOM_PHOTO_STORAGE_TIMEOUT_MS) })
  } catch {
    throw new RoomPhotoStorageError('Room photo storage could not be reached')
  }

  if (!response.ok || !response.body) {
    // Drain nothing, keep nothing: just report the outcome.
    throw new RoomPhotoStorageError('Room photo is not available from storage', {
      notFound: response.status === 404,
    })
  }

  const length = Number(response.headers.get('content-length'))
  return {
    stream: Readable.fromWeb(response.body),
    contentLength: Number.isSafeInteger(length) && length > 0 ? length : null,
  }
}
