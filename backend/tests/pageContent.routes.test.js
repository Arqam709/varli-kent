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
  providerCalls = []
  providerBehaviour = {}
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
