// The Cloudflare Workers AI image-editing adapter.
//
//   room photo bytes + server-built prompt  ──▶  FLUX.2 [klein]  ──▶  edited room image
//
// Same contract as gemini.js — isConfigured() and editRoomImage() — so the
// worker, the prompt and the result pipeline are identical whichever provider
// is selected. Switching is DESIGN_GENERATION_PROVIDER, not a code change.
//
// ── Worth knowing ───────────────────────────────────────────────────────
//   • Workers AI takes multipart/form-data, even for a text-only request, and
//     answers with JSON whose `result.image` is a Base64 string.
//   • Cloudflare documents that EVERY input image must be smaller than
//     512x512. A room photo is far larger, so this adapter makes a small
//     throwaway copy for the request. The stored photo is never touched.
//   • `steps` is fixed at 4 for this model and is not sent.
//
// This module never touches MongoDB, never logs prompts, tokens or image
// bytes, and returns bytes to its caller rather than storing anything.

import sharp from 'sharp'
import {
  DESIGN_GENERATION_CLOUDFLARE_INPUT_MAX_EDGE,
  DESIGN_GENERATION_CLOUDFLARE_MODEL,
  DESIGN_GENERATION_CLOUDFLARE_OUTPUT_MAX_EDGE,
  DESIGN_GENERATION_MAX_PROVIDER_BYTES,
  DESIGN_GENERATION_PROVIDER_TIMEOUT_MS,
} from '../../../config/designGenerations.js'
import {
  ROOM_PHOTO_JPEG_QUALITY,
  ROOM_PHOTO_MAX_LONG_EDGE,
  ROOM_PHOTO_MIN_SHORT_EDGE,
} from '../../../config/designRoomPhotos.js'
import { ProviderError } from './providerError.js'

export const CLOUDFLARE_PROVIDER_NAME = 'cloudflare'

const API_ROOT = 'https://api.cloudflare.com/client/v4'

/** Both halves are needed: an account to address and a token to authorize. */
export const isConfigured = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)

// The account id becomes part of a URL path, so it is checked rather than
// interpolated blindly — a stray '../' in an environment variable must not be
// able to point this request at a different Cloudflare endpoint.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/**
 * The model run endpoint. The model id keeps its '@' and '/' exactly as
 * Cloudflare documents it; percent-encoding them gives a 404.
 */
export function runEndpoint(accountId, model = DESIGN_GENERATION_CLOUDFLARE_MODEL) {
  return `${API_ROOT}/accounts/${accountId}/ai/run/${model}`
}

/** Reads the credentials, or explains which NAME is missing — never a value. */
function credentials() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN

  if (!accountId) throw new ProviderError('PROVIDER_FAILED', { detail: 'CLOUDFLARE_ACCOUNT_ID is not configured' })
  if (!apiToken) throw new ProviderError('PROVIDER_FAILED', { detail: 'CLOUDFLARE_API_TOKEN is not configured' })
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new ProviderError('PROVIDER_FAILED', { detail: 'CLOUDFLARE_ACCOUNT_ID is not a valid account id' })
  }
  return { accountId, apiToken }
}

/* ── The request ───────────────────────────────────────────────────────── */

/** Rounds UP to a multiple of 32, the step these diffusion models expect. */
const toStep = (value) => Math.ceil(value / 32) * 32

// The generated image goes through the same pipeline as an uploaded photo, so
// it has to satisfy the same floor. Asking for a render below it would produce
// an image the result pipeline then throws away as too small.
const HARD_MAX_EDGE = ROOM_PHOTO_MAX_LONG_EDGE

/**
 * The size to ask Cloudflare to render, framed like the photographed room.
 *
 * Driven by the ORIGINAL photo's proportions, not by the downscaled copy sent
 * as input — the user gets a result shaped like their own room.
 *
 * The long edge is the budget, but the SHORT edge wins when they conflict: a
 * room photo may be up to 3:1, and at that shape a 1024 long edge would leave
 * a short edge of ~341 px, below the pipeline's 512 px floor, so every such
 * generation would be discarded after it had already been paid for.
 */
export function outputDimensions(width, height, maxEdge = DESIGN_GENERATION_CLOUDFLARE_OUTPUT_MAX_EDGE) {
  const budget = Math.min(HARD_MAX_EDGE, Math.max(ROOM_PHOTO_MIN_SHORT_EDGE, toStep(maxEdge)))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: budget, height: budget }
  }

  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)

  // Fit the long edge to the budget, then grow if that starved the short edge.
  const scale = Math.min(
    HARD_MAX_EDGE / longEdge,
    Math.max(budget / longEdge, ROOM_PHOTO_MIN_SHORT_EDGE / shortEdge)
  )

  return {
    width: Math.min(HARD_MAX_EDGE, toStep(width * scale)),
    height: Math.min(HARD_MAX_EDGE, toStep(height * scale)),
  }
}

/**
 * A small, in-memory copy of the room photo for the request body.
 *
 * Cloudflare requires every input image to be smaller than 512x512. This is a
 * throwaway representation: it is never uploaded, never stored, never returned,
 * and the user's original photo and its Cloudinary asset are left untouched.
 *
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function buildProviderInputImage(imageBuffer, maxEdge = DESIGN_GENERATION_CLOUDFLARE_INPUT_MAX_EDGE) {
  try {
    const { data, info } = await sharp(imageBuffer, { failOn: 'warning', pages: 1 })
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: ROOM_PHOTO_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true })

    return { buffer: data, width: info.width, height: info.height }
  } catch {
    // The stored photo already passed the room-photo pipeline, so failing here
    // means the bytes we just read are unusable, not that the model refused.
    throw new ProviderError('SOURCE_PHOTO_UNAVAILABLE', { detail: 'the source photo could not be prepared' })
  }
}

/* ── The response ──────────────────────────────────────────────────────── */

// Base64 costs four characters per three bytes; reject an overlong string
// before decoding it rather than after allocating the buffer.
const MAX_ENCODED_LENGTH = Math.ceil(DESIGN_GENERATION_MAX_PROVIDER_BYTES / 3) * 4 + 1024
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Decodes `result.image`.
 *
 * Buffer.from(x, 'base64') silently drops characters it does not recognise, so
 * a malformed string would otherwise become a plausible-looking short buffer.
 * The shape is therefore checked before decoding.
 */
function decodeImage(encoded) {
  if (typeof encoded !== 'string' || !encoded) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the response carried no image' })
  }

  const compact = encoded.replace(/\s+/g, '')
  if (compact.length > MAX_ENCODED_LENGTH) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the image exceeds the accepted size' })
  }
  if (compact.length % 4 !== 0 || !BASE64.test(compact)) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the image was not valid base64' })
  }

  const buffer = Buffer.from(compact, 'base64')
  if (buffer.length === 0) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the decoded image was empty' })
  }
  if (buffer.length > DESIGN_GENERATION_MAX_PROVIDER_BYTES) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the image exceeds the accepted size' })
  }
  return buffer
}

/** Cloudflare's numeric error codes only — never its messages. */
const errorCodes = (payload) => (Array.isArray(payload?.errors) ? payload.errors : [])
  .map((entry) => (Number.isFinite(entry?.code) ? entry.code : null))
  .filter((code) => code !== null)

/**
 * Whether a reported failure is the model refusing the content.
 *
 * The message is examined but never stored or forwarded: it can echo the
 * prompt, which describes the inside of someone's home.
 */
const looksLikeRefusal = (payload) => (Array.isArray(payload?.errors) ? payload.errors : [])
  .some((entry) => /safety|nsfw|content policy|moderat|prohibited|blocked/i.test(String(entry?.message ?? '')))

/** HTTP outcomes worth another attempt: rate limiting and server faults. */
const isRetryableStatus = (status) => status === 408 || status === 429 || status >= 500

/* ── The call ──────────────────────────────────────────────────────────── */

/**
 * Sends one room photo plus instructions and returns the edited image.
 *
 * One request, no internal retries: attempts and leases belong to the worker
 * and the generation state machine, and a second call here would spend quota
 * outside their control.
 *
 * @param {{ imageBuffer: Buffer, mimeType: string, prompt: string, width?: number, height?: number }} input
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 * @throws {ProviderError} always — never a raw fetch error
 */
export async function editRoomImage({ imageBuffer, prompt, width, height }) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new ProviderError('SOURCE_PHOTO_UNAVAILABLE', { detail: 'no source image bytes' })
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new ProviderError('PROVIDER_FAILED', { detail: 'empty prompt' })
  }

  const { accountId, apiToken } = credentials()
  const source = await buildProviderInputImage(imageBuffer)
  const output = outputDimensions(width, height)

  const form = new FormData()
  form.append('prompt', prompt)
  // Cloudflare requires this exact field name for the first reference image.
  form.append('input_image_0', new Blob([source.buffer], { type: 'image/jpeg' }), 'room.jpg')
  form.append('width', String(output.width))
  form.append('height', String(output.height))

  let response
  try {
    response = await fetch(runEndpoint(accountId), {
      method: 'POST',
      // No Content-Type here on purpose: fetch sets it with the multipart
      // boundary. Setting it by hand produces an unparseable body.
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
      signal: AbortSignal.timeout(DESIGN_GENERATION_PROVIDER_TIMEOUT_MS),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ProviderError('PROVIDER_TIMEOUT', { retryable: true, detail: 'provider timed out' })
    }
    // Classification only. The message is deliberately not included: it can
    // carry the request URL, and this detail reaches the server log.
    throw new ProviderError('PROVIDER_FAILED', { retryable: true, detail: 'provider could not be reached' })
  }

  // A body this large is not a picture of a room; refuse it before reading it.
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > MAX_ENCODED_LENGTH) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the response exceeds the accepted size' })
  }

  let body
  try {
    body = await response.text()
  } catch {
    throw new ProviderError('PROVIDER_FAILED', { retryable: true, detail: 'the response could not be read' })
  }

  if (body.length > MAX_ENCODED_LENGTH) {
    throw new ProviderError('PROVIDER_INVALID_IMAGE', { detail: 'the response exceeds the accepted size' })
  }

  if (!response.ok) {
    // The error body is parsed for codes only; a failed parse is not itself an
    // error here, since the status already says what happened.
    let codes = []
    try {
      codes = errorCodes(JSON.parse(body))
    } catch {
      // No structured codes available; the status stands on its own.
    }
    throw new ProviderError('PROVIDER_FAILED', {
      retryable: isRetryableStatus(response.status),
      detail: `provider call failed (status ${response.status}${codes.length ? `, codes ${codes.join(',')}` : ''})`,
    })
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    throw new ProviderError('PROVIDER_FAILED', { detail: 'the response was not valid JSON' })
  }

  if (payload?.success !== true) {
    if (looksLikeRefusal(payload)) {
      throw new ProviderError('PROVIDER_REJECTED_CONTENT', { detail: 'provider refused the request' })
    }
    const codes = errorCodes(payload)
    throw new ProviderError('PROVIDER_FAILED', {
      detail: `provider reported failure${codes.length ? ` (codes ${codes.join(',')})` : ''}`,
    })
  }

  const buffer = decodeImage(payload?.result?.image)
  // The stored format is decided by the result pipeline, which sniffs the real
  // signature; what is claimed here is only a hint.
  return { buffer, mimeType: 'image/jpeg', model: DESIGN_GENERATION_CLOUDFLARE_MODEL }
}
