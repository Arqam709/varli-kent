// How a service request is PRESENTED — to staff (the ContactSubmission summary
// and the lead email) and to its owner (My Requests).
//
// Pure except for `signStaffPhotoLink`, which only needs a secret.

import crypto from 'node:crypto'
import {
  BUDGET_LABELS,
  CONTACT_STATUS_TO_REQUEST_STATUS,
  DESIGN_LIGHTING_LABELS,
  DESIGN_STYLE_LABELS,
  INTERIOR_ROOM_LABELS,
  PROPERTY_TYPE_LABELS,
  RENOVATION_AREA_LABELS,
  RENOVATION_WORK_LABELS,
  SERVICE_REQUEST_STAFF_LINK_TTL_MS,
  SERVICE_REQUEST_TYPE_LABELS,
  TIMELINE_LABELS,
} from '../../config/serviceRequests.js'
import { DESIGN_ROOM_TO_REQUEST_ROOM } from '../../config/serviceRequests.js'

const label = (labels, id) => labels[id] ?? id
const labelList = (labels, list = []) => list.map((id) => label(labels, id)).join(', ')

/** Collapses whitespace, so no field can break a one-line summary. */
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

const PHOTO_KIND_LABELS = Object.freeze({
  customer: 'Customer photo',
  room_photo: 'Original room photo',
  visualization: 'AI visualization',
})

const propertyText = (property) =>
  [
    label(PROPERTY_TYPE_LABELS, property.type),
    property.sizeSqm ? `~${property.sizeSqm} m²` : '',
    property.district ? oneLine(property.district) : '',
  ]
    .filter(Boolean)
    .join(' · ')

const designRoomText = (snapshot) =>
  label(INTERIOR_ROOM_LABELS, DESIGN_ROOM_TO_REQUEST_ROOM[snapshot.room] ?? snapshot.room)

/**
 * The rows every staff-facing rendering shares, in reading order. Labels are
 * English (staff tooling is English today); values are the customer's own
 * words or the vocabulary's English labels.
 */
export function serviceRequestRows(request) {
  const rows = [['Request ID', String(request._id)]]
  rows.push(['Property', propertyText(request.property)])

  if (request.type === 'interior_design') {
    rows.push(['Rooms', labelList(INTERIOR_ROOM_LABELS, request.interiorDesign?.rooms)])
    const design = request.interiorDesign?.design
    if (design?.snapshot) {
      const s = design.snapshot
      rows.push(['Design room', designRoomText(s)])
      rows.push(['Style', label(DESIGN_STYLE_LABELS, s.style)])
      rows.push(['Wall', `${oneLine(s.wall.label)} (${s.wall.color})`])
      rows.push(['Floor', `${oneLine(s.floor.label)} (${s.floor.color})`])
      if (s.materials?.length) rows.push(['Materials', s.materials.map((m) => oneLine(m.name)).join(', ')])
      rows.push(['Lighting', label(DESIGN_LIGHTING_LABELS, s.lighting)])
      rows.push(['AI visualization', design.generation ? 'Yes' : 'No'])
    } else {
      rows.push(['Design attached', 'No'])
    }
  }

  if (request.type === 'renovation') {
    rows.push(['Areas', labelList(RENOVATION_AREA_LABELS, request.renovation?.areas)])
    rows.push(['Work', labelList(RENOVATION_WORK_LABELS, request.renovation?.work)])
  }

  rows.push(['Budget', label(BUDGET_LABELS, request.budget)])
  rows.push(['Timeline', label(TIMELINE_LABELS, request.timeline)])
  rows.push(['Photos', String(request.photos?.length ?? 0)])
  if (request.notes) rows.push(['Notes', oneLine(request.notes)])
  return rows
}

/**
 * The ContactSubmission `message` — what the UNCHANGED admin Messages page
 * shows. That page renders the message in a plain paragraph with no line
 * breaks, so this is one line with an explicit separator, the same convention
 * the Design My Space board summary already uses.
 */
export function serviceRequestSummary(request) {
  const heading = SERVICE_REQUEST_TYPE_LABELS[request.type].toUpperCase()
  return [heading, ...serviceRequestRows(request).map(([key, value]) => `${key}: ${value}`)].join(' · ')
}

/* ── Staff photo links ─────────────────────────────────────────────────── */

const linkSecret = (env = process.env) => env.SERVICE_REQUEST_LINK_SECRET || env.JWT_SECRET || ''

const signature = (requestId, photoId, expires, secret) =>
  crypto
    .createHmac('sha256', secret)
    .update(`service-request-photo:${requestId}:${photoId}:${expires}`)
    .digest('base64url')

/**
 * An expiring, unguessable link to ONE photo of ONE request, for the lead
 * email. Only built when the backend knows its own public address
 * (PUBLIC_API_URL) and has a secret; otherwise the email lists the photo count
 * and the Request ID, and no link is sent at all.
 */
export function signStaffPhotoLink(requestId, photoId, { now = Date.now(), env = process.env } = {}) {
  const base = String(env.PUBLIC_API_URL || '').replace(/\/+$/, '')
  const secret = linkSecret(env)
  if (!base || !secret) return null
  const expires = now + SERVICE_REQUEST_STAFF_LINK_TTL_MS
  const sig = signature(String(requestId), String(photoId), expires, secret)
  return `${base}/service-requests/staff-photos/${requestId}/${photoId}?expires=${expires}&sig=${sig}`
}

/** Constant-time check of a staff link. */
export function verifyStaffPhotoLink(requestId, photoId, expires, sig, { now = Date.now(), env = process.env } = {}) {
  const secret = linkSecret(env)
  const expiry = Number(expires)
  if (!secret || !Number.isSafeInteger(expiry) || expiry < now || typeof sig !== 'string') return false
  const expected = Buffer.from(signature(String(requestId), String(photoId), expiry, secret))
  const given = Buffer.from(sig)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/** Extra content for the existing lead email (utils/email.js). */
export function serviceRequestEmailDetails(request, options = {}) {
  const photoLinks = (request.photos ?? [])
    .map((photo, index) => {
      const url = signStaffPhotoLink(request._id, photo._id, options)
      return url ? { label: `${PHOTO_KIND_LABELS[photo.kind] ?? 'Photo'} ${index + 1}`, url } : null
    })
    .filter(Boolean)

  return {
    heading: SERVICE_REQUEST_TYPE_LABELS[request.type],
    rows: serviceRequestRows(request),
    photoLinks,
    photoCount: request.photos?.length ?? 0,
  }
}

/* ── The owner's view ──────────────────────────────────────────────────── */

/** Customer-facing status from the linked ContactSubmission (see config). */
export function requestStatusFor(request, submissionStatusById) {
  if (!request.contactSubmission) return 'submitted'
  const status = submissionStatusById.get(String(request.contactSubmission))
  if (status === undefined) return 'closed'
  return CONTACT_STATUS_TO_REQUEST_STATUS[status] ?? 'submitted'
}

/**
 * What the OWNER may see. No storage paths, no ids of other records beyond the
 * customer's own board/visualization, no idempotency key, no internal link.
 */
export function publicServiceRequest(request, status) {
  const design = request.interiorDesign?.design
  return {
    _id: request._id,
    type: request.type,
    status,
    createdAt: request.createdAt,
    contact: { name: request.contact.name, email: request.contact.email, phone: request.contact.phone },
    property: {
      type: request.property.type,
      sizeSqm: request.property.sizeSqm ?? null,
      district: request.property.district ?? '',
    },
    budget: request.budget,
    timeline: request.timeline,
    notes: request.notes ?? '',
    interiorDesign: request.interiorDesign
      ? {
          rooms: request.interiorDesign.rooms,
          design: design
            ? {
                boardId: design.board ?? null,
                generationId: design.generation ?? null,
                snapshot: design.snapshot,
              }
            : null,
        }
      : null,
    renovation: request.renovation ? { areas: request.renovation.areas, work: request.renovation.work } : null,
    photos: (request.photos ?? []).map((photo) => ({
      _id: photo._id,
      kind: photo.kind,
      width: photo.width,
      height: photo.height,
    })),
  }
}
