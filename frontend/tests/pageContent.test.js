// The pure half of usePageContent.
//
// Run with `node --test tests/pageContent.test.js` from frontend/, the same
// way tests/seoParity.test.js runs. No React, no rendering harness, no new
// dependency: src/lib/pageContentResolve.js was split out of the hook exactly
// so these rules could be checked as plain functions.

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCmsField, isSectionVisibleIn, computeBands, buildSavePayload, isEmptyPayload, sectionBackground } from '../src/lib/pageContentResolve.js'
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

/* ══════════════ 6. Quota-safe admin save (buildSavePayload) ══════════════ */

const homeDefs = allFieldDefs('home')
const homeBaseline = defaultValues('home')

test('6a. changing ONE field sends one field, not the whole page', () => {
  // The first save of a page is the case this protects. Sending all ~57
  // homepage fields would make the server translate every one of them, five
  // MyMemory calls each, because none is stored yet for isUnchangedSource()
  // to recognise.
  assert.ok(homeDefs.length > 40, 'fixture no longer represents a large page')

  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: { ...homeBaseline, heroHeading1: 'We Build Istanbul' },
    baselineSections: {},
    sections: {},
  })

  assert.deepEqual(Object.keys(payload.fields), ['heroHeading1'])
  assert.deepEqual(payload.fields.heroHeading1, { type: 'text', value: 'We Build Istanbul' })
  assert.deepEqual(payload.sections, {})
})

test('6b. an image-only edit sends zero text fields', () => {
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: { ...homeBaseline, heroImage: 'https://cdn.test/new.png' },
    baselineSections: {},
    sections: {},
  })

  assert.deepEqual(Object.keys(payload.fields), ['heroImage'])
  assert.equal(payload.fields.heroImage.type, 'image')
  const textFields = Object.values(payload.fields).filter((f) => f.type === 'text')
  assert.equal(textFields.length, 0, 'an image edit dragged text fields along')
})

test('6c. a section-only edit sends an empty fields object', () => {
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: homeBaseline,
    baselineSections: {},
    sections: { testimonials: false },
  })

  assert.deepEqual(payload.fields, {}, 'a section toggle sent text fields')
  assert.deepEqual(payload.sections, { testimonials: false })
})

test('6d. an untouched page produces an empty payload', () => {
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: homeBaseline,
    baselineSections: { cta: false },
    sections: { cta: false },
  })

  assert.deepEqual(payload.fields, {})
  assert.deepEqual(payload.sections, {})
  assert.equal(isEmptyPayload(payload), true)
})

test('6e. changing a value and changing it back sends nothing', () => {
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: { ...homeBaseline, heroHeading1: homeBaseline.heroHeading1 },
    baselineSections: {},
    sections: {},
  })

  assert.equal(isEmptyPayload(payload), true)
})

test('6f. toggling a never-configured section on is not a change', () => {
  // Absent and true both mean visible, so this must normalise to "no change"
  // rather than writing a redundant `true`.
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: homeBaseline,
    baselineSections: {},
    sections: { services: true },
  })

  assert.deepEqual(payload.sections, {})
})

test('6g. re-showing a hidden section IS a change', () => {
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: homeBaseline,
    baselineSections: { services: false },
    sections: { services: true },
  })

  assert.deepEqual(payload.sections, { services: true })
})

test('6h. several edits at once are all included', () => {
  const payload = buildSavePayload({
    fieldDefs: homeDefs,
    baselineValues: homeBaseline,
    values: { ...homeBaseline, heroHeading1: 'A', ctaHeading: 'B', heroImage: '/x.png' },
    baselineSections: {},
    sections: { partners: false },
  })

  assert.deepEqual(Object.keys(payload.fields).sort(), ['ctaHeading', 'heroImage', 'heroHeading1'].sort())
  assert.deepEqual(payload.sections, { partners: false })
})

/* ══════════════ 7. sectionBackground — band reaches a real colour ══════════════ */

// Architecture's real values: stats is #252523, which is "dark" but NOT the
// canonical dark. Keeping it is the whole point of the helper.
const ARCH_BANDS = { showroom: 'light', stats: 'dark', services: 'light', process: 'dark', cta: 'light' }
const ARCH_BG = { showroom: '#F6F3ED', stats: '#252523', services: '#F6F3ED', process: '#1E1E1C', cta: '#F6F3ED' }
const ARCH_CANON = { dark: '#1E1E1C', light: '#F6F3ED' }
const ARCH_ORDER = ['showroom', 'stats', 'services', 'process', 'cta']

const archBg = (sections) => {
  const bands = computeBands(ARCH_ORDER, ARCH_BANDS, sections)
  const out = {}
  for (const key of ARCH_ORDER) {
    if (!isSectionVisibleIn(sections, key)) continue
    out[key] = sectionBackground(key, bands[key], ARCH_BANDS, ARCH_BG, ARCH_CANON)
  }
  return out
}

test('7a. with every section visible, colours are byte-identical to the design', () => {
  assert.deepEqual(archBg({}), ARCH_BG, 'the CMS altered a colour with nothing hidden')
})

test('7b. a distinct in-band colour is preserved, not flattened', () => {
  // stats stays #252523 rather than collapsing to the canonical dark.
  assert.equal(archBg({}).stats, '#252523')
})

test('7c. hiding a middle section flips the clash and the new band reaches a colour', () => {
  // showroom(light) [stats hidden] services(light) — two light bands would meet,
  // and they were not adjacent by design, so services flips to dark.
  const bg = archBg({ stats: false })

  assert.equal(bg.showroom, '#F6F3ED')
  assert.equal(bg.services, ARCH_CANON.dark, 'the flipped band did not reach a colour')
  assert.ok(!('stats' in bg), 'a hidden section still produced a background')
})

test('7d. hiding a section leaves every remaining colour defined', () => {
  for (const hidden of ARCH_ORDER) {
    const bg = archBg({ [hidden]: false })
    for (const key of ARCH_ORDER) {
      if (key === hidden) continue
      assert.ok(bg[key], `${key} lost its background when ${hidden} was hidden`)
    }
  }
})

test('7e. an intentional same-tone pair survives on the homepage run', () => {
  // process(dark) projects(dark) stats(dark) are adjacent BY DESIGN, as are
  // testimonials(light) partners(light). Nothing hidden means nothing flips.
  const order = ['services', 'about', 'browse', 'trust', 'process', 'featured', 'projects', 'stats', 'testimonials', 'partners', 'cta']
  const bands = {
    services: 'dark', about: 'light', browse: 'dark', trust: 'light', process: 'dark',
    featured: 'light', projects: 'dark', stats: 'dark', testimonials: 'light',
    partners: 'light', cta: 'dark',
  }

  assert.deepEqual(computeBands(order, bands, {}), bands, 'a designed pairing was flipped')
})

test('7f. hiding a homepage section between differing bands repairs the clash', () => {
  const order = ['services', 'about', 'browse', 'trust', 'process', 'featured', 'projects', 'stats', 'testimonials', 'partners', 'cta']
  const bands = {
    services: 'dark', about: 'light', browse: 'dark', trust: 'light', process: 'dark',
    featured: 'light', projects: 'dark', stats: 'dark', testimonials: 'light',
    partners: 'light', cta: 'dark',
  }

  // Hide `about` (light): services(dark) would sit against browse(dark).
  const out = computeBands(order, bands, { about: false })

  assert.equal(out.services, 'dark')
  assert.equal(out.browse, 'light', 'two dark bands ended up adjacent')
})
