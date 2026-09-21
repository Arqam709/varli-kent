// The Cloudflare Workers AI adapter, with fetch mocked.
//
// NOTHING here contacts Cloudflare: a live run spends real quota. What is
// tested is the contract — what we send, what we accept back, that the source
// photo is downscaled below Cloudflare's documented input limit without the
// original ever being touched, and that every outcome becomes a stable error
// code with no token or provider text leaking.

import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

import * as cloudflare from '../services/designGenerations/providers/cloudflare.js'
import { ProviderError } from '../services/designGenerations/providers/providerError.js'
import { normalizeGeneratedImage } from '../services/designGenerations/resultImage.js'
import { buildRoomVisualizationPrompt } from '../services/designGenerations/prompt.js'
import {
  DESIGN_GENERATION_CLOUDFLARE_INPUT_MAX_EDGE,
  DESIGN_GENERATION_CLOUDFLARE_MODEL,
  DESIGN_GENERATION_MAX_PROVIDER_BYTES,
} from '../config/designGenerations.js'
import { ROOM_PHOTO_MAX_LONG_EDGE, ROOM_PHOTO_MIN_SHORT_EDGE } from '../config/designRoomPhotos.js'

const ACCOUNT_ID = 'abc123def456abc123def456abc12345'
const TOKEN = 'cf-token-not-real-0000'

const realFetch = globalThis.fetch
after(() => { globalThis.fetch = realFetch })

/* ── A real room photo, made once ──────────────────────────────────────── */

// 2040x1530, the size of the photo used in the manual test. A real JPEG, so
// the adapter's sharp pipeline is genuinely exercised.
const SOURCE = await sharp({
  create: { width: 2040, height: 1530, channels: 3, background: '#6b7f8c' },
}).jpeg().toBuffer()

const GENERATED = (await sharp({
  create: { width: 64, height: 48, channels: 3, background: '#cdb891' },
}).jpeg().toBuffer())

/* ── The mocked endpoint ───────────────────────────────────────────────── */

let requests = []
let reply = null
let transportFailure = null

const jsonReply = (payload, { status = 200, contentLength = null } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
  text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
})

const success = (image = GENERATED.toString('base64')) =>
  jsonReply({ success: true, result: { image }, errors: [], messages: [] })

beforeEach(() => {
  requests = []
  transportFailure = null
  reply = success()
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID
  process.env.CLOUDFLARE_API_TOKEN = TOKEN

  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (transportFailure) throw transportFailure
    return reply
  }
})

const input = (overrides = {}) => ({
  imageBuffer: SOURCE,
  mimeType: 'image/jpeg',
  prompt: 'Redesign the living room. Keep the camera position.',
  width: 2040,
  height: 1530,
  ...overrides,
})

const rejectsWithCode = async (promise, code, retryable) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ProviderError, `expected ProviderError, got ${error}`)
    assert.equal(error.code, code)
    if (retryable !== undefined) assert.equal(error.retryable, retryable)
    return true
  })
}

/** The one request the adapter made, with its multipart body already parsed. */
const sentRequest = async () => {
  assert.equal(requests.length, 1, `expected exactly one provider call, got ${requests.length}`)
  const { url, options } = requests[0]
  const form = options.body
  assert.ok(form instanceof FormData, 'the body was not FormData')
  return { url, options, form }
}

/* ═══════════════ 1. Configuration ═══════════════ */

test('the provider is unconfigured until BOTH credentials are present', async () => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.CLOUDFLARE_API_TOKEN
  assert.equal(cloudflare.isConfigured(), false)

  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID
  assert.equal(cloudflare.isConfigured(), false, 'an account id alone is not enough')

  process.env.CLOUDFLARE_API_TOKEN = TOKEN
  assert.equal(cloudflare.isConfigured(), true)
})

test('a missing credential fails cleanly instead of calling anything', async () => {
  delete process.env.CLOUDFLARE_API_TOKEN
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', false)

  process.env.CLOUDFLARE_API_TOKEN = TOKEN
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', false)

  assert.deepEqual(requests, [], 'a request was sent without credentials')
})

test('an account id that could redirect the request is refused', async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = '../../evil.example.com/x'
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', false)
  assert.deepEqual(requests, [])
})

/* ═══════════════ 2-3. Endpoint and authorization ═══════════════ */

test('the endpoint is the documented Workers AI run URL for the model', async () => {
  await cloudflare.editRoomImage(input())
  const { url } = await sentRequest()

  assert.equal(
    url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${DESIGN_GENERATION_CLOUDFLARE_MODEL}`
  )
  // The model id must keep its '@' and '/' — percent-encoding them 404s.
  assert.ok(url.endsWith('/ai/run/@cf/black-forest-labs/flux-2-klein-4b'), url)
})

test('the token is sent as a bearer credential, read per call', async () => {
  process.env.CLOUDFLARE_API_TOKEN = 'rotated-token-not-real'
  await cloudflare.editRoomImage(input())
  const { options } = await sentRequest()

  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer rotated-token-not-real')
  // fetch must set multipart/form-data itself so the boundary matches the body.
  assert.equal(options.headers['Content-Type'], undefined)
  assert.equal(options.headers['content-type'], undefined)
})

/* ═══════════════ 4-7. The multipart body ═══════════════ */

test('the body is multipart with prompt, input_image_0, width and height', async () => {
  await cloudflare.editRoomImage(input())
  const { form } = await sentRequest()

  assert.deepEqual(
    [...form.keys()].sort(),
    ['height', 'input_image_0', 'prompt', 'width'],
    'unexpected multipart fields'
  )
  assert.equal(form.get('prompt'), 'Redesign the living room. Keep the camera position.')

  const image = form.get('input_image_0')
  assert.ok(image instanceof Blob, 'input_image_0 was not sent as binary')
  assert.equal(image.type, 'image/jpeg')
  assert.ok(image.size > 0)
})

test('input_image_0 is a real JPEG of the source room, under Cloudflare 512x512 limit', async () => {
  await cloudflare.editRoomImage(input())
  const { form } = await sentRequest()

  const sent = Buffer.from(await form.get('input_image_0').arrayBuffer())
  const meta = await sharp(sent).metadata()

  assert.equal(meta.format, 'jpeg')
  // "All input images must be smaller than 512x512" — strictly under.
  assert.ok(meta.width < 512 && meta.height < 512, `sent ${meta.width}x${meta.height}`)
  assert.ok(meta.width <= DESIGN_GENERATION_CLOUDFLARE_INPUT_MAX_EDGE)
  // Still the same room: 2040x1530 is 4:3, and so is the copy.
  assert.ok(Math.abs(meta.width / meta.height - 2040 / 1530) < 0.02, 'the aspect ratio changed')
})

test('the original room photo buffer is never modified', async () => {
  const before = Buffer.from(SOURCE)
  await cloudflare.editRoomImage(input())
  assert.ok(SOURCE.equals(before), 'the source photo buffer was mutated')
})

test('width and height are sent from the ORIGINAL photo proportions', async () => {
  await cloudflare.editRoomImage(input())
  const { form } = await sentRequest()

  // 2040x1530 at a 1024 long edge — the pair verified by hand.
  assert.equal(form.get('width'), '1024')
  assert.equal(form.get('height'), '768')
})

test('the requested size follows the photo, on a 32-pixel step', () => {
  assert.deepEqual(cloudflare.outputDimensions(2040, 1530), { width: 1024, height: 768 })
  assert.deepEqual(cloudflare.outputDimensions(1530, 2040), { width: 768, height: 1024 })
  assert.deepEqual(cloudflare.outputDimensions(1000, 1000), { width: 1024, height: 1024 })

  for (const [w, h] of [[1920, 1080], [3000, 2000], [1440, 1920]]) {
    const out = cloudflare.outputDimensions(w, h)
    assert.equal(out.width % 32, 0, `${out.width} is not a multiple of 32`)
    assert.equal(out.height % 32, 0, `${out.height} is not a multiple of 32`)
    assert.ok(Math.max(out.width, out.height) <= 1024)
  }

  // Nonsense dimensions fall back to a square rather than throwing.
  assert.deepEqual(cloudflare.outputDimensions(0, 0), { width: 1024, height: 1024 })
  assert.deepEqual(cloudflare.outputDimensions(NaN, undefined), { width: 1024, height: 1024 })
})

test('a wide room is never rendered below the size the result pipeline accepts', () => {
  // A room photo may be up to 3:1. At a 1024 long edge that would leave a
  // ~341 px short edge, and normalizeGeneratedImage would reject the result as
  // too small — after Cloudflare had already been paid for it.
  const widest = cloudflare.outputDimensions(3000, 1000)
  assert.ok(
    Math.min(widest.width, widest.height) >= ROOM_PHOTO_MIN_SHORT_EDGE,
    `short edge ${Math.min(widest.width, widest.height)} is below the ${ROOM_PHOTO_MIN_SHORT_EDGE} px floor`
  )
  assert.ok(Math.max(widest.width, widest.height) <= ROOM_PHOTO_MAX_LONG_EDGE)

  // Every shape a room photo is allowed to have must clear the same floor.
  for (const [w, h] of [[3000, 1000], [1000, 3000], [2048, 700], [700, 2048], [2560, 1080], [1024, 512]]) {
    const out = cloudflare.outputDimensions(w, h)
    const short = Math.min(out.width, out.height)
    assert.ok(short >= ROOM_PHOTO_MIN_SHORT_EDGE, `${w}x${h} asked for a ${short} px short edge`)
    assert.ok(Math.max(out.width, out.height) <= ROOM_PHOTO_MAX_LONG_EDGE, `${w}x${h} exceeded the ceiling`)
    assert.equal(out.width % 32, 0)
    assert.equal(out.height % 32, 0)
  }
})

test('empty input never reaches the provider', async () => {
  await rejectsWithCode(cloudflare.editRoomImage(input({ imageBuffer: Buffer.alloc(0) })), 'SOURCE_PHOTO_UNAVAILABLE')
  await rejectsWithCode(cloudflare.editRoomImage(input({ prompt: '   ' })), 'PROVIDER_FAILED')
  assert.deepEqual(requests, [])
})

test('bytes that are not a decodable image fail as a source problem', async () => {
  await rejectsWithCode(
    cloudflare.editRoomImage(input({ imageBuffer: Buffer.from('not an image at all') })),
    'SOURCE_PHOTO_UNAVAILABLE'
  )
  assert.deepEqual(requests, [], 'a request was sent with an unusable source image')
})

/* ═══════════════ 8. The success path ═══════════════ */

test('a base64 image in a successful response becomes a Buffer', async () => {
  const result = await cloudflare.editRoomImage(input())

  assert.ok(Buffer.isBuffer(result.buffer))
  assert.ok(result.buffer.equals(GENERATED), 'the decoded bytes are not what Cloudflare sent')
  assert.equal(result.model, DESIGN_GENERATION_CLOUDFLARE_MODEL)
  // The bytes go on to the shared result pipeline, which sniffs the real format.
  assert.equal(result.mimeType, 'image/jpeg')
})

test('base64 broken across lines is still accepted', async () => {
  const wrapped = GENERATED.toString('base64').replace(/(.{40})/g, '$1\n')
  reply = success(wrapped)

  const result = await cloudflare.editRoomImage(input())
  assert.ok(result.buffer.equals(GENERATED))
})

/* ═══════════════ 9-13. Failures ═══════════════ */

test('success=false is a failure, not an empty image', async () => {
  reply = jsonReply({ success: false, result: null, errors: [{ code: 3037, message: 'model not found' }] })
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', false)
})

test('a refusal is reported as rejected content, not as a generic failure', async () => {
  reply = jsonReply({ success: false, errors: [{ code: 5006, message: 'Blocked by the content policy' }] })
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_REJECTED_CONTENT', false)
})

test('HTTP failures are classified, and only transient ones are retryable', async () => {
  const cases = [
    [401, false], // a bad token will not fix itself
    [403, false],
    [400, false],
    [404, false],
    [408, true],
    [429, true], // rate limited or out of quota
    [500, true],
    [502, true],
    [503, true],
  ]

  for (const [status, retryable] of cases) {
    requests = []
    reply = jsonReply({ success: false, errors: [{ code: 10000, message: 'nope' }] }, { status })
    await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', retryable)
  }
})

test('an HTTP error with an unparseable body still classifies by status', async () => {
  reply = jsonReply('<html>502 Bad Gateway</html>', { status: 502 })
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', true)
})

test('a missing result.image is not a success', async () => {
  for (const payload of [
    { success: true, result: {}, errors: [] },
    { success: true, result: null, errors: [] },
    { success: true, errors: [] },
    { success: true, result: { image: '' }, errors: [] },
    { success: true, result: { image: 42 }, errors: [] },
  ]) {
    requests = []
    reply = jsonReply(payload)
    await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_INVALID_IMAGE')
  }
})

test('malformed base64 is refused rather than silently truncated', async () => {
  // Buffer.from() would quietly drop the bad characters and return short bytes.
  for (const bad of ['!!!!not base64!!!!', 'QUJD*', 'QUJDR', '====']) {
    requests = []
    reply = success(bad)
    await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_INVALID_IMAGE')
  }
})

test('an oversized image is refused before it is carried further', async () => {
  reply = success('A'.repeat(Math.ceil(DESIGN_GENERATION_MAX_PROVIDER_BYTES / 3) * 4 + 2048))
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_INVALID_IMAGE')
})

test('an oversized response is refused on its declared length, before it is read', async () => {
  let read = false
  reply = {
    ok: true,
    status: 200,
    headers: { get: () => String(DESIGN_GENERATION_MAX_PROVIDER_BYTES * 4) },
    text: async () => { read = true; return '{}' },
  }
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_INVALID_IMAGE')
  assert.equal(read, false, 'an oversized body was read into memory')
})

test('a timeout is retryable and distinct from other failures', async () => {
  transportFailure = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_TIMEOUT', true)
})

test('a network failure is retryable', async () => {
  transportFailure = Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') })
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', true)
})

test('a non-JSON success body is a failure, not a crash', async () => {
  reply = jsonReply('not json at all')
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', false)
})

test('the request carries a timeout, so a lease cannot be held open forever', async () => {
  await cloudflare.editRoomImage(input())
  const { options } = await sentRequest()
  assert.ok(options.signal, 'no abort signal was attached')
})

test('one call means one request: the adapter never retries by itself', async () => {
  reply = jsonReply({ success: false, errors: [{ code: 1, message: 'x' }] }, { status: 500 })
  await rejectsWithCode(cloudflare.editRoomImage(input()), 'PROVIDER_FAILED', true)
  assert.equal(requests.length, 1, 'the adapter retried on its own')
})

/* ═══════════════ 14. Nothing sensitive escapes ═══════════════ */

test('credentials and provider text never escape the adapter', async () => {
  const secret = 'cf-SUPER-SECRET-TOKEN-1234567890'
  process.env.CLOUDFLARE_API_TOKEN = secret

  const leaks = (error) => {
    const text = `${error.message} ${error.stack ?? ''}`
    assert.equal(text.includes(secret), false, 'the API token leaked into the error')
    assert.equal(text.includes('bedroom of Ada'), false, 'provider text leaked into the error')
    return true
  }

  reply = jsonReply(
    { success: false, errors: [{ code: 7, message: `rejected token ${secret} for prompt "bedroom of Ada"` }] },
    { status: 401 }
  )
  await assert.rejects(cloudflare.editRoomImage(input()), leaks)

  reply = jsonReply({ success: false, errors: [{ code: 7, message: `token ${secret} exhausted` }] })
  await assert.rejects(cloudflare.editRoomImage(input()), leaks)

  transportFailure = new Error(`connect failed to https://api.cloudflare.com/...?token=${secret}`)
  await assert.rejects(cloudflare.editRoomImage(input()), leaks)
})

/* ═══════════════ 20. It fits the pipeline it feeds ═══════════════ */

test('what the adapter returns is accepted by the existing result pipeline', async () => {
  // The size this adapter actually asks Cloudflare for, answered with a real
  // JPEG — the handover point between the provider and private storage.
  const asked = cloudflare.outputDimensions(2040, 1530)
  const rendered = await sharp({
    create: { width: asked.width, height: asked.height, channels: 3, background: '#a8927d' },
  }).jpeg().toBuffer()
  reply = success(rendered.toString('base64'))

  const produced = await cloudflare.editRoomImage(input())
  // No mocking here: the real normalizeRoomPhoto, as the worker would call it.
  const normalized = await normalizeGeneratedImage(produced.buffer)

  assert.equal(normalized.format, 'jpg')
  assert.equal(normalized.width, asked.width)
  assert.equal(normalized.height, asked.height)
  assert.ok(normalized.bytes > 0)
  assert.ok(Buffer.isBuffer(normalized.buffer))
})

test('a PNG answer is handled too: the pipeline sniffs the real format', async () => {
  const asked = cloudflare.outputDimensions(1600, 1200)
  const png = await sharp({
    create: { width: asked.width, height: asked.height, channels: 3, background: '#7d8fa8' },
  }).png().toBuffer()
  reply = success(png.toString('base64'))

  const produced = await cloudflare.editRoomImage(input({ width: 1600, height: 1200 }))
  const normalized = await normalizeGeneratedImage(produced.buffer)
  assert.equal(normalized.format, 'jpg', 'the result is always stored as JPEG')
})

test('the prompt the worker builds is what reaches Cloudflare, unchanged', async () => {
  // The board snapshot is the only source of design preferences, and the
  // adapter is a courier: it must not edit, trim or decorate the prompt.
  const prompt = buildRoomVisualizationPrompt({
    version: 1,
    room: 'living-room',
    style: 'contemporary',
    wall: { label: 'Warm off-white', color: '#F2EDE4' },
    floor: { label: 'Light natural oak', color: '#C9A87C' },
    materials: [{ name: 'Natural oak wood', color: '#C9A87C' }, { name: 'Beige fabric', color: '#D9CDBA' }],
    lighting: 'warm',
  })

  await cloudflare.editRoomImage(input({ prompt }))
  const { form } = await sentRequest()
  assert.equal(form.get('prompt'), prompt)

  // The board's own words reached the model.
  assert.match(form.get('prompt'), /Warm off-white/)
  assert.match(form.get('prompt'), /Natural oak wood/)
  // And so did the structural constraints.
  assert.match(form.get('prompt'), /Keep the camera position/)
  assert.match(form.get('prompt'), /do not change the room’s size/)
})

test('a missing credential names the variable but never a value', async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID
  delete process.env.CLOUDFLARE_API_TOKEN

  await assert.rejects(cloudflare.editRoomImage(input()), (error) => {
    assert.match(error.message, /CLOUDFLARE_API_TOKEN/)
    assert.equal(error.message.includes(ACCOUNT_ID), false, 'the account id leaked into the error')
    return true
  })
})
