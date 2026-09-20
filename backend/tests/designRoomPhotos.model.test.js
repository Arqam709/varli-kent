// The DesignRoomPhoto schema, validated without a database.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import DesignRoomPhoto from '../models/DesignRoomPhoto.js'
import {
  ROOM_PHOTO_CONSENT_VERSION,
  ROOM_PHOTO_PURGED_RECORD_TTL_SECONDS,
} from '../config/designRoomPhotos.js'

const OWNER = new mongoose.Types.ObjectId()

const valid = (overrides = {}) => ({
  user: OWNER,
  asset: { publicId: 'varlikent/test/design-room-photos/64b7f0c2a1b2c3d4e5f60718', deliveryType: 'authenticated', format: 'jpg' },
  width: 2048,
  height: 1536,
  bytes: 412345,
  status: 'ready',
  consentVersion: ROOM_PHOTO_CONSENT_VERSION,
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
})

test('room photos live in their own collection', () => {
  assert.equal(DesignRoomPhoto.collection.collectionName, 'designroomphotos')
})

test('a complete record validates; deletedAt and purgedAt start empty', () => {
  const photo = new DesignRoomPhoto(valid())
  assert.equal(photo.validateSync(), undefined)
  assert.equal(photo.deletedAt, null)
  assert.equal(photo.purgedAt, null)
  assert.ok(DesignRoomPhoto.schema.options.timestamps)
})

test('the owner, storage identity, dimensions, consent and expiry are required and constrained', () => {
  const invalid = {
    'no owner': { user: undefined },
    'no asset': { asset: undefined },
    'no public id': { asset: { deliveryType: 'authenticated', format: 'jpg' } },
    'public delivery': { asset: { publicId: 'x', deliveryType: 'upload', format: 'jpg' } },
    'other format': { asset: { publicId: 'x', deliveryType: 'authenticated', format: 'png' } },
    'no width': { width: undefined },
    'fractional height': { height: 10.5 },
    'zero bytes': { bytes: 0 },
    'unknown status': { status: 'processing' },
    'unknown consent': { consentVersion: 'whatever' },
    'no expiry': { expiresAt: undefined },
  }
  for (const [label, overrides] of Object.entries(invalid)) {
    assert.ok(new DesignRoomPhoto(valid(overrides)).validateSync(), `${label} passed validation`)
  }
})

test('the schema has no place for URLs, filenames, EXIF, boards or AI data', () => {
  const paths = Object.keys(DesignRoomPhoto.schema.paths)
  for (const forbidden of ['url', 'secureUrl', 'filename', 'originalName', 'mimeType', 'exif', 'gps', 'board', 'generation', 'prompt', 'provider']) {
    assert.equal(paths.some((p) => p.toLowerCase().includes(forbidden.toLowerCase())), false, `schema has ${forbidden}`)
  }
  // Strict mode drops anything unknown instead of storing it.
  const photo = new DesignRoomPhoto({ ...valid(), url: 'https://x', exif: { gps: 1 }, board: OWNER })
  assert.equal(photo.url, undefined)
  assert.equal(photo.get('exif'), undefined)
  assert.equal(photo.get('board'), undefined)
})

test('owner, storage identity, dimensions and consent cannot change after creation', () => {
  for (const path of ['user', 'width', 'height', 'bytes', 'consentVersion', 'asset.publicId', 'asset.deliveryType', 'asset.format']) {
    assert.equal(DesignRoomPhoto.schema.path(path).options.immutable, true, `${path} is mutable`)
  }

  const photo = new DesignRoomPhoto(valid())
  photo.$isNew = false
  photo.user = new mongoose.Types.ObjectId()
  photo.width = 1
  assert.equal(String(photo.user), String(OWNER))
  assert.equal(photo.width, 2048)
})

test('indexes serve owner queries, the sweep, unique storage identity and purged-record expiry', () => {
  const indexes = DesignRoomPhoto.schema.indexes().map(([keys, options]) => [JSON.stringify(keys), options])
  const find = (keys) => indexes.find(([k]) => k === JSON.stringify(keys))

  assert.ok(find({ user: 1, status: 1, createdAt: -1 }))
  assert.ok(find({ status: 1, purgedAt: 1 }))
  assert.ok(find({ status: 1, expiresAt: 1 }))
  assert.ok(find({ status: 1, createdAt: 1 }))
  assert.equal(find({ 'asset.publicId': 1 })[1].unique, true)
  // TTL only on purgedAt: MongoDB can only ever remove a record whose asset is gone.
  const ttl = indexes.filter(([, options]) => options?.expireAfterSeconds !== undefined)
  assert.deepEqual(ttl.map(([k]) => k), [JSON.stringify({ purgedAt: 1 })])
  assert.equal(ttl[0][1].expireAfterSeconds, ROOM_PHOTO_PURGED_RECORD_TTL_SECONDS)
  assert.ok(ROOM_PHOTO_PURGED_RECORD_TTL_SECONDS > 24 * 60 * 60, 'purged records must outlive the daily upload window')
})
