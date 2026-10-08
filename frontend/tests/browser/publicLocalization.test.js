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
import { localeFor } from '../../src/lib/locale.js'

let server
let browser
let base
const FIXTURE = '/__public-l10n.html'

// One harness, one screen per page under test (picked by ?screen=), plus a tiny language
// switcher so a test can change language WITHOUT reloading the page.
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LanguageProvider,useLanguage} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {FavouritesProvider} from '/src/contexts/FavouritesContext.jsx'; import {ToastContainer} from 'react-toastify';
import PropertyDetailsPage from '/src/pages/PropertyDetailsPage.jsx'; import ContactPage from '/src/pages/ContactPage.jsx';
import ResetPassword from '/src/pages/ResetPassword.jsx'; import Navbar from '/src/components/Navbar.jsx'; import '/src/index.css';
import ConstructionPage from '/src/pages/ConstructionPage.jsx'; import LoginPage from '/src/pages/LoginPage.jsx'; import RegisterPage from '/src/pages/RegisterPage.jsx';
import PropertyCard from '/src/components/PropertyCard.jsx'; import {GoogleOAuthProvider} from '@react-oauth/google';
import {ThemeProvider} from '/src/contexts/ThemeContext.jsx'; import {ChatProvider} from '/src/contexts/ChatContext.jsx';
import SettingsPage from '/src/pages/SettingsPage.jsx'; import FavouritesPage from '/src/pages/FavouritesPage.jsx'; import ForgotPassword from '/src/pages/ForgotPassword.jsx';
import RenovationPage from '/src/pages/RenovationPage.jsx'; import InteriorDesignPage from '/src/pages/InteriorDesignPage.jsx';
import ProtectedRoute from '/src/components/ProtectedRoute.jsx'; import HomePage from '/src/pages/HomePage.jsx'; import AboutPage from '/src/pages/AboutPage.jsx';
const e=React.createElement;
const card=(extra)=>({district:'Kadıköy',address:'Fixture Sokak 1',status:'Available',beds:2,baths:1,sqm:90,images:[],...extra});
const CARDS=[card({_id:'c1',title:'Rent Fixture',listingType:'Rent',propertyType:'Apartment',price:2500,priceLabel:'$'}),
  card({_id:'c2',title:'Sale Fixture',listingType:'Sale',propertyType:'Villa',price:1250000,priceLabel:'€'}),
  card({_id:'c3',title:'On Request Fixture',listingType:'Rent',propertyType:'Office',price:null,priceLabel:''})];
const Switcher=()=>{const {setLanguage}=useLanguage();return e('div',{id:'switcher'},['en','tr','ar','de','ru','ur'].map(l=>e('button',{key:l,id:'set-'+l,onClick:()=>setLanguage(l)},l)))};
const screen=new URLSearchParams(location.search).get('screen');
const entry={details:'/properties/p1',contact:'/contact',reset:'/reset-password?token=abc',resetNoToken:'/reset-password',navbar:'/',construction:'/construction',login:'/login',register:'/register',cards:'/cards',settings:'/settings',favourites:'/favourites',forgot:'/forgot-password',renovation:'/renovation',interior:'/interior-design',home:'/home',about:'/about'}[screen];
createRoot(document.getElementById('root')).render(e(GoogleOAuthProvider,{clientId:'fixture-client'},e(MemoryRouter,{initialEntries:[entry]},e(LanguageProvider,null,e(AuthProvider,null,e(ThemeProvider,null,e(ChatProvider,null,e(FavouritesProvider,null,
  e(Switcher),e(ToastContainer),
  e(Routes,null,
    e(Route,{path:'/properties/:id',element:e(PropertyDetailsPage)}),
    e(Route,{path:'/contact',element:e(ContactPage)}),
    e(Route,{path:'/reset-password',element:e(ResetPassword)}),
    e(Route,{path:'/construction',element:e(ConstructionPage)}),
    e(Route,{path:'/login',element:e(LoginPage)}),
    e(Route,{path:'/register',element:e(RegisterPage)}),
    e(Route,{path:'/cards',element:e('div',{id:'cards'},CARDS.map(p=>e(PropertyCard,{key:p._id,property:p})))}),
    e(Route,{path:'/settings',element:e(ProtectedRoute,null,e(SettingsPage))}),
    e(Route,{path:'/favourites',element:e(ProtectedRoute,null,e(FavouritesPage))}),
    e(Route,{path:'/forgot-password',element:e(ForgotPassword)}),
    e(Route,{path:'/renovation',element:e(RenovationPage)}),
    e(Route,{path:'/interior-design',element:e(InteriorDesignPage)}),
    e(Route,{path:'/home',element:e(HomePage)}),
    e(Route,{path:'/about',element:e(AboutPage)}),
    e(Route,{path:'/',element:e(Navbar)}))))))))));
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

// A canned reply for an auth route, or 'abort' for a request that never gets one.
const answer = (route, reply) => (reply === 'abort' ? route.abort() : route.fulfill(reply || { status: 200, json: { success: true } }))

// A signed-in visitor, for the screens that need one.
const USER = { _id: 'fixture-user', role: 'user', name: 'Fixture Visitor', email: 'visitor@example.test', themePreference: 'default', createdAt: '2025-01-02T12:00:00Z' }

// `replies` is read on every request, so a test can change what the server
// says between two submissions without reloading the page.
async function open(t, screen, { language = 'tr', resetReply, loginReply, registerReply, property = PROPERTY, user = null, replies = {}, palettes = {}, pageContent = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  page.on('pageerror', (error) => console.error('Fixture page error:', error.message))

  await page.addInitScript(({ lang, user }) => {
    localStorage.setItem('vk_lang', lang)
    localStorage.setItem('vk_lang_explicit', '1')
    localStorage.setItem('vk_lang_default_migrated', '1')
    if (user) {
      localStorage.setItem('varlikent_token', 'isolated-fixture-token')
      localStorage.setItem('varlikent_user', JSON.stringify(user))
    }
  }, { lang: language, user })

  const calls = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort()
    const path = url.pathname.split('/api')[1]
    calls.push({ path, method: route.request().method() })

    if (path === '/properties/p1') return route.fulfill({ json: { success: true, property } })
    if (path === '/auth/login') return answer(route, loginReply)
    if (path === '/auth/register') return answer(route, registerReply)
    if (path === '/auth/me') return route.fulfill({ json: { user } })
    if (path === '/users/me/profile') return answer(route, replies.profile || { status: 200, json: { success: true, user } })
    if (path === '/users/me/password') return answer(route, replies.password)
    if (path === '/contact') return answer(route, replies.contact)
    if (path === '/about') return route.fulfill({ json: { success: true, about: replies.about || null } })
    if (path === '/users/favourites') return route.fulfill({ json: { favourites: [] } })
    if (path === '/chat/conversations') return route.fulfill({ json: { conversations: [] } })
    if (path.startsWith('/studio-palette/')) return route.fulfill({ json: { success: true, palette: palettes[path.split('/').pop()] || null } })
    if (path === '/properties') return route.fulfill({ json: { success: true, properties: [] } })
    if (path.startsWith('/page-content/')) return route.fulfill({ json: pageContent || { fields: {}, sections: {} } })
    if (path === '/auth/reset-password') {
      return route.fulfill(resetReply || { status: 200, json: { success: true } })
    }
    return route.fulfill({ json: { success: true } })
  })

  await page.goto(`${base}${FIXTURE}?screen=${screen}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  return { page, calls }
}

// What every account screen (login, register, password reset, settings,
// favourites) must report: its own translated tab title, the site description
// in the visitor's language, and a request not to be indexed.
async function expectAccountMetadata(page, lang, title) {
  await expect.poll(() => page.title()).toBe(`${title} | VarliKent`)
  assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), translations[lang].seoDescriptions.site)
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow')
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
    await expectAccountMetadata(page, lang, r.title)
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

// ══════════ Public localization gaps — all six languages ══════════
//
// Everything below is checked in en, tr, ar, de, ru and ur: the earlier phases
// were verified in Turkish while German, Russian and Urdu fell back to English.
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const direction = (lang) => (['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr')
// What the fixture server says in its `message`. Deliberately not a sentence
// from any catalogue, so "it is not on the page" cannot pass by coincidence.
const SERVER_TEXT = 'RAW-SERVER-SENTENCE-9f3a'

// textContent, not innerText: it includes sections still waiting for their
// scroll-in animation, and is not altered by CSS text-transform.
const bodyText = async (page) => (await page.evaluate(() => document.body.textContent)).replace(/\s+/g, ' ')
const metaDescription = (page) => page.locator('meta[name="description"]').getAttribute('content')
// Digits as THIS browser formats them for the language's locale.
const amountIn = (page, lang, value) => page.evaluate(([n, locale]) => n.toLocaleString(locale), [value, localeFor(lang)])

// ── Construction page ────────────────────────────────────────────────────
const constructionStrings = (lang) => {
  const c = translations[lang].constructionPage
  return {
    services: c.services.flatMap((item) => [item.title, item.desc]),
    process: c.processSteps.map((item) => item.label),
    seismic: c.seismicItems.flatMap((item) => [item.title, item.desc]),
    progress: [...c.phases, c.sampleProject.name, c.sampleProject.completion],
  }
}

for (const lang of LANGS) {
  test(`construction page: services, process, seismic items and metadata render in ${lang}`, async (t) => {
    const { page } = await open(t, 'construction', { language: lang })
    const c = translations[lang].constructionPage

    await expect(page.getByRole('heading', { level: 1, name: c.h1 })).toBeAttached({ timeout: 45000 })
    await expect(page.locator('html')).toHaveAttribute('lang', lang)
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))

    const text = await bodyText(page)
    for (const [section, strings] of Object.entries(constructionStrings(lang))) {
      for (const string of strings) assert.ok(text.includes(string), `${lang} ${section}: "${string}" is not rendered`)
    }
    if (lang !== 'en') {
      for (const [section, strings] of Object.entries(constructionStrings('en'))) {
        for (const string of strings) assert.ok(!text.includes(string), `${lang} ${section}: English "${string}" is still rendered`)
      }
    }

    assert.equal(await page.title(), `${translations[lang].seo.construction} | VarliKent`)
    assert.equal(await metaDescription(page), translations[lang].seoDescriptions.construction)
    assert.equal(await page.locator('meta[property="og:description"]').getAttribute('content'), translations[lang].seoDescriptions.construction)
  })
}

test('construction page: lists and meta description follow a language change without reloading', async (t) => {
  const { page } = await open(t, 'construction')
  await expect(page.getByRole('heading', { level: 1, name: translations.tr.constructionPage.h1 })).toBeAttached({ timeout: 45000 })

  for (const lang of ['de', 'ur', 'ru']) {
    await page.click(`#set-${lang}`)
    await expect.poll(() => metaDescription(page)).toBe(translations[lang].seoDescriptions.construction)
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))
    const text = await bodyText(page)
    const c = translations[lang].constructionPage
    assert.ok(text.includes(c.services[0].title) && text.includes(c.processSteps[0].label) && text.includes(c.seismicItems[0].title), lang)
    assert.ok(!text.includes(translations.tr.constructionPage.services[0].title), `${lang}: the Turkish list is gone`)
  }
})

// ── Prices ───────────────────────────────────────────────────────────────
for (const lang of LANGS) {
  test(`property cards: rent suffix, sale price, price on request and type labels in ${lang}`, async (t) => {
    const { page } = await open(t, 'cards', { language: lang })
    const { onRequest, perMonth } = translations[lang].price

    await expect(page.getByText('Rent Fixture')).toBeVisible({ timeout: 45000 })
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))

    const rent = perMonth.replace('{price}', `$${await amountIn(page, lang, 2500)}`)
    await expect(page.getByText(rent, { exact: true })).toBeVisible()
    // Exact, so a sale price carrying any suffix at all would not match.
    await expect(page.getByText(`€${await amountIn(page, lang, 1250000)}`, { exact: true })).toBeVisible()
    await expect(page.getByText(onRequest, { exact: true })).toBeVisible()

    for (const type of ['Apartment', 'Villa', 'Office']) {
      await expect(page.getByText(translations[lang].enums.propertyType[type], { exact: true }).first()).toBeVisible()
    }
    if (lang !== 'en') {
      const text = await bodyText(page)
      for (const english of ['Price on request', '/mo']) assert.ok(!text.includes(english), `${lang}: "${english}" is still shown`)
    }
  })

  test(`property details: rent price, price on request and generated description in ${lang}`, async (t) => {
    const tl = translations[lang]
    const rental = { ...PROPERTY, listingType: 'Rent', price: 3200, priceLabel: '€' }

    const { page } = await open(t, 'details', {
      language: lang,
      property: rental,
      replies: { contact: { status: 500, json: { success: false, message: SERVER_TEXT } } },
    })
    await expect(page.getByRole('heading', { name: tl.propertyDetails.aboutTitle })).toBeVisible({ timeout: 45000 })

    // A message that the server rejects is reported from the catalogue.
    await page.getByPlaceholder(tl.contactPage.namePlaceholder).fill('Fixture Visitor')
    await page.getByPlaceholder(tl.forgotPasswordPage.emailLabel).fill('visitor@example.test')
    await page.getByPlaceholder(tl.contactPage.messagePlaceholder).fill('Is this still available?')
    await page.getByRole('button', { name: tl.contactPage.sendBtn, exact: true }).click()
    await expect(page.getByText(tl.propertyDetails.messageFailed)).toBeVisible()
    assert.ok(!(await page.locator('body').innerText()).includes(SERVER_TEXT), 'the server message is not shown')
    const rent = tl.price.perMonth.replace('{price}', `€${await amountIn(page, lang, 3200)}`)
    await expect(page.getByText(rent, { exact: true })).toBeVisible()
    await expect(page.getByText(tl.enums.listingType.Rent, { exact: true }).first()).toBeVisible()
    for (const label of [tl.propertyDetails.bedrooms, tl.propertyDetails.bathrooms, tl.propertyDetails.area]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }

    // The fixture has no description of its own, so the summary template is used.
    const summary = fill(tl.seoDescriptions.propertySummary, {
      listing: tl.enums.listingType.Rent, title: rental.title, district: rental.district, beds: rental.beds, baths: rental.baths, sqm: rental.sqm,
    })
    assert.equal(await metaDescription(page), summary)
    if (lang !== 'en') assert.ok(!summary.includes('For Rent') && !summary.includes(' bed,'), summary)

    const second = await open(t, 'details', { language: lang, property: { ...rental, price: null } })
    await expect(second.page.getByRole('heading', { name: tl.propertyDetails.aboutTitle })).toBeVisible({ timeout: 45000 })
    await expect(second.page.getByText(tl.price.onRequest, { exact: true })).toBeVisible()
  })
}

// ── Sign-in and sign-up errors ───────────────────────────────────────────
const submitLogin = async (page, a) => {
  await page.getByLabel(a.email, { exact: true }).fill('visitor@example.test')
  await page.getByLabel(a.password, { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: a.signInButton, exact: true }).click()
}

for (const lang of LANGS) {
  test(`login: wrong credentials are reported in ${lang}, not in the server's English`, async (t) => {
    const { page } = await open(t, 'login', {
      language: lang,
      loginReply: { status: 401, json: { success: false, message: 'Invalid credentials' } },
    })
    const a = translations[lang].auth

    await expect(page.getByRole('heading', { name: a.signInTitle })).toBeVisible({ timeout: 45000 })
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))
    await expect(page.getByPlaceholder(translations[lang].contactPage.emailPlaceholder)).toBeVisible()
    await expectAccountMetadata(page, lang, a.signInTitle)

    await submitLogin(page, a)
    await expect(page.getByText(a.invalidCredentials)).toBeVisible()
    assert.ok(!(await page.locator('body').innerText()).includes('Invalid credentials'), 'the server message is not shown')
  })

  test(`register: a taken email address is reported in ${lang}`, async (t) => {
    const { page } = await open(t, 'register', {
      language: lang,
      registerReply: { status: 400, json: { success: false, message: 'Email already in use' } },
    })
    const a = translations[lang].auth

    await expect(page.getByRole('heading', { name: a.createTitle })).toBeVisible({ timeout: 45000 })
    await expectAccountMetadata(page, lang, a.createTitle)
    await expect(page.getByPlaceholder(translations[lang].contactPage.emailPlaceholder)).toBeVisible()
    await page.getByLabel(a.fullName, { exact: true }).fill('Fixture Visitor')
    await page.getByLabel(a.email, { exact: true }).fill('taken@example.test')
    await page.getByLabel(a.password, { exact: true }).fill('longenough')
    await page.getByLabel(a.confirmPassword, { exact: true }).fill('longenough')
    await page.getByRole('button', { name: a.createButton, exact: true }).click()

    await expect(page.getByText(a.emailInUse)).toBeVisible()
    assert.ok(!(await page.locator('body').innerText()).includes('Email already in use'), 'the server message is not shown')
  })
}

for (const [name, loginReply, key, serverText] of [
  ['a server error', { status: 500, json: { success: false, message: 'Internal Server Error' } }, 'signInFailed', 'Internal Server Error'],
  ['an unreachable server', 'abort', 'networkError', 'Network Error'],
]) {
  test(`login: ${name} gets a translated message, never the raw error text`, async (t) => {
    for (const lang of ['tr', 'de', 'ur']) {
      const { page } = await open(t, 'login', { language: lang, loginReply })
      const a = translations[lang].auth
      await expect(page.getByRole('heading', { name: a.signInTitle })).toBeVisible({ timeout: 45000 })
      await submitLogin(page, a)
      await expect(page.getByText(a[key])).toBeVisible()
      const text = await page.locator('body').innerText()
      for (const english of [serverText, 'Login failed']) assert.ok(!text.includes(english), `${lang}: "${english}" is shown`)
    }
  })
}

// ══════════ Step 2B — settings errors, studio palettes, account-screen titles ══════════

// ── Settings ─────────────────────────────────────────────────────────────
const serverSays = (status) => ({ status, json: { success: false, message: SERVER_TEXT } })

for (const lang of LANGS) {
  test(`settings: title and every profile/password failure are reported in ${lang}`, async (t) => {
    const replies = {}
    const { page } = await open(t, 'settings', { language: lang, user: USER, replies })
    const s = translations[lang].settingsPage

    await expect(page.locator('#settings-name')).toBeVisible({ timeout: 45000 })
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))
    await expectAccountMetadata(page, lang, s.accountSettings)

    // The appearance picker names every theme in the visitor's language.
    for (const theme of Object.values(translations[lang].themes)) {
      await expect(page.getByText(theme.label, { exact: true })).toBeVisible()
      await expect(page.getByText(theme.description, { exact: true })).toBeVisible()
    }
    if (lang !== 'en') {
      const picker = await page.locator('body').innerText()
      for (const theme of Object.values(translations.en.themes)) {
        assert.ok(!picker.includes(theme.label) && !picker.includes(theme.description), `${lang}: English theme "${theme.label}" is still shown`)
      }
    }

    await page.locator('#settings-current-password').fill('old-password')
    await page.locator('#settings-new-password').fill('new-password-1')
    await page.locator('#settings-confirm-password').fill('new-password-1')
    for (const [reply, key] of [
      [serverSays(401), 'toastCurrentPasswordIncorrect'],
      [serverSays(400), 'toastPasswordNotSet'],
      [serverSays(500), 'toastPasswordFailed'],
      ['abort', 'toastNetworkError'],
    ]) {
      replies.password = reply
      await page.getByRole('button', { name: s.updatePassword, exact: true }).click()
      await expect(page.getByText(s[key]).first()).toBeVisible()
    }

    for (const [reply, key] of [
      [serverSays(400), 'toastEmailInUse'],
      [serverSays(403), 'toastEmailLocked'],
      [serverSays(500), 'toastProfileFailed'],
    ]) {
      replies.profile = reply
      await page.getByRole('button', { name: s.saveChanges, exact: true }).click()
      await expect(page.getByText(s[key]).first()).toBeVisible()
    }

    assert.ok(!(await page.locator('body').innerText()).includes(SERVER_TEXT), 'the server message is never shown')
  })
}

// ── Favourites and forgot password ───────────────────────────────────────
for (const lang of LANGS) {
  test(`favourites and forgot-password set a translated, non-indexed title in ${lang}`, async (t) => {
    const favourites = await open(t, 'favourites', { language: lang, user: USER })
    const f = translations[lang].favouritesPage
    await expect(favourites.page.getByRole('heading', { level: 1, name: f.heading })).toBeVisible({ timeout: 45000 })
    await expectAccountMetadata(favourites.page, lang, f.heading)
    await expect(favourites.page.locator('html')).toHaveAttribute('dir', direction(lang))

    const forgot = await open(t, 'forgot', { language: lang })
    const p = translations[lang].forgotPasswordPage
    await expect(forgot.page.getByRole('heading', { level: 1, name: p.title })).toBeVisible({ timeout: 45000 })
    await expectAccountMetadata(forgot.page, lang, p.title)
  })
}

test('a page left for an account screen hands over its title and its robots tag', async (t) => {
  // Same document, two routes: the public page indexes, the account page does not.
  const { page } = await open(t, 'construction', { language: 'de' })
  await expect(page.getByRole('heading', { level: 1, name: translations.de.constructionPage.h1 })).toBeAttached({ timeout: 45000 })
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index, follow')
  assert.equal(await page.title(), `${translations.de.seo.construction} | VarliKent`)
})

// ── Studio palettes ──────────────────────────────────────────────────────
const paletteNames = (lang) => Object.values(translations[lang].studioPalette).flatMap((list) => Object.values(list))

// Everything a visitor can read a palette name from: each piece of page text
// and each swatch tooltip (Renovation shows its wall and floor finishes only
// there), one per line — neighbouring swatch labels have nothing between them
// in the DOM, and must not read as one long word.
const paletteSurface = (page) => page.evaluate(() => {
  const pieces = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) pieces.push(walker.currentNode.data)
  for (const el of document.querySelectorAll('[title]')) pieces.push(el.getAttribute('title'))
  return pieces.join('\n')
})

// As a whole name: "Beton" must not be found inside "Sichtbeton".
const mentions = (surface, name) =>
  new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(surface)

const STUDIO_PAGES = { renovation: 'renovationPage', interior: 'interiorPage' }

for (const [screen, section] of Object.entries(STUDIO_PAGES)) {
  for (const lang of LANGS) {
    test(`${screen}: all 18 default palette names render in ${lang}`, async (t) => {
      const { page } = await open(t, screen, { language: lang })
      await expect(page.getByRole('heading', { level: 1, name: translations[lang][section].h1 })).toBeAttached({ timeout: 45000 })
      await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))

      const surface = await paletteSurface(page)
      const own = paletteNames(lang)
      assert.equal(own.length, 18)
      for (const name of own) assert.ok(mentions(surface, name), `${lang} ${screen}: "${name}" is not rendered`)
      if (lang !== 'en') {
        for (const name of paletteNames('en')) assert.ok(!mentions(surface, name), `${lang} ${screen}: English "${name}" is still rendered`)
      }
    })
  }
}

test('studio palette: names follow a language change, and an admin-saved list is shown as typed', async (t) => {
  const { page } = await open(t, 'interior')
  await expect(page.getByRole('heading', { level: 1, name: translations.tr.interiorPage.h1 })).toBeAttached({ timeout: 45000 })
  for (const lang of ['de', 'ar']) {
    await page.click(`#set-${lang}`)
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))
    await expect.poll(async () => mentions(await paletteSurface(page), translations[lang].studioPalette.materials.agedBrass)).toBe(true)
    const surface = await paletteSurface(page)
    for (const name of paletteNames(lang)) assert.ok(mentions(surface, name), `${lang}: "${name}"`)
    // "Beton" is concrete in both Turkish and German, so only names that differ can be gone.
    const turkishOnly = paletteNames('tr').filter((name) => !paletteNames(lang).includes(name))
    for (const name of turkishOnly) assert.ok(!mentions(surface, name), `${lang}: Turkish "${name}" is gone`)
  }

  // Only the materials were saved by an admin; the two finish lists were not.
  const saved = await open(t, 'renovation', {
    palettes: { renovation: { materials: [{ name: 'Özel Traverten', color: '#c8b8a0', image: '' }] } },
  })
  await expect(saved.page.getByRole('heading', { level: 1, name: translations.tr.renovationPage.h1 })).toBeAttached({ timeout: 45000 })
  await expect.poll(async () => mentions(await paletteSurface(saved.page), 'Özel Traverten')).toBe(true)
  const surface = await paletteSurface(saved.page)
  const tr = translations.tr.studioPalette
  for (const name of Object.values(tr.materials)) assert.ok(!mentions(surface, name), `default material "${name}" was replaced`)
  for (const name of [...Object.values(tr.wallFinishes), ...Object.values(tr.floorFinishes)]) assert.ok(mentions(surface, name), `default finish "${name}" is still translated`)
})

// ── Homepage sample testimonials ─────────────────────────────────────────
for (const lang of LANGS) {
  test(`homepage: the testimonials shown when no review exists are in ${lang}`, async (t) => {
    // The fixture server returns no reviews, which is exactly when these appear.
    const { page } = await open(t, 'home', { language: lang })
    const items = translations[lang].testimonials.items
    await expect.poll(async () => (await bodyText(page)).includes(items[0].text), { timeout: 45000 }).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))

    const text = await bodyText(page)
    for (const item of items) {
      assert.ok(text.includes(item.text) && text.includes(item.role) && text.includes(item.name), `${lang}: "${item.name}" testimonial is not rendered`)
    }
    if (lang !== 'en') {
      for (const item of translations.en.testimonials.items) assert.ok(!text.includes(item.text), `${lang}: English testimonial is still rendered`)
    }
    assert.equal(await page.title(), `${translations[lang].seo.home} | VarliKent`)
    assert.equal(await metaDescription(page), translations[lang].seoDescriptions.home)
  })
}

// ── About page defaults ──────────────────────────────────────────────────
const aboutDefaults = (lang) => {
  const copy = translations[lang].aboutPage
  return [copy.heroLabel, copy.heroHeading, copy.heroSubtext, copy.missionLabel, copy.missionHeading,
    copy.missionParagraph1, copy.missionParagraph2, copy.teamLabel, copy.teamHeading, ...copy.stats, ...copy.teamRoles]
}

for (const lang of LANGS) {
  test(`about: the built-in text shown when nothing is saved is in ${lang}`, async (t) => {
    const { page } = await open(t, 'about', { language: lang })
    const copy = translations[lang].aboutPage
    await expect(page.getByRole('heading', { level: 1, name: copy.heroHeading })).toBeAttached({ timeout: 45000 })
    await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))

    const text = await bodyText(page)
    for (const string of aboutDefaults(lang)) assert.ok(text.includes(string), `${lang}: "${string}" is not rendered`)
    if (lang !== 'en') {
      for (const string of aboutDefaults('en')) assert.ok(!text.includes(string), `${lang}: English "${string}" is still rendered`)
    }
    assert.equal(await page.title(), `${translations[lang].seo.about} | VarliKent`)
  })
}

test('about: a saved record still replaces the built-in text, field by field', async (t) => {
  const saved = {
    heroHeading: { sourceLang: 'tr', tr: 'Kayıtlı Başlık', en: 'Saved Heading' },
    stats: [{ value: '7', label: { sourceLang: 'tr', tr: 'Kayıtlı İstatistik', en: 'Saved Stat' } }],
  }
  const { page } = await open(t, 'about', { replies: { about: saved } })
  await expect(page.getByRole('heading', { level: 1, name: 'Kayıtlı Başlık' })).toBeAttached({ timeout: 45000 })
  const text = await bodyText(page)
  const tr = translations.tr.aboutPage
  assert.ok(text.includes('Kayıtlı İstatistik'))
  assert.ok(!text.includes(tr.heroHeading) && !text.includes(tr.stats[0]), 'the saved fields replaced their defaults')
  assert.ok(text.includes(tr.missionHeading) && text.includes(tr.teamHeading), 'fields the record lacks keep their translated default')
})

// ── CMS Phase B: translation state never reaches, or changes, a public page ─
// The public API strips `meta`. This renders the homepage twice from the same
// hero content — once as the API sends it, once with `meta` left in, as if that
// stripping had failed — and requires the two to be indistinguishable.
const HERO_CONTENT = {
  heroLabel: { type: 'text', sourceLang: 'en', en: 'Istanbul Studio', tr: 'İstanbul Stüdyosu', ar: 'استوديو إسطنبول' },
  // German is a stale translation, Russian failed: neither state may show.
  heroCtaPrimary: { type: 'text', sourceLang: 'en', en: 'Discover Our Services', tr: 'Hizmetlerimizi Keşfedin', de: 'Leistungen entdecken' },
}
const HERO_META = {
  heroLabel: { sourceHash: 'a'.repeat(64), langs: { tr: { from: 'a'.repeat(64), by: 'machine', at: '2026-10-08T12:30:00.000Z' }, ar: { from: 'a'.repeat(64), by: 'machine', at: '2026-10-08T12:30:00.000Z' } } },
  heroCtaPrimary: { sourceHash: 'c'.repeat(64), langs: { tr: { from: 'c'.repeat(64), by: 'machine', at: '2026-10-08T12:30:00.000Z' }, de: { from: 'b'.repeat(64), by: 'machine', at: '2026-10-01T10:00:00.000Z', error: 'timeout', errorAt: '2026-10-08T12:30:00.000Z' }, ru: { error: 'quota', errorAt: '2026-10-08T12:30:00.000Z' } } },
}
const heroWithMeta = Object.fromEntries(Object.entries(HERO_CONTENT).map(([key, field]) => [key, { ...field, meta: HERO_META[key] }]))

for (const lang of LANGS) {
  test(`homepage hero renders the same with or without translation state in ${lang}`, async (t) => {
    const expected = {
      label: HERO_CONTENT.heroLabel[lang] || translations[lang].hero.label,
      button: HERO_CONTENT.heroCtaPrimary[lang] || translations[lang].hero.ctaPrimary,
    }
    const rendered = []
    for (const fields of [HERO_CONTENT, heroWithMeta]) {
      const { page } = await open(t, 'home', { language: lang, pageContent: { success: true, fields, sections: {} } })
      await expect.poll(async () => (await bodyText(page)).includes(expected.label), { timeout: 60000 }).toBe(true)
      const text = await bodyText(page)
      assert.ok(text.includes(expected.button), `${lang}: the hero button reads "${expected.button}"`)
      for (const leaked of ['a'.repeat(64), 'b'.repeat(64), 'sourceHash', 'errorAt', '[object Object]']) {
        assert.equal(text.includes(leaked), false, `${lang}: "${leaked}" is on the page`)
      }
      await expect(page.locator('html')).toHaveAttribute('dir', direction(lang))
      rendered.push({ label: text.includes(expected.label), button: text.includes(expected.button), title: await page.title() })
    }
    assert.deepEqual(rendered[1], rendered[0], 'the page is the same either way')
  })
}
