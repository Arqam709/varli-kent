// Contact interests — the website half.
//
// ── Why this file exists ────────────────────────────────────────────────
// The website Contact form used to render <option value={INTEREST_TYPES[i]}>
// {interests[i]}</option>: one value array and six label arrays paired BY
// INDEX, and a hand-maintained subset that differed from the mobile app's.
//
// Phase 1A replaced that with GET /api/contact/interests plus a bundled
// fallback of the same shape. Phase 1B made the served list admin-managed
// (MongoDB), so the form must now cope with interests this build has never
// seen. These tests pin both:
//
//   - the fallback is a verified copy of the backend's BUILT-IN defaults only
//   - options are matched by id/value, never by position
//   - an admin-created interest renders, in the visitor's language, in server
//     order, and submits its canonical value — with no website change
//   - a disabled interest is not offered
//   - an unreachable endpoint leaves a working form
//
// Cross-package on purpose: the backend defaults are imported directly.
// Run with plain `node --test` from frontend/. The components themselves are
// exercised in a real browser by tests/browser/contactInterests.test.js.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CONTACT_INTEREST_LANGUAGES,
  FALLBACK_CONTACT_INTERESTS,
  contactInterestLabel,
  findContactInterest,
  normalizeContactInterests,
} from '../src/lib/contactInterests.js'
import {
  DEFAULT_CONTACT_INTEREST_VALUES,
  getDefaultPublicContactInterests,
} from '../../backend/config/contactInterests.js'

const here = dirname(fileURLToPath(import.meta.url))

const readFrontend = (...p) => readFile(join(here, '..', ...p), 'utf8')

const loadTranslations = async () => {
  const raw = await readFrontend('src', 'locales', 'translations.js')
  const cjs = raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = ')
  const mod = { exports: {} }
  new Function('module', 'exports', cjs)(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

/** Deep copy through JSON, so frozen objects compare as plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value))

/** What the API serves after an admin adds one interest and disables Construction. */
const servedAfterAdminEdits = () => [
  ...getDefaultPublicContactInterests().filter((interest) => interest.id !== 'construction'),
  {
    id: 'investment_consultation',
    value: 'Investment Consultation',
    labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' },
    order: 0,
  },
]

/* ══════════════ THE FALLBACK IS THE BUILT-IN BASELINE ══════════════ */

test('the bundled fallback is exactly the backend’s built-in defaults', () => {
  assert.deepEqual(plain(FALLBACK_CONTACT_INTERESTS), getDefaultPublicContactInterests(),
    'the website fallback has drifted from backend/config/contactInterests.js — ' +
    'update src/lib/contactInterests.js to match')
})

test('the fallback holds only the nine built-ins — admin-created interests come from the API', () => {
  assert.equal(FALLBACK_CONTACT_INTERESTS.length, 9)
  assert.equal(findContactInterest(FALLBACK_CONTACT_INTERESTS, 'investment_consultation'), undefined)
})

test('the fallback offers Troubleshoot and Construction', () => {
  const byId = Object.fromEntries(FALLBACK_CONTACT_INTERESTS.map((i) => [i.id, i.value]))
  assert.equal(byId.troubleshoot, 'Troubleshoot')
  assert.equal(byId.construction, 'Construction')
})

test('every fallback entry carries a label in all six languages', () => {
  for (const interest of FALLBACK_CONTACT_INTERESTS) {
    for (const lang of CONTACT_INTEREST_LANGUAGES) {
      assert.ok(typeof interest.labels[lang] === 'string' && interest.labels[lang].trim(),
        `${interest.id} has no ${lang} label`)
    }
  }
})

test('every value the offline form can offer is a built-in value the backend always accepts', () => {
  for (const { value } of FALLBACK_CONTACT_INTERESTS) {
    assert.ok(DEFAULT_CONTACT_INTEREST_VALUES.includes(value),
      `the form would offer '${value}', which is not guaranteed to be registered`)
  }
})

/* ══════════════ MATCHED BY ID, NEVER BY POSITION ══════════════ */

test('a reordered payload keeps every label attached to its own entry', () => {
  const served = getDefaultPublicContactInterests()
  const normalized = normalizeContactInterests({ success: true, interests: [...served].reverse() })

  assert.deepEqual(normalized.map((i) => i.id), served.map((i) => i.id), 'entries are not re-sorted by order')
  for (const interest of normalized) {
    const original = served.find((s) => s.id === interest.id)
    assert.deepEqual(interest.labels, original.labels, `${interest.id} picked up another entry's labels`)
    assert.equal(interest.value, original.value)
  }
})

test('the response body and a bare array are both accepted', () => {
  const served = getDefaultPublicContactInterests()
  assert.deepEqual(normalizeContactInterests({ success: true, interests: served }), served)
  assert.deepEqual(normalizeContactInterests(served), served)
})

test('malformed entries are ignored and unknown fields are not copied', () => {
  const good = getDefaultPublicContactInterests()[0]

  const result = normalizeContactInterests({
    interests: [
      null,
      'Buying',
      42,
      { value: 'No Id', labels: { en: 'No id' }, order: 1 },
      { id: 'Interior Design', value: 'Spaced Id', labels: { en: 'x' }, order: 1 },
      { id: 'no_value', labels: { en: 'No value' }, order: 1 },
      { id: 'blank_value', value: '   ', labels: { en: 'Blank' }, order: 1 },
      { id: 'no_english', value: 'No English', labels: { tr: 'Türkçe' }, order: 1 },
      { id: 'retired', value: 'Retired', labels: { en: 'Retired' }, order: 1, enabled: false },
      { ...good, recipients: [{ email: 'leak@example.test' }], futureField: true },
      { ...good, value: 'Duplicate id' },
      { id: 'duplicate_value', value: good.value, labels: { en: 'Dup' }, order: 2 },
    ],
  })

  assert.deepEqual(result.map((i) => i.id), [good.id])
  assert.deepEqual(Object.keys(result[0]).sort(), ['id', 'labels', 'order', 'value'],
    'an unknown server field was copied into client state')
})

test('garbage payloads normalize to nothing rather than throwing', () => {
  for (const payload of [undefined, null, '', 'oops', 7, {}, { interests: 'nope' }, { interests: null }]) {
    assert.deepEqual(normalizeContactInterests(payload), [])
  }
})

/* ══════════════ ADMIN-MANAGED INTERESTS (Phase 1B) ══════════════ */

test('an admin-created interest from the API is offered with no website change', () => {
  const list = normalizeContactInterests({ success: true, interests: servedAfterAdminEdits() })
  const investment = findContactInterest(list, 'investment_consultation')

  assert.ok(investment, 'a well-formed unknown id was dropped')
  assert.equal(investment.value, 'Investment Consultation')
})

test('an admin-created interest shows its translation, and English where it has none', () => {
  const investment = findContactInterest(normalizeContactInterests(servedAfterAdminEdits()), 'investment_consultation')

  assert.equal(contactInterestLabel(investment, 'tr'), 'Yatırım Danışmanlığı')
  assert.equal(contactInterestLabel(investment, 'ar'), 'Investment Consultation')
  assert.equal(contactInterestLabel(investment, 'ur'), 'Investment Consultation')
})

test('whatever language is shown, the canonical value is what the option submits', () => {
  const investment = findContactInterest(normalizeContactInterests(servedAfterAdminEdits()), 'investment_consultation')
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    assert.notEqual(investment.value, contactInterestLabel(investment, 'tr'))
    assert.equal(investment.value, 'Investment Consultation', `${lang} changed the submitted value`)
  }
})

test('the server’s order is respected, so an interest moved to the top renders first', () => {
  const list = normalizeContactInterests(servedAfterAdminEdits())
  assert.equal(list[0].id, 'investment_consultation')
  assert.deepEqual(list.slice(1).map((i) => i.id), getDefaultPublicContactInterests()
    .filter((i) => i.id !== 'construction').map((i) => i.id))
})

test('a disabled interest is not offered — whether omitted by the server or flagged', () => {
  const omitted = normalizeContactInterests(servedAfterAdminEdits())
  assert.equal(findContactInterest(omitted, 'construction'), undefined)

  const flagged = normalizeContactInterests([
    ...getDefaultPublicContactInterests(),
    { id: 'land_acquisition', value: 'Land Acquisition', labels: { en: 'Land Acquisition' }, order: 12, enabled: false },
  ])
  assert.equal(findContactInterest(flagged, 'land_acquisition'), undefined)
})

/* ══════════════ LABEL FOLLOWS LANGUAGE, VALUE NEVER DOES ══════════════ */

test('the current language label is shown, with English as the fallback', () => {
  const buying = findContactInterest(FALLBACK_CONTACT_INTERESTS, 'buying')

  assert.equal(contactInterestLabel(buying, 'tr'), 'Satın Alma')
  assert.equal(contactInterestLabel(buying, 'ar'), 'الشراء')
  assert.equal(contactInterestLabel(buying, 'xx'), 'Buying', 'unknown languages fall back to English')
  assert.equal(contactInterestLabel({ value: 'Only Value', labels: {} }, 'tr'), 'Only Value')
})

test('entries can be found by stable id or by canonical value', () => {
  assert.equal(findContactInterest(FALLBACK_CONTACT_INTERESTS, 'interior_design')?.value, 'Interior Design')
  assert.equal(findContactInterest(FALLBACK_CONTACT_INTERESTS, 'Interior Design')?.id, 'interior_design')
  assert.equal(findContactInterest(FALLBACK_CONTACT_INTERESTS, 'gardening'), undefined)
  assert.equal(findContactInterest(FALLBACK_CONTACT_INTERESTS, undefined), undefined)
})

/* ══════════════ THE FORM ══════════════ */

test('ContactPage renders from the served list and submits the canonical value', async () => {
  const src = await readFrontend('src', 'pages', 'ContactPage.jsx')

  assert.ok(src.includes('useContactInterests()'), 'ContactPage does not read the served list')
  assert.ok(/<option key=\{interest\.id\} value=\{interest\.value\}>\{contactInterestLabel\(interest, language\)\}<\/option>/.test(src),
    'the option must submit interest.value and display the localized label')
  assert.equal(src.includes('INTEREST_TYPES'), false, 'a hand-written interest list is back')
  assert.equal(/interests\?\.\[/.test(src), false, 'an index-coupled label lookup is back')
})

test('ContactPage never submits an interest the current list does not offer', async () => {
  // e.g. the default 'Buying' after an admin disabled Buying.
  const src = await readFrontend('src', 'pages', 'ContactPage.jsx')
  assert.ok(src.includes('interests.some((interest) => interest.value === form.interestType)'))
})

test('an unreachable endpoint leaves the bundled list in place', async () => {
  const src = await readFrontend('src', 'lib', 'useContactInterests.js')

  assert.ok(src.includes('useState(FALLBACK_CONTACT_INTERESTS)'),
    'the form must render the fallback before the request returns')
  assert.ok(/\.catch\(/.test(src), 'a failed request must be caught, not thrown into the page')
  assert.ok(src.includes('next.length > 0'),
    'an empty or malformed response must not replace a working list')
})

test('no language still carries a positional interest label array', async () => {
  const t = await loadTranslations()
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    assert.equal(t[lang]?.contactPage?.interests, undefined,
      `${lang}: contactPage.interests is back — labels belong to the interest entries`)
  }
})

/* ══════════════ ADMIN LEAD ROUTING ══════════════ */

test('lead routing rows come from the server; the fallback only fills the first paint', async () => {
  const src = await readFrontend('src', 'pages', 'AdminLeadRouting.jsx')

  assert.ok(src.includes("api.get('/lead-routing')"))
  assert.ok(src.includes('setRouting(r.data.routing)'), 'server rows no longer replace the placeholders')
  assert.ok(src.includes('FALLBACK_CONTACT_INTERESTS.map((interest) => interest.value)'))
  assert.equal(/const ALL_TYPES = \[/.test(src), false, 'a hand-written ALL_TYPES list is back')
})

test('every built-in value has its own icon, and any other interest gets the default icon', async () => {
  const src = await readFrontend('src', 'pages', 'AdminLeadRouting.jsx')
  const block = src.slice(src.indexOf('const TYPE_ICONS'), src.indexOf('const DEFAULT_TYPE_ICON'))

  for (const value of DEFAULT_CONTACT_INTEREST_VALUES) {
    const key = /\s/.test(value) ? `'${value}':` : `${value}:`
    assert.ok(block.includes(key), `TYPE_ICONS has no entry for '${value}'`)
  }
  assert.ok(src.includes('TYPE_ICONS[interestType] ?? DEFAULT_TYPE_ICON'),
    'an admin-created interest would render without an icon')
})

test('disabled interests stay listed in lead routing, marked as disabled', async () => {
  const src = await readFrontend('src', 'pages', 'AdminLeadRouting.jsx')
  assert.ok(src.includes('enabled === false'))
  assert.equal(/routing\.filter\([^)]*enabled/.test(src), false, 'disabled rows are being hidden')
})

test('saving lead routing sends only interestType and recipients', async () => {
  const src = await readFrontend('src', 'pages', 'AdminLeadRouting.jsx')
  assert.ok(src.includes('routing.map(({ interestType, recipients }) => ({ interestType, recipients }))'))
})

/* ══════════════ THE BUSINESS DISTINCTION ══════════════ */

test('Construction and Troubleshoot stay separate built-in categories', () => {
  assert.ok(DEFAULT_CONTACT_INTEREST_VALUES.includes('Construction'))
  assert.ok(DEFAULT_CONTACT_INTEREST_VALUES.includes('Troubleshoot'))
  assert.equal(new Set(DEFAULT_CONTACT_INTEREST_VALUES).size, DEFAULT_CONTACT_INTEREST_VALUES.length)
})
