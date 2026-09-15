// Isolated real components. All API traffic is fulfilled by local fixtures.
// Run: node --test tests/browser/privacySettings.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'
import translations from '../../src/locales/translations.js'

let server, browser, base
const screenshots = join(tmpdir(), 'varlikent-batch5-visuals')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { LanguageProvider, useLanguage } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import { ThemeProvider } from '/src/contexts/ThemeContext.jsx';
import { ChatProvider } from '/src/contexts/ChatContext.jsx';
import PrivacyBanner from '/src/components/PrivacyBanner.jsx';
import SettingsPage from '/src/pages/SettingsPage.jsx';
import ProtectedRoute from '/src/components/ProtectedRoute.jsx';
import PrivacyPolicyPage from '/src/pages/PrivacyPolicyPage.jsx';
import { ToastContainer } from 'react-toastify';
import '/src/index.css';
const e = React.createElement;
function Harness() {
  window.batch5Navigate = useNavigate();
  window.batch5SetLanguage = useLanguage().setLanguage;
  return e(React.Fragment, null, e(ToastContainer),
    e(PrivacyBanner), e(Routes, null,
      e(Route, {path: '/settings', element: e(ProtectedRoute, null, e(SettingsPage))}),
      e(Route, {path: '/privacy', element: e(PrivacyPolicyPage)}),
      e(Route, {path: '/login', element: e('h1', null, 'Login fixture')}),
      e(Route, {path: '/contact', element: e('h1', null, 'Contact fixture')}),
      e(Route, {path: '*', element: e('main', {style:{minHeight:1500, padding:24}}, 'Public fixture')})
    )
  );
}
createRoot(document.getElementById('root')).render(e(MemoryRouter, {initialEntries: [location.search.includes('settings') ? '/settings' : '/']},
e(LanguageProvider, null, e(AuthProvider, null, e(ThemeProvider, null, e(ChatProvider, null, e(Harness)))))));
</script></body></html>`

before(async () => {
  await mkdir(screenshots, { recursive: true })
  server = await createServer({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'batch5-fixtures', enforce: 'pre', async load(id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/index.css')) {
        // Restrict the test scanner to real production source, as in Batch 4.
        return (await readFile(id, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
      }
      if (env.BATCH5_MUTATION && /\/src\/(components\/PrivacyBanner|pages\/SettingsPage)\.jsx$/.test(path)) {
        let source = await readFile(id, 'utf8')
        const mutation = env.BATCH5_MUTATION
        if (path.endsWith('/PrivacyBanner.jsx')) {
          if (mutation === 'no-persist') source = source.replace("localStorage.setItem(STORAGE_KEY, '1')", 'void 0')
          if (mutation === 'no-hide') source = source.replace('setAcknowledged(true)', 'setAcknowledged(false)')
          if (mutation === 'no-scrollbar') source = source.replace('vk-scroll-gold ', '')
          if (mutation === 'no-escape') source = source.replace("event.key === 'Escape'", "event.key === 'Unused'")
        }
        if (mutation === 'english-only' && path.endsWith('/SettingsPage.jsx')) {
          source = "import batch5English from '../locales/translations'\n" + source.replace('const s = t.settingsPage', 'const s = batch5English.en.settingsPage')
        }
        return source
      }
    }, configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__batch5.html') || req.url.includes('html-proxy')) return next()
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__batch5.html', html)) }
        catch (error) { next(error) }
      })
    } }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

async function setup(t, { settings = false, role = 'agent', width = 1280, height = 800, language = 'en', blockedStorage = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height } })
  t.after(() => page.close())
  const user = role ? { _id: 'fixture-user', role, name: 'Batch Five', email: 'fixture@example.test', themePreference: 'default', createdAt: '2025-01-02T12:00:00Z' } : null
  const state = { calls: [], holdProfile: null }
  await page.addInitScript(({ user, language, settings, blockedStorage }) => {
    localStorage.setItem('vk_lang', language)
    if (user) {
      localStorage.setItem('varlikent_token', 'isolated-fixture-token')
      localStorage.setItem('varlikent_user', JSON.stringify(user))
    }
    if (settings) localStorage.setItem('vk_privacy_ack', '1')
    if (blockedStorage) {
      for (const method of ['getItem', 'setItem']) {
        const original = Storage.prototype[method]
        Storage.prototype[method] = function (key, ...args) {
          if (key === 'vk_privacy_ack') throw new DOMException('Fixture blocked storage', 'SecurityError')
          return original.call(this, key, ...args)
        }
      }
    }
  }, { user, language, settings, blockedStorage })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/api/')) {
      const method = route.request().method()
      const data = method === 'PUT' && !url.pathname.endsWith('/avatar') ? route.request().postDataJSON() : null
      state.calls.push({ path: url.pathname, search: url.search, method, data })
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { user } })
      if (url.pathname.endsWith('/chat/conversations')) {
        if (method === 'DELETE') return route.fulfill({ json: { success: true, deletedCount: 2 } })
        const second = url.searchParams.get('page') === '2'
        return route.fulfill({ json: { conversations: [{ _id: second ? 'chat2' : 'chat1', lastMessage: { text: second ? 'Second saved AI chat' : 'First saved AI chat' }, messageCount: 2, lastActivityAt: '2026-01-01T12:00:00Z' }], pagination: { page: second ? 2 : 1, totalPages: 2 } } })
      }
      if (method === 'PUT' && url.pathname.endsWith('/profile')) {
        if (state.holdProfile) await state.holdProfile
        return route.fulfill({ json: { user: { ...user, ...data } } })
      }
      if (method === 'PUT' && url.pathname.endsWith('/avatar')) return route.fulfill({ json: { user: { ...user, avatar: base + '/fixture-avatar.png' } } })
      return route.fulfill({ json: { success: true, messages: [] } })
    }
    if (url.origin !== base) return route.abort()
    if (url.pathname === '/fixture-avatar.png') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>' })
    return route.continue()
  })
  await page.goto(base + '/__batch5.html' + (settings ? '?settings' : ''), { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (settings && user) await expect(page.getByRole('heading', { name: translations[language].settingsPage.appearanceTitle, exact: true })).toBeVisible()
  else await expect(page.getByText(settings ? 'Login fixture' : 'Public fixture', { exact: true })).toBeVisible()
  return { page, state }
}

test('privacy acknowledgement uses the canonical key and survives reload; no category controls', async t => {
  const { page } = await setup(t)
  const p = translations.en.privacyBanner
  await expect(page.getByRole('button', { name: p.accept, exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.screenshot({ path: join(screenshots, 'privacy-desktop.png') })
  await page.getByRole('button', { name: p.accept, exact: true }).click()
  await expect(page.getByRole('button', { name: p.accept, exact: true })).toHaveCount(0)
  assert.equal(await page.evaluate(() => localStorage.getItem('vk_privacy_ack')), '1')
  await page.reload()
  await expect(page.getByText('Public fixture', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: p.accept, exact: true })).toHaveCount(0)
})

test('privacy remains usable when acknowledgement storage is blocked', async t => {
  const { page } = await setup(t, { blockedStorage: true, role: null })
  await page.getByRole('button', { name: translations.en.privacyBanner.accept, exact: true }).click()
  await expect(page.getByRole('button', { name: translations.en.privacyBanner.accept, exact: true })).toHaveCount(0)
  await page.evaluate(() => window.batch5Navigate('/contact'))
  await expect(page.getByRole('button', { name: translations.en.privacyBanner.accept, exact: true })).toHaveCount(0)
})

test('policy reader scrolls while close controls stay visible and Escape restores focus', async t => {
  const { page } = await setup(t, { height: 480 })
  const opener = page.getByRole('button', { name: translations.en.privacyBanner.learnMore, exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: translations.en.privacyPolicy.title })
  const controls = dialog.getByRole('button', { name: translations.en.privacyPolicy.close, exact: true })
  await expect(controls.first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(controls.last()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(controls.first()).toBeFocused()
  const scroll = dialog.locator('div.overflow-y-auto')
  await expect(scroll).toHaveCSS('scrollbar-width', 'thin')
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight })
  assert.ok(await scroll.evaluate(el => el.scrollTop > 0))
  await expect(controls.first()).toBeInViewport()
  await expect(controls.last()).toBeInViewport()
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  await page.screenshot({ path: join(screenshots, 'privacy-policy-desktop.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  assert.equal(await page.evaluate(() => localStorage.getItem('vk_privacy_ack')), null, 'closing policy is not acknowledgement')
})

test('privacy stays localized in six languages, follows RTL, and suppresses the admin banner', async t => {
  const { page } = await setup(t, { width: 390, height: 700 })
  for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    await page.evaluate(lang => window.batch5SetLanguage(lang), lang)
    await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr')
    await expect(page.getByRole('button', { name: translations[lang].privacyBanner.accept, exact: true })).toBeVisible()
  }
  await page.screenshot({ path: join(screenshots, 'privacy-mobile-urdu.png') })
  await page.getByRole('button', { name: translations.ur.privacyBanner.learnMore, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: translations.ur.privacyPolicy.title })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: join(screenshots, 'privacy-policy-mobile-urdu.png') })
  await dialog.getByRole('button', { name: translations.ur.privacyPolicy.close, exact: true }).last().click()
  await page.evaluate(() => window.batch5Navigate('/admin/dashboard'))
  await expect(page.getByRole('button', { name: translations.ur.privacyBanner.accept, exact: true })).toHaveCount(0)
  await page.evaluate(() => window.batch5Navigate('/'))
  await expect(page.getByRole('button', { name: translations.ur.privacyBanner.accept, exact: true })).toBeVisible()
})

test('settings uses six complete dictionaries, associated field labels and honest support actions', async t => {
  const { page } = await setup(t, { settings: true })
  for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    const s = translations[lang].settingsPage
    await page.evaluate(lang => window.batch5SetLanguage(lang), lang)
    for (const key of ['appearanceTitle', 'profileInfoTitle', 'changePasswordTitle', 'accountDetailsTitle', 'quickLinksTitle', 'sessionTitle', 'accountRemovalTitle']) {
      await expect(page.getByRole('heading', { name: s[key], exact: true })).toBeVisible()
    }
    for (const key of ['fullName', 'emailAddress', 'currentPassword', 'newPassword', 'confirmNewPassword']) await expect(page.getByLabel(s[key], { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: s.saveChanges, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: s.agentPanel, exact: true })).toHaveAttribute('href', '/agent/dashboard')
    await expect(page.getByRole('link', { name: s.contactSupport, exact: true })).toHaveAttribute('href', '/contact')
    await expect(page.getByText(s.accountRemovalDesc, { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr')
    await expect(page.locator('input[type=password]')).toHaveCount(3)
  }
  await page.evaluate(() => window.batch5SetLanguage('en'))
  await page.screenshot({ path: join(screenshots, 'settings-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 800 })
  for (const lang of ['de', 'ar', 'ur']) {
    await page.evaluate(lang => window.batch5SetLanguage(lang), lang)
    await expect(page.getByRole('heading', { name: translations[lang].settingsPage.profileInfoTitle, exact: true })).toBeVisible()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), lang + ' has no horizontal page overflow')
    const privacyLink = page.getByRole('link', { name: translations[lang].privacyPolicy.title, exact: true })
    assert.ok(await privacyLink.evaluate(el => el.scrollWidth <= el.clientWidth + 1), lang + ' privacy link fits its card')
    await page.screenshot({ path: join(screenshots, 'settings-mobile-' + lang + '.png'), fullPage: true })
  }
  await page.getByRole('link', { name: translations.ur.privacyPolicy.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: translations.ur.privacyPolicy.title, exact: true })).toBeVisible()
})

test('settings localized save states retain profile and password API payloads', async t => {
  const { page, state } = await setup(t, { settings: true, language: 'tr' })
  const s = translations.tr.settingsPage
  let release
  state.holdProfile = new Promise(resolve => { release = resolve })
  await page.getByLabel(s.fullName, { exact: true }).fill('Updated Fixture')
  await page.getByRole('button', { name: s.saveChanges, exact: true }).click()
  await expect(page.getByRole('button', { name: s.saving, exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('button', { name: s.saveChanges, exact: true })).toBeEnabled()
  assert.deepEqual(state.calls.find(c => c.path.endsWith('/profile')).data, { name: 'Updated Fixture', email: 'fixture@example.test' })
  await expect(page.getByText(s.toastProfileUpdated, { exact: true })).toBeVisible()
  await page.getByLabel(s.currentPassword, { exact: true }).fill('fixture-current')
  await page.getByLabel(s.newPassword, { exact: true }).fill('fixture-new')
  await page.getByLabel(s.confirmNewPassword, { exact: true }).fill('mismatch')
  await page.getByRole('button', { name: s.updatePassword, exact: true }).click()
  await expect(page.getByText(s.toastPasswordMismatch, { exact: true })).toBeVisible()
  assert.ok(!state.calls.some(c => c.path.endsWith('/password')))
  await page.getByLabel(s.confirmNewPassword, { exact: true }).fill('fixture-new')
  await page.getByRole('button', { name: s.updatePassword, exact: true }).click()
  await expect(page.getByLabel(s.currentPassword, { exact: true })).toHaveValue('')
  assert.deepEqual(state.calls.find(c => c.path.endsWith('/password')).data, { currentPassword: 'fixture-current', newPassword: 'fixture-new', confirmPassword: 'fixture-new' })
})

test('settings retains eight canonical themes and paginated AI history with delete controls', async t => {
  const { page, state } = await setup(t, { settings: true })
  const themes = page.locator('button[aria-pressed]')
  await expect(themes).toHaveCount(8)
  await themes.nth(3).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'navy')
  assert.equal(await page.evaluate(() => localStorage.getItem('vk_theme')), 'navy')
  await expect.poll(() => state.calls.some(c => c.path.endsWith('/theme') && c.data?.theme === 'navy')).toBe(true)
  await expect(page.getByText('First saved AI chat', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: translations.en.aiChatHistory.loadMore, exact: true }).click()
  await expect(page.getByText('Second saved AI chat', { exact: true })).toBeVisible()
  await expect(page.getByText('First saved AI chat', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: translations.en.aiChatHistory.open, exact: true })).toHaveCount(2)
  await expect(page.getByRole('button', { name: translations.en.aiChatHistory.clearAll, exact: true })).toBeVisible()
  assert.ok(state.calls.some(c => c.path.endsWith('/chat/conversations') && c.search.includes('page=2')))
})

test('anonymous settings stays protected and does not render account controls or call account APIs', async t => {
  const { page, state } = await setup(t, { settings: true, role: null })
  await expect(page.getByRole('heading', { name: 'Login fixture' })).toBeVisible()
  await expect(page.getByRole('heading', { name: translations.en.settingsPage.profileInfoTitle, exact: true })).toHaveCount(0)
  assert.equal(state.calls.length, 0)
})
