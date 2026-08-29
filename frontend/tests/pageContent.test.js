// The pure half of usePageContent.
//
// Run with `node --test tests/pageContent.test.js` from frontend/, the same
// way tests/seoParity.test.js runs. No React, no rendering harness, no new
// dependency: src/lib/pageContentResolve.js was split out of the hook exactly
// so these rules could be checked as plain functions.

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCmsField, isSectionVisibleIn, computeBands } from '../src/lib/pageContentResolve.js'
import { PAGE_CONTENT_REGISTRY, defaultValues, allFieldDefs } from '../src/lib/pageContentRegistry.js'

const textField = (langs) => ({ type: 'text', sourceLang: 'en', ...langs })

/* ══════════════ 1. Text resolution ══════════════ */

test('1a. the requested language wins when it is stored', () => {
  const field = textField({ en: 'Our Team', tr: 'Ekibimiz', de: 'Unser Team' })

  assert.equal(resolveCmsField(field, 'tr', 'FALLBACK'), 'Ekibimiz')
  assert.equal(resolveCmsField(field, 'de', 'FALLBACK'), 'Unser Team')
  assert.equal(resolveCmsField(field, 'en', 'FALLBACK'), 'Our Team')
})

test('1b. a missing language falls back to the CALLER, not to stored English', () => {
  // The case this ordering exists for: a field saved before de/ru/ur joined
  // the pipeline. `fallback` is already the page's German string, so returning
  // stored English here would turn a correct German page into an English one.
  const field = textField({ en: 'Our Team', tr: 'Ekibimiz', ar: 'فريقنا' })

  assert.equal(resolveCmsField(field, 'de', 'Unser Team'), 'Unser Team')
  assert.equal(resolveCmsField(field, 'ru', 'Наша команда'), 'Наша команда')
  assert.equal(resolveCmsField(field, 'ur', 'ہماری ٹیم'), 'ہماری ٹیم')
})

test('1c. stored English is still used when no fallback is offered', () => {
  const field = textField({ en: 'Our Team', tr: 'Ekibimiz' })

  assert.equal(resolveCmsField(field, 'de', ''), 'Our Team')
  assert.equal(resolveCmsField(field, 'de', undefined), 'Our Team')
})

test('1d. an absent field returns the fallback untouched', () => {
  assert.equal(resolveCmsField(undefined, 'en', 'FALLBACK'), 'FALLBACK')
  assert.equal(resolveCmsField(null, 'tr', 'FALLBACK'), 'FALLBACK')
})

test('1e. a blank stored value does not beat the fallback', () => {
  const field = textField({ en: 'Our Team', tr: '   ' })

  assert.equal(resolveCmsField(field, 'tr', 'Ekibimiz'), 'Ekibimiz')
})

test('1f. a poisoned translation is never rendered as content', () => {
  const field = textField({
    en: 'Our Team',
    tr: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS',
  })

  assert.equal(resolveCmsField(field, 'tr', 'Ekibimiz'), 'Ekibimiz')
  // And with no fallback it degrades to English rather than to the warning.
  assert.equal(resolveCmsField(field, 'tr', ''), 'Our Team')
})

/* ══════════════ 2. Image resolution ══════════════ */

test('2. images resolve by URL, never by language', () => {
  assert.equal(
    resolveCmsField({ type: 'image', url: 'https://cdn.test/a.png' }, 'tr', '/images/default.png'),
    'https://cdn.test/a.png'
  )
  // Empty means "no override" — the page keeps its built-in asset.
  assert.equal(resolveCmsField({ type: 'image', url: '' }, 'en', '/images/default.png'), '/images/default.png')
  assert.equal(resolveCmsField({ type: 'image', url: '   ' }, 'en', '/images/default.png'), '/images/default.png')
})

/* ══════════════ 3. Section visibility ══════════════ */

test('3. a section is visible unless explicitly set false', () => {
  assert.equal(isSectionVisibleIn({}, 'services'), true, 'unconfigured must default to visible')
  assert.equal(isSectionVisibleIn(undefined, 'services'), true)
  assert.equal(isSectionVisibleIn({ services: true }, 'services'), true)
  assert.equal(isSectionVisibleIn({ services: false }, 'services'), false)
  // Only a real `false` hides. Anything else is treated as configured-visible.
  assert.equal(isSectionVisibleIn({ services: 0 }, 'services'), true)
})

/* ══════════════ 4. bandFor / computeBands ══════════════ */

const ORDER = ['a', 'b', 'c', 'd']
const ALTERNATING = { a: 'dark', b: 'light', c: 'dark', d: 'light' }

test('4a. with nothing hidden, every section keeps its designed band', () => {
  assert.deepEqual(computeBands(ORDER, ALTERNATING, {}), ALTERNATING)
})

test('4b. hidden sections are absent from the map', () => {
  const bands = computeBands(ORDER, ALTERNATING, { b: false })

  assert.ok(!('b' in bands))
  assert.deepEqual(Object.keys(bands), ['a', 'c', 'd'])
})

test('4c. hiding a section flips the next one to avoid a same-tone clash', () => {
  // a(dark) b(light) c(dark) — hide b and a would sit straight against c,
  // dark on dark. c flips to light so the alternation survives.
  const bands = computeBands(ORDER, ALTERNATING, { b: false })

  assert.equal(bands.a, 'dark')
  assert.equal(bands.c, 'light', 'two dark bands ended up adjacent')
  assert.equal(bands.d, 'dark')
})

test('4d. a deliberate same-tone pairing is left alone', () => {
  // b and c are BOTH dark by design and are neighbours already, so their
  // matching tone is a decision — not something hiding a section caused.
  const designed = { a: 'light', b: 'dark', c: 'dark', d: 'light' }
  const bands = computeBands(ORDER, designed, {})

  assert.equal(bands.b, 'dark')
  assert.equal(bands.c, 'dark', 'an intentional pairing was flipped')
})

test('4e. an all-hidden page produces an empty map', () => {
  assert.deepEqual(computeBands(ORDER, ALTERNATING, { a: false, b: false, c: false, d: false }), {})
})

test('4f. a page with no sections is handled', () => {
  assert.deepEqual(computeBands([], {}, {}), {})
})

/* ══════════════ 5. Registry defaults ══════════════ */

test('5a. every registered page exposes defaults for all its fields', () => {
  for (const pageKey of Object.keys(PAGE_CONTENT_REGISTRY)) {
    const defaults = defaultValues(pageKey)
    const keys = allFieldDefs(pageKey).map((f) => f.key)

    assert.deepEqual(Object.keys(defaults).sort(), [...keys].sort(), `defaults incomplete for '${pageKey}'`)
  }
})

test('5b. the homepage defaults match the text the site renders today', () => {
  // Spot-checks against src/locales/translations.js `en`, which is what
  // actually reaches the screen. Both of these differ from the donor registry
  // and from the JSX inline fallbacks — the reason defaults were re-derived
  // rather than copied.
  const home = defaultValues('home')

  assert.equal(home.heroLabel, 'Istanbul — Architecture · Construction · Real Estate')
  assert.equal(home.heroCtaPrimary, 'Explore Our Services')
  assert.equal(home.heroHeading1, 'We Design, Build')
  assert.equal(home.featuredHeading, 'Featured Properties')
})

test('5c. an unknown page yields no defaults rather than throwing', () => {
  assert.deepEqual(defaultValues('nope'), {})
  assert.deepEqual(allFieldDefs('nope'), [])
})
