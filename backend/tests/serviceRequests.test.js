// Service requests — the pure rules: payload validation, the staff-facing
// summary, the customer-facing status, the owner's view, and the signed staff
// photo links. No database; see serviceRequests.mongo.test.js for the routes.

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { validateServiceRequestPayload } from '../services/serviceRequests/validation.js'
import {
  publicServiceRequest,
  requestStatusFor,
  serviceRequestEmailDetails,
  serviceRequestSummary,
  signStaffPhotoLink,
  verifyStaffPhotoLink,
} from '../services/serviceRequests/presentation.js'
import { leadEmailDetailsHtml, leadEmailHtml } from '../utils/email.js'

const id = () => new mongoose.Types.ObjectId()

const base = (extra = {}) => ({
  idempotencyKey: 'key-12345678',
  contact: { name: 'Ahsan', email: 'Ahsan@Example.com ', phone: '+90 555 123 4567' },
  property: { type: 'apartment', sizeSqm: '120', district: 'Beşiktaş' },
  budget: '500k_1m',
  timeline: 'within_3_months',
  notes: '  Please call after 6pm  ',
  ...extra,
})

const interior = (extra = {}) => base({ type: 'interior_design', interiorDesign: { rooms: ['living_room'] }, ...extra })
const renovation = (extra = {}) =>
  base({ type: 'renovation', renovation: { areas: ['kitchen', 'bathroom'], work: ['plumbing', 'flooring'] }, ...extra })

// ── Validation ───────────────────────────────────────────────────────────

test('a complete interior design payload is accepted and normalized', () => {
  const { errors, value } = validateServiceRequestPayload(interior())
  assert.deepEqual(errors, [])
  assert.equal(value.contact.email, 'ahsan@example.com')
  assert.equal(value.property.sizeSqm, 120)
  assert.equal(value.notes, 'Please call after 6pm')
  assert.deepEqual(value.interiorDesign, { rooms: ['living_room'] })
  assert.deepEqual(value.designRefs, { boardId: null, generationId: null })
})

test('a complete renovation payload is accepted', () => {
  const { errors, value } = validateServiceRequestPayload(renovation())
  assert.deepEqual(errors, [])
  assert.deepEqual(value.renovation, { areas: ['kitchen', 'bathroom'], work: ['plumbing', 'flooring'] })
  assert.equal(value.interiorDesign, null)
})

test('size and district are optional', () => {
  const { errors, value } = validateServiceRequestPayload(renovation({ property: { type: 'villa' } }))
  assert.deepEqual(errors, [])
  assert.equal(value.property.sizeSqm, null)
  assert.equal(value.property.district, '')
})

test('required choices are enforced', () => {
  const fields = (payload) => validateServiceRequestPayload(payload).errors.map((e) => e.field).sort()
  assert.deepEqual(fields(renovation({ renovation: { areas: [], work: [] } })), ['renovation.areas', 'renovation.work'])
  assert.deepEqual(fields(interior({ interiorDesign: { rooms: [] } })), ['interiorDesign.rooms'])
  assert.deepEqual(fields(interior({ budget: 'lots', timeline: undefined })), ['budget', 'timeline'])
  assert.deepEqual(fields(interior({ property: {} })), ['property.type'])
})

test('unknown ids, labels and free text are refused, never stored', () => {
  const fields = (payload) => validateServiceRequestPayload(payload).errors.map((e) => e.field)
  assert.ok(fields(renovation({ renovation: { areas: ['Kitchen'], work: ['plumbing'] } })).includes('renovation.areas'))
  assert.ok(fields(interior({ interiorDesign: { rooms: ['garage'] } })).includes('interiorDesign.rooms'))
  assert.ok(fields(base({ type: 'architecture' })).includes('type'))
  assert.ok(fields(interior({ property: { type: 'castle' } })).includes('property.type'))
})

test('lists are de-duplicated', () => {
  const { value } = validateServiceRequestPayload(renovation({ renovation: { areas: ['kitchen', 'kitchen'], work: ['painting'] } }))
  assert.deepEqual(value.renovation.areas, ['kitchen'])
})

test('contact details are validated', () => {
  const fields = (contact) => validateServiceRequestPayload(interior({ contact })).errors.map((e) => e.field).sort()
  assert.deepEqual(fields({ name: '', email: 'nope', phone: '12' }), ['contact.email', 'contact.name', 'contact.phone'])
})

test('unrealistic sizes and oversized text are refused', () => {
  const fields = (payload) => validateServiceRequestPayload(payload).errors.map((e) => e.field)
  assert.ok(fields(interior({ property: { type: 'villa', sizeSqm: -5 } })).includes('property.sizeSqm'))
  assert.ok(fields(interior({ property: { type: 'villa', sizeSqm: 'big' } })).includes('property.sizeSqm'))
  assert.ok(fields(interior({ notes: 'x'.repeat(2001) })).includes('notes'))
})

test('design references must be ObjectIds and are only read for interior design', () => {
  const board = String(id())
  const ok = validateServiceRequestPayload(interior({ interiorDesign: { rooms: ['kitchen'], designBoardId: board } }))
  assert.equal(ok.value.designRefs.boardId, board)

  const bad = validateServiceRequestPayload(interior({ interiorDesign: { rooms: ['kitchen'], generationId: '{"$ne":null}' } }))
  assert.ok(bad.errors.some((e) => e.field === 'interiorDesign.generationId'))

  const onRenovation = validateServiceRequestPayload(renovation({ interiorDesign: { designBoardId: board } }))
  assert.ok(onRenovation.errors.some((e) => e.field === 'interiorDesign'))
})

test('an idempotency key is required', () => {
  const { errors } = validateServiceRequestPayload(interior({ idempotencyKey: 'x' }))
  assert.ok(errors.some((e) => e.field === 'idempotencyKey'))
})

test('a non-object payload is refused', () => {
  for (const raw of [null, 'text', [], 42]) {
    assert.equal(validateServiceRequestPayload(raw).value, null)
  }
})

// ── Staff-facing summary ─────────────────────────────────────────────────

const storedRequest = (extra = {}) => ({
  _id: id(),
  type: 'interior_design',
  property: { type: 'apartment', sizeSqm: 120, district: 'Besiktas' },
  budget: '500k_1m',
  timeline: 'asap',
  notes: 'Line one\nline two',
  interiorDesign: { rooms: ['living_room', 'kitchen'], design: null },
  renovation: null,
  photos: [],
  ...extra,
})

const snapshot = {
  version: 1,
  room: 'living-room',
  style: 'warm',
  wall: { label: 'Warm Sand', color: '#e8ddd0' },
  floor: { label: 'Dark Oak', color: '#4a3728' },
  materials: [{ name: 'Aged Brass', color: '#b08d57' }],
  lighting: 'warm',
}

test('the admin summary is one line, headed by the request type', () => {
  const summary = serviceRequestSummary(storedRequest())
  assert.equal(summary.includes('\n'), false)
  assert.ok(summary.startsWith('INTERIOR DESIGN REQUEST · Request ID: '))
  assert.ok(summary.includes('Rooms: Living Room, Kitchen'))
  assert.ok(summary.includes('Design attached: No'))
  assert.ok(summary.includes('Budget: ₺500,000 – ₺1,000,000'))
  assert.ok(summary.includes('Notes: Line one line two'))
})

test('a design request lists the snapshot and whether a visualization is attached', () => {
  const summary = serviceRequestSummary(
    storedRequest({ interiorDesign: { rooms: ['living_room'], design: { board: id(), generation: id(), snapshot } } })
  )
  assert.ok(summary.includes('Style: Warm Modern'))
  assert.ok(summary.includes('Wall: Warm Sand (#e8ddd0)'))
  assert.ok(summary.includes('Materials: Aged Brass'))
  assert.ok(summary.includes('AI visualization: Yes'))
})

test('a renovation summary lists areas and work', () => {
  const summary = serviceRequestSummary(
    storedRequest({ type: 'renovation', interiorDesign: null, renovation: { areas: ['kitchen'], work: ['plumbing', 'windows_doors'] } })
  )
  assert.ok(summary.startsWith('RENOVATION REQUEST'))
  assert.ok(summary.includes('Areas: Kitchen'))
  assert.ok(summary.includes('Work: Plumbing, Windows & Doors'))
  assert.ok(summary.includes('Property: Apartment · ~120 m² · Besiktas'))
})

// ── Status ───────────────────────────────────────────────────────────────

test('status comes from the linked ContactSubmission', () => {
  const submission = id()
  const request = { contactSubmission: submission }
  const status = (value) => requestStatusFor(request, new Map([[String(submission), value]]))
  assert.equal(status('New'), 'submitted')
  assert.equal(status('Replied'), 'contacted')
  assert.equal(status('Archived'), 'closed')
  // Deleted by an admin: no longer in anyone's queue.
  assert.equal(requestStatusFor(request, new Map()), 'closed')
  // Not linked yet (mid-submit).
  assert.equal(requestStatusFor({ contactSubmission: null }, new Map()), 'submitted')
})

// ── Owner's view ─────────────────────────────────────────────────────────

test('the owner never sees storage paths, the idempotency key or the lead id', () => {
  const request = {
    ...storedRequest(),
    user: id(),
    createdAt: new Date(),
    contact: { name: 'A', email: 'a@b.co', phone: '5551234567' },
    idempotencyKey: 'secret-key-1',
    contactSubmission: id(),
    photos: [{ _id: id(), kind: 'customer', publicId: 'varlikent/x/service-requests/a/b', deliveryType: 'authenticated', format: 'jpg', width: 800, height: 600, bytes: 1 }],
  }
  const out = publicServiceRequest(request, 'submitted')
  const json = JSON.stringify(out)
  assert.equal(json.includes('publicId'), false)
  assert.equal(json.includes('authenticated'), false)
  assert.equal(json.includes('secret-key-1'), false)
  assert.equal('contactSubmission' in out, false)
  assert.equal('user' in out, false)
  assert.deepEqual(Object.keys(out.photos[0]).sort(), ['_id', 'height', 'kind', 'width'])
})

// ── Staff photo links ────────────────────────────────────────────────────

const env = { PUBLIC_API_URL: 'https://api.example.test/api/', JWT_SECRET: 'test-secret' }

test('staff links are only issued when the backend knows its public address', () => {
  assert.equal(signStaffPhotoLink(id(), id(), { env: { JWT_SECRET: 's' } }), null)
  assert.equal(signStaffPhotoLink(id(), id(), { env: { PUBLIC_API_URL: 'https://x' } }), null)
  const url = signStaffPhotoLink('a'.repeat(24), 'b'.repeat(24), { env, now: 0 })
  assert.ok(url.startsWith('https://api.example.test/api/service-requests/staff-photos/'))
})

test('a staff link verifies for exactly its photo, and only until it expires', () => {
  const requestId = 'a'.repeat(24)
  const photoId = 'b'.repeat(24)
  const url = new URL(signStaffPhotoLink(requestId, photoId, { env, now: 1000 }))
  const expires = url.searchParams.get('expires')
  const sig = url.searchParams.get('sig')

  assert.equal(verifyStaffPhotoLink(requestId, photoId, expires, sig, { env, now: 2000 }), true)
  assert.equal(verifyStaffPhotoLink(requestId, 'c'.repeat(24), expires, sig, { env, now: 2000 }), false)
  assert.equal(verifyStaffPhotoLink(requestId, photoId, String(Number(expires) + 1), sig, { env, now: 2000 }), false)
  assert.equal(verifyStaffPhotoLink(requestId, photoId, expires, sig, { env, now: Number(expires) + 1 }), false)
  assert.equal(verifyStaffPhotoLink(requestId, photoId, expires, `${sig}x`, { env, now: 2000 }), false)
  assert.equal(verifyStaffPhotoLink(requestId, photoId, expires, sig, { env: { ...env, JWT_SECRET: 'other' }, now: 2000 }), false)
})

// ── Lead email ───────────────────────────────────────────────────────────

test('the email gets a structured block only for service requests', () => {
  const submission = { name: 'A', email: 'a@b.co', phone: '1', interestType: 'Interior Design', message: 'm' }
  assert.equal(leadEmailHtml(submission).includes('Request ID'), false)
  const withDetails = leadEmailHtml(submission, serviceRequestEmailDetails(storedRequest(), { env: {} }))
  assert.ok(withDetails.includes('Request ID'))
  assert.ok(withDetails.includes('Interior Design Request'))
})

test('the structured block escapes everything and only links http(s)', () => {
  const html = leadEmailDetailsHtml({
    heading: '<b>x</b>',
    rows: [['Notes', '<script>alert(1)</script>']],
    photoLinks: [{ label: 'ok', url: 'https://a.test/p?x=1&y=2' }, { label: 'bad', url: 'javascript:alert(1)' }],
  })
  assert.equal(html.includes('<script>'), false)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.equal(html.includes('javascript:'), false)
  assert.ok(html.includes('https://a.test/p?x=1&amp;y=2'))
})

test('without links, the email says how many photos are stored', () => {
  const html = leadEmailDetailsHtml({ heading: 'h', rows: [['a', 'b']], photoLinks: [], photoCount: 3 })
  assert.ok(html.includes('3 stored privately'))
})
