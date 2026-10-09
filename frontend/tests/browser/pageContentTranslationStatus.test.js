// CMS Phase C1 — translation status and read-only preview in the Page Content editor.
//
// The real editor in a real browser. Every API call is answered here: no
// backend runs, nothing reaches MongoDB, and no translation is requested. The
// fixtures' `translationStates` are produced by the backend's own
// translationStatesOf, so the editor is shown exactly what the API would send.
// Run from frontend/:
//   node --test tests/browser/pageContentTranslationStatus.test.js
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
import { sourceHash, translationStatesOf } from '../../../backend/utils/translationState.js'

let server
let browser
let base
const FIXTURE = '/__page_content_translation_status.html'
const shots = join(tmpdir(), 'varlikent-cms-c1')
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

before(async () => {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'page-content-translation-status-harness',
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

after(async () => { await browser?.close(); await server?.close() })

/* ══════════════ fixtures ══════════════ */

const OWNER = { _id: 'owner1', role: 'owner', name: 'Test Owner', permissions: [] }
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const TARGETS = ['tr', 'ar', 'de', 'ru', 'ur']
const pc = (lang) => translations[lang].adminPages.pageContent
const direction = (lang) => (['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr')
const HOME_TEXT = allFieldDefs('home').filter((def) => def.type !== 'image')
const INTERNAL = [/[0-9a-f]{64}/, /sourceHash/, /\bmeta\b/, /"from"/, /SHA-256/i, /provider_error/, /too_long/, /\[object Object\]/]

// What the editors' read returns for a set of stored fields.
const adminResponse = (fields, sections = {}) => ({
  success: true,
  fields,
  sections,
  translationStates: Object.fromEntries(Object.entries(fields).filter(([, f]) => f.type === 'text').map(([key, f]) => [key, translationStatesOf(f)])),
})

// The homepage as production holds it today: every text field is its English
// default with no other language stored and no metadata — except the two hero
// fields an admin edited, which carry five hand-written translations each.
const HERO = {
  heroLabel: { en: 'Istanbul · Architecture · Construction · Real Estate', tr: 'İstanbul · Mimarlık · İnşaat · Gayrimenkul', ar: 'إسطنبول · معمار · إنشاء · عقارات', de: 'Istanbul · Architektur · Bau · Immobilien', ru: 'Стамбул · Архитектура · Строительство · Недвижимость', ur: 'استنبول · تعمیراتی ڈیزائن · تعمیرات · جائیداد' },
  heroCtaPrimary: { en: 'Explore Services', tr: 'Hizmetleri Keşfedin', ar: 'استكشف الخدمات', de: 'Leistungen entdecken', ru: 'Изучить услуги', ur: 'خدمات دیکھیں' },
}
const productionHome = () => {
  const fields = {}
  for (const def of HOME_TEXT) fields[def.key] = { type: 'text', sourceLang: 'en', en: def.default, verified: false }
  // Exactly as stored: this one ends with a newline.
  fields.heroHeading1.en = 'We Design, Build\n'
  for (const [key, values] of Object.entries(HERO)) fields[key] = { type: 'text', sourceLang: 'en', ...values, verified: false }
  fields.heroImage = { type: 'image', url: '/images/hero-villa.jpg.png' }
  return fields
}

const at = '2026-10-09T10:00:00.000Z'
const tracked = (source, slots, langs) => ({ type: 'text', sourceLang: 'en', en: source, ...slots, meta: { sourceHash: sourceHash(source), langs } })
const current = (source) => ({ from: sourceHash(source), by: 'machine', at })

/*
 * Opens the editor on the homepage.
 *   admin      what GET /page-content/home/admin answers: a body, { status },
 *              or a function called per request
 *   publicGet  what the public GET answers
 *   saveReply  what PUT answers
 */
async function open(t, { language = 'en', admin, publicGet, saveReply } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  const calls = []

  await page.addInitScript(({ language, owner }) => {
    localStorage.setItem('vk_lang', language)
    localStorage.setItem('vk_lang_explicit', '1')
    localStorage.setItem('varlikent_token', 'isolated-test-token')
    localStorage.setItem('varlikent_user', JSON.stringify(owner))
  }, { language, owner: OWNER })

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort()
    const path = url.pathname.replace(/^.*?\/api(?=\/)/, '')
    const method = request.method()
    calls.push({ method, path, body: method === 'PUT' ? request.postDataJSON() : undefined })
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const answer = (reply) => {
      const value = typeof reply === 'function' ? reply() : reply
      return value?.status ? json(value.status, value.body || { success: false }) : json(200, value)
    }

    if (path === '/auth/me') return json(200, { success: true, user: OWNER })
    if (path === '/page-content/home/admin') return answer(admin)
    if (path === '/page-content/home' && method === 'PUT') return answer(saveReply)
    if (path === '/page-content/home') return answer(publicGet || { success: true, fields: {}, sections: {} })
    return json(200, { success: true, fields: {}, sections: {} })
  })

  await page.goto(`${base}${FIXTURE}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await expect(page.getByRole('heading', { level: 1, name: pc(language).title })).toBeVisible({ timeout: 120000 })
  await expect(page.locator('textarea').first()).toBeVisible()
  return { page, calls }
}

// The status block under the nth text field of the (open) hero card, in registry order:
// 0 heroLabel, 1 heroHeading1, 2 heroHeading2, 3 heroHeading3, 4 heroCtaPrimary, 5 heroCtaSecondary.
const statusOf = (page, index) => page.getByTestId('translation-status').nth(index)
const chipsOf = async (block) => block.getByTestId('translation-chip').evaluateAll((els) => els.map((el) => `${el.dataset.lang}:${el.dataset.status}`))
const chipTexts = async (block) => block.getByTestId('translation-chip').evaluateAll((els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()))
const summary = (page) => page.getByTestId('translation-summary')
const summaryCounts = async (page) => Object.fromEntries(await page.getByTestId('translation-summary-count').evaluateAll((els) => els.map((el) => [el.dataset.status, Number(el.innerText.match(/\d+/)[0])])))
const toggle = (block, lang = 'en') => block.getByRole('button', { name: pc(lang).translationsShow })
const previewRow = (block, lang) => block.locator(`[data-testid="translation-preview-row"][data-lang="${lang}"]`)
const noInternals = async (locator) => {
  const text = await locator.innerText()
  for (const pattern of INTERNAL) assert.doesNotMatch(text, pattern)
}

/* ══════════════ 1. The production homepage looks calm ══════════════ */

test('production-like homepage: default fields are Built-in, the hero translations are Existing, and nothing warns', async (t) => {
  const { page, calls } = await open(t, { admin: adminResponse(productionHome(), { services: true, projects: false }) })

  // The page-level line is neutral and says so.
  await expect(summary(page)).toHaveAttribute('data-attention', 'false')
  await expect(page.getByTestId('translation-summary-message')).toHaveText('No translations need attention.')
  // 47 text fields × 5 languages: 45 fields rely on the catalogue, 2 carry stored translations.
  assert.deepEqual(await summaryCounts(page), { builtin: 225, existing: 10 })
  await page.screenshot({ path: join(shots, 'production-like-en.png'), fullPage: false })

  // An ordinary cleaned field — including the one stored with a trailing newline.
  for (const index of [1, 2, 3, 5]) {
    assert.deepEqual(await chipsOf(statusOf(page, index)), ['en:source', 'tr:builtin', 'ar:builtin', 'de:builtin', 'ru:builtin', 'ur:builtin'])
  }
  assert.deepEqual(await chipTexts(statusOf(page, 1)), ['EN Source', 'TR Built-in', 'AR Built-in', 'DE Built-in', 'RU Built-in', 'UR Built-in'])
  // The two fields with hand-written translations from before tracking.
  for (const index of [0, 4]) {
    assert.deepEqual(await chipsOf(statusOf(page, index)), ['en:source', 'tr:existing', 'ar:existing', 'de:existing', 'ru:existing', 'ur:existing'])
  }
  assert.deepEqual(await chipTexts(statusOf(page, 0)), ['EN Source', 'TR Existing', 'AR Existing', 'DE Existing', 'RU Existing', 'UR Existing'])

  // No attention state anywhere on the page, in any section.
  // Open every section: an opened card's button stops being "Edit", so take the first each time.
  const closed = page.getByRole('button', { name: pc('en').edit, exact: true })
  while (await closed.count()) await closed.first().click()
  await expect(page.getByTestId('translation-status')).toHaveCount(47)
  for (const status of ['stale', 'outdated', 'missing', 'current', 'manual']) {
    await expect(page.locator(`[data-testid="translation-chip"][data-status="${status}"]`)).toHaveCount(0)
  }
  await expect(page.locator('[data-testid="translation-chip"].bg-amber-50')).toHaveCount(0)
  await expect(page.getByTestId('translation-status-unavailable')).toHaveCount(0)
  await noInternals(page.locator('body'))

  // Loading the page read once and wrote nothing.
  assert.deepEqual(calls.filter((c) => c.path.startsWith('/page-content')).map((c) => `${c.method} ${c.path}`), ['GET /page-content/home/admin'])
})

/* ══════════════ 2. The read-only preview ══════════════ */

test('preview: opens from the keyboard, shows what visitors of each language see and where it comes from, and contains nothing editable', async (t) => {
  const { page } = await open(t, { admin: adminResponse(productionHome()) })

  // heroLabel — stored translations from before tracking.
  const hero = statusOf(page, 0)
  const button = toggle(hero)
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(hero.getByTestId('translation-preview')).toHaveCount(0)
  await button.focus()
  await page.keyboard.press('Enter')
  const panel = hero.getByTestId('translation-preview')
  await expect(panel).toBeVisible()
  const opened = hero.getByRole('button', { name: pc('en').translationsHide })
  await expect(opened).toHaveAttribute('aria-expanded', 'true')
  assert.equal(await opened.getAttribute('aria-controls'), await panel.getAttribute('id'))

  await expect(panel).toContainText('Source language: English')
  await expect(previewRow(hero, 'en')).toContainText('English')
  await expect(previewRow(hero, 'en')).toContainText(HERO.heroLabel.en)
  await expect(previewRow(hero, 'de')).toContainText('German')
  await expect(previewRow(hero, 'de')).toContainText('Existing')
  await expect(previewRow(hero, 'de')).toContainText(HERO.heroLabel.de)
  await expect(previewRow(hero, 'de')).toContainText('Visitors see: Stored translation.')
  await expect(previewRow(hero, 'de')).toContainText('This translation predates translation tracking, so its source version is unknown.')
  // Each text is set in its own language's direction.
  assert.equal(await previewRow(hero, 'ar').locator('p[lang="ar"]').getAttribute('dir'), 'rtl')
  assert.equal(await previewRow(hero, 'ur').locator('p[lang="ur"]').getAttribute('dir'), 'rtl')
  assert.equal(await previewRow(hero, 'de').locator('p[lang="de"]').getAttribute('dir'), 'ltr')
  for (const lang of TARGETS) await expect(previewRow(hero, lang)).toContainText(HERO.heroLabel[lang])

  // Read-only: no field, no button, nothing to submit.
  await expect(panel.locator('input, textarea, select, button, [contenteditable="true"], a')).toHaveCount(0)
  await noInternals(panel)
  await page.screenshot({ path: join(shots, 'preview-existing-en.png'), fullPage: false })

  // Space closes it again.
  await opened.focus()
  await page.keyboard.press('Space')
  await expect(hero.getByTestId('translation-preview')).toHaveCount(0)

  // heroHeading1 — nothing stored but English: visitors get the catalogue.
  const heading = statusOf(page, 1)
  await toggle(heading).click()
  for (const lang of TARGETS) {
    await expect(previewRow(heading, lang)).toContainText(catalogueText('home', 'heroHeading1', lang))
    await expect(previewRow(heading, lang)).toContainText('Built-in')
  }
  await expect(previewRow(heading, 'de')).toContainText('Visitors see: Built-in translation.')
  await expect(previewRow(heading, 'de')).toContainText("This translation comes from the website's built-in language catalogue.")
  await expect(previewRow(heading, 'en')).toContainText('This is the text as it was written.')
})

/* ══════════════ 3. Tracked states ══════════════ */

const EDITED = 'Discover Our Services'
const OLDER = 'Explore Services'
const trackedHome = () => ({
  ...productionHome(),
  // Every tracked state on one field: current, manual, stale (with a failed
  // retry), nothing stored after an edit (with a failed attempt), and a legacy
  // value that survived a failed save.
  heroCtaPrimary: tracked(EDITED, { tr: 'Hizmetlerimizi Keşfedin', ar: 'اكتشف خدماتنا', de: 'Leistungen entdecken', ur: 'خدمات دیکھیں' }, {
    tr: current(EDITED),
    ar: { from: sourceHash(EDITED), by: 'manual', at },
    de: { from: sourceHash(OLDER), by: 'machine', at: '2026-10-01T09:00:00.000Z', error: 'timeout', errorAt: at },
    ru: { error: 'quota', errorAt: at },
    ur: { error: 'too_long', errorAt: at },
  }),
})

test('tracked field: Current, Manual, Stale, a fallback after an edit, and a failed legacy value are each named', async (t) => {
  const { page } = await open(t, { admin: adminResponse(trackedHome()) })
  const block = statusOf(page, 4)

  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:current', 'ar:manual', 'de:stale', 'ru:outdated', 'ur:existing'])
  assert.deepEqual(await chipTexts(block), ['EN Source', 'TR Current', 'AR Manual', '! DE Stale', '! RU Needs attention', '! UR Existing'])
  // Attention is carried by the mark and the words, not only by colour.
  for (const lang of ['de', 'ru', 'ur']) await expect(block.locator(`[data-testid="translation-chip"][data-lang="${lang}"]`)).toHaveClass(/bg-amber-50/)
  for (const lang of ['en', 'tr', 'ar']) await expect(block.locator(`[data-testid="translation-chip"][data-lang="${lang}"]`)).not.toHaveClass(/bg-amber-50/)

  await toggle(block).click()
  await expect(previewRow(block, 'tr')).toContainText('Hizmetlerimizi Keşfedin')
  await expect(previewRow(block, 'tr')).toContainText('Translated automatically from the current source text.')
  await expect(previewRow(block, 'ar')).toContainText('Written by hand for the current source text.')

  // Stale: the old text is what visitors see, and the failed retry is secondary.
  await expect(previewRow(block, 'de')).toContainText('Stale')
  await expect(previewRow(block, 'de')).toContainText('Leistungen entdecken')
  await expect(previewRow(block, 'de')).toContainText('The source text has changed since this translation was created.')
  await expect(previewRow(block, 'de')).toContainText('The last automatic translation attempt failed.')

  // Nothing stored and the source was edited: the built-in text of the OLD wording is shown.
  await expect(previewRow(block, 'ru')).toContainText('Needs attention')
  await expect(previewRow(block, 'ru')).toContainText(catalogueText('home', 'heroCtaPrimary', 'ru'))
  await expect(previewRow(block, 'ru')).toContainText('Visitors see: Built-in translation.')
  await expect(previewRow(block, 'ru')).toContainText('Visitors are currently seeing the built-in translation, which may not match the edited source text.')
  await expect(previewRow(block, 'ru')).toContainText('Automatic translation is temporarily unavailable.')

  // A legacy value that outlived a failed save: still "Existing", with the failure beside it.
  await expect(previewRow(block, 'ur')).toContainText('Existing')
  await expect(previewRow(block, 'ur')).toContainText('خدمات دیکھیں')
  await expect(previewRow(block, 'ur')).toContainText('This text is too long to translate automatically.')
  await noInternals(block)

  // The page-level line now asks for attention, and counts the three.
  await expect(summary(page)).toHaveAttribute('data-attention', 'true')
  await expect(page.getByTestId('translation-summary-message')).toHaveText('Translations that need attention: 3')
  assert.deepEqual(await summaryCounts(page), { current: 1, manual: 1, builtin: 225, existing: 6, stale: 1, outdated: 1 })
  await page.screenshot({ path: join(shots, 'tracked-attention-en.png'), fullPage: false })
})

test('an edited source with nothing stored: every language reads Needs attention, not healthy Built-in', async (t) => {
  const fields = productionHome()
  fields.heroHeading2 = { type: 'text', sourceLang: 'en', en: '& Deliver Remarkable', verified: false }
  const { page } = await open(t, { admin: adminResponse(fields) })
  const block = statusOf(page, 2)

  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:outdated', 'ar:outdated', 'de:outdated', 'ru:outdated', 'ur:outdated'])
  await toggle(block).click()
  await expect(previewRow(block, 'en')).toContainText('& Deliver Remarkable')
  // Visitors still read the catalogue translation of the original wording.
  await expect(previewRow(block, 'de')).toContainText(catalogueText('home', 'heroHeading2', 'de'))
  await expect(previewRow(block, 'de')).toContainText('which may not match the edited source text')
  await expect(summary(page)).toHaveAttribute('data-attention', 'true')
  await expect(page.getByTestId('translation-summary-message')).toHaveText('Translations that need attention: 5')
  // The neighbouring untouched field is still plainly Built-in.
  assert.deepEqual(await chipsOf(statusOf(page, 3)), ['en:source', 'tr:builtin', 'ar:builtin', 'de:builtin', 'ru:builtin', 'ur:builtin'])
})

test('a field stored in another source language is never claimed to match the built-in text', async (t) => {
  const fields = productionHome()
  fields.heroHeading3 = { type: 'text', sourceLang: 'tr', tr: 'İstanbul’da Mekânlar', verified: false }
  const { page } = await open(t, { admin: adminResponse(fields) })
  const block = statusOf(page, 3)

  assert.deepEqual(await chipsOf(block), ['en:outdated', 'tr:source', 'ar:outdated', 'de:outdated', 'ru:outdated', 'ur:outdated'])
  await toggle(block).click()
  await expect(block.getByTestId('translation-preview')).toContainText('Source language: Turkish')
  await expect(previewRow(block, 'tr')).toContainText('İstanbul’da Mekânlar')
})

/* ══════════════ 4. Saving ══════════════ */

test('save: the Phase A result is shown, then the status is re-read — one write, never two', async (t) => {
  const before = productionHome()
  const after = { ...before, heroCtaSecondary: tracked('See Our Properties', { tr: 'Mülklerimizi Görün', ar: 'شاهد عقاراتنا', de: 'Unsere Immobilien ansehen', ru: 'Смотреть объекты' }, {
    tr: current('See Our Properties'), ar: current('See Our Properties'), de: current('See Our Properties'), ru: current('See Our Properties'),
    ur: { error: 'provider_error', errorAt: at },
  }) }
  let saved = false
  const { page, calls } = await open(t, {
    admin: () => adminResponse(saved ? after : before),
    saveReply: () => {
      saved = true
      return { success: true, fields: after, sections: {}, translation: { fields: { heroCtaSecondary: { sourceLang: 'en', translated: ['tr', 'ar', 'de', 'ru'], needsAttention: [{ lang: 'ur', reason: 'provider_error', using: 'none' }] } } } }
    },
  })
  const block = statusOf(page, 5)
  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:builtin', 'ar:builtin', 'de:builtin', 'ru:builtin', 'ur:builtin'])

  await page.locator('textarea').nth(5).fill('See Our Properties')
  // The chips describe what is stored, not what is being typed.
  assert.deepEqual(await chipsOf(block), ['en:source', 'tr:builtin', 'ar:builtin', 'de:builtin', 'ru:builtin', 'ur:builtin'])
  await page.getByRole('button', { name: pc('en').saveChanges, exact: true }).click()

  // Phase A: the request's own outcome.
  await expect(page.getByText('Saved. Some translations need attention. Source language: English.')).toBeVisible()
  await expect(page.getByTestId('save-report')).toContainText('Urdu: translation failed — the built-in text is shown instead.')
  // Phase B state, re-read and shown by C1.
  await expect.poll(() => chipsOf(block)).toEqual(['en:source', 'tr:current', 'ar:current', 'de:current', 'ru:current', 'ur:outdated'])
  await expect(summary(page)).toHaveAttribute('data-attention', 'true')
  await toggle(block).click()
  await expect(previewRow(block, 'de')).toContainText('Unsere Immobilien ansehen')
  await expect(previewRow(block, 'ur')).toContainText('The last automatic translation attempt failed.')

  const pageContent = calls.filter((c) => c.path.startsWith('/page-content')).map((c) => `${c.method} ${c.path}`)
  assert.deepEqual(pageContent, ['GET /page-content/home/admin', 'PUT /page-content/home', 'GET /page-content/home/admin'])
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { fields: { heroCtaSecondary: { type: 'text', value: 'See Our Properties' } }, sections: {} })
  // The edit is the new baseline: nothing left to save.
  await expect(page.getByRole('button', { name: pc('en').saveChanges, exact: true })).toHaveCount(0)
})

/* ══════════════ 5. An older backend ══════════════ */

test('older backend (no admin read): the editor loads from the public read, saves normally, and simply has no status', async (t) => {
  const publicFields = Object.fromEntries(Object.entries(productionHome()).map(([key, field]) => [key, field]))
  const { page, calls } = await open(t, {
    admin: { status: 404 },
    publicGet: { success: true, fields: publicFields, sections: {} },
    saveReply: { success: true, fields: {}, sections: {} },
  })

  // The form is filled from the public read.
  await expect(page.locator('textarea').nth(0)).toHaveValue(HERO.heroLabel.en)
  await expect(page.locator('textarea').nth(4)).toHaveValue('Explore Services')
  await expect(page.getByTestId('translation-status')).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
  await expect(page.getByTestId('translation-status-unavailable')).toHaveText('Translation status is not available right now. Editing and saving work as usual.')

  await page.locator('textarea').nth(4).fill('Discover Our Services')
  await page.getByRole('button', { name: pc('en').saveChanges, exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: pc('en').saveChanges, exact: true })).toHaveCount(0)
  await expect(page.getByTestId('translation-status')).toHaveCount(0)

  assert.equal(calls.filter((c) => c.method === 'PUT').length, 1)
  assert.deepEqual(calls.filter((c) => c.path.startsWith('/page-content')).map((c) => `${c.method} ${c.path}`),
    ['GET /page-content/home/admin', 'GET /page-content/home', 'PUT /page-content/home', 'GET /page-content/home/admin'])
})

/* ══════════════ 6. Every admin language, including right-to-left ══════════════ */

const STATUS_KEYS = { source: 'statusSource', current: 'statusCurrent', manual: 'statusManual', builtin: 'statusBuiltin', existing: 'statusExisting', stale: 'statusStale', outdated: 'statusOutdated' }

for (const language of LANGS) {
  test(`status, summary and preview are written in ${language}${direction(language) === 'rtl' ? ' (right-to-left)' : ''}`, async (t) => {
    const { page } = await open(t, { language, admin: adminResponse(trackedHome()) })
    const m = pc(language)
    await expect(page.locator('html')).toHaveAttribute('dir', direction(language))

    // Chips: the language code plus the status in the admin's language.
    const block = statusOf(page, 4)
    const expected = [['en', 'source'], ['tr', 'current'], ['ar', 'manual'], ['de', 'stale'], ['ru', 'outdated'], ['ur', 'existing']]
    const texts = await chipTexts(block)
    expected.forEach(([lang, status], i) => {
      assert.ok(texts[i].includes(lang.toUpperCase()) && texts[i].includes(m[STATUS_KEYS[status]]), `${language}: chip ${i} reads "${texts[i]}"`)
    })
    assert.deepEqual(await chipTexts(statusOf(page, 1)), ['en', 'tr', 'ar', 'de', 'ru', 'ur'].map((lang, i) => `${lang.toUpperCase()} ${i === 0 ? m.statusSource : m.statusBuiltin}`))

    await expect(summary(page)).toContainText(m.summaryTitle)
    await expect(page.getByTestId('translation-summary-message')).toHaveText(m.summaryAttention.replace('{count}', '3'))

    // Preview, opened by its translated control.
    const names = new Intl.DisplayNames([{ en: 'en-US', tr: 'tr-TR', ar: 'ar', de: 'de-DE', ru: 'ru-RU', ur: 'ur-PK' }[language]], { type: 'language' })
    await block.getByRole('button', { name: m.translationsShow }).click()
    const panel = block.getByTestId('translation-preview')
    await expect(panel).toContainText(m.sourceLanguage.replace('{language}', names.of('en')))
    await expect(previewRow(block, 'de')).toContainText(names.of('de'))
    await expect(previewRow(block, 'de')).toContainText(m.explainStale)
    await expect(previewRow(block, 'de')).toContainText(m.failureFailed)
    await expect(previewRow(block, 'ru')).toContainText(m.explainOutdated)
    await expect(previewRow(block, 'ru')).toContainText(m.failureQuota)
    await expect(previewRow(block, 'ur')).toContainText(m.failureTooLong)
    await expect(previewRow(block, 'tr')).toContainText(`${m.visitorsSee}: ${m.originStored}.`)
    await expect(block.getByRole('button', { name: m.translationsHide })).toHaveAttribute('aria-expanded', 'true')
    // The English source text keeps its own direction inside a right-to-left page.
    assert.equal(await previewRow(block, 'en').locator('p[lang="en"]').getAttribute('dir'), 'ltr')

    if (language !== 'en') {
      const shown = await block.innerText()
      for (const english of [/\bStale\b/, /Needs attention/, /Built-in/, /Visitors see/, /Show translations/, /Source language/, /The last automatic/]) {
        assert.doesNotMatch(shown, english, `${language}: English "${english}" is shown`)
      }
    }

    // Layout: nothing spills out of the page or out of its card.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 1, `${language}: the page scrolls sideways by ${overflow}px`)
    const card = await block.evaluate((el) => {
      const own = el.getBoundingClientRect()
      const parent = el.closest('.rounded-2xl').getBoundingClientRect()
      return own.left >= parent.left - 1 && own.right <= parent.right + 1
    })
    assert.ok(card, `${language}: the status row leaves its card`)
    await page.screenshot({ path: join(shots, `tracked-${language}.png`), fullPage: false })
  })
}
