// ONE live Cloudflare generation, on purpose.
//
// This is the only thing in the repository that spends real Workers AI quota.
// The automated test suite never calls it and never contacts Cloudflare; it is
// opt-in so that a `npm test` or a CI run can never bill the account.
//
// What it does NOT do: touch MongoDB, touch Cloudinary, create a
// DesignGeneration, read a user's room photo, or change any site setting. It
// exercises exactly the adapter and the real prompt builder against a local
// image file, so a failure here is a provider or credential problem and
// nothing else.
//
// ── Running it ──────────────────────────────────────────────────────────
//   CLOUDFLARE_LIVE_TEST=yes-spend-quota \
//   node scripts/liveCloudflareDesignGeneration.js ./some-room.jpg
//
// Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment
// (backend/.env is loaded automatically). Writes the result next to the input
// as <name>.cloudflare.jpg. Prints no credential, ever.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'

import { editRoomImage, isConfigured, outputDimensions } from '../services/designGenerations/providers/cloudflare.js'
import { buildRoomVisualizationPrompt, DESIGN_PROMPT_VERSION } from '../services/designGenerations/prompt.js'
import { normalizeRoomPhoto } from '../services/designRoomPhotos/imagePipeline.js'
import { normalizeGeneratedImage } from '../services/designGenerations/resultImage.js'
import { DESIGN_GENERATION_CLOUDFLARE_MODEL } from '../config/designGenerations.js'

const CONSENT = 'yes-spend-quota'

/** The board a real user would have saved — the same shape as a boardSnapshot. */
const SAMPLE_BOARD = {
  version: 1,
  room: 'living-room',
  style: 'contemporary',
  wall: { label: 'Warm off-white', color: '#F2EDE4' },
  floor: { label: 'Light natural oak wood', color: '#C9A87C' },
  materials: [
    { name: 'Natural oak wood', color: '#C9A87C' },
    { name: 'Beige fabric', color: '#D9CDBA' },
  ],
  lighting: 'warm',
}

const die = (message) => {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

if (process.env.CLOUDFLARE_LIVE_TEST !== CONSENT) {
  die(
    'This script makes a REAL, billable Cloudflare Workers AI call.\n'
    + `  Re-run with CLOUDFLARE_LIVE_TEST=${CONSENT} if that is what you want.`
  )
}

const source = process.argv[2]
if (!source) die('Usage: node scripts/liveCloudflareDesignGeneration.js <path-to-room-photo>')

if (!isConfigured()) {
  // Names only. The values are never read into a log line.
  const missing = [
    !process.env.CLOUDFLARE_ACCOUNT_ID && 'CLOUDFLARE_ACCOUNT_ID',
    !process.env.CLOUDFLARE_API_TOKEN && 'CLOUDFLARE_API_TOKEN',
  ].filter(Boolean)
  die(`Missing in the environment: ${missing.join(', ')}`)
}

const original = await readFile(source).catch(() => die(`Could not read ${source}`))

// The same normalization an uploaded photo goes through, so this is genuinely
// the input the worker would hand the adapter.
const photo = await normalizeRoomPhoto(original).catch((error) => die(`Not a usable room photo: ${error.code}`))
const prompt = buildRoomVisualizationPrompt(SAMPLE_BOARD)
const asked = outputDimensions(photo.width, photo.height)

console.log(`\n  model          ${DESIGN_GENERATION_CLOUDFLARE_MODEL}`)
console.log(`  prompt version ${DESIGN_PROMPT_VERSION}`)
console.log(`  source photo   ${photo.width}x${photo.height} (${photo.bytes} bytes, normalized)`)
console.log(`  asking for     ${asked.width}x${asked.height}`)
console.log('\n  calling Cloudflare — this spends quota…')

const startedAt = Date.now()
let produced
try {
  produced = await editRoomImage({
    imageBuffer: photo.buffer,
    mimeType: 'image/jpeg',
    prompt,
    width: photo.width,
    height: photo.height,
  })
} catch (error) {
  die(`Generation failed: ${error.code}${error.retryable ? ' (retryable)' : ''} — ${error.message}`)
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

// The same validation the worker applies before anything is stored.
const normalized = await normalizeGeneratedImage(produced.buffer)
  .catch((error) => die(`The generated image failed the result pipeline: ${error.code} — ${error.message}`))

const out = path.join(
  path.dirname(source),
  `${path.basename(source, path.extname(source))}.cloudflare.jpg`
)
await writeFile(out, normalized.buffer)

console.log(`\n  ✓ generated in ${elapsed}s`)
console.log(`  result         ${normalized.width}x${normalized.height}, ${normalized.bytes} bytes`)
console.log(`  written to     ${out}`)
console.log('\n  Nothing was stored in MongoDB or Cloudinary, and no generation record was created.\n')
