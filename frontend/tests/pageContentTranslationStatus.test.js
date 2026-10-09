// CMS Phase C1 — what the Page Content editor shows about a field's translations.
//
// Pure rules only (the rendered editor is tests/browser/pageContentTranslationStatus.test.js):
//   - lib/pageContentCatalogue.js      which built-in text each field falls back to
//   - lib/pageContentTranslationStatus.js   backend state + registry + catalogue → display
// The backend states in these fixtures come from the backend's own
// translationStatesOf, so the two halves are tested against each other.
// Run with `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import translations from '../src/locales/translations.js'
import { PAGE_CONTENT_KEYS, allFieldDefs } from '../src/lib/pageContentRegistry.js'
import { PAGE_CONTENT_CATALOGUE_PATHS, catalogueText } from '../src/lib/pageContentCatalogue.js'
import {
  ATTENTION_STATUSES,
  DISPLAY_STATUSES,
  TRANSLATION_STATUS_LANGUAGES,
  describeFieldTranslations,
  failureKind,
  sourceIsDefault,
  summarizePageTranslations,
} from '../src/lib/pageContentTranslationStatus.js'
import { resolveCmsField } from '../src/lib/pageContentResolve.js'
import { sourceHash, translationStatesOf, TRANSLATION_STATES } from '../../backend/utils/translationState.js'
import { TRANSLATION_FAILURE_REASONS } from '../../backend/utils/autoTranslate.js'

const here = dirname(fileURLToPath(import.meta.url))
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const TARGETS = ['tr', 'ar', 'de', 'ru', 'ur']
const isText = (value) => typeof value === 'string' && value.trim() !== ''
const textDefs = (pageKey) => allFieldDefs(pageKey).filter((def) => def.type !== 'image')
const def = (pageKey, key) => allFieldDefs(pageKey).find((d) => d.key === key)

/* ══════════════ 1. The field → catalogue map ══════════════ */

const PAGE_FILES = { home: 'HomePage', architecture: 'ArchitecturePage', construction: 'ConstructionPage', renovation: 'RenovationPage', 'interior-design': 'InteriorDesignPage', team: 'TeamPage', contact: 'ContactPage' }

test('map: every registry text field of every page has a built-in text in all six languages', () => {
  assert.deepEqual(Object.keys(PAGE_CONTENT_CATALOGUE_PATHS).sort(), [...PAGE_CONTENT_KEYS].sort())
  let fields = 0
  for (const pageKey of PAGE_CONTENT_KEYS) {
    assert.deepEqual(Object.keys(PAGE_CONTENT_CATALOGUE_PATHS[pageKey]), textDefs(pageKey).map((d) => d.key), `${pageKey}: one entry per text field, in registry order`)
    for (const { key } of textDefs(pageKey)) {
      fields += 1
      for (const lang of LANGS) assert.ok(isText(catalogueText(pageKey, key, lang)), `${pageKey}.${key} has no ${lang} built-in text`)
    }
  }
  assert.equal(fields, 171)
})

test('map: the English built-in text IS the registry default — which is what makes "Built-in" a safe claim', () => {
  for (const pageKey of PAGE_CONTENT_KEYS) {
    for (const d of textDefs(pageKey)) {
      assert.equal(catalogueText(pageKey, d.key, 'en').trim(), String(d.default).trim(), `${pageKey}.${d.key}`)
    }
  }
})

test('map: it agrees with the fallback each page actually passes to cms()', async () => {
  for (const [pageKey, file] of Object.entries(PAGE_FILES)) {
    const source = await readFile(join(here, '..', 'src', 'pages', `${file}.jsx`), 'utf8')
    const alias = Object.fromEntries([...source.matchAll(/const (\w) = t\.(\w+)\b/g)].map((m) => [m[1], m[2]]))

    // cms('key', t.a.b …) and cms('key', p.b …)
    const literal = {}
    for (const m of source.matchAll(/cms\(\s*'(\w+)',\s*([\w?.]+)/g)) {
      const [head, ...rest] = m[2].replace(/\?/g, '').split('.')
      if (head === 't') literal[m[1]] = rest.join('.')
      else if (alias[head]) literal[m[1]] = [alias[head], ...rest].join('.')
    }
    for (const [key, path] of Object.entries(literal)) {
      if (!(key in PAGE_CONTENT_CATALOGUE_PATHS[pageKey])) continue // an image field
      assert.equal(PAGE_CONTENT_CATALOGUE_PATHS[pageKey][key], path, `${pageKey}.${key}`)
    }

    // cms(`service${i + 1}Title`, svc.title) and the other list-backed fields.
    const section = alias.p
    for (const [key, path] of Object.entries(PAGE_CONTENT_CATALOGUE_PATHS[pageKey])) {
      if (key in literal) continue
      const list = key.match(/^service(\d)(Title|Desc)$/) ? ['services', (m) => `${m[1] - 1}.${m[2].toLowerCase()}`, /^service(\d)(Title|Desc)$/]
        : key.match(/^processStep(\d)$/) ? ['processSteps', (m) => `${m[1] - 1}`, /^processStep(\d)$/]
        : key.match(/^(before|after)Item(\d)$/) ? [`${key.match(/^(before|after)/)[1]}Items`, (m) => `${m[2] - 1}`, /^(before|after)Item(\d)$/]
        : null
      assert.ok(list, `${pageKey}.${key} is read by no cms() call this test recognises`)
      assert.equal(path, `${section}.${list[0]}.${list[1](key.match(list[2]))}`, `${pageKey}.${key}`)
      assert.match(source, new RegExp(`cms\\(\`${key.replace(/\d/, '\\$\\{i \\+ 1\\}')}\``), `${file} reads ${key} from a list`)
    }
  }
})

test('map: an unknown page, field or language is an empty string, never an exception', () => {
  for (const args of [['nope', 'heroLabel', 'en'], ['home', 'nope', 'en'], ['home', 'heroLabel', 'xx'], [undefined, undefined, undefined]]) {
    assert.equal(catalogueText(...args), '')
  }
})

/* ══════════════ 2. Deriving what is displayed ══════════════ */

const BUTTON = def('home', 'heroCtaPrimary') // default: 'Explore Our Services'
const HEADING = def('home', 'heroHeading1')
const at = '2026-10-09T10:00:00.000Z'
const describe = (pageKey, d, field) => describeFieldTranslations({ pageKey, def: d, field, states: field ? translationStatesOf(field) : undefined })
const byLang = (rows) => Object.fromEntries(rows.map((row) => [row.lang, row]))
const statuses = (rows) => Object.fromEntries(rows.map((row) => [row.lang, row.status]))
const tracked = (source, slots, langs, sourceLang = 'en') => ({ type: 'text', sourceLang, [sourceLang]: source, ...slots, meta: { sourceHash: sourceHash(source), langs } })

test('display: every backend state maps to one displayed status, and nothing is left unmapped', () => {
  assert.deepEqual([...TRANSLATION_STATES].sort(), ['manual', 'missing', 'source', 'stale', 'translated', 'unknown'])
  assert.deepEqual(DISPLAY_STATUSES, ['source', 'current', 'manual', 'builtin', 'existing', 'stale', 'outdated', 'missing'])
  assert.deepEqual(ATTENTION_STATUSES, ['stale', 'outdated', 'missing'])
  assert.deepEqual(TRANSLATION_STATUS_LANGUAGES, LANGS)
})

test('display: backend source → Source', () => {
  const rows = byLang(describe('home', BUTTON, { type: 'text', sourceLang: 'en', en: BUTTON.default }))
  assert.equal(rows.en.status, 'source')
  assert.equal(rows.en.text, BUTTON.default)
  assert.equal(rows.en.attention, false)
})

test('display: backend translated → Current, shown from the stored value', () => {
  const field = tracked('Discover Our Services', { de: 'Entdecken Sie unsere Leistungen' }, { de: { from: sourceHash('Discover Our Services'), by: 'machine', at } })
  const de = byLang(describe('home', BUTTON, field)).de
  assert.deepEqual(de, { lang: 'de', status: 'current', text: 'Entdecken Sie unsere Leistungen', origin: 'stored', failure: null, attention: false })
})

test('display: backend manual → Manual', () => {
  const field = tracked('Discover Our Services', { de: 'Unsere Leistungen entdecken' }, { de: { from: sourceHash('Discover Our Services'), by: 'manual', at } })
  const de = byLang(describe('home', BUTTON, field)).de
  assert.equal(de.status, 'manual')
  assert.equal(de.origin, 'stored')
  assert.equal(de.attention, false)
})

test('display: backend unknown (a stored value with no provenance) → Existing, and not a warning', () => {
  const field = { type: 'text', sourceLang: 'en', en: 'Explore Services', de: 'Leistungen entdecken', verified: false }
  const de = byLang(describe('home', BUTTON, field)).de
  assert.deepEqual(de, { lang: 'de', status: 'existing', text: 'Leistungen entdecken', origin: 'stored', failure: null, attention: false })
})

test('display: backend missing + built-in text + source still the default → Built-in (healthy)', () => {
  // As stored in production: the default with a trailing newline.
  const field = { type: 'text', sourceLang: 'en', en: `${HEADING.default}\n`, verified: false }
  const rows = byLang(describe('home', HEADING, field))
  for (const lang of TARGETS) {
    assert.deepEqual(rows[lang], { lang, status: 'builtin', text: translations[lang].hero.heading1, origin: 'builtin', failure: null, attention: false }, lang)
  }
})

test('display: a field that was never saved is Source + Built-in everywhere', () => {
  const rows = describe('home', HEADING, undefined)
  assert.deepEqual(statuses(rows), { en: 'source', tr: 'builtin', ar: 'builtin', de: 'builtin', ru: 'builtin', ur: 'builtin' })
  assert.equal(byLang(rows).en.text, HEADING.default)
  assert.equal(byLang(rows).de.text, translations.de.hero.heading1)
  assert.equal(rows.some((row) => row.attention), false)
})

test('display: backend missing + built-in text + EDITED source → Needs attention (the built-in text is of the old wording)', () => {
  const field = { type: 'text', sourceLang: 'en', en: 'We Plan, Build' }
  const rows = byLang(describe('home', HEADING, field))
  for (const lang of TARGETS) {
    assert.equal(rows[lang].status, 'outdated', lang)
    assert.equal(rows[lang].text, translations[lang].hero.heading1, 'visitors still read the built-in translation')
    assert.equal(rows[lang].origin, 'builtin')
    assert.equal(rows[lang].attention, true)
  }
  assert.equal(rows.en.status, 'source')
  assert.equal(rows.en.text, 'We Plan, Build')
})

test('display: backend stale → Stale, still showing the old stored text', () => {
  const field = tracked('Discover Our Services', { de: 'Leistungen entdecken' }, { de: { from: sourceHash('Explore Services'), by: 'machine', at } })
  const de = byLang(describe('home', BUTTON, field)).de
  assert.deepEqual(de, { lang: 'de', status: 'stale', text: 'Leistungen entdecken', origin: 'stored', failure: null, attention: true })
})

test('display: backend missing with NO built-in text → Missing, and visitors get the source text', () => {
  // No registered field lacks built-in text, so this uses a key the map does not know.
  const orphan = { key: 'notInTheCatalogue', type: 'text', default: 'Something' }
  const rows = byLang(describeFieldTranslations({ pageKey: 'home', def: orphan, field: { type: 'text', sourceLang: 'en', en: 'Something new' }, states: { en: 'source', tr: 'missing', ar: 'missing', de: 'missing', ru: 'missing', ur: 'missing' } }))
  for (const lang of TARGETS) {
    assert.deepEqual(rows[lang], { lang, status: 'missing', text: 'Something new', origin: 'source', failure: null, attention: true }, lang)
  }
})

test('display: Stale + a failed attempt → Stale, with the failure as secondary information', () => {
  const field = tracked('Discover Our Services', { de: 'Leistungen entdecken' }, { de: { from: sourceHash('Explore Services'), by: 'machine', at, error: 'timeout', errorAt: at } })
  const de = byLang(describe('home', BUTTON, field)).de
  assert.equal(de.status, 'stale')
  assert.equal(de.failure, 'failed')
  assert.equal(de.attention, true)
})

test('display: Missing/Needs attention + a failed attempt keeps its primary status', () => {
  const field = tracked('Discover Our Services', {}, { ru: { error: 'quota', errorAt: at }, ur: { error: 'too_long', errorAt: at } })
  const rows = byLang(describe('home', BUTTON, field))
  assert.equal(rows.ru.status, 'outdated')
  assert.equal(rows.ru.failure, 'quota')
  assert.equal(rows.ur.failure, 'tooLong')

  const orphan = { key: 'notInTheCatalogue', type: 'text', default: 'Something' }
  const missing = byLang(describeFieldTranslations({ pageKey: 'home', def: orphan, field: tracked('Something new', {}, { de: { error: 'echo', errorAt: at } }), states: { en: 'source', de: 'missing' } })).de
  assert.equal(missing.status, 'missing')
  assert.equal(missing.failure, 'echo')
})

test('display: a legacy value that outlived a failed save is still Existing — flagged, not relabelled', () => {
  const field = tracked('Discover Our Services', { ur: 'خدمات دیکھیں' }, { ur: { error: 'provider_error', errorAt: at } })
  const ur = byLang(describe('home', BUTTON, field)).ur
  assert.equal(ur.status, 'existing')
  assert.equal(ur.failure, 'failed')
  assert.equal(ur.attention, true)
})

test('display: every failure identifier the backend can store becomes one of four plain kinds', () => {
  const kinds = Object.fromEntries(TRANSLATION_FAILURE_REASONS.map((reason) => [reason, failureKind(reason)]))
  assert.deepEqual(kinds, {
    timeout: 'failed', provider_error: 'failed', invalid_response: 'failed', same_language: 'failed', unknown: 'failed',
    echo: 'echo', too_long: 'tooLong', quota: 'quota',
  })
  assert.equal(failureKind('something new'), 'failed')
  for (const none of [undefined, null, '', 42]) assert.equal(failureKind(none), null)
})

test('display: a source in another language never makes the built-in text "current"', () => {
  const field = { type: 'text', sourceLang: 'tr', tr: 'Hizmetleri Keşfedin' }
  assert.equal(sourceIsDefault(BUTTON, field), false)
  assert.deepEqual(statuses(describe('home', BUTTON, field)), { en: 'outdated', tr: 'source', ar: 'outdated', de: 'outdated', ru: 'outdated', ur: 'outdated' })
  // Even when the Turkish happens to be the catalogue's own Turkish.
  const coincidence = { type: 'text', sourceLang: 'tr', tr: translations.tr.hero.ctaPrimary }
  assert.equal(sourceIsDefault(BUTTON, coincidence), false)
})

test('display: "still the default" ignores surrounding whitespace only, and an emptied field counts as default', () => {
  assert.equal(sourceIsDefault(BUTTON, undefined), true)
  assert.equal(sourceIsDefault(BUTTON, { sourceLang: 'en', en: `  ${BUTTON.default}\n` }), true)
  assert.equal(sourceIsDefault(BUTTON, { sourceLang: 'en', en: '' }), true)
  assert.equal(sourceIsDefault(BUTTON, { sourceLang: 'en', en: BUTTON.default.toUpperCase() }), false)
  assert.equal(sourceIsDefault(BUTTON, { sourceLang: 'en', en: `${BUTTON.default}!` }), false)
})

test('display: the text shown is exactly what the public resolver returns', () => {
  const field = tracked('Discover Our Services', { tr: 'Hizmetlerimizi Keşfedin', de: 'Leistungen entdecken' }, {
    tr: { from: sourceHash('Discover Our Services'), by: 'machine', at },
    de: { from: sourceHash('Explore Services'), by: 'machine', at },
    ru: { error: 'timeout', errorAt: at },
  })
  for (const row of describe('home', BUTTON, field)) {
    assert.equal(row.text, resolveCmsField(field, row.lang, catalogueText('home', 'heroCtaPrimary', row.lang)), row.lang)
  }
})

test('display: no hash, timestamp or metadata key ever reaches a row', () => {
  const field = tracked('Discover Our Services', { de: 'Leistungen entdecken' }, { de: { from: sourceHash('Explore Services'), by: 'machine', at, error: 'timeout', errorAt: at } })
  const serialized = JSON.stringify(describe('home', BUTTON, field))
  for (const internal of [sourceHash('Explore Services'), sourceHash('Discover Our Services'), 'sourceHash', '"from"', '"by"', 'errorAt', at, 'timeout']) {
    assert.equal(serialized.includes(internal), false, internal)
  }
})

/* ══════════════ 3. The production homepage ══════════════ */

const productionHome = () => {
  const fields = {}
  for (const d of textDefs('home')) fields[d.key] = { type: 'text', sourceLang: 'en', en: d.default, verified: false }
  fields.heroHeading1.en = 'We Design, Build\n'
  fields.heroLabel = { type: 'text', sourceLang: 'en', en: 'Istanbul · Architecture · Construction · Real Estate', tr: 'İstanbul · Mimarlık · İnşaat · Gayrimenkul', ar: 'إسطنبول · معمار · إنشاء · عقارات', de: 'Istanbul · Architektur · Bau · Immobilien', ru: 'Стамбул · Архитектура · Строительство · Недвижимость', ur: 'استنبول · تعمیراتی ڈیزائن · تعمیرات · جائیداد', verified: false }
  fields.heroCtaPrimary = { type: 'text', sourceLang: 'en', en: 'Explore Services', tr: 'Hizmetleri Keşfedin', ar: 'استكشف الخدمات', de: 'Leistungen entdecken', ru: 'Изучить услуги', ur: 'خدمات دیکھیں', verified: false }
  return fields
}
const rowsFor = (pageKey, fields) => Object.fromEntries(textDefs(pageKey).map((d) => [d.key, describe(pageKey, d, fields[d.key])]))

test('production homepage: 45 fields are Source + Built-in, the two hero fields are Source + Existing', () => {
  const rows = rowsFor('home', productionHome())
  for (const [key, fieldRows] of Object.entries(rows)) {
    const expected = ['heroLabel', 'heroCtaPrimary'].includes(key) ? 'existing' : 'builtin'
    assert.deepEqual(statuses(fieldRows), { en: 'source', tr: expected, ar: expected, de: expected, ru: expected, ur: expected }, key)
  }
  // The hero translations are not called machine, manual, current or stale.
  for (const key of ['heroLabel', 'heroCtaPrimary']) {
    for (const row of rows[key]) assert.ok(['source', 'existing'].includes(row.status), `${key}.${row.lang}`)
    assert.equal(byLang(rows[key]).de.origin, 'stored')
  }
})

test('production homepage: the summary counts them and raises no warning', () => {
  const summary = summarizePageTranslations(rowsFor('home', productionHome()))
  assert.deepEqual(summary, {
    counts: { current: 0, manual: 0, builtin: 225, existing: 10, stale: 0, outdated: 0, missing: 0 },
    failures: 0,
    attention: 0,
  })
})

test('production homepage: the five fields the page has never saved behave the same as the saved defaults', () => {
  const fields = productionHome()
  for (const key of ['aboutCta', 'browseListings', 'partnersLabel', 'ctaBrowse', 'ctaContact']) delete fields[key]
  assert.equal(summarizePageTranslations(rowsFor('home', fields)).attention, 0)
  assert.deepEqual(statuses(rowsFor('home', fields).aboutCta), { en: 'source', tr: 'builtin', ar: 'builtin', de: 'builtin', ru: 'builtin', ur: 'builtin' })
})

test('every other page (no record at all) is entirely Source + Built-in', () => {
  for (const pageKey of PAGE_CONTENT_KEYS.filter((key) => key !== 'home')) {
    const summary = summarizePageTranslations(rowsFor(pageKey, {}))
    assert.equal(summary.attention, 0, pageKey)
    assert.equal(summary.counts.builtin, textDefs(pageKey).length * 5, pageKey)
  }
})

test('summary: attention counts stale, edited-source fallbacks, missing and failed attempts — and nothing healthy', () => {
  const fields = productionHome()
  fields.heroCtaPrimary = tracked('Discover Our Services', { tr: 'Hizmetlerimizi Keşfedin', ar: 'اكتشف خدماتنا', de: 'Leistungen entdecken', ur: 'خدمات دیکھیں' }, {
    tr: { from: sourceHash('Discover Our Services'), by: 'machine', at },
    ar: { from: sourceHash('Discover Our Services'), by: 'manual', at },
    de: { from: sourceHash('Explore Services'), by: 'machine', at, error: 'timeout', errorAt: at },
    ru: { error: 'quota', errorAt: at },
    ur: { error: 'too_long', errorAt: at },
  })
  const summary = summarizePageTranslations(rowsFor('home', fields))
  assert.deepEqual(summary.counts, { current: 1, manual: 1, builtin: 225, existing: 6, stale: 1, outdated: 1, missing: 0 })
  assert.equal(summary.failures, 3)
  assert.equal(summary.attention, 3, 'the stale one, the edited-source fallback, and the legacy value whose retranslation failed')
})
