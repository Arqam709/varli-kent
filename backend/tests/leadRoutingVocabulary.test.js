// The canonical interest-type vocabulary, checked against the REAL source files.
//
// contact.routes.test.js proves the ROUTE behaves, but it does so behind mocked
// models — its CONTACT_ENUM is a hand-maintained copy, and its LeadRouting stub
// enforces no enum at all. So a value could be added to that copy and to the
// route while models/LeadRouting.js was forgotten, and every test there would
// still pass while a lead routed to nobody in production.
//
// This file closes that gap by touching the actual artefacts: the two Mongoose
// schemas (validated with validateSync(), which needs no database connection)
// and the two route files read as text. No mocks, no network, no DB.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import ContactSubmission from '../models/ContactSubmission.js'
import LeadRouting from '../models/LeadRouting.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The one true set. Every list below must equal this, and the contact form,
 * the admin routing screen and both Mongoose schemas key off these exact
 * strings — a localized label must never reach any of them.
 */
const CANONICAL = [
  'Buying', 'Selling', 'Renting', 'Renovation',
  'Interior Design', 'Architecture', 'Construction', 'General', 'Troubleshoot',
]

/** Pulls the first bracketed string-literal list out of a source file. */
const arrayLiteralAfter = (src, marker) => {
  const start = src.indexOf(marker)
  assert.notEqual(start, -1, `marker not found: ${marker}`)
  const open = src.indexOf('[', start)
  const close = src.indexOf(']', open)
  assert.ok(open !== -1 && close !== -1, `no array literal after ${marker}`)
  return [...src.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/* ══════════════ The two schemas ══════════════ */

test('ContactSubmission accepts every canonical reason and nothing else', () => {
  for (const interestType of CANONICAL) {
    const doc = new ContactSubmission({
      name: 'Ada Yilmaz',
      email: 'ada@example.com',
      phone: '+90 532 000 00 00',
      interestType,
      message: 'Hello',
    })
    assert.equal(doc.validateSync(), undefined, `${interestType} must be storable`)
  }

  const bogus = new ContactSubmission({
    name: 'Ada Yilmaz',
    email: 'ada@example.com',
    phone: '+90 532 000 00 00',
    interestType: 'Gardening',
    message: 'Hello',
  })
  assert.ok(bogus.validateSync()?.errors?.interestType,
    'the enum is still enforced — it must not have been widened to any string')
})

test('LeadRouting accepts every canonical reason and nothing else', () => {
  // The gap contact.routes.test.js cannot see: its LeadRouting stub enforces
  // nothing, so this is the only place the real routing enum is exercised.
  for (const interestType of CANONICAL) {
    const doc = new LeadRouting({ interestType, recipients: [] })
    assert.equal(doc.validateSync(), undefined, `${interestType} must be routable`)
  }

  const bogus = new LeadRouting({ interestType: 'Troubleshooting', recipients: [] })
  assert.ok(bogus.validateSync()?.errors?.interestType,
    'a near-miss spelling must be rejected, not stored as an unroutable category')
})

test('a routing row can carry the technical recipients a Troubleshoot lead needs', () => {
  // There is no department model and no technical role. "Routed to the technical
  // department" means exactly this document: recipients an owner typed in.
  const doc = new LeadRouting({
    interestType: 'Troubleshoot',
    recipients: [{ email: 'technical@example.test', label: 'Technical Team' }],
  })

  assert.equal(doc.validateSync(), undefined)
  assert.equal(doc.recipients[0].email, 'technical@example.test')
  assert.equal(doc.recipients[0].label, 'Technical Team')
})

test('a recipient still requires an email address', () => {
  const doc = new LeadRouting({ interestType: 'Troubleshoot', recipients: [{ label: 'No address' }] })
  assert.ok(doc.validateSync(), 'a labelled recipient with no address must not validate')
})

/* ══════════════ The two route files ══════════════ */

test('the contact validator offers exactly the canonical set', async () => {
  const src = await readFile(join(here, '..', 'routes', 'contact.js'), 'utf8')
  const allowed = arrayLiteralAfter(src, "body('interestType')")

  assert.deepEqual([...allowed].sort(), [...CANONICAL].sort(),
    'routes/contact.js has drifted from the canonical vocabulary')
})

test('lead routing offers exactly the canonical set', async () => {
  const src = await readFile(join(here, '..', 'routes', 'leadRouting.js'), 'utf8')
  const allTypes = arrayLiteralAfter(src, 'const ALL_TYPES')

  assert.deepEqual([...allTypes].sort(), [...CANONICAL].sort(),
    'routes/leadRouting.js ALL_TYPES has drifted — some reasons would have no routing row')
})

/* ══════════════ The distinction this feature rests on ══════════════ */

test('Construction and Troubleshoot both exist and are distinct', () => {
  // Construction  = the visitor wants a new build.
  // Troubleshoot  = the visitor has a problem with something already built.
  // Donor collapsed these into one value; CURRENT keeps them apart so an owner
  // can send build enquiries and support requests to different inboxes.
  assert.ok(CANONICAL.includes('Construction'))
  assert.ok(CANONICAL.includes('Troubleshoot'))
  assert.notEqual('Construction', 'Troubleshoot')
  assert.equal(new Set(CANONICAL).size, CANONICAL.length, 'the vocabulary has a duplicate')
})
