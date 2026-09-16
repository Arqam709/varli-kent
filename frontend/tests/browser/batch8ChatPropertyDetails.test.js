// Batch 8: AI chatbot + property details, real browser with local API fixtures.
// Run from frontend: node --test tests/browser/batch8ChatPropertyDetails.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'
import translations from '../../src/locales/translations.js'
import { applyBatch8Mutation } from '../batch8Mutations.js'

let server, browser, base
const screenshots = join(tmpdir(), 'varlikent-batch8-visuals')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Routes,Route,useParams,useNavigate} from 'react-router-dom';
import {LanguageProvider} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx'; import {ThemeProvider} from '/src/contexts/ThemeContext.jsx';
import {FavouritesProvider} from '/src/contexts/FavouritesContext.jsx'; import {ChatProvider} from '/src/contexts/ChatContext.jsx';
import AIChatbot from '/src/components/AIChatbot.jsx'; import PropertyDetailsPage from '/src/pages/PropertyDetailsPage.jsx'; import '/src/index.css';
const e=React.createElement, q=new URLSearchParams(location.search), chat=q.get('mode')==='chat';
function Detail(){const {id}=useParams();return e('p',null,'Detail route '+id)}
function Nav(){window.batch8Navigate=useNavigate();return null}
const routes=chat
  ? e(Routes,null,e(Route,{path:'/properties',element:e('p',null,'Listings fixture')}),e(Route,{path:'/properties/:id',element:e(Detail)}))
  : e(Routes,null,e(Route,{path:'/properties/:id',element:e(PropertyDetailsPage)}),e(Route,{path:'*',element:e('p',null,'Other route')}));
createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:[chat?'/properties':'/properties/'+q.get('id')]},e(LanguageProvider,null,e(AuthProvider,null,e(ThemeProvider,null,e(FavouritesProvider,null,e(ChatProvider,null,e(Nav),routes,chat?e(AIChatbot):null)))))));
</script></body></html>`

before(async () => {
  await mkdir(screenshots, { recursive: true })
  server = await createServer({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'batch8-fixture', enforce: 'pre', async load(id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/index.css')) return (await readFile(id, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
      if (env.BATCH8_MUTATION && /\/src\/(components\/AIChatbot|components\/PropertyMapView|contexts\/ChatContext|pages\/PropertyDetailsPage)\.jsx$/.test(path)) {
        return applyBatch8Mutation(env.BATCH8_MUTATION, path, await readFile(id, 'utf8'))
      }
    }, configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__batch8.html') || req.url.includes('html-proxy')) return next()
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__batch8.html', html)) } catch (error) { next(error) }
      })
    } }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

const svg = (fill) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${fill}"/></svg>`)
const IMAGES = [svg('#6b8f71'), svg('#b07d62'), svg('#50698a')]
const listing = (id, title, extra = {}) => ({
  _id: id, title, district: 'Sariyer', address: 'Yenikoy neighbourhood', listingType: 'Sale', status: 'Available',
  propertyType: 'Villa', price: 950000, currency: 'USD', beds: 4, baths: 3, sqm: 320, images: IMAGES,
  description: 'A long fixture description. '.repeat(40), rooms: '4+1', floor: 0, sauna: true, nearbyTransport: ['Metro'],
  agent: { _id: 'agent-1', name: 'Agent Ayse' }, hasVirtualTour: true, virtualTourUrl: 'https://my.matterport.com/show/?m=fixture', ...extra,
})
// Simulates an API regression: approximate AND carrying the stored pin. The page must still fail closed.
const LEAK_LAT = 41.17173, LEAK_LNG = 29.05129
const PROPERTIES = {
  approx: listing('approx', 'Private Garden Villa', { location: { isApproximate: true, approxRadiusKm: 3, lat: LEAK_LAT, lng: LEAK_LNG } }),
  exact: listing('exact', 'Bosphorus View Flat', { location: { lat: 41.0082, lng: 28.9784, isApproximate: false } }),
  slow: listing('slow', 'Slow Listing'),
  fast: listing('fast', 'Fast Listing'),
}
const CARD = (id, title) => ({ _id: id, title, district: 'Kadikoy', propertyType: 'Apartment', listingType: 'Sale', beds: 2, baths: 1, sqm: 95, priceLabel: '$250,000', mainImage: IMAGES[0], matchReason: '2 bedrooms in Kadikoy' })

async function setup(t, { mode = 'chat', id = '', language = 'en', theme = 'default', loggedIn = true, viewport = { width: 1280, height: 860 } } = {}) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const actor = { _id: 'buyer', name: 'Buyer Fixture', email: 'buyer@example.test', role: 'user', permissions: [], isActive: true, themePreference: theme }
  const state = {
    calls: [], requests: [], chatDelay: 0, chatFail: false, delays: {},
    conversations: [
      { _id: 'conv-1', messageCount: 2, lastActivityAt: new Date().toISOString(), lastMessage: { text: 'Saved kitchen question' } },
      { _id: 'conv-2', messageCount: 2, lastActivityAt: new Date().toISOString(), lastMessage: { text: 'Saved balcony question' } },
    ],
  }
  await page.addInitScript(({ actor, language, theme, loggedIn }) => {
    localStorage.setItem('vk_lang', language)
    localStorage.setItem('vk_theme', theme)
    if (loggedIn) { localStorage.setItem('varlikent_token', 'fixture-token'); localStorage.setItem('varlikent_user', JSON.stringify(actor)) }
  }, { actor, language, theme, loggedIn })
  await page.route('**/*', async (route) => {
    const r = route.request(), url = new URL(r.url())
    state.requests.push(r.url())
    const reply = (options) => route.fulfill(options).catch(() => {})
    const at = url.pathname.indexOf('/api/')
    if (at === -1) return url.origin === base ? route.continue().catch(() => {}) : route.abort().catch(() => {})
    const path = url.pathname.slice(at + 4), method = r.method()
    let data = null
    try { data = r.postDataJSON() } catch { data = null }
    state.calls.push({ path, method, data })
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    if (path === '/auth/me') return reply({ json: { user: actor } })
    if (path === '/users/favourites' && method === 'GET') return reply({ json: { favourites: [] } })
    if (path.startsWith('/users/favourites/')) return reply({ json: { success: true } })
    if (path === '/chat' && method === 'POST') {
      if (state.chatDelay) await wait(state.chatDelay)
      if (state.chatFail) return reply({ status: 500, json: { message: 'Fixture outage' } })
      const n = state.calls.filter((c) => c.path === '/chat').length
      return reply({ json: { reply: 'Fixture reply ' + n, properties: [n === 1 ? CARD('p1', 'Fixture Flat') : CARD('p2', 'Second Flat')], parsed: { listingType: 'Sale', district: 'Kadikoy', beds: 2 }, conversationId: 'conv-live' } })
    }
    if (path === '/chat/conversations' && method === 'GET') return reply({ json: { conversations: state.conversations, pagination: { page: 1, totalPages: 1, totalCount: state.conversations.length } } })
    if (path === '/chat/conversations' && method === 'DELETE') { state.conversations = []; return reply({ json: { success: true, deletedCount: 2 } }) }
    if (path.startsWith('/chat/conversations/') && method === 'DELETE') { const cid = path.split('/').pop(); state.conversations = state.conversations.filter((c) => c._id !== cid); return reply({ json: { success: true } }) }
    if (path.startsWith('/chat/conversations/') && method === 'GET') return reply({ json: { conversation: { _id: path.split('/').pop() }, messages: [{ role: 'user', text: 'Saved balcony question' }, { role: 'assistant', text: 'Saved answer', properties: [] }] } })
    if (path.startsWith('/properties/') && method === 'GET') {
      const pid = path.split('/')[2]
      if (state.delays[pid]) await wait(state.delays[pid])
      return PROPERTIES[pid] ? reply({ json: { property: PROPERTIES[pid] } }) : reply({ status: 404, json: { message: 'Not found' } })
    }
    if (path === '/properties' && method === 'GET') return reply({ json: { properties: [] } })
    return reply({ json: { success: true } })
  })
  await page.goto(`${base}/__batch8.html?mode=${mode}&id=${id}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  return { page, state, errors }
}
const snap = (page, name) => page.screenshot({ path: join(screenshots, name + '.png') })
const toggle = (page) => page.locator('button.fixed.bottom-6')
const panel = (page) => page.locator('div.fixed.bottom-6')
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

/* ═══════════════ AI CHATBOT ═══════════════ */

test('chat send flow, property cards and Show More context', async (t) => {
  const { page, state, errors } = await setup(t)
  const c = translations.en.chatbot
  await toggle(page).click({ timeout: 90000 })
  const input = panel(page).locator('input')
  const send = panel(page).getByRole('button', { name: c.actions.send, exact: true })
  state.chatDelay = 700
  await input.fill('2 bed in Kadikoy'); await send.click()
  await expect(panel(page).getByText(c.thinking, { exact: true })).toBeVisible()
  await expect(panel(page).getByText('Fixture Flat', { exact: true })).toBeVisible()
  await expect(panel(page).getByText('Fixture reply 1', { exact: true })).toBeVisible()
  state.chatDelay = 0
  await input.fill('show more'); await send.click()
  await expect(panel(page).getByText('Second Flat', { exact: true })).toBeVisible()
  const posts = state.calls.filter((call) => call.path === '/chat')
  assert.equal(posts.length, 2)
  assert.equal(posts[1].data.pageKey, 'properties')
  assert.deepEqual(posts[1].data.shownPropertyIds, ['p1'])
  assert.deepEqual(posts[1].data.lastShownProperties, [{ _id: 'p1', title: 'Fixture Flat' }])
  assert.deepEqual(posts[1].data.currentFilters, { listingType: 'Sale', district: 'Kadikoy', beds: 2 })
  assert.equal(posts[1].data.conversationId, 'conv-live')
  assert.ok(posts[1].data.history.some((m) => m.text === '2 bed in Kadikoy'))
  const messages = panel(page).locator('.vk-scroll-gold.space-y-4')
  await expect(messages).toHaveCSS('scrollbar-width', 'thin')
  await expect(panel(page).locator('.vk-scroll-gold.overflow-x-auto')).toHaveCSS('scrollbar-width', 'thin')
  await snap(page, 'chat-cards-desktop')
  assert.equal(state.calls.some((call) => /property-conversations|conversations\/.*messages|\/agent/.test(call.path)), false, 'AI chat touched human agent messaging')
  await panel(page).getByRole('link', { name: c.propertyCard.viewProperty }).first().click()
  await expect(page.getByText('Detail route p1', { exact: true })).toBeVisible()
  await expect(toggle(page)).toHaveCount(0)
  assert.deepEqual(errors, [])
})

test('chat error state keeps the conversation usable', async (t) => {
  const { page, state } = await setup(t)
  const c = translations.en.chatbot
  await toggle(page).click({ timeout: 90000 })
  state.chatFail = true
  await panel(page).locator('input').fill('anything in Besiktas')
  await panel(page).getByRole('button', { name: c.actions.send, exact: true }).click()
  await expect(panel(page).getByText(/could not connect to the property database/)).toBeVisible()
  await expect(panel(page).locator('input')).toBeEnabled()
  await expect(panel(page).getByText('anything in Besiktas', { exact: true })).toBeVisible()
})

test('chat history and deletion work without runtime errors', async (t) => {
  const { page, state, errors } = await setup(t, { viewport: { width: 390, height: 760 } })
  const c = translations.en.chatbot
  await toggle(page).click({ timeout: 90000 })
  await panel(page).getByRole('button', { name: c.aria.openHistory, exact: true }).click()
  await expect(panel(page).getByText('Saved kitchen question', { exact: true })).toBeVisible()
  await expect(panel(page).locator('.vk-scroll-gold.overflow-x-hidden')).toHaveCSS('scrollbar-width', 'thin')
  await panel(page).getByRole('button', { name: /Saved balcony question/ }).first().click()
  await expect(panel(page).getByText('Saved answer', { exact: true })).toBeVisible()
  await panel(page).getByRole('button', { name: c.aria.openHistory, exact: true }).click()
  await panel(page).getByRole('button', { name: `${c.aria.deleteConversation}: Saved kitchen question`, exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(c.history.confirmDeleteOne)
  await snap(page, 'chat-delete-confirm-mobile')
  await dialog.getByRole('button', { name: c.actions.cancel, exact: true }).click()
  assert.equal(state.calls.some((call) => call.method === 'DELETE'), false)
  await panel(page).getByRole('button', { name: `${c.aria.deleteConversation}: Saved kitchen question`, exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: c.actions.delete, exact: true }).click()
  await expect.poll(() => state.calls.some((call) => call.method === 'DELETE' && call.path === '/chat/conversations/conv-1')).toBe(true)
  await expect(panel(page).getByText('Saved kitchen question', { exact: true })).toHaveCount(0)
  await expect(panel(page).getByText('Saved balcony question', { exact: true })).toBeVisible()
  await panel(page).getByRole('button', { name: c.aria.deleteAllConversations, exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: c.actions.delete, exact: true }).click()
  await expect.poll(() => state.calls.some((call) => call.method === 'DELETE' && call.path === '/chat/conversations')).toBe(true)
  await expect(panel(page).getByText(c.history.empty, { exact: true })).toBeVisible()
  await panel(page).getByRole('button', { name: c.aria.backToChat, exact: true }).click()
  await expect(panel(page).getByText('Saved answer', { exact: true })).toHaveCount(0)
  assert.deepEqual(errors, [])
})

test('chat direction follows the six languages', async (t) => {
  for (const language of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    const rtl = ['ar', 'ur'].includes(language)
    const { page } = await setup(t, { language, viewport: rtl ? { width: 390, height: 760 } : { width: 1280, height: 860 } })
    await toggle(page).click({ timeout: 90000 })
    await expect(panel(page)).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr')
    await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr')
    await expect(panel(page).getByRole('button', { name: translations[language].chatbot.actions.send, exact: true })).toBeVisible()
    const box = await panel(page).boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= (rtl ? 390 : 1280) + 1, `${language} panel overflows the viewport`)
    if (rtl) await snap(page, 'chat-rtl-mobile-' + language)
  }
})

test('anonymous visitors get no chatbot and no chat calls', async (t) => {
  const { page, state } = await setup(t, { loggedIn: false })
  await expect(page.getByText('Listings fixture', { exact: true })).toBeVisible({ timeout: 90000 })
  await page.waitForTimeout(800)
  await expect(toggle(page)).toHaveCount(0, { timeout: 2000 })
  assert.equal(state.calls.some((call) => call.path.startsWith('/chat')), false)
})

test('chat fills use the theme brand token', async (t) => {
  const { page } = await setup(t, { theme: 'blush-ivory' })
  const brand = rgb('#9C5770')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blush-ivory', { timeout: 90000 })
  await expect(toggle(page)).toHaveCSS('background-color', brand)
  await toggle(page).click()
  await panel(page).locator('input').fill('villa with pool')
  await panel(page).getByRole('button', { name: translations.en.chatbot.actions.send, exact: true }).click()
  await expect(panel(page).getByText('villa with pool', { exact: true }).locator('..')).toHaveCSS('background-color', brand)
  await expect(panel(page).getByRole('link', { name: translations.en.chatbot.propertyCard.viewProperty })).toHaveCSS('background-color', brand)
  await snap(page, 'chat-blush-ivory')
})

/* ═══════════════ PROPERTY DETAILS ═══════════════ */

test('approximate listing never renders a map or coordinates', async (t) => {
  const { page, state, errors } = await setup(t, { mode: 'details', id: 'approx' })
  const pd = translations.en.propertyDetails
  await expect(page.getByRole('heading', { name: 'Private Garden Villa', level: 1 })).toBeVisible({ timeout: 90000 })
  await expect(page.getByText(pd.approximateLocation, { exact: true })).toBeVisible()
  await expect(page.getByText(new RegExp(`${pd.approximateRadius}: 3`))).toBeVisible()
  await page.waitForTimeout(600)
  await expect(page.locator('.leaflet-container')).toHaveCount(0, { timeout: 2000 })
  const body = await page.locator('body').innerText()
  assert.equal(body.includes(String(LEAK_LAT)) || body.includes(String(LEAK_LNG)), false)
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
  assert.ok(jsonLd.includes('Private Garden Villa'))
  assert.equal(/geo|latitude|longitude|41\.17|29\.05/i.test(jsonLd), false, 'structured data leaks location')
  assert.equal(state.requests.some((u) => u.includes('41.17') || u.includes('29.05') || /tile\.openstreetmap/.test(u)), false)
  assert.deepEqual([...new Set(state.calls.map((call) => call.path))].sort(), ['/auth/me', '/properties', '/properties/approx', '/users/favourites'])
  await snap(page, 'details-approximate-desktop')
  assert.deepEqual(errors, [])
})

test('exact listing: map, gallery, agent, favourites and virtual tour', async (t) => {
  const { page, state, errors } = await setup(t, { mode: 'details', id: 'exact' })
  const pd = translations.en.propertyDetails
  await expect(page.getByRole('heading', { name: 'Bosphorus View Flat', level: 1 })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await expect(page.getByText('Listed by', { exact: true })).toBeVisible()
  await expect(page.getByText('Agent Ayse', { exact: true })).toBeVisible()
  const main = page.locator('img.h-96')
  await expect(main).toHaveAttribute('src', IMAGES[0])
  await page.getByRole('button').filter({ has: page.getByAltText('Bosphorus View Flat — photo 2') }).click()
  await expect(main).toHaveAttribute('src', IMAGES[1])
  await expect(page.locator('.vk-scroll-gold.overflow-x-auto')).toHaveCSS('scrollbar-width', 'thin')
  await expect(page.getByRole('link', { name: pd.viewVirtualTour })).toHaveAttribute('href', 'https://my.matterport.com/show/?m=fixture')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.calls.some((call) => call.method === 'POST' && call.path === '/users/favourites/exact')).toBe(true)
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await snap(page, 'details-exact-desktop')
  assert.deepEqual(errors, [])
})

test('property details header follows theme and mobile RTL layout', async (t) => {
  for (const [language, theme, viewport] of [['en', 'navy', { width: 1280, height: 860 }], ['ur', 'navy', { width: 390, height: 860 }], ['ar', 'blush-ivory', { width: 390, height: 860 }]]) {
    const { page } = await setup(t, { mode: 'details', id: 'exact', language, theme, viewport })
    await expect(page.getByRole('heading', { name: 'Bosphorus View Flat', level: 1 })).toBeVisible({ timeout: 90000 })
    const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('div.pt-24.pb-8')).toHaveCSS('background-color', rgb(await token('--vk-section-dark')))
    await expect(page.locator('div.min-h-screen.pb-16')).toHaveCSS('background-color', rgb(await token('--vk-section-light-alt')))
    await expect(page.getByRole('heading', { name: 'Bosphorus View Flat', level: 1 })).toHaveCSS('color', rgb(await token('--vk-text-on-dark')))
    await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(language) ? 'rtl' : 'ltr')
    await expect(page.locator('.vk-scroll-gold.overflow-x-auto')).toHaveCSS('scrollbar-width', 'thin')
    await snap(page, `details-${theme}-${language}-${viewport.width}`)
    if (viewport.width === 390) await page.getByText('Agent Ayse', { exact: true }).scrollIntoViewIfNeeded()
  }
})

test('a slow earlier property response cannot overwrite a newer one', async (t) => {
  const { page, state } = await setup(t, { mode: 'details', id: 'slow' })
  state.delays.slow = 2500
  await page.waitForFunction(() => typeof window.batch8Navigate === 'function', null, { timeout: 90000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.batch8Navigate === 'function')
  await page.evaluate(() => window.batch8Navigate('/properties/fast'))
  await expect(page.getByRole('heading', { name: 'Fast Listing', level: 1 })).toBeVisible()
  await page.waitForTimeout(3200)
  await expect(page.getByRole('heading', { name: 'Fast Listing', level: 1 })).toBeVisible()
  await expect(page.getByText('Slow Listing')).toHaveCount(0)
})
