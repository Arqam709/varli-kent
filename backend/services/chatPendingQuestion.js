// backend/services/chatPendingQuestion.js
//
// Phase 3 of the conversation-state architecture: the generic pendingQuestion
// mechanism for ORDINARY property-search questions ("buy or rent?", "district
// or budget?"). Owns normalization, creation, expiry, and the conservative
// interpretation of the visitor's next message relative to the slots the bot
// actually asked about.
//
// Durable shape (null when nothing is pending):
//
//   pendingQuestion: {
//     type: 'slot_question',
//     slots: ['listingType', 'budget'],   // governed slots only, deduped
//     askedAtTurn: 3,
//     retryCount: 0
//   }
//
// Deliberately NOT handled here: district-scope clarification
// (pendingClarification, chatDistrictScope.js) and lead capture (pendingLead,
// chatLeadFlow.js) stay separate, with their existing route precedence.
// This module contains no HTTP handling and no reply text.
//
// Phase 3 records and resolves pending questions but does NOT change the
// ask-vs-search policy: interpretation writes slot values/statuses through
// applySlotAction only for slots that are already valueless, so no Mongo
// filter, reply, or routing decision changes. Policy consumption is Phase 4.

import {
  GOVERNED_SLOTS,
  normalizeTurn,
  slotHasValue,
  applySlotAction,
} from './chatSlotState.js'
import { messageExpressesTypeUncertainty } from './chatMessageParsing.js'

export const PENDING_QUESTION_TYPE = 'slot_question'

// A pending question older than this many turns is a zombie: the visitor has
// moved on, and letting it keep anchoring interpretation would misread
// unrelated messages. Expired silently at the normalization boundary.
export const PENDING_QUESTION_MAX_AGE_TURNS = 3

// ─── Normalization boundary ────────────────────────────────────────────────
// Sanitizes a client-round-tripped pendingQuestion. Malformed shapes, wrong
// type, empty/unknown/duplicate slots, bogus turns, and expired questions all
// normalize to null. Rebuilt from scratch — unknown extra keys never survive,
// and the input object is never mutated.
export const normalizePendingQuestion = (raw, currentTurn = 0) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.type !== PENDING_QUESTION_TYPE) return null
  if (!Array.isArray(raw.slots)) return null

  const slots = [...new Set(raw.slots.filter((slot) => GOVERNED_SLOTS.includes(slot)))]
  if (slots.length === 0) return null

  const askedAtTurn = normalizeTurn(raw.askedAtTurn)
  const turn = normalizeTurn(currentTurn)

  // A question "asked" in the future is hostile/corrupt state, not a question.
  if (askedAtTurn > turn) return null

  if (turn - askedAtTurn > PENDING_QUESTION_MAX_AGE_TURNS) return null

  return {
    type: PENDING_QUESTION_TYPE,
    slots,
    askedAtTurn,
    retryCount: normalizeTurn(raw.retryCount),
  }
}

// ─── Creation ──────────────────────────────────────────────────────────────
export const createPendingQuestion = (slots = [], turn = 0) => {
  const clean = [...new Set(slots.filter((slot) => GOVERNED_SLOTS.includes(slot)))]
  if (clean.length === 0) return null

  return {
    type: PENDING_QUESTION_TYPE,
    slots: clean,
    askedAtTurn: normalizeTurn(turn),
    retryCount: 0,
  }
}

const sameSlotSet = (a = [], b = []) =>
  a.length === b.length && a.every((slot) => b.includes(slot))

// Used at every question-emission point. Re-asking the same slot set while
// that question is still pending is a retry: retryCount increments and
// askedAtTurn refreshes (expiry should measure from the latest actual ask).
// A different slot set is a fresh question, retryCount 0. Nothing consumes
// retryCount yet — Phase 4's policy will use it to stop re-asking.
export const createOrRetryPendingQuestion = (existing, slots, turn) => {
  const fresh = createPendingQuestion(slots, turn)
  if (!fresh) return existing || null

  if (existing && sameSlotSet(existing.slots, fresh.slots)) {
    return { ...fresh, retryCount: normalizeTurn(existing.retryCount) + 1 }
  }

  return fresh
}

// ─── Gemini ask_question slot derivation ───────────────────────────────────
// Gemini returns only prose (nextQuestion) — the schema does not state which
// slots it asked about, and changing the schema is out of scope this phase.
// So only HIGH-CONFIDENCE known question patterns are mapped (the prompt
// itself scripts "Are you looking to buy or rent?" and "Do you have a
// preferred district or budget?"), intersected with slots that are actually
// valueless. Unrecognized prose creates NO pendingQuestion — an honest
// limitation, preferred over guessing targets from arbitrary English.
const GEMINI_QUESTION_SLOT_PATTERNS = [
  ['listingType', /buy or rent|looking to buy|buy, rent/],
  ['propertyType', /type of property|property type|what type/],
  ['district', /district|area|location/],
  ['budget', /budget|price range/],
]

export const deriveGeminiQuestionSlots = (questionText = '', state = {}) => {
  const text = String(questionText || '').toLowerCase()

  return GEMINI_QUESTION_SLOT_PATTERNS.filter(([, pattern]) => pattern.test(text))
    .map(([slot]) => slot)
    .filter((slot) => !slotHasValue(state, slot))
}

// ─── Answer interpretation ─────────────────────────────────────────────────
// Conservative deterministic phrase sets. The pending question supplies the
// TARGET, which is what makes these safe: without a pending target, none of
// these phrases changes any state (that stays the job of the narrower Phase 2
// shadow signals).
//
// Product decision, per the agreed architecture: explicit-decline language
// ("no preference", "doesn't matter") -> declined (stop asking); mere
// uncertainty ("not sure", "maybe later") -> deferred (may re-offer). When a
// message carries both, decline wins — an explicit statement beats a hedge.
const DECLINE_PATTERNS = [
  /\bno preference\b/,
  /\bdoesn'?t matter\b/,
  /\bdon'?t (really )?care\b/,
  /\banything is fine\b/,
  /\banywhere is fine\b/,
  /\bany district\b/,
  /\bany area\b/,
  /\bany budget\b/,
  /\bany price\b/,
]

const DEFER_PATTERNS = [
  /\bmaybe later\b/,
  /\bdecide later\b/,
  /\bchoose later\b/,
  /\bnot yet\b/,
  /\bhaven'?t decided\b/,
]

// When a vague answer names one of the pending slots ("I don't know my
// BUDGET"), the signal is scoped to the named slot(s) only; when it names
// none ("I'm not sure yet"), it applies to every still-unaddressed pending
// slot. This is what lets "Rent, but I don't know my budget" defer budget
// without touching anything else.
const SLOT_MENTION_PATTERNS = {
  listingType: /\b(buy|buying|purchase|sale|rent|renting|rental)\b/,
  propertyType: /\b(property type|type of property|\btype\b)\b/,
  district: /\b(district|area|location|neighborhood)\b/,
  budget: /\b(budget|price)\b/,
}

// Intents that mean "this message is not an answer to the pending question".
// The pending question survives untouched, with no retry increment — a
// casual interruption is neither an answer nor an abandonment.
const NON_ANSWER_INTENT_TYPES = [
  'casual_chat',
  'emotional_message',
  'contact_request',
  'website_service_question',
  'unknown',
]

// Resolves the current message against an active pending question.
// Returns { state, pendingQuestion } — new objects, inputs never mutated.
//
// `isShowMore` and `newCriteriaCount` are computed by the caller
// (chatConversationMemory.js) with its own helpers, passed in rather than
// imported here to avoid a service cycle.
//
// Rules, in order:
//   1. show-more requests are never pending answers (pending survives);
//   2. non-property intents are interruptions (pending survives, no retry);
//   3. per pending slot: explicit value (already merged into state) wins,
//      then decline-signal -> declined, then defer-signal -> deferred,
//      else the slot stays pending;
//   4. if nothing pending was addressed but the message introduced new
//      criteria elsewhere, the visitor changed direction: abandon silently
//      (same rule district-scope's looksLikeAbandonment already uses);
//   5. all slots addressed -> pending null; some -> pending shrinks, keeping
//      the ORIGINAL askedAtTurn and retryCount (expiry measures from the
//      actual ask; a partial answer is progress, not a re-ask).
export const resolvePendingAnswer = ({
  pendingQuestion,
  state,
  message = '',
  parsedFromMessage = {},
  isShowMore = false,
  newCriteriaCount = 0,
}) => {
  if (!pendingQuestion) return { state, pendingQuestion: null }
  if (isShowMore) return { state, pendingQuestion }
  if (NON_ANSWER_INTENT_TYPES.includes(parsedFromMessage.intentType)) {
    return { state, pendingQuestion }
  }

  const text = message.trim().toLowerCase()

  const declineSignal =
    parsedFromMessage.noPreference === true || DECLINE_PATTERNS.some((pattern) => pattern.test(text))
  const deferSignal =
    messageExpressesTypeUncertainty(message) || DEFER_PATTERNS.some((pattern) => pattern.test(text))

  const mentionedSlots = pendingQuestion.slots.filter((slot) =>
    SLOT_MENTION_PATTERNS[slot]?.test(text)
  )
  const vagueTargets = mentionedSlots.length > 0 ? mentionedSlots : pendingQuestion.slots

  let nextState = state
  const remaining = []
  let addressedCount = 0

  for (const slot of pendingQuestion.slots) {
    // Explicit value beats everything — including vague negative language in
    // the same message ("No, I want to rent" sets Rent; the "No" is noise).
    if (slotHasValue(nextState, slot)) {
      addressedCount += 1
      continue
    }

    const isVagueTarget = vagueTargets.includes(slot)

    if (isVagueTarget && declineSignal) {
      nextState = applySlotAction(nextState, { slot, action: 'decline' }, nextState.turn)
      addressedCount += 1
      continue
    }

    if (isVagueTarget && deferSignal) {
      nextState = applySlotAction(nextState, { slot, action: 'defer' }, nextState.turn)
      addressedCount += 1
      continue
    }

    remaining.push(slot)
  }

  if (remaining.length === 0) {
    return { state: nextState, pendingQuestion: null }
  }

  // Changed direction: new criteria elsewhere, nothing pending addressed.
  if (addressedCount === 0 && newCriteriaCount >= 1) {
    return { state: nextState, pendingQuestion: null }
  }

  if (remaining.length === pendingQuestion.slots.length) {
    return { state: nextState, pendingQuestion }
  }

  return {
    state: nextState,
    pendingQuestion: { ...pendingQuestion, slots: remaining },
  }
}
