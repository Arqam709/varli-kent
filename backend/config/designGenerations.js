// Design My Space visualizations ("generations") — every rule in one place.
//
// A generation is one request: "use THIS design configuration with THIS room
// photo to create one visualization". The record, the ownership rules, the
// snapshot and the job boundary came first; the provider, the worker and the
// private result asset build on them. Nothing ever reaches `succeeded` without
// a real generated image stored privately.

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

export const DESIGN_GENERATION_STATUSES = ['queued', 'processing', 'succeeded', 'failed', 'deleted']

/** Work that is not finished: it holds a queue slot and its source photo. */
export const DESIGN_GENERATION_ACTIVE_STATUSES = ['queued', 'processing']

/**
 * The only transitions that may ever happen. The client appears in none of
 * them: it can create (→ queued) and delete (→ deleted); every other move is
 * made by the worker or the sweep.
 */
export const DESIGN_GENERATION_TRANSITIONS = {
  queued: ['processing', 'failed', 'deleted'],
  // Back to `queued` when a lease expires and attempts remain.
  processing: ['succeeded', 'failed', 'queued', 'deleted'],
  succeeded: ['deleted'],
  failed: ['deleted'],
  deleted: [],
}

/* ── Errors the client may be shown ────────────────────────────────────── */

/**
 * Stable codes, translated by the app. A provider's own message is never
 * stored or forwarded — Phase 2 maps provider failures onto these.
 */
export const DESIGN_GENERATION_ERROR_CODES = [
  // The source photo was deleted or expired before the job ran.
  'SOURCE_PHOTO_UNAVAILABLE',
  // Claimed, then the worker died; no attempts left.
  'LEASE_EXPIRED',
  // Waited too long without ever being claimed.
  'NOT_PROCESSED_IN_TIME',
  // The provider could not be reached, errored, or is not configured.
  'PROVIDER_FAILED',
  // The provider refused the request (safety, or a room it will not edit).
  'PROVIDER_REJECTED_CONTENT',
  // The provider took longer than DESIGN_GENERATION_PROVIDER_TIMEOUT_MS.
  'PROVIDER_TIMEOUT',
  // The provider answered, but not with a usable image.
  'PROVIDER_INVALID_IMAGE',
  // The image was generated but could not be stored privately.
  'RESULT_STORAGE_FAILED',
]

/* ── Abuse protection ──────────────────────────────────────────────────── */

// Unfinished generations one user may hold. A visualization is a slow, paid
// operation; queueing dozens is never a real need.
export const DESIGN_GENERATION_MAX_ACTIVE_PER_USER = 3

// Creations per rolling 24 hours, counting deleted ones, so delete-and-retry
// cannot bypass it. Counted in MongoDB, so it survives restarts.
export const DESIGN_GENERATION_MAX_PER_DAY = 20

// Client-supplied idempotency key: long enough to be unique per attempt,
// bounded so it cannot be used to store data.
export const DESIGN_GENERATION_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/* ── Job boundary ──────────────────────────────────────────────────────── */

// How long a claimed generation stays claimed. Longer than any expected
// provider call, short enough that a crashed worker is recovered promptly.
export const DESIGN_GENERATION_LEASE_MS = 5 * 60 * 1000

// Total claims per generation. Attempt 1 plus two recoveries after a crash;
// after that it fails rather than looping forever.
export const DESIGN_GENERATION_MAX_ATTEMPTS = 3

// A generation nobody ever claimed is failed rather than left queued forever.
// In Phase 1 there is no worker at all, which is why creation is behind a
// feature flag that is OFF by default.
export const DESIGN_GENERATION_QUEUED_MAX_AGE_MS = 24 * 60 * 60 * 1000

/* ── Retention ─────────────────────────────────────────────────────────── */

// How long a generation (and, from Phase 2, its generated image) is kept.
// Longer than a room photo's 30 days because the result is the user's own
// history, while the source photo is raw input.
export const DESIGN_GENERATION_RETENTION_DAYS = 90

// Purged records (no image, a few hundred bytes) are kept so the daily count
// and idempotency keys stay meaningful, then removed by MongoDB's TTL monitor.
export const DESIGN_GENERATION_PURGED_RECORD_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * How long creating a generation keeps its source room photo alive.
 *
 * A room photo normally expires 30 days after upload. A job must not lose its
 * input mid-flight, so creation pushes that photo's `expiresAt` to at least
 * now + this window — never shortening it, and never making it permanent. Two
 * days is far longer than any queue wait this system should ever have, and it
 * keeps the privacy-oriented retention model intact.
 */
export const DESIGN_GENERATION_SOURCE_PHOTO_HOLD_MS = 2 * 24 * 60 * 60 * 1000

/* ── The provider ──────────────────────────────────────────────────────── */

/**
 * Which adapter services/designGenerations/providers/index.js uses.
 *
 * 'gemini' (the default) or 'cloudflare'. Anything else — including 'none' —
 * leaves no adapter, which disables generation and keeps the worker idle.
 *
 * Read per call rather than captured at import, matching how each adapter
 * reads its own credentials, so the value is the one the process actually has
 * when a job runs.
 */
export const designGenerationProvider = (env = process.env) =>
  (env.DESIGN_GENERATION_PROVIDER || 'gemini').toLowerCase()

/**
 * The Gemini image-editing model.
 *
 * Takes an input image plus instructions and returns an edited image — the
 * capability this feature needs. Overridable so a model change never needs a
 * code change. NOTE: Gemini image models have no free tier; the key must be on
 * a paid plan.
 */
export const DESIGN_GENERATION_MODEL = process.env.DESIGN_GENERATION_MODEL || 'gemini-3.1-flash-image'

/* ── Cloudflare Workers AI ─────────────────────────────────────────────── */

/**
 * The Workers AI model, which unifies image generation and editing. Reached
 * over the REST API with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, both
 * read by the adapter itself and never sent anywhere near a client.
 */
export const DESIGN_GENERATION_CLOUDFLARE_MODEL =
  process.env.CLOUDFLARE_DESIGN_MODEL || '@cf/black-forest-labs/flux-2-klein-4b'

/**
 * Longest edge of the copy of the room photo sent as `input_image_0`.
 *
 * Cloudflare documents that every input image must be SMALLER than 512x512,
 * so this is capped below 512 whatever the environment asks for. 500 is the
 * size verified by hand against the live model. That copy exists only for the
 * request: the stored room photo is never resized, replaced or re-uploaded.
 */
export const DESIGN_GENERATION_CLOUDFLARE_INPUT_MAX_EDGE = Math.min(
  511,
  Math.max(64, Number.parseInt(process.env.CLOUDFLARE_DESIGN_INPUT_MAX_EDGE || '500', 10) || 500)
)

/**
 * Longest edge asked of Cloudflare for the generated image. The result is
 * normalized to at most ROOM_PHOTO_MAX_LONG_EDGE (2048 px) for delivery
 * anyway, and a larger render costs more and takes longer.
 */
export const DESIGN_GENERATION_CLOUDFLARE_OUTPUT_MAX_EDGE =
  Number.parseInt(process.env.CLOUDFLARE_DESIGN_OUTPUT_MAX_EDGE || '1024', 10) || 1024

/**
 * Output resolution asked of the provider: '1K', '2K' or '4K'.
 *
 * 1K by default — it is the cheapest, and the result is normalized to at most
 * ROOM_PHOTO_MAX_LONG_EDGE (2048 px) for delivery anyway.
 */
export const DESIGN_GENERATION_IMAGE_SIZE = process.env.DESIGN_GENERATION_IMAGE_SIZE || '1K'

/** Aspect ratios the provider accepts; the source photo picks the nearest. */
export const DESIGN_GENERATION_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']

/** One provider call may take this long before it is abandoned as a timeout. */
export const DESIGN_GENERATION_PROVIDER_TIMEOUT_MS = 120 * 1000

/** Largest image accepted back from the provider, before validation. */
export const DESIGN_GENERATION_MAX_PROVIDER_BYTES = 20 * 1024 * 1024

/** Largest source photo the worker will load into memory for the provider. */
export const DESIGN_GENERATION_MAX_SOURCE_BYTES = 12 * 1024 * 1024

/* ── The worker ────────────────────────────────────────────────────────── */

/**
 * Whether this process runs generation jobs. Set to 'false' on an instance
 * that should only serve HTTP. The worker also stays idle when no provider is
 * configured, and when nothing is queued.
 */
export const DESIGN_GENERATION_WORKER_ENABLED = process.env.DESIGN_GENERATION_WORKER_ENABLED !== 'false'

/**
 * Jobs this process runs at once. One by default: a job holds the source
 * photo, the generated image and a sharp pipeline in memory at the same time,
 * and the instance is small. Raising it multiplies peak memory.
 */
export const DESIGN_GENERATION_WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.DESIGN_GENERATION_WORKER_CONCURRENCY || '1', 10) || 1
)

/**
 * How often an idle worker looks for work. A poll, not a busy loop: after a
 * job finishes the worker tries again immediately, so a queue drains without
 * waiting for the next tick.
 */
export const DESIGN_GENERATION_WORKER_POLL_MS = 15 * 1000

/** Delay before the first poll, so startup is never blocked by a job. */
export const DESIGN_GENERATION_WORKER_FIRST_RUN_MS = 20 * 1000

/* ── The sweep ─────────────────────────────────────────────────────────── */

export const DESIGN_GENERATION_SWEEP_FIRST_RUN_MS = 90 * 1000
export const DESIGN_GENERATION_SWEEP_INTERVAL_MS = 15 * 60 * 1000
export const DESIGN_GENERATION_SWEEP_BATCH_SIZE = 25

/* ── History ───────────────────────────────────────────────────────────── */

/** Delivery type of the stored result. Private, exactly like a room photo. */
export const DESIGN_GENERATION_RESULT_DELIVERY_TYPE = 'authenticated'

export const DESIGN_GENERATION_PAGE_SIZE = 20
export const DESIGN_GENERATION_MAX_PAGE_SIZE = 50
