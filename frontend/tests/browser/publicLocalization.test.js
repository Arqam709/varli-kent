// Localization Phase 2 — public pages really render in the active language.
//
// Real pages in a real browser; every API call is answered here, nothing
// leaves the machine. Run from frontend/:
//   node --test tests/browser/publicLocalization.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import translations from '../../src/locales/translations.js'

let server
let browser
let base
const FIXTURE = '/__public-l10n.html'

// One harness, four screens (picked by ?screen=), plus a tiny language
// switcher so a test can change language WITHOUT reloading the page.
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LanguageProvider,useLanguage} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {FavouritesProvider} from '/src/contexts/FavouritesContext.jsx'; import {ToastContainer} from 'react-toastify';
import PropertyDetailsPage from '/src/pages/PropertyDetailsPage.jsx'; import ContactPage from '/src/pages/ContactPage.jsx';
import ResetPassword from '/src/pages/ResetPassword.jsx'; import Navbar from '/src/components/Navbar.jsx'; import '/src/index.css';
const e=React.createElement;
const Switcher=()=>{const {setLanguage}=useLanguage();return e('div',{id:'switcher'},['en','tr','ar','de','ru','ur'].map(l=>e('button',{key:l,id:'set-'+l,onClick:()=>setLanguage(l)},l)))};
const screen=new URLSearchParams(location.search).get('screen');
const entry={details:'/properties/p1',contact:'/contact',reset:'/reset-password?token=abc',resetNoToken:'/reset-password',navbar:'/'}[screen];
createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:[entry]},e(LanguageProvider,null,e(AuthProvider,null,e(FavouritesProvider,null,
  e(Switcher),e(ToastContainer),
  e(Routes,null,
    e(Route,{path:'/properties/:id',element:e(PropertyDetailsPage)}),
    e(Route,{path:'/contact',element:e(ContactPage)}),
    e(Route,{path:'/reset-password',element:e(ResetPassword)}),
    e(Route,{path:'/',element:e(Navbar)})))))));
</script></body></html>`

before(async () => {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'public-l10n-fixture',
      enforce: 'pre',
      async load(id) {
        if (id.replaceAll('\\', '/').endsWith('/src/index.css')) {
          return (await readFile(id, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
        }
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith(FIXTURE) || req.url.includes('html-proxy')) return next()
          try {
            res.setHeader('Content-Type', 'text/html')
            res.end(await vite.transformIndexHtml(FIXTURE, html))
          } catch (error) {
            next(error)
          }
        })
      },
    }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
  await server?.close()
})

const PROPERTY = {
  _id: 'p1',
  title: 'Bosphorus Villa',
  district: 'Sarıyer',
  address: 'Yalı Caddesi 5',
  listingType: 'Sale',
  propertyType: 'Villa',
  status: 'Available',
  price: 4500000,
  beds: 5,
  baths: 4,
  sqm: 420,
  images: [],
  description: '',
  agentEmail: 'agent@example.test',
  agentPhone: '+90 555 000 0000',
  agentName: 'Fixture Agent',
}

async function open(t, screen, { language = 'tr', resetReply } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  page.on('pageerror', (error) => console.error('Fixture page error:', error.message))

  await page.addInitScript((lang) => {
    localStorage.setItem('vk_lang', lang)
    localStorage.setItem('vk_lang_explicit', '1')
    localStorage.setItem('vk_lang_default_migrated', '1')
  }, language)

  const calls = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort()
    const path = url.pathname.split('/api')[1]
    calls.push({ path, method: route.request().method() })

    if (path === '/properties/p1') return route.fulfill({ json: { success: true, property: PROPERTY } })
    if (path === '/properties') return route.fulfill({ json: { success: true, properties: [] } })
    if (path.startsWith('/page-content/')) return route.fulfill({ json: { fields: {}, sections: {} } })
    if (path === '/auth/reset-password') {
      return route.fulfill(resetReply || { status: 200, json: { success: true } })
    }
    return route.fulfill({ json: { success: true } })
  })

  await page.goto(`${base}${FIXTURE}?screen=${screen}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  return { page, calls }
}

const fill = (template, values) => Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, v), template)

// ── Property details ─────────────────────────────────────────────────────
test('property details renders its interface in Turkish, leaving raw enum values for Phase 4', async (t) => {
  const { page } = await open(t, 'details')
  const tr = translations.tr
  const pd = tr.propertyDetails

  await expect(page.getByRole('heading', { name: pd.aboutTitle })).toBeVisible({ timeout: 45000 })

  for (const text of [pd.propertyTypeLabel, pd.listingTypeLabel, pd.districtLabel, pd.statusLabel, pd.price, pd.save, pd.callAgent, pd.emailAgent, tr.contactPage.formHeading, tr.nav.home, tr.nav.properties]) {
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByText(tr.propertyCard.forSale, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(pd.defaultDescription)).toBeVisible()
  await expect(page.getByText(`Yalı Caddesi 5, Sarıyer, ${tr.propertyCard.istanbul}`)).toBeVisible()
  await expect(page.getByPlaceholder(tr.contactPage.namePlaceholder)).toBeVisible()

  // 9–11. The enum VALUES are localized too (Phase 3); the data is not.
  const overview = page.locator('div.grid.grid-cols-2.gap-4.text-sm')
  for (const [label, value] of [
    [pd.propertyTypeLabel, tr.enums.propertyType.Villa],
    [pd.listingTypeLabel, tr.enums.listingType.Sale],
    [pd.statusLabel, tr.enums.propertyStatus.Available],
  ]) {
    await expect(overview.locator('div').filter({ hasText: label }).first()).toContainText(value)
  }
  assert.equal(tr.enums.propertyStatus.Available, 'Mevcut')
  assert.equal(tr.enums.listingType.Sale, 'Satılık')

  const body = await page.locator('body').innerText()
  for (const english of ['About This Property', 'Listed by', 'Email Agent', 'Call Agent', 'Send a Message', 'Property Type', 'Listing Type', 'Similar Properties', 'For Sale', 'Back to Listings', 'Available']) {
    assert.ok(!body.includes(english), `"${english}" still shown in Turkish`)
  }

  assert.equal(await page.title(), `${fill(tr.seo.propertyTitle, { title: 'Bosphorus Villa', district: 'Sarıyer' })} | VarliKent`)

  // Outgoing links speak Turkish too.
  const mailto = await page.getByRole('link', { name: pd.emailAgent }).getAttribute('href')
  assert.ok(decodeURIComponent(mailto).includes(fill(pd.emailSubject, { title: 'Bosphorus Villa' })), mailto)
})

test('property details: the document title follows a language change without reloading', async (t) => {
  const { page } = await open(t, 'details')
  await expect(page.getByRole('heading', { name: translations.tr.propertyDetails.aboutTitle })).toBeVisible({ timeout: 45000 })
  assert.match(await page.title(), /İstanbul \| VarliKent$/)

  for (const lang of ['de', 'ru', 'en']) {
    await page.click(`#set-${lang}`)
    const expected = `${fill(translations[lang].seo.propertyTitle, { title: 'Bosphorus Villa', district: 'Sarıyer' })} | VarliKent`
    await expect.poll(() => page.title()).toBe(expected)
    await expect(page.getByRole('heading', { name: translations[lang].propertyDetails.aboutTitle })).toBeVisible()
    // The status VALUE follows the language as well.
    await expect(page.getByText(translations[lang].enums.propertyStatus.Available, { exact: true }).first()).toBeVisible()
  }
})

test('property details: not-found state is translated', async (t) => {
  const page = await browser.newPage()
  t.after(() => page.close())
  await page.addInitScript(() => { localStorage.setItem('vk_lang', 'tr'); localStorage.setItem('vk_lang_explicit', '1') })
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort()
    return route.fulfill({ status: 404, json: { success: false } })
  })
  await page.goto(`${base}${FIXTURE}?screen=details`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  await expect(page.getByRole('heading', { name: translations.tr.propertyDetails.notFound })).toBeVisible({ timeout: 45000 })
  await expect(page.getByRole('link', { name: translations.tr.propertyDetails.backToListings })).toBeVisible()
  assert.equal(await page.title(), `${translations.tr.seo.propertyDetails} | VarliKent`)
})

// ── Contact ──────────────────────────────────────────────────────────────
test('contact page: office hours, labels and title are Turkish', async (t) => {
  const { page } = await open(t, 'contact')
  const c = translations.tr.contactPage

  await expect(page.getByText(c.officeHours, { exact: true })).toBeVisible({ timeout: 45000 })
  for (const text of [c.weekdays, c.saturday, c.sunday, c.closed, c.viewOnMaps, c.nameLabel, c.messageLabel, c.responseNotice]) {
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByPlaceholder(c.emailPlaceholder)).toBeVisible()
  assert.equal(await page.title(), `${translations.tr.seo.contact} | VarliKent`)

  const body = await page.locator('body').innerText()
  for (const english of ['Office Hours', 'Monday – Friday', 'Saturday', 'Sunday', 'View on Maps', 'Full Name', 'within 24 hours']) {
    assert.ok(!body.includes(english), `"${english}" still shown in Turkish`)
  }
})

// ── Reset password ───────────────────────────────────────────────────────
for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
  test(`reset password renders in ${lang}`, async (t) => {
    const { page } = await open(t, 'reset', { language: lang })
    const r = translations[lang].resetPasswordPage

    await expect(page.getByRole('heading', { name: r.title })).toBeVisible({ timeout: 45000 })
    await expect(page.getByLabel(r.newPassword)).toBeVisible()
    await expect(page.getByLabel(r.confirmPassword)).toBeVisible()
    await expect(page.getByRole('button', { name: r.resetButton })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr')
  })
}

test('reset password: validation and a server refusal are shown in Turkish, not the server\'s English', async (t) => {
  const { page } = await open(t, 'reset', {
    resetReply: { status: 400, json: { success: false, message: 'Reset link is invalid or has expired.' } },
  })
  const r = translations.tr.resetPasswordPage

  await expect(page.getByRole('heading', { name: r.title })).toBeVisible({ timeout: 45000 })
  await page.getByLabel(r.newPassword).fill('123')
  await page.getByLabel(r.confirmPassword).fill('123')
  await page.getByRole('button', { name: r.resetButton }).click()
  await expect(page.getByText(r.passwordTooShort)).toBeVisible()

  await page.getByLabel(r.newPassword).fill('longenough')
  await page.getByLabel(r.confirmPassword).fill('different1')
  await page.getByRole('button', { name: r.resetButton }).click()
  await expect(page.getByText(r.passwordMismatch)).toBeVisible()

  await page.getByLabel(r.confirmPassword).fill('longenough')
  await page.getByRole('button', { name: r.resetButton }).click()
  await expect(page.getByText(r.resetFailed)).toBeVisible()
  assert.ok(!(await page.locator('body').innerText()).includes('Reset link is invalid'), 'the server message is not shown')
})

test('reset password without a token shows the translated invalid-link screen', async (t) => {
  const { page } = await open(t, 'resetNoToken')
  const r = translations.tr.resetPasswordPage
  await expect(page.getByRole('heading', { name: r.invalidLinkTitle })).toBeVisible({ timeout: 45000 })
  await expect(page.getByText(r.invalidLinkBody)).toBeVisible()
  await expect(page.getByRole('link', { name: r.requestNewLink })).toBeVisible()
})

// ── Navbar ───────────────────────────────────────────────────────────────
test('navbar landmarks and the mobile language heading are translated', async (t) => {
  const { page } = await open(t, 'navbar')
  const a = translations.tr.accessibility

  await expect(page.getByRole('navigation', { name: a.mainNavigation })).toBeAttached({ timeout: 45000 })
  await expect(page.getByRole('link', { name: a.homeLink })).toBeAttached()

  await page.setViewportSize({ width: 390, height: 800 })
  await page.getByRole('button', { name: a.openMenu }).click()
  const drawer = page.getByRole('dialog', { name: a.navigationMenu })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(translations.tr.nav.language, { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: a.closeMenu })).toBeVisible()
})
