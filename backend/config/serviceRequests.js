// Structured SERVICE REQUESTS — Interior Design and Renovation — submitted from
// the mobile app.
//
// A request is the customer's own structured record of what they asked for. It
// does NOT replace the company's lead workflow: every request also creates one
// ordinary ContactSubmission (the existing admin Messages inbox, the existing
// LeadRouting recipients, the existing lead email). See routes/serviceRequests.js.
//
// ── Stable ids, English labels ───────────────────────────────────────────
// Every choice travels and is stored as a stable id. The English labels below
// exist for ONE purpose: the one-line summary written into the ContactSubmission
// and the lead email, which Varlikent staff read in English today. The app shows
// its own translated labels for the same ids (features/service-requests).
//
// The vocabulary is deliberately drawn from Varlikent's own service content —
// the Renovation page's services are "Window & Door Replacement", "Structural
// Alterations", "Electrical & Lighting" and "Bathroom & Kitchen", and its
// before/after list talks about finishes, lighting and layout — rather than a
// generic renovation checklist.

export const SERVICE_REQUEST_TYPES = Object.freeze(['interior_design', 'renovation'])

/**
 * Which existing Contact interest each type is filed under. These are BUILT-IN
 * interest values (config/contactInterests.js): they can be disabled by an
 * admin but never deleted, and a disabled value is still accepted and still
 * routed — so a request can never lose its lead routing.
 */
export const SERVICE_REQUEST_CONTACT_INTEREST = Object.freeze({
  interior_design: 'Interior Design',
  renovation: 'Renovation',
})

export const SERVICE_REQUEST_TYPE_LABELS = Object.freeze({
  interior_design: 'Interior Design Request',
  renovation: 'Renovation Request',
})

const labelled = (entries) => Object.freeze(Object.fromEntries(entries))

export const PROPERTY_TYPE_LABELS = labelled([
  ['apartment', 'Apartment'],
  ['villa', 'Villa'],
  ['house', 'House'],
  ['office', 'Office'],
  ['commercial', 'Commercial'],
  ['other', 'Other'],
])

/** Interior Design: which spaces the customer wants designed. */
export const INTERIOR_ROOM_LABELS = labelled([
  ['living_room', 'Living Room'],
  ['bedroom', 'Bedroom'],
  ['kitchen', 'Kitchen'],
  ['bathroom', 'Bathroom'],
  ['dining_room', 'Dining Room'],
  ['office', 'Home Office'],
  ['whole_home', 'Whole Home'],
  ['other', 'Other'],
])

/** Design My Space room ids → the request's room ids. */
export const DESIGN_ROOM_TO_REQUEST_ROOM = Object.freeze({
  'living-room': 'living_room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  office: 'office',
})

export const DESIGN_STYLE_LABELS = labelled([
  ['contemporary', 'Contemporary'],
  ['warm', 'Warm Modern'],
  ['coastal', 'Coastal'],
  ['classic', 'Classic'],
])

export const DESIGN_LIGHTING_LABELS = labelled([
  ['day', 'Daylight'],
  ['warm', 'Warm Evening'],
  ['cool', 'Cool Ambient'],
  ['night', 'Night Accent'],
])

/** Renovation: where the work is. */
export const RENOVATION_AREA_LABELS = labelled([
  ['whole_property', 'Whole Property'],
  ['kitchen', 'Kitchen'],
  ['bathroom', 'Bathroom'],
  ['living_areas', 'Living Areas'],
  ['bedrooms', 'Bedrooms'],
  ['exterior', 'Exterior / Facade'],
  ['other', 'Other'],
])

/** Renovation: what needs doing. The first four are the Renovation page's own services. */
export const RENOVATION_WORK_LABELS = labelled([
  ['windows_doors', 'Windows & Doors'],
  ['structural', 'Structural Alterations'],
  ['electrical_lighting', 'Electrical & Lighting'],
  ['kitchen_bathroom', 'Kitchen & Bathroom Fit-out'],
  ['flooring', 'Flooring'],
  ['painting', 'Painting & Walls'],
  ['plumbing', 'Plumbing'],
  ['full_renovation', 'Full Renovation'],
])

/** Budget bands, in Turkish lira — every stored listing price is TRY. */
export const BUDGET_LABELS = labelled([
  ['under_500k', 'Under ₺500,000'],
  ['500k_1m', '₺500,000 – ₺1,000,000'],
  ['1m_2_5m', '₺1,000,000 – ₺2,500,000'],
  ['over_2_5m', 'Over ₺2,500,000'],
  ['undecided', 'Not sure yet'],
])

export const TIMELINE_LABELS = labelled([
  ['asap', 'As soon as possible'],
  ['within_3_months', 'Within 3 months'],
  ['3_6_months', 'In 3–6 months'],
  ['flexible', 'Flexible'],
])

export const SERVICE_REQUEST_LIMITS = Object.freeze({
  name: 120,
  email: 254,
  phone: 40,
  district: 80,
  notes: 2000,
  minSqm: 1,
  maxSqm: 100000,
  /** Customer photos per request (the design's own images are extra). */
  photos: 6,
  /** The JSON `payload` part of the multipart submit. */
  payloadBytes: 16 * 1024,
})

/** Client-generated, so a retried submit can never create a second request. */
export const SERVICE_REQUEST_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** Request-owned images: private, like every other customer image in the app. */
export const SERVICE_REQUEST_PHOTO_DELIVERY_TYPE = 'authenticated'

export const SERVICE_REQUEST_PHOTO_KINDS = Object.freeze(['customer', 'room_photo', 'visualization'])

/** How long an emailed staff photo link works. */
export const SERVICE_REQUEST_STAFF_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const SERVICE_REQUEST_PAGE_SIZE = 50

/**
 * The customer-facing status, derived from the linked ContactSubmission — the
 * record Varlikent staff actually work in (admin Messages → New / Replied /
 * Archived). Nothing on the request is ever updated by hand, so the two cannot
 * drift apart.
 *
 *   New      → submitted  received, not yet answered
 *   Replied  → contacted  a member of staff has responded
 *   Archived → closed     staff have filed it away
 *
 * A submission an admin has DELETED is reported as closed: it is no longer in
 * anyone's queue, and the customer should not be told it is still waiting.
 */
export const CONTACT_STATUS_TO_REQUEST_STATUS = Object.freeze({
  New: 'submitted',
  Replied: 'contacted',
  Archived: 'closed',
})

export const SERVICE_REQUEST_STATUSES = Object.freeze(['submitted', 'contacted', 'closed'])
