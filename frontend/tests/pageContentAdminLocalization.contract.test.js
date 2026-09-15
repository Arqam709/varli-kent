// Admin → Page Content follows the Admin language.
//
// ── The bug this pins ───────────────────────────────────────────────────
// The rest of the Admin switched to Turkish or Arabic, but the Page Content
// editor rendered its page tabs, section titles and field captions straight
// from pageContentRegistry.js — English-only metadata — and the Contact
// Interests manager read a translation block that did not exist, so every
// string fell back to English. Turkish "Hero" was also an untranslated copy.
//
// ── The line this must not cross ────────────────────────────────────────
// Only INTERFACE text is translated. Page/section/field keys are the API
// contract, and a field's `default` is CMS content: neither may change.
//
// Admin languages are the ones the Admin switcher offers (AdminLayout: EN, TR,
// AR). de/ru/ur are not offered there and fall back to the English captions.
//
// Run with plain `node --test` from frontend/. The rendered screens are covered
// in a real browser by tests/browser/contactInterests.test.js.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import translations from '../src/locales/translations.js'
import { PAGE_CONTENT_KEYS, PAGE_CONTENT_REGISTRY, allFieldDefs } from '../src/lib/pageContentRegistry.js'
import { pageContentFieldLabel, pageContentPageLabel, pageContentSectionTitle } from '../src/lib/pageContentAdminLabels.js'
import {
  CONTACT_INTEREST_FORM_MESSAGES,
  checkNewInterestForm,
  describeInterestFormProblem,
  validateExistingInterestForm,
  validateNewInterestForm,
} from '../src/lib/contactInterestAdmin.js'
import { CONTACT_INTEREST_LANGUAGES } from '../src/lib/contactInterests.js'
import { PAGE_CONTENT_CONTRACT, PAGE_KEYS } from '../../backend/config/pageContentRegistry.js'

const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')

const ADMIN_LANGUAGES = ['en', 'tr', 'ar']
const TRANSLATED = ['tr', 'ar']

const pc = (lang) => translations[lang].adminPages.pageContent
const ci = (lang) => translations[lang].adminPages.contactInterests

const isText = (value) => typeof value === 'string' && value.trim() !== ''

const managed = (overrides = {}) => ({
  id: 'buying',
  value: 'Buying',
  labels: { en: 'Buying', tr: 'Satın Alma', ar: 'الشراء' },
  order: 1,
  enabled: true,
  ...overrides,
})

/* ══════════════ Which languages the Admin offers ══════════════ */

test('the Admin language switcher offers exactly EN, TR and AR', async () => {
  const layout = await readSrc('components', 'AdminLayout.jsx')
  const codes = [...layout.match(/const LANGS = \[([^\]]*)\]/)[1].matchAll(/code: '([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(codes, ADMIN_LANGUAGES)
})

/* ══════════════ The registry contract is untouched ══════════════ */

test('page, section and field keys still match the backend contract exactly', () => {
  assert.deepEqual([...PAGE_CONTENT_KEYS].sort(), [...PAGE_KEYS].sort())
  for (const pageKey of PAGE_CONTENT_KEYS) {
    const fields = Object.fromEntries(allFieldDefs(pageKey).map((f) => [f.key, f.type]))
    assert.deepEqual(fields, PAGE_CONTENT_CONTRACT[pageKey].fields, `${pageKey} field keys/types changed`)
    assert.deepEqual(PAGE_CONTENT_REGISTRY[pageKey].sections.map((s) => s.key), PAGE_CONTENT_CONTRACT[pageKey].sections)
  }
})

test('localization only ADDED a labelKey: each field is key, label, labelKey, type, default', () => {
  for (const pageKey of PAGE_CONTENT_KEYS) {
    for (const field of allFieldDefs(pageKey)) {
      assert.deepEqual(Object.keys(field).sort(), ['default', 'key', 'label', 'labelKey', 'type'], `${pageKey}.${field.key}`)
      assert.match(field.labelKey, /^[a-z][A-Za-z0-9]*$/)
      assert.match(field.key, /^[a-z][A-Za-z0-9]*$/, 'a contract key was replaced by display text')
    }
  }
})

test('stable keys and CMS defaults are pinned (sample)', () => {
  assert.deepEqual(PAGE_CONTENT_KEYS, ['home', 'architecture', 'construction', 'renovation', 'interior-design', 'team', 'contact'])
  assert.deepEqual(PAGE_CONTENT_REGISTRY.contact.hero.fields.map((f) => f.key), [
    'heroLabel', 'heroHeading', 'heroSubtitle', 'officeLocationLabel', 'interestLabel', 'sendBtn', 'successHeading', 'successBody',
  ])
  const heading = PAGE_CONTENT_REGISTRY.contact.hero.fields.find((f) => f.key === 'heroHeading')
  assert.equal(heading.default, 'Contact VarliKent', 'CMS default content must not be translated')
  assert.equal(heading.label, 'Heading', 'the registry keeps its English caption as the fallback')
})

/* ══════════════ Every caption exists in every Admin language ══════════════ */

test('every page tab has a caption in EN, TR and AR — and TR/AR are actually translated', () => {
  for (const lang of ADMIN_LANGUAGES) {
    assert.deepEqual(Object.keys(pc(lang).pages).sort(), [...PAGE_CONTENT_KEYS].sort(), `${lang}.pages`)
    for (const pageKey of PAGE_CONTENT_KEYS) assert.ok(isText(pc(lang).pages[pageKey]), `${lang}.pages.${pageKey}`)
  }
  for (const pageKey of PAGE_CONTENT_KEYS) {
    assert.equal(pc('en').pages[pageKey], PAGE_CONTENT_REGISTRY[pageKey].label)
    for (const lang of TRANSLATED) assert.notEqual(pc(lang).pages[pageKey], pc('en').pages[pageKey], `${lang}.pages.${pageKey} is English`)
  }
})

test('every section title has a caption in EN, TR and AR', () => {
  for (const pageKey of PAGE_CONTENT_KEYS) {
    for (const section of PAGE_CONTENT_REGISTRY[pageKey].sections) {
      assert.equal(pc('en').sectionTitles[pageKey][section.key], section.defaultTitle)
      for (const lang of TRANSLATED) {
        const title = pc(lang).sectionTitles?.[pageKey]?.[section.key]
        assert.ok(isText(title), `${lang}.sectionTitles.${pageKey}.${section.key} is missing`)
        assert.notEqual(title, section.defaultTitle, `${lang}.sectionTitles.${pageKey}.${section.key} is English`)
      }
    }
  }
})

test('every field caption used by any page exists in EN, TR and AR, and none is unused', () => {
  const used = new Set(PAGE_CONTENT_KEYS.flatMap((key) => allFieldDefs(key).map((f) => f.labelKey)))

  for (const lang of ADMIN_LANGUAGES) {
    assert.deepEqual(Object.keys(pc(lang).fieldLabels).sort(), [...used].sort(), `${lang}.fieldLabels`)
  }
  for (const pageKey of PAGE_CONTENT_KEYS) {
    for (const field of allFieldDefs(pageKey)) {
      assert.equal(pc('en').fieldLabels[field.labelKey], field.label, `${pageKey}.${field.key}: English caption drifted`)
      for (const lang of TRANSLATED) {
        assert.notEqual(pc(lang).fieldLabels[field.labelKey], field.label, `${lang}.fieldLabels.${field.labelKey} is English`)
      }
    }
  }
})

test('every chrome string AdminPageContent reads exists in EN, TR and AR', async () => {
  const src = await readSrc('pages', 'AdminPageContent.jsx')
  const keys = [...new Set([...src.matchAll(/\bpc\.([A-Za-z]+)/g)].map((m) => m[1]))]
  assert.ok(keys.length > 15)
  for (const lang of ADMIN_LANGUAGES) {
    for (const key of keys) assert.ok(isText(pc(lang)[key]), `${lang}.adminPages.pageContent.${key} is missing`)
  }
})

test('Turkish "Hero" is translated', () => {
  assert.notEqual(pc('tr').hero, 'Hero')
  assert.equal(/\bhero\b/.test(pc('tr').noSections), false)
})

/* ══════════════ The resolvers ══════════════ */

test('Contact captions resolve in the selected Admin language', () => {
  const contact = PAGE_CONTENT_REGISTRY.contact
  const byKey = Object.fromEntries(contact.hero.fields.map((f) => [f.key, f]))

  assert.equal(pageContentPageLabel(pc('tr'), 'contact', contact), 'İletişim')
  assert.equal(pageContentFieldLabel(pc('tr'), byKey.heroHeading), 'Başlık')
  assert.equal(pageContentFieldLabel(pc('tr'), byKey.officeLocationLabel), 'Ofis konumu etiketi')
  assert.equal(pageContentFieldLabel(pc('ar'), byKey.heroHeading), 'العنوان')
  assert.equal(pageContentPageLabel(pc('ar'), 'contact', contact), 'اتصل بنا')
  assert.equal(pageContentFieldLabel(pc('en'), byKey.sendBtn), 'Send button text')
})

test('another page resolves too — this is not a Contact-only patch', () => {
  const architecture = PAGE_CONTENT_REGISTRY.architecture
  const services = architecture.sections.find((s) => s.key === 'services')
  const service1Title = services.fields.find((f) => f.key === 'service1Title')

  assert.equal(pageContentPageLabel(pc('tr'), 'architecture', architecture), 'Mimarlık')
  assert.equal(pageContentSectionTitle(pc('tr'), 'architecture', services), 'Hizmetler')
  assert.equal(pageContentFieldLabel(pc('tr'), service1Title), 'Hizmet 1 — başlık')
  assert.equal(pageContentFieldLabel(pc('ar'), service1Title), 'الخدمة 1 — العنوان')
})

test('a language without admin captions falls back to the registry English, never blank', () => {
  const heading = PAGE_CONTENT_REGISTRY.contact.hero.fields[1]
  for (const lang of ['de', 'ru', 'ur']) {
    assert.equal(pageContentFieldLabel(translations[lang].adminPages?.pageContent, heading), 'Heading')
    assert.equal(pageContentPageLabel(translations[lang].adminPages?.pageContent, 'contact', PAGE_CONTENT_REGISTRY.contact).length > 0, true)
  }
  assert.equal(pageContentFieldLabel(undefined, heading), 'Heading')
})

test('AdminPageContent renders captions through the resolvers, not registry English', async () => {
  const src = await readSrc('pages', 'AdminPageContent.jsx')

  assert.equal(src.includes('{PAGE_CONTENT_REGISTRY[key].label}'), false, 'tabs render English registry labels')
  assert.equal(src.includes('{section.defaultTitle}'), false, 'section cards render English registry titles')
  assert.equal(/>\{f\.label\}</.test(src) || src.includes('label={f.label}'), false, 'fields render English registry captions')
  assert.ok(src.includes('pageContentPageLabel(pc, key, PAGE_CONTENT_REGISTRY[key])'))
  assert.ok(src.includes('pageContentSectionTitle(pc, pageKey, section)'))
  assert.ok(src.includes('pageContentFieldLabel(pc, f)'))
})

test('the language is not part of the page editor’s loading or save logic', async () => {
  const src = await readSrc('pages', 'AdminPageContent.jsx')
  // Content loading and the save payload must not re-run or change with the UI language.
  assert.ok(src.includes('useEffect(() => { loadPage(pageKey) }, [pageKey, loadPage])'))
  const payload = src.slice(src.indexOf('const payload = useMemo('), src.indexOf('const dirty ='))
  assert.equal(/language|\bpc\b|\bt\b/.test(payload), false)
})

/* ══════════════ Contact Interests manager ══════════════ */

test('every string the manager reads exists in EN, TR and AR', async () => {
  const src = await readSrc('components', 'ContactInterestsManager.jsx')
  const keys = [...new Set([...src.matchAll(/\bci\.([A-Za-z]+)/g)].map((m) => m[1]))]
  assert.ok(keys.length > 30)

  for (const lang of ADMIN_LANGUAGES) {
    const block = ci(lang)
    assert.ok(block, `${lang}.adminPages.contactInterests is missing`)
    for (const key of keys) {
      assert.ok(isText(block[key]) || (block[key] && typeof block[key] === 'object'), `${lang}.adminPages.contactInterests.${key}`)
    }
    for (const nested of ['languageLabels', 'languageNames']) {
      assert.deepEqual(Object.keys(block[nested]).sort(), [...CONTACT_INTEREST_LANGUAGES].sort(), `${lang}.${nested}`)
    }
    assert.deepEqual(Object.keys(block.errors).sort(), Object.keys(CONTACT_INTEREST_FORM_MESSAGES).sort(), `${lang}.errors`)
  }
})

test('English translations are exactly the manager’s English fallbacks, so EN is unchanged', async () => {
  const src = await readSrc('components', 'ContactInterestsManager.jsx')
  for (const [, key, fallback] of src.matchAll(/\bci\.([A-Za-z]+) \|\| '([^']*)'/g)) {
    assert.equal(ci('en')[key], fallback, `en.contactInterests.${key}`)
  }
  assert.deepEqual(ci('en').errors, { ...CONTACT_INTEREST_FORM_MESSAGES })
})

test('Turkish and Arabic manager strings are translated and keep their placeholders', () => {
  const walk = (en, other, path) => {
    for (const [key, value] of Object.entries(en)) {
      if (typeof value === 'object') { walk(value, other[key], `${path}.${key}`); continue }
      assert.notEqual(other[key], value, `${path}.${key} is English`)
      for (const placeholder of value.match(/\{[a-z]+\}/g) ?? []) {
        assert.ok(other[key].includes(placeholder), `${path}.${key} lost ${placeholder}`)
      }
    }
  }
  for (const lang of TRANSLATED) walk(ci('en'), ci(lang), lang)
})

test('the manager names interests in the Admin language, never English-only', async () => {
  const src = await readSrc('components', 'ContactInterestsManager.jsx')
  assert.ok(src.includes('contactInterestLabel(interest, language)'))
  assert.equal(src.includes('interest.labels.en ||'), false, 'rows still use the English label')
  assert.ok(src.includes('{interest.value} · <span className="font-mono">{interest.id}</span>'), 'the technical identity line changed')
})

test('validation messages follow the Admin language; English messages are unchanged', () => {
  const empty = { labels: { en: '', tr: '', ar: '', de: '', ru: '', ur: '' }, enabled: true, order: '' }

  assert.equal(validateNewInterestForm(empty), 'An English label is required.')
  assert.equal(describeInterestFormProblem(checkNewInterestForm(empty), { messages: ci('tr').errors }), 'İngilizce etiket zorunludur.')
  assert.equal(describeInterestFormProblem(checkNewInterestForm(empty), { messages: ci('ar').errors }), 'التسمية الإنجليزية مطلوبة.')
  assert.equal(validateExistingInterestForm({ ...empty, labels: { ...empty.labels, en: 'Buying' } }), 'Order is required.')

  const clash = checkNewInterestForm({ ...empty, labels: { ...empty.labels, en: 'buying' } }, [managed()])
  assert.equal(clash.code, 'clash')
  assert.equal(validateNewInterestForm({ ...empty, labels: { ...empty.labels, en: 'buying' } }, [managed()]),
    '“Buying” already uses this ID or value. Edit it instead.')
  assert.equal(
    describeInterestFormProblem(clash, { messages: ci('tr').errors, interestName: (interest) => interest.labels.tr }),
    '“Satın Alma” bu kimliği veya değeri zaten kullanıyor. Bunun yerine onu düzenleyin.'
  )

  const disabledClash = checkNewInterestForm({ ...empty, labels: { ...empty.labels, en: 'Buying' } }, [managed({ enabled: false })])
  assert.equal(disabledClash.code, 'clashDisabled')
})

test('a `$` in an interest name is inserted literally', () => {
  const problem = { code: 'clash', interest: managed({ labels: { en: 'Cash $& Carry' } }) }
  assert.equal(describeInterestFormProblem(problem), '“Cash $& Carry” already uses this ID or value. Edit it instead.')
})
