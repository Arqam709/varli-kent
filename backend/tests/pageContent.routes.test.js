// The Page Content CMS API.
//
// ── What is real and what is replaced ───────────────────────────────────
// The route, its registry validation, and CURRENT's real localization helpers
// (isUnchangedSource / localizeText / sanitizePoisonedTranslations) all run for
// real. Only three genuine externals are replaced: MongoDB (an in-memory
// PageContent stand-in), JWT verification, and the MyMemory HTTP call — which
// is a scripted fake, so this suite makes no network request and can never
// spend translation quota.
//
// The provider fake counts every call it receives. Several assertions are about
// that count being ZERO, because "re-saving a page must not re-translate the
// forty fields nobody touched" is a correctness property, not an optimisation.
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
/** pageKey -> { pageKey, fields, sections }. Reset per test. */
let store = new Map()
/** Every conditional update the code under test issued: { filter, update }. */
let updateCalls = []

const valueAt = (object, dotted) =>
  dotted.split('.').reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), object)

const setAt = (object, dotted, value) => {
  const keys = dotted.split('.')
  let node = object
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys.at(-1)] = value
}

class FakeDoc {
  constructor(data) {
    this.pageKey = data.pageKey
    this.fields = data.fields || {}
    this.sections = data.sections || {}
  }
  markModified() {}
  async save() {
    store.set(this.pageKey, { pageKey: this.pageKey, fields: this.fields, sections: this.sections })
    return this
  }
}

mock.module('../models/PageContent.js', {
  defaultExport: Object.assign(
    function PageContent(data) { return new FakeDoc(data) },
    {
      findOne: (filter) => {
        const found = store.get(filter.pageKey)
        const result = found ? new FakeDoc(structuredClone(found)) : null
        // The route calls .lean() on the GET path and awaits directly on PUT,
        // so the return value has to satisfy both shapes.
        return Object.assign(Promise.resolve(result), {
          lean: async () => (found ? structuredClone(found) : null),
        })
      },
      // MongoDB's updateOne for the only shape the retry uses: an equality
      // filter on dotted paths and a $set of dotted paths. A document that
      // does not match the WHOLE filter is not touched.
      updateOne: async (filter, update) => {
        updateCalls.push(structuredClone({ filter, update }))
        const found = store.get(filter.pageKey)
        const matches = Boolean(found) && Object.entries(filter).every(([dotted, expected]) => valueAt(found, dotted) === expected)
        if (!matches) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }

        const next = structuredClone(found)
        for (const [dotted, value] of Object.entries(update.$set || {})) setAt(next, dotted, structuredClone(value))
        store.set(filter.pageKey, next)
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
      },
    }
  ),
})

// ── Scripted translation provider ───────────────────────────────────────
/** Every MyMemory URL the code under test requested. */
let providerCalls = []
/**
 * lang -> 'ok' | 'fail' | 'poison' | 'echo'. Missing means 'ok'. A key of
 * `<lang>|<source text>` scripts one language for one field's text only.
 */
let providerBehaviour = {}
/** Runs while a translation request is in flight — how a concurrent save is staged. */
let duringTranslation = null

const realFetch = globalThis.fetch

/*
 * Intercepts MyMemory and NOTHING else.
 *
 * This suite drives the route over real HTTP, so the test's own requests go
 * through fetch too — swallowing those as if they were translation calls is
 * how the fake ends up asserting against itself.
 */
const fakeFetch = async (url, options) => {
  const href = String(url)
  if (!href.includes('api.mymemory.translated.net')) return realFetch(url, options)

  providerCalls.push(href)
  if (duringTranslation) await duringTranslation(href)
  const lang = new URL(href).searchParams.get('langpair').split('|')[1]
  const text = new URL(href).searchParams.get('q')

  const mode = providerBehaviour[`${lang}|${text}`] || providerBehaviour[lang] || 'ok'
  if (mode === 'fail') return { ok: false, json: async () => ({}) }
  if (mode === 'echo') return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: text } }) }
  if (mode === 'poison') {
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }) }
  }
  return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: `[${lang}] ${text}` } }) }
}


const { default: pageContentRoutes } = await import('../routes/pageContent.js')
const { PAGE_KEYS, MAX_TEXT_LENGTH } = await import('../config/pageContentRegistry.js')

let server
let baseUrl

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/page-content', pageContentRoutes)
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message })
  })
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async () => {
  globalThis.fetch = realFetch
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  currentUser = null
  store = new Map()
  updateCalls = []
  providerCalls = []
  providerBehaviour = {}
  duringTranslation = null
  globalThis.fetch = fakeFetch
})

const OWNER = { _id: 'o1', name: 'Owner', email: 'o@example.test', role: 'owner', permissions: [] }
const ADMIN_WITH = { _id: 'a1', name: 'Admin', email: 'a@example.test', role: 'admin', permissions: ['manage_page_content'] }
const ADMIN_WITHOUT = { _id: 'a2', name: 'Admin2', email: 'a2@example.test', role: 'admin', permissions: ['manage_about'] }
const AGENT = { _id: 'g1', name: 'Agent', email: 'g@example.test', role: 'agent', permissions: [] }
const CUSTOMER = { _id: 'u1', name: 'User', email: 'u@example.test', role: 'user', permissions: [] }

const request = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const text = (value) => ({ type: 'text', value })
const image = (url) => ({ type: 'image', url })

/* ══════════════════════ 1. Registry contract ══════════════════════ */

test('1a. exactly the seven supported pages are registered', () => {
  assert.deepEqual(
    [...PAGE_KEYS].sort(),
    ['architecture', 'construction', 'contact', 'home', 'interior-design', 'renovation', 'team'].sort()
  )
})

test('1b. About is deliberately NOT a CMS page', () => {
  // AboutContent + AdminAbout already own it with their own localization.
  assert.ok(!PAGE_KEYS.includes('about'))
})

/* ══════════════════════ 2. Public GET ══════════════════════ */

test('2a. a known page with no document returns empty maps, not 404', async () => {
  const res = await request('GET', '/api/page-content/home')

  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.deepEqual(res.body.fields, {})
  assert.deepEqual(res.body.sections, {})
})

test('2b. an unknown page is rejected', async () => {
  assert.equal((await request('GET', '/api/page-content/nope')).status, 404)
  assert.equal((await request('GET', '/api/page-content/about')).status, 404)
})

test('2c. stored content is returned', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: { heroHeading1: { type: 'text', sourceLang: 'en', en: 'Hello', tr: 'Merhaba' } },
    sections: { services: false },
  })

  const res = await request('GET', '/api/page-content/home')

  assert.equal(res.body.fields.heroHeading1.tr, 'Merhaba')
  assert.equal(res.body.sections.services, false)
})

test('2d. a poisoned stored translation is never returned as content', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: {
      heroHeading1: {
        type: 'text', sourceLang: 'en', en: 'Hello',
        tr: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS',
      },
    },
    sections: {},
  })

  const res = await request('GET', '/api/page-content/home')

  assert.equal(res.body.fields.heroHeading1.en, 'Hello')
  assert.equal(res.body.fields.heroHeading1.tr, undefined, 'the quota warning was served as content')
})

test('2e. GET makes zero translation-provider calls', async () => {
  store.set('home', { pageKey: 'home', fields: { heroHeading1: { type: 'text', sourceLang: 'en', en: 'Hello' } }, sections: {} })

  await request('GET', '/api/page-content/home')

  assert.equal(providerCalls.length, 0)
})

/* ══════════════════════ 3. PUT authorization ══════════════════════ */

test('3a. an unauthenticated caller is refused', async () => {
  const res = await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('x') } })

  assert.equal(res.status, 401)
  assert.equal(store.size, 0)
})

test('3b. a customer and an agent are both refused by role', async () => {
  for (const actor of [CUSTOMER, AGENT]) {
    currentUser = actor
    const res = await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('x') } })
    assert.equal(res.status, 403, `${actor.role} was not refused`)
  }
  assert.equal(store.size, 0)
})

test('3c. an admin WITHOUT manage_page_content is refused', async () => {
  currentUser = ADMIN_WITHOUT
  const res = await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('x') } })

  assert.equal(res.status, 403)
  assert.match(res.body.message, /manage_page_content/)
  assert.equal(store.size, 0)
})

test('3d. an admin WITH the permission succeeds', async () => {
  currentUser = ADMIN_WITH
  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Hi') } })).status, 200)
})

test('3e. an owner succeeds without the permission listed', async () => {
  // requirePermission lets an owner through unconditionally — CURRENT's rule,
  // preserved rather than re-decided here.
  currentUser = OWNER
  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Hi') } })).status, 200)
})

/* ══════════════════════ 4. Payload validation ══════════════════════ */

test('4a. an unknown page is rejected', async () => {
  currentUser = OWNER
  assert.equal((await request('PUT', '/api/page-content/nope', { fields: {} })).status, 404)
})

test('4b. an unknown field key is rejected and nothing is written', async () => {
  currentUser = OWNER
  const res = await request('PUT', '/api/page-content/home', {
    fields: { heroHeading1: text('ok'), somethingInvented: text('nope') },
  })

  assert.equal(res.status, 400)
  assert.match(res.body.message, /somethingInvented/)
  assert.equal(store.size, 0, 'a rejected request wrote a partial document')
})

test('4c. a field valid on another page is still rejected here', async () => {
  currentUser = OWNER
  // seismicBody exists on `construction`, not on `home`.
  const res = await request('PUT', '/api/page-content/home', { fields: { seismicBody: text('x') } })

  assert.equal(res.status, 400)
})

test('4d. inherited Object.prototype names are not fields', async () => {
  currentUser = OWNER
  for (const key of ['constructor', 'toString', '__proto__']) {
    const res = await request('PUT', '/api/page-content/home', { fields: { [key]: text('x') } })
    assert.equal(res.status, 400, `'${key}' was accepted as a field`)
  }
})

test('4e. a type that disagrees with the registry is rejected', async () => {
  currentUser = OWNER
  // heroHeading1 is text; heroImage is image.
  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroHeading1: image('https://x.test/a.png') } })).status, 400)
  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroImage: text('hello') } })).status, 400)
})

test('4f. a text field must carry a string value', async () => {
  currentUser = OWNER
  for (const bad of [{ type: 'text', value: 5 }, { type: 'text', value: null }, { type: 'text' }]) {
    assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroHeading1: bad } })).status, 400)
  }
})

test('4g. fields/sections must be plain objects', async () => {
  currentUser = OWNER
  assert.equal((await request('PUT', '/api/page-content/home', { fields: [] })).status, 400)
  assert.equal((await request('PUT', '/api/page-content/home', { sections: 'yes' })).status, 400)
})

/* ══════════════════════ 5. Sections ══════════════════════ */

test('5a. an unknown section is rejected', async () => {
  currentUser = OWNER
  const res = await request('PUT', '/api/page-content/home', { sections: { notASection: true } })

  assert.equal(res.status, 400)
  assert.match(res.body.message, /notASection/)
})

test('5b. a section valid on another page is rejected here', async () => {
  currentUser = OWNER
  // 'seismic' belongs to construction.
  assert.equal((await request('PUT', '/api/page-content/home', { sections: { seismic: true } })).status, 400)
})

test('5c. only real booleans are accepted', async () => {
  currentUser = OWNER
  // "false" is the exact value a form or query string produces, and the
  // donor's `!!visible` would store it as TRUE — turning "hide" into "show".
  for (const bad of ['false', 'true', 0, 1, null, 'yes']) {
    const res = await request('PUT', '/api/page-content/home', { sections: { services: bad } })
    assert.equal(res.status, 400, `${JSON.stringify(bad)} was accepted as a boolean`)
  }
})

test('5d. true and false both store, and nothing else is materialised', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { sections: { services: false, cta: true } })

  const stored = store.get('home')
  assert.equal(stored.sections.services, false)
  assert.equal(stored.sections.cta, true)
  // Creating a document must not silently hide every other section.
  assert.deepEqual(Object.keys(stored.sections).sort(), ['cta', 'services'])
})

/* ══════════════════════ 6. Text localization ══════════════════════ */

test('6a. new English text is stored in all six languages', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Our Services') } })

  const field = store.get('home').fields.heroHeading1
  assert.equal(field.type, 'text')
  assert.equal(field.sourceLang, 'en')
  assert.equal(field.en, 'Our Services', 'the source was round-tripped through the provider')
  for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) {
    assert.equal(field[lang], `[${lang}] Our Services`, `missing ${lang}`)
  }
  assert.equal(providerCalls.length, 5, 'expected one call per non-source language')
})

test('6b. Turkish source text is detected and the source is not translated', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Hizmetlerimiz çok iyi') } })

  const field = store.get('home').fields.heroHeading1
  assert.equal(field.sourceLang, 'tr')
  assert.equal(field.tr, 'Hizmetlerimiz çok iyi')
  assert.equal(field.en, '[en] Hizmetlerimiz çok iyi')
  assert.ok(!providerCalls.some((u) => u.includes('|tr')), 'the source language was sent for translation')
})

test('6c. UNCHANGED text costs ZERO provider calls', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: {
      heroHeading1: { type: 'text', sourceLang: 'en', en: 'Our Services', tr: 'Hizmetlerimiz', ar: 'خدماتنا', de: 'x', ru: 'y', ur: 'z' },
    },
    sections: {},
  })
  currentUser = OWNER

  const res = await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Our Services') } })

  assert.equal(res.status, 200)
  assert.equal(providerCalls.length, 0, 're-saving unchanged text called the provider')
  assert.equal(store.get('home').fields.heroHeading1.tr, 'Hizmetlerimiz', 'a good translation was lost')
})

test('6d. saving a whole page re-translates only the field that changed', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', {
    fields: { heroHeading1: text('One'), heroHeading2: text('Two'), heroHeading3: text('Three') },
  })
  assert.equal(providerCalls.length, 15) // 3 fields x 5 targets

  providerCalls = []
  await request('PUT', '/api/page-content/home', {
    fields: { heroHeading1: text('One'), heroHeading2: text('CHANGED'), heroHeading3: text('Three') },
  })

  assert.equal(providerCalls.length, 5, 'unchanged siblings were re-translated')
  assert.ok(providerCalls.every((u) => decodeURIComponent(u).includes('CHANGED')))
})

test('6e. one failing language keeps its previous good translation', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: { heroHeading1: { type: 'text', sourceLang: 'en', en: 'Our Services', tr: 'Hizmetlerimiz' } },
    sections: {},
  })
  currentUser = OWNER
  providerBehaviour = { tr: 'fail' }

  await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Our Property Services') } })

  const field = store.get('home').fields.heroHeading1
  assert.equal(field.en, 'Our Property Services', 'the source edit was not stored')
  assert.equal(field.tr, 'Hizmetlerimiz', 'a failed language overwrote a good translation')
  assert.equal(field.de, '[de] Our Property Services', 'a working language did not update')
})

test('6f. a poisoned provider reply is never stored as a translation', async () => {
  currentUser = OWNER
  providerBehaviour = { tr: 'poison' }

  await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('Our Services') } })

  const field = store.get('home').fields.heroHeading1
  assert.equal(field.tr, undefined, 'the quota warning was stored as Turkish')
  assert.equal(field.en, 'Our Services')
  assert.equal(field.de, '[de] Our Services')
})

test('6g. a total provider outage still stores the source edit', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: { heroHeading1: { type: 'text', sourceLang: 'en', en: 'Old', tr: 'Eski' } },
    sections: {},
  })
  currentUser = OWNER
  providerBehaviour = { tr: 'fail', ar: 'fail', de: 'fail', ru: 'fail', ur: 'fail' }

  const res = await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('New') } })

  assert.equal(res.status, 200)
  const field = store.get('home').fields.heroHeading1
  assert.equal(field.en, 'New')
  assert.equal(field.tr, 'Eski', 'the previous usable translation was discarded')
})

test('6h. an over-long text value is rejected', async () => {
  currentUser = OWNER
  const ok = 'a'.repeat(MAX_TEXT_LENGTH)
  const tooLong = 'a'.repeat(MAX_TEXT_LENGTH + 1)

  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text(ok) } })).status, 200)
  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text(tooLong) } })).status, 400)
})

/* ══════════════════════ 7. Images ══════════════════════ */

test('7a. https, http, site-relative and empty URLs are accepted', async () => {
  currentUser = OWNER
  for (const url of ['https://cdn.test/a.png', 'http://cdn.test/a.png', '/images/hero-villa.jpg.png', '']) {
    const res = await request('PUT', '/api/page-content/home', { fields: { heroImage: image(url) } })
    assert.equal(res.status, 200, `rejected a valid URL: ${JSON.stringify(url)}`)
    assert.deepEqual(store.get('home').fields.heroImage, { type: 'image', url })
  }
})

test('7b. dangerous and malformed URLs are rejected', async () => {
  currentUser = OWNER
  const bad = [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    '//evil.test/a.png', // protocol-relative — points off-site
    'not a url at all',
    'ftp://cdn.test/a.png',
  ]
  for (const url of bad) {
    const res = await request('PUT', '/api/page-content/home', { fields: { heroImage: image(url) } })
    assert.equal(res.status, 400, `accepted a dangerous URL: ${url}`)
  }
  assert.equal(store.size, 0)
})

test('7c. an over-long URL is rejected', async () => {
  currentUser = OWNER
  const url = 'https://cdn.test/' + 'a'.repeat(2100)
  assert.equal((await request('PUT', '/api/page-content/home', { fields: { heroImage: image(url) } })).status, 400)
})

test('7d. an image costs zero provider calls', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { fields: { heroImage: image('https://cdn.test/a.png') } })

  assert.equal(providerCalls.length, 0)
})

/* ══════════════════════ 8. Partial updates ══════════════════════ */

test('8. omitted fields and sections are preserved, not wiped', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: {
      heroHeading1: { type: 'text', sourceLang: 'en', en: 'A', tr: 'A-tr' },
      heroHeading2: { type: 'text', sourceLang: 'en', en: 'B', tr: 'B-tr' },
      heroImage: { type: 'image', url: 'https://cdn.test/keep.png' },
    },
    sections: { services: false, cta: true },
  })
  currentUser = OWNER

  const res = await request('PUT', '/api/page-content/home', {
    fields: { heroHeading1: text('A changed') },
    sections: { services: true },
  })

  assert.equal(res.status, 200)
  const stored = store.get('home')

  assert.equal(stored.fields.heroHeading1.en, 'A changed', 'the submitted field did not update')
  assert.equal(stored.sections.services, true, 'the submitted section did not update')

  assert.equal(stored.fields.heroHeading2.en, 'B', 'an omitted field was wiped')
  assert.equal(stored.fields.heroHeading2.tr, 'B-tr', 'an omitted translation was wiped')
  assert.equal(stored.fields.heroImage.url, 'https://cdn.test/keep.png', 'an omitted image was wiped')
  assert.equal(stored.sections.cta, true, 'an omitted section was wiped')
})

/* ══════════════════════ 9. Every page accepts its own content ══════════════════════ */

test('9. each of the seven pages accepts a write to its hero heading', async () => {
  currentUser = OWNER
  const heroKey = { home: 'heroHeading1' }

  for (const pageKey of PAGE_KEYS) {
    const key = heroKey[pageKey] || 'heroHeading'
    const res = await request('PUT', `/api/page-content/${pageKey}`, { fields: { [key]: text('Hello') } })
    assert.equal(res.status, 200, `${pageKey} rejected its own hero heading`)
  }
})

/* ══════════════════════ 10. CMS Phase A — the save response reports translation honestly ══════════════ */

const TARGET_LANGS = ['tr', 'ar', 'de', 'ru', 'ur']
// The shape a stored text field has, and nothing more.
const STORED_FIELD_KEYS = ['type', 'sourceLang', 'en', 'tr', 'ar', 'de', 'ru', 'ur']
const REPORT_WORDS = ['translation', 'translated', 'needsAttention', 'reason', 'using', 'status', 'targets']

// A stored field's content, without the translation state Phase B keeps beside it.
const content = (field) => {
  const { meta: _meta, ...rest } = field
  return rest
}

/*
 * The save REPORT is request-scoped and must never be stored. A saved text
 * field may carry `meta` (Phase B's persistent translation state), which is a
 * different thing with its own vocabulary — so the report's words must appear
 * nowhere in the document, `meta` included.
 */
const assertNothingReportedIsStored = () => {
  for (const [pageKey, doc] of store) {
    assert.deepEqual(Object.keys(doc).sort(), ['fields', 'pageKey', 'sections'], `${pageKey} gained a top-level key`)
    for (const [key, field] of Object.entries(doc.fields)) {
      for (const stored of Object.keys(field)) {
        assert.ok([...STORED_FIELD_KEYS, 'url', 'meta'].includes(stored), `${pageKey}.${key} stores an unexpected key: ${stored}`)
      }
    }
    const serialized = JSON.stringify(doc)
    for (const word of REPORT_WORDS) assert.equal(serialized.includes(`"${word}"`), false, `${pageKey} stores "${word}"`)
  }
}

test('10a. a fully translated save reports every language for the field, and keeps the existing response keys', async () => {
  currentUser = OWNER
  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.fields.heroCtaPrimary.en, 'Discover Our Services')
  assert.deepEqual(res.body.sections, {})
  assert.deepEqual(Object.keys(res.body).sort(), ['fields', 'sections', 'success', 'translation'])
  assert.deepEqual(res.body.translation, {
    fields: { heroCtaPrimary: { sourceLang: 'en', translated: TARGET_LANGS, needsAttention: [] } },
  })
  assertNothingReportedIsStored()
})

test('10b. one failed language with a previous translation: 200, the old value kept, and reported as using it', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: { heroCtaPrimary: { type: 'text', sourceLang: 'en', en: 'Explore Services', de: 'Leistungen entdecken', tr: 'Hizmetleri Keşfedin' } },
    sections: {},
  })
  currentUser = OWNER
  providerBehaviour = { de: 'fail' }

  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  assert.equal(res.status, 200, 'a failed translation is not a failed save')
  assert.deepEqual(res.body.translation.fields.heroCtaPrimary, {
    sourceLang: 'en',
    translated: ['tr', 'ar', 'ru', 'ur'],
    needsAttention: [{ lang: 'de', reason: 'provider_error', using: 'previous' }],
  })
  // The text stored is exactly what the route stored before it could report anything.
  assert.deepEqual(content(store.get('home').fields.heroCtaPrimary), {
    type: 'text', sourceLang: 'en', en: 'Discover Our Services',
    tr: '[tr] Discover Our Services', ar: '[ar] Discover Our Services', de: 'Leistungen entdecken',
    ru: '[ru] Discover Our Services', ur: '[ur] Discover Our Services',
  })
  assertNothingReportedIsStored()
})

test('10c. one failed language with nothing stored before: reported as having no translation, slot left absent', async () => {
  currentUser = OWNER
  providerBehaviour = { de: 'fail' }

  const res = await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('We Plan') } })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.translation.fields.heroHeading1.needsAttention, [{ lang: 'de', reason: 'provider_error', using: 'none' }])
  assert.equal('de' in store.get('home').fields.heroHeading1, false)
  assertNothingReportedIsStored()
})

test('10d. several fields in one save: each field keeps its own per-language result', async () => {
  store.set('home', {
    pageKey: 'home',
    fields: { heroLabel: { type: 'text', sourceLang: 'en', en: 'Istanbul', de: 'Istanbul — alt' } },
    sections: {},
  })
  currentUser = OWNER
  // German fails for the label only; Urdu fails for the button only.
  providerBehaviour = { 'de|Istanbul Studio': 'fail', 'ur|Discover Our Services': 'fail' }

  const res = await request('PUT', '/api/page-content/home', {
    fields: { heroLabel: text('Istanbul Studio'), heroCtaPrimary: text('Discover Our Services') },
  })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.translation.fields, {
    heroLabel: {
      sourceLang: 'en',
      translated: ['tr', 'ar', 'ru', 'ur'],
      needsAttention: [{ lang: 'de', reason: 'provider_error', using: 'previous' }],
    },
    heroCtaPrimary: {
      sourceLang: 'en',
      translated: ['tr', 'ar', 'de', 'ru'],
      needsAttention: [{ lang: 'ur', reason: 'provider_error', using: 'none' }],
    },
  })

  const stored = store.get('home').fields
  assert.equal(stored.heroLabel.de, 'Istanbul — alt')
  assert.equal(stored.heroLabel.ur, '[ur] Istanbul Studio')
  assert.equal(stored.heroCtaPrimary.de, '[de] Discover Our Services')
  assert.equal('ur' in stored.heroCtaPrimary, false)
  assertNothingReportedIsStored()
})

test('10e. every translation fails: still 200, the source is saved, and all five languages are reported', async () => {
  currentUser = OWNER
  providerBehaviour = Object.fromEntries(TARGET_LANGS.map((lang) => [lang, 'fail']))

  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.deepEqual(content(store.get('home').fields.heroCtaPrimary), { type: 'text', sourceLang: 'en', en: 'Discover Our Services' })
  const report = res.body.translation.fields.heroCtaPrimary
  assert.deepEqual(report.translated, [])
  assert.deepEqual(report.needsAttention.map((item) => item.lang), TARGET_LANGS)
  for (const item of report.needsAttention) assert.deepEqual(item, { lang: item.lang, reason: 'provider_error', using: 'none' })
  assertNothingReportedIsStored()
})

test('10f. an echo and a quota warning are reported with their reasons, and neither is stored', async () => {
  currentUser = OWNER
  providerBehaviour = { de: 'echo', ru: 'poison' }

  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.translation.fields.heroCtaPrimary.needsAttention, [
    { lang: 'de', reason: 'echo', using: 'none' },
    { lang: 'ru', reason: 'quota', using: 'none' },
  ])
  assert.equal(JSON.stringify(res.body).includes('MYMEMORY'), false, 'the provider sentence is not sent to the admin')
  const field = store.get('home').fields.heroCtaPrimary
  assert.equal('de' in field, false)
  assert.equal('ru' in field, false)
  assertNothingReportedIsStored()
})

test('10g. unchanged text is still skipped: no provider call, and nothing reported for it', async () => {
  store.set('home', {
    pageKey: 'home',
    // German is missing — re-saving the same text must NOT become an automatic retry.
    fields: { heroCtaPrimary: { type: 'text', sourceLang: 'en', en: 'Explore Services', tr: 'Hizmetleri Keşfedin' } },
    sections: {},
  })
  currentUser = OWNER

  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Explore Services') } })

  assert.equal(res.status, 200)
  assert.equal(providerCalls.length, 0)
  assert.deepEqual(res.body.translation, { fields: {} })
  assert.deepEqual(store.get('home').fields.heroCtaPrimary, { type: 'text', sourceLang: 'en', en: 'Explore Services', tr: 'Hizmetleri Keşfedin' })
})

test('10h. a save with no text to translate reports an empty set', async () => {
  currentUser = OWNER
  const res = await request('PUT', '/api/page-content/home', {
    fields: { heroImage: image('https://cdn.test/hero.png') },
    sections: { services: false },
  })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.translation, { fields: {} })
  assert.equal(providerCalls.length, 0)
})

test('10i. a rejected or failed save keeps its failure status and reports no translation', async () => {
  currentUser = OWNER

  const invalid = await request('PUT', '/api/page-content/home', { fields: { notAField: text('x') } })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.success, false)
  assert.equal('translation' in invalid.body, false)
  assert.equal(store.has('home'), false)

  // The database refusing the write is a real failure, whatever was translated.
  const realSave = FakeDoc.prototype.save
  FakeDoc.prototype.save = async () => { throw new Error('database unavailable') }
  try {
    const failed = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
    assert.equal(failed.status, 500)
    assert.equal(failed.body.success, false)
    assert.equal('translation' in failed.body, false)
  } finally {
    FakeDoc.prototype.save = realSave
  }
  assert.equal(store.has('home'), false)
})

test('10j. the public GET is unchanged: same three keys, and no trace of a save report', async () => {
  currentUser = OWNER
  providerBehaviour = { de: 'fail', ur: 'echo' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  currentUser = null

  const res = await request('GET', '/api/page-content/home')

  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['fields', 'sections', 'success'])
  assert.deepEqual(res.body.fields.heroCtaPrimary, {
    type: 'text', sourceLang: 'en', en: 'Discover Our Services',
    tr: '[tr] Discover Our Services', ar: '[ar] Discover Our Services', ru: '[ru] Discover Our Services',
  })
  for (const word of REPORT_WORDS) assert.equal(JSON.stringify(res.body).includes(`"${word}"`), false, word)
  assertNothingReportedIsStored()
})

/* ══════════════════════ 11. CMS Phase B — persistent translation state ══════════════
 *
 * A saved text field gains `meta`: the hash of its source text and, per
 * language, which source hash that translation was made from. The state of a
 * language (translated / stale / unknown / missing …) is DERIVED from that.
 * Nothing is written except by a save, and only for the field being saved.
 */

const { sourceHash, translationStatesOf } = await import('../utils/translationState.js')

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const HASH = /^[0-9a-f]{64}$/
const stored = (key, pageKey = 'home') => store.get(pageKey).fields[key]
const adminRead = (pageKey = 'home') => request('GET', `/api/page-content/${pageKey}/admin`)
const containsMeta = (value) => JSON.stringify(value).includes('"meta"')

// A field as production holds them today: text in several languages, no `meta`.
const LEGACY_BUTTON = { type: 'text', sourceLang: 'en', en: 'Explore Services', tr: 'Hizmetleri Keşfedin', de: 'Leistungen entdecken', verified: false }

test('11a. a save records the source hash and machine provenance for every language it translated', async () => {
  currentUser = OWNER
  const before = Date.now()
  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  assert.equal(res.status, 200)

  const field = stored('heroCtaPrimary')
  const hash = sourceHash('Discover Our Services')
  assert.match(hash, HASH)
  assert.equal(field.meta.sourceHash, hash)
  assert.deepEqual(Object.keys(field.meta).sort(), ['langs', 'sourceHash'])
  assert.deepEqual(Object.keys(field.meta.langs).sort(), [...TARGET_LANGS].sort(), 'one entry per target, none for the source')

  for (const lang of TARGET_LANGS) {
    const entry = field.meta.langs[lang]
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'by', 'from'], `${lang} carries no status and no error`)
    assert.equal(entry.from, hash)
    assert.equal(entry.by, 'machine')
    assert.match(entry.at, ISO)
    assert.ok(Date.parse(entry.at) >= before - 1000 && Date.parse(entry.at) <= Date.now() + 1000)
  }
  // The flat content is exactly what it always was.
  assert.deepEqual(content(field), {
    type: 'text', sourceLang: 'en', en: 'Discover Our Services',
    tr: '[tr] Discover Our Services', ar: '[ar] Discover Our Services', de: '[de] Discover Our Services',
    ru: '[ru] Discover Our Services', ur: '[ur] Discover Our Services',
  })
  assert.deepEqual(translationStatesOf(field), { en: 'source', tr: 'translated', ar: 'translated', de: 'translated', ru: 'translated', ur: 'translated' })
})

test('11b. metadata is lazy: only the field being saved gains or changes it', async () => {
  const untouched = { type: 'text', sourceLang: 'en', en: 'We Design, Build', de: 'Wir entwerfen, bauen', verified: false }
  store.set('home', {
    pageKey: 'home',
    fields: { heroCtaPrimary: structuredClone(LEGACY_BUTTON), heroHeading1: structuredClone(untouched), heroImage: { type: 'image', url: 'https://cdn.test/hero.png' } },
    sections: { services: true },
  })
  currentUser = OWNER

  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  assert.ok(stored('heroCtaPrimary').meta, 'the saved field has metadata')
  assert.deepEqual(stored('heroHeading1'), untouched, 'a field that was not saved is byte-for-byte unchanged')
  assert.deepEqual(stored('heroImage'), { type: 'image', url: 'https://cdn.test/hero.png' })
  assert.equal(containsMeta(stored('heroHeading1')), false)

  // Re-sending unchanged text is still skipped, and still adds nothing.
  await request('PUT', '/api/page-content/home', { fields: { heroHeading1: text('We Design, Build') } })
  assert.deepEqual(stored('heroHeading1'), untouched)
  // An image never has translation state.
  await request('PUT', '/api/page-content/home', { fields: { heroImage: image('https://cdn.test/new.png') } })
  assert.deepEqual(stored('heroImage'), { type: 'image', url: 'https://cdn.test/new.png' })
})

test('11c. THE STALE CASE: a tracked translation whose retranslation fails keeps its text and its old provenance', async () => {
  currentUser = OWNER
  // Version 1: everything translates and is tracked.
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Explore Services') } })
  const v1 = structuredClone(stored('heroCtaPrimary'))
  const hashV1 = sourceHash('Explore Services')
  assert.equal(v1.meta.langs.de.from, hashV1)

  // Version 2: German fails.
  providerBehaviour = { de: 'fail' }
  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  const field = stored('heroCtaPrimary')
  const hashV2 = sourceHash('Discover Our Services')
  assert.notEqual(hashV1, hashV2)

  assert.equal(field.meta.sourceHash, hashV2)
  assert.equal(field.de, '[de] Explore Services', 'the German TEXT is kept exactly')
  assert.equal(field.meta.langs.de.from, hashV1, 'still recorded as a translation of version 1')
  assert.equal(field.meta.langs.de.by, 'machine')
  assert.equal(field.meta.langs.de.at, v1.meta.langs.de.at, 'the time it was last successfully translated is not moved')
  assert.equal(field.meta.langs.de.error, 'provider_error')
  assert.match(field.meta.langs.de.errorAt, ISO)
  assert.deepEqual(Object.keys(field.meta.langs.de).sort(), ['at', 'by', 'error', 'errorAt', 'from'])

  assert.deepEqual(translationStatesOf(field), { en: 'source', tr: 'translated', ar: 'translated', de: 'stale', ru: 'translated', ur: 'translated' })
  assert.equal(field.meta.langs.tr.from, hashV2)

  // Phase A's report describes this request; Phase B's state describes the record. Both hold.
  assert.deepEqual(res.body.translation.fields.heroCtaPrimary.needsAttention, [{ lang: 'de', reason: 'provider_error', using: 'previous' }])
  assertNothingReportedIsStored()
})

test('11d. a later successful translation replaces the entry and clears the old error', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Explore Services') } })
  providerBehaviour = { de: 'fail' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  assert.equal(stored('heroCtaPrimary').meta.langs.de.error, 'provider_error')

  providerBehaviour = {}
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Everything We Offer') } })

  const field = stored('heroCtaPrimary')
  assert.deepEqual(Object.keys(field.meta.langs.de).sort(), ['at', 'by', 'from'], 'no error survives a success')
  assert.equal(field.meta.langs.de.from, sourceHash('Discover Everything We Offer'))
  assert.equal(field.de, '[de] Discover Everything We Offer')
  assert.equal(translationStatesOf(field).de, 'translated')
})

test('11e. a LEGACY translation that survives a failed save stays unknown — no provenance is invented', async () => {
  store.set('home', { pageKey: 'home', fields: { heroCtaPrimary: structuredClone(LEGACY_BUTTON) }, sections: {} })
  currentUser = OWNER
  providerBehaviour = { de: 'fail' }

  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  const field = stored('heroCtaPrimary')
  assert.equal(field.de, 'Leistungen entdecken', 'the legacy German text is kept')
  assert.deepEqual(Object.keys(field.meta.langs.de).sort(), ['error', 'errorAt'], 'a failure is recorded, a provenance is not')
  assert.equal(field.meta.langs.de.error, 'provider_error')
  assert.equal(translationStatesOf(field).de, 'unknown', 'not current, and not stale either')
  // Turkish translated this time, so it is tracked from now on.
  assert.equal(field.tr, '[tr] Discover Our Services')
  assert.equal(translationStatesOf(field).tr, 'translated')
  // The legacy `verified` flag is not carried into, or read by, the new state.
  assert.equal('verified' in field, false)
})

test('11f. a failed language with nothing stored is missing: no empty value, only the failure', async () => {
  currentUser = OWNER
  providerBehaviour = { de: 'fail', ru: 'echo', ur: 'poison' }

  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  const field = stored('heroCtaPrimary')
  for (const [lang, reason] of [['de', 'provider_error'], ['ru', 'echo'], ['ur', 'quota']]) {
    assert.equal(lang in field, false, `${lang} has no value`)
    assert.deepEqual(Object.keys(field.meta.langs[lang]).sort(), ['error', 'errorAt'])
    assert.equal(field.meta.langs[lang].error, reason)
    assert.equal(translationStatesOf(field)[lang], 'missing')
  }
  assert.equal(JSON.stringify(field).includes('MYMEMORY'), false, 'only the reason identifier is stored, never the provider sentence')
  assert.equal(translationStatesOf(field).tr, 'translated')
})

test('11g. several fields in one save are tracked independently', async () => {
  currentUser = OWNER
  providerBehaviour = { 'de|Istanbul Studio': 'fail', 'ur|Discover Our Services': 'fail' }

  await request('PUT', '/api/page-content/home', {
    fields: { heroLabel: text('Istanbul Studio'), heroCtaPrimary: text('Discover Our Services') },
  })

  assert.equal(stored('heroLabel').meta.sourceHash, sourceHash('Istanbul Studio'))
  assert.equal(stored('heroCtaPrimary').meta.sourceHash, sourceHash('Discover Our Services'))
  assert.deepEqual(translationStatesOf(stored('heroLabel')), { en: 'source', tr: 'translated', ar: 'translated', de: 'missing', ru: 'translated', ur: 'translated' })
  assert.deepEqual(translationStatesOf(stored('heroCtaPrimary')), { en: 'source', tr: 'translated', ar: 'translated', de: 'translated', ru: 'translated', ur: 'missing' })
  assert.equal(stored('heroLabel').meta.langs.ur.from, sourceHash('Istanbul Studio'))
  assert.equal(stored('heroCtaPrimary').meta.langs.de.from, sourceHash('Discover Our Services'))
})

test('11h. a change of source language is followed, not second-guessed', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Explore Services') } })
  const english = structuredClone(stored('heroCtaPrimary'))

  // The next save is Turkish; German fails, so its English-era translation is kept.
  providerBehaviour = { de: 'fail' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Hizmetleri Keşfedin') } })

  const field = stored('heroCtaPrimary')
  const hashTr = sourceHash('Hizmetleri Keşfedin')
  assert.equal(field.sourceLang, 'tr')
  assert.equal(field.tr, 'Hizmetleri Keşfedin')
  assert.equal(field.meta.sourceHash, hashTr)
  assert.equal('tr' in field.meta.langs, false, 'the source language has no translation entry')
  assert.equal(field.meta.langs.en.from, hashTr, 'English is now a translation of the Turkish source')
  assert.equal(field.meta.langs.de.from, english.meta.sourceHash, 'German still points at the English text it came from')
  assert.deepEqual(translationStatesOf(field), { en: 'translated', tr: 'source', ar: 'translated', de: 'stale', ru: 'translated', ur: 'translated' })
})

test('11i. the public GET never exposes translation state', async () => {
  store.set('home', { pageKey: 'home', fields: { heroHeading1: structuredClone(LEGACY_BUTTON) }, sections: { services: true } })
  currentUser = OWNER
  providerBehaviour = { de: 'fail', ru: 'echo' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services'), heroLabel: text('Istanbul Studio') } })
  assert.ok(stored('heroCtaPrimary').meta && stored('heroLabel').meta, 'the state really is stored')
  currentUser = null

  const res = await request('GET', '/api/page-content/home')

  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['fields', 'sections', 'success'])
  assert.equal(containsMeta(res.body), false)
  const serialized = JSON.stringify(res.body)
  for (const leaked of ['sourceHash', '"from"', '"by"', '"errorAt"', '"error"', 'translationStates', sourceHash('Discover Our Services'), 'provider_error']) {
    assert.equal(serialized.includes(leaked), false, `the public response contains ${leaked}`)
  }
  // Everything else is exactly the stored content.
  assert.deepEqual(res.body.fields.heroCtaPrimary, content(stored('heroCtaPrimary')))
  assert.deepEqual(res.body.fields.heroLabel, content(stored('heroLabel')))
  assert.deepEqual(res.body.fields.heroHeading1, LEGACY_BUTTON, 'a legacy field is returned as it always was')
  assert.deepEqual(res.body.sections, { services: true })
})

test('11j. the protected admin read returns the metadata and the derived states', async () => {
  store.set('home', { pageKey: 'home', fields: { heroHeading1: structuredClone(LEGACY_BUTTON), heroImage: { type: 'image', url: 'https://cdn.test/hero.png' } }, sections: { cta: false } })
  currentUser = ADMIN_WITH
  providerBehaviour = { de: 'fail' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  const callsAfterSave = providerCalls.length

  const res = await adminRead()

  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['fields', 'sections', 'success', 'translationStates'])
  assert.deepEqual(res.body.fields.heroCtaPrimary, stored('heroCtaPrimary'), 'the field with its meta')
  assert.equal(res.body.fields.heroCtaPrimary.meta.sourceHash, sourceHash('Discover Our Services'))
  assert.deepEqual(res.body.sections, { cta: false })
  assert.deepEqual(res.body.translationStates, {
    heroCtaPrimary: { en: 'source', tr: 'translated', ar: 'translated', de: 'missing', ru: 'translated', ur: 'translated' },
    // Legacy text with no metadata: present values are unknown, absent ones missing.
    heroHeading1: { en: 'source', tr: 'unknown', ar: 'missing', de: 'unknown', ru: 'missing', ur: 'missing' },
  })
  assert.equal('heroImage' in res.body.translationStates, false, 'an image has no translation state')

  // Reading wrote nothing and translated nothing.
  assert.equal(providerCalls.length, callsAfterSave)
  assert.deepEqual(stored('heroHeading1'), LEGACY_BUTTON)
})

test('11k. the admin read is guarded exactly like the save', async () => {
  store.set('home', { pageKey: 'home', fields: { heroHeading1: structuredClone(LEGACY_BUTTON) }, sections: {} })

  currentUser = null
  assert.equal((await adminRead()).status, 401)
  for (const user of [CUSTOMER, AGENT, ADMIN_WITHOUT]) {
    currentUser = user
    const res = await adminRead()
    assert.equal(res.status, 403, `${user.role} was allowed`)
    assert.equal(containsMeta(res.body) || 'fields' in (res.body || {}), false)
  }
  for (const user of [OWNER, ADMIN_WITH]) {
    currentUser = user
    assert.equal((await adminRead()).status, 200, `${user.role} was refused`)
  }

  currentUser = OWNER
  assert.equal((await adminRead('about')).status, 404, 'an unknown page')
  const empty = await adminRead('contact')
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.body, { success: true, fields: {}, sections: {}, translationStates: {} })
})

test('11l. a document with no metadata anywhere loads, reads and saves as it always did', async () => {
  const legacy = {
    pageKey: 'home',
    fields: {
      heroCtaPrimary: structuredClone(LEGACY_BUTTON),
      heroLabel: { type: 'text', sourceLang: 'en', en: 'Istanbul', verified: false },
      heroImage: { type: 'image', url: '/images/hero.png' },
    },
    sections: { projects: false },
  }
  store.set('home', structuredClone(legacy))

  const publicRead = await request('GET', '/api/page-content/home')
  assert.equal(publicRead.status, 200)
  assert.deepEqual(publicRead.body.fields, legacy.fields)

  currentUser = OWNER
  const admin = await adminRead()
  assert.equal(admin.status, 200)
  assert.deepEqual(admin.body.fields, legacy.fields)
  assert.deepEqual(admin.body.translationStates.heroCtaPrimary, { en: 'source', tr: 'unknown', ar: 'missing', de: 'unknown', ru: 'missing', ur: 'missing' })
  assert.deepEqual(store.get('home'), legacy, 'neither read changed the document')

  const res = await request('PUT', '/api/page-content/home', { fields: { heroLabel: text('Istanbul Studio') }, sections: { projects: true } })
  assert.equal(res.status, 200)
  assert.deepEqual(stored('heroCtaPrimary'), legacy.fields.heroCtaPrimary, 'the field that was not saved is still pure legacy')
  assert.equal(stored('heroLabel').en, 'Istanbul Studio')
  assert.ok(stored('heroLabel').meta)
})

test('11m. the save response still carries the Phase A report, with the saved metadata beside it', async () => {
  currentUser = OWNER
  providerBehaviour = { de: 'fail' }
  const res = await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })

  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['fields', 'sections', 'success', 'translation'])
  assert.deepEqual(res.body.translation.fields.heroCtaPrimary, {
    sourceLang: 'en',
    translated: ['tr', 'ar', 'ru', 'ur'],
    needsAttention: [{ lang: 'de', reason: 'provider_error', using: 'none' }],
  })
  assert.deepEqual(res.body.fields.heroCtaPrimary, stored('heroCtaPrimary'), 'the editor is given what was stored, meta included')
})

/* ══════════════════════ 12. CMS Phase C2 — retry ONE translation ══════════════════════
 *
 * POST /:pageKey/fields/:fieldKey/translations/:lang/retry translates one
 * language of one stored text field again. What these tests pin down is as
 * much what it must NOT do: replace text of unknown origin, take text from the
 * caller, touch any other language or field, or write after the source moved.
 */

const retry = (lang, fieldKey = 'heroCtaPrimary', pageKey = 'home', body) =>
  request('POST', `/api/page-content/${pageKey}/fields/${fieldKey}/translations/${lang}/retry`, body)

const HASH_V1 = sourceHash('Explore Services')
const HASH_V2 = sourceHash('Discover Our Services')
const AT_V1 = '2026-10-01T10:00:00.000Z'
const AT_V2 = '2026-10-08T12:30:00.000Z'
const machine = (from, at) => ({ from, by: 'machine', at })

/*
 * A field as Phase B leaves it after the source was reworded and German alone
 * failed: German is a translation of version 1 (stale), Urdu never translated
 * (missing), everything else is current.
 */
const TRACKED_BUTTON = {
  type: 'text',
  sourceLang: 'en',
  en: 'Discover Our Services',
  tr: 'Hizmetlerimizi Keşfedin',
  ar: 'اكتشف خدماتنا',
  de: 'Leistungen entdecken',
  ru: 'Откройте наши услуги',
  meta: {
    sourceHash: HASH_V2,
    langs: {
      tr: machine(HASH_V2, AT_V2),
      ar: machine(HASH_V2, AT_V2),
      de: { ...machine(HASH_V1, AT_V1), error: 'provider_error', errorAt: AT_V2 },
      ru: machine(HASH_V2, AT_V2),
      ur: { error: 'timeout', errorAt: AT_V2 },
    },
  },
}

// The two hero fields exactly as production stores them: six hand-written
// languages and no metadata at all.
const PRODUCTION_HERO = {
  heroLabel: {
    type: 'text', sourceLang: 'en', verified: false,
    en: 'Istanbul · Architecture · Construction · Real Estate',
    tr: 'İstanbul · Mimarlık · İnşaat · Gayrimenkul',
    ar: 'إسطنبول · معمار · إنشاء · عقارات',
    de: 'Istanbul · Architektur · Bau · Immobilien',
    ru: 'Стамбул · Архитектура · Строительство · Недвижимость',
    ur: 'استنبول · تعمیراتی ڈیزائن · تعمیرات · جائیداد',
  },
  heroCtaPrimary: {
    type: 'text', sourceLang: 'en', verified: false,
    en: 'Explore Services', tr: 'Hizmetleri Keşfedin', ar: 'استكشف الخدمات',
    de: 'Leistungen entdecken', ru: 'Изучить услуги', ur: 'خدمات دیکھیں',
  },
}

const seedHome = (fields, sections = { services: true, projects: false }) => {
  store.set('home', structuredClone({ pageKey: 'home', fields, sections }))
  return structuredClone(store.get('home'))
}
const seedTracked = () => seedHome({
  heroCtaPrimary: TRACKED_BUTTON,
  heroLabel: PRODUCTION_HERO.heroLabel,
  heroImage: { type: 'image', url: '/images/hero.png' },
})
const pairOf = (href) => new URL(href).searchParams.get('langpair')
const RETRY_REFUSALS = ['source_language', 'already_current', 'manual_translation', 'legacy_translation']

test('12a. retry is guarded exactly like the save', async () => {
  const before = seedTracked()

  assert.equal((await retry('de')).status, 401, 'anonymous')
  for (const user of [CUSTOMER, AGENT, ADMIN_WITHOUT]) {
    currentUser = user
    assert.equal((await retry('de')).status, 403, `${user.role} was allowed`)
  }
  assert.equal(providerCalls.length, 0, 'a refused caller spent no translation request')
  assert.equal(updateCalls.length, 0)
  assert.deepEqual(store.get('home'), before)

  for (const user of [OWNER, ADMIN_WITH]) {
    seedTracked()
    currentUser = user
    const res = await retry('de')
    assert.equal(res.status, 200, `${user.role} was refused`)
    assert.equal(res.body.translated, true)
  }
})

test('12b. an address that is not a retryable translation is rejected before anything is read or sent', async () => {
  const before = seedTracked()
  currentUser = OWNER

  const cases = [
    [() => retry('de', 'heroCtaPrimary', 'nope'), 404, 'unknown_page'],
    [() => retry('de', 'heroCtaPrimary', 'about'), 404, 'unknown_page'],
    [() => retry('de', 'noSuchField'), 404, 'unknown_field'],
    [() => retry('de', 'constructor'), 404, 'unknown_field'],
    [() => retry('de', 'heroImage'), 400, 'not_text'],
    [() => retry('fr'), 400, 'invalid_language'],
    [() => retry('DE'), 400, 'invalid_language'],
    [() => retry('autodetect'), 400, 'invalid_language'],
    [() => retry('meta'), 400, 'invalid_language'],
  ]
  for (const [send, status, reason] of cases) {
    const res = await send()
    assert.equal(res.status, status, reason)
    assert.equal(res.body.success, false)
    assert.equal(res.body.reason, reason)
  }

  assert.equal(providerCalls.length, 0)
  assert.equal(updateCalls.length, 0)
  assert.deepEqual(store.get('home'), before)
})

test('12c. the source language itself, and a field with nothing saved, cannot be retried', async () => {
  const before = seedTracked()
  currentUser = OWNER

  const source = await retry('en')
  assert.equal(source.status, 409)
  assert.equal(source.body.reason, 'source_language')

  // Registered, but never saved on this page: there is no stored source to translate.
  const unsaved = await retry('de', 'heroHeading1')
  assert.equal(unsaved.status, 409)
  assert.equal(unsaved.body.reason, 'no_source')

  // No document at all.
  const noDocument = await retry('de', 'heroHeading', 'contact')
  assert.equal(noDocument.status, 409)
  assert.equal(noDocument.body.reason, 'no_source')

  assert.equal(providerCalls.length, 0)
  assert.equal(updateCalls.length, 0)
  assert.deepEqual(store.get('home'), before)
})

test('12d. a current machine translation is not retried', async () => {
  const before = seedTracked()
  currentUser = OWNER

  for (const lang of ['tr', 'ar', 'ru']) {
    const res = await retry(lang)
    assert.equal(res.status, 409, lang)
    assert.equal(res.body.reason, 'already_current', lang)
  }
  assert.equal(providerCalls.length, 0)
  assert.deepEqual(store.get('home'), before)
})

test('12e. a hand-written translation is not retried — current or stale', async () => {
  const field = structuredClone(TRACKED_BUTTON)
  field.meta.langs.tr = { from: HASH_V2, by: 'manual', at: AT_V2 }
  field.meta.langs.de = { from: HASH_V1, by: 'manual', at: AT_V1, error: 'provider_error', errorAt: AT_V2 }
  const before = seedHome({ heroCtaPrimary: field })
  currentUser = OWNER

  for (const lang of ['tr', 'de']) {
    const res = await retry(lang)
    assert.equal(res.status, 409, lang)
    assert.equal(res.body.reason, 'manual_translation', lang)
  }
  assert.equal(providerCalls.length, 0)
  assert.equal(updateCalls.length, 0)
  assert.deepEqual(store.get('home'), before)
})

test('12f. EXISTING TEXT OF UNKNOWN ORIGIN IS NEVER OVERWRITTEN: the production hero translations are refused', async () => {
  const before = seedHome(PRODUCTION_HERO)
  currentUser = OWNER

  for (const fieldKey of ['heroLabel', 'heroCtaPrimary']) {
    for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) {
      const res = await retry(lang, fieldKey)
      assert.equal(res.status, 409, `${fieldKey}.${lang}`)
      assert.equal(res.body.success, false)
      assert.equal(res.body.reason, 'legacy_translation', `${fieldKey}.${lang}`)
    }
  }

  assert.equal(providerCalls.length, 0, 'not one translation was even requested')
  assert.equal(updateCalls.length, 0, 'not one write was attempted')
  assert.deepEqual(store.get('home'), before, 'the document is byte-for-byte what it was')
  assert.equal(containsMeta(store.get('home')), false, 'and no metadata was created')
})

test('12g. a recorded failure does not make unknown text retryable', async () => {
  // Phase B, after a save whose German translation failed: the legacy German
  // text was kept and a failure recorded beside it. It is still legacy text.
  store.set('home', { pageKey: 'home', fields: { heroCtaPrimary: structuredClone(LEGACY_BUTTON) }, sections: {} })
  currentUser = OWNER
  providerBehaviour = { de: 'fail' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  assert.equal(stored('heroCtaPrimary').meta.langs.de.error, 'provider_error')
  assert.equal(translationStatesOf(stored('heroCtaPrimary')).de, 'unknown')
  const before = structuredClone(store.get('home'))
  providerBehaviour = {}
  providerCalls = []

  const res = await retry('de')

  assert.equal(res.status, 409)
  assert.equal(res.body.reason, 'legacy_translation')
  assert.equal(providerCalls.length, 0)
  assert.equal(stored('heroCtaPrimary').de, 'Leistungen entdecken')
  assert.deepEqual(store.get('home'), before)
})

test('12h. SUCCESSFUL STALE RETRY: new text, fresh provenance, no error — the state becomes translated', async () => {
  seedTracked()
  currentUser = OWNER
  const started = Date.now()

  const res = await retry('de')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { success: true, fieldKey: 'heroCtaPrimary', lang: 'de', translated: true, translationState: 'translated' })

  const field = stored('heroCtaPrimary')
  assert.equal(field.de, '[de] Discover Our Services', 'the German text is the translation of the CURRENT source')
  assert.deepEqual(Object.keys(field.meta.langs.de).sort(), ['at', 'by', 'from'], 'error and errorAt are gone')
  assert.equal(field.meta.langs.de.from, HASH_V2)
  assert.equal(field.meta.langs.de.by, 'machine')
  assert.match(field.meta.langs.de.at, ISO)
  assert.ok(Date.parse(field.meta.langs.de.at) >= started - 1000, 'stamped now, not with the old time')
  assert.equal(field.meta.sourceHash, HASH_V2)
  assert.equal(translationStatesOf(field).de, 'translated')
})

test('12i. SUCCESSFUL MISSING RETRY: the text and its provenance are created', async () => {
  seedTracked()
  currentUser = OWNER
  assert.equal('ur' in stored('heroCtaPrimary'), false)

  const res = await retry('ur')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { success: true, fieldKey: 'heroCtaPrimary', lang: 'ur', translated: true, translationState: 'translated' })
  const field = stored('heroCtaPrimary')
  assert.equal(field.ur, '[ur] Discover Our Services')
  assert.deepEqual(Object.keys(field.meta.langs.ur).sort(), ['at', 'by', 'from'], 'the earlier failure is cleared')
  assert.equal(field.meta.langs.ur.from, HASH_V2)
  assert.equal(field.meta.langs.ur.by, 'machine')
  assert.equal(translationStatesOf(field).ur, 'translated')
})

test('12j. exactly ONE provider request is made, for the one language, from the stored source language', async () => {
  seedTracked()
  currentUser = OWNER

  await retry('de')

  assert.equal(providerCalls.length, 1)
  assert.equal(pairOf(providerCalls[0]), 'en|de')
  assert.equal(new URL(providerCalls[0]).searchParams.get('q'), 'Discover Our Services')
  assert.equal(providerCalls.some((href) => href.includes('autodetect')), false, 'the source language is not detected again')
})

test('12k. the source text and language come from the database — nothing the caller sends is used', async () => {
  const field = { type: 'text', sourceLang: 'tr', tr: 'Hizmetlerimizi Keşfedin', en: 'Discover Our Services', meta: { sourceHash: sourceHash('Hizmetlerimizi Keşfedin'), langs: { en: machine(sourceHash('Hizmetlerimizi Keşfedin'), AT_V2) } } }
  seedHome({ heroCtaPrimary: field })
  currentUser = OWNER

  const res = await retry('de', 'heroCtaPrimary', 'home', {
    value: 'ATTACKER TEXT', text: 'ATTACKER TEXT', source: 'ATTACKER TEXT', sourceLang: 'en', lang: 'ru',
    translation: 'ATTACKER TRANSLATION', fields: { heroLabel: { type: 'text', value: 'ATTACKER TEXT' } },
  })

  assert.equal(res.status, 200)
  assert.equal(providerCalls.length, 1)
  assert.equal(pairOf(providerCalls[0]), 'tr|de', 'a Turkish-source field is translated FROM Turkish')
  assert.equal(new URL(providerCalls[0]).searchParams.get('q'), 'Hizmetlerimizi Keşfedin')
  assert.equal(stored('heroCtaPrimary').de, '[de] Hizmetlerimizi Keşfedin')
  assert.equal(JSON.stringify(store.get('home')).includes('ATTACKER'), false)
  assert.equal('ru' in stored('heroCtaPrimary'), false, 'the language is the one in the address')
  assert.equal(stored('heroCtaPrimary').sourceLang, 'tr')
})

test('12l. FAILED STALE RETRY: the old text and its real provenance are kept; only the failure is updated', async () => {
  const before = seedTracked()
  currentUser = OWNER
  providerBehaviour = { de: 'fail' }

  const res = await retry('de')

  assert.equal(res.status, 200, 'the request was carried out; the provider produced nothing')
  assert.deepEqual(res.body, { success: true, fieldKey: 'heroCtaPrimary', lang: 'de', translated: false, reason: 'provider_error', translationState: 'stale' })

  const field = stored('heroCtaPrimary')
  assert.equal(field.de, 'Leistungen entdecken', 'the German text is exactly what it was')
  assert.equal(field.meta.langs.de.from, HASH_V1, 'still a translation of version 1')
  assert.equal(field.meta.langs.de.by, 'machine')
  assert.equal(field.meta.langs.de.at, AT_V1, 'the time of the last real translation is not moved')
  assert.equal(field.meta.langs.de.error, 'provider_error')
  assert.match(field.meta.langs.de.errorAt, ISO)
  assert.notEqual(field.meta.langs.de.errorAt, AT_V2, 'the failure time is this attempt')
  assert.deepEqual(Object.keys(field.meta.langs.de).sort(), ['at', 'by', 'error', 'errorAt', 'from'])
  assert.equal(translationStatesOf(field).de, 'stale')

  // Nothing else moved.
  const expected = structuredClone(before)
  expected.fields.heroCtaPrimary.meta.langs.de = field.meta.langs.de
  assert.deepEqual(store.get('home'), expected)
  assert.ok(providerCalls.every((href) => pairOf(href) === 'en|de'), 'every attempt was for German only')
})

test('12m. FAILED MISSING RETRY: no empty value is stored, only the failure', async () => {
  const before = seedTracked()
  currentUser = OWNER
  providerBehaviour = { ur: 'fail' }

  const res = await retry('ur')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { success: true, fieldKey: 'heroCtaPrimary', lang: 'ur', translated: false, reason: 'provider_error', translationState: 'missing' })
  const field = stored('heroCtaPrimary')
  assert.equal('ur' in field, false, 'no `ur: ""` was written')
  assert.deepEqual(Object.keys(field.meta.langs.ur).sort(), ['error', 'errorAt'], 'no provenance is invented')
  assert.equal(field.meta.langs.ur.error, 'provider_error')
  assert.match(field.meta.langs.ur.errorAt, ISO)
  assert.equal(translationStatesOf(field).ur, 'missing')

  const expected = structuredClone(before)
  expected.fields.heroCtaPrimary.meta.langs.ur = field.meta.langs.ur
  assert.deepEqual(store.get('home'), expected)
})

test('12n. an echoed or quota-poisoned answer is a failure with a stable reason — never stored, never relayed', async () => {
  for (const [mode, reason] of [['echo', 'echo'], ['poison', 'quota']]) {
    for (const [lang, state, kept] of [['de', 'stale', 'Leistungen entdecken'], ['ur', 'missing', undefined]]) {
      seedTracked()
      currentUser = OWNER
      providerBehaviour = { [lang]: mode }

      const res = await retry(lang)

      assert.equal(res.status, 200)
      assert.equal(res.body.translated, false)
      assert.equal(res.body.reason, reason, `${mode} for ${lang}`)
      assert.equal(res.body.translationState, state)
      assert.equal(stored('heroCtaPrimary')[lang], kept)
      assert.equal(stored('heroCtaPrimary').meta.langs[lang].error, reason)
      assert.equal(JSON.stringify(res.body).includes('MYMEMORY'), false, 'provider text reached the client')
      assert.equal(JSON.stringify(store.get('home')).includes('MYMEMORY'), false, 'provider text reached the database')
    }
  }
})

test('12o. SINGLE-LANGUAGE ISOLATION: a German retry changes German and nothing else', async () => {
  const before = seedTracked()
  currentUser = OWNER

  await retry('de')

  const after = store.get('home')
  const field = after.fields.heroCtaPrimary
  for (const lang of ['en', 'tr', 'ar', 'ru', 'ur']) {
    assert.deepEqual(field[lang], before.fields.heroCtaPrimary[lang], `${lang} text changed`)
    assert.deepEqual(field.meta.langs[lang], before.fields.heroCtaPrimary.meta.langs[lang], `${lang} metadata changed`)
  }
  assert.equal(field.sourceLang, 'en')
  assert.equal(field.type, 'text')
  assert.deepEqual(after.fields.heroLabel, before.fields.heroLabel, 'another text field changed')
  assert.deepEqual(after.fields.heroImage, before.fields.heroImage, 'an image field changed')
  assert.deepEqual(after.sections, before.sections, 'section visibility changed')
  assert.deepEqual(Object.keys(after.fields).sort(), Object.keys(before.fields).sort())

  // Put German back and the whole document is what it was.
  const restored = structuredClone(after)
  restored.fields.heroCtaPrimary.de = before.fields.heroCtaPrimary.de
  restored.fields.heroCtaPrimary.meta.langs.de = before.fields.heroCtaPrimary.meta.langs.de
  assert.deepEqual(restored, before)
})

test('12p. the write is ONE update whose every path belongs to the one field and language', async () => {
  seedTracked()
  currentUser = OWNER

  await retry('de')

  assert.equal(updateCalls.length, 1)
  const { filter, update } = updateCalls[0]
  assert.deepEqual(Object.keys(update), ['$set'], 'nothing but $set — no replacement document, no $unset')
  assert.deepEqual(Object.keys(update.$set).sort(), [
    'fields.heroCtaPrimary.de',
    'fields.heroCtaPrimary.meta.langs.de',
    'fields.heroCtaPrimary.meta.sourceHash',
  ])
  assert.equal(update.$set['fields.heroCtaPrimary.meta.sourceHash'], HASH_V2, 'the hash of the stored source, as it already was')
  // The update only applies while the stored source is the text that was translated.
  assert.deepEqual(filter, {
    pageKey: 'home',
    'fields.heroCtaPrimary.sourceLang': 'en',
    'fields.heroCtaPrimary.en': 'Discover Our Services',
  })

  // A failed attempt writes even less: no text path at all.
  seedTracked()
  updateCalls = []
  providerBehaviour = { de: 'fail' }
  await retry('de')
  assert.deepEqual(Object.keys(updateCalls[0].update.$set).sort(), [
    'fields.heroCtaPrimary.meta.langs.de',
    'fields.heroCtaPrimary.meta.sourceHash',
  ])
})

test('12q. THE RACE: the source is saved again while the retry is translating — nothing is written', async () => {
  seedTracked()
  currentUser = OWNER
  // Another admin's save lands between the retry's read and its write.
  let concurrent
  duringTranslation = () => {
    const doc = structuredClone(store.get('home'))
    doc.fields.heroCtaPrimary = {
      type: 'text', sourceLang: 'en', en: 'See What We Build', de: '[de] See What We Build',
      meta: { sourceHash: sourceHash('See What We Build'), langs: { de: machine(sourceHash('See What We Build'), '2026-10-09T09:15:00.000Z') } },
    }
    store.set('home', doc)
    concurrent = structuredClone(doc)
  }

  const res = await retry('de')

  assert.equal(res.status, 409)
  assert.equal(res.body.success, false)
  assert.equal(res.body.reason, 'source_changed')
  assert.equal('translated' in res.body, false, 'a conflict is not reported as a translation result')
  assert.deepEqual(store.get('home'), concurrent, 'the newer save is intact')
  assert.equal(stored('heroCtaPrimary').de, '[de] See What We Build', 'the translation of the OLD source was not stored over it')
  assert.equal(JSON.stringify(store.get('home')).includes('Discover Our Services'), false)
})

test('12r. THE RACE: a change of source LANGUAGE, or the field being emptied, is also a conflict', async () => {
  for (const change of [
    (field) => { field.sourceLang = 'tr' },
    (field) => { field.en = '' },
    (field) => { field.en = 'Discover Our Services ' },
  ]) {
    seedTracked()
    currentUser = OWNER
    let concurrent
    duringTranslation = () => {
      const doc = structuredClone(store.get('home'))
      change(doc.fields.heroCtaPrimary)
      store.set('home', doc)
      concurrent = structuredClone(doc)
    }

    const res = await retry('de')

    assert.equal(res.status, 409)
    assert.equal(res.body.reason, 'source_changed')
    assert.deepEqual(store.get('home'), concurrent)
  }
})

test('12s. the four kinds of answer are distinguishable from the response alone', async () => {
  seedTracked()
  currentUser = OWNER

  const translated = await retry('ur')
  assert.deepEqual([translated.status, translated.body.success, translated.body.translated], [200, true, true])

  providerBehaviour = { de: 'fail' }
  const providerFailure = await retry('de')
  assert.deepEqual([providerFailure.status, providerFailure.body.success, providerFailure.body.translated], [200, true, false])
  assert.equal(RETRY_REFUSALS.includes(providerFailure.body.reason), false)

  const refused = await retry('tr')
  assert.deepEqual([refused.status, refused.body.success], [409, false])
  assert.ok(RETRY_REFUSALS.includes(refused.body.reason))
  assert.equal(typeof refused.body.message, 'string')

  const invalid = await retry('fr')
  assert.deepEqual([invalid.status, invalid.body.success], [400, false])

  currentUser = null
  assert.equal((await retry('de')).status, 401)
})

test('12t. after a retry the admin read reports the new state, and the public read still shows no metadata', async () => {
  seedTracked()
  currentUser = OWNER
  assert.equal((await adminRead()).body.translationStates.heroCtaPrimary.de, 'stale')

  await retry('de')

  const admin = await adminRead()
  assert.deepEqual(admin.body.translationStates.heroCtaPrimary, { en: 'source', tr: 'translated', ar: 'translated', de: 'translated', ru: 'translated', ur: 'missing' })
  assert.equal(admin.body.fields.heroCtaPrimary.de, '[de] Discover Our Services')

  currentUser = null
  const visitor = await request('GET', '/api/page-content/home')
  assert.equal(visitor.body.fields.heroCtaPrimary.de, '[de] Discover Our Services')
  assert.equal(containsMeta(visitor.body), false)
})

test('12u. a language missing on a field saved BEFORE tracking can be filled without touching its legacy text', async () => {
  // German and Turkish are legacy text; Arabic has never existed.
  const before = seedHome({ heroCtaPrimary: LEGACY_BUTTON })
  currentUser = OWNER

  assert.equal((await retry('de')).body.reason, 'legacy_translation')
  assert.equal((await retry('tr')).body.reason, 'legacy_translation')
  assert.equal(providerCalls.length, 0)

  const res = await retry('ar')

  assert.equal(res.status, 200)
  assert.equal(res.body.translationState, 'translated')
  const field = stored('heroCtaPrimary')
  assert.equal(field.ar, '[ar] Explore Services')
  assert.equal(field.de, before.fields.heroCtaPrimary.de)
  assert.equal(field.tr, before.fields.heroCtaPrimary.tr)
  assert.deepEqual(Object.keys(field.meta.langs), ['ar'], 'no provenance was invented for the legacy languages')
  assert.deepEqual(translationStatesOf(field), { en: 'source', tr: 'unknown', ar: 'translated', de: 'unknown', ru: 'missing', ur: 'missing' })
})

test('12v. a retry that follows a real failed save turns the language current, end to end', async () => {
  currentUser = OWNER
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Explore Services') } })
  providerBehaviour = { de: 'fail' }
  await request('PUT', '/api/page-content/home', { fields: { heroCtaPrimary: text('Discover Our Services') } })
  assert.equal(translationStatesOf(stored('heroCtaPrimary')).de, 'stale')
  const others = structuredClone(stored('heroCtaPrimary'))
  providerBehaviour = {}
  providerCalls = []

  const res = await retry('de')

  assert.equal(res.body.translationState, 'translated')
  assert.equal(providerCalls.length, 1)
  const field = stored('heroCtaPrimary')
  assert.equal(field.de, '[de] Discover Our Services')
  assert.deepEqual(translationStatesOf(field), { en: 'source', tr: 'translated', ar: 'translated', de: 'translated', ru: 'translated', ur: 'translated' })
  for (const lang of ['en', 'tr', 'ar', 'ru', 'ur']) {
    assert.equal(field[lang], others[lang], lang)
    assert.deepEqual(field.meta.langs[lang], others.meta.langs[lang], lang)
  }

  // And once it is current it is no longer retryable.
  assert.equal((await retry('de')).body.reason, 'already_current')
})
