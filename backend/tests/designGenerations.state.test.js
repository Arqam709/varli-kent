// The generation state machine and the job boundary a Phase 2 worker will use.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDesignGenerationModel } from './helpers/fakeDesignGenerationModel.js'
import {
  DESIGN_GENERATION_LEASE_MS,
  DESIGN_GENERATION_MAX_ATTEMPTS,
  DESIGN_GENERATION_STATUSES,
} from '../config/designGenerations.js'

const Generation = createFakeDesignGenerationModel()
mock.module('../models/DesignGeneration.js', { defaultExport: Generation })

const state = await import('../services/designGenerations/generationState.js')

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PHOTO = '22aaaaaaaaaaaaaaaaaaaaaa'
let counter = 0

const seed = (overrides = {}) => Generation.seed({
  user: USER,
  board: '11aaaaaaaaaaaaaaaaaaaaaa',
  boardSnapshot: { version: 1, room: 'kitchen', style: 'warm', wall: { label: 'Sand', color: '#e8ddd0' }, floor: { label: 'Oak', color: '#4a3728' }, materials: [], lighting: 'day' },
  roomPhoto: PHOTO,
  status: 'queued',
  promptVersion: 'room-restyle-v1',
  idempotencyKey: `state-key-${(++counter).toString().padStart(4, '0')}`,
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
})

const stored = (generation) => Generation.docs.get(generation._id)
const result = () => ({ publicId: 'varlikent/test/design-generations/x', deliveryType: 'authenticated', format: 'jpg', width: 1024, height: 768, bytes: 1000 })

beforeEach(() => {
  Generation.docs.clear()
  Generation.calls.length = 0
})

/* ═══════════════ The transition table ═══════════════ */

test('only the intended transitions are allowed', () => {
  const allowed = [
    ['queued', 'processing'], ['queued', 'failed'], ['queued', 'deleted'],
    ['processing', 'succeeded'], ['processing', 'failed'], ['processing', 'queued'], ['processing', 'deleted'],
    ['succeeded', 'deleted'], ['failed', 'deleted'],
  ]
  for (const [from, to] of allowed) {
    assert.equal(state.canTransitionGeneration(from, to), true, `${from} → ${to} should be allowed`)
  }

  // Everything else, including the jumps a client might try.
  for (const from of DESIGN_GENERATION_STATUSES) {
    for (const to of DESIGN_GENERATION_STATUSES) {
      if (allowed.some(([a, b]) => a === from && b === to)) continue
      assert.equal(state.canTransitionGeneration(from, to), false, `${from} → ${to} should be refused`)
    }
  }
  assert.equal(state.canTransitionGeneration('queued', 'succeeded'), false)
  assert.equal(state.canTransitionGeneration('failed', 'processing'), false)
  assert.equal(state.canTransitionGeneration('deleted', 'succeeded'), false)
})

/* ═══════════════ Claiming ═══════════════ */

test('claiming takes the oldest queued job, sets a lease and counts the attempt', async () => {
  const older = seed({ createdAt: new Date(Date.now() - 60_000) })
  const newer = seed({ createdAt: new Date() })

  const claimed = await state.claimNextGeneration()
  assert.equal(claimed._id, older._id)
  assert.equal(claimed.status, 'processing')
  assert.equal(claimed.attempts, 1)
  assert.ok(claimed.startedAt)
  const lease = new Date(claimed.leaseUntil) - Date.now()
  assert.ok(Math.abs(lease - DESIGN_GENERATION_LEASE_MS) < 5000, `lease was ${lease}ms`)

  assert.equal(stored(newer).status, 'queued', 'a second job was claimed at the same time')
})

test('a job already claimed and still leased is not handed out again', async () => {
  seed({ status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) })
  assert.equal(await state.claimNextGeneration(), null)
})

test('an expired lease can be reclaimed until the attempts run out', async () => {
  const abandoned = seed({ status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() - 1000) })
  const reclaimed = await state.claimNextGeneration()
  assert.equal(reclaimed._id, abandoned._id)
  assert.equal(reclaimed.attempts, 2)

  Generation.docs.clear()
  seed({ status: 'processing', attempts: DESIGN_GENERATION_MAX_ATTEMPTS, leaseUntil: new Date(Date.now() - 1000) })
  assert.equal(await state.claimNextGeneration(), null, 'a job past its attempt limit was claimed again')
})

test('nothing to do returns null rather than inventing work', async () => {
  seed({ status: 'succeeded', result: result() })
  seed({ status: 'failed' })
  seed({ status: 'deleted', deletedAt: new Date() })
  assert.equal(await state.claimNextGeneration(), null)
})

/* ═══════════════ Finishing ═══════════════ */

test('success requires a real stored result — this is what Phase 1 cannot fake', async () => {
  const generation = seed({ status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) })

  await assert.rejects(state.completeGeneration(generation._id, {}), /without a stored result/)
  await assert.rejects(state.completeGeneration(generation._id, { result: {} }), /without a stored result/)
  assert.equal(stored(generation).status, 'processing')

  const done = await state.completeGeneration(generation._id, { result: result() })
  assert.equal(done.status, 'succeeded')
  assert.ok(done.completedAt)
  assert.equal(done.leaseUntil, null)
})

test('a generation that is not processing cannot be completed', async () => {
  for (const status of ['queued', 'failed', 'deleted', 'succeeded']) {
    const generation = seed({ status })
    assert.equal(await state.completeGeneration(generation._id, { result: result() }), null, status)
    assert.equal(stored(generation).status, status)
  }
})

test('a retryable failure goes back to the queue; a final one ends the job', async () => {
  const retryable = seed({ status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() + 1000) })
  const requeued = await state.failGeneration(retryable._id, { code: 'PROVIDER_FAILED', retryable: true })
  assert.equal(requeued.status, 'queued')
  assert.equal(requeued.leaseUntil, null)

  const exhausted = seed({ status: 'processing', attempts: DESIGN_GENERATION_MAX_ATTEMPTS })
  const failed = await state.failGeneration(exhausted._id, { code: 'PROVIDER_FAILED', retryable: true })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error.code, 'PROVIDER_FAILED')

  const blocked = seed({ status: 'processing', attempts: 1 })
  assert.equal((await state.failGeneration(blocked._id, { code: 'PROVIDER_REJECTED_CONTENT' })).status, 'failed')

  // A finished generation is not re-failed.
  const done = seed({ status: 'succeeded', result: result() })
  assert.equal(await state.failGeneration(done._id, { code: 'PROVIDER_FAILED' }), null)
})

/* ═══════════════ Recovery ═══════════════ */

test('abandoned work is requeued, and gives up once attempts are spent', async () => {
  const requeue = seed({ status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() - 1000) })
  const giveUp = seed({ status: 'processing', attempts: DESIGN_GENERATION_MAX_ATTEMPTS, leaseUntil: new Date(Date.now() - 1000) })
  const working = seed({ status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) })

  const outcome = await state.recoverStaleGenerations()
  assert.deepEqual(outcome, { failed: 1, requeued: 1 })
  assert.equal(stored(requeue).status, 'queued')
  assert.equal(stored(giveUp).status, 'failed')
  assert.equal(stored(giveUp).error.code, 'LEASE_EXPIRED')
  assert.equal(stored(working).status, 'processing', 'a live worker was interrupted')

  // Running it again changes nothing.
  assert.deepEqual(await state.recoverStaleGenerations(), { failed: 0, requeued: 0 })
})

test('a job nobody ever claimed fails instead of waiting forever', async () => {
  const old = seed({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
  const fresh = seed({ createdAt: new Date() })

  assert.equal(await state.failStaleQueuedGenerations({ maxAgeMs: 60 * 60 * 1000 }), 1)
  assert.equal(stored(old).status, 'failed')
  assert.equal(stored(old).error.code, 'NOT_PROCESSED_IN_TIME')
  assert.equal(stored(fresh).status, 'queued')
})

test('deleting a room photo ends only the jobs that still need it', async () => {
  const queued = seed({ status: 'queued' })
  const processing = seed({ status: 'processing', attempts: 1 })
  const succeeded = seed({ status: 'succeeded', result: result(), completedAt: new Date() })
  const other = seed({ roomPhoto: '22cccccccccccccccccccccc' })

  assert.equal(await state.failGenerationsForRoomPhoto(PHOTO), 2)
  for (const generation of [queued, processing]) {
    assert.equal(stored(generation).status, 'failed')
    assert.equal(stored(generation).error.code, 'SOURCE_PHOTO_UNAVAILABLE')
  }
  // History keeps its own result asset, which is not the room photo.
  assert.equal(stored(succeeded).status, 'succeeded')
  assert.equal(stored(other).status, 'queued')
})
