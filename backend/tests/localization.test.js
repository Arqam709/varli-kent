// Wave 12A1 — dynamic content localization (foundation + About).
//
// Two properties matter more than anything else here:
//
//   1. A legacy document must keep rendering. Every AboutContent row in this
//      database stores plain strings today. If the new code cannot read them,
//      the About page empties out for every visitor the moment it deploys —
//      and no migration has run yet, by design.
//
//   2. A failed translation must never destroy a good one. MyMemory answers
//      HTTP 200 while refusing to translate, so "the request succeeded" and
//      "we have a translation" are different facts. Confusing them is how a
//      fully-translated page silently reverts to English, or worse, starts
//      showing visitors a quota-warning sentence as body copy.
//
// No network: every provider call goes through an injected fetch.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUPPORTED_LANGUAGES,
  resolveLocalized,
  isPoisonedTranslation,
  isUsableText,
  isLocalizedObject,
  unwrapLocalized,
} from '../utils/localizedField.js'

import {
  detectLang,
  isTranslationFailure,
  sanitizePoisonedTranslations,
  translateOne,
  localizeText,
  TRANSLATE_TIMEOUT_MS,
} from '../utils/autoTranslate.js'


/* ── no-network guard ──────────────────────────────────────────────────────
 * Every provider call in this suite goes through an injected fetch. If a
 * future edit forgets to inject one, the call lands here and fails the test
 * immediately rather than silently making a real MyMemory request — which is
 * slow, rate-limited, and makes the suite depend on someone else's quota.
 */
globalThis.fetch = async (url) => {
  throw new Error(`localization tests must not touch the network (tried: ${url})`)
}

/* ── provider doubles ──────────────────────────────────────────────────── */

const targetOf = (url) => decodeURIComponent(url).split('autodetect|')[1]

const ok = (body) => ({ ok: true, json: async () => body })

const goodProvider = async (url) =>
  ok({ responseStatus: 200, responseData: { translatedText: `[${targetOf(url)}]` } })

const failingFor = (langs, body) => async (url) => {
  const target = targetOf(url)
  if (langs.includes(target)) return ok(body)
  return goodProvider(url)
}

// The real sentences MyMemory returns, taken from the pattern the donor's
// isTranslationFailure matches.
const QUOTA_WARNING =
  'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 04 HOURS'
const LENGTH_LIMIT = 'QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS'
const BAD_PAIR = "INVALID LANGPAIR: 'autodetect|zz'"

/* ══════════════ 1. Resolver ═══════════════════════════════════════════ */

test('12A1: a legacy plain string still resolves in every language', async (t) => {
  // The whole no-migration-required promise rests on this.
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized('Our Story', lang), 'Our Story')
    })
  }
})

test('12A1: a full localized object returns each language', async (t) => {
  const value = {
    sourceLang: 'en',
    en: 'Our Story', tr: 'Hikayemiz', ar: 'قصتنا',
    de: 'Unsere Geschichte', ru: 'Наша история', ur: 'ہماری کہانی',
  }
  const EXPECTED = {
    en: 'Our Story', tr: 'Hikayemiz', ar: 'قصتنا',
    de: 'Unsere Geschichte', ru: 'Наша история', ur: 'ہماری کہانی',
  }
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(value, lang), EXPECTED[lang])
    })
  }
})

test('12A1: a partial object falls back to English', () => {
  const value = { sourceLang: 'en', en: 'Our Story', tr: 'Hikayemiz' }
  assert.equal(resolveLocalized(value, 'tr'), 'Hikayemiz')
  assert.equal(resolveLocalized(value, 'de'), 'Our Story')
  assert.equal(resolveLocalized(value, 'ru'), 'Our Story')
  assert.equal(resolveLocalized(value, 'ur'), 'Our Story')
})

test('12A1: with no English, the admin source language is used', () => {
  // An admin wrote Arabic and the English translation failed. Real Arabic
  // text on the document beats an empty page.
  const value = { sourceLang: 'ar', ar: 'قصتنا', tr: 'Hikayemiz' }
  assert.equal(resolveLocalized(value, 'de'), 'قصتنا')
})

test('12A1: any usable value is preferred over nothing', () => {
  const value = { sourceLang: 'en', ru: 'Наша история' }
  assert.equal(resolveLocalized(value, 'de'), 'Наша история')
})

test('12A1: an unknown requested language falls back to English', () => {
  const value = { sourceLang: 'en', en: 'Our Story', tr: 'Hikayemiz' }
  for (const bad of ['zz', 'EN', '', null, undefined, 42, {}]) {
    assert.equal(resolveLocalized(value, bad), 'Our Story', `language ${JSON.stringify(bad)}`)
  }
})

test('12A1: empty, null and malformed values resolve to an empty string', async (t) => {
  for (const value of [null, undefined, '', '   ', {}, [], 42, true, { sourceLang: 'en' }]) {
    await t.test(JSON.stringify(value) ?? 'undefined', () => {
      assert.equal(resolveLocalized(value, 'tr'), '')
    })
  }
})

test('12A1: Turkish dotted/dotless I and other scripts round-trip intact', () => {
  const value = {
    sourceLang: 'tr',
    tr: 'İstanbul’un Işıkları', en: 'Lights of Istanbul',
    ar: 'أضواء إسطنبول', ru: 'Огни Стамбула', ur: 'استنبول کی روشنیاں',
    de: 'Lichter Istanbuls',
  }
  assert.equal(resolveLocalized(value, 'tr'), 'İstanbul’un Işıkları')
  assert.equal(resolveLocalized(value, 'ar'), 'أضواء إسطنبول')
  assert.equal(resolveLocalized(value, 'ru'), 'Огни Стамбула')
  assert.equal(resolveLocalized(value, 'ur'), 'استنبول کی روشنیاں')
})

/* ══════════════ 2. Poisoned reads ═════════════════════════════════════ */

test('12A1: a poisoned requested language is never shown', async (t) => {
  for (const poison of [QUOTA_WARNING, LENGTH_LIMIT, BAD_PAIR]) {
    await t.test(poison.slice(0, 30), () => {
      const value = { sourceLang: 'en', en: 'Our Story', tr: poison }
      assert.equal(resolveLocalized(value, 'tr'), 'Our Story')
    })
  }
})

test('12A1: poisoned English is skipped too', () => {
  const value = { sourceLang: 'tr', tr: 'Hikayemiz', en: QUOTA_WARNING }
  assert.equal(resolveLocalized(value, 'de'), 'Hikayemiz')
})

test('12A1: when every value is poisoned, nothing is shown', () => {
  const value = {
    sourceLang: 'en',
    en: QUOTA_WARNING, tr: QUOTA_WARNING, ar: LENGTH_LIMIT,
    de: BAD_PAIR, ru: QUOTA_WARNING, ur: QUOTA_WARNING,
  }
  assert.equal(resolveLocalized(value, 'tr'), '')
})

test('12A1: a poisoned legacy scalar is not shown either', () => {
  assert.equal(resolveLocalized(QUOTA_WARNING, 'en'), '')
})

test('12A1: ordinary prose is never mistaken for provider garbage', async (t) => {
  // A word-level ban would fail these. The pattern is deliberately built
  // from whole provider phrases, not from words like "warning" or "limit".
  const REAL = [
    'Our warning to buyers is simple: read the title deed.',
    'There is no limit to what we can build.',
    'The query was answered within the day.',
    'Invalid documents will be returned to the seller.',
    'MEMORY of the old city runs deep.',
    'Hikayemiz İstanbul’da başladı.',
    'قصتنا بدأت في إسطنبول',
  ]
  for (const value of REAL) {
    await t.test(value.slice(0, 34), () => {
      assert.equal(isPoisonedTranslation(value), false)
      assert.equal(isUsableText(value), true)
      assert.equal(resolveLocalized({ sourceLang: 'en', en: value }, 'en'), value)
    })
  }
})

test('12A1: sanitizePoisonedTranslations strips nested garbage only', () => {
  const cleaned = sanitizePoisonedTranslations({
    heroLabel: { sourceLang: 'en', en: 'Our Story', tr: QUOTA_WARNING },
    stats: [{ value: '10+', label: { en: 'Years', de: LENGTH_LIMIT } }],
    missionImage: 'https://res.cloudinary.com/x/a.jpg',
  })
  assert.equal(cleaned.heroLabel.en, 'Our Story')
  assert.ok(!('tr' in cleaned.heroLabel), 'poisoned tr must be removed')
  assert.equal(cleaned.stats[0].value, '10+', 'a stat value is not prose')
  assert.ok(!('de' in cleaned.stats[0].label))
  assert.equal(cleaned.missionImage, 'https://res.cloudinary.com/x/a.jpg')
})

/* ══════════════ 3. Provider failure detection ═════════════════════════ */

test('12A1: HTTP 200 with a quota warning is a FAILURE', async (t) => {
  const CASES = [
    ['quota warning', { responseStatus: 200, responseData: { translatedText: QUOTA_WARNING } }],
    ['length limit', { responseStatus: 200, responseData: { translatedText: LENGTH_LIMIT } }],
    ['invalid langpair', { responseStatus: 200, responseData: { translatedText: BAD_PAIR } }],
    ['empty translation', { responseStatus: 200, responseData: { translatedText: '' } }],
    ['blank translation', { responseStatus: 200, responseData: { translatedText: '   ' } }],
    ['non-200 responseStatus', { responseStatus: 403, responseData: { translatedText: 'Hikayemiz' } }],
    ['missing responseData', { responseStatus: 200 }],
    ['null body', null],
    ['not an object', 'nope'],
  ]
  for (const [name, body] of CASES) {
    await t.test(name, () => assert.equal(isTranslationFailure(body), true))
  }
})

test('12A1: a real translation is not a failure', () => {
  assert.equal(
    isTranslationFailure({ responseStatus: 200, responseData: { translatedText: 'Hikayemiz' } }),
    false
  )
})

test('12A1: translateOne returns null — never the source — on every failure', async (t) => {
  const CASES = [
    ['quota warning', async () => ok({ responseStatus: 200, responseData: { translatedText: QUOTA_WARNING } })],
    ['empty result', async () => ok({ responseStatus: 200, responseData: { translatedText: '' } })],
    ['http error', async () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['malformed json', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json') } })],
    ['network error', async () => { throw new TypeError('fetch failed') }],
    ['timeout', async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) }],
  ]
  for (const [name, impl] of CASES) {
    await t.test(name, async () => {
      const result = await translateOne('Our Story', 'tr', impl)
      assert.equal(result, null, 'must be null so the caller can tell failure from success')
      assert.notEqual(result, 'Our Story', 'must never echo the source text back as a translation')
    })
  }
})

test('12A1: the provider timeout is the donor’s five seconds', () => {
  assert.equal(TRANSLATE_TIMEOUT_MS, 5000)
})

test('12A1: empty input is never sent to the provider', async (t) => {
  for (const value of ['', '   ', null, undefined, 42]) {
    await t.test(JSON.stringify(value) ?? 'undefined', async () => {
      let called = false
      const spy = async (...args) => { called = true; return goodProvider(...args) }
      assert.equal(await translateOne(value, 'tr', spy), null)
      assert.equal(called, false, 'no request should be made')
    })
  }
})

/* ══════════════ 4. Source-language detection ══════════════════════════ */

test('12A1: source language detection covers en/tr/ar only', async (t) => {
  const CASES = [
    ['Our Story', 'en'],
    ['Hikayemiz İstanbul’da başladı', 'tr'],
    ['قصتنا بدأت في إسطنبول', 'ar'],
    // de/ru/ur are translate-only targets and must NOT be inferred as a
    // source — treating German as a source would translate German to German.
    ['Unsere Geschichte begann in Istanbul', 'en'],
    ['Наша история', 'en'],
    [null, 'en'],
  ]
  for (const [text, expected] of CASES) {
    await t.test(String(text).slice(0, 34), () => assert.equal(detectLang(text), expected))
  }
})

/* ══════════════ 5. localizeText ═══════════════════════════════════════ */

test('12A1: an English source produces all six languages', async () => {
  const out = await localizeText('Our Story', null, goodProvider)
  assert.equal(out.sourceLang, 'en')
  assert.equal(out.en, 'Our Story', 'source text stored verbatim')
  for (const lang of ['tr', 'ar', 'de', 'ru', 'ur']) {
    assert.equal(out[lang], `[${lang}]`)
  }
})

test('12A1: the admin’s own words are never round-tripped', async (t) => {
  // Turkish in, Turkish out — not Turkish -> English -> Turkish.
  const CASES = [
    ['Hikayemiz İstanbul’da başladı', 'tr'],
    ['قصتنا بدأت في إسطنبول', 'ar'],
    ['Our Story', 'en'],
  ]
  for (const [source, lang] of CASES) {
    await t.test(lang, async () => {
      const out = await localizeText(source, null, goodProvider)
      assert.equal(out.sourceLang, lang)
      assert.equal(out[lang], source, 'the source language must hold the exact admin text')
    })
  }
})

test('12A1: one failed target does not affect the others', async () => {
  const out = await localizeText('Our Story', null, failingFor(['de'], {
    responseStatus: 200, responseData: { translatedText: QUOTA_WARNING },
  }))
  assert.equal(out.en, 'Our Story')
  for (const lang of ['tr', 'ar', 'ru', 'ur']) {
    assert.equal(out[lang], `[${lang}]`, `${lang} must still be translated`)
  }
  assert.ok(!('de' in out), 'a failed target with no previous value is omitted, not faked')
})

test('12A1: a failed target NEVER stores provider garbage or the source text', async (t) => {
  const FAILURES = [
    ['quota warning', { responseStatus: 200, responseData: { translatedText: QUOTA_WARNING } }],
    ['length limit', { responseStatus: 200, responseData: { translatedText: LENGTH_LIMIT } }],
    ['empty', { responseStatus: 200, responseData: { translatedText: '' } }],
  ]
  for (const [name, body] of FAILURES) {
    await t.test(name, async () => {
      const out = await localizeText('Our Story', null, failingFor(['de'], body))
      assert.notEqual(out.de, QUOTA_WARNING)
      assert.notEqual(out.de, LENGTH_LIMIT)
      assert.notEqual(out.de, 'Our Story', 'the source text is not a German translation')
      assert.equal(out.de, undefined)
    })
  }
})

test('12A1: THE KEY CASE — a failed retranslation keeps the existing good one', async () => {
  /*
   * The donor bug this exists to prevent: its translateOne returns the source
   * text on failure and its localizeText has no access to what is already
   * stored, so one save during a quota outage overwrites every good
   * translation with English — permanently, and silently.
   */
  const existing = {
    sourceLang: 'en',
    en: 'Our Story',
    tr: 'Hikayemiz',
    ar: 'قصتنا',
    de: 'Unsere Geschichte',
    ru: 'Наша история',
    ur: 'ہماری کہانی',
  }

  const out = await localizeText(
    'Our Story, Retold',
    existing,
    failingFor(['tr', 'de'], { responseStatus: 200, responseData: { translatedText: QUOTA_WARNING } })
  )

  assert.equal(out.en, 'Our Story, Retold', 'the new source text is stored')
  assert.equal(out.tr, 'Hikayemiz', 'the existing Turkish translation survives')
  assert.equal(out.de, 'Unsere Geschichte', 'the existing German translation survives')
  assert.equal(out.ar, '[ar]', 'a target that succeeded is updated')
  assert.equal(out.ru, '[ru]')
  assert.equal(out.ur, '[ur]')

  for (const value of Object.values(out)) {
    assert.equal(isPoisonedTranslation(value), false, 'nothing poisoned was stored')
  }
})

test('12A1: an existing POISONED value is not preserved on failure', () => {
  // Preserving "whatever was there" would keep garbage alive forever.
  assert.equal(isUsableText(QUOTA_WARNING), false)
})

test('12A1: a total provider outage still stores the source and keeps old targets', async () => {
  const dead = async () => { throw new TypeError('fetch failed') }
  const existing = { sourceLang: 'en', en: 'Old', tr: 'Hikayemiz' }
  const out = await localizeText('New Story', existing, dead)

  assert.equal(out.sourceLang, 'en')
  assert.equal(out.en, 'New Story', 'the save is not lost when the provider is down')
  assert.equal(out.tr, 'Hikayemiz', 'the previous Turkish translation survives an outage')
  assert.ok(!('de' in out))
})

test('12A1: empty admin input produces an empty localized value, no requests', async () => {
  let called = false
  const spy = async (...args) => { called = true; return goodProvider(...args) }
  const out = await localizeText('   ', null, spy)
  assert.equal(called, false)
  assert.equal(out.sourceLang, 'en')
  assert.equal(resolveLocalized(out, 'tr'), '')
})

/* ══════════════ 6. About payload localization ═════════════════════════ */

const { localizeAboutPayload, LOCALIZED_TOP_LEVEL_FIELDS } = await import('../routes/about.js')

test('12A1: every localizable About field is localized', async () => {
  const out = await localizeAboutPayload(
    {
      heroLabel: 'Our Story',
      heroHeading: 'About Varlikent',
      heroSubtext: 'Premier agency.',
      missionLabel: 'Our Mission',
      missionHeading: 'A refined approach.',
      missionParagraph1: 'One.',
      missionParagraph2: 'Two.',
      teamLabel: 'Our Team',
      teamHeading: 'Meet Our Experts',
      stats: [{ value: '10+', label: 'Years Experience', order: 0 }],
      team: [{ name: 'Selin Kaya', role: 'Senior Agent', avatar: '', order: 0 }],
      contentBlocks: [{ heading: 'Heritage', paragraphs: ['First.', 'Second.'], image: '', order: 0 }],
    },
    {},
    goodProvider
  )

  for (const field of LOCALIZED_TOP_LEVEL_FIELDS) {
    assert.ok(isLocalizedObject(out[field]), `${field} must be localized`)
  }
  assert.ok(isLocalizedObject(out.stats[0].label))
  assert.ok(isLocalizedObject(out.team[0].role))
  assert.ok(isLocalizedObject(out.contentBlocks[0].heading))
  assert.ok(isLocalizedObject(out.contentBlocks[0].paragraphs[0]))
  assert.ok(isLocalizedObject(out.contentBlocks[0].paragraphs[1]))
})

test('12A1: machine data on the About payload is never translated', async () => {
  const payload = {
    heroLabel: 'Our Story',
    missionImage: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg',
    stats: [{ value: '500+', label: 'Properties Listed', order: 3 }],
    team: [{ name: 'Selin Kaya', role: 'Senior Agent', avatar: 'https://cdn/x.png', order: 1 }],
    contentBlocks: [{ heading: 'H', paragraphs: ['P'], image: 'https://cdn/b.jpg', imagePosition: 'left', order: 2 }],
  }
  const out = await localizeAboutPayload(payload, {}, goodProvider)

  // URLs, names, stat values, layout keywords, orders — all verbatim.
  assert.equal(out.missionImage, payload.missionImage)
  assert.equal(out.stats[0].value, '500+')
  assert.equal(out.stats[0].order, 3)
  assert.equal(out.team[0].name, 'Selin Kaya')
  assert.equal(out.team[0].avatar, 'https://cdn/x.png')
  assert.equal(out.team[0].order, 1)
  assert.equal(out.contentBlocks[0].image, 'https://cdn/b.jpg')
  assert.equal(out.contentBlocks[0].imagePosition, 'left')
  assert.equal(out.contentBlocks[0].order, 2)
})

test('12A1: an already-localized field is passed through untouched', async () => {
  // The admin form sends stored objects back for fields it did not edit.
  // Re-translating them would spend six provider requests to reproduce what
  // is already there — and degrade it while the quota is exhausted.
  const stored = { sourceLang: 'en', en: 'Our Story', tr: 'Hikayemiz' }
  const out = await localizeAboutPayload({ heroLabel: stored }, { heroLabel: stored }, goodProvider)
  assert.deepEqual(out.heroLabel, stored)
})

test('12A1: a field absent from the payload is not invented', async () => {
  const out = await localizeAboutPayload({ heroLabel: 'Our Story' }, {}, goodProvider)
  assert.ok(!('heroHeading' in out), 'untouched fields stay out of the update')
})

/* ══════════════ 7. Legacy and localized About documents ═══════════════ */

// The shape every AboutContent row in this database has today.
const LEGACY_ABOUT = {
  heroLabel: 'Our Story',
  heroHeading: 'About Varlikent',
  heroSubtext: "Istanbul's premier luxury real estate agency.",
  missionLabel: 'Our Mission',
  missionHeading: 'A refined approach to luxury real estate.',
  missionParagraph1: 'We bring together market insight.',
  missionParagraph2: 'Founded with a passion.',
  missionImage: '',
  teamLabel: 'Our Team',
  teamHeading: 'Meet Our Experts',
  stats: [{ value: '10+', label: 'Years Experience', order: 0 }],
  team: [{ name: 'Selin Kaya', role: 'Senior Agent', avatar: '', order: 0 }],
  contentBlocks: [{ heading: 'Heritage', paragraphs: ['First.', 'Second.'], image: '', order: 0 }],
}

test('12A1: a legacy About document renders in every language', async (t) => {
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(LEGACY_ABOUT.heroLabel, lang), 'Our Story')
      assert.equal(resolveLocalized(LEGACY_ABOUT.stats[0].label, lang), 'Years Experience')
      assert.equal(resolveLocalized(LEGACY_ABOUT.team[0].role, lang), 'Senior Agent')
      assert.equal(resolveLocalized(LEGACY_ABOUT.contentBlocks[0].heading, lang), 'Heritage')
      assert.equal(resolveLocalized(LEGACY_ABOUT.contentBlocks[0].paragraphs[0], lang), 'First.')
    })
  }
})

test('12A1: a legacy document survives the public sanitizer intact', () => {
  assert.deepEqual(sanitizePoisonedTranslations(LEGACY_ABOUT), LEGACY_ABOUT)
})

test('12A1: a legacy document unwraps cleanly into the admin form', () => {
  assert.equal(unwrapLocalized(LEGACY_ABOUT.heroLabel), 'Our Story')
  assert.equal(unwrapLocalized(LEGACY_ABOUT.team[0].role), 'Senior Agent')
})

test('12A1: a localized About document resolves per language', async (t) => {
  const localized = {
    heroLabel: {
      sourceLang: 'en',
      en: 'Our Story', tr: 'Hikayemiz', ar: 'قصتنا',
      de: 'Unsere Geschichte', ru: 'Наша история', ur: 'ہماری کہانی',
    },
    stats: [{ value: '10+', label: { sourceLang: 'en', en: 'Years', tr: 'Yıl' } }],
    team: [{ name: 'Selin Kaya', role: { sourceLang: 'tr', tr: 'Kıdemli Danışman', en: 'Senior Agent' } }],
  }
  const EXPECTED = {
    en: 'Our Story', tr: 'Hikayemiz', ar: 'قصتنا',
    de: 'Unsere Geschichte', ru: 'Наша история', ur: 'ہماری کہانی',
  }

  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(localized.heroLabel, lang), EXPECTED[lang])
      // Partial nested values fall back to English rather than blanking.
      assert.equal(resolveLocalized(localized.stats[0].label, lang), lang === 'tr' ? 'Yıl' : 'Years')
      assert.equal(
        resolveLocalized(localized.team[0].role, lang),
        lang === 'tr' ? 'Kıdemli Danışman' : 'Senior Agent'
      )
    })
  }
})

test('12A1: a document mixing legacy strings and localized objects works', () => {
  // Exactly what the database looks like after an admin edits some fields
  // but not others — and the reason no migration is required.
  const mixed = {
    heroLabel: { sourceLang: 'en', en: 'Our Story', tr: 'Hikayemiz' },
    heroHeading: 'About Varlikent',
    stats: [
      { value: '10+', label: { sourceLang: 'en', en: 'Years', tr: 'Yıl' } },
      { value: '500+', label: 'Properties Listed' },
    ],
  }
  assert.equal(resolveLocalized(mixed.heroLabel, 'tr'), 'Hikayemiz')
  assert.equal(resolveLocalized(mixed.heroHeading, 'tr'), 'About Varlikent')
  assert.equal(resolveLocalized(mixed.stats[0].label, 'tr'), 'Yıl')
  assert.equal(resolveLocalized(mixed.stats[1].label, 'tr'), 'Properties Listed')
})

/* ══════════════ 8. Admin round-trip ═══════════════════════════════════ */

test('12A1: unwrapLocalized gives the admin their own text back', () => {
  const turkishSource = { sourceLang: 'tr', tr: 'Hikayemiz', en: 'Our Story', de: 'Unsere Geschichte' }
  assert.equal(unwrapLocalized(turkishSource), 'Hikayemiz', 'not the English translation')

  assert.equal(unwrapLocalized('Plain legacy'), 'Plain legacy')
  assert.equal(unwrapLocalized(null), '')
  assert.equal(unwrapLocalized({}), '')
  assert.equal(unwrapLocalized({ sourceLang: 'tr', tr: QUOTA_WARNING, en: 'Our Story' }), 'Our Story')
})

test('12A1: isLocalizedObject distinguishes the two stored shapes', () => {
  assert.equal(isLocalizedObject({ sourceLang: 'en', en: 'x' }), true)
  assert.equal(isLocalizedObject({ tr: 'x' }), true)
  assert.equal(isLocalizedObject('plain string'), false)
  assert.equal(isLocalizedObject({ sourceLang: 'en' }), false, 'no language values is not localized')
  assert.equal(isLocalizedObject(null), false)
  assert.equal(isLocalizedObject([]), false)
})
