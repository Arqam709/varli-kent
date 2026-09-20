// Validating and normalizing what the provider sent back.
//
// Provider output is untrusted input like any other: it arrives over the
// network, in whatever format the model chose, at whatever size. It goes
// through the SAME pipeline as an uploaded room photo — real format detection
// from the file signature, header dimension limits, a strict decode, an
// orientation pass, a resize to the delivery ceiling, sRGB, and a JPEG
// re-encode that carries no metadata across.
//
// Reusing that pipeline is deliberate: one place decides what a stored image
// may be, so a generated image cannot be held to weaker rules than a photo.

import { normalizeRoomPhoto, RoomPhotoError } from '../designRoomPhotos/imagePipeline.js'
import { ProviderError } from './providers/providerError.js'

/**
 * @param {Buffer} buffer the bytes the provider returned
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, bytes: number, format: string }>}
 * @throws {ProviderError} PROVIDER_INVALID_IMAGE when the output is unusable
 */
export async function normalizeGeneratedImage(buffer) {
  try {
    return await normalizeRoomPhoto(buffer)
  } catch (error) {
    if (error instanceof RoomPhotoError) {
      // The provider's fault, not the user's: one stable code, and the
      // specific reason only in the server log.
      throw new ProviderError('PROVIDER_INVALID_IMAGE', {
        // ROOM_PHOTO_BUSY means this instance was saturated, not that the
        // image was bad — that one is worth another attempt.
        retryable: error.code === 'ROOM_PHOTO_BUSY',
        detail: `generated image rejected: ${error.code}`,
      })
    }
    throw error
  }
}
