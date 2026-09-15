// Contact interests: the built-in defaults, the pure rules, and the models.
//
// Phase 1B moved the runtime list into MongoDB (models/ContactInterest.js).
// config/contactInterests.js is now the baseline those records are seeded from
// and the snapshot both clients' offline fallbacks are verified against, plus
// the rules everything shares: the id pattern, id derivation and the public
// projection.
//
// Pure: the real schemas are checked with validateSync() (no connection), no
// network, no mocks.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import ContactInterest from '../models/ContactInterest.js'
import ContactSubmission from '../models/ContactSubmission.js'
import LeadRouting from '../models/LeadRouting.js'
import {
  CLIENT_CONTACT_SOURCES,
  CONTACT_INTEREST_ID_PATTERN,
  CONTACT_INTEREST_LANGUAGES,
  CONTACT_INTEREST_LIMITS,
  CONTACT_SOURCES,
  DEFAULT_CONTACT_INTERESTS,
  DEFAULT_CONTACT_INTEREST_VALUES,
  cleanContactInterestLabels,
  deriveContactInterestId,
  getDefaultPublicContactInterests,
  normalizeContactInterestValue,
  selectPublicContactInterests,
} from '../config/contactInterests.js'

/**
 * id → canonical value, pinned. These values are stored in existing
 * submissions and LeadRouting rows and submitted by installed app builds.
 */
const PINNED = {
  buying: 'Buying',
  renting: 'Renting',
  selling: 'Selling',
  renovation: 'Renovation',
  interior_design: 'Interior Design',
  architecture: 'Architecture',
  construction: 'Construction',
  general: 'General',
  troubleshoot: 'Troubleshoot',
}

/* ══════════════ The defaults: identity ══════════════ */

test('every default has a unique id matching the id pattern', () => {
  const ids = DEFAULT_CONTACT_INTERESTS.map((interest) => interest.id)
  assert.equal(new Set(ids).size, ids.length, 'two defaults share an id')
  for (const id of ids) assert.match(id, CONTACT_INTEREST_ID_PATTERN)
})

test('every default has a unique canonical value', () => {
  assert.equal(new Set(DEFAULT_CONTACT_INTEREST_VALUES).size, DEFAULT_CONTACT_INTEREST_VALUES.length)
})

test('default ids map to the values existing data and old builds rely on', () => {
  const actual = Object.fromEntries(DEFAULT_CONTACT_INTERESTS.map((interest) => [interest.id, interest.value]))
  assert.deepEqual(actual, PINNED)
})

test('DEFAULT_CONTACT_INTEREST_VALUES is derived from the defaults, in order', () => {
  assert.deepEqual([...DEFAULT_CONTACT_INTEREST_VALUES], DEFAULT_CONTACT_INTERESTS.map((interest) => interest.value))
})

test('every built-in id is exactly what the server would derive from its value', () => {
  // So an admin-created interest follows the same id convention as the nine
  // that shipped with the product.
  for (const interest of DEFAULT_CONTACT_INTERESTS) {
    assert.equal(deriveContactInterestId(interest.value), interest.id)
  }
})

/* ══════════════ The defaults: labels ══════════════ */

test('every default carries a non-empty label in all six languages', () => {
  assert.deepEqual([...CONTACT_INTEREST_LANGUAGES], ['en', 'tr', 'ar', 'de', 'ru', 'ur'])

  for (const interest of DEFAULT_CONTACT_INTERESTS) {
    for (const lang of CONTACT_INTEREST_LANGUAGES) {
      const label = interest.labels[lang]
      assert.ok(typeof label === 'string' && label.trim().length > 0, `${interest.id} has no ${lang} label`)
    }
    assert.deepEqual(Object.keys(interest.labels).sort(), [...CONTACT_INTEREST_LANGUAGES].sort())
  }
})

test('the Russian Troubleshoot label is plain Cyrillic', () => {
  const troubleshoot = DEFAULT_CONTACT_INTERESTS.find((interest) => interest.id === 'troubleshoot')
  assert.equal(troubleshoot.labels.ru, 'Решение проблемы')
  assert.equal(/[a-z]/i.test(troubleshoot.labels.ru), false, 'a Latin letter slipped into a Cyrillic label')
})

test('no two defaults share a label in the same language', () => {
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    const labels = DEFAULT_CONTACT_INTERESTS.map((interest) => interest.labels[lang])
    assert.equal(new Set(labels).size, labels.length, `${lang}: two options are indistinguishable`)
  }
})

test('no translated label is ever used as a canonical value', () => {
  const translated = new Set()
  for (const interest of DEFAULT_CONTACT_INTERESTS) {
    for (const lang of CONTACT_INTEREST_LANGUAGES.filter((l) => l !== 'en')) translated.add(interest.labels[lang])
  }
  for (const value of DEFAULT_CONTACT_INTEREST_VALUES) {
    assert.equal(translated.has(value), false, `'${value}' collides with a translated label`)
  }
})

test('the defaults are frozen', () => {
  assert.throws(() => { DEFAULT_CONTACT_INTERESTS.push({}) })
  assert.throws(() => { DEFAULT_CONTACT_INTERESTS[0].value = 'Changed' })
  assert.throws(() => { DEFAULT_CONTACT_INTERESTS[0].labels.en = 'Changed' })
})

/* ══════════════ The public projection ══════════════ */

test('the default public list is sorted by order and deterministic', () => {
  const orders = getDefaultPublicContactInterests().map((interest) => interest.order)
  assert.equal(new Set(orders).size, orders.length, 'two defaults share an order')
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
  assert.deepEqual(getDefaultPublicContactInterests(), getDefaultPublicContactInterests())
})

test('ties in order are broken by id in plain code-unit order, never by locale or position', () => {
  const tied = [
    { id: 'ab', value: 'AB', labels: { en: 'AB' }, order: 1, enabled: true },
    { id: 'a_b', value: 'A_B', labels: { en: 'A_B' }, order: 1, enabled: true },
    { id: 'a1', value: 'A1', labels: { en: 'A1' }, order: 1, enabled: true },
  ]
  assert.deepEqual(selectPublicContactInterests(tied).map((i) => i.id), ['a1', 'a_b', 'ab'])
  assert.deepEqual(selectPublicContactInterests([...tied].reverse()).map((i) => i.id), ['a1', 'a_b', 'ab'])
})

test('database documents are reduced to exactly id, value, labels and order', () => {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    __v: 3,
    id: 'investment_consultation',
    value: 'Investment Consultation',
    labels: { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' },
    order: 10,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const [published] = selectPublicContactInterests([doc])
  assert.deepEqual(Object.keys(published).sort(), ['id', 'labels', 'order', 'value'])
  assert.deepEqual(published.labels, { en: 'Investment Consultation', tr: 'Yatırım Danışmanlığı' })
})

test('only explicitly enabled entries are published', () => {
  const entries = [
    { id: 'kept', value: 'Kept', labels: { en: 'Kept' }, order: 1, enabled: true },
    { id: 'retired', value: 'Retired', labels: { en: 'Retired' }, order: 2, enabled: false },
  ]
  assert.deepEqual(selectPublicContactInterests(entries).map((i) => i.id), ['kept'])
})

test('labels are cleaned: blank and unsupported languages are dropped', () => {
  assert.deepEqual(
    cleanContactInterestLabels({ en: 'Kept', tr: '   ', fr: 'Non', de: 7, ur: 'رکھا' }),
    { en: 'Kept', ur: 'رکھا' }
  )
  assert.deepEqual(cleanContactInterestLabels(null), {})
})

test('the projection returns copies, never the frozen defaults', () => {
  const first = getDefaultPublicContactInterests()
  first[0].labels.en = 'Mutated by a caller'
  first.pop()

  const second = getDefaultPublicContactInterests()
  assert.notEqual(second[0].labels.en, 'Mutated by a caller')
  assert.equal(second.length, DEFAULT_CONTACT_INTERESTS.length)
})

test('Troubleshoot and Construction are both public defaults', () => {
  const ids = getDefaultPublicContactInterests().map((interest) => interest.id)
  assert.ok(ids.includes('troubleshoot'))
  assert.ok(ids.includes('construction'))
})

/* ══════════════ Deriving ids and values ══════════════ */

test('a stable id is derived from the English label', () => {
  const cases = [
    ['Investment Consultation', 'investment_consultation'],
    ['  Interior   Design ', 'interior_design'],
    ['Buying & Selling!', 'buying_selling'],
    ['İç Mimarlık', 'ic_mimarlik'],
    ['Çözüm Ortaklığı', 'cozum_ortakligi'],
    ['Café Fit-out', 'cafe_fit_out'],
    ['Phase 2 Handover', 'phase_2_handover'],
  ]
  for (const [label, id] of cases) {
    assert.equal(deriveContactInterestId(label), id, label)
    assert.match(id, CONTACT_INTEREST_ID_PATTERN)
  }
})

test('no id is derived when a valid one cannot be produced', () => {
  for (const label of ['3D Design', 'تصميم', '', '   ', '___', '!!!', null, undefined, 42, {}]) {
    assert.equal(deriveContactInterestId(label), '', `${JSON.stringify(label)} produced an id`)
  }
})

test('a very long label yields an id within the limit and with no trailing underscore', () => {
  const id = deriveContactInterestId(`${'a'.repeat(CONTACT_INTEREST_LIMITS.id - 1)} b`)
  assert.ok(id.length <= CONTACT_INTEREST_LIMITS.id)
  assert.match(id, CONTACT_INTEREST_ID_PATTERN)
  assert.equal(id.endsWith('_'), false)
})

test('the canonical value is the trimmed English label with whitespace collapsed', () => {
  assert.equal(normalizeContactInterestValue('  Investment   Consultation '), 'Investment Consultation')
  assert.equal(normalizeContactInterestValue(undefined), '')
})

/* ══════════════ The ContactInterest model ══════════════ */

const interestDoc = (overrides = {}) => new ContactInterest({
  id: 'investment_consultation',
  value: 'Investment Consultation',
  labels: { en: 'Investment Consultation' },
  order: 10,
  ...overrides,
})

test('a well-formed interest validates, English-only labels included', () => {
  const doc = interestDoc()
  assert.equal(doc.validateSync(), undefined)
  assert.equal(doc.enabled, true, 'enabled defaults to true')
})

test('every built-in default is a valid ContactInterest document', () => {
  for (const interest of DEFAULT_CONTACT_INTERESTS) {
    assert.equal(new ContactInterest({ ...interest, labels: { ...interest.labels } }).validateSync(), undefined, interest.id)
  }
})

test('the id must match the Phase 1A id rule', () => {
  for (const id of ['Investment', 'investment-consultation', '1investment', '_investment', 'investment consultation', '']) {
    const error = interestDoc({ id }).validateSync()
    assert.ok(error?.errors?.id, `id '${id}' was accepted`)
  }
})

test('an English label is required; the other languages are optional', () => {
  for (const labels of [undefined, {}, { en: '' }, { en: '   ' }, { tr: 'Yatırım' }]) {
    const error = interestDoc({ labels }).validateSync()
    assert.ok(error?.errors?.['labels.en'] || error?.errors?.labels, `labels ${JSON.stringify(labels)} were accepted`)
  }
  assert.equal(interestDoc({ labels: { en: 'Only English' } }).validateSync(), undefined)
})

test('labels, value and id respect their length limits', () => {
  const long = 'x'.repeat(CONTACT_INTEREST_LIMITS.label + 1)
  assert.ok(interestDoc({ labels: { en: long } }).validateSync()?.errors?.['labels.en'])
  assert.ok(interestDoc({ labels: { en: 'ok', tr: long } }).validateSync()?.errors?.['labels.tr'])
  assert.ok(interestDoc({ value: long }).validateSync()?.errors?.value)
  assert.ok(interestDoc({ id: 'a'.repeat(CONTACT_INTEREST_LIMITS.id + 1) }).validateSync()?.errors?.id)
})

test('order must be a whole number within range', () => {
  for (const order of [-1, 1.5, CONTACT_INTEREST_LIMITS.order + 1, undefined]) {
    assert.ok(interestDoc({ order }).validateSync()?.errors?.order, `order ${order} was accepted`)
  }
  assert.equal(interestDoc({ order: 0 }).validateSync(), undefined)
})

test('id and value are backed by unique indexes', () => {
  const indexes = ContactInterest.schema.indexes()
  for (const field of ['id', 'value']) {
    assert.ok(
      indexes.some(([keys, options]) => Object.keys(keys).length === 1 && keys[field] === 1 && options?.unique === true),
      `no unique index on ${field}`
    )
  }
})

test('id and value cannot be changed on an existing document', () => {
  assert.equal(ContactInterest.schema.path('id').$immutable, true)
  assert.equal(ContactInterest.schema.path('value').$immutable, true)

  const existing = ContactInterest.hydrate({
    _id: new mongoose.Types.ObjectId(),
    id: 'interior_design',
    value: 'Interior Design',
    labels: { en: 'Interior Design' },
    order: 5,
    enabled: true,
  })

  existing.id = 'renamed'
  existing.value = 'Renamed'
  existing.labels.en = 'Interiors'

  assert.equal(existing.id, 'interior_design')
  assert.equal(existing.value, 'Interior Design')
  assert.equal(existing.labels.en, 'Interiors', 'labels stay editable')
})

test('`id` is the stable id, not Mongoose’s ObjectId virtual', () => {
  const doc = interestDoc()
  assert.equal(doc.id, 'investment_consultation')
  assert.equal(doc.toObject().id, 'investment_consultation')
})

/* ══════════════ ContactSubmission and LeadRouting ══════════════ */

test('ContactSubmission no longer fixes interestType to a code list', () => {
  // Registration is enforced by POST /api/contact against the collection; the
  // schema must not reject an interest an admin created after deploy.
  assert.deepEqual(ContactSubmission.schema.path('interestType').enumValues ?? [], [])

  const dynamic = new ContactSubmission({
    name: 'Ada', email: 'ada@example.com', phone: '+90 532 000 00 00',
    interestType: 'Investment Consultation', message: 'Hi',
  })
  assert.equal(dynamic.validateSync(), undefined)

  const missing = new ContactSubmission({ name: 'Ada', email: 'ada@example.com', phone: '1', message: 'Hi' })
  assert.ok(missing.validateSync()?.errors?.interestType, 'interestType is still required')
})

test('existing submissions with built-in values remain valid', () => {
  for (const interestType of DEFAULT_CONTACT_INTEREST_VALUES) {
    const doc = new ContactSubmission({
      name: 'Ada', email: 'ada@example.com', phone: '+90 532 000 00 00', interestType, message: 'Hi',
    })
    assert.equal(doc.validateSync(), undefined, `${interestType} is no longer storable`)
  }
})

test('LeadRouting can hold a row for an admin-created interest', () => {
  assert.deepEqual(LeadRouting.schema.path('interestType').enumValues ?? [], [])

  const row = new LeadRouting({
    interestType: 'Investment Consultation',
    recipients: [{ email: 'invest@example.test', label: 'Investments' }],
  })
  assert.equal(row.validateSync(), undefined)
  assert.ok(new LeadRouting({ recipients: [] }).validateSync()?.errors?.interestType, 'interestType is still required')
  assert.ok(new LeadRouting({ interestType: 'General', recipients: [{ label: 'No address' }] }).validateSync(),
    'a recipient still requires an email address')
})

/* ══════════════ Submission source ══════════════ */

test('the source enum keeps website, ai_assistant and mobile', () => {
  assert.deepEqual(ContactSubmission.schema.path('source').enumValues, [...CONTACT_SOURCES])
  assert.ok(CONTACT_SOURCES.includes('website'))
  assert.ok(CONTACT_SOURCES.includes('ai_assistant'))
  assert.ok(CONTACT_SOURCES.includes('mobile'))
})

test('a submission with no source still defaults to website', () => {
  const doc = new ContactSubmission({
    name: 'Ada', email: 'ada@example.com', phone: '+90 532 000 00 00', interestType: 'General', message: 'Hi',
  })
  assert.equal(doc.source, 'website')
  assert.equal(doc.validateSync(), undefined)
})

test('public clients may declare website or mobile, never ai_assistant', () => {
  assert.deepEqual([...CLIENT_CONTACT_SOURCES].sort(), ['mobile', 'website'])
  for (const source of CLIENT_CONTACT_SOURCES) assert.ok(CONTACT_SOURCES.includes(source))
})
