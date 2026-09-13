// Batch 4: real layout and navigation behavior, with local API fixtures only.
// Run from frontend: node --test tests/browser/globalLayout.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'

let server, browser, base
const screenshots = join(tmpdir(), 'varlikent-batch4-visuals')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { LanguageProvider } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import AdminLayout from '/src/components/AdminLayout.jsx';
import Navbar from '/src/components/Navbar.jsx';
import '/src/index.css';
const e = React.createElement;
function Harness() {
  window.batch4Navigate = useNavigate();
  return location.search.includes('admin')
    ? e(AdminLayout, null, e('div', {style: {height: 1800}}, 'Long admin content'))
    : e(React.Fragment, null, e(Navbar), e('div', {style: {height: 2200, background: 'var(--vk-section-dark)', paddingTop: 100, color: 'white'}}, 'Public page fixture'));
}
createRoot(document.getElementById('root')).render(e(MemoryRouter, null, e(LanguageProvider, null, e(AuthProvider, null, e(Harness)))));
</script></body></html>`

before(async () => {
  await mkdir(screenshots, { recursive: true })
  server = await createServer({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    // Scan real production source only; exclude large unrelated public assets.
    plugins: [{ name: 'batch4-css-source', enforce: 'pre', async load(id) {
      const mutation = env.BATCH4_MUTATION
      if (mutation && /\/src\/components\/(Navbar|AdminLayout)\.jsx$/.test(id.replaceAll('\\', '/'))) {
        let source = await readFile(id, 'utf8')
        if (mutation === 'remove-admin-usage' && id.endsWith('AdminLayout.jsx')) source = source.replace('vk-scroll-gold min-h-0 flex-1 space-y-5', 'min-h-0 flex-1 space-y-5')
        if (id.endsWith('Navbar.jsx')) {
          if (mutation === 'remove-desktop-reset') source = source.replace('    setMoreLangOpen(false)', '')
          if (mutation === 'remove-mobile-reset') source = source.replace('    setMobileMoreLangOpen(false)', '')
          if (mutation === 'restore-fixed-accent') source = source.replaceAll('bg-[var(--vk-green-brand)]', 'bg-[#4b6741]')
          if (mutation === 'drop-agent-portal') source = source.replaceAll('portal && (', "portal && portal.to !== '/agent/dashboard' && (")
        }
        return source
      }
      if (!id.replaceAll('\\', '/').endsWith('/src/index.css')) return
      let css = await readFile(id, 'utf8')
      if (mutation === 'remove-scrollbar') css = css.replace(/\.vk-scroll-gold[\s\S]*$/, '')
      if (mutation === 'global-scrollbar') css += '\n* { scrollbar-width: thin; }'
      return css.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
    } }, { name: 'batch4-harness', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__batch4.html') || req.url.includes('html-proxy')) return next()
        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml('/__batch4.html', html))
        } catch (error) { next(error) }
      })
    } }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

async function setup(t, { admin = false, role = 'owner', permissions = [], width = 1440, height = 900, language = 'en' } = {}) {
  const page = await browser.newPage({ viewport: { width, height } })
  t.after(() => page.close())
  const user = role ? { role, name: 'Batch Four Reviewer', permissions } : null
  await page.addInitScript(({ user, language }) => {
    localStorage.setItem('vk_lang', language)
    if (user) {
      localStorage.setItem('varlikent_token', 'local-fixture')
      localStorage.setItem('varlikent_user', JSON.stringify(user))
    }
  }, { user, language })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/api/')) return route.fulfill({ json: { success: true, user } })
    if (url.origin !== base) return route.abort()
    return route.continue()
  })
  await page.goto(`${base}/__batch4.html${admin ? '?admin' : ''}`)
  await expect(page.locator(admin ? 'aside nav' : 'nav[aria-label="Main navigation"]')).toBeVisible()
  if (user) await expect(admin ? page.getByText(user.name, { exact: true }).first() : page.getByRole('button', { name: /Batch/ })).toBeVisible()
  return page
}

async function checkScrollbar(locator) {
  await expect(locator).toHaveCSS('overflow-y', 'auto')
  await expect(locator).toHaveCSS('scrollbar-width', 'thin')
  assert.ok(await locator.evaluate(el => {
    const s = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.color = 'var(--vk-gold)'
    el.append(probe)
    const gold = getComputedStyle(probe).color
    probe.remove()
    return s.scrollbarColor.startsWith(gold)
  }), 'scrollbar must use the active theme gold')
}

test('admin scrolling keeps all 16 destinations and the account footer reachable at short heights', async t => {
  const page = await setup(t, { admin: true, height: 420 })
  const nav = page.locator('aside nav')
  const expected = ['dashboard', 'properties', 'messages', 'user-chats', 'projects', 'about', 'page-content', 'team', 'reviews', 'showroom', 'partners', 'studio-palette', 'lead-routing', 'users', 'settings', 'activity']
  assert.deepEqual((await nav.locator('a').evaluateAll(els => els.map(el => el.getAttribute('href').split('/').pop()))).sort(), expected.sort())
  await checkScrollbar(nav)
  await checkScrollbar(page.locator('main'))
  const logout = page.locator('aside').getByRole('button', { name: 'Logout' })
  const before = await logout.boundingBox()
  assert.ok(before.y >= 0 && before.y + before.height <= 420)
  await nav.evaluate(el => { el.scrollTop = el.scrollHeight })
  assert.ok(await nav.evaluate(el => el.scrollTop > 0), 'sidebar actually scrolls')
  await expect(nav.locator('a[href="/admin/activity"]')).toBeInViewport()
  assert.deepEqual(await logout.boundingBox(), before, 'footer must not scroll with links')
  await page.locator('main').evaluate(el => { el.scrollTop = 700 })
  assert.ok(await page.locator('main').evaluate(el => el.scrollTop > 0))
  await page.screenshot({ path: join(screenshots, 'admin-short.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await nav.evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: join(screenshots, 'admin-desktop.png') })
})

test('restricted admin keeps permission gates and omits empty groups', async t => {
  const page = await setup(t, { admin: true, role: 'admin', permissions: ['edit_listing', 'manage_team'] })
  const nav = page.locator('aside nav')
  assert.deepEqual(await nav.locator('a').evaluateAll(els => els.map(el => el.getAttribute('href'))),
    ['/admin/dashboard', '/admin/properties', '/admin/team'])
  await expect(nav.getByText('System', { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.batch4Navigate('/admin/team'))
  await expect(nav.locator('a[href="/admin/team"]')).toHaveAttribute('aria-current', 'page')
})

test('desktop language panel closes on router navigation', async t => {
  const page = await setup(t)
  const toggle = page.getByRole('button', { name: 'More languages', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.evaluate(() => window.batch4Navigate('/team'))
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('mobile scroll, close, body unlock, and language panel reset survive navigation', async t => {
  const page = await setup(t, { width: 390, height: 600, role: null })
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const dialog = page.getByRole('dialog', { name: 'Navigation menu' })
  await expect(dialog).toBeVisible()
  const scroll = dialog.locator('div.overflow-y-auto')
  await checkScrollbar(scroll)
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  const toggle = dialog.locator('button[aria-expanded]')
  await toggle.click()
  await expect(dialog.getByRole('button', { name: 'UR', exact: true })).toBeVisible()
  await dialog.locator('a[href="/team"]').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight })
  assert.ok(await scroll.evaluate(el => el.scrollTop > 0))
  await expect(dialog.locator('a[href="/register"]')).toBeInViewport()
  await expect.poll(() => dialog.boundingBox()).toMatchObject({ x: 0, width: 390 })
  await page.screenshot({ path: join(screenshots, 'navbar-mobile-open.png') })
  await dialog.getByRole('button', { name: 'Close menu' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  await page.screenshot({ path: join(screenshots, 'navbar-mobile-closed.png') })
})

test('navbar and selection accents follow every existing theme without global scroll styling', async t => {
  const page = await setup(t)
  const themes = ['default', 'forest', 'earth', 'navy', 'gold-white', 'sand-travertine', 'rosewood-blush', 'blush-ivory']
  for (const theme of themes) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    const accent = await page.evaluate(() => {
      const el = document.createElement('span'); el.style.color = 'var(--vk-green-brand)'; document.body.append(el)
      const color = getComputedStyle(el).color; el.remove(); return color
    })
    await expect(page.getByRole('button', { name: 'Switch to EN', exact: true })).toHaveCSS('background-color', accent)
    const values = await page.getByRole('button', { name: 'Switch to EN', exact: true }).evaluate(el => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--vk-green-brand)'
      document.body.append(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      return {
        accent, selected: getComputedStyle(el).backgroundColor,
        selection: getComputedStyle(el, '::selection').backgroundColor,
        bodyScrollbar: getComputedStyle(document.body).scrollbarWidth,
      }
    })
    assert.equal(values.selected, values.accent, theme + ' selected language')
    assert.equal(values.selection, values.accent, theme + ' selection')
    assert.equal(values.bodyScrollbar, 'auto', 'public body keeps native scrollbar')
  }
  await page.getByRole('button', { name: 'Batch', exact: false }).click()
  const favourite = page.locator('nav[aria-label="Main navigation"] a[href="/favourites"]')
  await favourite.hover()
  await expect(favourite).toHaveCSS('color', 'rgb(156, 87, 112)')
  await page.evaluate(() => window.batch4Navigate('/favourites'))
  await expect(page.locator('nav[aria-label="Main navigation"]')).toHaveCSS('backdrop-filter', 'blur(14px) saturate(1.4)')
  await page.screenshot({ path: join(screenshots, 'navbar-desktop.png') })
})

test('six languages remain selectable on desktop and mobile, including Arabic/Urdu RTL', async t => {
  const page = await setup(t, { role: null })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 700 })
    if (width === 390) await page.getByRole('button', { name: 'Open navigation menu' }).click()
    for (const code of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
      if (width === 1440) {
        if (['de', 'ru', 'ur'].includes(code)) {
          await page.getByRole('button', { name: 'More languages', exact: true }).click()
          await page.getByRole('button', { name: code.toUpperCase(), exact: true }).click()
        } else await page.getByRole('button', { name: 'Switch to ' + code.toUpperCase(), exact: true }).click()
      } else {
        const dialog = page.getByRole('dialog')
        if (['de', 'ru', 'ur'].includes(code)) await dialog.locator('button[aria-expanded]').click()
        const languageButton = dialog.getByRole('button', { name: code.toUpperCase(), exact: true })
        // The more toggle may display the previously selected language; the option is last.
        await languageButton.last().click()
      }
      await expect(page.locator('html')).toHaveAttribute('lang', code)
      await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(code) ? 'rtl' : 'ltr')
    }
    if (width === 390) {
      await checkScrollbar(page.getByRole('dialog').locator('div.overflow-y-auto'))
      await expect(page.getByRole('dialog').getByRole('button', { name: 'DE', exact: true })).toHaveCount(0)
      await expect.poll(() => page.getByRole('dialog').boundingBox()).toMatchObject({ x: 0, width: 390 })
      await page.screenshot({ path: join(screenshots, 'navbar-urdu.png') })
    }
  }
})

test('desktop and mobile keep admin, owner, agent and ordinary-user portal behavior', async t => {
  for (const role of ['owner', 'admin', 'agent', 'user']) {
    const page = await setup(t, { role })
    const target = role === 'agent' ? '/agent/dashboard' : role === 'user' ? null : '/admin/dashboard'
    await page.getByRole('button', { name: 'Batch', exact: false }).click()
    const nav = page.locator('nav[aria-label="Main navigation"]')
    await expect(nav.locator('a[href$="/dashboard"]')).toHaveCount(target ? 1 : 0)
    if (target) await expect(nav.locator(`a[href="${target}"]`)).toBeVisible()
    await expect(nav.locator('a[href="/favourites"]')).toBeVisible()
    await expect(nav.locator('a[href="/settings"]')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 700 })
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('a[href$="/dashboard"]')).toHaveCount(target ? 1 : 0)
    if (target) await expect(dialog.locator(`a[href="${target}"]`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Sign Out', exact: false }).click()
    await expect(dialog).toHaveCount(0)
    assert.equal(await page.evaluate(() => localStorage.getItem('varlikent_token')), null)
    await page.close()
  }
})
