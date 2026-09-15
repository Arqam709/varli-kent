// Translation provenance: a stored translation must BE a translation.
//
// ── The bug this pins ───────────────────────────────────────────────────
// The live About document stored every localized field as
//   { sourceLang: 'en', en: 'Our Mission', tr: 'Our Mission', ar: 'Our Mission', … }
// so the website and the app both showed English to Turkish readers — while
// resolving the `tr` key perfectly correctly. PageContent (home: 71 of 72
// fields) and team roles had the same copies.
//
// Cause: MyMemory can answer HTTP 200 with the input unchanged. translateOne
// accepted that echo as the translation, localizeText stored it, and every
// later save that failed "preserved" the copy as a known-good value.
//
// The rule now: an echo is no translation. The target is left absent (clients
// fall back to the source language on purpose) or keeps a previous REAL
// translation — never a copy of the source.
//
// No network: every provider call goes through an injected fetch.

import test from 'node:test'
import assert from 'node:assert/strict'

import { SUPPORTED_LANGUAGES, isUsableText, resolveLocalized, unwrapLocalized } from '../utils/localizedField.js'
import { isSameText, localizeText, translateOne } from '../utils/autoTranslate.js'

globalThis.fetch = async (url) => {
  throw new Error(`provenance tests must not touch the network (tried: ${url})`)
}

const { localizeAboutPayload, LOCALIZED_TOP_LEVEL_FIELDS } = await import('../routes/about.js')

/* ── provider doubles ──────────────────────────────────────────────────── */

const ok = (translatedText, responseStatus = 200) => ({
  ok: true,
  json: async () => ({ responseStatus, responseData: { translatedText } }),
})

const paramsOf = (url) => {
  const parsed = new URL(url)
  return { q: parsed.searchParams.get('q'), target: parsed.searchParams.get('langpair').split('|')[1] }
}

/** Real translations the fake provider "knows"; anything else gets a tagged translation. */
const DICTIONARY = {
  'Our Mission': { tr: 'Misyonumuz', ar: 'مهمتنا', de: 'Unsere Mission', ru: 'Наша миссия', ur: 'ہمارا مشن' },
  'About Varlikent': { tr: 'Varlikent Hakkında', ar: 'عن Varlikent', de: 'Über Varlikent', ru: 'О Varlikent', ur: 'Varlikent کے بارے میں' },
  'Misyonumuz: güven ve şeffaflık': { en: 'Our mission: trust and transparency', ar: 'مهمتنا: الثقة والشفافية', de: 'Unsere Mission: Vertrauen und Transparenz', ru: 'Наша миссия: доверие и прозрачность', ur: 'ہمارا مشن: اعتماد اور شفافیت' },
  'مهمتنا الثقة': { en: 'Our mission is trust', tr: 'Misyonumuz güvendir', de: 'Unsere Mission ist Vertrauen', ru: 'Наша миссия — доверие', ur: 'ہمارا مشن اعتماد ہے' },
}

/**
 * @param {object} options
 * @param {string[]} [options.echo]        targets that answer with the input unchanged
 * @param {object}   [options.respond]     target → (q) => response, for failures
 */
const provider = ({ echo = [], respond = {} } = {}) => {
  const calls = []
  const impl = async (url) => {
    const { q, target } = paramsOf(url)
    calls.push({ q, target })
    if (respond[target]) return respond[target](q)
    if (echo.includes(target)) return ok(q)
    return ok(DICTIONARY[q]?.[target] ?? `[${target}] ${q}`)
  }
  impl.calls = calls
  return impl
}

const QUOTA_WARNING = 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 04 HOURS'
const TARGETS_FOR_EN = ['tr', 'ar', 'de', 'ru', 'ur']

/** Every target that merely repeats the source text. */
const copiesIn = (value) => {
  if (!value || typeof value !== 'object') return []
  const source = value[value.sourceLang]
  return SUPPORTED_LANGUAGES.filter((lang) => lang !== value.sourceLang && isSameText(value[lang], source))
}

/* ══════════════ Source languages ══════════════ */

test('English source: English kept verbatim, every other language really translated', async () => {
  const out = await localizeText('Our Mission', null, provider())

  assert.deepEqual(out, {
    sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz', ar: 'مهمتنا', de: 'Unsere Mission', ru: 'Наша миссия', ur: 'ہمارا مشن',
  })
})

test('Turkish source: Turkish kept verbatim and never sent back through the provider', async () => {
  const fake = provider()
  const out = await localizeText('Misyonumuz: güven ve şeffaflık', null, fake)

  assert.equal(out.sourceLang, 'tr')
  assert.equal(out.tr, 'Misyonumuz: güven ve şeffaflık')
  assert.equal(out.en, 'Our mission: trust and transparency')
  assert.equal(out.ar, 'مهمتنا: الثقة والشفافية')
  assert.equal(out.ur, 'ہمارا مشن: اعتماد اور شفافیت')
  assert.equal(fake.calls.some((call) => call.target === 'tr'), false)
})

test('Arabic source: Arabic kept verbatim and never sent back through the provider', async () => {
  const fake = provider()
  const out = await localizeText('مهمتنا الثقة', null, fake)

  assert.equal(out.sourceLang, 'ar')
  assert.equal(out.ar, 'مهمتنا الثقة')
  assert.equal(out.en, 'Our mission is trust')
  assert.equal(out.tr, 'Misyonumuz güvendir')
  assert.equal(fake.calls.some((call) => call.target === 'ar'), false)
})

/* ══════════════ Provider echoes — the live bug ══════════════ */

test('an echoed target is not stored as a translation', async () => {
  const out = await localizeText('Our Mission', null, provider({ echo: ['tr'] }))

  assert.equal('tr' in out, false, 'the English text was stored as Turkish')
  assert.equal(out.ar, 'مهمتنا', 'the other targets are unaffected')
  assert.equal(out.de, 'Unsere Mission')
})

test('an echo differing only in case or whitespace is still an echo', async () => {
  const sloppy = provider({ respond: { tr: (q) => ok(`  ${q.toUpperCase()} `), de: (q) => ok(q.replace(' ', '\n')) } })
  const out = await localizeText('Our Mission', null, sloppy)

  assert.equal('tr' in out, false)
  assert.equal('de' in out, false)
  assert.equal(out.ru, 'Наша миссия')
})

test('translateOne returns null for an echo', async () => {
  assert.equal(await translateOne('Our Mission', 'tr', provider({ echo: ['tr'] })), null)
  assert.equal(await translateOne('Our Mission', 'tr', provider()), 'Misyonumuz')
})

test('THE LIVE CASE: a provider echoing every language produces the source only — no fake translations', async () => {
  const out = await localizeText('Our Mission', null, provider({ echo: TARGETS_FOR_EN }))

  assert.deepEqual(out, { sourceLang: 'en', en: 'Our Mission' })
  // Clients then fall back to English deliberately, instead of trusting a copy.
  assert.equal(resolveLocalized(out, 'tr'), 'Our Mission')
})

test('a brand-only phrase the provider leaves unchanged still reads correctly everywhere', async () => {
  const out = await localizeText('Varlikent', null, provider({ echo: TARGETS_FOR_EN }))

  assert.deepEqual(out, { sourceLang: 'en', en: 'Varlikent' })
  for (const lang of SUPPORTED_LANGUAGES) assert.equal(resolveLocalized(out, lang), 'Varlikent')
})

/* ══════════════ Other provider failures ══════════════ */

test('timeout, warning, blank, invalid pair and refusal each leave that target absent', async (t) => {
  const FAILURES = {
    timeout: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') },
    'quota warning': () => ok(QUOTA_WARNING),
    blank: () => ok('   '),
    'invalid language pair': () => ok("INVALID LANGPAIR: 'autodetect|tr'"),
    'distinct-languages refusal': () => ok('PLEASE SELECT TWO DISTINCT LANGUAGES', '403'),
    'http error': async () => ({ ok: false, json: async () => ({}) }),
  }

  for (const [name, respond] of Object.entries(FAILURES)) {
    await t.test(name, async () => {
      const out = await localizeText('Our Mission', null, provider({ respond: { tr: respond } }))
      assert.equal('tr' in out, false, `${name} stored something as Turkish`)
      for (const lang of ['ar', 'de', 'ru', 'ur']) assert.ok(isUsableText(out[lang]), `${name} broke ${lang}`)
    })
  }
})

/* ══════════════ Existing values ══════════════ */

const REAL_TRANSLATIONS = {
  sourceLang: 'en', en: 'Our Mission', tr: 'Misyonumuz', ar: 'مهمتنا', de: 'Unsere Mission', ru: 'Наша миссия', ur: 'ہمارا مشن',
}
const ENGLISH_COPIES = { sourceLang: 'en', en: 'Our Mission', tr: 'Our Mission', ar: 'Our Mission', de: 'Our Mission', ru: 'Our Mission', ur: 'Our Mission' }
const dead = async () => { throw new TypeError('fetch failed') }

test('a failed retranslation still keeps REAL existing translations', async () => {
  const unchanged = await localizeText('Our Mission', REAL_TRANSLATIONS, dead)
  assert.deepEqual(unchanged, REAL_TRANSLATIONS)

  const edited = await localizeText('Our Mission, Retold', REAL_TRANSLATIONS, provider({ respond: { tr: () => ok(QUOTA_WARNING) } }))
  assert.equal(edited.tr, 'Misyonumuz', 'a partial failure keeps the old real Turkish')
  assert.equal(edited.de, '[de] Our Mission, Retold', 'successful targets are updated')
})

test('stored English copies are NOT preserved when retranslation fails', async () => {
  const out = await localizeText('Our Mission', ENGLISH_COPIES, dead)
  assert.deepEqual(out, { sourceLang: 'en', en: 'Our Mission' })
})

test('copies of the PREVIOUS source text are not preserved after the source is edited', async () => {
  const out = await localizeText('Our Mission, Retold', ENGLISH_COPIES, dead)
  assert.deepEqual(out, { sourceLang: 'en', en: 'Our Mission, Retold' })
})

test('stored English copies are replaced by real translations when the provider works', async () => {
  const out = await localizeText('Our Mission', ENGLISH_COPIES, provider())
  assert.deepEqual(out, REAL_TRANSLATIONS)
  assert.deepEqual(copiesIn(out), [])
})

test('an original Turkish source is kept as the Turkish value when the admin rewrites it in English', async () => {
  const turkishOriginal = { sourceLang: 'tr', tr: 'Misyonumuz', en: 'Our Mission' }
  const out = await localizeText('Our Mission Today', turkishOriginal, provider({ respond: { tr: () => ok(QUOTA_WARNING) } }))

  assert.equal(out.sourceLang, 'en')
  assert.equal(out.tr, 'Misyonumuz', 'authentic Turkish is not an echo and survives')
})

/* ══════════════ The About save, as the admin form sends it ══════════════ */

const copies = (text) => ({ sourceLang: 'en', ...Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, text])) })

const LIVE_ABOUT = {
  heroLabel: copies('Our Story'),
  heroHeading: copies('About Varlikent'),
  heroSubtext: copies("Istanbul's premier luxury real estate agency."),
  missionLabel: copies('Our Mission'),
  missionHeading: copies('A refined approach to luxury real estate.'),
  missionParagraph1: copies('We bring together market insight.'),
  missionParagraph2: copies('Founded with a passion for Istanbul.'),
  missionImage: 'https://res.cloudinary.com/demo/image/upload/v1/mission.png',
  teamLabel: copies('Our Team'),
  teamHeading: copies('Meet Our Experts'),
  stats: [{ value: '10+', label: { sourceLang: 'en', en: '' }, order: 0 }],
  team: [{ name: 'Deniz Arda Varlı', role: copies('Owner'), avatar: '', order: 1 }],
  contentBlocks: [],
}

/** What AdminAbout.jsx sends: every localized value unwrapped to its source text. */
const adminFormFrom = (doc) => ({
  ...Object.fromEntries(LOCALIZED_TOP_LEVEL_FIELDS.map((field) => [field, unwrapLocalized(doc[field])])),
  missionImage: doc.missionImage,
  stats: doc.stats.map((stat) => ({ ...stat, label: unwrapLocalized(stat.label) })),
  team: doc.team.map((member) => ({ ...member, role: unwrapLocalized(member.role) })),
  contentBlocks: doc.contentBlocks,
})

test('re-saving the live document with a working provider repairs every field', async () => {
  const out = await localizeAboutPayload(adminFormFrom(LIVE_ABOUT), LIVE_ABOUT, provider())

  for (const field of LOCALIZED_TOP_LEVEL_FIELDS) {
    assert.deepEqual(copiesIn(out[field]), [], `${field} still holds copies`)
    for (const lang of TARGETS_FOR_EN) assert.ok(isUsableText(out[field][lang]), `${field}.${lang} missing`)
  }
  assert.equal(out.missionLabel.tr, 'Misyonumuz')
  assert.equal(out.heroHeading.tr, 'Varlikent Hakkında', 'the brand name is left as the provider wrote it')
  assert.deepEqual(copiesIn(out.team[0].role), [])
})

test('re-saving the live document while the provider echoes or is down leaves no copies anywhere', async () => {
  for (const fetchImpl of [provider({ echo: TARGETS_FOR_EN }), dead]) {
    const out = await localizeAboutPayload(adminFormFrom(LIVE_ABOUT), LIVE_ABOUT, fetchImpl)

    for (const field of LOCALIZED_TOP_LEVEL_FIELDS) {
      assert.deepEqual(copiesIn(out[field]), [], `${field} kept copies`)
      assert.equal(out[field].en, LIVE_ABOUT[field].en, `${field}: the English source was lost`)
    }
    assert.deepEqual(copiesIn(out.team[0].role), [])
  }
})

test('the save leaves machine data alone and invents no stat label', async () => {
  const fake = provider()
  const out = await localizeAboutPayload(adminFormFrom(LIVE_ABOUT), LIVE_ABOUT, fake)

  assert.equal(out.missionImage, LIVE_ABOUT.missionImage)
  assert.equal(out.stats[0].value, '10+')
  assert.deepEqual(out.stats[0].label, { sourceLang: 'en', en: '' }, 'a blank label stays blank')
  assert.equal(out.team[0].name, 'Deniz Arda Varlı')
  assert.equal(fake.calls.some((call) => call.q.trim() === ''), false, 'blank text was sent to the provider')
})

test('a legacy scalar About document still localizes on save', async () => {
  const legacy = { heroLabel: 'Our Story', missionLabel: 'Our Mission', stats: [{ value: '10+', label: 'Years Experience', order: 0 }] }
  const out = await localizeAboutPayload(legacy, legacy, provider())

  assert.equal(out.missionLabel.sourceLang, 'en')
  assert.equal(out.missionLabel.tr, 'Misyonumuz')
  assert.equal(out.stats[0].label.en, 'Years Experience')
  assert.deepEqual(copiesIn(out.heroLabel), [])
})
