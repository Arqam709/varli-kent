// Validates the JSON part of a service-request submit.
//
// Pure: no database, no storage. Ownership of any design references is checked
// separately (services/serviceRequests/design.js), after this has accepted the
// shape. Every choice must be a known id — never a label, never free text — and
// every list is de-duplicated, so what is stored is exactly the vocabulary in
// config/serviceRequests.js.

import mongoose from 'mongoose'
import {
  BUDGET_LABELS,
  INTERIOR_ROOM_LABELS,
  PROPERTY_TYPE_LABELS,
  RENOVATION_AREA_LABELS,
  RENOVATION_WORK_LABELS,
  SERVICE_REQUEST_IDEMPOTENCY_KEY_PATTERN,
  SERVICE_REQUEST_LIMITS,
  SERVICE_REQUEST_TYPES,
  TIMELINE_LABELS,
} from '../../config/serviceRequests.js'

// Deliberately modest: a real address, not an RFC-complete parser.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const text = (value) => (typeof value === 'string' ? value.trim() : '')

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** A de-duplicated list of known ids, or null when anything in it is unknown. */
const idList = (value, labels) => {
  if (!Array.isArray(value)) return null
  const known = new Set(Object.keys(labels))
  if (!value.every((item) => typeof item === 'string' && known.has(item))) return null
  return [...new Set(value)]
}

const optionalObjectId = (value) => {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value === 'string' && mongoose.isValidObjectId(value) && /^[0-9a-f]{24}$/i.test(value)) {
    return { ok: true, value }
  }
  return { ok: false }
}

/**
 * @returns {{ errors: { field: string, message: string }[], value: object | null }}
 */
export function validateServiceRequestPayload(raw) {
  const errors = []
  const fail = (field, message) => errors.push({ field, message })

  if (!isPlainObject(raw)) return { errors: [{ field: 'payload', message: 'Request details are required' }], value: null }

  const type = raw.type
  if (!SERVICE_REQUEST_TYPES.includes(type)) fail('type', 'Unknown request type')

  const idempotencyKey = text(raw.idempotencyKey)
  if (!SERVICE_REQUEST_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    fail('idempotencyKey', 'A valid idempotency key is required')
  }

  // ── Contact ───────────────────────────────────────────────────────────
  const contact = isPlainObject(raw.contact) ? raw.contact : {}
  const name = text(contact.name)
  const email = text(contact.email).toLowerCase()
  const phone = text(contact.phone)
  if (!name || name.length > SERVICE_REQUEST_LIMITS.name) fail('contact.name', 'Name is required')
  if (!EMAIL_PATTERN.test(email) || email.length > SERVICE_REQUEST_LIMITS.email) fail('contact.email', 'A valid email is required')
  if (phone.replace(/\D/g, '').length < 6 || phone.length > SERVICE_REQUEST_LIMITS.phone) fail('contact.phone', 'A valid phone number is required')

  // ── Property ──────────────────────────────────────────────────────────
  const property = isPlainObject(raw.property) ? raw.property : {}
  const propertyType = property.type
  if (!Object.hasOwn(PROPERTY_TYPE_LABELS, propertyType ?? '')) fail('property.type', 'Choose a property type')

  let sizeSqm = null
  if (property.sizeSqm !== undefined && property.sizeSqm !== null && property.sizeSqm !== '') {
    const size = Number(property.sizeSqm)
    if (!Number.isFinite(size) || size < SERVICE_REQUEST_LIMITS.minSqm || size > SERVICE_REQUEST_LIMITS.maxSqm) {
      fail('property.sizeSqm', 'Size must be a realistic number of square metres')
    } else {
      sizeSqm = Math.round(size)
    }
  }

  const district = text(property.district)
  if (district.length > SERVICE_REQUEST_LIMITS.district) fail('property.district', 'District is too long')

  // ── Budget, timeline, notes ───────────────────────────────────────────
  if (!Object.hasOwn(BUDGET_LABELS, raw.budget ?? '')) fail('budget', 'Choose a budget')
  if (!Object.hasOwn(TIMELINE_LABELS, raw.timeline ?? '')) fail('timeline', 'Choose a timeline')

  const notes = text(raw.notes)
  if (notes.length > SERVICE_REQUEST_LIMITS.notes) fail('notes', 'Notes are too long')

  // ── Type-specific ─────────────────────────────────────────────────────
  let interiorDesign = null
  let renovation = null
  let designRefs = { boardId: null, generationId: null }

  if (type === 'interior_design') {
    const block = isPlainObject(raw.interiorDesign) ? raw.interiorDesign : {}
    const rooms = idList(block.rooms, INTERIOR_ROOM_LABELS)
    if (!rooms || rooms.length === 0) fail('interiorDesign.rooms', 'Choose at least one room')

    const board = optionalObjectId(block.designBoardId)
    const generation = optionalObjectId(block.generationId)
    if (!board.ok) fail('interiorDesign.designBoardId', 'Invalid design board')
    if (!generation.ok) fail('interiorDesign.generationId', 'Invalid visualization')

    interiorDesign = { rooms: rooms ?? [] }
    designRefs = { boardId: board.value ?? null, generationId: generation.value ?? null }
  }

  if (type === 'renovation') {
    const block = isPlainObject(raw.renovation) ? raw.renovation : {}
    const areas = idList(block.areas, RENOVATION_AREA_LABELS)
    const work = idList(block.work, RENOVATION_WORK_LABELS)
    if (!areas || areas.length === 0) fail('renovation.areas', 'Choose at least one area')
    if (!work || work.length === 0) fail('renovation.work', 'Choose at least one kind of work')
    renovation = { areas: areas ?? [], work: work ?? [] }

    // A renovation is not a Design My Space request; refuse rather than ignore.
    if (raw.interiorDesign !== undefined) fail('interiorDesign', 'Not allowed on a renovation request')
  }

  if (errors.length > 0) return { errors, value: null }

  return {
    errors,
    value: {
      type,
      idempotencyKey,
      contact: { name, email, phone },
      property: { type: propertyType, sizeSqm, district },
      budget: raw.budget,
      timeline: raw.timeline,
      notes,
      interiorDesign,
      renovation,
      designRefs,
    },
  }
}
