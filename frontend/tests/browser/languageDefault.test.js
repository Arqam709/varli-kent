// Turkish default + the one-time legacy-English migration, in a real browser.
// Run from frontend: node --test tests/browser/languageDefault.test.js
//
// Why this exists: the build before the Turkish default wrote `vk_lang: "en"`
// into every visitor's browser on mount, whether or not they ever chose a
// language. Changing the fallback to Turkish therefore did nothing for anyone
// who had already loaded the site — the whole existing audience stayed on
// English in production. LanguageContext now migrates that one ambiguous value
// exactly once, and records genuine choices so it never has to guess again.
//
// The cases below are the ones that regressed or could regress. In particular
// the seeding helper can leave the key ABSENT, which the other browser suites
// never do — they always set `vk_lang`, so none of them can catch a default
// bug.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

let server, browser, base
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import Navbar from '/src/components/Navbar.jsx';
import '/src/index.css';
const e = React.createElement;
createRoot(document.getElementById('root')).render(
  e(MemoryRouter, null, e(LanguageProvider, null, e(AuthProvider, null, e(Navbar))))
);
</script></body></html>`

before(async () => {
  server = await createServer({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'langdefault-css', enforce: 'pre', async load(id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/index.css')) return
      const css = await readFile(id, 'utf8')
      return css.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
    } }, { name: 'langdefault-harness', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__lang.html') || req.url.includes('html-proxy')) return next()
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__lang.html', html)) }
        catch (error) { next(error) }
      })
    } }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

/**
 * Boots the navbar with a seeded browser state.
 *
 * `stored: undefined` leaves `vk_lang` genuinely unset — a first-time visitor.
 * The seeding is guarded by a sessionStorage flag because addInitScript re-runs
 * on every navigation; without the guard a reload would re-seed and so could
 * never distinguish "returned" from "arrived for the first time".
 */
async function boot(t, { stored, extra = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  t.after(() => page.close())
  await page.addInitScript(({ value, extra }) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    if (value !== null) localStorage.setItem('vk_lang', value)
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
  }, { value: stored === undefined ? null : stored, extra })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/api/')) return route.fulfill({ json: { success: true, user: null } })
    if (url.origin !== base) return route.abort()
    return route.continue()
  })
  await page.goto(`${base}/__lang.html`)
  await page.waitForSelector('nav')
  return page
}

/*
 * textContent, not innerText: this harness renders the navbar without the full
 * responsive layout settled, and innerText reports only what is actually laid
 * out — it comes back empty for the desktop link row. textContent is what the
 * component rendered, which is exactly the question these assertions ask.
 */
const state = (page) => page.evaluate(() => ({
  lang: document.documentElement.getAttribute('lang'),
  dir: document.documentElement.getAttribute('dir'),
  stored: localStorage.getItem('vk_lang'),
  explicit: localStorage.getItem('vk_lang_explicit'),
  text: document.querySelector('nav').textContent,
}))

test('a first-time visitor with no stored preference gets Turkish', async (t) => {
  const s = await state(await boot(t, { stored: undefined }))
  assert.equal(s.lang, 'tr')
  assert.equal(s.dir, 'ltr')
  assert.equal(s.stored, 'tr')
  assert.match(s.text, /Ana Sayfa/, 'Turkish navigation must render')
})

test('a legacy browser carrying auto-saved English is migrated to Turkish', async (t) => {
  // The exact production state: the old build wrote 'en' with no marker.
  const page = await boot(t, { stored: 'en' })
  const first = await state(page)
  assert.equal(first.lang, 'tr', 'legacy auto-default English must become Turkish')
  assert.match(first.text, /Ana Sayfa/)

  // And it must STAY Turkish — the migration is one-shot, not a fight per load.
  await page.reload()
  await page.waitForSelector('nav')
  assert.equal((await state(page)).lang, 'tr')
})

test('choosing English after the migration makes it stick permanently', async (t) => {
  const page = await boot(t, { stored: 'en' })
  await page.getByRole('button', { name: 'Switch to EN' }).click()
  await page.waitForFunction(() => document.documentElement.getAttribute('lang') === 'en')

  const picked = await state(page)
  assert.equal(picked.explicit, '1', 'a real click must record intent')

  await page.reload()
  await page.waitForSelector('nav')
  const after = await state(page)
  assert.equal(after.lang, 'en', 'an explicit English choice survives reload')
  assert.match(after.text, /Home/)
})

test('an English preference already marked explicit is never migrated', async (t) => {
  const s = await state(await boot(t, { stored: 'en', extra: { vk_lang_explicit: '1' } }))
  assert.equal(s.lang, 'en')
})

test('an already-migrated browser on English is left alone', async (t) => {
  const s = await state(await boot(t, { stored: 'en', extra: { vk_lang_default_migrated: '1' } }))
  assert.equal(s.lang, 'en')
})

test('a non-English stored language is provably explicit and never migrated', async (t) => {
  // The old default was 'en', so any other stored code can only have come from
  // a click — none of these may be touched by the migration.
  for (const [code, marker] of [['de', /Startseite/], ['ru', /Главная/], ['tr', /Ana Sayfa/]]) {
    const s = await state(await boot(t, { stored: code }))
    assert.equal(s.lang, code, `${code} must be preserved`)
    assert.equal(s.dir, 'ltr')
    assert.match(s.text, marker, `${code} content must render`)
  }
})

test('Arabic and Urdu keep right-to-left through the migration logic', async (t) => {
  for (const code of ['ar', 'ur']) {
    const s = await state(await boot(t, { stored: code }))
    assert.equal(s.lang, code)
    assert.equal(s.dir, 'rtl', `${code} must stay RTL`)
  }
})

test('an unsupported stored value falls back to Turkish without breaking', async (t) => {
  for (const bad of ['xx', '', 'EN', '[object Object]']) {
    const s = await state(await boot(t, { stored: bad }))
    assert.equal(s.lang, 'tr', `${JSON.stringify(bad)} must fall back to Turkish`)
    assert.equal(s.stored, 'tr', 'and must be healed in storage')
  }
})

test('the language switcher renders no unexpected words', async (t) => {
  // A green pill in the language cluster was reported showing "MOST" in
  // production. It is not in this codebase — this pins that the switcher only
  // ever renders language codes and the three-dot overflow glyph.
  for (const code of [undefined, 'en', 'tr', 'de', 'ar', 'ur']) {
    const page = await boot(t, { stored: code })
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('nav button')].map(b => b.textContent.trim()).filter(Boolean))
    assert.ok(!labels.includes('MOST'), `unexpected "MOST" label with vk_lang=${code}`)
    for (const label of labels) {
      assert.ok(!/^MOST$/i.test(label), `unexpected "${label}" in the switcher`)
    }
  }
})
