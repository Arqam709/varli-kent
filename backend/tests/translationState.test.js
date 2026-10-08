// CMS Phase B — translation state.
//
// utils/translationState.js records, beside a localized value, which source
// text each translation was made from, and derives a language's state from
// that. These are the pure rules; pageContent.routes.test.js covers the same
// behaviour through the API. No network: the provider is a scripted double.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRANSLATION_STATES,
  sourceHash,
  translationStateOf,
  translationStatesOf,
  withTranslationState,
  withoutTranslationState,
} from '../utils/translationState.js'
import { localizeTextWithReport, TRANSLATION_FAILURE_REASONS } from '../utils/autoTranslate.js'
import { SUPPORTED_LANGUAGES, resolveLocalized, isLocalizedObject, unwrapLocalized, localizedSearchText } from '../utils/localizedField.js'

globalThis.fetch = async (url) => {
  throw new Error(`translation-state tests must not touch the network (tried: ${url})`)
}

/* ── provider doubles ─────────────────────────────────────────────────── */

const targetOf = (url) => decodeURIComponent(url).split('autodetect|')[1]
const sourceOf = (url) => new URL(url).searchParams.get('q')
const ok = (body) => ({ ok: true, json: async () => body })
const translates = async (url) => ok({ responseStatus: 200, responseData: { translatedText: `[${targetOf(url)}] ${sourceOf(url)}` } })
const refuses = { ok: false, status: 400, json: async () => ({}) }
const echoes = async (url) => ok({ responseStatus: 200, responseData: { translatedText: sourceOf(url) } })
const quota = ok({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } })
const scripted = (script) => async (url) => {
  const step = script[targetOf(url)]
  if (step === undefined) return translates(url)
  return typeof step === 'function' ? step(url) : step
}

const TARGETS = ['tr', 'ar', 'de', 'ru', 'ur']
const T1 = new Date('2026-10-01T10:00:00.000Z')
const T2 = new Date('2026-10-08T12:30:00.000Z')
const T3 = new Date('2026-10-09T09:15:00.000Z')

// One save, the way the route performs it: translate, then record the state.
const save = async (text, previous, provider, now) => {
  const { value, report } = await localizeTextWithReport(text, previous, provider)
  return { stored: withTranslationState(value, report, previous, now), value, report }
}

/* ══════════════ 1. The source hash ══════════════ */

test('hash: the same text always gives the same full SHA-256', () => {
  const hash = sourceHash('Explore Services')
  assert.equal(hash, sourceHash('Explore Services'))
  assert.match(hash, /^[0-9a-f]{64}$/)
  // A fixed value, so the algorithm cannot change unnoticed.
  assert.equal(sourceHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('hash: any change to the text changes the hash', () => {
  const variants = ['Explore Services', 'Explore services', 'Explore Services.', 'Discover Our Services', 'Explore  Services', '']
  assert.equal(new Set(variants.map(sourceHash)).size, variants.length)
})

test('hash: it is the EXACT stored text — whitespace and newlines count', () => {
  assert.notEqual(sourceHash('We Design, Build'), sourceHash('We Design, Build\n'))
  assert.notEqual(sourceHash('We Design, Build'), sourceHash(' We Design, Build'))
  assert.notEqual(sourceHash('line one\nline two'), sourceHash('line one\r\nline two'))
  // …so it can always be recomputed from what is stored.
  assert.equal(sourceHash('We Design, Build\n'), sourceHash('We Design, Build\n'))
})

test('hash: Turkish, Arabic, Urdu and Cyrillic text hash as UTF-8', () => {
  const texts = ['İstanbul · Mimarlık · İnşaat', 'استكشف الخدمات', 'خدمات دیکھیں', 'Изучить услуги']
  for (const value of texts) assert.match(sourceHash(value), /^[0-9a-f]{64}$/)
  assert.equal(new Set(texts.map(sourceHash)).size, texts.length)
  // Arabic and Urdu share a script, not a hash.
  assert.notEqual(sourceHash('خدمات'), sourceHash('خدمات '))
  // Precomposed and decomposed forms are different stored strings.
  assert.notEqual(sourceHash('ü'), sourceHash('ü'))
})

test('hash: a non-string is the hash of the empty text, never a crash', () => {
  for (const value of [undefined, null, 42, {}, []]) assert.equal(sourceHash(value), sourceHash(''))
})

/* ══════════════ 2. Deriving a state ══════════════ */

const H = sourceHash('Explore Services')
const OLD = sourceHash('An earlier wording')
const tracked = (langs) => ({ sourceLang: 'en', en: 'Explore Services', meta: { sourceHash: H, langs } })

test('state: source', () => {
  assert.equal(translationStateOf(tracked({}), 'en'), 'source')
  assert.equal(translationStateOf({ sourceLang: 'tr', tr: 'Hizmetler' }, 'tr'), 'source')
})

test('state: missing — no usable text is stored', () => {
  const value = { ...tracked({ de: { from: H, by: 'machine', at: T1.toISOString() }, ru: { error: 'timeout', errorAt: T1.toISOString() } }), ar: '   ', ur: 'MYMEMORY WARNING: QUOTA' }
  assert.equal(translationStateOf(value, 'de'), 'missing', 'an entry with no text is still missing')
  assert.equal(translationStateOf(value, 'ru'), 'missing')
  assert.equal(translationStateOf(value, 'ar'), 'missing', 'blank text')
  assert.equal(translationStateOf(value, 'ur'), 'missing', 'provider garbage is not a translation')
  assert.equal(translationStateOf(value, 'tr'), 'missing')
})

test('state: unknown — text exists but nothing records where it came from', () => {
  // The production shape today: no meta at all.
  const legacy = { type: 'text', sourceLang: 'en', en: 'Explore Services', de: 'Leistungen entdecken', verified: false }
  assert.equal(translationStateOf(legacy, 'de'), 'unknown')

  const partial = { ...tracked({
    tr: { error: 'timeout', errorAt: T1.toISOString() },         // a failure, but no provenance
    ar: { from: H },                                            // no author
    de: { from: 'not-a-hash', by: 'machine', at: T1.toISOString() },
    ru: { from: H, by: 'somebody', at: T1.toISOString() },
    ur: 'machine',
  }), tr: 'a', ar: 'b', de: 'c', ru: 'd', ur: 'e' }
  for (const lang of TARGETS) assert.equal(translationStateOf(partial, lang), 'unknown', lang)

  for (const meta of [null, 'x', [], { langs: null }, { langs: [] }, { sourceHash: H }]) {
    assert.equal(translationStateOf({ sourceLang: 'en', en: 'Explore Services', de: 'x', meta }, 'de'), 'unknown')
  }
})

test('state: nothing is inferred from how a legacy value looks', () => {
  // Equal to the source, flagged verified, or simply present: still unknown.
  const legacy = { sourceLang: 'en', en: 'Varlikent', de: 'Varlikent', tr: 'Varlikent', verified: true }
  assert.equal(translationStateOf(legacy, 'de'), 'unknown')
  assert.equal(translationStateOf({ ...legacy, verified: false }, 'tr'), 'unknown')
})

test('state: translated — a machine translation of the current source', () => {
  const value = { ...tracked({ de: { from: H, by: 'machine', at: T1.toISOString() } }), de: 'Leistungen entdecken' }
  assert.equal(translationStateOf(value, 'de'), 'translated')
  // A recorded error beside a current translation does not change what it is.
  const withError = { ...tracked({ de: { from: H, by: 'machine', at: T1.toISOString(), error: 'timeout', errorAt: T2.toISOString() } }), de: 'Leistungen entdecken' }
  assert.equal(translationStateOf(withError, 'de'), 'translated')
})

test('state: manual — reserved for a hand-written translation of the current source', () => {
  const value = { ...tracked({ de: { from: H, by: 'manual', at: T1.toISOString() } }), de: 'Leistungen entdecken' }
  assert.equal(translationStateOf(value, 'de'), 'manual')
})

test('state: stale — a translation of an earlier source text, machine or manual', () => {
  const machine = { ...tracked({ de: { from: OLD, by: 'machine', at: T1.toISOString() } }), de: 'Leistungen entdecken' }
  const manual = { ...tracked({ de: { from: OLD, by: 'manual', at: T1.toISOString() } }), de: 'Leistungen entdecken' }
  assert.equal(translationStateOf(machine, 'de'), 'stale')
  assert.equal(translationStateOf(manual, 'de'), 'stale')
})

test('state: "current" is judged against the stored source text, not a hash that may be out of step', () => {
  // The source was changed some other way (a direct database edit): meta still
  // names the old hash, and the translation was made from it.
  const value = { sourceLang: 'en', en: 'Discover Our Services', de: 'Leistungen entdecken', meta: { sourceHash: H, langs: { de: { from: H, by: 'machine', at: T1.toISOString() } } } }
  assert.equal(translationStateOf(value, 'de'), 'stale', 'it is a translation of text that is no longer the source')
  // Put the old source back and it is current again.
  assert.equal(translationStateOf({ ...value, en: 'Explore Services' }, 'de'), 'translated')
})

test('state: malformed input is never an exception', () => {
  for (const value of [null, undefined, 'text', 42, []]) assert.equal(translationStateOf(value, 'de'), 'missing')
  assert.equal(translationStateOf({ de: 'x' }, 'de'), 'unknown', 'no source language at all')
  assert.equal(translationStateOf({ sourceLang: 'en', de: 'x', meta: { sourceHash: H, langs: { de: { from: H, by: 'machine' } } } }, 'de'), 'unknown', 'provenance with no source text to compare')
  assert.deepEqual(Object.keys(translationStatesOf({})), SUPPORTED_LANGUAGES)
  for (const state of Object.values(translationStatesOf(tracked({})))) assert.ok(TRANSLATION_STATES.includes(state))
})

/* ══════════════ 3. Recording a save ══════════════ */

test('save: every translated language records the current hash, machine, and the time', async () => {
  const { stored, value } = await save('Explore Services', null, translates, T1)

  assert.deepEqual(stored.meta, {
    sourceHash: H,
    langs: Object.fromEntries(TARGETS.map((lang) => [lang, { from: H, by: 'machine', at: '2026-10-01T10:00:00.000Z' }])),
  })
  // The content beside it is exactly the value that was going to be stored.
  assert.deepEqual(withoutTranslationState(stored), value)
  assert.deepEqual(translationStatesOf(stored), { en: 'source', tr: 'translated', ar: 'translated', de: 'translated', ru: 'translated', ur: 'translated' })
  assert.equal('status' in stored.meta.langs.de, false, 'no status is stored')
})

test('save: a tracked translation whose retranslation fails becomes stale, with its provenance intact', async () => {
  const v1 = (await save('Explore Services', null, translates, T1)).stored
  const { stored, report } = await save('Discover Our Services', v1, scripted({ de: refuses }), T2)
  const H2 = sourceHash('Discover Our Services')

  assert.equal(stored.meta.sourceHash, H2)
  assert.equal(stored.de, v1.de, 'the German text is kept exactly')
  assert.deepEqual(stored.meta.langs.de, {
    from: H,                                  // still version 1
    by: 'machine',
    at: '2026-10-01T10:00:00.000Z',           // when it was last really translated
    error: 'provider_error',
    errorAt: '2026-10-08T12:30:00.000Z',
  })
  assert.equal(translationStateOf(stored, 'de'), 'stale')
  assert.deepEqual(stored.meta.langs.tr, { from: H2, by: 'machine', at: '2026-10-08T12:30:00.000Z' })
  // Phase A's report still describes the request: failed, previous value used.
  assert.deepEqual(report.targets.de, { status: 'failed', reason: 'provider_error', using: 'previous' })
})

test('save: a stale translation stays stale across further failures and keeps pointing at its real source', async () => {
  const v1 = (await save('Explore Services', null, translates, T1)).stored
  const v2 = (await save('Discover Our Services', v1, scripted({ de: refuses }), T2)).stored
  const v3 = (await save('Discover Everything We Offer', v2, scripted({ de: quota }), T3)).stored

  assert.equal(v3.de, v1.de)
  assert.deepEqual(v3.meta.langs.de, { from: H, by: 'machine', at: '2026-10-01T10:00:00.000Z', error: 'quota', errorAt: '2026-10-09T09:15:00.000Z' })
  assert.equal(translationStateOf(v3, 'de'), 'stale')
})

test('save: a later success writes a fresh entry — the old error does not survive', async () => {
  const v1 = (await save('Explore Services', null, translates, T1)).stored
  const v2 = (await save('Discover Our Services', v1, scripted({ de: refuses }), T2)).stored
  assert.equal(v2.meta.langs.de.error, 'provider_error')

  const v3 = (await save('Discover Everything We Offer', v2, translates, T3)).stored
  assert.deepEqual(v3.meta.langs.de, { from: sourceHash('Discover Everything We Offer'), by: 'machine', at: '2026-10-09T09:15:00.000Z' })
  assert.equal(translationStateOf(v3, 'de'), 'translated')
})

test('save: a LEGACY translation kept after a failure gets a failure record and no invented provenance', async () => {
  const legacy = { type: 'text', sourceLang: 'en', en: 'Explore Services', de: 'Leistungen entdecken', tr: 'Hizmetleri Keşfedin', verified: false }
  const { stored } = await save('Discover Our Services', legacy, scripted({ de: refuses }), T2)

  assert.equal(stored.de, 'Leistungen entdecken')
  assert.deepEqual(stored.meta.langs.de, { error: 'provider_error', errorAt: '2026-10-08T12:30:00.000Z' })
  assert.equal(translationStateOf(stored, 'de'), 'unknown', 'neither current nor stale: its origin was never recorded')
  for (const invented of ['from', 'by', 'at']) assert.equal(invented in stored.meta.langs.de, false, invented)
  // Turkish translated this time and is tracked from here on.
  assert.equal(translationStateOf(stored, 'tr'), 'translated')
})

test('save: a failure with nothing stored is missing — no empty value is created', async () => {
  const { stored } = await save('Explore Services', null, scripted({ de: refuses, ru: echoes, ur: quota }), T1)

  for (const [lang, reason] of [['de', 'provider_error'], ['ru', 'echo'], ['ur', 'quota']]) {
    assert.equal(lang in stored, false, `${lang} has no value`)
    assert.deepEqual(stored.meta.langs[lang], { error: reason, errorAt: '2026-10-01T10:00:00.000Z' })
    assert.equal(translationStateOf(stored, lang), 'missing')
    assert.ok(TRANSLATION_FAILURE_REASONS.includes(stored.meta.langs[lang].error))
  }
  assert.equal(JSON.stringify(stored).includes('MYMEMORY'), false, 'the provider sentence is never stored')
})

test('save: an echo is never recorded as a translation', async () => {
  const fresh = (await save('Explore Services', null, scripted({ de: echoes }), T1)).stored
  assert.equal(translationStateOf(fresh, 'de'), 'missing')
  assert.equal('from' in fresh.meta.langs.de, false)

  const v1 = (await save('Explore Services', null, translates, T1)).stored
  const v2 = (await save('Discover Our Services', v1, scripted({ de: echoes }), T2)).stored
  assert.equal(v2.de, v1.de, 'the previous real translation is kept')
  assert.equal(v2.meta.langs.de.error, 'echo')
  assert.equal(translationStateOf(v2, 'de'), 'stale')
})

test('save: every language is recorded on its own', async () => {
  const v1 = (await save('Explore Services', null, scripted({ ar: refuses }), T1)).stored
  const v2 = (await save('Discover Our Services', v1, scripted({ de: refuses, ar: refuses, ur: echoes }), T2)).stored

  assert.deepEqual(translationStatesOf(v2), {
    en: 'source',
    tr: 'translated',   // translated again
    ar: 'missing',      // failed twice, never had a value
    de: 'stale',        // had a tracked value, failed this time
    ru: 'translated',
    ur: 'stale',        // echo this time, tracked value kept
  })
  assert.equal(v2.meta.langs.de.from, H)
  assert.equal(v2.meta.langs.ur.from, H)
  assert.equal(v2.meta.langs.tr.from, sourceHash('Discover Our Services'))
})

test('save: when the source language changes, hashes follow the new source and old translations go stale', async () => {
  const english = (await save('Explore Services', null, translates, T1)).stored
  const turkish = (await save('Hizmetleri Keşfedin', english, scripted({ de: refuses }), T2)).stored
  const HT = sourceHash('Hizmetleri Keşfedin')

  assert.equal(turkish.sourceLang, 'tr')
  assert.equal(turkish.meta.sourceHash, HT)
  assert.equal('tr' in turkish.meta.langs, false, 'the source has no translation entry')
  assert.deepEqual(turkish.meta.langs.en, { from: HT, by: 'machine', at: '2026-10-08T12:30:00.000Z' })
  assert.equal(turkish.meta.langs.de.from, H, 'German still names the English text it was made from')
  assert.deepEqual(translationStatesOf(turkish), { en: 'translated', tr: 'source', ar: 'translated', de: 'stale', ru: 'translated', ur: 'translated' })
})

test('save: when the source language changes and the OLD source text is all a language has, it is unknown, not stale', async () => {
  const english = (await save('Explore Services', null, translates, T1)).stored
  // English fails as a target, so the old English SOURCE text is what remains in `en`.
  const turkish = (await save('Hizmetleri Keşfedin', english, scripted({ en: refuses }), T2)).stored

  assert.equal(turkish.en, 'Explore Services')
  assert.deepEqual(turkish.meta.langs.en, { error: 'provider_error', errorAt: '2026-10-08T12:30:00.000Z' })
  assert.equal(translationStateOf(turkish, 'en'), 'unknown')
})

test('save: emptied text records the hash of the empty source and attempts nothing', async () => {
  const v1 = (await save('Explore Services', null, translates, T1)).stored
  const { stored } = await save('', v1, translates, T2)
  assert.deepEqual(stored, { sourceLang: 'en', en: '', meta: { sourceHash: sourceHash(''), langs: {} } })
})

/* ══════════════ 4. Old readers and the public form ══════════════ */

test('compat: every existing reader ignores `meta`', async () => {
  const { stored, value } = await save('Explore Services', null, scripted({ de: refuses }), T1)

  for (const lang of [...SUPPORTED_LANGUAGES, 'xx']) assert.equal(resolveLocalized(stored, lang), resolveLocalized(value, lang), lang)
  assert.equal(isLocalizedObject(stored), true)
  assert.equal(unwrapLocalized(stored), 'Explore Services')
  assert.equal(localizedSearchText(stored), localizedSearchText(value))
  // `meta` is not mistaken for a language.
  assert.equal(resolveLocalized(stored, 'meta'), 'Explore Services')
})

test('compat: withoutTranslationState removes only `meta`, and leaves values that have none alone', async () => {
  const { stored, value } = await save('Explore Services', null, translates, T1)
  assert.deepEqual(withoutTranslationState(stored), value)
  assert.equal('meta' in stored, true, 'the stored value itself is not mutated')

  const legacy = { type: 'text', sourceLang: 'en', en: 'x', verified: false }
  assert.equal(withoutTranslationState(legacy), legacy)
  const image = { type: 'image', url: '/a.png' }
  assert.equal(withoutTranslationState(image), image)
  for (const value of [null, undefined, 'text', 7]) assert.equal(withoutTranslationState(value), value)
})

test('compat: recording state never changes the content it sits beside', async () => {
  const previous = { type: 'text', sourceLang: 'en', en: 'Explore Services', de: 'Leistungen entdecken' }
  const frozen = structuredClone(previous)
  const { value, report } = await localizeTextWithReport('Discover Our Services', previous, scripted({ de: refuses }))
  const before = structuredClone(value)

  const stored = withTranslationState(value, report, previous, T1)

  assert.deepEqual(value, before, 'the value handed in is not mutated')
  assert.deepEqual(previous, frozen, 'nor is the previous record')
  for (const key of Object.keys(value)) assert.equal(stored[key], value[key], key)
  assert.deepEqual(Object.keys(stored).sort(), [...Object.keys(value), 'meta'].sort())
})
