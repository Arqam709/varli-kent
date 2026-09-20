// The Gemini image adapter, with the SDK mocked.
//
// NOTHING here contacts Google: a live image call costs money and needs a paid
// key. What is tested is the contract — what we send, what we accept back, and
// that every outcome becomes a stable error code with no provider text leaking.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const calls = []
let response = null
let failure = null

class FakeGoogleGenAI {
  constructor(options) {
    calls.push({ method: 'construct', apiKey: options?.apiKey })
    this.models = {
      generateContent: async (request) => {
        calls.push({ method: 'generateContent', request })
        if (failure) throw failure
        return response
      },
    }
  }
}

mock.module('@google/genai', {
  namedExports: {
    GoogleGenAI: FakeGoogleGenAI,
    Modality: { TEXT: 'TEXT', IMAGE: 'IMAGE' },
  },
})

const gemini = await import('../services/designGenerations/providers/gemini.js')
const { ProviderError } = await import('../services/designGenerations/providers/providerError.js')
const { DESIGN_GENERATION_MODEL } = await import('../config/designGenerations.js')

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const imageResponse = (data = IMAGE.toString('base64'), mimeType = 'image/png') => ({
  candidates: [{ content: { parts: [{ inlineData: { data, mimeType } }] }, finishReason: 'STOP' }],
})

const input = (overrides = {}) => ({
  imageBuffer: Buffer.from([1, 2, 3, 4, 5]),
  mimeType: 'image/jpeg',
  prompt: 'Redesign the living room.',
  width: 2048,
  height: 1536,
  ...overrides,
})

beforeEach(() => {
  calls.length = 0
  failure = null
  response = imageResponse()
  process.env.GEMINI_API_KEY = 'test-key-not-real'
})

const rejectsWithCode = async (promise, code, retryable) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ProviderError, `expected ProviderError, got ${error}`)
    assert.equal(error.code, code)
    if (retryable !== undefined) assert.equal(error.retryable, retryable)
    return true
  })
}

/* ═══════════════ The request ═══════════════ */

test('the request carries the room image, then the prompt, and asks for an image back', async () => {
  const result = await gemini.editRoomImage(input())

  const { request } = calls.find((call) => call.method === 'generateContent')
  assert.equal(request.model, DESIGN_GENERATION_MODEL)

  const [imagePart, textPart] = request.contents[0].parts
  assert.equal(imagePart.inlineData.mimeType, 'image/jpeg')
  assert.equal(imagePart.inlineData.data, Buffer.from([1, 2, 3, 4, 5]).toString('base64'))
  assert.equal(textPart.text, 'Redesign the living room.')

  assert.deepEqual(request.config.responseModalities, ['IMAGE'])
  // 2048x1536 is 4:3, and the frame should match the photographed room.
  assert.equal(request.config.imageConfig.aspectRatio, '4:3')
  assert.ok(request.config.httpOptions.timeout > 0, 'no provider timeout was set')

  assert.ok(result.buffer.equals(IMAGE))
  assert.equal(result.model, DESIGN_GENERATION_MODEL)
})

test('the aspect ratio is the supported one nearest the photo', () => {
  assert.equal(gemini.nearestAspectRatio(4032, 3024), '4:3')
  assert.equal(gemini.nearestAspectRatio(3024, 4032), '3:4')
  assert.equal(gemini.nearestAspectRatio(1920, 1080), '16:9')
  assert.equal(gemini.nearestAspectRatio(1000, 1000), '1:1')
  assert.equal(gemini.nearestAspectRatio(0, 0), '1:1')
})

test('a missing key fails cleanly instead of calling anything', async () => {
  delete process.env.GEMINI_API_KEY
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_FAILED', false)
  assert.deepEqual(calls, [])
  assert.equal(gemini.isConfigured(), false)
})

test('empty input never reaches the provider', async () => {
  await rejectsWithCode(gemini.editRoomImage(input({ imageBuffer: Buffer.alloc(0) })), 'SOURCE_PHOTO_UNAVAILABLE')
  await rejectsWithCode(gemini.editRoomImage(input({ prompt: '   ' })), 'PROVIDER_FAILED')
  assert.deepEqual(calls, [])
})

/* ═══════════════ Outcomes ═══════════════ */

test('a timeout is retryable', async () => {
  failure = new Error('request timed out after 120000ms')
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_TIMEOUT', true)
})

test('rate limits and server errors are retryable; a bad request is not', async () => {
  failure = Object.assign(new Error('Resource exhausted'), { status: 429 })
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_FAILED', true)

  failure = Object.assign(new Error('Internal error'), { status: 503 })
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_FAILED', true)

  failure = Object.assign(new Error('API key not valid'), { status: 400 })
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_FAILED', false)
})

test('a refusal is reported as rejected content, not as a retryable failure', async () => {
  failure = new Error('Request blocked by safety settings')
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_REJECTED_CONTENT', false)

  failure = null
  response = { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_REJECTED_CONTENT')

  response = { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_REJECTED_CONTENT')
})

test('an answer without a usable image is not a success', async () => {
  for (const bad of [
    { candidates: [{ content: { parts: [{ text: 'I cannot edit this photo.' }] }, finishReason: 'STOP' }] },
    { candidates: [] },
    {},
    imageResponse(''),
  ]) {
    response = bad
    await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_INVALID_IMAGE')
  }
})

test('an oversized image is refused rather than carried further', async () => {
  const { DESIGN_GENERATION_MAX_PROVIDER_BYTES } = await import('../config/designGenerations.js')
  response = imageResponse(Buffer.alloc(DESIGN_GENERATION_MAX_PROVIDER_BYTES + 10).toString('base64'))
  await rejectsWithCode(gemini.editRoomImage(input()), 'PROVIDER_INVALID_IMAGE')
})

test('provider text never escapes the adapter', async () => {
  failure = new Error('Invalid API key AIzaSyEXAMPLE-SECRET and prompt "photo of Ada\'s bedroom"')
  await assert.rejects(gemini.editRoomImage(input()), (error) => {
    assert.equal(error.message.includes('AIzaSyEXAMPLE-SECRET'), false, 'the key leaked into the error')
    return true
  })
})

test('the key is read per call, never captured at import time', async () => {
  process.env.GEMINI_API_KEY = 'rotated-key'
  await gemini.editRoomImage(input())
  assert.equal(calls.find((call) => call.method === 'construct').apiKey, 'rotated-key')
})
