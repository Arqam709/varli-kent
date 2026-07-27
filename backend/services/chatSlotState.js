// backend/services/chatSlotState.js
//
// Phase 2 of the conversation-state architecture: the slot-status subsystem,
// in SHADOW MODE. Owns the "B-sparse" slot model agreed in the architecture
// review — the flat parsed/currentFilters criteria shape stays untouched, and
// a sparse `slotStatus` map records only the two states that cannot be
// derived from values:
//
//   deferred — the visitor engaged with the slot and postponed it
//              ("I'm not sure yet", "show me both and I'll decide")
//   declined — the visitor explicitly does not want to narrow by it
//              ("no preference", "anywhere is fine")
//
// `filled` (a value is present) and `empty` (no value, no status entry) are
// always DERIVED, never stored — see deriveSlotStanding. A present value
// always wins over a stale status entry (normalizeSlotStatus deletes the
// entry), so the two representations can never disagree.
//
// SHADOW MODE means: statuses are normalized, written from a few
// conservative signals, and round-tripped — but consumed by nothing. No ask/
// search policy, reply wording, Mongo filter, or route branch reads them in
// this phase. Behavior must be byte-identical to Phase 1.
//
// This module is pure: no DB, no Gemini, no Express, and no imports from
// route-level code. chatConversationMemory.js is its only production caller;
// routes/chat.js never manipulates slotStatus directly.

import { messageExpressesTypeUncertainty } from './chatMessageParsing.js'

// The four logical slots the bot actually asks visitors about. Features,
// beds/baths/sqm, lifestyle, lead flow, and district-scope pending state are
// deliberately NOT governed here (Phase 2 scope decision).
export const GOVERNED_SLOTS = ['listingType', 'propertyType', 'district', 'budget']

export const VALID_SLOT_STATUSES = ['deferred', 'declined']

// How each logical slot maps onto the existing flat criteria fields. `budget`
// is one logical slot even though the criteria store min/max separately.
export const SLOT_VALUE_FIELDS = {
  listingType: ['listingType'],
  propertyType: ['propertyType', 'propertyTypes'],
  district: ['district', 'districts'],
  budget: ['minPrice', 'maxPrice'],
}

// Same emptiness semantics as chatConversationMemory's hasValue — kept as a
// small local copy, per the established services convention (see the
// normalizeWord note in chatPropertySearch.js).
const hasValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

export const slotHasValue = (state = {}, slot) => {
  const fields = SLOT_VALUE_FIELDS[slot] || []
  return fields.some((field) => hasValue(state[field]))
}

// ─── Turn counter ──────────────────────────────────────────────────────────
export const normalizeTurn = (turn) => {
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0 || !Number.isFinite(turn)) {
    return 0
  }
  return turn
}

// ─── Normalization boundary ────────────────────────────────────────────────
// Sanitizes a client-round-tripped slotStatus map against the invariants:
// object only, governed slots only, valid statuses only, well-formed records
// only, and value-wins (a slot with a present value in `criteria` gets its
// stale status entry deleted). Never trusts client data; never mutates input.
export const normalizeSlotStatus = (rawSlotStatus, criteria = {}) => {
  const clean = {}

  if (!rawSlotStatus || typeof rawSlotStatus !== 'object' || Array.isArray(rawSlotStatus)) {
    return clean
  }

  for (const slot of GOVERNED_SLOTS) {
    const record = rawSlotStatus[slot]

    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    if (!VALID_SLOT_STATUSES.includes(record.status)) continue

    // Value wins: a present value means 'filled', so any stored status for
    // that slot is stale by definition.
    if (slotHasValue(criteria, slot)) continue

    clean[slot] = { status: record.status, turn: normalizeTurn(record.turn) }
  }

  return clean
}

// ─── Reads ─────────────────────────────────────────────────────────────────
export const getSlotStatus = (state = {}, slot) => {
  const record = state.slotStatus?.[slot]
  return record && VALID_SLOT_STATUSES.includes(record.status) ? record.status : null
}

// The derived four-way standing of a slot. `filled` and `empty` are computed
// here, never stored.
export const deriveSlotStanding = (state = {}, slot) => {
  if (slotHasValue(state, slot)) return 'filled'

  const status = getSlotStatus(state, slot)
  return status || 'empty'
}

// ─── Writes (pure — always return a new slotStatus map) ────────────────────
export const setSlotStatus = (slotStatus = {}, slot, status, turn) => {
  if (!GOVERNED_SLOTS.includes(slot) || !VALID_SLOT_STATUSES.includes(status)) {
    return { ...slotStatus }
  }

  return { ...slotStatus, [slot]: { status, turn: normalizeTurn(turn) } }
}

export const clearSlotStatus = (slotStatus = {}, slot) => {
  const next = { ...slotStatus }
  delete next[slot]
  return next
}

// ─── Value mapping helpers (pure) ──────────────────────────────────────────
const withClearedSlotValue = (state, slot) => {
  const next = { ...state }

  if (slot === 'listingType') next.listingType = null
  if (slot === 'propertyType') {
    next.propertyType = null
    next.propertyTypes = []
  }
  if (slot === 'district') {
    next.district = null
    next.districts = []
  }
  if (slot === 'budget') {
    next.minPrice = null
    next.maxPrice = null
  }

  return next
}

const withSetSlotValue = (state, slot, value) => {
  const next = { ...state }

  if (slot === 'listingType') {
    next.listingType = value
  } else if (slot === 'propertyType') {
    if (Array.isArray(value)) {
      next.propertyTypes = value
      next.propertyType = null
    } else {
      next.propertyType = value
      next.propertyTypes = []
    }
  } else if (slot === 'district') {
    if (Array.isArray(value)) {
      next.districts = value
      next.district = null
    } else {
      next.district = value
      next.districts = []
    }
  } else if (slot === 'budget') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (hasValue(value.minPrice)) next.minPrice = value.minPrice
      if (hasValue(value.maxPrice)) next.maxPrice = value.maxPrice
    }
  }

  return next
}

// ─── Authoritative transition function ─────────────────────────────────────
// Implements the agreed transition table on a flat state object (criteria +
// slotStatus). Pure — returns a new state, never mutates. Not yet called by
// the live request flow for value-changing actions (shadow mode); it exists
// now so Phases 3-5 consume a tested primitive instead of inventing one.
//
//   empty     + set(v)   -> filled(v)             (status removed)
//   empty     + defer    -> deferred
//   empty     + decline  -> declined
//   filled(a) + set(b)   -> filled(b)             (status removed)
//   filled(a) + clear    -> empty                 (status removed)
//   filled(a) + defer    -> value cleared, deferred
//   filled(a) + decline  -> value cleared, declined
//   deferred  + set(v)   -> filled(v)             (deferred removed)
//   deferred  + decline  -> declined
//   declined  + set(v)   -> filled(v)             (declined removed)
//   any       + clear    -> empty                 (status removed)
export const applySlotAction = (state = {}, { slot, action, value } = {}, turn = 0) => {
  if (!GOVERNED_SLOTS.includes(slot)) return { ...state }

  const slotStatus = state.slotStatus && typeof state.slotStatus === 'object' ? state.slotStatus : {}

  if (action === 'set') {
    // A set with no meaningful value must not silently clear the slot.
    if (!hasValue(value) && !(slot === 'budget' && value && typeof value === 'object')) {
      return { ...state }
    }

    const next = withSetSlotValue(state, slot, value)
    next.slotStatus = clearSlotStatus(slotStatus, slot)
    return next
  }

  if (action === 'clear') {
    const next = withClearedSlotValue(state, slot)
    next.slotStatus = clearSlotStatus(slotStatus, slot)
    return next
  }

  if (action === 'defer' || action === 'decline') {
    const next = withClearedSlotValue(state, slot)
    next.slotStatus = setSlotStatus(slotStatus, slot, action === 'defer' ? 'deferred' : 'declined', turn)
    return next
  }

  return { ...state }
}

// ─── Shadow-write signal detection (Phase 2 only) ──────────────────────────
// Deliberately tiny and conservative: every rule must name its target slot
// unambiguously from deterministic evidence in the CURRENT message (plus the
// structured per-turn noPreference flag). Signals with no reliable slot
// target — bare noPreference, uncertainPropertyType (known to misfire), a
// lone "no"/"anything is fine" — write nothing. Coverage grows in Phase 3+
// when pendingQuestion supplies the target; the architecture matters more
// than aggressive coverage here.
//
// The caller only records these for slots that currently have NO value, so
// shadow writes can never change a filter, a reply, or any routing decision.
const DISTRICT_ANY_PATTERNS = [
  /\bany district\b/,
  /\bany area\b/,
  /\banywhere\b/,
  /\ball districts\b/,
  /\beverywhere\b/,
]

const BUDGET_MENTION_PATTERN = /\bbudget\b|\bprice range\b/
const SALE_WORD_PATTERN = /\b(buy|buying|purchase|sale)\b/
const RENT_WORD_PATTERN = /\b(rent|renting|rental)\b/
const BOTH_PATTERN = /\bboth\b/

export const detectShadowSlotSignals = (message = '', parsedFromMessage = {}) => {
  const text = message.trim().toLowerCase()
  const signals = []

  const undecidedSignal =
    parsedFromMessage.noPreference === true || messageExpressesTypeUncertainty(message)

  // "any district" / "anywhere" — explicitly district-targeted broadening.
  if (DISTRICT_ANY_PATTERNS.some((pattern) => pattern.test(text))) {
    signals.push({ slot: 'district', status: 'declined' })
  }

  // Undecided phrasing that literally names the budget ("I don't know my
  // budget yet") — deferred, the gentler status, since wording rarely proves
  // a permanent refusal.
  if (undecidedSignal && BUDGET_MENTION_PATTERN.test(text)) {
    signals.push({ slot: 'budget', status: 'deferred' })
  }

  // Undecided-or-"both" phrasing that names BOTH listing sides ("not sure
  // whether buying or renting is better", "show both sale and rent") — the
  // captured Büyükçekmece production case.
  if (
    (undecidedSignal || BOTH_PATTERN.test(text)) &&
    SALE_WORD_PATTERN.test(text) &&
    RENT_WORD_PATTERN.test(text)
  ) {
    signals.push({ slot: 'listingType', status: 'deferred' })
  }

  return signals
}
