// Localization 4B.1 — legacy echoed CMS translations.
//
// Pure rules plus the run loop against an in-memory collection that applies
// MongoDB's own update semantics for what this code uses (filter equality on
// dotted paths, $unset). No database is touched.

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { planEchoCleanup, runEchoCleanup, TARGET_LANGUAGES } from '../services/pageContentEchoCleanup.js'

const DEFAULTS = {
  heroHeading1: 'We Design, Build',
  heroLabel: 'Istanbul — Architecture · Construction · Real Estate',
  ctaHeading: 'Ready to Start Your Project?',
  aboutLabel: 'Who We Are',
  contactLabel: 'Contact Us',
}
const TEXT_KEYS = new Set([...Object.keys(DEFAULTS), 'noDefaultKey'])
const fieldTypeOf = (key) => (key === 'heroImage' ? 'image' : TEXT_KEYS.has(key) ? 'text' : null)

const echoed = (en, extra = {}) => ({ type: 'text', sourceLang: 'en', en, tr: en, ar: en, de: en, ru: en, ur: en, verified: false, ...extra })

const legacyRecord = () => ({
  _id: 'home-id',
  pageKey: 'home',
  fields: {
    // Untouched default, echoed everywhere — note the trailing newline the
    // real record carries.
    heroHeading1: echoed('We Design, Build\n'),
    // Admin-edited: English differs from the default.
    heroLabel: echoed('Istanbul · Architecture · Construction · Real Estate'),
    // Untouched default with a REAL Turkish translation and an echoed German.
    contactLabel: { type: 'text', sourceLang: 'en', en: 'Contact Us', tr: 'Bize Ulaşın', de: 'Contact Us' },
    // Untouched default whose Arabic slot is English-looking but NOT the echo.
    ctaHeading: echoed('Ready to Start Your Project?', { ar: 'Ready to start your project!' }),
    // Untouched default with only some echoes present.
    aboutLabel: { type: 'text', sourceLang: 'en', en: 'Who We Are', ru: 'Who We Are' },
    // Not in the contract, echoed — must be left alone.
    legacyKey: echoed('Old text'),
    // Registered but no registry default — must be left alone.
    noDefaultKey: echoed('Something'),
    heroImage: { type: 'image', url: 'https://example.test/hero.jpg' },
  },
})

// ── An in-memory collection with MongoDB semantics for findOne/updateOne ──
const createCollection = (doc) => {
  let stored = structuredClone(doc)
  const calls = { updateOne: 0 }
  const getPath = (obj, path) => path.split('.').reduce((n, k) => (n == null ? n : n[k]), obj)
  return {
    calls,
    current: () => stored,
    setCurrent: (d) => { stored = structuredClone(d) },
    async findOne(filter) {
      const ok = Object.entries(filter).every(([k, v]) => getPath(stored, k) === v)
      return ok ? structuredClone(stored) : null
    },
    async updateOne(filter, update) {
      calls.updateOne += 1
      const ok = Object.entries(filter).every(([k, v]) => getPath(stored, k) === v)
      if (!ok) return { matchedCount: 0, modifiedCount: 0 }
      let modified = 0
      for (const path of Object.keys(update.$unset || {})) {
        const parts = path.split('.')
        const last = parts.pop()
        const parent = getPath(stored, parts.join('.'))
        if (parent && last in parent) { delete parent[last]; modified = 1 }
      }
      return { matchedCount: 1, modifiedCount: modified }
    },
  }
}

let collection
let backups
const okBackup = async (record) => { backups.push(structuredClone(record)); return `/tmp/backup-${backups.length}.json` }

beforeEach(() => {
  collection = createCollection(legacyRecord())
  backups = []
})

const run = (overrides = {}) => runEchoCleanup({ collection, pageKey: 'home', fieldTypeOf, defaults: DEFAULTS, backup: okBackup, ...overrides })

// ── Detection, per language ────────────────────────────────────────────────
for (const lang of TARGET_LANGUAGES) {
  test(`a copied-English ${lang} slot on an untouched default field is detected`, () => {
    const plan = planEchoCleanup(legacyRecord(), fieldTypeOf, DEFAULTS)
    assert.ok(plan.removals.some((r) => r.key === 'heroHeading1' && r.lang === lang), `heroHeading1.${lang}`)
  })
}

test('each language is judged independently', () => {
  const plan = planEchoCleanup(legacyRecord(), fieldTypeOf, DEFAULTS)
  const slots = (key) => plan.removals.filter((r) => r.key === key).map((r) => r.lang).sort()
  assert.deepEqual(slots('heroHeading1'), ['ar', 'de', 'ru', 'tr', 'ur'])
  assert.deepEqual(slots('contactLabel'), ['de'], 'only the echoed German, not the real Turkish')
  assert.deepEqual(slots('ctaHeading'), ['de', 'ru', 'tr', 'ur'], 'the differing Arabic is not an echo')
  assert.deepEqual(slots('aboutLabel'), ['ru'], 'absent slots are simply absent')
  assert.deepEqual(plan.countsByLanguage, { tr: 2, ar: 1, de: 3, ru: 3, ur: 2 })
})

// ── What is preserved ──────────────────────────────────────────────────────
test('a genuine translation is preserved', () => {
  const plan = planEchoCleanup(legacyRecord(), fieldTypeOf, DEFAULTS)
  assert.ok(!plan.removals.some((r) => r.key === 'contactLabel' && r.lang === 'tr'))
})

test('ambiguous English-looking text that is not the exact echo is preserved and reported', () => {
  const plan = planEchoCleanup(legacyRecord(), fieldTypeOf, DEFAULTS)
  assert.ok(!plan.removals.some((r) => r.key === 'ctaHeading' && r.lang === 'ar'))
  assert.ok(plan.keptSlots.some((s) => s.key === 'ctaHeading' && s.lang === 'ar'))
})

test('an admin-edited field is preserved in every language and reported with all six values', () => {
  const plan = planEchoCleanup(legacyRecord(), fieldTypeOf, DEFAULTS)
  assert.ok(!plan.removals.some((r) => r.key === 'heroLabel'))
  const edited = plan.adminEdited.find((f) => f.key === 'heroLabel')
  assert.ok(edited)
  assert.deepEqual(Object.keys(edited.values), ['en', 'tr', 'ar', 'de', 'ru', 'ur'])
  assert.equal(edited.values.de, 'Istanbul · Architecture · Construction · Real Estate')
})

test('unregistered keys, keys without a default, images and non-English sources are never touched', () => {
  const record = legacyRecord()
  record.fields.aboutLabel = { type: 'text', sourceLang: 'tr', en: 'Who We Are', tr: 'Who We Are' }
  const plan = planEchoCleanup(record, fieldTypeOf, DEFAULTS)
  assert.deepEqual(plan.unregistered, ['legacyKey'])
  assert.deepEqual(plan.noDefault, ['noDefaultKey'])
  assert.equal(plan.images, 1)
  assert.deepEqual(plan.nonEnglishSource, [{ key: 'aboutLabel', sourceLang: 'tr' }])
  for (const key of ['legacyKey', 'noDefaultKey', 'heroImage', 'aboutLabel']) {
    assert.ok(!plan.removals.some((r) => r.key === key), key)
  }
})

// ── Dry run ────────────────────────────────────────────────────────────────
test('a report run performs zero writes and makes no backup', async () => {
  const before = structuredClone(collection.current())
  const result = await run({ write: false })

  assert.equal(result.found, true)
  assert.equal(result.wrote, false)
  assert.ok(result.plan.removals.length > 0)
  assert.equal(collection.calls.updateOne, 0)
  assert.equal(backups.length, 0)
  assert.deepEqual(collection.current(), before)
})

test('write defaults to off', async () => {
  await runEchoCleanup({ collection, pageKey: 'home', fieldTypeOf, defaults: DEFAULTS, backup: okBackup })
  assert.equal(collection.calls.updateOne, 0)
})

// ── Backup gate ────────────────────────────────────────────────────────────
test('a failing backup prevents any write', async () => {
  const before = structuredClone(collection.current())
  await assert.rejects(run({ write: true, backup: async () => { throw new Error('disk full') } }), /disk full/)
  assert.equal(collection.calls.updateOne, 0)
  assert.deepEqual(collection.current(), before)
})

test('a backup that reports no file prevents any write', async () => {
  await assert.rejects(run({ write: true, backup: async () => '' }), /Backup did not report a file/)
  assert.equal(collection.calls.updateOne, 0)
})

test('a missing backup function prevents any write', async () => {
  await assert.rejects(run({ write: true, backup: undefined }), /backup function is required/)
  assert.equal(collection.calls.updateOne, 0)
})

// ── Write ──────────────────────────────────────────────────────────────────
test('write mode backs up the exact record, then removes only the planned slots', async () => {
  const before = structuredClone(collection.current())
  const result = await run({ write: true })

  assert.equal(result.wrote, true)
  assert.equal(backups.length, 1)
  assert.deepEqual(backups[0], before, 'the backup is the record exactly as read')
  assert.equal(result.remainingAfterWrite, 0)

  const after = collection.current().fields
  // English is never touched.
  for (const key of Object.keys(before.fields)) assert.deepEqual(after[key].en, before.fields[key].en, `${key}.en`)
  // Echoes gone; everything else identical.
  assert.deepEqual(after.heroHeading1, { type: 'text', sourceLang: 'en', en: 'We Design, Build\n', verified: false })
  assert.deepEqual(after.contactLabel, { type: 'text', sourceLang: 'en', en: 'Contact Us', tr: 'Bize Ulaşın' })
  assert.equal(after.ctaHeading.ar, 'Ready to start your project!')
  assert.deepEqual(after.heroLabel, before.fields.heroLabel, 'admin-edited field byte-for-byte unchanged')
  assert.deepEqual(after.legacyKey, before.fields.legacyKey)
  assert.deepEqual(after.noDefaultKey, before.fields.noDefaultKey)
  assert.deepEqual(after.heroImage, before.fields.heroImage)
})

test('a record that changed after it was read is not modified', async () => {
  const original = collection.findOne.bind(collection)
  let reads = 0
  collection.findOne = async (filter) => {
    const doc = await original(filter)
    reads += 1
    // Someone edits the German heading between the read and the write.
    if (reads === 1) {
      const changed = structuredClone(collection.current())
      changed.fields.heroHeading1.de = 'Wir entwerfen und bauen'
      collection.setCurrent(changed)
    }
    return doc
  }
  await assert.rejects(run({ write: true }), /changed after it was read/)
  assert.equal(collection.current().fields.heroHeading1.tr, 'We Design, Build\n', 'nothing was removed')
})

// ── Idempotence ────────────────────────────────────────────────────────────
test('a second run after cleanup finds nothing and writes nothing', async () => {
  await run({ write: true })
  const updatesAfterFirst = collection.calls.updateOne
  const snapshot = structuredClone(collection.current())

  const report = await run({ write: false })
  assert.equal(report.plan.removals.length, 0)
  assert.deepEqual(report.plan.countsByLanguage, { tr: 0, ar: 0, de: 0, ru: 0, ur: 0 })

  const second = await run({ write: true })
  assert.equal(second.wrote, false, 'nothing to remove means no write')
  assert.equal(collection.calls.updateOne, updatesAfterFirst)
  assert.equal(backups.length, 1, 'no second backup when there is nothing to do')
  assert.deepEqual(collection.current(), snapshot)
})

// ── Approved-plan guard ────────────────────────────────────────────────────
const APPROVED = { removals: 11, fields: 4, preserved: ['heroLabel'], untouchedKeys: ['legacyKey', 'noDefaultKey', 'heroLabel'] }

test('a plan matching the approved expectation is written', async () => {
  const result = await run({ write: true, expect: APPROVED })
  assert.equal(result.wrote, true)
})

for (const [label, change] of [
  ['a different slot count', { removals: 12 }],
  ['a different field count', { fields: 5 }],
  ['an expected-preserved field that is no longer admin-edited', { preserved: ['heroHeading1'] }],
  ['a must-stay-untouched key that would be modified', { untouchedKeys: ['heroHeading1'] }],
]) {
  test(`${label} stops the run before the backup and the write`, async () => {
    const before = structuredClone(collection.current())
    await assert.rejects(run({ write: true, expect: { ...APPROVED, ...change } }), /no longer matches what was approved/)
    assert.equal(backups.length, 0, 'no backup')
    assert.equal(collection.calls.updateOne, 0, 'no write')
    assert.deepEqual(collection.current(), before)
  })
}

test('a missing page reports not-found and writes nothing', async () => {
  const result = await runEchoCleanup({ collection, pageKey: 'nope', fieldTypeOf, defaults: DEFAULTS, write: true, backup: okBackup })
  assert.equal(result.found, false)
  assert.equal(collection.calls.updateOne, 0)
})
