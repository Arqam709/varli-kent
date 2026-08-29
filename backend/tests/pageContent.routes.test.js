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
/** lang -> 'ok' | 'fail' | 'poison'. Missing means 'ok'. */
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

  const mode = providerBehaviour[lang] || 'ok'
  if (mode === 'fail') return { ok: false, json: async () => ({}) }
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
