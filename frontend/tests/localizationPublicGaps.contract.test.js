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
import { settingsErrorKey } from '../src/lib/settingsErrors.js'
import { readdir } from 'node:fs/promises'
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
  assert.match(hook, /\[title, description, image, path, type, jsonLd, language, noindex\]/)
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

// ── 6. Settings error toasts ───────────────────────────────────────────────
test('6. a failed profile or password save maps to a translated message by status', () => {
  assert.equal(settingsErrorKey('profile', http(400, { message: 'Email already in use' })), 'toastEmailInUse')
  assert.equal(settingsErrorKey('profile', http(403, { message: 'The email address of a protected owner account cannot be changed here' })), 'toastEmailLocked')
  assert.equal(settingsErrorKey('profile', http(500, { message: 'Internal Server Error' })), 'toastProfileFailed')
  assert.equal(settingsErrorKey('profile', http(401, { message: 'Not authorized, invalid token' })), 'toastProfileFailed')
  assert.equal(settingsErrorKey('profile', noResponse), 'toastNetworkError')

  assert.equal(settingsErrorKey('password', http(401, { message: 'Current password is incorrect' })), 'toastCurrentPasswordIncorrect')
  assert.equal(settingsErrorKey('password', http(400, { message: 'This account has no password yet. Use "Forgot password" to set one.' })), 'toastPasswordNotSet')
  assert.equal(settingsErrorKey('password', http(500)), 'toastPasswordFailed')
  assert.equal(settingsErrorKey('password', noResponse), 'toastNetworkError')
  assert.equal(settingsErrorKey('password', undefined), 'toastPasswordFailed')

  // The sentence the server sends never decides anything.
  for (const message of ['Current password is incorrect', 'Mevcut şifre hatalı', '', undefined]) {
    assert.equal(settingsErrorKey('password', http(401, { message })), 'toastCurrentPasswordIncorrect')
  }
})

const SETTINGS_ERROR_KEYS = ['toastEmailInUse', 'toastEmailLocked', 'toastProfileFailed', 'toastCurrentPasswordIncorrect',
  'toastPasswordNotSet', 'toastPasswordFailed', 'toastNetworkError']

test('6. every message settingsErrorKey can return exists in all six languages, in its own words', async () => {
  const source = await read('lib/settingsErrors.js')
  const returned = new Set([...source.matchAll(/'(toast[a-zA-Z]+)'/g)].map((m) => m[1]))
  assert.deepEqual([...returned].sort(), [...SETTINGS_ERROR_KEYS].sort())

  for (const key of SETTINGS_ERROR_KEYS) {
    for (const lang of LANGS) assert.ok(isText(get(lang, `settingsPage.${key}`)), `${lang}.settingsPage.${key}`)
    for (const lang of OTHERS) assert.notEqual(get(lang, `settingsPage.${key}`), get('en', `settingsPage.${key}`), `${lang}.settingsPage.${key} is still English`)
  }
})

test('6. SettingsPage shows the mapped message, and still makes the checks that keep the 400s unambiguous', async () => {
  const source = await read('pages/SettingsPage.jsx')
  assert.ok(source.includes("toast.error(s[settingsErrorKey('profile', err)])"))
  assert.ok(source.includes("toast.error(s[settingsErrorKey('password', err)])"))
  assert.doesNotMatch(source, /toast\.error\([^)]*\.message/, 'no raw message in a toast')
  assert.match(source, /console\.log\('Profile update error:'/)
  assert.match(source, /console\.log\('Password change error:'/)

  // lib/settingsErrors.js reads "profile 400" as a taken address and "password
  // 400" as an account with no password ONLY because the form rejects every
  // other cause of those statuses before a request is sent.
  assert.match(source, /if \(!profile\.name\.trim\(\)\) \{ toast\.error\(s\.toastNameEmpty\); return \}/)
  assert.match(source, /if \(!pw\.currentPassword \|\| !pw\.newPassword \|\| !pw\.confirmPassword\) \{ toast\.error\(s\.toastPasswordFieldsRequired\); return \}/)
  assert.match(source, /if \(pw\.newPassword !== pw\.confirmPassword\) \{ toast\.error\(s\.toastPasswordMismatch\); return \}/)
  assert.match(source, /if \(pw\.newPassword\.length < 6\) \{ toast\.error\(s\.toastPasswordTooShort\); return \}/)
})

// ── 7. Property messages ───────────────────────────────────────────────────
const sourceFiles = async (dir = '') => {
  const entries = await readdir(join(here, '..', 'src', dir), { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) return sourceFiles(rel)
    return /\.jsx?$/.test(entry.name) ? [rel] : []
  }))
  return nested.flat()
}

test('7. the helper that passes a server sentence through is used by the agent portal only', async () => {
  // readableError() returns the backend's own English message. That is the
  // agent inbox's (untranslated, deferred) behaviour; no public screen may
  // start using it.
  const users = []
  for (const file of await sourceFiles()) {
    if (file === 'lib/propertyMessagingApi.js') continue
    const source = await read(file)
    if (/readableError|propertyMessagingApi/.test(source)) users.push(file)
  }
  assert.ok(users.length > 0, 'the agent inbox still uses it')
  for (const file of users) assert.match(file, /(^|\/)Agent[A-Z]/, `${file} is not an agent-portal file`)
})

test('7. the public property message form reports failure from the catalogue', async () => {
  const source = await read('pages/PropertyDetailsPage.jsx')
  assert.match(source, /await api\.post\('\/contact', \{[\s\S]*?\}\)\s*toast\.success\(pd\.messageSent\)[\s\S]*?\} catch \{\s*toast\.error\(pd\.messageFailed\)/)
  for (const lang of LANGS) assert.ok(isText(get(lang, 'propertyDetails.messageFailed')), lang)
  for (const lang of OTHERS) assert.notEqual(get(lang, 'propertyDetails.messageFailed'), get('en', 'propertyDetails.messageFailed'), lang)
})

// ── 8. Studio palette defaults ─────────────────────────────────────────────
const PALETTE_LISTS = { materials: 8, wallFinishes: 6, floorFinishes: 4 }
const PALETTE_CONSTANTS = { materials: 'DEFAULT_MATERIALS', wallFinishes: 'DEFAULT_WALL_FINISHES', floorFinishes: 'DEFAULT_FLOOR_FINISHES' }
const paletteIds = (source, constant) => {
  const block = source.match(new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\n\\]`))?.[1] || ''
  return [...block.matchAll(/\{ id: '(\w+)', color: /g)].map((m) => m[1])
}

test('8. every default palette name is translated in all six languages', () => {
  for (const [list, count] of Object.entries(PALETTE_LISTS)) {
    const ids = Object.keys(translations.en.studioPalette[list])
    assert.equal(ids.length, count, `en.studioPalette.${list}`)

    for (const lang of LANGS) {
      assert.deepEqual(Object.keys(translations[lang].studioPalette[list]), ids, `${lang}.studioPalette.${list} has the same ids`)
      for (const id of ids) {
        const name = translations[lang].studioPalette[list][id]
        assert.ok(isText(name), `${lang}.studioPalette.${list}.${id}`)
        if (lang === 'en') continue
        assert.notEqual(name, translations.en.studioPalette[list][id], `${lang}.studioPalette.${list}.${id} is still English`)
        if (SCRIPT[lang]) assert.match(name, SCRIPT[lang], `${lang}.studioPalette.${list}.${id} is not written in ${lang}`)
      }
    }
  }
  assert.equal(Object.values(PALETTE_LISTS).reduce((sum, n) => sum + n, 0), 18)
})

for (const file of ['pages/RenovationPage.jsx', 'pages/InteriorDesignPage.jsx']) {
  test(`8. ${file} keeps ids and colours, and takes the default names from the shared catalogue`, async () => {
    const source = await read(file)
    for (const [list, constant] of Object.entries(PALETTE_CONSTANTS)) {
      assert.deepEqual(paletteIds(source, constant), Object.keys(translations.en.studioPalette[list]), `${constant} matches studioPalette.${list}`)
    }
    assert.doesNotMatch(source, /\{ (name|label): '[^']+', color: /, 'no default carries a hard-coded name')
    assert.match(source, /name: names\.materials\[id\]/)
    assert.match(source, /label: names\.wallFinishes\[id\]/)
    assert.match(source, /label: names\.floorFinishes\[id\]/)
    assert.match(source, /useStudioPalette\('[a-z-]+', t\.studioPalette\)/)
    // An admin-saved palette still wins, list by list.
    assert.match(source, /materials: overrides\.materials \|\| defaults\.materials,/)
    assert.match(source, /wallFinishes: overrides\.wallFinishes \|\| defaults\.wallFinishes,/)
    assert.match(source, /floorFinishes: overrides\.floorFinishes \|\| defaults\.floorFinishes,/)
  })
}

test('8. Renovation and Interior Design use the same ids and the same colours', async () => {
  const renovation = await read('pages/RenovationPage.jsx')
  const interior = await read('pages/InteriorDesignPage.jsx')
  for (const constant of Object.values(PALETTE_CONSTANTS)) {
    const block = (source) => source.match(new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\n\\]`))[1].replace(/\s+/g, ' ')
    assert.equal(block(renovation), block(interior), constant)
  }
})

// ── 9. Account screens title themselves ────────────────────────────────────
const ACCOUNT_PAGES = {
  'pages/LoginPage.jsx': ['a.signInTitle', 'auth.signInTitle'],
  'pages/RegisterPage.jsx': ['a.createTitle', 'auth.createTitle'],
  'pages/ForgotPassword.jsx': ['p.title', 'forgotPasswordPage.title'],
  'pages/ResetPassword.jsx': ['r.title', 'resetPasswordPage.title'],
  'pages/SettingsPage.jsx': ['s.accountSettings', 'settingsPage.accountSettings'],
  'pages/FavouritesPage.jsx': ['t.favouritesPage.heading', 'favouritesPage.heading'],
}

for (const [file, [expression, path]] of Object.entries(ACCOUNT_PAGES)) {
  test(`9. ${file} sets a translated, non-indexed title`, async () => {
    const source = await read(file)
    assert.ok(source.includes(`useSeo({ title: ${expression}, language, noindex: true })`), `useSeo({ title: ${expression}, … })`)
    assert.match(source, /import useSeo from '\.\.\/lib\/useSeo'/)
    for (const lang of LANGS) assert.ok(isText(get(lang, path)), `${lang}.${path}`)
    for (const lang of OTHERS) assert.notEqual(get(lang, path), get('en', path), `${lang}.${path} is still English`)
  })
}

test('9. the account screens have distinct titles in every language, and noindex reaches the robots tag', async () => {
  for (const lang of LANGS) {
    const titles = Object.values(ACCOUNT_PAGES).map(([, path]) => get(lang, path))
    assert.equal(new Set(titles).size, titles.length, `${lang} account titles are distinct`)
  }
  const hook = await read('lib/useSeo.js')
  assert.match(hook, /setMeta\('robots', noindex \? 'noindex, nofollow' : 'index, follow'\)/)
  assert.match(hook, /noindex = false/, 'indexing stays the default for the public pages')
})

// ── 10. Theme names in Settings ────────────────────────────────────────────
test('10. every theme has a translated name and description in all six languages', async () => {
  const context = await read('contexts/ThemeContext.jsx')
  const ids = [...context.matchAll(/^\s+id: '([\w-]+)',$/gm)].map((m) => m[1])
  assert.equal(ids.length, 8, 'every theme in ThemeContext was read')

  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(translations[lang].themes), ids, `${lang}.themes covers every theme id`)
    for (const id of ids) {
      for (const field of ['label', 'description']) {
        const value = translations[lang].themes[id][field]
        assert.ok(isText(value), `${lang}.themes.${id}.${field}`)
        if (lang === 'en') continue
        assert.notEqual(value, translations.en.themes[id][field], `${lang}.themes.${id}.${field} is still English`)
        if (SCRIPT[lang]) assert.match(value, SCRIPT[lang], `${lang}.themes.${id}.${field} is not written in ${lang}`)
      }
    }
  }
  // English is the wording the theme list itself carries (the admin screens still read it there).
  for (const id of ids) assert.ok(context.includes(`label: '${translations.en.themes[id].label}'`), `en.themes.${id}.label matches ThemeContext`)
})

test('10. the Settings theme picker shows the translated name, keyed by the theme id', async () => {
  const source = await read('pages/SettingsPage.jsx')
  assert.ok(source.includes('const copy = t.themes[th.id] || th'))
  assert.ok(source.includes('{copy.label}') && source.includes('{copy.description}'))
  assert.match(source, /onClick=\{\(\) => setTheme\(th\.id\)\}/, 'the id is still what gets applied')
})

// ── 11. Sample testimonials on the homepage ────────────────────────────────
test('11. the testimonials shown before any review exists are translated in all six languages', async () => {
  const english = translations.en.testimonials.items
  assert.equal(english.length, 3)

  for (const lang of LANGS) {
    const items = translations[lang].testimonials.items
    assert.equal(items?.length, 3, `${lang}.testimonials.items`)
    items.forEach((item, i) => {
      for (const field of ['name', 'role', 'text']) assert.ok(isText(item[field]), `${lang}.testimonials.items[${i}].${field}`)
      assert.equal(item.rating, 5)
      if (lang === 'en') return
      assert.notEqual(item.text, english[i].text, `${lang}.testimonials.items[${i}].text is still English`)
      if (SCRIPT[lang]) assert.match(item.text, SCRIPT[lang], `${lang}.testimonials.items[${i}].text is not written in ${lang}`)
    })
  }

  const source = await read('pages/HomePage.jsx')
  assert.ok(source.includes('(reviews.length > 0 ? reviews.slice(0, 3) : t.testimonials.items)'))
})

// ── 12. About page defaults ────────────────────────────────────────────────
const ABOUT_TEXT_KEYS = ['heroLabel', 'heroHeading', 'heroSubtext', 'missionLabel', 'missionHeading',
  'missionParagraph1', 'missionParagraph2', 'teamLabel', 'teamHeading']

test('12. the About page\'s built-in text is translated in all six languages', () => {
  const english = translations.en.aboutPage
  assert.equal(english.stats.length, 4)
  assert.equal(english.teamRoles.length, 3)

  for (const lang of LANGS) {
    const copy = translations[lang].aboutPage
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort(), lang)
    const strings = [...ABOUT_TEXT_KEYS.map((key) => [key, copy[key], english[key]]),
      ...copy.stats.map((value, i) => [`stats[${i}]`, value, english.stats[i]]),
      ...copy.teamRoles.map((value, i) => [`teamRoles[${i}]`, value, english.teamRoles[i]])]
    assert.equal(strings.length, 16)
    for (const [key, value, source] of strings) {
      assert.ok(isText(value), `${lang}.aboutPage.${key}`)
      if (lang === 'en') continue
      assert.notEqual(value, source, `${lang}.aboutPage.${key} is still English`)
      if (SCRIPT[lang]) assert.match(value, SCRIPT[lang], `${lang}.aboutPage.${key} is not written in ${lang}`)
    }
  }
})

test('12. AboutPage builds its defaults from the catalogue and lets the saved record win', async () => {
  const source = await read('pages/AboutPage.jsx')
  assert.match(source, /const defaults = useMemo\(\(\) => defaultsFor\(t\.aboutPage\), \[t\]\)/)
  assert.match(source, /const data = \{ \.\.\.defaults, \.\.\.about \}/)
  assert.match(source, /if \(res\.data\?\.about\) setAbout\(res\.data\.about\)/)
  assert.doesNotMatch(source, /\bDEFAULT\./, 'no English default object is read')
  for (const key of ABOUT_TEXT_KEYS) assert.ok(source.includes(`${key}: copy.${key},`), key)
  assert.ok(source.includes('label: copy.stats[i]') && source.includes('role: copy.teamRoles[i]'))
})

// ── 13. Small labels in the shared chrome ──────────────────────────────────
test('13. the navbar names the agent link from the catalogue, and the splash logo is labelled with the brand only', async () => {
  const navbar = await read('components/Navbar.jsx')
  assert.equal((navbar.match(/portal\.to === '\/admin\/dashboard' \? t\.nav\.dashboard : t\.settingsPage\.agentPanel/g) || []).length, 2)
  for (const lang of LANGS) assert.ok(isText(get(lang, 'settingsPage.agentPanel')) && isText(get(lang, 'nav.dashboard')), lang)

  const splash = await read('components/LoadingScreen.jsx')
  assert.ok(splash.includes('aria-label="VarliKent"'))
})
