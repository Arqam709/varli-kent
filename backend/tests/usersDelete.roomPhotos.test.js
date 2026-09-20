// Permanent account deletion (DELETE /api/users/:id) must not leave the
// user's private Design My Space data behind: room photos or visualizations.

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

const OWNER = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', role: 'owner', permissions: [] }
const TARGET_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const events = []
let photoFailure = null
let generationFailure = null
let targetUser = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => { req.user = OWNER; next() },
    optionalAuth: (req, res, next) => next(),
    userFromToken: async () => null,
  },
})

mock.module('../models/User.js', {
  defaultExport: {
    findById: async (id) => (targetUser && String(id) === targetUser._id ? targetUser : null),
    findByIdAndDelete: async (id) => { events.push(['deleteUser', String(id)]); return targetUser },
  },
})

mock.module('../services/designRoomPhotos/lifecycle.js', {
  namedExports: {
    deleteAllRoomPhotosForUser: async (userId) => {
      events.push(['deletePhotos', String(userId)])
      if (photoFailure) throw photoFailure
      return { deleted: 2, purged: 2, pending: 0 }
    },
  },
})

mock.module('../services/designGenerations/lifecycle.js', {
  namedExports: {
    deleteAllGenerationsForUser: async (userId) => {
      events.push(['deleteGenerations', String(userId)])
      if (generationFailure) throw generationFailure
      return { deleted: 1, purged: 1, pending: 0 }
    },
  },
})

const { default: userRoutes } = await import('../routes/users.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/users', userRoutes)
  app.use((err, req, res, next) => res.status(500).json({ success: false }))
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/users`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  events.length = 0
  photoFailure = null
  generationFailure = null
  targetUser = { _id: TARGET_ID, role: 'user' }
})

test('visualizations and room photos are removed before the account is deleted', async () => {
  const response = await fetch(`${baseUrl}/${TARGET_ID}`, { method: 'DELETE' })
  assert.equal(response.status, 200)
  // Visualizations first: they are what reference the photos.
  assert.deepEqual(events, [
    ['deleteGenerations', TARGET_ID],
    ['deletePhotos', TARGET_ID],
    ['deleteUser', TARGET_ID],
  ])
})

test('if the photos cannot be hidden, the account is NOT deleted', async () => {
  photoFailure = new Error('mongo down')
  const response = await fetch(`${baseUrl}/${TARGET_ID}`, { method: 'DELETE' })
  assert.equal(response.status, 500)
  assert.deepEqual(events, [['deleteGenerations', TARGET_ID], ['deletePhotos', TARGET_ID]])
})

test('if the visualizations cannot be hidden, neither photos nor the account are touched', async () => {
  generationFailure = new Error('mongo down')
  const response = await fetch(`${baseUrl}/${TARGET_ID}`, { method: 'DELETE' })
  assert.equal(response.status, 500)
  assert.deepEqual(events, [['deleteGenerations', TARGET_ID]])
})

test('refused deletions (owner accounts, missing users) touch no photos', async () => {
  targetUser = { _id: TARGET_ID, role: 'owner' }
  assert.equal((await fetch(`${baseUrl}/${TARGET_ID}`, { method: 'DELETE' })).status, 403)
  targetUser = null
  assert.equal((await fetch(`${baseUrl}/${TARGET_ID}`, { method: 'DELETE' })).status, 404)
  assert.deepEqual(events, [])
})
