// Private storage for GENERATED room visualizations.
//
//   DesignRoomPhoto.asset   the photograph the user uploaded      (room photo storage)
//   DesignGeneration.result the image the provider produced       (this module)
//
// Two assets, two paths, two lifecycles. A result is never written over a
// room photo, and deleting one never touches the other.
//
// Same privacy rules as room photos, and deliberately the same shape as
// services/designRoomPhotos/storage.js: Cloudinary `authenticated` delivery,
// no `folder` option (the full path is the public_id, which behaves the same
// in fixed- and dynamic-folder accounts), no overwriting, and delivery only by
// streaming through the API — a signed URL is built here, used here, and never
// returned or logged.

import { Readable } from 'node:stream'
import cloudinary from '../../config/cloudinary.js'
import { roomPhotoStorageEnvironment } from '../../config/designRoomPhotos.js'
import {
  DESIGN_GENERATION_RESULT_DELIVERY_TYPE,
  DESIGN_GENERATION_PROVIDER_TIMEOUT_MS,
} from '../../config/designGenerations.js'

const OBJECT_ID = /^[0-9a-f]{24}$/i

/** The stored result's format. Our own pipeline produces it; see resultImage.js. */
export const RESULT_FORMAT = 'jpg'
export const RESULT_CONTENT_TYPE = 'image/jpeg'

/**
 * Where one generation's image lives.
 *
 * Only the environment and the generation's own id: no user id, no board, no
 * filename, nothing about the room. Unique per generation, which with
 * `overwrite: false` means a result can never replace another asset.
 */
export function designGenerationResultPublicId(generationId, env = process.env) {
  const id = String(generationId)
  if (!OBJECT_ID.test(id)) throw new Error('A result public ID needs a generation ObjectId')
  return `varlikent/${roomPhotoStorageEnvironment(env)}/design-generations/${id}`
}

export class ResultStorageError extends Error {
  constructor(message, { notFound = false } = {}) {
    super(message)
    this.name = 'ResultStorageError'
    this.notFound = notFound
  }
}

/** Uploads the normalized generated image privately. */
export function uploadGenerationResult(publicId, buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'image',
        type: DESIGN_GENERATION_RESULT_DELIVERY_TYPE,
        overwrite: false,
        allowed_formats: [RESULT_FORMAT],
        tags: ['design-generation-result'],
        timeout: DESIGN_GENERATION_PROVIDER_TIMEOUT_MS,
      },
      (error, result) => {
        if (error || !result) {
          // Cloudinary's message may echo request details; it stops here.
          return reject(new ResultStorageError('Generated image upload failed'))
        }
        if (result.existing) {
          return reject(new ResultStorageError('An asset already exists at this result path'))
        }
        resolve({ publicId: result.public_id, bytes: result.bytes, format: result.format })
      }
    )
    stream.end(buffer)
  })
}

/**
 * Destroys a generated image.
 *
 * Resolves true when the asset is gone — including when it was already gone.
 * Rejects on anything else, so the record stays unpurged and the sweep retries.
 */
export async function destroyGenerationResultAsset(publicId, deliveryType = DESIGN_GENERATION_RESULT_DELIVERY_TYPE) {
  let result
  try {
    result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      type: deliveryType,
      invalidate: true,
    })
  } catch {
    throw new ResultStorageError('Generated image could not be deleted from storage')
  }

  if (result?.result === 'ok' || result?.result === 'not found') return true
  throw new ResultStorageError('Generated image could not be deleted from storage')
}

/**
 * Opens the stored result for streaming to its owner.
 * @returns {Promise<{ stream: Readable, contentLength: number | null }>}
 */
export async function openGenerationResultStream(publicId, {
  deliveryType = DESIGN_GENERATION_RESULT_DELIVERY_TYPE,
  format = RESULT_FORMAT,
} = {}) {
  // Built, used and discarded here. Never returned, never logged.
  const signedUrl = cloudinary.url(publicId, {
    resource_type: 'image',
    type: deliveryType,
    format,
    sign_url: true,
    secure: true,
  })

  let response
  try {
    response = await fetch(signedUrl, { signal: AbortSignal.timeout(DESIGN_GENERATION_PROVIDER_TIMEOUT_MS) })
  } catch {
    throw new ResultStorageError('Result storage could not be reached')
  }

  if (!response.ok || !response.body) {
    throw new ResultStorageError('The generated image is not available from storage', {
      notFound: response.status === 404,
    })
  }

  const length = Number(response.headers.get('content-length'))
  return {
    stream: Readable.fromWeb(response.body),
    contentLength: Number.isSafeInteger(length) && length > 0 ? length : null,
  }
}
