// No hand-written interest vocabulary may creep back into the backend.
//
// ── History ─────────────────────────────────────────────────────────────
// Before Phase 1 the same interest values were hand-copied into four places —
// the two models, the contact validator and the lead-routing route — and a
// value missing from one of them failed silently. Phase 1A derived all four
// from one code contract. Phase 1B went further: interests are records in the
// ContactInterest collection, so there is no list left to keep in step.
//
// The risk now is someone re-adding a copy: an enum on a model (which would
// reject every admin-created interest on save), an isIn() on the validator, or
// an ALL_TYPES array in lead routing. These checks read the real files as text,
// with comments stripped, and guard exactly that. Behaviour is covered by
// contact.routes.test.js and contactInterests.routes.test.js.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import ContactSubmission from '../models/ContactSubmission.js'
import LeadRouting from '../models/LeadRouting.js'
import { DEFAULT_CONTACT_INTEREST_VALUES } from '../config/contactInterests.js'

const here = dirname(fileURLToPath(import.meta.url))

const read = (...segments) => readFile(join(here, '..', ...segments), 'utf8')

/** Source code with comments removed, so documentation cannot satisfy a scan. */
const codeOf = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

/* ══════════════ Models ══════════════ */

test('neither model constrains interestType to a fixed list', () => {
  assert.deepEqual(ContactSubmission.schema.path('interestType').enumValues ?? [], [])
  assert.deepEqual(LeadRouting.schema.path('interestType').enumValues ?? [], [])
})

for (const file of ['ContactSubmission.js', 'LeadRouting.js', 'ContactInterest.js']) {
  test(`models/${file} spells no interest value by hand`, async () => {
    const code = codeOf(await read('models', file))
    for (const value of DEFAULT_CONTACT_INTEREST_VALUES) {
      assert.equal(code.includes(`'${value}'`), false, `models/${file} hardcodes '${value}'`)
    }
  })
}

/* ══════════════ Routes ══════════════ */

for (const file of ['contact.js', 'leadRouting.js', 'contactInterests.js']) {
  test(`routes/${file} spells no interest value by hand`, async () => {
    const code = codeOf(await read('routes', file))
    for (const value of DEFAULT_CONTACT_INTEREST_VALUES) {
      assert.equal(code.includes(`'${value}'`), false, `routes/${file} hardcodes '${value}'`)
    }
  })
}

test('POST /api/contact validates interestType against registered interests, not a list', async () => {
  const code = codeOf(await read('routes', 'contact.js'))

  assert.ok(code.includes('isRegisteredContactInterestValue('), 'the contact route no longer checks registration')
  assert.equal(/body\('interestType'\)[\s\S]{0,80}\.isIn\(/.test(code), false, 'a fixed isIn() list is back')
})

test('lead routing takes its categories from the registered interests', async () => {
  const code = codeOf(await read('routes', 'leadRouting.js'))

  assert.ok(code.includes('listRoutableContactInterests('), 'lead routing no longer reads the interests')
  assert.equal(/ALL_TYPES/.test(code), false, 'a hand-maintained ALL_TYPES is back')
})

test('lead routing remains owner-only on both methods', async () => {
  const code = codeOf(await read('routes', 'leadRouting.js'))

  assert.equal((code.match(/requireRole\('owner'\)/g) ?? []).length, 2)
  assert.equal(/requireRole\([^)]*'admin'/.test(code), false, 'lead routing was opened to admins')
  assert.equal(/requirePermission\(/.test(code), false, 'a permission would let non-owners in')
})

test('nothing in the interest or routing code can delete a record', async () => {
  const files = [
    await read('routes', 'contactInterests.js'),
    await read('routes', 'leadRouting.js'),
    await read('services', 'contactInterests.js'),
  ]
  for (const src of files) {
    assert.equal(/\.(deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete|findOneAndRemove|remove)\(/.test(codeOf(src)), false)
  }
})

test('lead notifications still key recipients off the submitted canonical value', async () => {
  const code = codeOf(await read('utils', 'email.js'))
  assert.ok(code.includes('LeadRouting.findOne({ interestType: submission.interestType })'))
})

/* ══════════════ The distinction this feature rests on ══════════════ */

test('Construction and Troubleshoot both exist as distinct built-in values', () => {
  // Construction  = the visitor wants a new build.
  // Troubleshoot  = the visitor has a problem with something already built.
  assert.ok(DEFAULT_CONTACT_INTEREST_VALUES.includes('Construction'))
  assert.ok(DEFAULT_CONTACT_INTEREST_VALUES.includes('Troubleshoot'))
  assert.equal(new Set(DEFAULT_CONTACT_INTEREST_VALUES).size, DEFAULT_CONTACT_INTEREST_VALUES.length)
})
