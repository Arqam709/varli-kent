// The Gemini image-editing adapter.
//
//   room photo bytes + server-built prompt  ──▶  Gemini image model  ──▶  edited room image
//
// Uses the SDK and key the project already has (@google/genai, GEMINI_API_KEY,
// the same `ai.models.generateContent` shape as routes/propertyAssistant.js),
// asking for an IMAGE response instead of text.
//
// ── Worth knowing ───────────────────────────────────────────────────────
//   • Gemini's image models have NO free tier: the key must be on a paid plan,
//     or every call fails here with PROVIDER_FAILED.
//   • Every generated image carries Google's invisible SynthID watermark.
//   • The model id is configuration (DESIGN_GENERATION_MODEL), so moving to
//     another Gemini image model is an environment change, not a code change.
//
// This module never touches MongoDB, never logs prompts or image bytes, and
// returns bytes to its caller rather than storing anything.

import { GoogleGenAI, Modality } from '@google/genai'
import {
  DESIGN_GENERATION_ASPECT_RATIOS,
  DESIGN_GENERATION_IMAGE_SIZE,
  DESIGN_GENERATION_MAX_PROVIDER_BYTES,
  DESIGN_GENERATION_MODEL,
  DESIGN_GENERATION_PROVIDER_TIMEOUT_MS,
} from '../../../config/designGenerations.js'
import { ProviderError } from './providerError.js'

export const GEMINI_PROVIDER_NAME = 'gemini'

/** Whether a real call could be made at all. */
export const isConfigured = () => Boolean(process.env.GEMINI_API_KEY)

/**
 * Constructed per call, never at import time: a missing key must not stop the
 * server booting, and the key may be set after startup in some environments.
 */
const client = () => {
  if (!isConfigured()) {
    throw new ProviderError('PROVIDER_FAILED', { detail: 'GEMINI_API_KEY is not configured' })
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

/**
 * The supported aspect ratio closest to the source photo, so the redesign
 * comes back framed like the room the user actually photographed.
 */
export function nearestAspectRatio(width, height, ratios = DESIGN_GENERATION_ASPECT_RATIOS) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1'
  const target = width / height

  let best = ratios[0]
  let bestDistance = Infinity
  for (const ratio of ratios) {
    const [w, h] = ratio.split(':').map(Number)
    const distance = Math.abs(w / h - target)
    if (distance < bestDistance) {
      best = ratio
      bestDistance = distance
    }
  }
  return best
}

/** The first inline image part of a response, whatever else it contains. */
function extractImage(response) {
  const parts = response?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null

  for (const part of parts) {
    const inline = part?.inlineData
    if (inline?.data && typeof inline.data === 'string') {
      return { data: inline.data, mimeType: inline.mimeType || 'image/png' }
    }
  }
  return null
}

/** Safety blocks and refusals, which retrying identically will not fix. */
function rejection(response) {
  const blockReason = response?.promptFeedback?.blockReason
  if (blockReason) return String(blockReason)

  const finishReason = response?.candidates?.[0]?.finishReason
  if (finishReason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(String(finishReason))) {
    return String(finishReason)
  }
  return null
}

/** Provider failures worth another attempt: transport, rate limit, 5xx. */
function isRetryableFailure(error) {
  const status = error?.status ?? error?.code
  if (typeof status === 'number') return status === 429 || status >= 500
  const message = String(error?.message ?? '')
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|fetch failed|unavailable|overloaded|rate limit|429|50\d/i.test(message)
}

/**
 * Sends one room photo plus instructions and returns the edited image.
 *
 * @param {{ imageBuffer: Buffer, mimeType: string, prompt: string, width?: number, height?: number }} input
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 * @throws {ProviderError} always — never a raw SDK error
 */
export async function editRoomImage({ imageBuffer, mimeType, prompt, width, height }) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new ProviderError('SOURCE_PHOTO_UNAVAILABLE', { detail: 'no source image bytes' })
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new ProviderError('PROVIDER_FAILED', { detail: 'empty prompt' })
  }

  const ai = client()
  // The image comes first, then the instructions about it.
  const contents = [{
    role: 'user',
    parts: [
      { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
      { text: prompt },
    ],
  }]

  let response
  try {
    response = await ai.models.generateContent({
      model: DESIGN_GENERATION_MODEL,
      contents,
      config: {
        // Ask for a picture, not a description of one.
        responseModalities: [Modality.IMAGE],
        imageConfig: {
          aspectRatio: nearestAspectRatio(width, height),
          imageSize: DESIGN_GENERATION_IMAGE_SIZE,
        },
        // The SDK gives up rather than holding a lease open indefinitely.
        httpOptions: { timeout: DESIGN_GENERATION_PROVIDER_TIMEOUT_MS },
      },
    })
  } catch (error) {
    const message = String(error?.message ?? '')
    if (/timeout|timed out|deadline/i.test(message)) {
      throw new ProviderError('PROVIDER_TIMEOUT', { retryable: true, detail: 'provider timed out' })
    }
    if (/safety|blocked|prohibited/i.test(message)) {
      throw new ProviderError('PROVIDER_REJECTED_CONTENT', { detail: 'provider refused the request' })
    }
    // Classification only. The SDK's message is deliberately NOT included: it
    // can echo the request, which carries the API key and a prompt describing
    // the inside of someone's home, and this detail reaches the server log.
    const status = error?.status ?? error?.code
    throw new ProviderError('PROVIDER_FAILED', {
      retryable: isRetryableFailure(error),
      detail: `provider call failed (status ${typeof status === 'number' ? status : 'unknown'})`,
    })
  }

  const refused = rejection(response)
  if (refused) {
    throw new ProviderError('PROVIDER_REJECTED_CONTENT', { detail: `provider refused: ${refused}` })
  }

  const image = extractImage(response)
  if (!image) {
    // A text-only answer means the model declined to edit the photo; asking
    // again with the same input rarely changes that.
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'no image part in the response' })
  }

  const buffer = Buffer.from(image.data, 'base64')
  if (buffer.length === 0) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'empty image part' })
  }
  if (buffer.length > DESIGN_GENERATION_MAX_PROVIDER_BYTES) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'image exceeds the accepted size' })
  }

  return { buffer, mimeType: image.mimeType, model: DESIGN_GENERATION_MODEL }
}
