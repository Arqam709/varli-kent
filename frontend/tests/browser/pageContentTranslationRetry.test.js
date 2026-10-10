// CMS Phase C2 — retry ONE translation from the Page Content editor's preview.
//
// The real editor in a real browser. Every API call is answered here: no
// backend runs, nothing reaches MongoDB, and no translation is requested from
// any provider.
//
// The retry endpoint is not merely stubbed: each POST is handed to the
// backend's own retryPageContentTranslation, running in this process on an
// in-memory document with a scripted provider. So what the editor is shown
// after a retry is exactly what the real API would have stored and returned —
// including its refusals.
// Run from frontend/:
//   node --test tests/browser/pageContentTranslationRetry.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import translations from '../../src/locales/translations.js'
import { allFieldDefs } from '../../src/lib/pageContentRegistry.js'
import { catalogueText } from '../../src/lib/pageContentCatalogue.js'
import { languageList } from '../../src/lib/pageContentSaveReport.js'
import { sourceHash, translationStatesOf } from '../../../backend/utils/translationState.js'
import { retryPageContentTranslation } from '../../../backend/services/pageContentTranslationRetry.js'

let server
let browser
let base
const FIXTURE = '/__page_content_translation_retry.html'
const shots = join(tmpdir(), 'varlikent-cms-c2')
mkdirSync(shots, { recursive: true })

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { LanguageProvider } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import AdminPageContent from '/src/pages/AdminPageContent.jsx';
import '/src/index.css';
const e = React.createElement;
createRoot(document.getElementById('root')).render(
  e(MemoryRouter, null, e(LanguageProvider, null, e(AuthProvider, null, e(ToastContainer), e(AdminPageContent))))
);
</script></body></html>`

// The service logs a provider failure, as it should in production. Here those
// failures are staged, so the log is kept out of the test output.
const realWarn = console.warn
before(async () => {
  console.warn = (...args) => { if (!String(args[0]).startsWith('[page-content]')) realWarn(...args) }
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'page-content-translation-retry-harness',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith(FIXTURE) || req.url.includes('html-proxy')) return next()
          try {
            res.setHeader('Content-Type', 'text/html')
            res.end(await vite.transformIndexHtml(FIXTURE, html))
          } catch (error) { next(error) }
        })
      },
    }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})

after(async () => { console.warn = realWarn; await browser?.close(); await server?.close() })

/* ══════════════ fixtures ══════════════ */

const OWNER = { _id: 'owner1', role: 'owner', name: 'Test Owner', permissions: [] }
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const pc = (lang) => translations[lang].adminPages.pageContent
const direction = (lang) => (['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr')
const HOME_TEXT = allFieldDefs('home').filter((def) => def.type !== 'image')
const INTERNAL = [/[0-9a-f]{64}/, /sourceHash/, /\bmeta\b/, /"from"/, /provider_error/, /source_changed/, /legacy_translation/, /already_current/, /\[object Object\]/]
const RETRY_PATH = /^\/page-content\/home\/fields\/([^/]+)\/translations\/([^/]+)\/retry$/

const HERO = {
  heroLabel: { en: 'Istanbul · Architecture · Construction · Real Estate', tr: 'İstanbul · Mimarlık · İnşaat · Gayrimenkul', ar: 'إسطنبول · معمار · إنشاء · عقارات', de: 'Istanbul · Architektur · Bau · Immobilien', ru: 'Стамбул · Архитектура · Строительство · Недвижимость', ur: 'استنبول · تعمیراتی ڈیزائن · تعمیرات · جائیداد' },
  heroCtaPrimary: { en: 'Explore Services', tr: 'Hizmetleri Keşfedin', ar: 'استكشف الخدمات', de: 'Leistungen entdecken', ru: 'Изучить услуги', ur: 'خدمات دیکھیں' },
}
// The homepage as production holds it: English defaults with no metadata, and
// two hero fields with five hand-written translations each.
const productionHome = () => {
  const fields = {}
  for (const def of HOME_TEXT) fields[def.key] = { type: 'text', sourceLang: 'en', en: def.default, verified: false }
  fields.heroHeading1.en = 'We Design, Build\n'
  for (const [key, values] of Object.entries(HERO)) fields[key] = { type: 'text', sourceLang: 'en', ...values, verified: false }
  fields.heroImage = { type: 'image', url: '/images/hero-villa.jpg.png' }
  return fields
}

const at = '2026-10-09T10:00:00.000Z'
const EDITED = 'Discover Our Services'
const OLDER = 'Explore Services'
const tracked = (source, slots, langs) => ({ type: 'text', sourceLang: 'en', en: source, ...slots, meta: { sourceHash: sourceHash(source), langs } })
const current = (source) => ({ from: sourceHash(source), by: 'machine', at })

/*
 * The production homepage with ONE field (heroCtaPrimary, the 5th text field)
 * carrying every tracked state:
 *   TR  Current     a machine translation of the current source
 *   AR  Manual      hand-written for the current source
 *   DE  Stale       a machine translation of the earlier wording
 *   RU  Needs attention   nothing stored; the built-in text is of the old wording
 *   UR  Existing    text from before tracking, with a failed attempt beside it
 */
const trackedHome = () => ({
  ...productionHome(),
  heroCtaPrimary: tracked(EDITED, { tr: 'Hizmetlerimizi Keşfedin', ar: 'اكتشف خدماتنا', de: 'Leistungen entdecken', ur: 'خدمات دیکھیں' }, {
    tr: current(EDITED),
    ar: { from: sourceHash(EDITED), by: 'manual', at },
    de: { from: sourceHash(OLDER), by: 'machine', at: '2026-10-01T09:00:00.000Z' },
    ur: { error: 'provider_error', errorAt: at },
  }),
})

// What the scripted provider answers for the edited button text.
const PROVIDED = { tr: 'Hizmetlerimizi Keşfedin', ar: 'اكتشف خدماتنا', de: 'Entdecken Sie unsere Leistungen', ru: 'Откройте наши услуги', ur: 'ہماری خدمات دریافت کریں' }

/*
 * The API the editor talks to, in memory.
 *
 *   doc        the stored page — what MongoDB would hold
 *   provider   lang -> 'ok' | 'fail' | 'echo' | 'quota' (missing = 'ok')
 *   answers    lang -> the translation the provider gives when it is 'ok'
 *   duringTranslation   runs while a provider request is in flight — how
 *                       another admin's save is staged in the middle of a retry
 *   retry()    the backend's real retry service, on `doc`
 */
const makeBackend = (fields, sections = {}) => {
  const state = { doc: structuredClone({ pageKey: 'home', fields, sections }), provider: {}, answers: { ...PROVIDED }, providerCalls: [], updates: 0, duringTranslation: null }
  const valueAt = (object, dotted) => dotted.split('.').reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), object)
  const setAt = (object, dotted, value) => {
    const keys = dotted.split('.')
    let node = object
    for (const key of keys.slice(0, -1)) { if (node[key] === null || typeof node[key] !== 'object') node[key] = {}; node = node[key] }
    node[keys.at(-1)] = value
  }
  const PageContent = {
    findOne: () => ({ lean: async () => structuredClone(state.doc) }),
    updateOne: async (filter, update) => {
      if (!Object.entries(filter).every(([dotted, expected]) => valueAt(state.doc, dotted) === expected)) return { matchedCount: 0, modifiedCount: 0 }
      const next = structuredClone(state.doc)
      for (const [dotted, value] of Object.entries(update.$set)) setAt(next, dotted, structuredClone(value))
      state.doc = next
      state.updates += 1
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }
  const fetchImpl = async (url) => {
    const params = new URL(String(url)).searchParams
    const lang = params.get('langpair').split('|')[1]
    state.providerCalls.push(params.get('langpair'))
    if (state.duringTranslation) await state.duringTranslation()
    const mode = state.provider[lang] || 'ok'
    const reply = (translatedText) => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText } }) })
    if (mode === 'fail') return { ok: false, json: async () => ({}) }
    if (mode === 'echo') return reply(params.get('q'))
    if (mode === 'quota') return reply('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY')
    return reply(state.answers[lang])
  }
  return {
    state,
    adminRead: () => ({
      success: true,
      fields: structuredClone(state.doc.fields),
      sections: structuredClone(state.doc.sections),
      translationStates: Object.fromEntries(Object.entries(state.doc.fields).filter(([, f]) => f.type === 'text').map(([key, f]) => [key, translationStatesOf(f)])),
    }),
    retry: (fieldKey, lang) => retryPageContentTranslation({ PageContent, pageKey: 'home', fieldKey, lang, fetchImpl }),
  }
}

const deferred = () => {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release }
}

/*
 * Opens the editor on the homepage, backed by `backend`.
 *   retryReply   replaces the real service for a POST: (fieldKey, lang) =>
 *                { status, body } | 'abort' | undefined (fall through to the service)
 *   gate         a promise each retry POST waits on before it is answered
 *   saveGate     a promise the save (PUT) waits on; without it a PUT is an error
 *   patchModule  { match, transform } — rewrites one source module in this
 *                browser only
 */
async function open(t, backend, { language = 'en', retryReply, gate, saveGate, patchModule } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  const calls = []
  const options = { retryReply, gate }

  await page.addInitScript(({ language, owner }) => {
    localStorage.setItem('vk_lang', language)
    localStorage.setItem('vk_lang_explicit', '1')
    localStorage.setItem('varlikent_token', 'isolated-test-token')
    localStorage.setItem('varlikent_user', JSON.stringify(owner))
  }, { language, owner: OWNER })

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.includes('/api/')) {
      if (url.origin !== base) return route.abort()
      if (patchModule && patchModule.match.test(url.pathname)) {
        const response = await route.fetch()
        return route.fulfill({ response, body: patchModule.transform(await response.text()) })
      }
      return route.continue()
    }
    const path = url.pathname.replace(/^.*?\/api(?=\/)/, '')
    const method = request.method()
    calls.push({ method, path, body: request.postData() })
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/auth/me') return json(200, { success: true, user: OWNER })
    if (path === '/page-content/home/admin' && method === 'GET') return json(200, backend.adminRead())

    const retry = method === 'POST' && path.match(RETRY_PATH)
    if (retry) {
      if (options.gate) await options.gate
      const staged = options.retryReply?.(retry[1], retry[2])
      if (staged === 'abort') return route.abort('failed')
      const { status, body } = staged || await backend.retry(retry[1], retry[2])
      return json(status, body)
    }
    if (method === 'PUT' && path === '/page-content/home' && saveGate) {
      await saveGate
      return json(200, { success: true, fields: backend.adminRead().fields, sections: {}, translation: { fields: {} } })
    }
    // Anything else would be a write this suite never expects.
    if (method !== 'GET') return json(500, { success: false, message: 'unexpected write in the retry suite' })
    return json(200, { success: true, fields: {}, sections: {} })
  })

  await page.goto(`${base}${FIXTURE}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await expect(page.getByRole('heading', { level: 1, name: pc(language).title })).toBeVisible({ timeout: 120000 })
  await expect(page.locator('textarea').first()).toBeVisible()
  return { page, calls, options }
}

// The status block under the nth text field of the (open) hero card, in registry order:
// 0 heroLabel, 1 heroHeading1, 2 heroHeading2, 3 heroHeading3, 4 heroCtaPrimary, 5 heroCtaSecondary.
const statusOf = (page, index) => page.getByTestId('translation-status').nth(index)
const chipsOf = async (block) => block.getByTestId('translation-chip').evaluateAll((els) => els.map((el) => `${el.dataset.lang}:${el.dataset.status}`))
const previewRow = (block, lang) => block.locator(`[data-testid="translation-preview-row"][data-lang="${lang}"]`)
const retryButton = (block, lang) => previewRow(block, lang).getByTestId('translation-retry')
const openPreview = async (block, language = 'en') => {
  await block.getByRole('button', { name: pc(language).translationsShow }).click()
  await expect(block.getByTestId('translation-preview')).toBeVisible()
}
const toast = (page, text) => page.locator('.Toastify__toast').filter({ hasText: text })
// Toasts close by themselves after five seconds (unless the pointer rests on
// one). Waiting for that lets the same message be awaited again.
const toastsGone = async (page) => {
  await page.mouse.move(5, 5)
  await expect(page.locator('.Toastify__toast')).toHaveCount(0, { timeout: 15000 })
}
const summary = (page) => page.getByTestId('translation-summary')
const requests = (calls) => calls.filter((c) => c.path.startsWith('/page-content')).map((c) => `${c.method} ${c.path}`)
const posts = (calls) => calls.filter((c) => c.method === 'POST')
const named = (message, lang, language) => message.replace('{language}', languageList([lang], language))
const retryUrl = (fieldKey, lang) => `POST /page-content/home/fields/${fieldKey}/translations/${lang}/retry`
const noInternals = async (locator) => {
  const text = await locator.innerText()
  for (const pattern of INTERNAL) assert.doesNotMatch(text, pattern)
}

/* ══════════════ 1. Where Retry appears ══════════════ */

test('Retry is offered for Stale and Needs attention, and for nothing else on the field', async (t) => {
  const backend = makeBackend(trackedHome())
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:current', 'ar:manual', 'de:stale', 'ru:outdated', 'ur:existing'])

  // Never on a chip, and not before the preview is opened.
  await expect(page.getByTestId('translation-retry')).toHaveCount(0)
  await expect(block.getByTestId('translation-chip').locator('button')).toHaveCount(0)

  await openPreview(block)
  await expect(retryButton(block, 'de')).toBeVisible()
  await expect(retryButton(block, 'ru')).toBeVisible()
  for (const lang of ['en', 'tr', 'ar', 'ur']) await expect(retryButton(block, lang)).toHaveCount(0)
  await expect(block.getByTestId('translation-retry')).toHaveCount(2)

  // A text button with the language in its accessible name.
  await expect(retryButton(block, 'de')).toHaveText('Retry translation')
  await expect(block.getByRole('button', { name: 'Retry German translation' })).toHaveCount(1)
  await expect(block.getByRole('button', { name: 'Retry Russian translation' })).toHaveCount(1)
  await expect(retryButton(block, 'de')).toBeEnabled()

  // Existing text that a failed save flagged: no action, and a line saying it is kept.
  await expect(previewRow(block, 'ur')).toContainText('Existing')
  await expect(previewRow(block, 'ur')).toContainText('This translation is kept as it is and is not retried automatically.')
  await expect(previewRow(block, 'ur').locator('button')).toHaveCount(0)
  // Healthy Manual and Current rows carry neither a button nor a note.
  for (const lang of ['tr', 'ar', 'en']) await expect(previewRow(block, lang).getByTestId('translation-retry-note')).toHaveCount(0)

  // The action sits inside the preview card.
  const panel = await block.getByTestId('translation-preview').boundingBox()
  const button = await retryButton(block, 'de').boundingBox()
  assert.ok(button.x >= panel.x && button.x + button.width <= panel.x + panel.width && button.y >= panel.y && button.y + button.height <= panel.y + panel.height)

  await noInternals(block)
  await page.screenshot({ path: join(shots, 'retry-available-en.png'), fullPage: false })
  // Looking is not writing.
  assert.deepEqual(requests(calls), ['GET /page-content/home/admin'])
})

test('Existing hero translations and healthy Built-in fields offer no Retry — the production homepage has none at all', async (t) => {
  const backend = makeBackend(productionHome(), { services: true, projects: false })
  const before = structuredClone(backend.state.doc)
  const { page, calls } = await open(t, backend)

  // Every section open, every preview open: 47 fields, six languages each.
  const closed = page.getByRole('button', { name: pc('en').edit, exact: true })
  while (await closed.count()) await closed.first().click()
  await expect(page.getByTestId('translation-status')).toHaveCount(47)
  const show = page.getByRole('button', { name: pc('en').translationsShow })
  while (await show.count()) await show.first().click()
  await expect(page.getByTestId('translation-preview')).toHaveCount(47)
  await expect(page.getByTestId('translation-preview-row')).toHaveCount(47 * 6)

  await expect(page.getByTestId('translation-retry')).toHaveCount(0)
  await expect(page.getByTestId('translation-retry-note')).toHaveCount(0)
  await expect(page.getByTestId('translation-preview').locator('button')).toHaveCount(0)

  // The two hero fields: Existing in five languages, with the hand-written text on show.
  for (const [index, key] of [[0, 'heroLabel'], [4, 'heroCtaPrimary']]) {
    assert.deepEqual(await chipsOf(statusOf(page, index)), ['en:source', 'tr:existing', 'ar:existing', 'de:existing', 'ru:existing', 'ur:existing'])
    for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) await expect(previewRow(statusOf(page, index), lang)).toContainText(HERO[key][lang])
  }
  // A Built-in field.
  assert.deepEqual(await chipsOf(statusOf(page, 1)), ['en:source', 'tr:builtin', 'ar:builtin', 'de:builtin', 'ru:builtin', 'ur:builtin'])

  assert.deepEqual(requests(calls), ['GET /page-content/home/admin'])
  assert.deepEqual(backend.state.doc, before)
  assert.equal(backend.state.providerCalls.length, 0)
})

test('even a hand-made request for an Existing translation is refused by the service, and nothing changes', async () => {
  // What the interface never sends, sent anyway.
  const backend = makeBackend(productionHome())
  const before = structuredClone(backend.state.doc)
  for (const key of ['heroLabel', 'heroCtaPrimary']) {
    for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) {
      const { status, body } = await backend.retry(key, lang)
      assert.equal(status, 409)
      assert.equal(body.reason, 'legacy_translation')
    }
  }
  assert.deepEqual(backend.state.doc, before)
  assert.equal(backend.state.providerCalls.length, 0)
  assert.equal(backend.state.updates, 0)
})

/* ══════════════ 2. A retry that succeeds ══════════════ */

test('Stale → Retry → Current: one request, a confirmation, and the row updates without a reload', async (t) => {
  const backend = makeBackend(trackedHome())
  const others = structuredClone(backend.state.doc)
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  await expect(summary(page)).toHaveAttribute('data-attention', 'true')
  await expect(page.getByTestId('translation-summary-message')).toHaveText('Translations that need attention: 3')
  await expect(previewRow(block, 'de')).toContainText('Leistungen entdecken')

  await retryButton(block, 'de').click()

  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:current', 'ru:outdated', 'ur:existing'])
  // The preview stayed open and now shows the new text and its new status.
  await expect(previewRow(block, 'de')).toContainText('Current')
  await expect(previewRow(block, 'de')).toContainText('Entdecken Sie unsere Leistungen')
  await expect(previewRow(block, 'de')).not.toContainText('Leistungen entdecken')
  await expect(previewRow(block, 'de')).toContainText('Translated automatically from the current source text.')
  await expect(retryButton(block, 'de')).toHaveCount(0)
  await expect(retryButton(block, 'ru')).toBeEnabled()
  await expect(page.getByTestId('translation-summary-message')).toHaveText('Translations that need attention: 2')

  // One POST with no body, then one read. No save.
  assert.deepEqual(requests(calls), ['GET /page-content/home/admin', retryUrl('heroCtaPrimary', 'de'), 'GET /page-content/home/admin'])
  assert.equal(posts(calls)[0].body, null, 'the request carries no text')
  assert.deepEqual(backend.state.providerCalls, ['en|de'], 'one translation, of one language, from the stored source language')

  // Only German moved in what is stored.
  const now = backend.state.doc
  const field = now.fields.heroCtaPrimary
  assert.equal(field.de, 'Entdecken Sie unsere Leistungen')
  assert.deepEqual(Object.keys(field.meta.langs.de).sort(), ['at', 'by', 'from'])
  assert.equal(field.meta.langs.de.from, sourceHash(EDITED))
  const restored = structuredClone(now)
  restored.fields.heroCtaPrimary.de = others.fields.heroCtaPrimary.de
  restored.fields.heroCtaPrimary.meta.langs.de = others.fields.heroCtaPrimary.meta.langs.de
  assert.deepEqual(restored, others)

  await noInternals(page.locator('body'))
  await page.screenshot({ path: join(shots, 'retry-success-en.png'), fullPage: false })
})

test('Needs attention → Retry → Current: a language with nothing stored gets its translation', async (t) => {
  const backend = makeBackend(trackedHome())
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  await expect(previewRow(block, 'ru')).toContainText('Needs attention')
  await expect(previewRow(block, 'ru')).toContainText(catalogueText('home', 'heroCtaPrimary', 'ru'))
  assert.equal('ru' in backend.state.doc.fields.heroCtaPrimary, false)

  await retryButton(block, 'ru').click()

  await expect(toast(page, 'Russian translation updated.')).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:stale', 'ru:current', 'ur:existing'])
  await expect(previewRow(block, 'ru')).toContainText('Откройте наши услуги')
  await expect(previewRow(block, 'ru')).toContainText('Visitors see: Stored translation.')
  await expect(retryButton(block, 'ru')).toHaveCount(0)
  assert.deepEqual(requests(calls), ['GET /page-content/home/admin', retryUrl('heroCtaPrimary', 'ru'), 'GET /page-content/home/admin'])
  assert.equal(backend.state.doc.fields.heroCtaPrimary.ru, 'Откройте наши услуги')
  assert.equal(backend.state.doc.fields.heroCtaPrimary.de, 'Leistungen entdecken', 'German was not part of it')
})

test('Missing → Retry → Current', async (t) => {
  // Every registered field has built-in text, so "Missing" cannot arise on the
  // real site today. In THIS browser only, the secondary button's built-in
  // text is taken away, which is what makes its languages Missing.
  let patched = false
  const patchModule = {
    match: /\/src\/lib\/pageContentCatalogue\.js$/,
    transform: (code) => {
      assert.ok(code.includes('export const catalogueText = '), 'the catalogue module changed shape')
      patched = true
      return `${code.replace('export const catalogueText = ', 'const builtInText = ')}
export const catalogueText = (pageKey, fieldKey, language) => (fieldKey === 'heroCtaSecondary' ? '' : builtInText(pageKey, fieldKey, language))\n`
    },
  }
  const fields = productionHome()
  fields.heroCtaSecondary = tracked('See What We Build', {}, { de: { error: 'timeout', errorAt: at } })
  const backend = makeBackend(fields)
  const { page, calls } = await open(t, backend, { patchModule })
  assert.equal(patched, true)

  const block = statusOf(page, 5)
  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:missing', 'ar:missing', 'de:missing', 'ru:missing', 'ur:missing'])
  await openPreview(block)
  await expect(previewRow(block, 'de')).toContainText('Missing')
  await expect(previewRow(block, 'de')).toContainText('No translation is available, so visitors see the source text.')
  for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) await expect(retryButton(block, lang)).toBeVisible()
  await expect(block.getByRole('button', { name: 'Retry German translation' })).toHaveCount(1)

  backend.state.answers.de = 'Sehen Sie, was wir bauen'
  await retryButton(block, 'de').click()

  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:missing', 'ar:missing', 'de:current', 'ru:missing', 'ur:missing'])
  await expect(previewRow(block, 'de')).toContainText('Sehen Sie, was wir bauen')
  await expect(retryButton(block, 'de')).toHaveCount(0)
  assert.equal(posts(calls).length, 1)
  assert.deepEqual(Object.keys(backend.state.doc.fields.heroCtaSecondary.meta.langs.de).sort(), ['at', 'by', 'from'])
  for (const lang of ['tr', 'ar', 'ru', 'ur']) assert.equal(lang in backend.state.doc.fields.heroCtaSecondary, false, lang)
})

/* ══════════════ 3. A retry that does not produce a translation ══════════════ */

test('Stale → provider failure: a warning, the old text stays, and it can be retried again', async (t) => {
  const backend = makeBackend(trackedHome())
  backend.state.provider.de = 'fail'
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  await expect(previewRow(block, 'de')).not.toContainText('The last automatic translation attempt failed.')

  await retryButton(block, 'de').click()

  await expect(toast(page, 'German translation failed. What visitors see has not changed.')).toBeVisible()
  // Still Stale, still the old text — now with the failure written beside it.
  await expect(previewRow(block, 'de')).toContainText('The last automatic translation attempt failed.')
  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:current', 'ar:manual', 'de:stale', 'ru:outdated', 'ur:existing'])
  await expect(previewRow(block, 'de')).toContainText('Stale')
  await expect(previewRow(block, 'de')).toContainText('Leistungen entdecken')
  await expect(retryButton(block, 'de')).toBeEnabled()
  await expect(retryButton(block, 'de')).toHaveText('Retry translation')
  await expect(toast(page, 'German translation updated.')).toHaveCount(0)
  await expect(page.getByTestId('translation-summary-message')).toHaveText('Translations that need attention: 3')

  assert.deepEqual(requests(calls), ['GET /page-content/home/admin', retryUrl('heroCtaPrimary', 'de'), 'GET /page-content/home/admin'])
  const entry = backend.state.doc.fields.heroCtaPrimary.meta.langs.de
  assert.equal(backend.state.doc.fields.heroCtaPrimary.de, 'Leistungen entdecken')
  assert.equal(entry.from, sourceHash(OLDER))
  assert.equal(entry.at, '2026-10-01T09:00:00.000Z')
  assert.equal(entry.error, 'provider_error')
  await noInternals(page.locator('body'))
  await page.screenshot({ path: join(shots, 'retry-failed-en.png'), fullPage: false })

  // The provider recovers; the same button now works.
  backend.state.provider.de = 'ok'
  await retryButton(block, 'de').click()
  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:current', 'ru:outdated', 'ur:existing'])
  await expect(previewRow(block, 'de')).not.toContainText('The last automatic translation attempt failed.')
})

test('Needs attention → provider at its limit: the row keeps its state and says why', async (t) => {
  const backend = makeBackend(trackedHome())
  backend.state.provider.ru = 'quota'
  const { page } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)

  await retryButton(block, 'ru').click()

  await expect(toast(page, 'Russian translation failed. What visitors see has not changed.')).toBeVisible()
  await expect(previewRow(block, 'ru')).toContainText('Automatic translation is temporarily unavailable.')
  await expect(previewRow(block, 'ru')).toContainText('Needs attention')
  await expect(retryButton(block, 'ru')).toBeEnabled()
  assert.equal('ru' in backend.state.doc.fields.heroCtaPrimary, false, 'no empty value was stored')
  // The provider's own warning text is nowhere on the page.
  assert.doesNotMatch(await page.locator('body').innerText(), /MYMEMORY/i)
})

/* ══════════════ 4. While a retry is in flight ══════════════ */

test('a second click cannot start a second request, and only the clicked action is disabled', async (t) => {
  const backend = makeBackend(trackedHome())
  const hold = deferred()
  const { page, calls } = await open(t, backend, { gate: hold.promise })
  const block = statusOf(page, 4)
  await openPreview(block)

  // Two clicks in the same instant — before React has rendered the disabled state.
  await retryButton(block, 'de').evaluate((button) => { button.click(); button.click() })

  await expect(retryButton(block, 'de')).toBeDisabled()
  await expect(retryButton(block, 'de')).toHaveText('Retrying…')
  await expect(retryButton(block, 'de')).toHaveAttribute('aria-busy', 'true')
  // More clicks while it waits.
  await retryButton(block, 'de').evaluate((button) => { button.click(); button.click(); button.click() })
  await retryButton(block, 'de').click({ force: true })

  // Every other action is untouched.
  await expect(retryButton(block, 'ru')).toBeEnabled()
  await expect(retryButton(block, 'ru')).toHaveText('Retry translation')
  await expect(block.getByRole('button', { name: pc('en').translationsHide })).toBeEnabled()
  await expect(page.locator('textarea').nth(4)).toBeEditable()
  await page.screenshot({ path: join(shots, 'retry-in-flight-en.png'), fullPage: false })

  assert.equal(posts(calls).length, 1, 'exactly one retry request')
  // Nothing has been announced or re-read yet.
  await expect(page.locator('.Toastify__toast')).toHaveCount(0)
  assert.deepEqual(requests(calls), ['GET /page-content/home/admin', retryUrl('heroCtaPrimary', 'de')])

  hold.release()
  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:current', 'ru:outdated', 'ur:existing'])
  assert.equal(posts(calls).length, 1)
  assert.deepEqual(backend.state.providerCalls, ['en|de'])
  assert.equal(backend.state.updates, 1)
})

test('two different languages can be retried side by side, each with its own request', async (t) => {
  const backend = makeBackend(trackedHome())
  const hold = deferred()
  const { page, calls } = await open(t, backend, { gate: hold.promise })
  const block = statusOf(page, 4)
  await openPreview(block)

  await retryButton(block, 'de').click()
  await retryButton(block, 'ru').click()
  await expect(retryButton(block, 'de')).toBeDisabled()
  await expect(retryButton(block, 'ru')).toBeDisabled()
  assert.deepEqual(posts(calls).map((c) => `${c.method} ${c.path}`), [retryUrl('heroCtaPrimary', 'de'), retryUrl('heroCtaPrimary', 'ru')])

  hold.release()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:current', 'ru:current', 'ur:existing'])
  await expect(block.getByTestId('translation-retry')).toHaveCount(0)
  assert.equal(posts(calls).length, 2)
  assert.deepEqual([...backend.state.providerCalls].sort(), ['en|de', 'en|ru'])
})

test('keyboard: Retry is reached and pressed without a mouse, and focus is not lost when the button goes', async (t) => {
  const backend = makeBackend(trackedHome())
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)

  const disclosure = block.getByRole('button', { name: pc('en').translationsShow })
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(block.getByTestId('translation-preview')).toBeVisible()
  // The next stop after the disclosure is the first Retry in the panel.
  await page.keyboard.press('Tab')
  await expect(retryButton(block, 'de')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(retryButton(block, 'ru')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(retryButton(block, 'de')).toBeFocused()

  await page.keyboard.press('Enter')

  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect(retryButton(block, 'de')).toHaveCount(0)
  assert.equal(posts(calls).length, 1)
  // The button is gone; focus rests on the row it belonged to, not at the top of the page.
  await expect(previewRow(block, 'de')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(retryButton(block, 'ru')).toBeFocused()
})

/* ══════════════ 5. Refusals and conflicts ══════════════ */

test('THE RACE, end to end: the source is saved again while the retry is translating — nothing is written and the admin is told', async (t) => {
  const backend = makeBackend(trackedHome())
  const NEWER = 'See What We Build'
  // Another admin's save lands while the provider is being asked — after the
  // service has read the old source, before it writes.
  backend.state.duringTranslation = () => {
    backend.state.duringTranslation = null
    backend.state.doc.fields.heroCtaPrimary = tracked(NEWER, { tr: 'Ne İnşa Ettiğimizi Görün', de: 'Leistungen entdecken' }, { tr: current(NEWER), de: { from: sourceHash(OLDER), by: 'machine', at } })
  }
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  await expect(previewRow(block, 'en')).toContainText(EDITED)

  await retryButton(block, 'de').click()

  await expect(toast(page, 'The source text changed while the translation was being retried. Please try again.')).toBeVisible()
  await expect(toast(page, 'German translation updated.')).toHaveCount(0)
  // The service translated the OLD wording and then refused to store it.
  assert.deepEqual(backend.state.providerCalls, ['en|de'])
  assert.equal(backend.state.updates, 0, 'nothing was written')
  assert.equal(backend.state.doc.fields.heroCtaPrimary.en, NEWER)
  assert.equal(backend.state.doc.fields.heroCtaPrimary.de, 'Leistungen entdecken')
  assert.equal(JSON.stringify(backend.state.doc).includes('Entdecken Sie unsere Leistungen'), false, 'the translation of the old source is nowhere')

  // Refreshed: the preview shows the newer source; German is still stale and still retryable.
  await expect(previewRow(block, 'en')).toContainText(NEWER)
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:outdated', 'de:stale', 'ru:outdated', 'ur:outdated'])
  await expect(retryButton(block, 'de')).toBeEnabled()
  assert.deepEqual(requests(calls), ['GET /page-content/home/admin', retryUrl('heroCtaPrimary', 'de'), 'GET /page-content/home/admin'])
  await noInternals(page.locator('body'))
  await page.screenshot({ path: join(shots, 'retry-conflict-en.png'), fullPage: false })

  // "Please try again" works: the second attempt translates the NEW source.
  backend.state.answers.de = 'Sehen Sie, was wir bauen'
  await retryButton(block, 'de').click()
  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect(previewRow(block, 'de')).toContainText('Sehen Sie, was wir bauen')
  assert.equal(backend.state.doc.fields.heroCtaPrimary.meta.langs.de.from, sourceHash(NEWER))
})

test('already translated by someone else: the service refuses, the editor says so calmly and shows the current state', async (t) => {
  const backend = makeBackend(trackedHome())
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  // Another editor's retry lands after this page was loaded.
  await backend.retry('heroCtaPrimary', 'de')
  assert.equal(backend.state.updates, 1)

  await retryButton(block, 'de').click()

  await expect(toast(page, 'This translation is already up to date.')).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:current', 'ru:outdated', 'ur:existing'])
  await expect(retryButton(block, 'de')).toHaveCount(0)
  assert.equal(backend.state.updates, 1, 'the refused request wrote nothing')
  assert.deepEqual(backend.state.providerCalls, ['en|de'], 'and asked for no second translation')
  assert.equal(posts(calls).length, 1)
})

test('a translation that became protected is refused: a plain message, the stored text untouched', async (t) => {
  const backend = makeBackend(trackedHome())
  const { page } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  // After this page loaded, the German entry lost its provenance (as text from before tracking has none).
  delete backend.state.doc.fields.heroCtaPrimary.meta.langs.de
  const before = structuredClone(backend.state.doc)

  await retryButton(block, 'de').click()

  await expect(toast(page, "This translation can't be retried automatically.")).toBeVisible()
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:existing', 'ru:outdated', 'ur:existing'])
  await expect(retryButton(block, 'de')).toHaveCount(0)
  await expect(previewRow(block, 'de')).toContainText('Leistungen entdecken')
  assert.deepEqual(backend.state.doc, before)
  assert.equal(backend.state.providerCalls.length, 0)
  // The server's English wording and reason code are not what the admin reads.
  assert.doesNotMatch(await page.locator('.Toastify').innerText(), /predates|legacy/i)
})

test('the request cannot be made at all: an error message, the row as it was, and Retry available again', async (t) => {
  const backend = makeBackend(trackedHome())
  let mode = 'abort'
  const { page, calls } = await open(t, backend, {
    retryReply: () => (mode === 'abort' ? 'abort' : mode === 'server' ? { status: 500, body: { success: false, message: 'E11000 internal detail' } } : { status: 403, body: { success: false, message: 'Forbidden' } }),
  })
  const block = statusOf(page, 4)
  await openPreview(block)

  for (const next of ['abort', 'server', 'forbidden']) {
    mode = next
    await retryButton(block, 'de').click()
    await expect(toast(page, 'The translation could not be retried. Please try again.')).toHaveCount(1)
    await expect(retryButton(block, 'de')).toBeEnabled()
    await expect(retryButton(block, 'de')).toHaveText('Retry translation')
    assert.doesNotMatch(await page.locator('.Toastify').innerText(), /E11000|Forbidden/)
    await toastsGone(page)
  }
  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:current', 'ar:manual', 'de:stale', 'ru:outdated', 'ur:existing'])
  assert.equal(posts(calls).length, 3)
  assert.equal(backend.state.updates, 0)
})

/* ══════════════ 6. Retry and the form ══════════════ */

test('an unsaved edit to the field: Retry gives way to "save first", and comes back when the edit is undone', async (t) => {
  const backend = makeBackend(trackedHome())
  const { page, calls } = await open(t, backend)
  const block = statusOf(page, 4)
  await openPreview(block)
  await expect(block.getByTestId('translation-retry')).toHaveCount(2)

  await page.locator('textarea').nth(4).fill('Something Being Typed')
  await expect(block.getByTestId('translation-retry')).toHaveCount(0)
  await expect(previewRow(block, 'de')).toContainText('Save your changes to this text first, then retry.')
  await expect(previewRow(block, 'ru')).toContainText('Save your changes to this text first, then retry.')
  // The preview still shows what is stored, not what is being typed.
  await expect(previewRow(block, 'en')).toContainText(EDITED)

  await page.locator('textarea').nth(4).fill(EDITED)
  await expect(block.getByTestId('translation-retry')).toHaveCount(2)
  await expect(previewRow(block, 'de')).not.toContainText('Save your changes to this text first, then retry.')
  assert.deepEqual(requests(calls), ['GET /page-content/home/admin'])
})

test('Save waits while a retry is in flight, a retry never sends the form, and typed edits survive the refresh', async (t) => {
  const backend = makeBackend(trackedHome())
  const hold = deferred()
  const { page, calls } = await open(t, backend, { gate: hold.promise })
  const block = statusOf(page, 4)
  await openPreview(block)

  // An edit to a DIFFERENT field is pending.
  await page.locator('textarea').nth(5).fill('A Pending Edit')
  const save = page.getByRole('button', { name: pc('en').saveChanges, exact: true })
  await expect(save).toBeEnabled()

  await retryButton(block, 'de').click()
  await expect(retryButton(block, 'de')).toHaveText('Retrying…')
  await expect(save).toBeDisabled()

  hold.release()
  await expect(toast(page, 'German translation updated.')).toBeVisible()
  await expect(save).toBeEnabled()
  // The pending edit is still in its box, still unsaved.
  await expect(page.locator('textarea').nth(5)).toHaveValue('A Pending Edit')
  await expect(page.locator('textarea').nth(4)).toHaveValue(EDITED)

  assert.equal(calls.some((c) => c.method === 'PUT'), false, 'the retry did not save the form')
  assert.equal(posts(calls)[0].body, null)
  assert.equal(JSON.stringify(backend.state.doc).includes('A Pending Edit'), false)
})

test('no retry can start while a save is in flight', async (t) => {
  const backend = makeBackend(trackedHome())
  const hold = deferred()
  const { page, calls } = await open(t, backend, { saveGate: hold.promise })
  const block = statusOf(page, 4)
  await openPreview(block)

  await page.locator('textarea').nth(5).fill('A Pending Edit')
  await page.getByRole('button', { name: pc('en').saveChanges, exact: true }).click()
  await expect(page.getByRole('button', { name: pc('en').saving, exact: true })).toBeDisabled()

  // Both actions are locked — but they are not "retrying", and say so.
  for (const lang of ['de', 'ru']) {
    await expect(retryButton(block, lang)).toBeDisabled()
    await expect(retryButton(block, lang)).toHaveText('Retry translation')
  }
  await retryButton(block, 'de').evaluate((button) => button.click())
  await retryButton(block, 'de').click({ force: true })
  assert.equal(posts(calls).length, 0)

  hold.release()
  await expect(retryButton(block, 'de')).toBeEnabled()
  await expect(retryButton(block, 'ru')).toBeEnabled()
  assert.equal(posts(calls).length, 0)
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 1)
})

/* ══════════════ 7. Six languages, both directions ══════════════ */

for (const language of LANGS) {
  test(`${language.toUpperCase()}: the action, its busy state and each outcome are in the admin's language (${direction(language)})`, async (t) => {
    const backend = makeBackend(trackedHome())
    backend.state.provider.ru = 'fail'
    const hold = deferred()
    const { page, calls, options } = await open(t, backend, { language, gate: hold.promise })
    const m = pc(language)
    assert.equal(await page.evaluate(() => document.documentElement.dir || 'ltr'), direction(language))

    const block = statusOf(page, 4)
    await openPreview(block, language)
    const german = retryButton(block, 'de')
    await expect(german).toHaveText(m.retryAction)
    assert.equal(await german.getAttribute('aria-label'), named(m.retryLanguage, 'de', language))
    await expect(block.getByRole('button', { name: named(m.retryLanguage, 'de', language), exact: true })).toHaveCount(1)
    await expect(block.getByRole('button', { name: named(m.retryLanguage, 'ru', language), exact: true })).toHaveCount(1)
    await expect(previewRow(block, 'ur')).toContainText(m.retryProtected)

    // The action stays inside the preview card, on the reading side, without overflow.
    const panel = await block.getByTestId('translation-preview').boundingBox()
    const box = await german.boundingBox()
    assert.ok(box.x >= panel.x && box.x + box.width <= panel.x + panel.width, 'the button is inside the card')
    const centre = box.x + box.width / 2
    const middle = panel.x + panel.width / 2
    assert.ok(direction(language) === 'rtl' ? centre > middle : centre < middle, 'the button sits at the start of the row')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow')

    // Busy.
    await german.click()
    await expect(german).toBeDisabled()
    await expect(german).toHaveText(m.retrying)
    if (['en', 'ar'].includes(language)) await page.screenshot({ path: join(shots, `retry-in-flight-${language}.png`), fullPage: false })

    // Success.
    hold.release()
    options.gate = null
    await expect(toast(page, named(m.retrySucceeded, 'de', language))).toBeVisible()
    await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:manual', 'de:current', 'ru:outdated', 'ur:existing'])
    await expect(previewRow(block, 'de')).toContainText(m.statusCurrent)
    await expect(previewRow(block, 'de')).toContainText('Entdecken Sie unsere Leistungen')

    // Provider failure.
    await retryButton(block, 'ru').click()
    await expect(toast(page, named(m.retryFailed, 'ru', language))).toBeVisible()
    await expect(previewRow(block, 'ru')).toContainText(m.failureFailed)
    await expect(retryButton(block, 'ru')).toHaveText(m.retryAction)

    // Source-changed conflict.
    options.retryReply = () => ({ status: 409, body: { success: false, reason: 'source_changed', message: 'The source text changed while the translation was being retried. Please try again.' } })
    await retryButton(block, 'ru').click()
    await expect(toast(page, m.retrySourceChanged)).toBeVisible()

    // Refusal, and a request that could not be made.
    options.retryReply = () => ({ status: 409, body: { success: false, reason: 'legacy_translation', message: 'This existing translation predates translation tracking and cannot be retried automatically.' } })
    await retryButton(block, 'ru').click()
    await expect(toast(page, m.retryUnavailable)).toBeVisible()
    options.retryReply = () => 'abort'
    await retryButton(block, 'ru').click()
    await expect(toast(page, m.retryError)).toBeVisible()

    // Save-first note.
    await page.locator('textarea').nth(4).fill('Something Being Typed')
    await expect(previewRow(block, 'ru')).toContainText(m.retrySaveFirst)

    if (language !== 'en') {
      // Nothing was left in English.
      const text = await page.locator('.Toastify').innerText() + await block.getByTestId('translation-preview').innerText()
      for (const english of ['Retry translation', 'Retrying', 'translation updated', 'translation failed', 'Please try again', "can't be retried", 'kept as it is', 'Save your changes']) {
        assert.equal(text.includes(english), false, `"${english}" is shown in ${language}`)
      }
    }
    await noInternals(page.locator('body'))
    assert.equal(calls.some((c) => c.method === 'PUT'), false)
    if (['ar', 'ur', 'de'].includes(language)) await page.screenshot({ path: join(shots, `retry-outcomes-${language}.png`), fullPage: false })
  })
}
