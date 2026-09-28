// Private image storage for SERVICE REQUESTS.
//
// Every image a request shows lives at a path the request owns:
//
//   varlikent/<env>/service-requests/<requestId>/<photoId>
//
// with `authenticated` delivery, exactly like room photos and visualizations —
// a customer's home is never a public URL. Nothing here ever returns a
// Cloudinary URL to a caller; images are streamed by the routes.
//
// ── Why the design images are COPIED, not referenced ─────────────────────
// A Design My Space room photo is deleted after 30 days and a visualization
// after 90, and the customer can delete either at any time. A request is a
// business record that must stay meaningful after all of that, so at submit
// time the room photo and the visualization are copied to the request's own
// path. The copy is server-to-server (read with the existing private reader,
// written with the same upload call), and the originals are never touched.
//
// Reading and streaming reuse the room-photo helpers: they already take an
// arbitrary publicId + delivery type + format and are not specific to room
// photos in anything but name.

import cloudinary from '../../config/cloudinary.js'
import { roomPhotoStorageEnvironment, ROOM_PHOTO_STORAGE_TIMEOUT_MS } from '../../config/designRoomPhotos.js'
import { SERVICE_REQUEST_PHOTO_DELIVERY_TYPE } from '../../config/serviceRequests.js'
import { DESIGN_GENERATION_MAX_SOURCE_BYTES } from '../../config/designGenerations.js'
import { openRoomPhotoStream, readRoomPhotoBuffer } from '../designRoomPhotos/storage.js'

const OBJECT_ID = /^[0-9a-f]{24}$/i

export const SERVICE_REQUEST_PHOTO_FORMAT = 'jpg'
export const SERVICE_REQUEST_PHOTO_CONTENT_TYPE = 'image/jpeg'

export class ServiceRequestStorageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ServiceRequestStorageError'
  }
}

export function serviceRequestPhotoPublicId(requestId, photoId, env = process.env) {
  const request = String(requestId)
  const photo = String(photoId)
  if (!OBJECT_ID.test(request) || !OBJECT_ID.test(photo)) {
    throw new Error('A service request photo path needs two ObjectIds')
  }
  return `varlikent/${roomPhotoStorageEnvironment(env)}/service-requests/${request}/${photo}`
}

/** Uploads one JPEG buffer to a request-owned private path. */
export function uploadServiceRequestPhoto(publicId, buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'image',
        type: SERVICE_REQUEST_PHOTO_DELIVERY_TYPE,
        overwrite: false,
        allowed_formats: [SERVICE_REQUEST_PHOTO_FORMAT],
        tags: ['service-request'],
        timeout: ROOM_PHOTO_STORAGE_TIMEOUT_MS,
      },
      (error, result) => {
        if (error || !result) return reject(new ServiceRequestStorageError('Request photo upload failed'))
        if (result.existing) return reject(new ServiceRequestStorageError('A photo already exists at this path'))
        resolve({ publicId: result.public_id, bytes: result.bytes, format: result.format })
      }
    )
    stream.end(buffer)
  })
}

/**
 * Copies an existing private asset (a room photo or a visualization) to a
 * request-owned path. Reads with a byte ceiling, so a corrupt or unexpected
 * source can never pull an unbounded file into memory.
 */
export async function copyAssetToRequest(source, publicId) {
  let buffer
  try {
    buffer = await readRoomPhotoBuffer(source.publicId, {
      maxBytes: DESIGN_GENERATION_MAX_SOURCE_BYTES,
      deliveryType: source.deliveryType,
      format: source.format,
    })
  } catch {
    throw new ServiceRequestStorageError('The design image could not be read')
  }
  const stored = await uploadServiceRequestPhoto(publicId, buffer)
  return { ...stored, bytes: stored.bytes || buffer.length }
}

/** Best-effort removal; used to roll back a submit that could not complete. */
export async function destroyServiceRequestPhoto(publicId, deliveryType = SERVICE_REQUEST_PHOTO_DELIVERY_TYPE) {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      type: deliveryType,
      invalidate: true,
    })
    return result?.result === 'ok' || result?.result === 'not found'
  } catch {
    return false
  }
}

export async function destroyServiceRequestPhotos(photos = []) {
  const results = await Promise.all(
    photos.map((photo) => destroyServiceRequestPhoto(photo.publicId, photo.deliveryType))
  )
  return results.every(Boolean)
}

/** Streams a request photo (to its owner, or to staff through a signed link). */
export const openServiceRequestPhotoStream = (photo) =>
  openRoomPhotoStream(photo.publicId, { deliveryType: photo.deliveryType, format: photo.format })
