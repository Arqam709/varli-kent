// Localization Phase 1 — the language plumbing.
//
// Before this phase a Turkish visitor could still see English from places
// that were never a translation problem in the Turkish block itself:
//
//   - code reading a key that existed in NO language, so its inline English
//     fallback (`t.cta?.label || 'Get Started'`) was always what rendered;
//   - Login/Register choosing text with `language === 'tr' ? … : language ===
//     'ar' ? … : English`, which left German, Russian and Urdu in English;
//   - admin dates formatted with the BROWSER's locale instead of the site's;
//   - a duplicated studioPalette object in de/ru/ur whose second, smaller copy
//     silently replaced the first and dropped ten keys.
//
// Static checks plus a few pure-function checks; run with `node --test` from
// frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import translations from '../src/locales/translations.js'
import { APP_LOCALES, localeFor } from '../src/lib/locale.js'
import { formatPrice } from '../src/lib/formatPrice.js'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')
const read = (...p) => readFile(join(SRC, ...p), 'utf8')
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const get = (lang, path) => path.split('.').reduce((node, key) => (node == null ? node : node[key]), translations[lang])

// Every key the audit found being read with an English fallback while
// existing in neither English nor Turkish — with the file that reads it.
const FALLBACK_KEYS = {
  'cta.label': 'pages/HomePage.jsx',
  'contactPage.nameLabel': 'pages/ContactPage.jsx',
  'contactPage.messageLabel': 'pages/ContactPage.jsx',
  'admin.activity': 'components/AdminLayout.jsx',
  'adminPages.activity.loadFailed': 'pages/AdminActivity.jsx',
  'adminPages.leadRouting.saving': 'pages/AdminLeadRouting.jsx',
  'adminPages.leadRouting.disabledNote': 'pages/AdminLeadRouting.jsx',
  'adminPages.leadRouting.disabledBadge': 'pages/AdminLeadRouting.jsx',
  'adminPages.messages.deleteConfirm': 'pages/AdminMessages.jsx',
  'adminPages.messages.deleted': 'pages/AdminMessages.jsx',
  'adminPages.messages.deleteFailed': 'pages/AdminMessages.jsx',
  'adminPages.messages.markedAs': 'pages/AdminMessages.jsx',
  'adminPages.messages.updateStatusFailed': 'pages/AdminMessages.jsx',
  'adminPages.partners.circularOption': 'pages/AdminPartners.jsx',
  'adminPages.properties.agentsLoadError': 'pages/AdminProperties.jsx',
  'adminPages.properties.assignedAgent': 'pages/AdminProperties.jsx',
  'adminPages.properties.unassigned': 'pages/AdminProperties.jsx',
  'adminPages.common.removeImage': 'pages/AdminProperties.jsx',
  'adminPages.common.saved': 'pages/AdminSiteSettings.jsx',
  'adminPages.settings.saving': 'pages/AdminSiteSettings.jsx',
}

const AUTH_KEYS = [
  'signedInMicrosoft', 'microsoftSignInFailed', 'fillAllFields', 'welcomeBack',
  'signedInGoogle', 'googleSignInFailed', 'googleLoginFailed', 'continueWithGoogle',
  'oauthComingSoon', 'joinTitle', 'joinText', 'passwordMinPlaceholder',
  'passwordsDoNotMatch', 'passwordTooShort', 'accountCreated',
]

const RESET_KEYS = [
  'invalidLinkTitle', 'invalidLinkBody', 'requestNewLink', 'heading', 'subtitle',
  'backToSignIn', 'title', 'description', 'newPassword', 'confirmPassword',
  'saving', 'resetButton', 'passwordTooShort', 'passwordMismatch', 'resetFailed',
]

const isText = (value) => typeof value === 'string' && value.trim() !== ''

// ── 1–4, 10. The fallback keys now exist, so the English literal never runs ──
for (const [path, file] of Object.entries(FALLBACK_KEYS)) {
  test(`${path} exists in English and Turkish, and Turkish is not English`, () => {
    assert.ok(isText(get('en', path)), `en.${path}`)
    assert.ok(isText(get('tr', path)), `tr.${path}`)
    assert.notEqual(get('tr', path), get('en', path), `tr.${path} must not be the English text`)
  })

  test(`${path} exists in every language`, () => {
    for (const lang of LANGS) assert.ok(isText(get(lang, path)), `${lang}.${path}`)
  })

  test(`${path} is still the key ${file} reads`, async () => {
    const source = await read(...file.split('/'))
    const leaf = path.split('.').pop()
    assert.match(source, new RegExp(`[.?]${leaf}\\b`), `${file} reads .${leaf}`)
  })
}

test('placeholders in the fallback keys survive translation', () => {
  for (const lang of LANGS) {
    assert.match(get(lang, 'adminPages.activity.loadFailed'), /\{error\}/, `${lang} loadFailed keeps {error}`)
    assert.match(get(lang, 'adminPages.messages.markedAs'), /\{status\}/, `${lang} markedAs keeps {status}`)
  }
})

// ── 5. resetPasswordPage ────────────────────────────────────────────────────
for (const lang of LANGS) {
  test(`resetPasswordPage has the same ${RESET_KEYS.length} keys in ${lang}`, () => {
    const block = translations[lang].resetPasswordPage
    assert.ok(block && typeof block === 'object', `${lang}.resetPasswordPage`)
    assert.deepEqual(Object.keys(block).sort(), [...RESET_KEYS].sort())
    for (const key of RESET_KEYS) assert.ok(isText(block[key]), `${lang}.resetPasswordPage.${key}`)
  })
}

// Phase 1 only added these keys; Phase 2 wired the page to them, so the page
// now reads each key instead of carrying the English text itself.
test('resetPasswordPage is what the page reads, and Turkish is translated', async () => {
  const page = await read('pages', 'ResetPassword.jsx')
  for (const key of ['invalidLinkTitle', 'heading', 'title', 'newPassword', 'resetButton']) {
    assert.match(page, new RegExp(`\\br\\.${key}\\b`), `the page reads resetPasswordPage.${key}`)
    assert.ok(!page.includes(translations.en.resetPasswordPage[key]), `en.${key} is no longer hard-coded`)
    assert.notEqual(translations.tr.resetPasswordPage[key], translations.en.resetPasswordPage[key])
  }
})

// ── 6/7. Login and Register read translations, not language ternaries ──────
for (const file of ['LoginPage.jsx', 'RegisterPage.jsx']) {
  test(`${file} has no language-specific UI ternaries left`, async () => {
    const source = await read('pages', file)
    assert.doesNotMatch(source, /language\s*===\s*'(tr|ar|en|de|ru|ur)'/)
    assert.doesNotMatch(source, /'(tr|ar)'\s*===\s*language/)
    // No Turkish or Arabic UI text embedded in the component any more.
    assert.doesNotMatch(source, /[çğıöşüÇĞİÖŞÜ]/, 'no Turkish literals')
    assert.doesNotMatch(source, /[؀-ۿ]/, 'no Arabic literals')
  })
}

test('LoginPage uses the new auth keys', async () => {
  const source = await read('pages', 'LoginPage.jsx')
  for (const key of ['signedInMicrosoft', 'fillAllFields', 'welcomeBack', 'signedInGoogle', 'googleLoginFailed', 'continueWithGoogle', 'oauthComingSoon']) {
    assert.match(source, new RegExp(`\\ba\\.${key}\\b`), `a.${key}`)
  }
  // The two general OAuth failure messages are picked by lib/authErrors.js from
  // the response status (see localizationPublicGaps.contract.test.js).
  const authErrors = await read('lib', 'authErrors.js')
  for (const key of ['microsoftSignInFailed', 'googleSignInFailed']) assert.ok(authErrors.includes(`'${key}'`), key)
  // The Microsoft redirect effect re-runs on a language change, as before.
  assert.match(source, /\[accounts, inProgress, instance, loginWithToken, navigate, from, a\]\)/)
})

test('RegisterPage uses the new auth keys', async () => {
  const source = await read('pages', 'RegisterPage.jsx')
  for (const key of ['joinTitle', 'joinText', 'passwordMinPlaceholder', 'passwordsDoNotMatch', 'passwordTooShort', 'accountCreated']) {
    assert.match(source, new RegExp(`\\ba\\.${key}\\b`), `a.${key}`)
  }
})

for (const key of AUTH_KEYS) {
  test(`auth.${key} exists in all six languages, each in its own words`, () => {
    for (const lang of LANGS) assert.ok(isText(get(lang, `auth.${key}`)), `${lang}.auth.${key}`)
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      assert.notEqual(get(lang, `auth.${key}`), get('en', `auth.${key}`), `${lang}.auth.${key} is not English`)
    }
  })
}

test('auth.oauthComingSoon keeps its {provider} placeholder everywhere', () => {
  for (const lang of LANGS) assert.match(get(lang, 'auth.oauthComingSoon'), /\{provider\}/, lang)
})

test('the Turkish and Arabic wording moved from the ternaries is unchanged', () => {
  assert.equal(translations.tr.auth.continueWithGoogle, 'Google ile devam et')
  assert.equal(translations.tr.auth.welcomeBack, 'Tekrar hoş geldiniz!')
  assert.equal(translations.tr.auth.joinTitle, 'VarliKent’e Katılın')
  assert.equal(translations.ar.auth.continueWithGoogle, 'المتابعة باستخدام Google')
  assert.equal(translations.ar.auth.accountCreated, 'تم إنشاء الحساب! مرحباً بك في فارلي كنت.')
})

// ── 8. No duplicate keys anywhere in the catalogue ──────────────────────────
test('translations.js has no duplicate keys in any object', async () => {
  const require = createRequire(join(here, '..', 'package.json'))
  const { parse } = require('@babel/parser')
  const source = await read('locales', 'translations.js')
  const ast = parse(source, { sourceType: 'module' })
  const duplicates = []

  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((child) => visit(child, path)); return }
    if (node.type === 'ObjectExpression') {
      const seen = new Set()
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty') continue
        const name = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
        if (seen.has(name)) duplicates.push(`${[...path, name].join('.')} (line ${prop.loc.start.line})`)
        seen.add(name)
        visit(prop.value, [...path, name])
      }
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'loc' && key !== 'start' && key !== 'end') visit(value, path)
    }
  }
  visit(ast.program, [])

  assert.deepEqual(duplicates, [])
})

test('studioPalette in de/ru/ur kept the complete block: every English key is present', () => {
  const english = Object.keys(translations.en.adminPages.studioPalette).sort()
  for (const lang of ['de', 'ru', 'ur']) {
    const keys = Object.keys(translations[lang].adminPages.studioPalette).sort()
    assert.deepEqual(keys, english, lang)
    // The ten keys the duplicate used to drop.
    for (const key of ['resetting', 'loadFailed', 'uploadTexture', 'removeImage', 'imageOnly', 'discardConfirm', 'invalidPalette', 'remove', 'loading', 'basicColors']) {
      assert.ok(isText(translations[lang].adminPages.studioPalette[key]), `${lang}.studioPalette.${key}`)
    }
  }
})

// ── 9. Dates follow the site's language, not the browser's ─────────────────
test('localeFor maps every interface language, and unknown codes to English', () => {
  assert.deepEqual(APP_LOCALES, { en: 'en-US', tr: 'tr-TR', ar: 'ar', de: 'de-DE', ru: 'ru-RU', ur: 'ur-PK' })
  for (const lang of LANGS) assert.equal(localeFor(lang), APP_LOCALES[lang])
  assert.equal(localeFor('xx'), 'en-US')
  assert.equal(localeFor(undefined), 'en-US')
})

test('the same date renders differently per language, which the pages now rely on', () => {
  const date = new Date('2026-03-05T12:00:00Z')
  const tr = date.toLocaleDateString(localeFor('tr'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const en = date.toLocaleDateString(localeFor('en'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  assert.match(tr, /Mart/, `Turkish month name, got "${tr}"`)
  assert.match(en, /March/, `English month name, got "${en}"`)
})

test('formatPrice still formats with the language\'s locale after sharing the table', () => {
  assert.match(formatPrice(1250000, 'Sale', '', 'tr'), /1\.250\.000/)
  assert.match(formatPrice(1250000, 'Sale', '', 'en'), /1,250,000/)
  assert.match(formatPrice(1250000, 'Sale', '', 'de'), /1\.250\.000/)
})

const DATE_FILES = [
  'pages/AdminActivity.jsx',
  'pages/AdminMessages.jsx',
  'pages/AdminUserChats.jsx',
  'pages/AdminUsers.jsx',
  'pages/SettingsPage.jsx',
]

for (const file of DATE_FILES) {
  test(`${file} formats every visible date with the active language`, async () => {
    const source = await read(...file.split('/'))
    assert.doesNotMatch(source, /toLocale(Date|Time)?String\(\s*\)/, 'no call relies on the browser locale')
    assert.doesNotMatch(source, /toLocale(Date|Time)?String\(\s*undefined\b/, 'no explicit browser-locale call')
    assert.match(source, /localeFor\(language\)|toLocaleDateString\(language\b/, 'uses the active language')
  })
}

test('no live page formats a date without a locale', async () => {
  const { readdir } = await import('node:fs/promises')
  // Never routed or imported — kept out of scope deliberately.
  const DEAD = new Set(['Header.jsx', 'About.jsx', 'Contact.jsx', 'Projects.jsx', 'Testimonials.jsx'])
  const offenders = []
  for (const dir of ['pages', 'components']) {
    for (const name of await readdir(join(SRC, dir))) {
      if (!name.endsWith('.jsx') || DEAD.has(name)) continue
      const source = await read(dir, name)
      if (/toLocale(Date|Time)?String\(\s*(\)|undefined\b)/.test(source)) offenders.push(`${dir}/${name}`)
    }
  }
  assert.deepEqual(offenders, [])
})
