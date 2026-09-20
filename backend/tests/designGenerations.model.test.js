// The DesignGeneration schema and the server-built board snapshot.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import DesignGeneration from '../models/DesignGeneration.js'
import { buildBoardSnapshot, BoardSnapshotError } from '../services/designGenerations/boardSnapshot.js'
import { buildRoomVisualizationPrompt, DESIGN_PROMPT_VERSION } from '../services/designGenerations/prompt.js'
import { DESIGN_GENERATION_PURGED_RECORD_TTL_SECONDS } from '../config/designGenerations.js'

const OWNER = new mongoose.Types.ObjectId()
const BOARD = new mongoose.Types.ObjectId()
const PHOTO = new mongoose.Types.ObjectId()

const snapshot = (overrides = {}) => ({
  version: 1,
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'night',
  ...overrides,
})

const valid = (overrides = {}) => ({
  user: OWNER,
  board: BOARD,
  boardSnapshot: snapshot(),
  roomPhoto: PHOTO,
  status: 'queued',
  promptVersion: DESIGN_PROMPT_VERSION,
  idempotencyKey: 'abcdefgh-1234',
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
})

const board = (overrides = {}) => ({
  _id: BOARD,
  user: OWNER,
  clientId: 'dms-abc-123',
  version: 1,
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'night',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

/* ═══════════════ The schema ═══════════════ */

test('generations live in their own collection', () => {
  assert.equal(DesignGeneration.collection.collectionName, 'designgenerations')
})

test('a queued generation validates, starts with no result and no error', () => {
  const generation = new DesignGeneration(valid())
  assert.equal(generation.validateSync(), undefined)
  assert.equal(generation.result, null)
  assert.equal(generation.error.code, undefined)
  assert.equal(generation.attempts, 0)
  assert.equal(generation.leaseUntil, null)
  assert.ok(DesignGeneration.schema.options.timestamps)
})

test('the owner, both references, the snapshot, the key and the expiry are required', () => {
  const invalid = {
    'no owner': { user: undefined },
    'no board': { board: undefined },
    'no snapshot': { boardSnapshot: undefined },
    'no room photo': { roomPhoto: undefined },
    'no prompt version': { promptVersion: undefined },
    'no idempotency key': { idempotencyKey: undefined },
    'short key': { idempotencyKey: 'abc' },
    'key with spaces': { idempotencyKey: 'has spaces here' },
    'no expiry': { expiresAt: undefined },
    'unknown status': { status: 'rendering' },
    'unknown error code': { error: { code: 'WHATEVER' } },
    'snapshot without walls': { boardSnapshot: snapshot({ wall: undefined }) },
    'snapshot with unknown room': { boardSnapshot: snapshot({ room: 'attic' }) },
    'snapshot with bad colour': { boardSnapshot: snapshot({ floor: { label: 'Oak', color: 'brown' } }) },
  }
  for (const [label, overrides] of Object.entries(invalid)) {
    assert.ok(new DesignGeneration(valid(overrides)).validateSync(), `${label} passed validation`)
  }
})

test('ownership, both references, the snapshot, the prompt version and the key are immutable', () => {
  for (const path of ['user', 'board', 'boardSnapshot', 'roomPhoto', 'promptVersion', 'idempotencyKey']) {
    assert.equal(DesignGeneration.schema.path(path).options.immutable, true, `${path} is mutable`)
  }

  const generation = new DesignGeneration(valid())
  generation.$isNew = false
  generation.user = new mongoose.Types.ObjectId()
  generation.roomPhoto = new mongoose.Types.ObjectId()
  generation.boardSnapshot = snapshot({ room: 'office' })
  assert.equal(String(generation.user), String(OWNER))
  assert.equal(String(generation.roomPhoto), String(PHOTO))
  assert.equal(generation.boardSnapshot.room, 'living-room')
})

test('the schema has no place for prompt text, provider data or a room-photo asset', () => {
  const paths = Object.keys(DesignGeneration.schema.paths)
  // Exact paths: `promptVersion` is wanted, a `prompt` holding the text is not.
  for (const forbidden of ['prompt', 'providerResponse', 'providerError', 'apiKey', 'roomPhotoAsset', 'sourceUrl', 'url']) {
    assert.equal(paths.includes(forbidden), false, `schema has ${forbidden}`)
  }
  assert.ok(paths.includes('promptVersion'), 'the prompt version must be recorded')
  // The result asset exists for Phase 2 but is separate from the room photo,
  // and its storage identity lives inside the generation, never on the photo.
  const resultPaths = Object.keys(DesignGeneration.schema.path('result').schema.paths)
  assert.deepEqual(resultPaths.sort(), ['bytes', 'deliveryType', 'format', 'height', 'publicId', 'width'])

  const generation = new DesignGeneration({ ...valid(), prompt: 'ignore me', providerResponse: { secret: 1 } })
  assert.equal(generation.get('prompt'), undefined)
  assert.equal(generation.get('providerResponse'), undefined)
})

test('indexes serve history, idempotency, the claim, retention, purge and the photo cascade', () => {
  const indexes = DesignGeneration.schema.indexes().map(([keys, options]) => [JSON.stringify(keys), options])
  const find = (keys) => indexes.find(([k]) => k === JSON.stringify(keys))

  assert.ok(find({ user: 1, status: 1, createdAt: -1 }), 'no history index')
  assert.equal(find({ user: 1, idempotencyKey: 1 })[1].unique, true, 'idempotency is not unique per user')
  assert.ok(find({ status: 1, leaseUntil: 1, createdAt: 1 }), 'no claim index')
  assert.ok(find({ status: 1, expiresAt: 1 }), 'no retention index')
  assert.ok(find({ status: 1, purgedAt: 1 }), 'no purge index')
  assert.ok(find({ roomPhoto: 1, status: 1 }), 'no room-photo cascade index')

  const ttl = indexes.filter(([, options]) => options?.expireAfterSeconds !== undefined)
  assert.deepEqual(ttl.map(([k]) => k), [JSON.stringify({ purgedAt: 1 })])
  assert.equal(ttl[0][1].expireAfterSeconds, DESIGN_GENERATION_PURGED_RECORD_TTL_SECONDS)
})

/* ═══════════════ The snapshot ═══════════════ */

test('a snapshot carries what affects the design and nothing else', () => {
  const built = buildBoardSnapshot(board())

  assert.deepEqual(Object.keys(built).sort(), ['floor', 'lighting', 'materials', 'room', 'style', 'version', 'wall'])
  for (const key of ['_id', 'user', 'clientId', 'createdAt', 'updatedAt']) {
    assert.equal(key in built, false, `the snapshot copied ${key}`)
  }
  assert.deepEqual(built.wall, { label: 'Warm Sand', color: '#e8ddd0' })
  assert.deepEqual(built.materials, [{ name: 'Aged Brass', color: '#b08d57' }])
})

test('a snapshot is a copy: editing the board afterwards cannot rewrite history', () => {
  const source = board()
  const built = buildBoardSnapshot(source)

  // Wednesday: the user edits the same board document.
  source.room = 'office'
  source.wall.label = 'Repainted'
  source.materials.push({ name: 'Concrete', color: '#9a9a96' })

  assert.equal(built.room, 'living-room')
  assert.equal(built.wall.label, 'Warm Sand')
  assert.equal(built.materials.length, 1)
})

test('a board that would not pass the board API’s own rules cannot be snapshotted', () => {
  for (const broken of [{ room: 'attic' }, { lighting: 'dawn' }, { wall: { label: '', color: '#ffffff' } }, { floor: { label: 'Oak', color: 'brown' } }]) {
    assert.throws(() => buildBoardSnapshot(board(broken)), BoardSnapshotError, JSON.stringify(broken))
  }
  assert.throws(() => buildBoardSnapshot(null), BoardSnapshotError)
})

test('a material texture survives the snapshot, and an empty one is dropped', () => {
  const withImage = buildBoardSnapshot(board({ materials: [{ name: 'Oak', color: '#8a6240', image: 'https://res.cloudinary.test/oak.jpg' }] }))
  assert.equal(withImage.materials[0].image, 'https://res.cloudinary.test/oak.jpg')

  const withoutImage = buildBoardSnapshot(board({ materials: [{ name: 'Oak', color: '#8a6240', image: '' }] }))
  assert.equal('image' in withoutImage.materials[0], false)
})

/* ═══════════════ The prompt boundary ═══════════════ */

test('the prompt is built from the snapshot and is versioned, but never stored', () => {
  const prompt = buildRoomVisualizationPrompt(snapshot())

  // Every choice the user made reaches the model.
  assert.match(prompt, /living room/)
  assert.match(prompt, /Warm Sand \(#e8ddd0\)/)
  assert.match(prompt, /Dark Oak \(#4a3728\)/)
  assert.match(prompt, /Aged Brass/)
  assert.match(prompt, /evening lighting/i)

  // And the room in the photograph has to stay that room.
  assert.match(prompt, /Keep the camera position/)
  assert.match(prompt, /Keep every window and door/)
  assert.match(prompt, /Do not add or remove walls/)
  assert.match(prompt, /Do not include any people/)

  // A board with no materials still produces sensible instructions.
  assert.match(buildRoomVisualizationPrompt(snapshot({ materials: [] })), /No specific feature materials/)

  // Only the version is recorded; the text itself is never stored.
  assert.equal(DESIGN_PROMPT_VERSION, 'room-restyle-v1')
  assert.equal(Object.keys(DesignGeneration.schema.paths).includes('prompt'), false)
})
