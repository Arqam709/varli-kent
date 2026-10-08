// CMS Phase A — the Page Content editor reports a save honestly.
//
// The real editor in a real browser. Every API call is answered here, so no
// backend runs, nothing reaches MongoDB and no translation is ever requested.
// Run from frontend/:
//   node --test tests/browser/pageContentSaveReport.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import translations from '../../src/locales/translations.js'

let server
let browser
let base
const FIXTURE = '/__page_content_save_report.html'

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
      name: 'page-content-save-report-harness',
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

const OWNER = { _id: 'owner1', role: 'owner', name: 'Test Owner', permissions: [] }
const FIVE = ['tr', 'ar', 'de', 'ru', 'ur']
const OLD_CLAIM = /all six languages|altı dile|اللغات الست/i
const pc = (lang) => translations[lang].adminPages.pageContent
const fieldReport = (translated, needsAttention = [], sourceLang = 'en') => ({ sourceLang, translated, needsAttention })

/*
 * Opens the editor on the homepage. `saveReply` is what PUT answers with:
 * a response body, or { status, body } for a failing save.
 */
async function open(t, { language = 'en', saveReply } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  const saves = []

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
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/auth/me') return json(200, { success: true, user: OWNER })
    if (path.startsWith('/page-content/') && request.method() === 'PUT') {
      saves.push(request.postDataJSON())
      const reply = typeof saveReply === 'function' ? saveReply() : saveReply
      return reply?.status ? json(reply.status, reply.body) : json(200, reply)
    }
    if (path.startsWith('/page-content/')) return json(200, { success: true, fields: {}, sections: {} })
    return json(200, { success: true })
  })

  await page.goto(`${base}${FIXTURE}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await expect(page.getByRole('heading', { level: 1, name: pc(language).title })).toBeVisible({ timeout: 45000 })
  await expect(page.locator('textarea').first()).toBeVisible()
  return { page, saves }
}

// The hero card is open on load; its fields are the first textareas, in registry order.
const heroLabel = (page) => page.locator('textarea').nth(0)
const heroCtaPrimary = (page) => page.locator('textarea').nth(4)
const save = (page, language = 'en') => page.getByRole('button', { name: pc(language).saveChanges, exact: true }).click()
const report = (page) => page.getByTestId('save-report')
const bodyText = (page) => page.locator('body').innerText()

test('complete success: says how many languages were translated, and shows no report', async (t) => {
  const { page, saves } = await open(t, {
    saveReply: { success: true, fields: {}, sections: {}, translation: { fields: { heroCtaPrimary: fieldReport(FIVE) } } },
  })

  await expect(heroCtaPrimary(page)).toHaveValue('Explore Our Services')
  await heroCtaPrimary(page).fill('Discover Our Services')
  await save(page)

  await expect(page.getByText('Saved and translated into 5 languages. Source language: English.')).toBeVisible()
  await expect(report(page)).toHaveCount(0)
  assert.doesNotMatch(await bodyText(page), OLD_CLAIM)

  // The request is the same delta the editor always sent.
  assert.deepEqual(saves, [{ fields: { heroCtaPrimary: { type: 'text', value: 'Discover Our Services' } }, sections: {} }])
  // The save bar is gone: the edit is the new baseline.
  await expect(page.getByRole('button', { name: pc('en').saveChanges, exact: true })).toHaveCount(0)
})

test('partial success: no blanket claim, and each field lists the languages that need attention', async (t) => {
  const { page } = await open(t, {
    saveReply: {
      success: true, fields: {}, sections: {},
      translation: {
        fields: {
          heroLabel: fieldReport(['tr', 'ar', 'ru', 'ur'], [{ lang: 'de', reason: 'timeout', using: 'previous' }]),
          heroCtaPrimary: fieldReport(['tr', 'ar', 'de', 'ru'], [{ lang: 'ur', reason: 'too_long', using: 'none' }]),
        },
      },
    },
  })

  await heroLabel(page).fill('Istanbul Studio')
  await heroCtaPrimary(page).fill('Discover Our Services')
  await save(page)

  await expect(page.getByText('Saved. Some translations need attention. Source language: English.')).toBeVisible()
  assert.doesNotMatch(await bodyText(page), OLD_CLAIM)
  assert.equal((await bodyText(page)).includes('Saved and translated into'), false)

  const box = report(page)
  await expect(box).toBeVisible()
  await expect(box).toContainText('Translations that need attention')
  const items = box.locator('li')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Hero — Label')
  await expect(items.nth(0)).toContainText('German: translation failed — the previous translation is still shown.')
  await expect(items.nth(1)).toContainText('Hero — Primary button text')
  await expect(items.nth(1)).toContainText('Urdu: translation failed — the built-in text is shown instead.')
  await expect(items.nth(1)).toContainText('This text is longer than 500 characters')
  // Nothing technical reaches the admin.
  for (const internal of ['timeout', 'too_long', 'needsAttention', 'heroCtaPrimary', 'MYMEMORY']) {
    assert.equal((await box.innerText()).includes(internal), false, internal)
  }

  await box.getByRole('button', { name: 'Dismiss' }).click()
  await expect(report(page)).toHaveCount(0)
})

test('all translations fail: the source is reported saved, translation as unavailable', async (t) => {
  const failed = FIVE.map((lang) => ({ lang, reason: 'provider_error', using: lang === 'de' ? 'previous' : 'none' }))
  const { page } = await open(t, {
    saveReply: { success: true, fields: {}, sections: {}, translation: { fields: { heroCtaPrimary: fieldReport([], failed) } } },
  })

  await heroCtaPrimary(page).fill('Discover Our Services')
  await save(page)

  await expect(page.getByText(/^Saved\. Automatic translation is unavailable right now\./)).toBeVisible()
  const text = await bodyText(page)
  assert.doesNotMatch(text, OLD_CLAIM)
  assert.equal(text.includes(pc('en').saveFailed), false, 'the save is not presented as failed')

  const item = report(page).locator('li')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('German: translation failed — the previous translation is still shown.')
  await expect(item).toContainText('Turkish, Arabic, Russian, and Urdu: translation failed — the built-in text is shown instead.')
  // The edit was accepted: there is nothing left to save.
  await expect(page.getByRole('button', { name: pc('en').saveChanges, exact: true })).toHaveCount(0)
})

test('an older backend (no report in the response): a plain "Saved.", with no claim about translation', async (t) => {
  const { page } = await open(t, { saveReply: { success: true, fields: {}, sections: {} } })

  await heroCtaPrimary(page).fill('Discover Our Services')
  await save(page)

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await expect(report(page)).toHaveCount(0)
  assert.doesNotMatch(await bodyText(page), OLD_CLAIM)
  // The toast says exactly that and no more. (The page's own subtitle, which
  // explains that text is translated on save, is not a claim about this save.)
  assert.equal((await page.locator('.Toastify').innerText()).trim(), 'Saved.')
})

test('a save that really fails is still an error, and the edit stays pending', async (t) => {
  const { page } = await open(t, { saveReply: { status: 500, body: { success: false } } })

  await heroCtaPrimary(page).fill('Discover Our Services')
  await save(page)

  await expect(page.getByText(pc('en').saveFailed)).toBeVisible()
  await expect(report(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: pc('en').saveChanges, exact: true })).toBeVisible()
})

test('a report from one save is replaced by the next', async (t) => {
  const replies = [
    { success: true, fields: {}, sections: {}, translation: { fields: { heroCtaPrimary: fieldReport(['tr', 'ar', 'ru', 'ur'], [{ lang: 'de', reason: 'echo', using: 'none' }]) } } },
    { success: true, fields: {}, sections: {}, translation: { fields: { heroCtaPrimary: fieldReport(FIVE) } } },
  ]
  const { page } = await open(t, { saveReply: () => replies.shift() })

  await heroCtaPrimary(page).fill('Discover Our Services')
  await save(page)
  await expect(report(page)).toContainText('German: translation failed — the built-in text is shown instead.')

  await heroCtaPrimary(page).fill('Discover Everything We Offer')
  await save(page)
  await expect(page.getByText('Saved and translated into 5 languages. Source language: English.')).toBeVisible()
  await expect(report(page)).toHaveCount(0)
})

for (const language of ['tr', 'ar']) {
  test(`the report is written in the Admin language (${language})`, async (t) => {
    const { page } = await open(t, {
      language,
      saveReply: {
        success: true, fields: {}, sections: {},
        translation: { fields: { heroCtaPrimary: fieldReport(['tr', 'ar', 'ru'], [{ lang: 'de', reason: 'timeout', using: 'previous' }, { lang: 'ur', reason: 'timeout', using: 'none' }]) } },
      },
    })
    const m = pc(language)

    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
    await heroCtaPrimary(page).fill('Discover Our Services')
    await save(page, language)

    await expect(page.getByText(m.savedPartial, { exact: false }).first()).toBeVisible()
    const box = report(page)
    await expect(box).toBeVisible()
    await expect(box).toContainText(m.saveReportTitle)
    const names = new Intl.DisplayNames([language === 'tr' ? 'tr-TR' : 'ar'], { type: 'language' })
    await expect(box).toContainText(m.saveIssuePrevious.replace('{languages}', names.of('de')))
    await expect(box).toContainText(m.saveIssueMissing.replace('{languages}', names.of('ur')))
    assert.doesNotMatch(await bodyText(page), OLD_CLAIM)
    // Whole words: Turkish for Urdu is "Urduca".
    for (const english of [/translation failed/, /Some translations need attention/, /German/, /Urdu/]) {
      assert.doesNotMatch(await box.innerText(), english, `${language}: shown in English`)
    }

    // The box stays inside the editor column and is fully on screen.
    const bounds = await box.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1366, 'the report overflows the viewport')
  })
}
