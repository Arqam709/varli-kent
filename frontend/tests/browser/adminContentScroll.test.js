// Real Batch 6 pages and providers; all API traffic is isolated to local fixtures.
// Run from frontend: node --test tests/browser/adminContentScroll.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'
import { Buffer } from 'node:buffer'
import translations from '../../src/locales/translations.js'

let server, browser, base
const screenshots = join(tmpdir(), 'varlikent-batch6-visuals')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import { ThemeProvider } from '/src/contexts/ThemeContext.jsx';
import AdminPartners from '/src/pages/AdminPartners.jsx';
import AdminProjects from '/src/pages/AdminProjects.jsx';
import '/src/index.css';
const e = React.createElement;
const projects = location.search.includes('projects');
createRoot(document.getElementById('root')).render(e(MemoryRouter, {initialEntries:[projects ? '/admin/projects' : '/admin/partners']},
e(LanguageProvider, null, e(AuthProvider, null, e(ThemeProvider, null, e(projects ? AdminProjects : AdminPartners))))));
</script></body></html>`

before(async () => {
  await mkdir(screenshots, { recursive: true })
  server = await createServer({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'batch6-fixture', enforce: 'pre', async load(id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/index.css')) {
        // Same source-only test scanner as Batch 4; production CSS/config is untouched.
        return (await readFile(id, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
      }
      const target = env.BATCH6_MUTATION === 'partners' ? 'AdminPartners' : env.BATCH6_MUTATION === 'projects' ? 'AdminProjects' : null
      if (target && path.endsWith('/src/pages/' + target + '.jsx')) return (await readFile(id, 'utf8')).replace('vk-scroll-gold ', '')
    }, configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__batch6.html') || req.url.includes('html-proxy')) return next()
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__batch6.html', html)) }
        catch (error) { next(error) }
      })
    } }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#4b6741"/><text x="40" y="115" font-size="48" fill="white">Partner</text></svg>'

async function setup(t, kind, language) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  t.after(() => page.close())
  const user = { _id: 'fixture-owner', role: 'owner', name: 'Batch Six', permissions: [], themePreference: 'default' }
  const state = { calls: [], records: kind === 'partners'
    ? [{ _id: 'partner-existing', name: 'Existing Partner', logo: base + '/fixture.svg', link: 'https://example.test', circular: false, visible: true, order: 4 }]
    : [{ _id: 'project-existing', name: 'Existing Project', location: 'Istanbul', completion: 'Q3 2026', status: 'active', visible: true, featured: true, order: 4,
      phases: Array.from({ length: 12 }, (_, i) => ({ _id: 'phase-' + i, label: 'Long construction phase ' + i, pct: i * 5, order: i })) }] }
  await page.addInitScript(({ user, language }) => {
    localStorage.setItem('varlikent_token', 'batch6-local-fixture')
    localStorage.setItem('varlikent_user', JSON.stringify(user))
    localStorage.setItem('vk_lang', language)
  }, { user, language })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.includes('/api/')) {
      const path = url.pathname.split('/api')[1], method = request.method()
      let data
      if (request.headers()['content-type']?.includes('application/json')) data = request.postDataJSON()
      state.calls.push({ path, method, data, body: request.postData() })
      if (path === '/auth/me') return route.fulfill({ json: { user } })
      if (path === '/upload') return route.fulfill({ json: { url: base + '/uploaded.svg' } })
      if (method === 'GET' && path === '/' + kind + '/all') return route.fulfill({ json: { [kind]: state.records } })
      if (method === 'POST' && path === '/' + kind) {
        const item = { ...data, _id: kind + '-created' }
        state.records.push(item)
        return route.fulfill({ json: { [kind === 'partners' ? 'partner' : 'project']: item } })
      }
      if (method === 'PUT' && path.startsWith('/' + kind + '/')) {
        const id = path.split('/').pop()
        const item = { ...state.records.find(item => item._id === id), ...data }
        state.records = state.records.map(record => record._id === id ? item : record)
        return route.fulfill({ json: { [kind === 'partners' ? 'partner' : 'project']: item } })
      }
      return route.fulfill({ json: { success: true } })
    }
    if (url.origin !== base) return route.abort()
    if (url.pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: logo })
    return route.continue()
  })
  await page.goto(base + '/__batch6.html?' + kind)
  await expect(page.getByText(kind === 'partners' ? 'Existing Partner' : 'Existing Project', { exact: true })).toBeVisible()
  return { page, state }
}

async function checkScroll(page) {
  const overlay = page.locator('form').locator('..').locator('..')
  await expect(overlay).toHaveCSS('overflow-y', 'auto')
  await expect(overlay).toHaveCSS('scrollbar-width', 'thin')
  assert.ok(await overlay.evaluate(el => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--vk-gold)'
    el.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return getComputedStyle(el).scrollbarColor.startsWith(color)
  }), 'editor scrollbar follows the current theme')
  await overlay.evaluate(el => { el.scrollTop = el.scrollHeight })
  assert.ok(await overlay.evaluate(el => el.scrollTop > 0), 'short viewport actually scrolls')
  await page.locator('form button[type=submit]').scrollIntoViewIfNeeded()
  const box = await page.locator('form button[type=submit]').boundingBox()
  assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height, 'save remains reachable')
}

for (const kind of ['partners', 'projects']) {
  for (const language of ['en', 'ur']) {
    test(kind + ' editor scrolls, keeps theme/RTL and preserves edit payload in ' + language, async t => {
      const { page, state } = await setup(t, kind, language)
      const labels = translations[language].adminPages
      await page.screenshot({ path: join(screenshots, kind + '-list-' + language + '.png') })
      await page.getByRole('button', { name: labels.common.edit, exact: true }).click()
      await page.screenshot({ path: join(screenshots, kind + '-edit-desktop-' + language + '.png') })
      await page.setViewportSize({ width: 390, height: 500 })
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ur' ? 'rtl' : 'ltr')
      await checkScroll(page)
      await page.screenshot({ path: join(screenshots, kind + '-edit-mobile-' + language + '.png') })
      // Exercise the existing theme token without adding a new preference mechanism.
      await page.locator('html').evaluate(el => el.style.setProperty('--vk-gold', '#a454be'))
      await checkScroll(page)
      const original = structuredClone(state.records[0])
      await page.locator('form button[type=submit]').click()
      await expect(page.locator('form')).toHaveCount(0)
      const saved = state.calls.find(call => call.method === 'PUT')
      assert.equal(saved.path, '/' + kind + '/' + original._id)
      if (kind === 'partners') {
        const { _id: _ignored, ...fields } = original
        assert.deepEqual(saved.data, fields)
      } else assert.deepEqual(saved.data, original)
      assert.equal(state.records[0]._id, original._id)

      await page.setViewportSize({ width: 1280, height: 800 })
      const addLabel = kind === 'partners' ? labels.partners.addPartner : labels.projects.addProject
      await page.getByRole('button', { name: addLabel, exact: true }).click()
      await page.screenshot({ path: join(screenshots, kind + '-create-' + language + '.png') })
      await page.locator('form input').first().fill('Created fixture')
      if (kind === 'partners') {
        await page.locator('form input[type=checkbox]').first().check()
        await page.locator('input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(logo) })
        await expect(page.locator('input[type=range]')).toBeVisible()
        await expect.poll(() => page.locator('img[src^="blob:"]').evaluate(el => el.naturalWidth)).toBe(400)
        await page.screenshot({ path: join(screenshots, 'partners-crop-' + language + '.png') })
        await page.getByRole('button', { name: labels.partners.cropApply, exact: true }).click()
        await expect.poll(() => state.calls.filter(call => call.path === '/upload').length).toBe(1)
        await expect(page.locator('form button[type=submit]')).toBeEnabled()
        assert.match(state.calls.find(call => call.path === '/upload').body, /filename="logo.png"/)
        assert.match(state.calls.find(call => call.path === '/upload').body, /image\/png/)
        assert.equal(await page.locator('input[type=file]').inputValue(), '')
      } else {
        await expect(page.locator('input[type=file]')).toHaveCount(0)
      }
      await page.locator('form button[type=submit]').click()
      await expect(page.locator('form')).toHaveCount(0)
      const created = state.calls.find(call => call.path === '/' + kind && call.method === 'POST').data
      assert.equal(created.name, 'Created fixture')
      if (kind === 'partners') { assert.equal(created.circular, true); assert.equal(created.logo, base + '/uploaded.svg') }
      else assert.equal(created.phases.length, 6)
      assert.equal(state.records[0]._id, original._id)
    })
  }
}