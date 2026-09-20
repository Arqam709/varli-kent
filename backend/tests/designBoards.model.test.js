// The DesignBoard Mongoose schema itself — validated without a database.
//
// Complements designBoards.routes.test.js (which mocks the model): this proves
// the schema would refuse the same bad data even if a future code path wrote
// to the collection without going through the route validator.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import DesignBoard from '../models/DesignBoard.js'

const OWNER = new mongoose.Types.ObjectId()

const valid = (overrides = {}) => ({
  user: OWNER,
  clientId: 'dms-lx1-abc12345',
  room: 'kitchen',
  style: 'contemporary',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'cool',
  ...overrides,
})

test('boards live in their own designboards collection', () => {
  assert.equal(DesignBoard.collection.collectionName, 'designboards')
})

test('a complete board validates, with version 1 and timestamps enabled', () => {
  const board = new DesignBoard(valid())
  assert.equal(board.validateSync(), undefined)
  assert.equal(board.version, 1)
  assert.ok(DesignBoard.schema.options.timestamps)
})

test('the owner is required, and the schema refuses unknown ids and malformed snapshots', () => {
  const invalid = {
    'no owner': { user: undefined },
    'unknown room': { room: 'attic' },
    'unknown style': { style: 'brutalist' },
    'unknown lighting': { lighting: 'dawn' },
    'no wall': { wall: undefined },
    'bad colour': { floor: { label: 'Oak', color: 'oak' } },
    'overlong label': { wall: { label: 'x'.repeat(81), color: '#ffffff' } },
    'too many materials': { materials: Array.from({ length: 25 }, (_, i) => ({ name: `M${i}`, color: '#111111' })) },
    'non-http texture': { materials: [{ name: 'Oak', color: '#111111', image: 'ftp://x/y.jpg' }] },
    'bad clientId': { clientId: 'has spaces' },
    'future version': { version: 2 },
  }

  for (const [label, overrides] of Object.entries(invalid)) {
    assert.ok(new DesignBoard(valid(overrides)).validateSync(), `${label} passed schema validation`)
  }
})

test('the owner and the device id can never be changed once set', () => {
  assert.equal(DesignBoard.schema.path('user').options.immutable, true)
  assert.equal(DesignBoard.schema.path('clientId').options.immutable, true)

  const board = new DesignBoard(valid())
  board.$isNew = false
  board.user = new mongoose.Types.ObjectId()
  board.clientId = 'dms-other'
  assert.equal(String(board.user), String(OWNER))
  assert.equal(board.clientId, 'dms-lx1-abc12345')
})

test('indexes serve the owner-scoped list and make a device id unique per user only', () => {
  const indexes = DesignBoard.schema.indexes()

  assert.ok(indexes.some(([keys]) => JSON.stringify(keys) === JSON.stringify({ user: 1 })))
  assert.ok(indexes.some(([keys]) => JSON.stringify(keys) === JSON.stringify({ user: 1, updatedAt: -1 })))

  const unique = indexes.find(([keys]) => JSON.stringify(keys) === JSON.stringify({ user: 1, clientId: 1 }))
  assert.ok(unique, 'no (user, clientId) index')
  assert.equal(unique[1].unique, true)
  assert.deepEqual(unique[1].partialFilterExpression, { clientId: { $type: 'string' } })
})

test('the backend vocabulary is exactly what the schema enforces', async () => {
  const vocabulary = await import('../config/designBoardVocabulary.js')
  assert.deepEqual(DesignBoard.schema.path('room').enumValues, vocabulary.DESIGN_ROOM_IDS)
  assert.deepEqual(DesignBoard.schema.path('style').enumValues, vocabulary.DESIGN_STYLE_IDS)
  assert.deepEqual(DesignBoard.schema.path('lighting').enumValues, vocabulary.DESIGN_LIGHTING_IDS)
})
