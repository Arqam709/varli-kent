// Room photo deletion, retention and cleanup: logical first, physical second,
// retried until confirmed — and never "deleted" by MongoDB alone.

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDesignRoomPhotoModel } from './helpers/fakeDesignRoomPhotoModel.js'
import {
  ROOM_PHOTO_CONSENT_VERSION,
  ROOM_PHOTO_STALE_UPLOAD_MS,
  ROOM_PHOTO_SWEEP_BATCH_SIZE,
} from '../config/designRoomPhotos.js'

const Model = createFakeDesignRoomPhotoModel()
mock.module('../models/DesignRoomPhoto.js', { defaultExport: Model })

const destroyed = []
const failing = new Set()
let destroyGate = null

mock.module('../services/designRoomPhotos/storage.js', {
  namedExports: {
    destroyRoomPhoto: async (publicId, deliveryType) => {
      if (destroyGate) await destroyGate
      destroyed.push({ publicId, deliveryType })
      if (failing.has(publicId)) throw new Error('storage unavailable')
      return true
    },
  },
})

const lifecycle = await import('../services/designRoomPhotos/lifecycle.js')

const USER_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const USER_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let counter = 0

const seed = (overrides = {}) => {
  counter += 1
  const _id = counter.toString(16).padStart(24, 'c')
  return Model.seed({
    _id,
    user: USER_A,
    asset: { publicId: `varlikent/test/design-room-photos/${_id}`, deliveryType: 'authenticated', format: 'jpg' },
    width: 2048,
    height: 1536,
    bytes: 1000,
    status: 'ready',
    consentVersion: ROOM_PHOTO_CONSENT_VERSION,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  })
}

beforeEach(() => {
  Model.docs.clear()
  Model.calls.length = 0
  destroyed.length = 0
  failing.clear()
  destroyGate = null
})

const status = (photo) => Model.docs.get(photo._id)

/* ═══════════════ One photo ═══════════════ */

test('purging a deleted photo destroys its asset and records the purge', async () => {
  const photo = seed({ status: 'deleted', deletedAt: new Date() })
  assert.equal(await lifecycle.purgeRoomPhotoAsset(photo), true)
  assert.deepEqual(destroyed, [{ publicId: photo.asset.publicId, deliveryType: 'authenticated' }])
  assert.ok(status(photo).purgedAt)
})

test('a photo that is not deleted is never destroyed', async () => {
  for (const photoStatus of ['ready', 'uploading']) {
    const photo = seed({ status: photoStatus })
    assert.equal(await lifecycle.purgeRoomPhotoAsset(photo), false)
  }
  assert.deepEqual(destroyed, [])
})

test('a failed destroy leaves the photo unpurged for a later retry, which then succeeds', async () => {
  const photo = seed({ status: 'deleted', deletedAt: new Date() })
  failing.add(photo.asset.publicId)

  assert.equal(await lifecycle.purgeRoomPhotoAsset(photo), false)
  assert.equal(status(photo).purgedAt, null)

  failing.clear()
  const result = await lifecycle.sweepRoomPhotos()
  assert.equal(result.purged, 1)
  assert.ok(status(photo).purgedAt)
})

/* ═══════════════ The sweep ═══════════════ */

test('the sweep hides and purges stale uploads, expired photos and deleted photos — and nothing else', async () => {
  const now = new Date()
  const stale = seed({ status: 'uploading', createdAt: new Date(now - ROOM_PHOTO_STALE_UPLOAD_MS - 1000) })
  const inFlight = seed({ status: 'uploading', createdAt: new Date(now - 5000) })
  const expired = seed({ expiresAt: new Date(now - 1000) })
  const live = seed({ expiresAt: new Date(now.getTime() + 60_000) })
  const deleted = seed({ status: 'deleted', deletedAt: new Date(now - 1000) })
  const alreadyPurged = seed({ status: 'deleted', deletedAt: new Date(now - 5000), purgedAt: new Date(now - 4000) })

  const result = await lifecycle.sweepRoomPhotos({ now })
  assert.deepEqual(result, { staleUploads: 1, expired: 1, purged: 3, failed: 0 })

  for (const photo of [stale, expired, deleted]) {
    assert.equal(status(photo).status, 'deleted')
    assert.ok(status(photo).purgedAt)
  }
  assert.equal(status(inFlight).status, 'uploading', 'an upload still in progress was killed')
  assert.equal(status(live).status, 'ready', 'a live photo was deleted')
  assert.deepEqual(destroyed.map((d) => d.publicId).sort(), [stale, expired, deleted].map((p) => p.asset.publicId).sort())
  assert.equal(destroyed.some((d) => d.publicId === alreadyPurged.asset.publicId), false)
})

test('the sweep is idempotent', async () => {
  seed({ status: 'deleted', deletedAt: new Date() })
  await lifecycle.sweepRoomPhotos()
  const second = await lifecycle.sweepRoomPhotos()
  assert.deepEqual(second, { staleUploads: 0, expired: 0, purged: 0, failed: 0 })
  assert.equal(destroyed.length, 1)
})

test('the sweep works in bounded batches, oldest deletion first', async () => {
  const total = ROOM_PHOTO_SWEEP_BATCH_SIZE + 5
  for (let i = 0; i < total; i += 1) seed({ status: 'deleted', deletedAt: new Date(Date.now() - (total - i) * 1000) })

  const first = await lifecycle.sweepRoomPhotos()
  assert.equal(first.purged, ROOM_PHOTO_SWEEP_BATCH_SIZE)
  const second = await lifecycle.sweepRoomPhotos()
  assert.equal(second.purged, 5)
})

test('only one sweep runs at a time in a process', async () => {
  seed({ status: 'deleted', deletedAt: new Date() })
  let release
  destroyGate = new Promise((resolve) => { release = resolve })

  const first = lifecycle.runRoomPhotoSweepOnce()
  const overlapping = await lifecycle.runRoomPhotoSweepOnce()
  assert.equal(overlapping, null, 'a second sweep ran concurrently')

  release()
  assert.equal((await first).purged, 1)
})

test('a sweep that hits a database error reports it without throwing', async () => {
  Model.failures.updateMany = new Error('mongo down')
  const originalError = console.error
  console.error = () => {}
  try {
    assert.equal(await lifecycle.runRoomPhotoSweepOnce(), null)
  } finally {
    console.error = originalError
  }
})

test('starting the sweeper returns immediately and does not run anything yet', () => {
  lifecycle.startRoomPhotoSweeper()
  lifecycle.startRoomPhotoSweeper() // idempotent
  assert.deepEqual(Model.calls, [])
  lifecycle.stopRoomPhotoSweeper()
})

/* ═══════════════ Account deletion ═══════════════ */

test('deleting a user hides every live photo, purges what it can, and leaves other users alone', async () => {
  const ready = seed()
  const uploading = seed({ status: 'uploading' })
  const unreachable = seed()
  failing.add(unreachable.asset.publicId)
  const other = seed({ user: USER_B })

  const result = await lifecycle.deleteAllRoomPhotosForUser(USER_A)
  assert.deepEqual(result, { deleted: 3, purged: 2, pending: 1 })

  for (const photo of [ready, uploading, unreachable]) assert.equal(status(photo).status, 'deleted')
  assert.equal(status(unreachable).purgedAt, null, 'an unconfirmed destroy was recorded')
  assert.equal(status(other).status, 'ready')
  assert.equal(destroyed.some((d) => d.publicId === other.asset.publicId), false)
})

test('if photos cannot even be hidden, the error reaches the caller', async () => {
  seed()
  Model.failures.updateMany = new Error('mongo down')
  await assert.rejects(lifecycle.deleteAllRoomPhotosForUser(USER_A), /mongo down/)
})
