// Local browser fixtures only: no real accounts, uploads, writes or map requests.
import test, { before, after } from 'node:test'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import translations from '../../src/locales/translations.js'

let server, browser, base
const screenshots = join(tmpdir(), 'varlikent-batch9-visuals')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter,useNavigate} from 'react-router-dom';
import {LanguageProvider} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx'; import {ThemeProvider} from '/src/contexts/ThemeContext.jsx'; import {FavouritesProvider} from '/src/contexts/FavouritesContext.jsx';
import AdminProperties from '/src/pages/AdminProperties.jsx'; import PropertiesPage from '/src/pages/PropertiesPage.jsx'; import '/src/index.css';
const e=React.createElement; function Page(){window.batch9Navigate=useNavigate(); return e(location.pathname.includes('admin')?AdminProperties:PropertiesPage)}
createRoot(document.getElementById('root')).render(e(BrowserRouter,null,e(LanguageProvider,null,e(AuthProvider,null,e(ThemeProvider,null,e(FavouritesProvider,null,e(Page)))))));
</script></body></html>`

before(async () => {
  await mkdir(screenshots, { recursive: true })
  server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'batch9-fixture', enforce: 'pre', async load(id) {
      if (id.replaceAll('\\', '/').endsWith('/src/index.css')) return (await readFile(id, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
    }, configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__batch9') || req.url.includes('html-proxy')) return next()
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__batch9.html', html)) } catch (error) { next(error) }
      })
    },
  }] })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

const image = (color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${color}"/></svg>`)
const images = [image('#5c785b'), image('#b29970')]
const property = (id, extra = {}) => ({ _id: id, title: `Property ${id}`, listingType: 'Sale', price: 100, priceLabel: '$', district: 'Kadikoy', address: 'Fixture street', propertyType: 'Apartment', beds: 0, baths: 0, sqm: 100, images, mainImage: images[1], featured: true, status: 'Available', agent: 'agent-1', floor: 0, netSqm: 0, sauna: false, location: { isApproximate: true, approxRadiusKm: 3 }, ...extra })
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function setup(t, { admin = false, query = '', language = 'en', theme = 'default', viewport = { width: 1280, height: 800 } } = {}) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(12000)
  t.after(() => page.close())
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const actor = { _id: 'owner', name: 'Fixture Owner', email: 'fixture@example.test', role: 'owner', isActive: true, themePreference: theme }
  const state = { calls: [], properties: [property('one'), property('two', { listingType: 'Rent' })], agents: [{ _id: 'agent-1', name: 'Agent One', email: 'one@example.test' }], agentFail: false, agentDelay: 0, locationDelays: {}, uploadDelay: 0, uploadFailAt: 0, listFail: false, listDelay: {}, listResults: {}, saveDelay: 0 }
  await page.addInitScript(({ actor, language, theme }) => {
    localStorage.setItem('vk_lang', language); localStorage.setItem('vk_theme', theme)
    localStorage.setItem('varlikent_token', 'fixture'); localStorage.setItem('varlikent_user', JSON.stringify(actor))
  }, { actor, language, theme })
  await page.route('**/*', async route => {
    const r = route.request(), url = new URL(r.url()), at = url.pathname.indexOf('/api/')
    const reply = options => route.fulfill(options).catch(() => {})
    if (at === -1) return url.origin === base ? route.continue().catch(() => {}) : route.abort().catch(() => {})
    const path = url.pathname.slice(at + 4), method = r.method()
    let data; try { data = r.postDataJSON() } catch { /* multipart */ }
    state.calls.push({ path, method, data, query: url.search })
    if (path === '/auth/me') return reply({ json: { user: actor } })
    if (path === '/users/agents') { const agents = [...state.agents], fail = state.agentFail; await wait(state.agentDelay); return reply(fail ? { status: 500, json: {} } : { json: { agents } }) }
    if (path === '/users/favourites') return reply({ json: { favourites: [] } })
    if (path === '/properties/areas') return reply({ json: { areas: [{ district: 'Kadikoy', count: 2 }, { district: 'Besiktas', count: 1 }] } })
    if (path.endsWith('/admin-location')) { const id = path.split('/')[2]; await wait(state.locationDelays[id] || 0); return reply({ json: { location: { lat: id === 'one' ? 0 : 41, lng: id === 'one' ? 0 : 29, isApproximate: true, approxRadiusKm: 3 } } }) }
    if (path === '/upload') { const n = state.calls.filter(c => c.path === path).length; await wait(state.uploadDelay); return reply(n === state.uploadFailAt ? { status: 500, json: {} } : { json: { url: image('#aa5555') } }) }
    if (path === '/properties' && method === 'GET') {
      const key = url.searchParams.get('district') || '', fail = state.listFail, result = state.listResults[key] || state.properties
      await wait(state.listDelay[key] || 0)
      return reply(fail ? { status: 500, json: {} } : { json: { properties: result, count: result.length } })
    }
    if (path.startsWith('/properties/') && method === 'PUT') await wait(state.saveDelay)
    return reply({ json: { success: true } })
  })
  await page.goto(`${base}/__batch9${admin ? '-admin' : ''}.html${query}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await expect(page.getByText('Property one', { exact: true }).first()).toBeVisible({ timeout: 90000 })
  return { page, state, errors }
}
const editor = page => page.locator('div.fixed.inset-0.z-50.overflow-y-auto')
const edit = async page => { await page.getByRole('button', { name: 'Edit', exact: true }).first().click(); await expect(editor(page).locator('form')).toBeVisible() }
const agentSelect = page => editor(page).locator('select').filter({ has: page.locator('option[value="agent-1"]') })
const save = page => editor(page).getByRole('button', { name: 'Update Property', exact: true })

test('admin round trip preserves standalone/main image, zero, false, agent, featured and private location', async t => {
  const { page, state, errors } = await setup(t, { admin: true })
  await page.screenshot({ path: join(screenshots, 'admin-cards.png') })
  await edit(page)
  await editor(page).locator('#featured').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(screenshots, 'admin-agent-featured.png') })
  await expect(editor(page).locator('#detail-floor')).toHaveValue('0')
  await expect(editor(page).locator('#detail-sauna')).toHaveValue('false')
  await expect(editor(page).getByLabel('Latitude', { exact: true })).toHaveValue('0')
  await editor(page).getByLabel('Latitude', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(screenshots, 'admin-location-images.png') })
  await save(page).click()
  await expect(editor(page)).toHaveCount(0)
  const payload = state.calls.find(c => c.method === 'PUT').data
  assert.equal(payload.mainImage, images[1]); assert.deepEqual(payload.images, images)
  assert.equal(payload.agent, 'agent-1'); assert.equal(payload.featured, true)
  assert.equal(payload.floor, 0); assert.equal(payload.netSqm, 0); assert.equal(payload.sauna, false)
  for (const field of ['location', 'jacuzzi', 'nearbyTransport']) assert.equal(Object.hasOwn(payload, field), false)
  state.properties[0] = property('one', { images: [], mainImage: image('#123456') })
  await page.reload(); await edit(page); await save(page).click()
  await expect(editor(page)).toHaveCount(0)
  assert.equal(state.calls.filter(c => c.method === 'PUT').at(-1).data.mainImage, image('#123456'))
  assert.deepEqual(errors, [])
})

test('URL navigation restores all repeated values, Sale/Rent, Back/Forward and updates immediately', async t => {
  const { page, state } = await setup(t, { query: '?listingType=Sale&heating=Central&heating=Floor+Heating&parking=Open+Parking&parking=Parking+Garage&buildingAge=0&buildingAge=3&sauna=false' })
  await expect(page.locator('#desktop-heating-Central')).toBeChecked()
  await page.evaluate(() => window.batch9Navigate('?listingType=Rent&district=Besiktas&heating=None&parking=None&buildingAge=5&sauna=true'))
  await expect(page.locator('#desktop-district')).toHaveValue('Besiktas')
  await expect(page.locator('#desktop-heating-None')).toBeChecked()
  await expect(page.locator('#desktop-heating-Central')).not.toBeChecked()
  await page.goBack()
  await expect(page.locator('#desktop-heating-Central')).toBeChecked()
  await expect(page.locator('#desktop-heating-Floor\\ Heating')).toBeChecked()
  await expect(page.locator('#desktop-parking-Parking\\ Garage')).toBeChecked()
  await expect(page.locator('#desktop-buildingAge-3')).toBeChecked()
  await page.goForward()
  await expect(page.locator('#desktop-district')).toHaveValue('Besiktas')
  await page.locator('#desktop-district').selectOption('Kadikoy')
  await expect.poll(() => new URL(page.url()).searchParams.get('district')).toBe('Kadikoy')
  await expect.poll(() => state.calls.filter(c => c.path === '/properties').at(-1).query).toContain('district=Kadikoy')
  await page.reload(); await expect(page.locator('#desktop-district')).toHaveValue('Kadikoy')
})

test('rapid filters keep latest results and failure has a retry instead of empty success', async t => {
  const { page, state, errors } = await setup(t)
  state.listDelay.Kadikoy = 500; state.listResults.Kadikoy = [property('old')]; state.listResults.Besiktas = [property('latest')]
  await page.locator('#desktop-district').selectOption('Kadikoy')
  await expect.poll(() => state.calls.some(c => c.query.includes('district=Kadikoy'))).toBe(true)
  await page.locator('#desktop-district').selectOption('Besiktas')
  await expect(page.getByText('Property latest', { exact: true })).toBeVisible()
  await wait(650)
  await expect(page.getByText('Property latest', { exact: true })).toBeVisible()
  state.listFail = true
  await page.locator('#desktop-district').selectOption('')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('No properties found', { exact: true })).toHaveCount(0)
  state.listFail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('Property one', { exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
})

test('agent refresh, retained failed list, new agents and assign/reassign/clear', async t => {
  const { page, state } = await setup(t, { admin: true })
  await edit(page); await expect(agentSelect(page)).toHaveValue('agent-1')
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  state.agentFail = true
  await edit(page); await expect(editor(page).getByText('Could not load agents. Close and reopen the form to try again.', { exact: true })).toBeVisible()
  await expect(agentSelect(page)).toHaveValue('agent-1')
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  state.agentFail = false; state.agents.push({ _id: 'agent-2', name: 'Agent Two', email: 'two@example.test' })
  await edit(page); await expect(agentSelect(page).locator('option[value="agent-2"]')).toHaveCount(1)
  await agentSelect(page).selectOption('agent-2'); await save(page).click(); await expect(editor(page)).toHaveCount(0)
  assert.equal(state.calls.filter(c => c.method === 'PUT').at(-1).data.agent, 'agent-2')
  await edit(page); await agentSelect(page).selectOption(''); await save(page).click(); await expect(editor(page)).toHaveCount(0)
  assert.equal(state.calls.filter(c => c.method === 'PUT').at(-1).data.agent, null)
  await page.getByRole('button', { name: '+ Add Property', exact: true }).click()
  await expect(agentSelect(page).locator('option[value="agent-2"]')).toHaveCount(1)
  assert.equal(state.calls.filter(c => c.path === '/users/agents').length, 5)
})

test('old private location and upload cannot cross editor sessions; upload disables save', async t => {
  const { page, state } = await setup(t, { admin: true })
  state.locationDelays.one = 500
  await edit(page); await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(1).click()
  await expect(editor(page).getByLabel('Latitude', { exact: true })).toHaveValue('41')
  await wait(650); await expect(editor(page).getByLabel('Latitude', { exact: true })).toHaveValue('41')
  state.uploadDelay = 500
  await editor(page).locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) })
  await expect(save(page)).toBeDisabled()
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: '+ Add Property', exact: true }).click()
  await wait(650); await expect(editor(page).locator('img.h-20')).toHaveCount(0)
})

test('admin tabs, empty category and list failure', async t => {
  const { page, state, errors } = await setup(t, { admin: true })
  await page.getByRole('tab', { name: /For Rent/ }).click()
  await expect(page.getByText('Property two', { exact: true })).toBeVisible()
  await expect(page.getByText('Property one', { exact: true })).toHaveCount(0)
  state.properties = []; await page.reload()
  await expect(page.getByText('No listings in this category yet.', { exact: true })).toBeVisible()
  state.listFail = true; await page.reload(); await expect(page.getByRole('alert')).toBeVisible()
  assert.deepEqual(errors, [])
})

for (const language of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
  test(`visual ${language}: public sections, mobile Apply, themes, admin short viewport`, async t => {
    const theme = { en: 'default', tr: 'forest', ar: 'navy', de: 'earth', ru: 'gold-white', ur: 'rosewood-blush' }[language]
    const { page, errors } = await setup(t, { language, theme })
    const pp = translations[language].propertiesPage, p = translations[language].adminPages.properties
    await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(language) ? 'rtl' : 'ltr')
    await expect(page.locator('aside [aria-controls]')).toHaveCount(23)
    for (const field of ['heating', 'parking']) await page.locator(`button[aria-controls="desktop-${field}-panel"]`).click()
    await expect(page.locator('button[aria-controls="desktop-heating-panel"]')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('button[aria-controls="desktop-parking-panel"]')).toHaveAttribute('aria-expanded', 'true')
    await page.screenshot({ path: join(screenshots, `public-${language}.png`) })
    await page.setViewportSize({ width: 390, height: 560 })
    await page.getByRole('button', { name: pp.filters, exact: true }).click()
    await page.locator('button[aria-controls="mobile-titleDeedStatus-panel"]').click()
    await page.locator('button[aria-controls="mobile-titleDeedStatus-panel"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshots, `drawer-${language}.png`) })
    await page.getByRole('button', { name: pp.apply, exact: true }).click()
    await expect(page.locator('#mobile-district')).toHaveCount(0)
    await page.goto(`${base}/__batch9-admin.html`)
    await page.getByRole('button', { name: p.addProperty, exact: true }).click()
    await expect(editor(page)).toHaveCSS('overflow-y', 'auto')
    await page.screenshot({ path: join(screenshots, `admin-${language}.png`) })
    await editor(page).getByRole('button', { name: p.saveProperty, exact: true }).scrollIntoViewIfNeeded()
    await expect(editor(page).getByRole('button', { name: p.saveProperty, exact: true })).toBeInViewport()
    await page.screenshot({ path: join(screenshots, `admin-bottom-${language}.png`) })
    assert.deepEqual(errors, [])
  })
}


test('all supported filter controls update requests; private maps, favourites and empty results', async t => {
  const { page, state } = await setup(t)
  const panel = page.locator('aside')
  for (const button of await panel.locator('button[aria-controls]').all()) {
    if (await button.getAttribute('aria-expanded') === 'false') await button.click()
  }
  await panel.getByRole('button', { name: 'For Rent', exact: true }).click()
  await panel.locator('#desktop-district').selectOption('Kadikoy')
  await panel.locator('#desktop-propertyType').selectOption('Villa')
  await panel.locator('#desktop-rooms-select').selectOption('2+1')
  await panel.locator('#desktop-baths-select').selectOption('2')
  const pp = translations.en.propertiesPage
  for (const label of [pp.priceRange, pp.grossArea, pp.netArea, pp.openArea, pp.coefficient]) {
    await panel.getByRole('spinbutton', { name: `${label} — ${pp.min}`, exact: true }).fill('0')
    await panel.getByRole('spinbutton', { name: `${label} — ${pp.max}`, exact: true }).fill('500')
  }
  await panel.getByRole('spinbutton', { name: pp.floorNo, exact: true }).fill('0')
  await panel.getByRole('spinbutton', { name: pp.totalFloors, exact: true }).fill('10')
  const multi = { heating: ['Central', 'Floor Heating'], parking: ['Open Parking', 'Parking Garage'], buildingAge: ['0', '3'], floorLocation: ['Ground floor'], kitchenType: ['Closed'], usageStatus: ['Empty'], titleDeedStatus: ['Independent Title Deed'], nearbyTransport: ['Metro', 'Ferry'] }
  for (const [field, values] of Object.entries(multi)) for (const value of values) await panel.locator(`[id="desktop-${field}-${value}"]`).check()
  for (const field of ['furnished', 'balcony', 'elevator', 'pool', 'garden']) await panel.locator(`#desktop-${field}`).check()
  for (const field of ['sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement', 'withinSite', 'eligibleForCredit', 'exchange', 'hasVirtualTour']) await panel.locator(`#desktop-${field}`).selectOption('false')
  await panel.locator('#desktop-listedSince').selectOption('7')
  await expect.poll(() => state.calls.filter(c => c.path === '/properties').at(-1).query).toContain('listedSince=7')
  const query = new URLSearchParams(state.calls.filter(c => c.path === '/properties').at(-1).query)
  assert.equal(new Set(query.keys()).size, 40)
  for (const [field, values] of Object.entries(multi)) assert.deepEqual(query.getAll(field), values)
  assert.equal(query.get('floor'), '0'); assert.equal(query.get('hasVirtualTour'), 'false')
  await page.locator('main button').first().click()
  await expect.poll(() => state.calls.some(c => c.path.startsWith('/users/favourites/') && c.method === 'POST')).toBe(true)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.getByText(pp.noMappedProperties, { exact: true })).toBeVisible()
  assert.equal(state.calls.some(c => /minLat|maxLat|minLng|maxLng|hasVideo/.test(c.query)), false)
  state.properties = []
  await panel.getByRole('button', { name: /Clear All/ }).click()
  await expect(page.getByText(pp.noResults, { exact: true })).toBeVisible()
})

test('partial uploads survive failure; main-image removal falls back; pending save cannot close', async t => {
  const { page, state } = await setup(t, { admin: true })
  await edit(page)
  state.uploadFailAt = 2
  await editor(page).locator('input[type=file]').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) },
    { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) },
  ])
  await expect(editor(page).locator('img.h-20')).toHaveCount(3)
  await expect(save(page)).toBeEnabled()
  const thumbnail = editor(page).locator('img.h-20').nth(1).locator('..')
  await thumbnail.hover(); await thumbnail.getByRole('button').click()
  state.saveDelay = 400
  await save(page).click()
  await expect(editor(page).getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(editor(page)).toBeVisible()
  await expect(editor(page)).toHaveCount(0)
  const payload = state.calls.filter(c => c.method === 'PUT').at(-1).data
  assert.equal(payload.mainImage, images[0]); assert.equal(payload.images.length, 2)
})

test('stale agent success cannot replace the newest list', async t => {
  const { page, state } = await setup(t, { admin: true })
  state.agentDelay = 500
  await edit(page)
  await expect.poll(() => state.calls.filter(c => c.path === '/users/agents').length).toBe(1)
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  state.agentDelay = 0; state.agents = [{ _id: 'agent-2', name: 'Agent Two', email: 'two@example.test' }]
  await edit(page)
  await expect(agentSelect(page).locator('option[value="agent-2"]')).toHaveCount(1)
  await wait(650)
  await expect(agentSelect(page).locator('option[value="agent-2"]')).toHaveCount(1)
  await expect(agentSelect(page)).toHaveValue('agent-1')
})
