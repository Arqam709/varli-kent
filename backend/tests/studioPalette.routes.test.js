import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

let currentUser = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!currentUser) return res.status(401).json({ success: false, message: 'Not authenticated' })
      req.user = currentUser
      return next()
    },
    userFromToken: async () => null,
  },
})

const records = new Map()
const modelCalls = []

class FakeStudioPalette {
  constructor(data) {
    Object.assign(this, data)
  }

  async save() {
    modelCalls.push({ method: 'save', pageKey: this.pageKey })
    records.set(this.pageKey, this)
    return this
  }

  static async findOne({ pageKey }) {
    modelCalls.push({ method: 'findOne', pageKey })
    return records.get(pageKey) ?? null
  }

  static async findOneAndDelete({ pageKey }) {
    modelCalls.push({ method: 'findOneAndDelete', pageKey })
    const record = records.get(pageKey) ?? null
    records.delete(pageKey)
    return record
  }
}

mock.module('../models/StudioPalette.js', { defaultExport: FakeStudioPalette })

const { default: studioPaletteRoutes } = await import('../routes/studioPalette.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/studio-palette', studioPaletteRoutes)
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  currentUser = null
  records.clear()
  modelCalls.length = 0
})

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const material = (overrides = {}) => ({ name: 'Marble', color: '#C9A35A', image: '', ...overrides })
const finish = (overrides = {}) => ({ label: 'Warm white', color: '#FFFFFF', ...overrides })
const validBody = () => ({
  materials: [material()],
  wallFinishes: [finish()],
  floorFinishes: [finish({ label: 'Oak', color: '#8A6240' })],
})
const actor = (role, permissions = []) => ({ _id: `${role}-id`, role, permissions })

test('GET renovation is public and returns palette null when no record exists', async () => {
  const response = await request('GET', '/api/studio-palette/renovation')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { success: true, palette: null })
})

test('GET interior-design is public and returns palette null when no record exists', async () => {
  const response = await request('GET', '/api/studio-palette/interior-design')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { success: true, palette: null })
})

test('GET returns a saved palette', async () => {
  records.set('renovation', new FakeStudioPalette({ pageKey: 'renovation', ...validBody() }))
  const response = await request('GET', '/api/studio-palette/renovation')
  assert.equal(response.status, 200)
  assert.equal(response.body.palette.pageKey, 'renovation')
  assert.deepEqual(response.body.palette.materials, [material()])
})

test('GET rejects an invalid page key without querying the model', async () => {
  const response = await request('GET', '/api/studio-palette/kitchen')
  assert.equal(response.status, 400)
  assert.deepEqual(modelCalls, [])
})

const authorizationCases = [
  ['owner without explicit permission', actor('owner'), 200],
  ['admin with manage_studio_colors', actor('admin', ['manage_studio_colors']), 200],
  ['admin without permission', actor('admin'), 403],
  ['admin with unrelated permission', actor('admin', ['manage_partners']), 403],
  ['agent', actor('agent', ['manage_studio_colors']), 403],
  ['normal user', actor('user', ['manage_studio_colors']), 403],
  ['anonymous', null, 401],
]

for (const method of ['PUT', 'DELETE']) {
  for (const [description, user, expectedStatus] of authorizationCases) {
    test(`${method} authorization: ${description} -> ${expectedStatus}`, async () => {
      currentUser = user
      const response = await request(
        method,
        '/api/studio-palette/renovation',
        method === 'PUT' ? validBody() : undefined,
      )
      assert.equal(response.status, expectedStatus)
      if (expectedStatus === 401 || expectedStatus === 403) assert.deepEqual(modelCalls, [])
    })
  }
}

test('PUT accepts lowercase and uppercase six-digit hex colors', async () => {
  currentUser = actor('owner')
  const lowercase = await request('PUT', '/api/studio-palette/renovation', {
    materials: [material({ color: '#ffffff' })],
  })
  const uppercase = await request('PUT', '/api/studio-palette/interior-design', {
    materials: [material({ color: '#FFFFFF' })],
  })
  assert.equal(lowercase.status, 200)
  assert.equal(uppercase.status, 200)
})

const invalidRequests = [
  ['short hex', { materials: [material({ color: '#fff' })] }],
  ['named color', { materials: [material({ color: 'red' })] }],
  ['missing hash', { materials: [material({ color: 'ffffff' })] }],
  ['invalid hex characters', { materials: [material({ color: '#GGGGGG' })] }],
  ['empty name', { materials: [material({ name: '   ' })] }],
  ['empty label', { wallFinishes: [finish({ label: '' })] }],
  ['overlong name', { materials: [material({ name: 'n'.repeat(81) })] }],
  ['overlong label', { floorFinishes: [finish({ label: 'l'.repeat(81) })] }],
  ['oversized materials', { materials: Array.from({ length: 25 }, (_, index) => material({ name: `M${index}` })) }],
  ['oversized wall finishes', { wallFinishes: Array.from({ length: 17 }, (_, index) => finish({ label: `W${index}` })) }],
  ['oversized floor finishes', { floorFinishes: Array.from({ length: 17 }, (_, index) => finish({ label: `F${index}` })) }],
  ['javascript image', { materials: [material({ image: 'javascript:alert(1)' })] }],
  ['data image', { materials: [material({ image: 'data:image/png;base64,AAAA' })] }],
  ['file image', { materials: [material({ image: 'file:///tmp/a.png' })] }],
  ['non-array group', { materials: material() }],
  ['malformed entry', { materials: [null] }],
  ['missing entry field', { wallFinishes: [{ label: 'White' }] }],
  ['empty array', { materials: [] }],
]

for (const [description, body] of invalidRequests) {
  test(`PUT rejects ${description}`, async () => {
    currentUser = actor('owner')
    const response = await request('PUT', '/api/studio-palette/renovation', body)
    assert.equal(response.status, 400)
    assert.deepEqual(modelCalls, [], 'validation must finish before database access')
  })
}

test('PUT trims names, labels, and HTTP(S) image URLs', async () => {
  currentUser = actor('owner')
  const response = await request('PUT', '/api/studio-palette/renovation', {
    materials: [material({ name: '  Limestone  ', image: ' https://example.com/stone.jpg ' })],
    wallFinishes: [finish({ label: '  Ivory  ' })],
  })
  assert.equal(response.status, 200)
  assert.equal(response.body.palette.materials[0].name, 'Limestone')
  assert.equal(response.body.palette.materials[0].image, 'https://example.com/stone.jpg')
  assert.equal(response.body.palette.wallFinishes[0].label, 'Ivory')
})

test('PUT updates only supplied groups and preserves existing groups', async () => {
  currentUser = actor('owner')
  const existing = new FakeStudioPalette({
    pageKey: 'renovation',
    materials: [material({ name: 'A' })],
    wallFinishes: [finish({ label: 'B' })],
    floorFinishes: [finish({ label: 'C' })],
  })
  records.set('renovation', existing)

  const response = await request('PUT', '/api/studio-palette/renovation', {
    materials: [material({ name: 'NEW', color: '#123456' })],
  })
  assert.equal(response.status, 200)
  assert.equal(existing.materials[0].name, 'NEW')
  assert.equal(existing.wallFinishes[0].label, 'B')
  assert.equal(existing.floorFinishes[0].label, 'C')
})

test('mixed valid and invalid PUT is atomic and performs zero mutation', async () => {
  currentUser = actor('owner')
  const existing = new FakeStudioPalette({
    pageKey: 'renovation',
    materials: [material({ name: 'A' })],
    wallFinishes: [finish({ label: 'B' })],
    floorFinishes: [finish({ label: 'C' })],
  })
  records.set('renovation', existing)
  const snapshot = JSON.parse(JSON.stringify(existing))

  const response = await request('PUT', '/api/studio-palette/renovation', {
    materials: [material({ name: 'NEW' })],
    wallFinishes: [finish({ color: 'red' })],
  })
  assert.equal(response.status, 400)
  assert.deepEqual(JSON.parse(JSON.stringify(existing)), snapshot)
  assert.deepEqual(modelCalls, [])
})

test('DELETE removes only the validated page override and GET then returns null', async () => {
  currentUser = actor('owner')
  records.set('renovation', new FakeStudioPalette({ pageKey: 'renovation', ...validBody() }))
  records.set('interior-design', new FakeStudioPalette({ pageKey: 'interior-design', ...validBody() }))

  const deleted = await request('DELETE', '/api/studio-palette/renovation')
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body, { success: true })
  assert.equal(records.has('renovation'), false)
  assert.equal(records.has('interior-design'), true)

  currentUser = null
  const fetched = await request('GET', '/api/studio-palette/renovation')
  assert.deepEqual(fetched.body, { success: true, palette: null })
})

test('DELETE rejects invalid page key without touching persistence', async () => {
  currentUser = actor('owner')
  const response = await request('DELETE', '/api/studio-palette/kitchen')
  assert.equal(response.status, 400)
  assert.deepEqual(modelCalls, [])
})
