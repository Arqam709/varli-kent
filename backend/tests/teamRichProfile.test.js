// Wave 14A — the three rich-profile fields transplanted from the donor.
//
//   secondaryPhoto  String   optional  a larger portrait for the profile view
//   longBio         localized optional full biography
//   workImages      [String] optional  portfolio gallery
//
// Two properties matter most and are asserted throughout: an existing Team
// member created before this wave must stay valid with none of them (no
// migration), and `longBio` must behave like `bio` — write-time localized,
// no provider call when unchanged, previous translation kept on failure.
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

mock.module('../models/TeamMember.js', {
  defaultExport: {
    find: (filter = {}) => {
      const rows = store.filter((m) => (filter.visible === undefined ? true : m.visible === filter.visible))
      return { sort: async () => rows.map((r) => ({ ...clone(r), toObject: () => clone(r) })) }
    },
    findById: async (id) => {
      const row = store.find((m) => String(m._id) === String(id))
      return row ? { ...clone(row), toObject: () => clone(row) } : null
    },
    create: async (data) => {
      const row = { _id: 'new-' + store.length, visible: true, order: 0, ...clone(data) }
      store.push(row)
      return row
    },
    findByIdAndUpdate: async (id, update) => {
      const i = store.findIndex((m) => String(m._id) === String(id))
      if (i === -1) return null
      store[i] = { ...store[i], ...clone(update) }
      return store[i]
    },
    findByIdAndDelete: async (id) => {
      const i = store.findIndex((m) => String(m._id) === String(id))
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

const { default: teamRoutes, LOCALIZED_TEAM_FIELDS } = await import('../routes/team.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/team', teamRoutes)
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

const OWNER = { _id: 'o1', name: 'Owner', email: 'o@x.test', role: 'owner', permissions: [] }

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

test('1. longBio joined the localized field set', () => {
  // Schema-level validation (including the Wave 12A2 role rules and the new
  // image-URL rules) is asserted against the REAL model in
  // teamShowroomLocalization.test.js — the model is mocked here so the route
  // can be driven, so this file only owns route behaviour.
  assert.deepEqual(LOCALIZED_TEAM_FIELDS, ['role', 'bio', 'longBio'])
})

/* ═══════════ 2. Create with the rich fields ═══════════ */

test('2a. creating a member stores all three new fields', async () => {
  currentUser = OWNER

  const res = await request('POST', '/api/team', {
    name: 'Ada Yilmaz',
    role: 'Senior Architect',
    bio: 'Short bio',
    photo: '/uploads/ada.png',
    secondaryPhoto: '/uploads/ada-portrait.png',
    longBio: 'Fifteen years designing across Istanbul.',
    workImages: ['/uploads/w1.png', 'https://cdn.test/w2.png'],
  })

  assert.equal(res.status, 201)
  const saved = store[0]

  assert.equal(saved.secondaryPhoto, '/uploads/ada-portrait.png')
  assert.deepEqual(saved.workImages, ['/uploads/w1.png', 'https://cdn.test/w2.png'])

  // longBio is localized, not a plain string.
  assert.equal(saved.longBio.sourceLang, 'en')
  assert.equal(saved.longBio.en, 'Fifteen years designing across Istanbul.')
  for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) {
    assert.equal(saved.longBio[lang], `[${lang}] Fifteen years designing across Istanbul.`, `missing ${lang}`)
  }
})

test('2b. scalar image fields are never sent to the translator', async () => {
  currentUser = OWNER

  await request('POST', '/api/team', {
    name: 'Bo', role: 'Designer',
    secondaryPhoto: '/uploads/b.png',
    workImages: ['/uploads/w1.png'],
  })

  // role only: 5 targets. Nothing for the URLs.
  assert.equal(providerCalls.length, 5)
  assert.ok(!providerCalls.some((u) => decodeURIComponent(u).includes('/uploads/')), 'a URL was translated')
})

test('2c. a member created without any rich field is accepted', async () => {
  currentUser = OWNER

  const res = await request('POST', '/api/team', { name: 'Cem', role: 'Advisor' })

  assert.equal(res.status, 201)
  const saved = store[0]
  assert.equal(saved.secondaryPhoto, undefined, 'an absent optional field was materialised')
  assert.equal(saved.workImages, undefined, 'an absent gallery was materialised')
  assert.equal(saved.longBio, undefined)
})

/* ═══════════ 3. Legacy members keep working ═══════════ */

test('3a. a pre-Wave-14A member can be updated without gaining fake content', async () => {
  // Exactly what an existing row looks like: no rich fields at all, and
  // role/bio still plain legacy strings.
  store = [{ _id: 'legacy1', name: 'Eski', role: 'Mimar', bio: 'Kisa', photo: '/p.png', order: 0, visible: true }]
  currentUser = OWNER

  const res = await request('PUT', '/api/team/legacy1', {
    name: 'Eski', role: 'Mimar', bio: 'Kisa', photo: '/p.png', order: 1, visible: true,
  })

  assert.equal(res.status, 200)
  assert.equal(store[0].order, 1)
  assert.equal(store[0].secondaryPhoto, undefined, 'an untouched member gained a secondaryPhoto')
  assert.equal(store[0].workImages, undefined, 'an untouched member gained a gallery')
})

test('3b. a legacy member is returned by the public route unchanged', async () => {
  store = [{ _id: 'legacy1', name: 'Eski', role: 'Mimar', bio: 'Kisa', photo: '/p.png', visible: true }]

  const res = await request('GET', '/api/team')

  assert.equal(res.status, 200)
  assert.equal(res.body.members[0].name, 'Eski')
  assert.equal(res.body.members[0].role, 'Mimar', 'a legacy plain-string role stopped resolving')
})

/* ═══════════ 4. longBio localization behaviour ═══════════ */

test('4a. an UNCHANGED longBio costs zero provider calls', async () => {
  store = [{
    _id: 'm1', name: 'Ada', visible: true,
    role: { sourceLang: 'en', en: 'Architect', tr: 'Mimar', ar: 'x', de: 'y', ru: 'z', ur: 'w' },
    bio: { sourceLang: 'en', en: 'Short', tr: 'Kisa', ar: 'x', de: 'y', ru: 'z', ur: 'w' },
    longBio: { sourceLang: 'en', en: 'Long story', tr: 'Uzun hikaye', ar: 'x', de: 'y', ru: 'z', ur: 'w' },
  }]
  currentUser = OWNER

  const res = await request('PUT', '/api/team/m1', {
    name: 'Ada', role: 'Architect', bio: 'Short', longBio: 'Long story',
  })

  assert.equal(res.status, 200)
  assert.equal(providerCalls.length, 0, 'unchanged text was re-translated')
  assert.equal(store[0].longBio.tr, 'Uzun hikaye', 'a good translation was lost')
})

test('4b. editing ONLY longBio does not re-translate role or bio', async () => {
  store = [{
    _id: 'm1', name: 'Ada', visible: true,
    role: { sourceLang: 'en', en: 'Architect', tr: 'Mimar' },
    bio: { sourceLang: 'en', en: 'Short', tr: 'Kisa' },
    longBio: { sourceLang: 'en', en: 'Old story', tr: 'Eski' },
  }]
  currentUser = OWNER

  await request('PUT', '/api/team/m1', {
    name: 'Ada', role: 'Architect', bio: 'Short', longBio: 'A brand new story',
  })

  assert.equal(providerCalls.length, 5, 'more than the one changed field was translated')
  assert.ok(
    providerCalls.every((u) => decodeURIComponent(u).includes('A brand new story')),
    'an unchanged field was sent to the provider'
  )
})

test('4c. one failing language keeps longBio\'s previous translation', async () => {
  store = [{
    _id: 'm1', name: 'Ada', visible: true,
    role: { sourceLang: 'en', en: 'Architect' },
    longBio: { sourceLang: 'en', en: 'Old story', tr: 'Eski hikaye' },
  }]
  currentUser = OWNER
  providerBehaviour = { tr: 'fail' }

  await request('PUT', '/api/team/m1', { name: 'Ada', role: 'Architect', longBio: 'New story' })

  const field = store[0].longBio
  assert.equal(field.en, 'New story', 'the source edit was not stored')
  assert.equal(field.tr, 'Eski hikaye', 'a failed language overwrote a good translation')
  assert.equal(field.de, '[de] New story', 'a working language did not update')
})

test('4d. a poisoned longBio translation is never stored', async () => {
  currentUser = OWNER
  providerBehaviour = { tr: 'poison' }

  await request('POST', '/api/team', { name: 'Ada', role: 'Architect', longBio: 'A story' })

  assert.equal(store[0].longBio.tr, undefined, 'the quota warning was stored as Turkish')
  assert.equal(store[0].longBio.en, 'A story')
})

test('4e. a Turkish-authored longBio is detected as the source language', async () => {
  currentUser = OWNER

  await request('POST', '/api/team', { name: 'Ada', role: 'Mimar', longBio: 'Yıllardır çalışıyorum' })

  assert.equal(store[0].longBio.sourceLang, 'tr')
  assert.equal(store[0].longBio.tr, 'Yıllardır çalışıyorum', 'the source was round-tripped')
})

/* ═══════════ 5. Public exposure ═══════════ */

test('5a. the public route returns the rich fields', async () => {
  store = [{
    _id: 'm1', name: 'Ada', visible: true,
    role: { sourceLang: 'en', en: 'Architect' },
    secondaryPhoto: '/uploads/p.png',
    longBio: { sourceLang: 'en', en: 'Long', tr: 'Uzun' },
    workImages: ['/uploads/w1.png'],
  }]

  const res = await request('GET', '/api/team')
  const m = res.body.members[0]

  assert.equal(m.secondaryPhoto, '/uploads/p.png')
  assert.deepEqual(m.workImages, ['/uploads/w1.png'])
  assert.equal(m.longBio.tr, 'Uzun')
})

test('5b. a poisoned stored longBio is stripped from the public response', async () => {
  store = [{
    _id: 'm1', name: 'Ada', visible: true,
    role: { sourceLang: 'en', en: 'Architect' },
    longBio: { sourceLang: 'en', en: 'Long', tr: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' },
  }]

  const res = await request('GET', '/api/team')

  assert.equal(res.body.members[0].longBio.en, 'Long')
  assert.equal(res.body.members[0].longBio.tr, undefined, 'the quota warning was served publicly')
})

test('5c. hidden members stay hidden regardless of rich content', async () => {
  store = [
    { _id: 'v', name: 'Visible', role: 'A', visible: true, workImages: ['/w.png'] },
    { _id: 'h', name: 'Hidden', role: 'B', visible: false, workImages: ['/w.png'] },
  ]

  const res = await request('GET', '/api/team')

  assert.equal(res.body.members.length, 1)
  assert.equal(res.body.members[0].name, 'Visible')
})

test('5d. the public GET makes zero translation calls', async () => {
  store = [{ _id: 'm1', name: 'Ada', role: 'A', visible: true, longBio: { sourceLang: 'en', en: 'L' } }]

  await request('GET', '/api/team')

  assert.equal(providerCalls.length, 0)
})

/* ═══════════ 6. Authorization is unchanged ═══════════ */

test('6. writing the rich fields still requires owner/admin', async () => {
  currentUser = null
  assert.equal((await request('POST', '/api/team', { name: 'X', role: 'Y' })).status, 401)

  currentUser = { _id: 'u1', role: 'user', permissions: [] }
  assert.equal((await request('POST', '/api/team', { name: 'X', role: 'Y' })).status, 403)

  currentUser = { _id: 'g1', role: 'agent', permissions: ['manage_team'] }
  assert.equal((await request('POST', '/api/team', { name: 'X', role: 'Y' })).status, 403)

  assert.equal(store.length, 0)
})
