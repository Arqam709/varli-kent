// GET /api/about and PUT /api/about over real HTTP.
//
// What is real: the About router, its payload localization, the translation
// pipeline, the public sanitizer and the permission middleware. What is
// replaced: JWT verification, MongoDB (an in-memory AboutContent) and the
// translation PROVIDER — MyMemory URLs are answered by a fake; every other
// request (this suite's own HTTP calls) goes through untouched.
//
// The headline case reproduces the live bug: an About document whose
// localized fields are all English copies, re-saved through the same payload
// the admin form sends.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { after, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { SUPPORTED_LANGUAGES, isUsableText, unwrapLocalized } from '../utils/localizedField.js'
import { isSameText } from '../utils/autoTranslate.js'

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

/* ── In-memory AboutContent ────────────────────────────────────────────── */

let stored = null
let saves = 0

class FakeAboutDoc {
  constructor(data) {
    Object.assign(this, structuredClone(data))
  }
  toObject() {
    return JSON.parse(JSON.stringify(this))
  }
  markModified() {}
  async save() {
    stored = this.toObject()
    saves += 1
    return this
  }
}

mock.module('../models/AboutContent.js', {
  defaultExport: {
    findOne: async () => (stored ? new FakeAboutDoc(stored) : null),
    create: async (data) => {
      stored = JSON.parse(JSON.stringify(data))
      saves += 1
      return new FakeAboutDoc(stored)
    },
  },
})

/* ── Fake translation provider ─────────────────────────────────────────── */

const TURKISH = {
  'Our Story': 'Hikayemiz',
  'About Varlikent': 'Varlikent Hakkında',
  'Our Mission': 'Misyonumuz',
  'A refined approach to luxury real estate.': 'Lüks gayrimenkule rafine bir yaklaşım.',
}

/** 'translate' | 'echo' | 'down' */
let providerMode = 'translate'
let providerCalls = 0
const realFetch = globalThis.fetch

globalThis.fetch = async (url, options) => {
  const href = String(url)
  if (!href.includes('api.mymemory.translated.net')) return realFetch(url, options)

  providerCalls += 1
  if (providerMode === 'down') throw new TypeError('fetch failed')

  const parsed = new URL(href)
  const q = parsed.searchParams.get('q')
  const target = parsed.searchParams.get('langpair').split('|')[1]
  const translatedText = providerMode === 'echo'
    ? q
    : target === 'tr' && TURKISH[q] ? TURKISH[q] : `[${target}] ${q}`

  return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText } }) }
}

const { default: aboutRoutes } = await import('../routes/about.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/about', aboutRoutes)
  app.use((err, req, res, _next) => res.status(500).json({ success: false, message: err.message }))
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => {
  globalThis.fetch = realFetch
  await new Promise((resolve) => server.close(resolve))
})

const copies = (text) => ({ sourceLang: 'en', ...Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, text])) })

const LIVE = {
  heroLabel: copies('Our Story'),
  heroHeading: copies('About Varlikent'),
  heroSubtext: copies("Istanbul's premier luxury real estate agency."),
  missionLabel: copies('Our Mission'),
  missionHeading: copies('A refined approach to luxury real estate.'),
  missionParagraph1: copies('We bring together market insight.'),
  missionParagraph2: copies('Founded with a passion for Istanbul.'),
  missionImage: 'https://res.cloudinary.com/demo/image/upload/v1/mission.png',
  teamLabel: copies('Our Team'),
  teamHeading: copies('Meet Our Experts'),
  stats: [{ value: '10+', label: { sourceLang: 'en', en: '' }, order: 0 }],
  team: [{ name: 'Deniz Arda Varlı', role: copies('Owner'), avatar: '', order: 1 }],
  contentBlocks: [],
}

const TEXT_FIELDS = [
  'heroLabel', 'heroHeading', 'heroSubtext', 'missionLabel', 'missionHeading',
  'missionParagraph1', 'missionParagraph2', 'teamLabel', 'teamHeading',
]

/** Exactly what AdminAbout.jsx puts in the PUT body. */
const adminForm = (doc) => ({
  ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, unwrapLocalized(doc[field])])),
  missionImage: doc.missionImage,
  stats: doc.stats.map((stat) => ({ ...stat, label: unwrapLocalized(stat.label) })),
  team: doc.team.map((member) => ({ ...member, role: unwrapLocalized(member.role) })),
  contentBlocks: doc.contentBlocks,
})

const copiesIn = (value) =>
  SUPPORTED_LANGUAGES.filter((lang) => lang !== value.sourceLang && isSameText(value[lang], value[value.sourceLang]))

const OWNER = { _id: 'o1', name: 'Owner', email: 'o@example.test', role: 'owner', permissions: [] }

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

beforeEach(() => {
  stored = structuredClone(LIVE)
  saves = 0
  providerMode = 'translate'
  providerCalls = 0
  currentUser = null
})

/* ══════════════ GET ══════════════ */

test('GET returns the localized objects as stored, so clients pick the language', async () => {
  stored.missionLabel = { sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz' }

  const res = await request('GET', '/api/about')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.about.missionLabel, { sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz' })
  assert.equal(res.body.about.missionImage, LIVE.missionImage)
})

test('GET still serves legacy scalar documents and strips provider warnings', async () => {
  stored = {
    heroLabel: 'Our Story',
    missionLabel: { sourceLang: 'en', en: 'Our Mission', tr: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' },
    stats: [],
    team: [],
    contentBlocks: [],
  }

  const res = await request('GET', '/api/about')

  assert.equal(res.body.about.heroLabel, 'Our Story')
  assert.deepEqual(res.body.about.missionLabel, { sourceLang: 'en', en: 'Our Mission' })
})

/* ══════════════ PUT — the repair path ══════════════ */

test('THE REPAIR: re-saving the English-copy document stores real translations', async () => {
  currentUser = OWNER

  const res = await request('PUT', '/api/about', adminForm(LIVE))

  assert.equal(res.status, 200)
  assert.equal(saves, 1)
  for (const field of TEXT_FIELDS) {
    assert.deepEqual(copiesIn(stored[field]), [], `${field} still holds English copies`)
    assert.equal(stored[field].en, LIVE[field].en, `${field}: the English source changed`)
  }
  assert.equal(stored.missionLabel.tr, 'Misyonumuz')
  assert.equal(stored.missionHeading.tr, 'Lüks gayrimenkule rafine bir yaklaşım.')
  assert.deepEqual(copiesIn(stored.team[0].role), [])

  // …and the public endpoint now serves Turkish under `tr`.
  const read = await request('GET', '/api/about')
  assert.equal(read.body.about.missionLabel.tr, 'Misyonumuz')
  assert.equal(read.body.about.heroHeading.tr, 'Varlikent Hakkında')
})

test('saving while the provider echoes (how the copies were made) stores the source only', async () => {
  currentUser = OWNER
  providerMode = 'echo'

  const res = await request('PUT', '/api/about', adminForm(LIVE))

  assert.equal(res.status, 200)
  for (const field of TEXT_FIELDS) {
    assert.deepEqual(stored[field], { sourceLang: 'en', en: LIVE[field].en }, `${field} stored a fake translation`)
  }
})

test('saving while the provider is down keeps real translations and drops copies', async () => {
  currentUser = OWNER
  stored.missionLabel = { sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz', ar: 'مهمتنا' }
  providerMode = 'down'

  const res = await request('PUT', '/api/about', adminForm(stored))

  assert.equal(res.status, 200, 'an outage must not block the save')
  assert.deepEqual(stored.missionLabel, { sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz', ar: 'مهمتنا' })
  assert.deepEqual(stored.heroLabel, { sourceLang: 'en', en: 'Our Story' })
})

test('the save keeps the image, figures, team names, and invents no stat label', async () => {
  currentUser = OWNER

  await request('PUT', '/api/about', adminForm(LIVE))

  assert.equal(stored.missionImage, LIVE.missionImage)
  assert.equal(stored.stats[0].value, '10+')
  assert.deepEqual(stored.stats[0].label, { sourceLang: 'en', en: '' })
  assert.equal(stored.team[0].name, 'Deniz Arda Varlı')
})

test('a Turkish-authored save keeps Turkish as the source and translates the rest', async () => {
  currentUser = OWNER

  await request('PUT', '/api/about', { ...adminForm(LIVE), missionLabel: 'Misyonumuz: güven' })

  assert.equal(stored.missionLabel.sourceLang, 'tr')
  assert.equal(stored.missionLabel.tr, 'Misyonumuz: güven')
  assert.equal(stored.missionLabel.en, '[en] Misyonumuz: güven')
  assert.deepEqual(copiesIn(stored.missionLabel), [])
})

test('the About guards are unchanged: no token 401, an admin without manage_about 403', async () => {
  assert.equal((await request('PUT', '/api/about', adminForm(LIVE))).status, 401)

  currentUser = { _id: 'a1', role: 'admin', permissions: ['manage_page_content'] }
  assert.equal((await request('PUT', '/api/about', adminForm(LIVE))).status, 403)

  assert.equal(saves, 0)
  assert.equal(providerCalls, 0, 'a refused request must not spend translation quota')
})

test('every stored translation is usable text', async () => {
  currentUser = OWNER
  await request('PUT', '/api/about', adminForm(LIVE))
  for (const field of TEXT_FIELDS) {
    for (const [key, value] of Object.entries(stored[field])) {
      if (key !== 'sourceLang') assert.ok(isUsableText(value), `${field}.${key}`)
    }
  }
})
