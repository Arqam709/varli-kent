// Public localization gaps — the leaks left after Phases 1–3.
//
// Construction page lists, price wording, SEO descriptions and sign-in errors,
// each checked in ALL SIX languages: the earlier phases were complete in
// Turkish and Arabic while German, Russian and Urdu silently fell back to
// English, and nothing failed. Static source contracts plus catalogue and pure
// function checks; the rendered half lives in
// tests/browser/publicLocalization.test.js. Run with `node --test` from
// frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import translations from '../src/locales/translations.js'
import { formatPrice } from '../src/lib/formatPrice.js'
import { localeFor } from '../src/lib/locale.js'
import { authErrorKey } from '../src/lib/authErrors.js'
import { siteMeta } from '../src/lib/useSeo.js'

const here = dirname(fileURLToPath(import.meta.url))
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const OTHERS = LANGS.filter((lang) => lang !== 'en')
const get = (lang, path) => path.split('.').reduce((node, key) => (node == null ? node : node[key]), translations[lang])
const isText = (value) => typeof value === 'string' && value.trim() !== ''

// The script a language is written in — what tells a real translation from an
// English sentence parked under another language's key.
const SCRIPT = { ar: /[؀-ۿ]/, ur: /[؀-ۿ]/, ru: /[Ѐ-ӿ]/ }

// Comments stripped, so prose describing an old string never counts.
const read = async (rel) =>
  (await readFile(join(here, '..', 'src', rel), 'utf8'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

// ── 1. Construction page lists ─────────────────────────────────────────────
// [catalogue key, the fields each item must translate, the field that stays
// the same number in every language]
const CONSTRUCTION_LISTS = [
  ['services', ['title', 'desc'], 'num'],
  ['processSteps', ['label'], 'step'],
  ['seismicItems', ['title', 'desc'], null],
]

for (const [key, fields, counter] of CONSTRUCTION_LISTS) {
  test(`1. constructionPage.${key} is translated, item for item, in all six languages`, () => {
    const english = translations.en.constructionPage[key]
    assert.ok(Array.isArray(english) && english.length > 0, `en.constructionPage.${key}`)

    for (const lang of LANGS) {
      const list = translations[lang].constructionPage[key]
      assert.ok(Array.isArray(list), `${lang}.constructionPage.${key} is missing`)
      assert.equal(list.length, english.length, `${lang}.${key} has every item`)

      list.forEach((item, i) => {
        if (counter) assert.equal(item[counter], english[i][counter], `${lang}.${key}[${i}].${counter}`)
        for (const field of fields) {
          assert.ok(isText(item[field]), `${lang}.${key}[${i}].${field}`)
          if (lang === 'en') continue
          assert.notEqual(item[field], english[i][field], `${lang}.${key}[${i}].${field} is still English`)
          if (SCRIPT[lang]) assert.match(item[field], SCRIPT[lang], `${lang}.${key}[${i}].${field} is not written in ${lang}`)
        }
      })
    }
  })
}

test('1. the sample project shown before a featured project exists is translated', () => {
  const english = translations.en.constructionPage
  assert.equal(english.phases.length, 6)

  for (const lang of LANGS) {
    const page = translations[lang].constructionPage
    assert.equal(page.phases?.length, 6, `${lang}.constructionPage.phases`)
    assert.ok(isText(page.sampleProject?.name) && isText(page.sampleProject?.completion), `${lang}.sampleProject`)
    if (lang === 'en') continue
    page.phases.forEach((label, i) => assert.notEqual(label, english.phases[i], `${lang}.phases[${i}] is still English`))
    assert.notEqual(page.sampleProject.name, english.sampleProject.name, `${lang}.sampleProject.name`)
    assert.notEqual(page.sampleProject.completion, english.sampleProject.completion, `${lang}.sampleProject.completion`)
  }
})

test('1. ConstructionPage renders those lists from the catalogue, with no English default to fall back to', async () => {
  const source = await read('pages/ConstructionPage.jsx')
  assert.match(source, /const \{ services, processSteps, seismicItems \} = p\b/)
  assert.match(source, /p\.phases\.map\(/)
  assert.match(source, /project\?\.name \|\| p\.sampleProject\.name/)
  assert.match(source, /project\?\.completion \|\| p\.sampleProject\.completion/)
  // The fallback that hid the missing German, Russian and Urdu lists.
  assert.doesNotMatch(source, /\|\|\s*DEFAULT_/)
  assert.doesNotMatch(source, /\|\|\s*['"`][A-Z]/, 'no `|| \'English text\'` fallback')
})

// ── 2. Price wording ───────────────────────────────────────────────────────
// Digits are formatted by the runtime, so expectations are built from the same
// locale table the app uses rather than typed out per ICU version.
const amount = (value, lang) => value.toLocaleString(localeFor(lang))

test('2. the price catalogue exists in all six languages', () => {
  assert.equal(translations.en.price.onRequest, 'Price on request')
  assert.equal(translations.en.price.perMonth, '{price}/mo')
  assert.equal(translations.tr.price.perMonth, '{price}/ay')

  for (const lang of LANGS) {
    assert.ok(isText(get(lang, 'price.onRequest')), `${lang}.price.onRequest`)
    assert.match(get(lang, 'price.perMonth'), /\{price\}/, `${lang}.price.perMonth keeps its placeholder`)
  }
  for (const lang of OTHERS) {
    assert.notEqual(get(lang, 'price.onRequest'), translations.en.price.onRequest, `${lang}.price.onRequest is still English`)
    assert.notEqual(get(lang, 'price.perMonth'), translations.en.price.perMonth, `${lang}.price.perMonth is still English`)
  }
})

for (const lang of LANGS) {
  test(`2. formatPrice speaks ${lang}: on request, monthly rent, and an untouched sale price`, () => {
    const { onRequest, perMonth } = translations[lang].price

    for (const missing of [undefined, null, '', 'not a number']) {
      assert.equal(formatPrice(missing, 'Sale', '$', lang), onRequest, `price ${JSON.stringify(missing)}`)
    }

    // A sale price is the amount and its currency — nothing appended.
    assert.equal(formatPrice(1250000, 'Sale', '$', lang), `$${amount(1250000, lang)}`)
    assert.equal(formatPrice(1250000, 'Sale', '', lang), `$${amount(1250000, lang)}`, 'no currency label defaults to $')

    // Rent carries the localized monthly wording, for every supported currency.
    for (const [label, symbol] of [['$', '$'], ['€', '€'], ['£', '£'], ['₺', '₺'], ['TL', '₺'], ['', '$']]) {
      const expected = perMonth.replace('{price}', `${symbol}${amount(2500, lang)}`)
      assert.equal(formatPrice(2500, 'Rent', label, lang), expected, `${lang} rent in ${label || 'default currency'}`)
      assert.ok(expected.includes(`${symbol}${amount(2500, lang)}`))
    }
    if (lang !== 'en') {
      assert.ok(!formatPrice(2500, 'Rent', '$', lang).includes('/mo'), 'no English suffix')
      assert.notEqual(formatPrice(null, 'Rent', '$', lang), 'Price on request')
    }

    // An admin's own free-text price label is content, shown exactly as typed.
    assert.equal(formatPrice(2500, 'Rent', 'Contact agent', lang), 'Contact agent')
  })
}

test('2. English prices read exactly as they did before', () => {
  assert.equal(formatPrice(2500, 'Rent', '$', 'en'), '$2,500/mo')
  assert.equal(formatPrice(2500, 'Rent', 'TL', 'en'), '₺2,500/mo')
  assert.equal(formatPrice(1250000, 'Sale', '€', 'en'), '€1,250,000')
  assert.equal(formatPrice(null, 'Sale', '', 'en'), 'Price on request')
  // No language, or one the catalogue does not have, is English — never a crash.
  assert.equal(formatPrice(2500, 'Rent', '$'), '$2,500/mo')
  assert.equal(formatPrice(undefined, 'Rent', '$', 'xx'), 'Price on request')
  assert.equal(formatPrice(2500, 'Rent', '$', 'tr'), '$2.500/ay')
  assert.equal(formatPrice(2500, 'Rent', '€', 'de'), '€2.500/Monat')
})

test('2. formatPrice has no language branches, and every public caller passes the language', async () => {
  const lib = await read('lib/formatPrice.js')
  assert.doesNotMatch(lib, /language\s*===/)
  assert.match(lib, /listingType === 'Rent'/, 'the canonical enum value still decides')

  const callers = {
    'components/PropertyCard.jsx': 1,
    'components/PropertyMapView.jsx': 1,
    'pages/PropertyDetailsPage.jsx': 2,
  }
  for (const [file, count] of Object.entries(callers)) {
    const calls = (await read(file)).match(/formatPrice\([^)]*\)/g) || []
    assert.equal(calls.length, count, `${file} calls formatPrice ${count} time(s)`)
    for (const call of calls) assert.match(call, /, language\)$/, `${file}: ${call}`)
  }
})

// ── 3. Small public strings ────────────────────────────────────────────────
const SMALL_KEYS = {
  'privacyPolicy.label': ['pages/PrivacyPolicyPage.jsx', '{p.label}'],
  'renovationPage.revealSlider': ['pages/RenovationPage.jsx', 'aria-label={p.revealSlider}'],
  'settingsPage.avatarAlt': ['pages/SettingsPage.jsx', 'alt={s.avatarAlt}'],
  // Found by the follow-up scan of the public pages.
  'propertyDetails.bedrooms': ['pages/PropertyDetailsPage.jsx', 'label: pd.bedrooms,'],
  'propertyDetails.bathrooms': ['pages/PropertyDetailsPage.jsx', 'label: pd.bathrooms,'],
  'propertyDetails.area': ['pages/PropertyDetailsPage.jsx', 'label: pd.area,'],
  'architecturePage.stats.projects': ['pages/ArchitecturePage.jsx', 'label: p.stats.projects }'],
  'architecturePage.stats.years': ['pages/ArchitecturePage.jsx', 'label: p.stats.years }'],
  'architecturePage.stats.awards': ['pages/ArchitecturePage.jsx', 'label: p.stats.awards }'],
  'architecturePage.stats.satisfaction': ['pages/ArchitecturePage.jsx', 'label: p.stats.satisfaction }'],
}

for (const [path, [file, usage]] of Object.entries(SMALL_KEYS)) {
  test(`3. ${path} is translated in all six languages and read by ${file}`, async () => {
    for (const lang of LANGS) assert.ok(isText(get(lang, path)), `${lang}.${path}`)
    for (const lang of OTHERS) assert.notEqual(get(lang, path), get('en', path), `${lang}.${path} is still English`)
    assert.ok((await read(file)).includes(usage), usage)
  })
}

for (const file of ['pages/LoginPage.jsx', 'pages/RegisterPage.jsx']) {
  test(`3. ${file} takes its email placeholder from the catalogue`, async () => {
    assert.ok((await read(file)).includes('placeholder={t.contactPage.emailPlaceholder}'))
    for (const lang of LANGS) assert.ok(isText(get(lang, 'contactPage.emailPlaceholder')), lang)
  })
}

test('3. ForgotPassword shows its own translated error, not the response text', async () => {
  const source = await read('pages/ForgotPassword.jsx')
  assert.ok(source.includes('setError(p.genericError)'))
  assert.doesNotMatch(source, /setError\([^)]*\.message/)
  for (const lang of LANGS) assert.ok(isText(get(lang, 'forgotPasswordPage.genericError')), lang)
})

// ── 4. SEO metadata ────────────────────────────────────────────────────────
const SEO_PAGES = {
  'pages/HomePage.jsx': 'home',
  'pages/PropertiesPage.jsx': 'properties',
  'pages/AboutPage.jsx': 'about',
  'pages/TeamPage.jsx': 'team',
  'pages/ContactPage.jsx': 'contact',
  'pages/PrivacyPolicyPage.jsx': 'privacy',
  'pages/ArchitecturePage.jsx': 'architecture',
  'pages/ConstructionPage.jsx': 'construction',
  'pages/RenovationPage.jsx': 'renovation',
  'pages/InteriorDesignPage.jsx': 'interior',
}
const seoCall = (source) => source.match(/useSeo\(\{[\s\S]*?\n\s*\}\)/)?.[0] || ''

for (const [file, key] of Object.entries(SEO_PAGES)) {
  test(`4. ${file} describes itself with t.seoDescriptions.${key} and tells useSeo the language`, async () => {
    const call = seoCall(await read(file))
    assert.match(call, new RegExp(`description: t\\.seoDescriptions\\.${key},`))
    assert.match(call, /^\s*language,$/m)
    assert.doesNotMatch(call, /description: ['"`]/, 'no English description literal')
  })
}

test('4. property details builds its description from translated templates', async () => {
  const call = seoCall(await read('pages/PropertyDetailsPage.jsx'))
  assert.match(call, /t\.seoDescriptions\.propertySummary/)
  assert.match(call, /: t\.seoDescriptions\.propertyDetails,/)
  assert.match(call, /listingTypeLabel\(property\.listingType, language\)/)
  assert.match(call, /^\s*language,$/m)
  for (const lang of LANGS) {
    for (const placeholder of ['listing', 'title', 'district', 'beds', 'baths', 'sqm']) {
      assert.ok(get(lang, 'seoDescriptions.propertySummary').includes(`{${placeholder}}`), `${lang} keeps {${placeholder}}`)
    }
  }
})

test('4. every SEO description exists in all six languages, distinct, and not left in English', () => {
  const keys = Object.keys(translations.en.seoDescriptions)
  for (const key of ['site', 'propertyDetails', 'propertySummary', ...Object.values(SEO_PAGES)]) assert.ok(keys.includes(key), key)

  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(translations[lang].seoDescriptions).sort(), [...keys].sort(), lang)
    const values = keys.map((key) => translations[lang].seoDescriptions[key])
    for (const [i, value] of values.entries()) assert.ok(isText(value), `${lang}.seoDescriptions.${keys[i]}`)
    assert.equal(new Set(values).size, values.length, `${lang} descriptions are distinct`)

    if (lang === 'en') continue
    for (const key of keys) {
      assert.notEqual(translations[lang].seoDescriptions[key], translations.en.seoDescriptions[key], `${lang}.seoDescriptions.${key} is still English`)
    }
  }
})

test('4. the site-wide default title and description follow the language, and stay safe without one', async () => {
  for (const lang of LANGS) {
    const site = siteMeta(lang)
    assert.equal(site.title, translations[lang].seo.siteTitle)
    assert.equal(site.description, translations[lang].seoDescriptions.site)
    assert.ok(isText(site.title) && isText(site.description), lang)
  }
  for (const lang of OTHERS) {
    assert.notEqual(siteMeta(lang).title, siteMeta('en').title, `${lang} default title is still English`)
    assert.notEqual(siteMeta(lang).description, siteMeta('en').description, `${lang} default description is still English`)
  }

  // A page that passes no language — or an unknown one — still gets metadata.
  for (const missing of [undefined, null, '', 'xx']) assert.deepEqual(siteMeta(missing), siteMeta('en'))

  // English is the wording index.html ships, so a crawler that runs no
  // JavaScript and one that does see the same default title.
  const indexHtml = await readFile(join(here, '..', 'index.html'), 'utf8')
  const staticTitle = indexHtml.match(/<title>([^<]+)<\/title>/)[1].replace(/&amp;/g, '&')
  assert.equal(siteMeta('en').title, staticTitle)

  const hook = await read('lib/useSeo.js')
  assert.match(hook, /title \? `\$\{title\} \| VarliKent` : site\.title/)
  assert.match(hook, /description \|\| site\.description/)
  assert.match(hook, /document\.title = site\.title/, 'leaving a page restores the localized default')
  assert.match(hook, /\[title, description, image, path, type, jsonLd, language\]/)
})

// ── 5. Sign-in and sign-up errors ──────────────────────────────────────────
const http = (status, data = {}) => ({ response: { status, data } })
const noResponse = { request: {}, message: 'Network Error' }

test('5. a failed password login maps to a translated message by status', () => {
  assert.equal(authErrorKey('login', http(401, { message: 'Invalid credentials' })), 'invalidCredentials')
  assert.equal(authErrorKey('login', http(400, { errors: [{ msg: 'Valid email is required' }] })), 'checkDetails')
  assert.equal(authErrorKey('login', http(500, { message: 'Internal Server Error' })), 'signInFailed')
  assert.equal(authErrorKey('login', http(418)), 'signInFailed', 'an unknown status degrades to the general message')
  assert.equal(authErrorKey('login', noResponse), 'networkError')
  assert.equal(authErrorKey('login', undefined), 'signInFailed')
})

test('5. registration, Google and Microsoft failures map the same way', () => {
  assert.equal(authErrorKey('register', http(400, { message: 'Email already in use' })), 'emailInUse')
  assert.equal(authErrorKey('register', http(400, { errors: [{ msg: 'Name is required' }] })), 'checkDetails')
  assert.equal(authErrorKey('register', http(500)), 'registrationFailed')
  assert.equal(authErrorKey('register', noResponse), 'networkError')

  assert.equal(authErrorKey('google', http(401, { message: 'Google sign in failed' })), 'googleSignInFailed')
  assert.equal(authErrorKey('google', http(403, { message: 'Your account is deactivated' })), 'accountUnavailable')
  assert.equal(authErrorKey('google', http(503)), 'googleSignInFailed')

  assert.equal(authErrorKey('microsoft', http(403, { message: 'Your account is deactivated' })), 'accountUnavailable')
  assert.equal(authErrorKey('microsoft', http(401, { message: 'Microsoft login failed' })), 'microsoftSignInFailed')
  // An MSAL error is not an HTTP response at all.
  assert.equal(authErrorKey('microsoft', new Error('user_cancelled: User cancelled the flow.')), 'microsoftSignInFailed')
})

test('5. the backend\'s wording never decides what is shown', () => {
  for (const message of ['Invalid credentials', 'Geçersiz bilgiler', '', undefined, 'anything at all']) {
    assert.equal(authErrorKey('login', http(401, { message })), 'invalidCredentials')
  }
})

const AUTH_ERROR_KEYS = ['invalidCredentials', 'checkDetails', 'accountUnavailable', 'networkError', 'signInFailed',
  'emailInUse', 'registrationFailed', 'googleSignInFailed', 'microsoftSignInFailed']

test('5. every message authErrorKey can return exists in all six languages, in its own words', async () => {
  const source = await read('lib/authErrors.js')
  const returned = new Set([...source.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).filter((key) => key in translations.en.auth))
  assert.deepEqual([...returned].sort(), [...AUTH_ERROR_KEYS].sort())

  for (const key of AUTH_ERROR_KEYS) {
    for (const lang of LANGS) assert.ok(isText(get(lang, `auth.${key}`)), `${lang}.auth.${key}`)
    for (const lang of OTHERS) assert.notEqual(get(lang, `auth.${key}`), get('en', `auth.${key}`), `${lang}.auth.${key} is still English`)
  }
})

test('5. Login and Register show the mapped message and never the response text', async () => {
  const login = await read('pages/LoginPage.jsx')
  for (const call of ["authErrorKey('login', result.error)", "authErrorKey('google', error)", "authErrorKey('microsoft', error)"]) {
    assert.ok(login.includes(`toast.error(a[${call}])`), call)
  }
  assert.equal((login.match(/authErrorKey\('microsoft', error\)/g) || []).length, 2, 'redirect start and redirect completion')

  const register = await read('pages/RegisterPage.jsx')
  assert.ok(register.includes("toast.error(a[authErrorKey('register', result.error)])"))

  for (const source of [login, register]) {
    assert.doesNotMatch(source, /toast\.error\([^)]*\.message/, 'no raw message in a toast')
    assert.doesNotMatch(source, /language\s*===/)
  }
  // The raw response is still logged for whoever is debugging.
  assert.match(login, /console\.log\('Backend response:', error\.response\?\.data\)/)
  assert.match(login, /console\.log\('Login error:', result\.message\)/)

  const context = await read('contexts/AuthContext.jsx')
  assert.equal((context.match(/return \{ success: false, message, error: err \}/g) || []).length, 2, 'login and register hand the error to the page')
})
