// Localization Phase 3 — enum values are LABELS in the interface and stay
// canonical everywhere else. Real pages in a real browser; every API call is
// answered here. Run from frontend/:
//   node --test tests/browser/enumLocalization.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import translations from '../../src/locales/translations.js'

let server
let browser
let base
const FIXTURE = '/__enum-l10n.html'

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LanguageProvider,useLanguage} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {FavouritesProvider} from '/src/contexts/FavouritesContext.jsx'; import {ToastContainer} from 'react-toastify';
import PropertiesPage from '/src/pages/PropertiesPage.jsx'; import AdminMessages from '/src/pages/AdminMessages.jsx';
import AgentPropertyCard from '/src/components/AgentPropertyCard.jsx'; import '/src/index.css';
const e=React.createElement;
const Switcher=()=>{const {setLanguage}=useLanguage();return e('div',{id:'switcher'},['en','tr','ar','de','ru','ur'].map(l=>e('button',{key:l,id:'set-'+l,onClick:()=>setLanguage(l)},l)))};
const AGENT_PROPERTY={_id:'a1',title:'Agent Fixture Listing',district:'Kadikoy',propertyType:'Warehouse',status:'Rented',listingType:'Rent',price:5000,images:[]};
window.__agentProperty=AGENT_PROPERTY;
const screen=new URLSearchParams(location.search).get('screen');
const entry={properties:'/properties',admin:'/admin/messages',agent:'/agent'}[screen];
createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:[entry]},e(LanguageProvider,null,e(AuthProvider,null,e(FavouritesProvider,null,
  e(Switcher),e(ToastContainer),
  e(Routes,null,
    e(Route,{path:'/properties',element:e(PropertiesPage)}),
    e(Route,{path:'/admin/messages',element:e(AdminMessages)}),
    e(Route,{path:'/agent',element:e(AgentPropertyCard,{property:AGENT_PROPERTY})})))))));
</script></body></html>`

before(async () => {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'enum-l10n-fixture',
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

const listing = (id, title, propertyType, listingType = 'Sale') => ({
  _id: id, title, district: 'Kadikoy', address: 'Fixture street', listingType, propertyType,
  status: 'Available', price: 250000, priceLabel: '$', beds: 2, baths: 1, sqm: 95, images: [],
})

const LISTINGS = [
  listing('p1', 'Apartment Fixture', 'Apartment'),
  listing('p2', 'Duplex Fixture', 'Duplex', 'Rent'),
]

async function open(t, screen, { language = 'tr', user = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  page.on('pageerror', (error) => console.error('Fixture page error:', error.message))

  await page.addInitScript(({ lang, user }) => {
    localStorage.setItem('vk_lang', lang)
    localStorage.setItem('vk_lang_explicit', '1')
    localStorage.setItem('vk_lang_default_migrated', '1')
    if (user) {
      localStorage.setItem('varlikent_token', 'fixture-token')
      localStorage.setItem('varlikent_user', JSON.stringify(user))
    }
  }, { lang: language, user })

  const state = { calls: [], messages: [{ _id: 'm1', name: 'Lead Fixture', email: 'lead@example.test', phone: '1', interestType: 'Buying', message: 'Fixture message', status: 'New', createdAt: '2026-09-01T10:00:00Z' }] }
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort()
    const path = url.pathname.split('/api')[1]
    let data = null
    try { data = request.postDataJSON() } catch { data = null }
    state.calls.push({ path, method: request.method(), query: Object.fromEntries(url.searchParams), data })

    if (path === '/auth/me') return route.fulfill({ json: { user } })
    if (path === '/properties/areas') return route.fulfill({ json: { areas: [{ district: 'Kadikoy', count: 2 }] } })
    if (path === '/properties') {
      const type = url.searchParams.get('propertyType')
      const list = type ? LISTINGS.filter((p) => p.propertyType === type) : LISTINGS
      return route.fulfill({ json: { properties: list, count: list.length } })
    }
    if (path === '/contact' && request.method() === 'GET') return route.fulfill({ json: { submissions: state.messages } })
    if (/^\/contact\/[^/]+\/status$/.test(path)) return route.fulfill({ json: { success: true } })
    return route.fulfill({ json: { success: true } })
  })

  await page.goto(`${base}${FIXTURE}?screen=${screen}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  return { page, state }
}

const tr = translations.tr.enums

// The PropertyCard root: the group container holding this listing's title.
const cardFor = (page, title) => page.locator('div.group.relative.flex.flex-col').filter({ has: page.getByText(title, { exact: true }) }).first()

// ── 5/6. PropertyCard ────────────────────────────────────────────────────
test('5. property cards show the Turkish property type', async (t) => {
  const { page } = await open(t, 'properties')

  await expect(page.getByText('Apartment Fixture', { exact: true })).toBeVisible({ timeout: 45000 })
  await expect(cardFor(page, 'Apartment Fixture')).toContainText(tr.propertyType.Apartment)
  await expect(cardFor(page, 'Duplex Fixture')).toContainText(tr.propertyType.Duplex)

  const text = await page.locator('body').innerText()
  assert.ok(!/\bAPARTMENT\b|\bApartment\b/.test(text.replace('Apartment Fixture', '')), 'no raw "Apartment" label in Turkish')
})

// ── 7/8. Filters: Turkish labels, canonical values ───────────────────────
test('7/8. the type filter shows Turkish labels but keeps the canonical values', async (t) => {
  const { page } = await open(t, 'properties')
  await expect(page.getByText('Apartment Fixture', { exact: true })).toBeVisible({ timeout: 45000 })

  const options = await page.locator('#desktop-propertyType option').evaluateAll((els) => els.map((o) => ({ value: o.value, label: o.textContent })))
  const typed = options.filter((o) => o.value !== '')
  assert.deepEqual(typed.map((o) => o.value), ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm'])
  for (const option of typed) assert.equal(option.label, tr.propertyType[option.value], `${option.value} label`)
  assert.equal(options.find((o) => o.value === 'Apartment').label, 'Daire')
})

test('8. choosing a Turkish label sends the canonical value to the API', async (t) => {
  const { page, state } = await open(t, 'properties')
  await expect(page.getByText('Apartment Fixture', { exact: true })).toBeVisible({ timeout: 45000 })

  await page.locator('#desktop-propertyType').selectOption({ label: tr.propertyType.Duplex })

  await expect.poll(() => state.calls.some((c) => c.path === '/properties' && c.query.propertyType)).toBe(true)
  const filtered = state.calls.filter((c) => c.path === '/properties' && c.query.propertyType)
  assert.ok(filtered.every((c) => c.query.propertyType === 'Duplex'), JSON.stringify(filtered.map((c) => c.query)))
  assert.ok(!state.calls.some((c) => JSON.stringify(c.query).includes(tr.propertyType.Duplex)), 'the Turkish word never reaches the API')
  await expect(page.getByText('Duplex Fixture', { exact: true })).toBeVisible()
  await expect(page.getByText('Apartment Fixture', { exact: true })).toHaveCount(0)
})

// ── 15. Switching language changes the label, not the data ───────────────
test('15. switching language relabels enums without touching the values', async (t) => {
  const { page, state } = await open(t, 'properties')
  await expect(page.getByText('Apartment Fixture', { exact: true })).toBeVisible({ timeout: 45000 })
  const card = () => cardFor(page, 'Apartment Fixture')
  const apartmentOption = page.locator('#desktop-propertyType option[value="Apartment"]')

  for (const lang of ['en', 'de', 'ru', 'ar', 'ur', 'tr']) {
    await page.click(`#set-${lang}`)
    const label = translations[lang].enums.propertyType.Apartment
    await expect(card()).toContainText(label)
    await expect(apartmentOption).toHaveText(label)
    await expect(apartmentOption).toHaveAttribute('value', 'Apartment')
  }
  // Relabelling is presentation only — it caused no request and no new value.
  assert.ok(!state.calls.some((c) => c.path === '/properties' && c.query.propertyType))
})

// ── 13. AgentPropertyCard ────────────────────────────────────────────────
test('13. the agent property card shows localized type and status', async (t) => {
  const { page } = await open(t, 'agent')
  await expect(page.getByText('Agent Fixture Listing', { exact: true })).toBeVisible({ timeout: 45000 })
  await expect(page.getByText(tr.propertyStatus.Rented, { exact: true })).toBeVisible()
  await expect(page.getByText(`Kadikoy · ${tr.propertyType.Warehouse}`)).toBeVisible()

  await page.click('#set-en')
  await expect(page.getByText('Rented', { exact: true })).toBeVisible()
  await expect(page.getByText('Kadikoy · Warehouse')).toBeVisible()

  // The status colour still keys off the canonical value.
  const badge = page.getByText('Rented', { exact: true })
  await expect(badge).toHaveClass(/bg-blue-100/)
  assert.deepEqual(await page.evaluate(() => ({ type: window.__agentProperty.propertyType, status: window.__agentProperty.status })), { type: 'Warehouse', status: 'Rented' })
})

// ── 14. Admin "Marked as {status}" ───────────────────────────────────────
test('14. the admin status toast and badge use the localized contact status', async (t) => {
  const owner = { _id: 'owner', name: 'Owner Fixture', email: 'owner@example.test', role: 'owner', permissions: [], isActive: true }
  const { page, state } = await open(t, 'admin', { user: owner })
  const p = translations.tr.adminPages.messages

  await expect(page.getByText('Fixture message')).toBeVisible({ timeout: 45000 })
  await expect(page.getByText(tr.contactStatus.New, { exact: true }).last()).toBeVisible()

  await page.getByRole('button', { name: p.markReplied, exact: true }).click()

  await expect(page.getByText(p.markedAs.replace('{status}', tr.contactStatus.Replied))).toBeVisible()
  assert.ok(!(await page.locator('body').innerText()).includes('Replied'), 'no raw "Replied" in Turkish')

  // The API still receives the canonical value.
  const patch = state.calls.find((c) => c.path === '/contact/m1/status')
  assert.deepEqual(patch.data, { status: 'Replied' })
})
