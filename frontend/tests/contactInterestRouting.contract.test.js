// Contact interest vocabulary — the index-coupled bits nothing else guards.
//
// ── Why this file exists ────────────────────────────────────────────────
// ContactPage renders <option value={INTEREST_TYPES[i]}>{interests[i]}</option>.
// The value array lives in ContactPage.jsx; the six label arrays live in
// translations.js, one per language. Nothing at runtime checks that the seven
// arrays are the same length or in the same order.
//
// The failure mode is silent and total: append a value but miss one language,
// and every option after the insertion point in that language shows the WRONG
// label attached to a real canonical value. A Russian visitor picks "Общее" and
// submits interestType: 'Troubleshoot'. No error is thrown anywhere — not in the
// browser, not in the validator, not in Mongoose. The lead is simply filed and
// routed as the wrong category.
//
// So: length parity, tail alignment, and — the one that matters most — that the
// form can only ever offer values the backend actually accepts.
//
// Static source contracts, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const loadTranslations = async () => {
  const raw = await readFile(join(here, '..', 'src', 'locales', 'translations.js'), 'utf8')
  const cjs = raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = ')
  const mod = { exports: {} }
  new Function('module', 'exports', cjs)(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

/** Pulls the first bracketed string-literal list out of a source file. */
const arrayLiteralAfter = (src, marker) => {
  const start = src.indexOf(marker)
  assert.notEqual(start, -1, `marker not found: ${marker}`)
  const open = src.indexOf('[', start)
  const close = src.indexOf(']', open)
  return [...src.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

const loadInterestTypes = async () => {
  const src = await readFile(join(here, '..', 'src', 'pages', 'ContactPage.jsx'), 'utf8')
  return arrayLiteralAfter(src, 'const INTEREST_TYPES')
}

const readBackend = async (...p) =>
  readFile(join(here, '..', '..', 'backend', ...p), 'utf8')

/* ══════════════ THE OPTION EXISTS ══════════════ */

test('the contact form offers Troubleshoot', async () => {
  const types = await loadInterestTypes()
  assert.ok(types.includes('Troubleshoot'),
    'the technical-support reason is missing from the contact form')
})

test('Troubleshoot is appended, so no existing label shifts', async () => {
  // Placement is load-bearing, not cosmetic. Donor slots its equivalent at
  // index 6, which pushes 'General' to 7 in every language at once. Appending
  // leaves indices 0-6 exactly where six translated arrays already expect them.
  const types = await loadInterestTypes()
  assert.equal(types[types.length - 1], 'Troubleshoot',
    'Troubleshoot must stay last — moving it re-indexes every label array')
  assert.equal(types.indexOf('General'), 6,
    'General moved; the six label arrays are now off by one after index 6')
})

/* ══════════════ THE INDEX COUPLING ══════════════ */

test('every language supplies exactly one label per canonical value', async () => {
  const types = await loadInterestTypes()
  const t = await loadTranslations()

  for (const lang of LANGS) {
    const labels = t[lang]?.contactPage?.interests
    assert.ok(Array.isArray(labels), `${lang}: contactPage.interests is missing`)
    assert.equal(labels.length, types.length,
      `${lang}: ${labels.length} labels for ${types.length} values — ` +
      'every option after the shortfall renders the wrong label')
  }
})

test('the last label in every language belongs to Troubleshoot', async () => {
  const types = await loadInterestTypes()
  const t = await loadTranslations()
  const i = types.indexOf('Troubleshoot')

  // The exact strings, so a copy-paste that leaves English in place is caught
  // rather than passing as "a label exists".
  const EXPECTED = {
    en: 'Troubleshoot',
    tr: 'Sorun Giderme',
    ar: 'استكشاف الأخطاء',
    de: 'Problembehebung',
    ru: 'Решение проблемы',
    ur: 'مسئلہ حل کرنا',
  }

  for (const lang of LANGS) {
    const labels = t[lang].contactPage.interests
    assert.equal(labels[i], EXPECTED[lang], `${lang}: wrong label at the Troubleshoot index`)
    assert.equal(labels[i], labels[labels.length - 1],
      `${lang}: the label is not in the tail position`)
  }
})

test('no language leaves an interest label empty or duplicated', async () => {
  const t = await loadTranslations()

  for (const lang of LANGS) {
    const labels = t[lang].contactPage.interests
    for (const [i, label] of labels.entries()) {
      assert.ok(typeof label === 'string' && label.trim().length > 0,
        `${lang}: interests[${i}] is blank`)
    }
    assert.equal(new Set(labels).size, labels.length,
      `${lang}: two options share a label — a visitor cannot tell them apart`)
  }
})

/* ══════════════ VALUE, NOT LABEL, IS SUBMITTED ══════════════ */

test('the select submits the canonical value and renders the label separately', async () => {
  const src = await readFile(join(here, '..', 'src', 'pages', 'ContactPage.jsx'), 'utf8')

  // The original bug: value={translatedLabel} meant every non-English visitor
  // was rejected by the enum. The value must come from the canonical array.
  assert.ok(
    /<option key=\{canonical\} value=\{canonical\}>\{c\.interests\?\.\[i\] \|\| canonical\}<\/option>/.test(src),
    'the option no longer submits the canonical value while displaying the localized label'
  )
})

test('no translated label is ever used as a canonical value', async () => {
  const types = await loadInterestTypes()
  const t = await loadTranslations()

  const translated = new Set()
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    for (const label of t[lang].contactPage.interests) translated.add(label)
  }

  for (const value of types) {
    assert.equal(translated.has(value), false,
      `'${value}' is a localized label, not a canonical English value`)
  }
})

/* ══════════════ THE FORM CANNOT OUTRUN THE BACKEND ══════════════ */

test('every reason the form offers is accepted by the contact validator', async () => {
  // Cross-package on purpose. This is the assertion that would have caught the
  // whole class of bug this feature came out of: a value offered in the UI that
  // the API rejects with a 400 the visitor only sees as "Failed to send message".
  const types = await loadInterestTypes()
  const accepted = arrayLiteralAfter(await readBackend('routes', 'contact.js'), "body('interestType')")

  for (const value of types) {
    assert.ok(accepted.includes(value),
      `the form offers '${value}' but routes/contact.js would reject it`)
  }
})

/* ══════════════ ADMIN LEAD ROUTING ══════════════ */

test('admin lead routing knows every type the backend serves', async () => {
  const src = await readFile(join(here, '..', 'src', 'pages', 'AdminLeadRouting.jsx'), 'utf8')
  const allTypes = arrayLiteralAfter(src, 'const ALL_TYPES')
  const served = arrayLiteralAfter(await readBackend('routes', 'leadRouting.js'), 'const ALL_TYPES')

  assert.deepEqual([...allTypes].sort(), [...served].sort(),
    'the admin list has drifted from routes/leadRouting.js — rows arrive unrecognised')
})

test('admin lead routing offers both Construction and Troubleshoot', async () => {
  const src = await readFile(join(here, '..', 'src', 'pages', 'AdminLeadRouting.jsx'), 'utf8')
  const allTypes = arrayLiteralAfter(src, 'const ALL_TYPES')

  assert.ok(allTypes.includes('Troubleshoot'),
    'the owner cannot configure technical recipients without this row')
  assert.ok(allTypes.includes('Construction'),
    'Construction was already served by the backend and must stay listed')
})

test('every routing type has an icon', async () => {
  // Construction was served by the backend but absent from ALL_TYPES and
  // TYPE_ICONS, so its card rendered with an empty icon slot. This pins the fix
  // and stops the next added type from repeating it.
  const src = await readFile(join(here, '..', 'src', 'pages', 'AdminLeadRouting.jsx'), 'utf8')
  const allTypes = arrayLiteralAfter(src, 'const ALL_TYPES')

  const block = src.slice(src.indexOf('const TYPE_ICONS'), src.indexOf('const emptyRecipient'))
  for (const type of allTypes) {
    const key = /\s/.test(type) ? `'${type}':` : `${type}:`
    assert.ok(block.includes(key),
      `TYPE_ICONS has no entry for '${type}' — the card renders iconless`)
  }
})

/* ══════════════ THE BUSINESS DISTINCTION ══════════════ */

test('Construction and Troubleshoot stay separate categories', async () => {
  // Construction = commissioning a new build.
  // Troubleshoot = a problem with something already built, for the technical team.
  // They exist to route to different recipients, so neither may absorb the other.
  const served = arrayLiteralAfter(await readBackend('routes', 'leadRouting.js'), 'const ALL_TYPES')

  assert.ok(served.includes('Construction'))
  assert.ok(served.includes('Troubleshoot'))
  assert.equal(new Set(served).size, served.length, 'the routing vocabulary has a duplicate')
})
