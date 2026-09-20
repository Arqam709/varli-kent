// Generation deletion, retention and the cleanup sweep.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDesignGenerationModel } from './helpers/fakeDesignGenerationModel.js'
import { DESIGN_GENERATION_SWEEP_BATCH_SIZE } from '../config/designGenerations.js'

const Generation = createFakeDesignGenerationModel()
mock.module('../models/DesignGeneration.js', { defaultExport: Generation })

const destroyed = []
let destroyFailure = null

mock.module('../services/designGenerations/resultStorage.js', {
  namedExports: {
    destroyGenerationResultAsset: async (publicId, deliveryType) => {
      destroyed.push({ publicId, deliveryType })
      if (destroyFailure) throw destroyFailure
      return true
    },
  },
})

const lifecycle = await import('../services/designGenerations/lifecycle.js')

const USER_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const USER_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let counter = 0

const seed = (overrides = {}) => Generation.seed({
  user: USER_A,
  board: '11aaaaaaaaaaaaaaaaaaaaaa',
  boardSnapshot: { version: 1, room: 'kitchen', style: 'warm', wall: { label: 'Sand', color: '#e8ddd0' }, floor: { label: 'Oak', color: '#4a3728' }, materials: [], lighting: 'day' },
  roomPhoto: '22aaaaaaaaaaaaaaaaaaaaaa',
  status: 'queued',
  promptVersion: 'room-restyle-v1',
  idempotencyKey: `life-key-${(++counter).toString().padStart(4, '0')}`,
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
})

const stored = (generation) => Generation.docs.get(generation._id)
const resultAsset = { publicId: 'varlikent/test/design-generations/x', deliveryType: 'authenticated', format: 'jpg', width: 1024, height: 768, bytes: 1000 }

beforeEach(() => {
  Generation.docs.clear()
  Generation.calls.length = 0
  destroyed.length = 0
  destroyFailure = null
})

/* ═══════════════ Deleting one ═══════════════ */

test('the owner deletes a visualization; it is hidden and, with no result, purged at once', async () => {
  const generation = seed({ status: 'failed' })
  const deleted = await lifecycle.deleteGenerationForUser(generation._id, USER_A)

  assert.equal(deleted.status, 'deleted')
  assert.ok(stored(generation).deletedAt && stored(generation).purgedAt)
})

test('another user cannot delete it, and an already deleted one is not re-deleted', async () => {
  const generation = seed()
  assert.equal(await lifecycle.deleteGenerationForUser(generation._id, USER_B), null)
  assert.equal(stored(generation).status, 'queued')

  await lifecycle.deleteGenerationForUser(generation._id, USER_A)
  assert.equal(await lifecycle.deleteGenerationForUser(generation._id, USER_A), null)
})

test('deleting a generation destroys its generated image and records the purge', async () => {
  const generation = seed({ status: 'succeeded', result: resultAsset, completedAt: new Date() })
  await lifecycle.deleteGenerationForUser(generation._id, USER_A)

  assert.equal(stored(generation).status, 'deleted')
  assert.deepEqual(destroyed, [{ publicId: resultAsset.publicId, deliveryType: 'authenticated' }])
  assert.ok(stored(generation).purgedAt)
})

test('a result that cannot be destroyed is never recorded as purged, and the sweep retries', async () => {
  const generation = seed({ status: 'succeeded', result: resultAsset, completedAt: new Date() })
  destroyFailure = new Error('storage unavailable')

  const originalError = console.error
  console.error = () => {}
  try {
    await lifecycle.deleteGenerationForUser(generation._id, USER_A)
  } finally {
    console.error = originalError
  }

  // Hidden from the user immediately...
  assert.equal(stored(generation).status, 'deleted')
  // ...but never marked purged while the image may still exist.
  assert.equal(stored(generation).purgedAt, null)

  destroyFailure = null
  const swept = await lifecycle.sweepDesignGenerations()
  assert.equal(swept.purged, 1)
  assert.ok(stored(generation).purgedAt)
  assert.equal(destroyed.length, 2, 'the purge was not retried')
})

test('deleting a generation never touches the room photo it was made from', async () => {
  const generation = seed({ status: 'succeeded', result: resultAsset, completedAt: new Date() })
  await lifecycle.deleteGenerationForUser(generation._id, USER_A)

  assert.equal(destroyed.every(({ publicId }) => publicId.includes('design-generations')), true,
    'deletion reached outside the generation result path')
  assert.equal(destroyed.some(({ publicId }) => publicId.includes('design-room-photos')), false)
})

/* ═══════════════ The sweep ═══════════════ */

test('the sweep recovers, expires, deletes and purges — and leaves live work alone', async () => {
  const now = new Date()
  const abandoned = seed({ status: 'processing', attempts: 1, leaseUntil: new Date(now - 1000) })
  const expired = seed({ status: 'succeeded', result: null, expiresAt: new Date(now - 1000) })
  const live = seed({ status: 'queued', createdAt: now })
  const deleted = seed({ status: 'deleted', deletedAt: new Date(now - 5000) })

  const outcome = await lifecycle.sweepDesignGenerations({ now })

  assert.equal(stored(abandoned).status, 'queued', 'abandoned work was not requeued')
  assert.equal(outcome.requeued, 1)
  assert.equal(stored(expired).status, 'deleted', 'a generation past retention was kept')
  assert.equal(outcome.expired, 1)
  assert.equal(stored(live).status, 'queued', 'fresh work was swept away')
  assert.ok(stored(deleted).purgedAt)
  assert.ok(outcome.purged >= 1)
})

test('the sweep is idempotent and works in bounded batches', async () => {
  for (let i = 0; i < DESIGN_GENERATION_SWEEP_BATCH_SIZE + 3; i += 1) {
    seed({ status: 'deleted', deletedAt: new Date(Date.now() - (100 - i) * 1000) })
  }

  const first = await lifecycle.sweepDesignGenerations()
  assert.equal(first.purged, DESIGN_GENERATION_SWEEP_BATCH_SIZE)
  const second = await lifecycle.sweepDesignGenerations()
  assert.equal(second.purged, 3)
  const third = await lifecycle.sweepDesignGenerations()
  assert.equal(third.purged, 0)
})

test('starting the sweeper returns immediately and runs nothing yet', () => {
  lifecycle.startDesignGenerationSweeper()
  lifecycle.startDesignGenerationSweeper()
  assert.deepEqual(Generation.calls, [])
  lifecycle.stopDesignGenerationSweeper()
})

/* ═══════════════ Account deletion ═══════════════ */

test('deleting an account hides every one of that user’s visualizations and no one else’s', async () => {
  const queued = seed()
  const succeeded = seed({ status: 'succeeded', result: null, completedAt: new Date() })
  const failed = seed({ status: 'failed' })
  const other = seed({ user: USER_B })

  const outcome = await lifecycle.deleteAllGenerationsForUser(USER_A)
  assert.equal(outcome.deleted, 3)
  assert.equal(outcome.pending, 0)

  for (const generation of [queued, succeeded, failed]) {
    assert.equal(stored(generation).status, 'deleted')
    assert.ok(stored(generation).purgedAt)
  }
  assert.equal(stored(other).status, 'queued')
})
