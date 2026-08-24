import test from 'node:test'
import assert from 'node:assert/strict'

import PushDevice from '../models/PushDevice.js'

test('PushDevice supports an anonymous null user without changing token uniqueness', () => {
  const userPath = PushDevice.schema.path('user')
  const tokenPath = PushDevice.schema.path('token')

  assert.notEqual(userPath.options.required, true)
  assert.equal(userPath.defaultValue, null)
  assert.equal(tokenPath.options.unique, true)

  const indexes = PushDevice.schema.indexes()
  assert.ok(
    indexes.some(([fields]) => fields.user === 1 && fields.active === 1),
    'the existing active-user send index remains'
  )
})