// The Contact interest manager's pure layer, and where the manager lives.
//
// ── What is pinned here ─────────────────────────────────────────────────
//   - the admin's id preview is exactly the server's derivation, so what the
//     form promises is what gets created
//   - nothing the manager sends can carry `id` or `value`
//   - the management list keeps disabled interests
//   - the API client calls the three endpoints it should, and only those
//   - the manager is rendered under Page Content → Contact only, and is not
//     part of the page editor's save payload
//
// The rendered UI (loading, errors, add/edit/disable, read-only identity) is
// exercised in a real browser by tests/browser/contactInterests.test.js.
// Run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CONTACT_INTEREST_LANGUAGE_NAMES,
  CONTACT_INTEREST_LIMITS,
  buildCreatePayload,
  buildLabelsPayload,
  buildUpdatePayload,
  contactInterestErrorMessage,
  createContactInterestsClient,
  deriveContactInterestId,
  emptyInterestForm,
  formFromInterest,
  nextInterestOrder,
  normalizeContactInterestValue,
  normalizeManagedInterests,
  sortManagedInterests,
  validateExistingInterestForm,
  validateNewInterestForm,
} from '../src/lib/contactInterestAdmin.js'
import { CONTACT_INTEREST_LANGUAGES } from '../src/lib/contactInterests.js'
import {
  CONTACT_INTEREST_LIMITS as SERVER_LIMITS,
  DEFAULT_CONTACT_INTERESTS,
  deriveContactInterestId as serverDeriveId,
  normalizeContactInterestValue as serverNormalizeValue,
} from '../../backend/config/contactInterests.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (...p) => readFile(join(here, '..', '..', ...p), 'utf8')

const managed = (overrides = {}) => ({
  id: 'buying', value: 'Buying', labels: { en: 'Buying', tr: 'Satın Alma' }, order: 1, enabled: true, ...overrides,
})

const form = (labels = {}, extra = {}) => ({
  labels: { en: '', tr: '', ar: '', de: '', ru: '', ur: '', ...labels },
  enabled: true,
  order: '',
  ...extra,
})

/* ══════════════ Agreement with the server ══════════════ */

test('the id preview is exactly the id the server will derive', () => {
  const labels = [
    'Investment Consultation', '  Interior   Design ', 'Buying & Selling!', 'İç Mimarlık', 'Çözüm Ortaklığı',
    'Café Fit-out', 'Phase 2 Handover', '3D Design', 'تصميم', '', '___', `${'a'.repeat(70)} tail`,
    ...DEFAULT_CONTACT_INTERESTS.map((interest) => interest.value),
  ]
  for (const label of labels) {
    assert.equal(deriveContactInterestId(label), serverDeriveId(label), JSON.stringify(label))
    assert.equal(normalizeContactInterestValue(label), serverNormalizeValue(label), JSON.stringify(label))
  }
})

test('the client limits mirror the server’s', () => {
  assert.equal(CONTACT_INTEREST_LIMITS.label, SERVER_LIMITS.label)
  assert.equal(CONTACT_INTEREST_LIMITS.id, SERVER_LIMITS.id)
  assert.equal(CONTACT_INTEREST_LIMITS.order, SERVER_LIMITS.order)
})

/** U+0300–U+036F, built from code points so this file contains no raw marks either. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`)

test('neither derivation hides raw combining characters in its source', async () => {
  // They behave identically but are invisible in review; both files spell the
  // range as \u escapes.
  for (const file of ['frontend/src/lib/contactInterestAdmin.js', 'backend/config/contactInterests.js']) {
    assert.equal(COMBINING_MARKS.test(await read(file)), false, `${file} contains a raw combining mark`)
  }
})

test('every language has a readable name', () => {
  for (const lang of CONTACT_INTEREST_LANGUAGES) assert.ok(CONTACT_INTEREST_LANGUAGE_NAMES[lang])
})

/* ══════════════ The management list ══════════════ */

test('the management list keeps disabled interests and their state', () => {
  const list = normalizeManagedInterests({
    success: true,
    interests: [managed({ id: 'selling', value: 'Selling', order: 3, enabled: false }), managed()],
  })

  assert.deepEqual(list.map((i) => [i.id, i.enabled]), [['buying', true], ['selling', false]])
})

test('the management list is sorted by order then id, and drops what it cannot trust', () => {
  const list = normalizeManagedInterests([
    managed({ id: 'zeta', value: 'Zeta', order: 2 }),
    managed({ id: 'alpha', value: 'Alpha', order: 2, createdAt: '2026-01-01', _id: 'x' }),
    managed({ id: 'first', value: 'First', order: 0 }),
    managed({ id: 'Bad Id', value: 'Bad' }),
    managed({ id: 'blank', value: '  ' }),
    managed({ id: 'first', value: 'Duplicate' }),
    null,
    'buying',
  ])

  assert.deepEqual(list.map((i) => i.id), ['first', 'alpha', 'zeta'])
  assert.deepEqual(Object.keys(list[1]).sort(), ['enabled', 'id', 'labels', 'order', 'value'])
  assert.deepEqual(normalizeManagedInterests(undefined), [])
})

test('sorting does not mutate its input', () => {
  const input = [managed({ id: 'b', order: 2 }), managed({ id: 'a', order: 1 })]
  sortManagedInterests(input)
  assert.deepEqual(input.map((i) => i.id), ['b', 'a'])
})

/* ══════════════ Forms ══════════════ */

test('an edit form has a slot for every language and the current state', () => {
  const edit = formFromInterest(managed({ order: 7, enabled: false }))

  assert.deepEqual(Object.keys(edit.labels), [...CONTACT_INTEREST_LANGUAGES])
  assert.equal(edit.labels.tr, 'Satın Alma')
  assert.equal(edit.labels.ar, '')
  assert.equal(edit.order, '7')
  assert.equal(edit.enabled, false)
  assert.equal('id' in edit || 'value' in edit, false, 'identity must not be an editable form field')
})

test('a new form suggests the next order after the current last interest', () => {
  assert.equal(nextInterestOrder([managed({ order: 3 }), managed({ order: 9 })]), 10)
  assert.equal(nextInterestOrder([]), 1)
  assert.equal(emptyInterestForm(10).order, '10')
  assert.equal(emptyInterestForm().order, '')
})

test('a new interest needs an English label that can produce an id', () => {
  assert.match(validateNewInterestForm(form()), /English label is required/)
  assert.match(validateNewInterestForm(form({ en: '   ' })), /English label is required/)
  assert.match(validateNewInterestForm(form({ en: '3D Design' })), /Latin letter/)
  assert.equal(validateNewInterestForm(form({ en: 'Investment Consultation' })), null)
})

test('a new interest that collides with an existing one is explained before any request', () => {
  const existing = [managed(), managed({ id: 'land_acquisition', value: 'Land Acquisition', labels: { en: 'Land' }, enabled: false })]

  assert.match(validateNewInterestForm(form({ en: 'buying' }), existing), /Buying.*already uses/)
  assert.match(validateNewInterestForm(form({ en: 'Land  Acquisition' }), existing), /re-enable/)
})

test('order is optional when creating but required and bounded when editing', () => {
  assert.equal(validateNewInterestForm(form({ en: 'Market Report' })), null)
  assert.match(validateNewInterestForm(form({ en: 'Market Report' }, { order: '-1' })), /whole number/)
  assert.match(validateNewInterestForm(form({ en: 'Market Report' }, { order: '1.5' })), /whole number/)
  assert.match(validateNewInterestForm(form({ en: 'Market Report' }, { order: '10000' })), /whole number/)

  assert.match(validateExistingInterestForm(form({ en: 'Buying' })), /Order is required/)
  assert.equal(validateExistingInterestForm(form({ en: 'Buying' }, { order: '0' })), null)
  assert.match(validateExistingInterestForm(form({ tr: 'Satın Alma' }, { order: '1' })), /English label is required/)
})

/* ══════════════ Payloads never carry identity ══════════════ */

test('labels are trimmed and blank optional languages are omitted', () => {
  assert.deepEqual(
    buildLabelsPayload({ en: '  Investment Consultation ', tr: ' Yatırım ', ar: '', de: '   ', ru: undefined, ur: 'سرمایہ' }),
    { en: 'Investment Consultation', tr: 'Yatırım', ur: 'سرمایہ' }
  )
})

test('the create payload has no id or value, and omits a blank order', () => {
  const blankOrder = buildCreatePayload(form({ en: 'Investment Consultation' }))
  assert.deepEqual(blankOrder, { labels: { en: 'Investment Consultation' }, enabled: true })

  const withOrder = buildCreatePayload(form({ en: 'Investment Consultation', tr: 'Yatırım' }, { order: '10', enabled: false }))
  assert.deepEqual(withOrder, { labels: { en: 'Investment Consultation', tr: 'Yatırım' }, enabled: false, order: 10 })
})

test('the update payload is exactly labels, enabled and order', () => {
  const payload = buildUpdatePayload({ ...formFromInterest(managed()), id: 'renamed', value: 'Renamed', order: ' 4 ' })

  assert.deepEqual(Object.keys(payload).sort(), ['enabled', 'labels', 'order'])
  assert.equal(payload.order, 4)
})

/* ══════════════ The API client ══════════════ */

const fakeHttp = (responses = {}) => {
  const calls = []
  const reply = (method) => async (url, body) => {
    calls.push({ method, url, body })
    const response = responses[method]
    if (response instanceof Error) throw response
    return { data: response }
  }
  return { calls, get: reply('get'), post: reply('post'), patch: reply('patch') }
}

test('the client lists through the admin endpoint, keeping disabled interests', async () => {
  const http = fakeHttp({ get: { success: true, interests: [managed({ enabled: false })] } })
  const list = await createContactInterestsClient(http).list()

  assert.deepEqual(http.calls, [{ method: 'get', url: '/contact/interests/manage', body: undefined }])
  assert.equal(list[0].enabled, false)
})

test('the client creates and updates through the interest endpoints only', async () => {
  const http = fakeHttp({
    post: { success: true, interest: managed({ id: 'investment_consultation', value: 'Investment Consultation', order: 10 }) },
    patch: { success: true, interest: managed({ order: 4 }) },
  })
  const client = createContactInterestsClient(http)

  const created = await client.create({ labels: { en: 'Investment Consultation' }, enabled: true })
  const updated = await client.update('buying', { order: 4 })

  assert.deepEqual(http.calls.map((c) => [c.method, c.url]), [
    ['post', '/contact/interests'],
    ['patch', '/contact/interests/buying'],
  ])
  assert.equal(created.id, 'investment_consultation')
  assert.equal(updated.order, 4)
  assert.equal(http.calls.some((c) => c.url.includes('page-content')), false)
})

test('ids are URL-encoded in update requests', async () => {
  const http = fakeHttp({ patch: { interest: managed() } })
  await createContactInterestsClient(http).update('a/b?c', { order: 1 })
  assert.equal(http.calls[0].url, '/contact/interests/a%2Fb%3Fc')
})

test('server messages are surfaced; otherwise the fallback is used', async () => {
  const conflict = Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, data: { message: "An interest with the id 'buying' already exists." } },
  })
  assert.equal(contactInterestErrorMessage(conflict, 'fallback'), "An interest with the id 'buying' already exists.")
  assert.equal(contactInterestErrorMessage(new Error('Network Error'), 'fallback'), 'fallback')

  const http = fakeHttp({ post: conflict })
  await assert.rejects(createContactInterestsClient(http).create({ labels: { en: 'Buying' } }), conflict)
})

/* ══════════════ Where the manager lives ══════════════ */

test('Page Content renders the manager only for the Contact page, after the page editor', async () => {
  const src = await read('frontend/src/pages/AdminPageContent.jsx')

  assert.ok(src.includes("import ContactInterestsManager from '../components/ContactInterestsManager'"))
  assert.ok(src.includes("{pageKey === 'contact' && <ContactInterestsManager />}"))
  assert.ok(src.indexOf('<ContactInterestsManager />') > src.indexOf('page.sections.map('),
    'the manager must sit below the Contact page-content fields')
  assert.ok(src.indexOf('<ContactInterestsManager />') < src.indexOf('Sticky save bar'),
    'the manager must be inside the page, not in the save bar')
})

test('the page editor’s save payload knows nothing about interests', async () => {
  const src = await read('frontend/src/pages/AdminPageContent.jsx')
  const payloadBlock = src.slice(src.indexOf('const payload = useMemo('), src.indexOf('const dirty ='))

  assert.equal(/interest/i.test(payloadBlock), false)
})

test('the manager talks only to the interest API and has no delete', async () => {
  const src = await read('frontend/src/components/ContactInterestsManager.jsx')
  const lib = await read('frontend/src/lib/contactInterestAdmin.js')

  for (const code of [src, lib]) {
    assert.equal(code.includes("'/page-content"), false, 'interests must not be written into PageContent')
    assert.equal(/\.delete\(/.test(code), false, 'interests must never be hard-deleted')
  }
})

test('Contact page-content fields are untouched — interests are not a registry field', async () => {
  const { PAGE_CONTENT_REGISTRY } = await import('../src/lib/pageContentRegistry.js')
  const keys = PAGE_CONTENT_REGISTRY.contact.hero.fields.map((field) => field.key)

  assert.deepEqual(keys, [
    'heroLabel', 'heroHeading', 'heroSubtitle', 'officeLocationLabel',
    'interestLabel', 'sendBtn', 'successHeading', 'successBody',
  ])
  assert.deepEqual(PAGE_CONTENT_REGISTRY.contact.sections, [])
})
