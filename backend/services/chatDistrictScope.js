// backend/services/chatDistrictScope.js
//
// Moved verbatim out of routes/chat.js (move-only refactor — chat.js split,
// stage 6). Owns the district-scope clarification mini-dialogue: when a
// lifestyle pivot ("my wife wants sea view") arrives while an old,
// unconfirmed district is still active from an earlier turn, ask once
// whether to keep that district or broaden — instead of silently keeping it
// (which can hide a better-fitting property in another district) or
// silently clearing it (which would drop a district the visitor never asked
// to abandon).
//
// propertyType/listingType are deliberately NOT handled here: an explicit
// restatement ("villa with sea view") already overwrites them correctly via
// the normal merge in mergeParsedWithContext (chatConversationMemory.js),
// and when not restated, keeping them silently is exactly the wanted
// behavior — there's no "silently wrong" failure mode for those two fields
// the way there is for district, so they don't need a clarification step.
//
// No behavior change from the original routes/chat.js code — same
// conditions, same regexes, same branch order, same pendingClarification
// shape, same wording. This module does not parse the full user message,
// manage general conversation memory, run property searches, build Mongo
// filters, build normal search-result replies, handle lead capture, persist
// messages, know about Express/req/res, or return HTTP responses.

import { findConceptForWord } from '../utils/lifestyleConcepts.js'
import { detectMentionedDistricts } from './chatMessageParsing.js'
import { hasMultiplePropertyTypes, pluralizePropertyType } from './chatReplyBuilder.js'
import {
  isShowMoreRequest,
  countNewStructuredCriteria,
  hasExplicitContinuityPhrase,
  normalizeWord,
} from './chatConversationMemory.js'

const DISTRICT_BROADEN_PATTERNS = [
  /\banywhere\b/,
  /\bother districts?\b/,
  /\bother areas?\b/,
  /\ball districts?\b/,
  /\bany district\b/,
  /\beverywhere\b/,
]

const DISTRICT_KEEP_PATTERNS = [/\bkeep\b/, /\bstay\b/, /^\s*yes\b/]

// Classifies what a message says about the currently-active district:
// - 'replace': names a specific new district (that new value wins outright,
//   already applied by the normal merge above — nothing extra to do here)
// - 'broaden': wants the district restriction dropped ("anywhere", "other districts")
// - 'keep': explicit continuity/confirmation ("same district", "keep", "yes")
// - 'unclear': says nothing decisive about district either way
// Shared by both the first-time trigger check and answers to a pending
// clarification, so "what counts as an answer" is defined in exactly one place.
// Exported (though chat.js never imports it directly — only
// handleDistrictScopeClarification below calls it) so it can be
// characterization-tested directly, in isolation.
export const resolveDistrictScopeAnswer = (message = '') => {
  if (detectMentionedDistricts(message).length > 0) return 'replace'

  const text = message.trim().toLowerCase()

  if (DISTRICT_BROADEN_PATTERNS.some((pattern) => pattern.test(text))) return 'broaden'
  if (hasExplicitContinuityPhrase(message) || DISTRICT_KEEP_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'keep'
  }

  return 'unclear'
}

// Canonical concept ids (e.g. "sea_view") mentioned anywhere in a piece of
// text — general-purpose enough to run on a raw message (for the district
// clarification question below) or on parsed query content / property text
// (for the match-reason lifestyle labeling further down).
// Exported for the same test-isolation reason as resolveDistrictScopeAnswer above.
export const extractConceptIds = (text = '') => {
  const ids = new Set()

  text
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeWord)
    .forEach((word) => {
      const concept = findConceptForWord(word)
      if (concept) ids.add(concept.id)
    })

  return Array.from(ids)
}

const humanizeConceptIds = (ids = []) =>
  ids.length > 0 ? ids.map((id) => id.replace(/_/g, '-')).join(' and ') : 'that'

const describeDistrictPhrase = (parsed = {}) => {
  if (parsed.district) return parsed.district
  if (Array.isArray(parsed.districts) && parsed.districts.length > 0) return parsed.districts.join(' or ')
  return null
}

// Exported for the same test-isolation reason as resolveDistrictScopeAnswer above.
export const buildDistrictScopeQuestion = (parsed, conceptIds) => {
  const district = describeDistrictPhrase(parsed)
  const typeLabel = hasMultiplePropertyTypes(parsed)
    ? parsed.propertyTypes.map(pluralizePropertyType).join(' and ')
    : parsed.propertyType
    ? pluralizePropertyType(parsed.propertyType)
    : 'properties'

  return `Should I keep searching in ${district}, or include other districts with ${humanizeConceptIds(conceptIds)} ${typeLabel}?`
}

// Exported for the same test-isolation reason as resolveDistrictScopeAnswer above.
export const buildDistrictScopeRetryQuestion = (parsed) => {
  const district = describeDistrictPhrase(parsed)
  return `Sorry, just to confirm — should I keep searching in ${district}, or search other districts too?`
}

// ─── Wrapper ───────────────────────────────────────────────────────────────
// Extraction of the inline sequence that used to live directly in
// routes/chat.js's route handler, copied exactly, same branch order: resolve
// a pending clarification from a prior turn, or ask a new one if this
// message just introduced a lifestyle concept while an old, unconfirmed
// district is still active.
//
// Mirrors handleLeadFlow's contract shape ({ handled, ... }) — the closest
// existing architectural analog, since this is likewise a self-contained
// conversational sub-flow that may or may not produce an early-return reply.
//
// chat.js still owns recordChatExchange() and res.json() — this function
// only decides. `pendingClarification` in the return is deliberately kept
// separate from `parsed.pendingClarification`: the original inline code only
// ever spread a *new* pendingClarification into the JSON response object
// (`{...parsed, pendingClarification: {...}}`) without mutating `parsed`
// itself in the two "ask/retry" branches — persistence used the plain
// `parsed` while the HTTP response used the spread-with-override version.
// That is preserved exactly by returning them separately and leaving it to
// the caller to compose the response the same way the original code did.
export const handleDistrictScopeClarification = ({
  message,
  currentFilters,
  parsedFromMessage,
  parsed,
  newLifestyleConceptsInMessage,
}) => {
  const existingScopeClarification =
    currentFilters?.pendingClarification?.type === 'lifestyle_scope'
      ? currentFilters.pendingClarification
      : null

  if (existingScopeClarification) {
    const looksLikeAbandonment =
      isShowMoreRequest(message) ||
      countNewStructuredCriteria(parsedFromMessage, currentFilters) >= 2 ||
      parsedFromMessage.intentType === 'contact_request'

    if (looksLikeAbandonment) {
      // Not an answer to the clarification — drop it silently and let the
      // message fall through to its own normal handling (show-more, a fresh
      // multi-field search, or the lead flow).
      parsed.pendingClarification = null
    } else {
      const districtAnswer = resolveDistrictScopeAnswer(message)

      if (districtAnswer === 'broaden') {
        parsed.district = null
        parsed.districts = []
        parsed.pendingClarification = null
      } else if (districtAnswer === 'keep' || districtAnswer === 'replace') {
        // 'keep': parsed.district already holds the old value.
        // 'replace': parsed.district already holds the new value from the
        // normal merge above. Either way, nothing left to apply here.
        parsed.pendingClarification = null
      } else if (existingScopeClarification.retryCount >= 1) {
        // Already retried once — stop asking and fall back to the safest
        // default (keep) rather than asking a third time.
        parsed.pendingClarification = null
      } else {
        const districtScopeRetryReply = buildDistrictScopeRetryQuestion(parsed)

        return {
          handled: true,
          parsed,
          reply: districtScopeRetryReply,
          event: 'clarification_requested',
          pendingClarification: {
            ...existingScopeClarification,
            retryCount: existingScopeClarification.retryCount + 1,
          },
        }
      }
    }
  } else if (!isShowMoreRequest(message) && newLifestyleConceptsInMessage.size > 0) {
    const hasOldDistrict = Boolean(parsed.district) || (Array.isArray(parsed.districts) && parsed.districts.length > 0)

    if (hasOldDistrict) {
      const districtAnswer = resolveDistrictScopeAnswer(message)

      if (districtAnswer === 'broaden') {
        parsed.district = null
        parsed.districts = []
      } else if (districtAnswer === 'unclear') {
        const conceptIds = extractConceptIds(message)
        const districtScopeQuestionReply = buildDistrictScopeQuestion(parsed, conceptIds)

        return {
          handled: true,
          parsed,
          reply: districtScopeQuestionReply,
          event: 'clarification_requested',
          pendingClarification: {
            type: 'lifestyle_scope',
            unresolvedFields: ['district'],
            lifestyleConcepts: conceptIds,
            retryCount: 0,
          },
        }
      }
      // 'replace' and 'keep' need no action — parsed.district already correct.
    }
  }

  return { handled: false, parsed, reply: null, event: null, pendingClarification: null }
}
