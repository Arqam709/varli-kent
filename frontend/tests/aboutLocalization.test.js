// The website About page resolves backend-localized content the same way the
// mobile app does — so once the backend stores real translations, both show
// them. With English copies stored under every language (the reported bug),
// both show English, because that is what the data says.
//
// No website code changed for this fix; these tests pin the resolver the
// About page and AdminAbout rely on. Run with plain `node --test`.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { editableText, localizedText } from '../src/lib/localizedText.js'

const here = dirname(fileURLToPath(import.meta.url))

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const MISSION_LABEL = { sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz', ar: 'مهمتنا', de: 'Unsere Mission', ru: 'Наша миссия', ur: 'ہمارا مشن' }

test('each language shows its own backend translation', () => {
  for (const lang of LANGS) assert.equal(localizedText(MISSION_LABEL, lang), MISSION_LABEL[lang])
})

test('English-copy data reproduces the bug: Turkish shows the stored English copy', () => {
  const copies = { sourceLang: 'en', en: 'Our Mission', tr: 'Our Mission', ar: 'Our Mission' }
  assert.equal(localizedText(copies, 'tr'), 'Our Mission')
})

test('after the backend fix a failed target is absent, and English is the deliberate fallback', () => {
  const sourceOnly = { sourceLang: 'en', en: 'Our Mission' }
  for (const lang of LANGS) assert.equal(localizedText(sourceOnly, lang), 'Our Mission')
})

test('legacy scalar About values still render', () => {
  assert.equal(localizedText('Our Mission', 'tr'), 'Our Mission')
})

test('the admin form edits the source-language text, which is what the save retranslates', () => {
  assert.equal(editableText(MISSION_LABEL), 'Our Mission')
  assert.equal(editableText({ sourceLang: 'tr', tr: 'Misyonumuz', en: 'Our Mission' }), 'Misyonumuz')
})

test('the About page resolves every CMS field with the selected language', async () => {
  const page = await readFile(join(here, '..', 'src', 'pages', 'AboutPage.jsx'), 'utf8')
  assert.ok(page.includes('const { language } = useLanguage()'))
  assert.ok(page.includes('localizedText(value, language, fallback)'))
})

test('the admin form still saves the whole document through PUT /about', async () => {
  const admin = await readFile(join(here, '..', 'src', 'pages', 'AdminAbout.jsx'), 'utf8')
  assert.ok(admin.includes("await api.put('/about', form)"))
})
