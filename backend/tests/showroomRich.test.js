// Wave 14B — the two rich-showroom fields transplanted from the donor.
//
//   title       localized  optional  heading of the expanded lightbox
//   detailText  localized  optional  prose beside the expanded media
//
// `caption` was already localized in Wave 12A2 and must keep working exactly
// as it did. The properties asserted throughout: a record created before this
// wave stays valid with neither new field (no migration), the two new fields
// behave like `caption` (write-time localized, no provider call when
// unchanged, previous translation kept on failure), and `style` stays scalar
// because the public route filters on it exactly.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

// ── The signed-in actor ─────────────────────────────────────────────────
let currentUser = null

mock.module('../middleware/auth.js', {
  namedExports: {
    protect: (req, res, next) => {
      if (!currentUser) return res.status(401).json({ success: false, message: 'Not authenticated' })
      req.user = currentUser
      next()
    },
    userFromToken: async () => null,
  },
})

// ── Scripted database ───────────────────────────────────────────────────
let store = []
const clone = (v) => JSON.parse(JSON.stringify(v))

const matches = (row, filter) =>
  Object.entries(filter).every(([k, v]) => row[k] === v)

mock.module('../models/ShowroomImage.js', {
  defaultExport: {
    find: (filter = {}) => {
      const rows = store.filter((r) => matches(r, filter))
      return { sort: async () => rows.map((r) => ({ ...clone(r), toObject: () => clone(r) })) }
    },
    findById: async (id) => {
      const row = store.find((r) => String(r._id) === String(id))
      return row ? { ...clone(row), toObject: () => clone(row) } : null
    },
    create: async (data) => {
      const row = { _id: 'new-' + store.length, visible: true, order: 0, ...clone(data) }
      store.push(row)
      return row
    },
    findByIdAndUpdate: async (id, update) => {
      const i = store.findIndex((r) => String(r._id) === String(id))
      if (i === -1) return null
      store[i] = { ...store[i], ...clone(update) }
      return store[i]
    },
    findByIdAndDelete: async (id) => {
      const i = store.findIndex((r) => String(r._id) === String(id))
      if (i === -1) return null
      return store.splice(i, 1)[0]
    },
  },
})

// ── Scripted translation provider ───────────────────────────────────────
let providerCalls = []
let providerBehaviour = {}
const realFetch = globalThis.fetch

const fakeFetch = async (url, options) => {
  const href = String(url)
  if (!href.includes('api.mymemory.translated.net')) return realFetch(url, options)

  providerCalls.push(href)
  const lang = new URL(href).searchParams.get('langpair').split('|')[1]
  const text = new URL(href).searchParams.get('q')

  const mode = providerBehaviour[lang] || 'ok'
  if (mode === 'fail') return { ok: false, json: async () => ({}) }
  if (mode === 'poison') {
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }) }
  }
  return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: `[${lang}] ${text}` } }) }
}

const { default: showroomRoutes, LOCALIZED_SHOWROOM_FIELDS } = await import('../routes/showroom.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/showroom', showroomRoutes)
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message })
  })
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => {
  globalThis.fetch = realFetch
  await new Promise((r) => server.close(r))
})

const OWNER = { _id: 'o1', name: 'Owner', role: 'owner', permissions: [] }

beforeEach(() => {
  currentUser = null
  providerCalls = []
  providerBehaviour = {}
  globalThis.fetch = fakeFetch
  store = []
})

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/* ═══════════ 1. The localized field set ═══════════ */

test('1. title and detailText joined caption in the localized set', () => {
  assert.deepEqual(LOCALIZED_SHOWROOM_FIELDS, ['title', 'caption', 'detailText'])

  // style is matched EXACTLY against req.query.style by the public route, so
  // translating it would silently break service-page filtering.
  for (const scalar of ['serviceType', 'url', 'style', 'order', 'visible', '_id']) {
    assert.ok(!LOCALIZED_SHOWROOM_FIELDS.includes(scalar), `${scalar} must stay scalar`)
  }
})

/* ═══════════ 2. Create ═══════════ */

test('2a. creating an item localizes all three prose fields', async () => {
  currentUser = OWNER

  const res = await request('POST', '/api/showroom', {
    serviceType: 'architecture',
    url: '/uploads/a.png',
    title: 'Bosphorus Villa',
    caption: 'A full renovation',
    detailText: 'Completed in six months across three floors.',
  })

  assert.equal(res.status, 201)
  const saved = store[0]

  for (const field of ['title', 'caption', 'detailText']) {
    assert.equal(saved[field].sourceLang, 'en', `${field} has no sourceLang`)
    for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) {
      assert.ok(saved[field][lang], `${field} missing ${lang}`)
    }
  }
  // 3 fields x 5 target languages.
  assert.equal(providerCalls.length, 15)
})

test('2b. scalar fields never reach the translator', async () => {
  currentUser = OWNER

  await request('POST', '/api/showroom', {
    serviceType: 'interior', url: '/uploads/b.png', style: 'coastal', caption: 'Hello',
  })

  assert.equal(providerCalls.length, 5, 'only the caption should translate')
  const sent = providerCalls.map((u) => decodeURIComponent(u))
  assert.ok(!sent.some((u) => u.includes('coastal')), 'style was translated')
  assert.ok(!sent.some((u) => u.includes('/uploads/')), 'a URL was translated')
  assert.ok(!sent.some((u) => u.includes('interior')), 'serviceType was translated')
})

test('2c. an item with neither new field is accepted', async () => {
  currentUser = OWNER

  const res = await request('POST', '/api/showroom', { serviceType: 'renovation', url: '/u/c.png' })

  assert.equal(res.status, 201)
  assert.equal(store[0].title, undefined, 'an absent optional field was materialised')
  assert.equal(store[0].detailText, undefined)
})

/* ═══════════ 3. Legacy records ═══════════ */

test('3a. a pre-14B record updates without gaining fake content', async () => {
  store = [{ _id: 'legacy1', serviceType: 'architecture', url: '/u/a.png', caption: 'Eski', order: 0, visible: true }]
  currentUser = OWNER

  const res = await request('PUT', '/api/showroom/legacy1', {
    serviceType: 'architecture', url: '/u/a.png', caption: 'Eski', order: 3,
  })

  assert.equal(res.status, 200)
  assert.equal(store[0].order, 3)
  assert.equal(store[0].title, undefined, 'an untouched record gained a title')
  assert.equal(store[0].detailText, undefined, 'an untouched record gained detail text')
})

test('3b. a legacy plain-string caption still reaches the public route', async () => {
  store = [{ _id: 'l1', serviceType: 'architecture', url: '/u/a.png', caption: 'Plain legacy caption', visible: true }]

  const res = await request('GET', '/api/showroom/architecture')

  assert.equal(res.status, 200)
  assert.equal(res.body.images[0].caption, 'Plain legacy caption')
})

/* ═══════════ 4. Translation economics ═══════════ */

const RICH = () => ([{
  _id: 'm1', serviceType: 'interior', url: '/u/a.png', visible: true, order: 0, style: 'coastal',
  title: { sourceLang: 'en', en: 'Villa', tr: 'Villa-tr' },
  caption: { sourceLang: 'en', en: 'A renovation', tr: 'Bir yenileme' },
  detailText: { sourceLang: 'en', en: 'Long detail', tr: 'Uzun detay' },
}])

test('4a. editing ONLY order costs zero provider calls', async () => {
  store = RICH()
  currentUser = OWNER

  const res = await request('PUT', '/api/showroom/m1', {
    serviceType: 'interior', url: '/u/a.png', style: 'coastal', order: 5, visible: true,
    title: 'Villa', caption: 'A renovation', detailText: 'Long detail',
  })

  assert.equal(res.status, 200)
  assert.equal(providerCalls.length, 0, 'unchanged prose was re-translated')
  assert.equal(store[0].order, 5)
  assert.equal(store[0].caption.tr, 'Bir yenileme', 'a good translation was lost')
})

test('4b. editing only the media URL costs zero provider calls', async () => {
  store = RICH()
  currentUser = OWNER

  await request('PUT', '/api/showroom/m1', {
    serviceType: 'interior', url: '/u/CHANGED.png', style: 'coastal',
    title: 'Villa', caption: 'A renovation', detailText: 'Long detail',
  })

  assert.equal(providerCalls.length, 0)
  assert.equal(store[0].url, '/u/CHANGED.png')
})

test('4c. editing one prose field translates only that field', async () => {
  store = RICH()
  currentUser = OWNER

  await request('PUT', '/api/showroom/m1', {
    serviceType: 'interior', url: '/u/a.png',
    title: 'Villa', caption: 'A renovation', detailText: 'A completely new detail',
  })

  assert.equal(providerCalls.length, 5, 'more than the one changed field was translated')
  assert.ok(
    providerCalls.every((u) => decodeURIComponent(u).includes('A completely new detail')),
    'an unchanged field was sent to the provider'
  )
  assert.equal(store[0].title.tr, 'Villa-tr', 'an unchanged field lost its translation')
})

test('4d. one failing language keeps the previous translation', async () => {
  store = RICH()
  currentUser = OWNER
  providerBehaviour = { tr: 'fail' }

  await request('PUT', '/api/showroom/m1', {
    serviceType: 'interior', url: '/u/a.png',
    title: 'Villa', caption: 'A renovation', detailText: 'New detail',
  })

  const field = store[0].detailText
  assert.equal(field.en, 'New detail', 'the source edit was not stored')
  assert.equal(field.tr, 'Uzun detay', 'a failed language overwrote a good translation')
  assert.equal(field.de, '[de] New detail', 'a working language did not update')
})

test('4e. a poisoned translation is never stored', async () => {
  currentUser = OWNER
  providerBehaviour = { tr: 'poison' }

  await request('POST', '/api/showroom', {
    serviceType: 'construction', url: '/u/a.png', title: 'A title',
  })

  assert.equal(store[0].title.tr, undefined, 'the quota warning was stored as Turkish')
  assert.equal(store[0].title.en, 'A title')
})

/* ═══════════ 5. Public reads ═══════════ */

test('5a. the public route returns title and detailText', async () => {
  store = RICH()

  const res = await request('GET', '/api/showroom/interior')
  const img = res.body.images[0]

  assert.equal(img.title.tr, 'Villa-tr')
  assert.equal(img.detailText.en, 'Long detail')
  assert.equal(providerCalls.length, 0, 'a public read called the translator')
})

test('5b. a poisoned stored value is stripped from the public response', async () => {
  store = [{
    _id: 'm1', serviceType: 'interior', url: '/u/a.png', visible: true,
    detailText: { sourceLang: 'en', en: 'Good', tr: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' },
  }]

  const res = await request('GET', '/api/showroom/interior')

  assert.equal(res.body.images[0].detailText.en, 'Good')
  assert.equal(res.body.images[0].detailText.tr, undefined, 'the quota warning was served publicly')
})

test('5c. service filtering and visibility still hold', async () => {
  store = [
    { _id: 'a', serviceType: 'architecture', url: '/a.png', visible: true, title: { en: 'A' } },
    { _id: 'i', serviceType: 'interior', url: '/i.png', visible: true, title: { en: 'I' } },
    { _id: 'h', serviceType: 'architecture', url: '/h.png', visible: false, title: { en: 'H' } },
  ]

  const arch = await request('GET', '/api/showroom/architecture')
  assert.equal(arch.body.images.length, 1, 'service filtering or visibility regressed')
  assert.equal(arch.body.images[0]._id, 'a')

  const interior = await request('GET', '/api/showroom/interior')
  assert.equal(interior.body.images.length, 1)
  assert.equal(interior.body.images[0]._id, 'i', 'records leaked across services')
})

test('5d. the style filter still narrows results', async () => {
  store = [
    { _id: 'c', serviceType: 'interior', url: '/c.png', visible: true, style: 'coastal' },
    { _id: 'k', serviceType: 'interior', url: '/k.png', visible: true, style: 'classic' },
  ]

  const res = await request('GET', '/api/showroom/interior?style=coastal')

  assert.equal(res.body.images.length, 1)
  assert.equal(res.body.images[0]._id, 'c')
})

/* ═══════════ 6. Authorization ═══════════ */

test('6. writing the rich fields still requires owner/admin', async () => {
  const body = { serviceType: 'interior', url: '/u/a.png', title: 'X' }

  currentUser = null
  assert.equal((await request('POST', '/api/showroom', body)).status, 401)

  currentUser = { _id: 'u1', role: 'user', permissions: [] }
  assert.equal((await request('POST', '/api/showroom', body)).status, 403)

  currentUser = { _id: 'g1', role: 'agent', permissions: ['manage_showroom'] }
  assert.equal((await request('POST', '/api/showroom', body)).status, 403)

  assert.equal(store.length, 0)
})
