// Contact interests in a real browser (Phase 1B): the admin manager under
// Page Content → Contact, Lead Routing, and the public Contact form.
//
// Real React components on a Vite dev server. Every API call is answered by
// the in-test backend below, which applies the backend's OWN id derivation and
// public projection (imported from backend/config/contactInterests.js), so the
// UI is checked against the real rules without a database or network.
//
// Run explicitly: node --test tests/browser/contactInterests.test.js

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { PAGE_CONTENT_KEYS, PAGE_CONTENT_REGISTRY } from '../../src/lib/pageContentRegistry.js'
import {
  DEFAULT_CONTACT_INTERESTS,
  deriveContactInterestId,
  normalizeContactInterestValue,
  selectPublicContactInterests,
} from '../../../backend/config/contactInterests.js'

let server, browser, base

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { LanguageProvider } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import AdminPageContent from '/src/pages/AdminPageContent.jsx';
import AdminLeadRouting from '/src/pages/AdminLeadRouting.jsx';
import ContactPage from '/src/pages/ContactPage.jsx';
import '/src/index.css';
const e = React.createElement;
const view = new URLSearchParams(location.search).get('view');
const Page = view === 'routing' ? AdminLeadRouting : view === 'contact' ? ContactPage : AdminPageContent;
createRoot(document.getElementById('root')).render(
  e(MemoryRouter, null, e(LanguageProvider, null, e(AuthProvider, null, e(ToastContainer), e(Page))))
);
</script></body></html>`

before(async () => {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'contact-interests-test-harness',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith('/__contact_interests.html') || req.url.includes('html-proxy')) return next()
          try {
            res.setHeader('Content-Type', 'text/html')
            res.end(await vite.transformIndexHtml('/__contact_interests.html', html))
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

/* ══════════════ The in-test backend ══════════════ */

const OWNER = { _id: 'owner1', role: 'owner', name: 'Test Owner', permissions: [] }

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const sorted = (list) => [...list].sort((a, b) => a.order - b.order || compareIds(a.id, b.id))
const managed = (interest) => ({ ...structuredClone(interest), createdAt: null, updatedAt: null })

const INVESTMENT = {
  id: 'investment_consultation',
  value: 'Investment Consultation',
  labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' },
  order: 0,
  enabled: true,
}

function createBackend() {
  return {
    interests: DEFAULT_CONTACT_INTERESTS.map(({ id, value, labels, order, enabled }) => ({ id, value, labels: { ...labels }, order, enabled })),
    calls: [],
    submissions: [],
    pageContentSaves: [],
    manageFailures: 0,
    manageDelayMs: 0,
    failPublic: false,
    createError: null,
    patchError: null,
  }
}

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function answer(route, state) {
  const request = route.request()
  const method = request.method()
  const path = new URL(request.url()).pathname.replace(/^.*?\/api(?=\/)/, '')
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? request.postDataJSON() : undefined
  state.calls.push({ method, path, body })

  if (path === '/auth/me') return json(route, 200, { success: true, user: OWNER })

  if (path.startsWith('/page-content/')) {
    if (method === 'PUT') state.pageContentSaves.push(body)
    return json(route, 200, { success: true, fields: {}, sections: {} })
  }

  if (path === '/contact/interests/manage') {
    if (state.manageDelayMs) await new Promise((resolve) => setTimeout(resolve, state.manageDelayMs))
    if (state.manageFailures > 0) {
      state.manageFailures -= 1
      return json(route, 500, { success: false, message: 'Database unavailable' })
    }
    return json(route, 200, { success: true, interests: sorted(state.interests).map(managed) })
  }

  if (path === '/contact/interests' && method === 'GET') {
    if (state.failPublic) return route.fulfill({ status: 503, body: 'Service Unavailable' })
    return json(route, 200, { success: true, interests: selectPublicContactInterests(state.interests) })
  }

  if (path === '/contact/interests' && method === 'POST') {
    if (state.createError) return json(route, state.createError.status, { success: false, message: state.createError.message })
    const value = normalizeContactInterestValue(body.labels?.en)
    const id = deriveContactInterestId(value)
    if (state.interests.some((interest) => interest.id === id || interest.value === value)) {
      return json(route, 409, { success: false, message: `An interest with the id '${id}' already exists.` })
    }
    const interest = { id, value, labels: body.labels, order: body.order ?? 10, enabled: body.enabled ?? true }
    state.interests.push(interest)
    return json(route, 201, { success: true, interest: managed(interest) })
  }

  const interestPath = path.match(/^\/contact\/interests\/([^/]+)$/)
  if (interestPath && method === 'PATCH') {
    if (state.patchError) return json(route, state.patchError.status, { success: false, message: state.patchError.message })
    const interest = state.interests.find((candidate) => candidate.id === decodeURIComponent(interestPath[1]))
    if (!interest) return json(route, 404, { success: false, message: 'Contact interest not found' })
    for (const key of ['labels', 'enabled', 'order']) {
      if (body[key] !== undefined) interest[key] = structuredClone(body[key])
    }
    return json(route, 200, { success: true, interest: managed(interest) })
  }

  if (path === '/contact' && method === 'POST') {
    state.submissions.push(body)
    return json(route, 201, { success: true, message: 'Received' })
  }

  if (path === '/lead-routing') {
    if (method === 'PUT') return json(route, 200, { success: true })
    return json(route, 200, {
      success: true,
      routing: sorted(state.interests).map((interest) => ({
        interestType: interest.value, label: interest.labels.en, enabled: interest.enabled, recipients: [],
      })),
    })
  }

  return json(route, 200, { success: true })
}

async function open(t, { view = 'admin', language = 'en', configure } = {}) {
  const state = createBackend()
  configure?.(state)

  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  t.after(() => page.close())

  await page.addInitScript(({ language, owner }) => {
    localStorage.setItem('vk_lang', language)
    localStorage.setItem('varlikent_token', 'isolated-test-token')
    localStorage.setItem('varlikent_user', JSON.stringify(owner))
  }, { language, owner: OWNER })

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/api/')) return answer(route, state)
    if (url.origin !== base) return route.abort()
    return route.continue()
  })

  await page.goto(`${base}/__contact_interests.html?view=${view}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  return { page, state }
}

const manager = (page) => page.getByTestId('contact-interests-manager')
const row = (page, id) => page.locator(`[data-testid="contact-interest-row"][data-interest-id="${id}"]`)
const rowIds = (page) => page.locator('[data-testid="contact-interest-row"]').evaluateAll((els) => els.map((el) => el.dataset.interestId))
const callsTo = (state, method, pattern) => state.calls.filter((call) => call.method === method && pattern.test(call.path))

async function openContactTab(page) {
  await page.getByRole('button', { name: PAGE_CONTENT_REGISTRY.contact.label, exact: true }).click({ timeout: 60000 })
  await expect(page.getByRole('heading', { name: 'Contact Interests' })).toBeVisible({ timeout: 60000 })
}

/* ══════════════ Admin → Page Content → Contact ══════════════ */

test('the manager appears only on the Contact tab, below the page fields, listing enabled and disabled interests', async (t) => {
  const { page } = await open(t, {
    configure: (state) => { state.interests.find((i) => i.id === 'selling').enabled = false },
  })

  assert.notEqual(PAGE_CONTENT_KEYS[0], 'contact', 'the first tab must be another page for this check')
  await expect(page.getByRole('button', { name: PAGE_CONTENT_REGISTRY.contact.label, exact: true })).toBeVisible({ timeout: 60000 })
  await expect(manager(page)).toHaveCount(0)

  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)
  assert.deepEqual(await rowIds(page), defaultInterestIds())

  await expect(row(page, 'selling')).toContainText('Disabled')
  await expect(row(page, 'buying')).toContainText('Enabled')
  await expect(row(page, 'interior_design')).toContainText('Interior Design · interior_design')

  // Below the Contact page-content fields.
  const heroTitle = await page.getByText('Hero', { exact: true }).boundingBox()
  const heading = await page.getByRole('heading', { name: 'Contact Interests' }).boundingBox()
  assert.ok(heading.y > heroTitle.y)

  // Leaving the Contact tab removes it again.
  await page.getByRole('button', { name: PAGE_CONTENT_REGISTRY[PAGE_CONTENT_KEYS[0]].label, exact: true }).click()
  await expect(manager(page)).toHaveCount(0)
})

function defaultInterestIds() {
  return DEFAULT_CONTACT_INTERESTS.map((interest) => interest.id)
}

test('loading and load-failure states, with a working retry', async (t) => {
  const { page, state } = await open(t, {
    configure: (s) => { s.manageDelayMs = 1500; s.manageFailures = 1 },
  })

  await page.getByRole('button', { name: PAGE_CONTENT_REGISTRY.contact.label, exact: true }).click({ timeout: 60000 })
  await expect(manager(page).getByRole('status')).toHaveText('Loading contact interests…', { timeout: 60000 })

  const alert = manager(page).getByRole('alert')
  await expect(alert).toContainText('Could not load contact interests.', { timeout: 10000 })
  await expect(alert).toContainText('Database unavailable')
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(0)

  state.manageDelayMs = 0
  await manager(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)
  await expect(manager(page).getByRole('alert')).toHaveCount(0)
})

test('adding an interest previews the server’s id and value, and never sends them', async (t) => {
  const { page, state } = await open(t)
  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)

  await manager(page).getByRole('button', { name: 'Add New Interest', exact: true }).click()
  const form = page.getByRole('form', { name: 'New interest' })

  await expect(form.getByLabel('Order')).toHaveValue('10')
  await form.getByLabel('English label').fill('Investment Consultation')
  await form.getByLabel('Turkish label').fill('Yatırım Danışmanlığı')

  const identity = form.getByTestId('contact-interest-identity')
  await expect(identity).toContainText('investment_consultation')
  await expect(identity).toContainText('Investment Consultation')
  await expect(identity.locator('input')).toHaveCount(0)

  await form.getByRole('button', { name: 'Create Interest', exact: true }).click()

  await expect.poll(() => callsTo(state, 'POST', /^\/contact\/interests$/).length).toBe(1)
  const sent = callsTo(state, 'POST', /^\/contact\/interests$/)[0].body
  assert.deepEqual(sent, { labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' }, enabled: true, order: 10 })

  await expect(row(page, 'investment_consultation')).toContainText('Enabled')
  await expect(page.getByRole('form', { name: 'New interest' })).toHaveCount(0)

  // Interest actions are not page-content edits.
  assert.equal(state.pageContentSaves.length, 0)
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0)
})

test('the add form explains missing English, collisions and server refusals', async (t) => {
  const { page, state } = await open(t)
  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)

  await manager(page).getByRole('button', { name: 'Add New Interest', exact: true }).click()
  const form = page.getByRole('form', { name: 'New interest' })
  const create = form.getByRole('button', { name: 'Create Interest', exact: true })

  await create.click()
  await expect(form.getByRole('alert')).toHaveText('An English label is required.')

  await form.getByLabel('English label').fill('buying')
  await create.click()
  await expect(form.getByRole('alert')).toContainText('already uses this ID or value')
  assert.equal(callsTo(state, 'POST', /^\/contact\/interests$/).length, 0, 'invalid forms must not reach the server')

  state.createError = { status: 409, message: "An interest with the id 'market_report' already exists. Edit or re-enable it instead." }
  await form.getByLabel('English label').fill('Market Report')
  await create.click()
  await expect(form.getByRole('alert')).toHaveText("An interest with the id 'market_report' already exists. Edit or re-enable it instead.")
  await expect(form.getByLabel('English label')).toHaveValue('Market Report')
})

test('editing changes labels and order; the id and submitted value are read-only', async (t) => {
  const { page, state } = await open(t)
  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)

  await row(page, 'interior_design').getByRole('button', { name: 'Edit Interior Design', exact: true }).click()
  const form = page.getByRole('form', { name: 'Edit Interior Design' })

  const identity = form.getByTestId('contact-interest-identity')
  await expect(identity).toContainText('interior_design')
  await expect(identity).toContainText('Interior Design')
  await expect(identity).toContainText('The internal ID and submitted value cannot be changed after creation.')
  await expect(identity.locator('input, textarea, select')).toHaveCount(0)
  const values = await form.locator('input').evaluateAll((els) => els.map((el) => el.value))
  assert.equal(values.includes('interior_design'), false, 'the stable id is editable')

  await form.getByLabel('Turkish label').fill('İç Tasarım')
  await form.getByLabel('Order').fill('0')
  await form.getByRole('button', { name: 'Save Interest', exact: true }).click()

  await expect.poll(() => callsTo(state, 'PATCH', /^\/contact\/interests\//).length).toBe(1)
  const call = callsTo(state, 'PATCH', /^\/contact\/interests\//)[0]
  assert.equal(call.path, '/contact/interests/interior_design')
  assert.deepEqual(Object.keys(call.body).sort(), ['enabled', 'labels', 'order'])
  assert.equal(call.body.order, 0)
  assert.equal(call.body.labels.tr, 'İç Tasarım')
  assert.equal(call.body.labels.en, 'Interior Design')

  await expect(page.getByRole('form', { name: 'Edit Interior Design' })).toHaveCount(0)
  await expect.poll(async () => (await rowIds(page))[0]).toBe('interior_design')
})

test('disable and re-enable, and a server refusal is shown without changing the row', async (t) => {
  const { page, state } = await open(t)
  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)

  await row(page, 'buying').getByRole('button', { name: 'Disable Buying', exact: true }).click()
  await expect(row(page, 'buying')).toContainText('Disabled')
  assert.deepEqual(callsTo(state, 'PATCH', /buying$/).at(-1).body, { enabled: false })

  await row(page, 'buying').getByRole('button', { name: 'Enable Buying', exact: true }).click()
  await expect(row(page, 'buying')).toContainText('Enabled')
  assert.deepEqual(callsTo(state, 'PATCH', /buying$/).at(-1).body, { enabled: true })

  state.patchError = { status: 409, message: 'At least one interest must stay enabled, otherwise the Contact form falls back to its built-in list' }
  await row(page, 'general').getByRole('button', { name: 'Disable General Enquiry', exact: true }).click()
  await expect(manager(page).getByRole('alert')).toHaveText(state.patchError.message)
  await expect(row(page, 'general')).toContainText('Enabled')
})

test('interest changes never touch the page editor, whose Save Changes still saves page text only', async (t) => {
  const { page, state } = await open(t)
  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)

  await row(page, 'selling').getByRole('button', { name: 'Disable Selling', exact: true }).click()
  await expect(row(page, 'selling')).toContainText('Disabled')
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0)
  assert.equal(state.pageContentSaves.length, 0)

  const heading = page.locator('textarea').nth(1)
  await expect(heading).toHaveValue(PAGE_CONTENT_REGISTRY.contact.hero.fields[1].default)
  await heading.fill('Contact Us Today')

  const interestCalls = state.calls.filter((call) => call.path.startsWith('/contact/interests')).length
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()

  await expect.poll(() => state.pageContentSaves.length).toBe(1)
  const saved = JSON.stringify(state.pageContentSaves[0])
  assert.ok(saved.includes('heroHeading') && saved.includes('Contact Us Today'))
  for (const leaked of ['Selling', 'enabled', 'labels', 'selling']) {
    assert.equal(saved.includes(leaked), false, `the page-content save carried '${leaked}'`)
  }
  assert.equal(state.calls.filter((call) => call.path.startsWith('/contact/interests')).length, interestCalls)
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0)
  await expect(row(page, 'selling')).toContainText('Disabled')
})

/* ══════════════ Lead Routing ══════════════ */

test('Lead Routing lists an admin-created interest and marks a disabled one', async (t) => {
  const { page } = await open(t, {
    view: 'routing',
    configure: (state) => { state.interests.push({ ...INVESTMENT, order: 10, enabled: false }) },
  })

  const investment = page.getByRole('button', { name: /Investment Consultation/ })
  await expect(investment).toBeVisible({ timeout: 60000 })
  await expect(investment).toContainText('Disabled')
  await expect(page.getByText('Interests marked disabled are hidden from the Contact form', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /Construction/ })).not.toContainText('Disabled')
})

/* ══════════════ The public Contact form ══════════════ */

test('the public form offers an admin-created interest in the visitor’s language, in server order, and submits its value', async (t) => {
  const { page, state } = await open(t, {
    view: 'contact',
    language: 'tr',
    configure: (s) => {
      s.interests.push({ ...INVESTMENT })
      s.interests.find((i) => i.id === 'construction').enabled = false
    },
  })

  const select = page.locator('#interestType')
  await expect(select.locator('option[value="Investment Consultation"]')).toHaveCount(1, { timeout: 60000 })
  await expect(select.locator('option').first()).toHaveText('Yatırım Danışmanlığı')
  await expect(select.locator('option[value="Construction"]')).toHaveCount(0)
  await expect(select.locator('option[value="Buying"]')).toHaveText('Satın Alma')

  await select.selectOption('Investment Consultation')
  await page.locator('#name').fill('Ada Yılmaz')
  await page.locator('#email').fill('ada@example.com')
  await page.locator('#phone').fill('+90 532 000 00 00')
  await page.locator('#message').fill('Merhaba')
  await page.locator('form button[type=submit]').click()

  await expect.poll(() => state.submissions.length).toBe(1)
  assert.equal(state.submissions[0].interestType, 'Investment Consultation')
})

test('a missing translation shows English, never a blank option', async (t) => {
  const { page } = await open(t, {
    view: 'contact',
    language: 'ar',
    configure: (s) => { s.interests.push({ ...INVESTMENT }) },
  })

  await expect(page.locator('#interestType option[value="Investment Consultation"]')).toHaveText('Investment Consultation', { timeout: 60000 })
  await expect(page.locator('#interestType option[value="Buying"]')).toHaveText('الشراء')
})

test('when the interest API fails, the form keeps the bundled nine', async (t) => {
  const { page, state } = await open(t, { view: 'contact', configure: (s) => { s.failPublic = true } })

  await expect.poll(() => state.calls.some((call) => call.path === '/contact/interests'), { timeout: 60000 }).toBe(true)
  const options = page.locator('#interestType option')
  await expect(options).toHaveCount(9)
  assert.deepEqual(
    await options.evaluateAll((els) => els.map((el) => el.value)),
    DEFAULT_CONTACT_INTERESTS.map((interest) => interest.value)
  )
})

/* ══════════════ The Admin language (Page Content localization) ══════════════ */

const { default: translations } = await import('../../src/locales/translations.js')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')

const ENGLISH_TABS = ['Homepage', 'Architecture', 'Construction', 'Renovation', 'Interior Design', 'Team', 'Contact']

const tab = (page, language, pageKey) =>
  page.getByRole('button', { name: translations[language].adminPages.pageContent.pages[pageKey], exact: true })

/** Every field caption shown on a page's hero, in the given language. */
const heroCaptions = (language, pageKey) =>
  PAGE_CONTENT_REGISTRY[pageKey].hero.fields.map((field) => translations[language].adminPages.pageContent.fieldLabels[field.labelKey])

test('Turkish admin: Page Content chrome, tabs, sections and field captions are Turkish; content is not', async (t) => {
  const { page, state } = await open(t, { language: 'tr' })
  const pc = translations.tr.adminPages.pageContent

  await expect(page.getByRole('heading', { level: 1, name: pc.title })).toBeVisible({ timeout: 60000 })
  await expect(page.getByText(pc.subtitle, { exact: true })).toBeVisible()

  // Tabs, in registry order.
  assert.deepEqual(PAGE_CONTENT_KEYS.map((key) => pc.pages[key]), ['Ana Sayfa', 'Mimarlık', 'İnşaat', 'Renovasyon', 'İç Mimarlık', 'Ekip', 'İletişim'])
  for (const key of PAGE_CONTENT_KEYS) await expect(tab(page, 'tr', key)).toBeVisible()
  for (const english of ENGLISH_TABS) await expect(page.getByRole('button', { name: english, exact: true })).toHaveCount(0)

  // Another page: section titles and the captions inside a section.
  await tab(page, 'tr', 'architecture').click()
  await expect(page.getByText('Hizmetler', { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('Mimarlık Vitrini', { exact: true })).toBeVisible()
  await expect(page.getByText('Architecture Showcase', { exact: true })).toHaveCount(0)
  await page.getByText('Hizmetler', { exact: true }).locator('..').getByRole('button', { name: pc.edit, exact: true }).click()
  await expect(page.getByText('Hizmet 1 — başlık', { exact: true })).toBeVisible()
  await expect(page.getByText('Service 1 — title', { exact: true })).toHaveCount(0)
  // The box holds the site's CONTENT, in the language it was written — not a translation.
  const service1Default = PAGE_CONTENT_REGISTRY.architecture.sections.find((s) => s.key === 'services').fields
    .find((f) => f.key === 'service1Title').default
  const values = await page.locator('textarea').evaluateAll((els) => els.map((el) => el.value))
  assert.ok(values.includes(service1Default), 'the interface language changed the content being edited')

  // Contact.
  await tab(page, 'tr', 'contact').click()
  await expect(page.getByText(pc.hero, { exact: true })).toBeVisible({ timeout: 60000 })
  assert.equal(pc.hero, 'Giriş Bölümü')
  await expect(page.getByText(pc.alwaysVisible, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: pc.close, exact: true })).toBeVisible()
  await expect(page.getByText(pc.noSections, { exact: true })).toBeVisible()
  for (const caption of heroCaptions('tr', 'contact')) {
    await expect(page.getByText(caption, { exact: true }), caption).toBeVisible()
  }
  for (const english of PAGE_CONTENT_REGISTRY.contact.hero.fields.map((f) => f.label)) {
    await expect(page.getByText(english, { exact: true }), english).toHaveCount(0)
  }
  await expect(page.locator('textarea').nth(1)).toHaveValue('Contact VarliKent')

  // Editing shows the Turkish save bar.
  await page.locator('textarea').nth(1).fill('İletişim')
  await expect(page.getByText(pc.unsavedChanges, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: pc.saveChanges, exact: true })).toBeVisible()
  assert.equal(state.pageContentSaves.length, 0)
})

test('Turkish admin: the Contact Interests manager and interest names are Turkish; identity stays canonical', async (t) => {
  const { page, state } = await open(t, {
    language: 'tr',
    configure: (s) => { s.interests.find((i) => i.id === 'selling').enabled = false },
  })
  const ci = translations.tr.adminPages.contactInterests

  await tab(page, 'tr', 'contact').click({ timeout: 60000 })
  await expect(page.getByRole('heading', { name: ci.title })).toBeVisible({ timeout: 60000 })
  await expect(manager(page).getByText(ci.subtitle, { exact: true })).toBeVisible()
  await expect(manager(page).getByText(ci.noDelete, { exact: true })).toBeVisible()

  const buying = row(page, 'buying')
  await expect(buying.getByTestId('contact-interest-name')).toHaveText('Satın Alma')
  await expect(buying.getByTestId('contact-interest-identity-line')).toHaveText('Buying · buying')
  await expect(buying).toContainText(`${ci.order} 1`)
  await expect(buying).toContainText(ci.enabled)
  await expect(row(page, 'selling')).toContainText(ci.disabled)
  await expect(row(page, 'selling').getByRole('button', { name: ci.enableNamed.replace('{name}', 'Satış'), exact: true })).toHaveText(ci.enable)
  await expect(buying.getByRole('button', { name: ci.disableNamed.replace('{name}', 'Satın Alma'), exact: true })).toHaveText(ci.disable)

  // The editor.
  await buying.getByRole('button', { name: ci.editNamed.replace('{name}', 'Satın Alma'), exact: true }).click()
  const form = page.getByRole('form', { name: ci.editNamed.replace('{name}', 'Satın Alma') })
  for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    await expect(form.getByLabel(ci.languageLabels[lang])).toBeVisible()
  }
  await expect(form.getByLabel(ci.languageLabels.en)).toHaveValue('Buying')
  await expect(form.getByLabel(ci.languageLabels.ar)).toHaveAttribute('dir', 'rtl')
  await expect(form.getByLabel(ci.languageLabels.ur)).toHaveAttribute('dir', 'rtl')
  await expect(form.getByLabel(ci.languageLabels.en)).toHaveAttribute('dir', 'ltr')
  const identity = form.getByTestId('contact-interest-identity')
  for (const text of [ci.stableId, ci.submittedValue, ci.immutable, 'buying', 'Buying']) await expect(identity).toContainText(text)
  for (const text of [ci.orderHint, ci.offered]) await expect(form.getByText(text, { exact: true })).toBeVisible()
  await expect(form.getByRole('button', { name: ci.cancel, exact: true })).toBeVisible()
  await expect(form.getByRole('button', { name: ci.save, exact: true })).toBeVisible()
  await form.getByRole('button', { name: ci.cancel, exact: true }).click()

  // The add form and a Turkish validation message.
  await manager(page).getByRole('button', { name: ci.add, exact: true }).click()
  const addForm = page.getByRole('form', { name: ci.newInterest })
  await addForm.getByRole('button', { name: ci.create, exact: true }).click()
  await expect(addForm.getByRole('alert')).toHaveText(ci.errors.englishRequired)
  await addForm.getByLabel(ci.languageLabels.en).fill('buying')
  await addForm.getByRole('button', { name: ci.create, exact: true }).click()
  await expect(addForm.getByRole('alert')).toHaveText(ci.errors.clash.replace('{name}', 'Satın Alma'))
  await expect(addForm.getByTestId('contact-interest-identity')).toContainText(ci.generated)

  assert.equal(state.calls.filter((call) => call.method !== 'GET').length, 0, 'nothing may be written by browsing or validation')
})

test('Arabic admin: RTL, Arabic chrome and captions, Arabic interest names with English fallback', async (t) => {
  const { page } = await open(t, {
    language: 'ar',
    configure: (s) => { s.interests.push({ ...INVESTMENT, order: 10 }) },
  })
  const pc = translations.ar.adminPages.pageContent
  const ci = translations.ar.adminPages.contactInterests

  await expect(page.getByRole('heading', { level: 1, name: pc.title })).toBeVisible({ timeout: 60000 })
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  for (const english of ENGLISH_TABS) await expect(page.getByRole('button', { name: english, exact: true })).toHaveCount(0)

  await tab(page, 'ar', 'contact').click()
  await expect(page.getByText(pc.hero, { exact: true })).toBeVisible({ timeout: 60000 })
  for (const caption of heroCaptions('ar', 'contact')) await expect(page.getByText(caption, { exact: true }), caption).toBeVisible()

  await expect(page.getByRole('heading', { name: ci.title })).toBeVisible({ timeout: 60000 })
  await expect(row(page, 'buying').getByTestId('contact-interest-name')).toHaveText('الشراء')
  await expect(row(page, 'buying').getByTestId('contact-interest-identity-line')).toHaveText('Buying · buying')
  // No Arabic label on this interest: English, never blank.
  await expect(row(page, 'investment_consultation').getByTestId('contact-interest-name')).toHaveText('Investment Consultation')
  await expect(manager(page).getByRole('button', { name: ci.add, exact: true })).toBeVisible()

  await page.screenshot({ path: join(tmpdir(), 'varlikent-page-content-ar.png'), fullPage: true })
})

test('switching the Admin language never rewrites content, saves, marks dirty or touches interests', async (t) => {
  const { page, state } = await open(t)

  await openContactTab(page)
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9)

  const textareas = page.locator('textarea')
  const before = await textareas.evaluateAll((els) => els.map((el) => el.value))
  const interestsBefore = structuredClone(state.interests)
  const pageContentLoads = () => state.calls.filter((call) => call.path.startsWith('/page-content/')).length
  const loadsBefore = pageContentLoads()

  for (const language of ['tr', 'ar', 'en']) {
    await page.getByRole('button', { name: language.toUpperCase(), exact: true }).click()
    const pc = translations[language].adminPages.pageContent
    await expect(page.getByRole('heading', { level: 1, name: pc.title })).toBeVisible()
    await expect(page.getByRole('heading', { name: translations[language].adminPages.contactInterests.title })).toBeVisible()

    assert.deepEqual(await textareas.evaluateAll((els) => els.map((el) => el.value)), before, `${language}: content changed`)
    await expect(page.getByRole('button', { name: pc.saveChanges, exact: true })).toHaveCount(0)
  }

  assert.equal(state.calls.filter((call) => call.method !== 'GET').length, 0, 'switching language sent a write')
  assert.equal(pageContentLoads(), loadsBefore, 'switching language reloaded the page content')
  assert.deepEqual(state.interests, interestsBefore)

  // An unsaved edit survives a language switch, still unsaved.
  await textareas.nth(1).fill('Draft heading')
  await page.getByRole('button', { name: 'TR', exact: true }).click()
  await expect(textareas.nth(1)).toHaveValue('Draft heading')
  await expect(page.getByRole('button', { name: translations.tr.adminPages.pageContent.saveChanges, exact: true })).toBeVisible()
  assert.equal(state.pageContentSaves.length, 0)
})

test('in Turkish, creating, editing and toggling send exactly the same payloads as in English', async (t) => {
  const { page, state } = await open(t, { language: 'tr' })
  const ci = translations.tr.adminPages.contactInterests

  await tab(page, 'tr', 'contact').click({ timeout: 60000 })
  await expect(page.locator('[data-testid="contact-interest-row"]')).toHaveCount(9, { timeout: 60000 })

  await manager(page).getByRole('button', { name: ci.add, exact: true }).click()
  const addForm = page.getByRole('form', { name: ci.newInterest })
  await addForm.getByLabel(ci.languageLabels.en).fill('Investment Consultation')
  await addForm.getByLabel(ci.languageLabels.tr).fill('Yatırım Danışmanlığı')
  await addForm.getByRole('button', { name: ci.create, exact: true }).click()

  await expect.poll(() => callsTo(state, 'POST', /^\/contact\/interests$/).length).toBe(1)
  assert.deepEqual(callsTo(state, 'POST', /^\/contact\/interests$/)[0].body,
    { labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' }, enabled: true, order: 10 })
  await expect(row(page, 'investment_consultation').getByTestId('contact-interest-name')).toHaveText('Yatırım Danışmanlığı')

  const editName = ci.editNamed.replace('{name}', 'İç Mimarlık')
  await row(page, 'interior_design').getByRole('button', { name: editName, exact: true }).click()
  const editForm = page.getByRole('form', { name: editName })
  await editForm.getByLabel(ci.order).fill('0')
  await editForm.getByRole('button', { name: ci.save, exact: true }).click()

  await expect.poll(() => callsTo(state, 'PATCH', /interior_design$/).length).toBe(1)
  const patch = callsTo(state, 'PATCH', /interior_design$/)[0]
  assert.equal(patch.path, '/contact/interests/interior_design')
  assert.deepEqual(Object.keys(patch.body).sort(), ['enabled', 'labels', 'order'])
  assert.equal(patch.body.order, 0)
  assert.deepEqual(patch.body.labels, DEFAULT_CONTACT_INTERESTS.find((i) => i.id === 'interior_design').labels)

  await row(page, 'buying').getByRole('button', { name: ci.disableNamed.replace('{name}', 'Satın Alma'), exact: true }).click()
  await expect(row(page, 'buying')).toContainText(ci.disabled)
  assert.deepEqual(callsTo(state, 'PATCH', /buying$/).at(-1).body, { enabled: false })

  await page.screenshot({ path: join(tmpdir(), 'varlikent-page-content-tr.png'), fullPage: true })
})
