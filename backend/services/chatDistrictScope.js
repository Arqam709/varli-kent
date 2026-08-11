import { findConceptForWord } from '../utils/lifestyleConcepts.js'
import { detectMentionedDistricts } from './chatMessageParsing.js'
import { normalizeForMatching } from '../locales/chatParsingVocabulary.js'
import { hasMultiplePropertyTypes, pluralizePropertyType } from './chatReplyBuilder.js'
import {
  isShowMoreRequest,
  countNewStructuredCriteria,
  normalizeWord,
} from './chatConversationMemory.js'
import {
  safeLanguage,
  propertyTypeLabelForms,
  genericPropertyLabelForms,
  conceptTopicPhrase,
  joinList,
  renderDistrictScopeQuestion,
  renderDistrictScopeRetryQuestion,
  districtScopeConceptFallback,
} from './chatReplyRenderer.js'

const DISTRICT_BROADEN_PATTERNS = [
  /\banywhere\b/,
  /\bother districts?\b/,
  /\bother areas?\b/,
  /\ball districts?\b/,
  /\bany district\b/,
  /\beverywhere\b/,
]

// Narrowed keep phrases: only forms that unambiguously mean "continue in the
// current district." Bare /\bkeep\b/, /\bstay\b/ and a bare /\bthere\b/
// continuity match were REMOVED because they fire on unrelated answers —
// "keep the budget under 5M", "stay close to the metro", "there should be a
// school nearby" — which must resolve to 'unclear', not 'keep'. The retained
// forms ("keep it/this/in", "stay here/there/in", "same district", "still in")
// are the genuine district-continuity phrases the existing tests rely on.
// Natural-language / negated cases ("don't keep it there") are deliberately NOT
// solved here — districtScopeAction handles those (see the handler's tiering).
const DISTRICT_KEEP_PATTERNS = [
  /\bsame (district|area|place|location|neighbou?rhood)\b/,
  /\bkeep (it|this|that|here|there|searching|going|us|the search|the same)\b/,
  /\bkeep (it |the search )?in\b/,
  /\bstay (here|there|put|in|within|with)\b/,
  /\bstill (in|there|here)\b/,
  /^\s*yes\b/,
]


// Verifies a Gemini-parsed district against the CURRENT raw message. The parser
// returns a merged, carry-forward object, so parsedFromMessage.district /
// .districts can hold a district INHERITED from an earlier turn (see
// geminiPropertyParser.js Example 13) — its mere presence is NOT evidence that
// this turn named a new district. It only counts as a 'replace' signal when the
// district string actually appears in this message's text. normalizeForMatching
// (reused, no new normalizer) folds case / Turkish İ / Arabic diacritics, and
// simple suffix forms still match by substring ("şile'de" contains "şile").
const parsedDistrictAppearsInMessage = (message = '', parsedFromMessage = {}) => {
  const districts = [
    ...(parsedFromMessage?.district ? [parsedFromMessage.district] : []),
    ...(Array.isArray(parsedFromMessage?.districts) ? parsedFromMessage.districts : []),
  ].filter(Boolean)

  if (districts.length === 0) return false

  const normalizedMessage = normalizeForMatching(message)

  return districts.some((district) => {
    const normalizedDistrict = normalizeForMatching(district)
    return Boolean(normalizedDistrict) && normalizedMessage.includes(normalizedDistrict)
  })
}

export const resolveDistrictScopeAnswer = (message = '', parsedFromMessage = {}) => {
  if (detectMentionedDistricts(message).length > 0) return 'replace'

  const text = message.trim().toLowerCase()

  if (DISTRICT_BROADEN_PATTERNS.some((pattern) => pattern.test(text))) return 'broaden'

  // Parsed-district evidence, verified against THIS message only. Placed AFTER
  // the broaden check so an inherited/echoed district can never override an
  // explicit "anywhere / other districts" answer.
  if (parsedDistrictAppearsInMessage(message, parsedFromMessage)) return 'replace'

  if (DISTRICT_KEEP_PATTERNS.some((pattern) => pattern.test(text))) {
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

// English-only, byte-identical to the pre-Phase-3 implementation — used
// only when language === 'en', so existing callers/tests that don't pass a
// language keep getting exactly this wording.
const humanizeConceptIdsEn = (ids = []) =>
  ids.length > 0 ? ids.map((id) => id.replace(/_/g, '-')).join(' and ') : 'that'

const describeDistrictPhrase = (parsed = {}) => {
  if (parsed.district) return parsed.district
  if (Array.isArray(parsed.districts) && parsed.districts.length > 0) return parsed.districts.join(' or ')
  return null
}

// Localized type-label phrase ("apartments and villas" / "daire ve villalar" /
// "شقق وفلل"). English path stays byte-identical to before (same
// pluralizePropertyType + plain ' and ' join); tr/ar use the property-type
// label map + natural list joining instead.
const describeTypeLabel = (parsed = {}, language = 'en') => {
  if (language === 'en') {
    return hasMultiplePropertyTypes(parsed)
      ? parsed.propertyTypes.map(pluralizePropertyType).join(' and ')
      : parsed.propertyType
      ? pluralizePropertyType(parsed.propertyType)
      : 'properties'
  }

  if (hasMultiplePropertyTypes(parsed)) {
    return joinList(
      parsed.propertyTypes.map((type) => propertyTypeLabelForms(type, language)?.other).filter(Boolean),
      language,
      'and'
    )
  }

  return parsed.propertyType
    ? propertyTypeLabelForms(parsed.propertyType, language)?.other
    : genericPropertyLabelForms(language)?.other
}

// Localized concept-topic phrase ("sea-view and family" style id-derived
// text for English, unchanged; natural topic phrases — "a sea view and
// family-friendly suitability" — for tr/ar, via conceptLabels.js).
const describeConceptsPhrase = (conceptIds = [], language = 'en') => {
  if (language === 'en') return humanizeConceptIdsEn(conceptIds)

  if (conceptIds.length === 0) return districtScopeConceptFallback(language)

  const topics = conceptIds.map((id) => conceptTopicPhrase(id, language)).filter(Boolean)
  return topics.length > 0 ? joinList(topics, language, 'and') : districtScopeConceptFallback(language)
}

// Exported for the same test-isolation reason as resolveDistrictScopeAnswer
// above. `language` defaults to 'en', reproducing the exact pre-Phase-3
// English sentence when omitted.
//
// Known limitation, unchanged by this phase: resolveDistrictScopeAnswer
// (above) still only recognizes ENGLISH answer phrasing ("anywhere", "keep",
// "yes") — so a Turkish/Arabic visitor gets a localized QUESTION here but
// must still answer in a recognizable English pattern for it to be
// understood deterministically. That is deferred to a later
// dialogue-pattern phase, not solved here.
export const buildDistrictScopeQuestion = (parsed, conceptIds, language = 'en') => {
  // Normalized BEFORE the 'en' check: an unsupported language (e.g. a stray
  // 'de') must fall back to the exact English path, not accidentally take
  // the tr/ar-style natural-language branch with English concept topics.
  const normalizedLanguage = safeLanguage(language)
  const district = describeDistrictPhrase(parsed)
  const typeLabel = describeTypeLabel(parsed, normalizedLanguage)
  const concepts = describeConceptsPhrase(conceptIds, normalizedLanguage)

  if (normalizedLanguage === 'en') {
    return `Should I keep searching in ${district}, or include other districts with ${concepts} ${typeLabel}?`
  }

  return renderDistrictScopeQuestion({ district, concepts, typeLabel }, normalizedLanguage)
}

// Exported for the same test-isolation reason as resolveDistrictScopeAnswer above.
export const buildDistrictScopeRetryQuestion = (parsed, language = 'en') => {
  const normalizedLanguage = safeLanguage(language)
  const district = describeDistrictPhrase(parsed)

  if (normalizedLanguage === 'en') {
    return `Sorry, just to confirm — should I keep searching in ${district}, or search other districts too?`
  }

  return renderDistrictScopeRetryQuestion(district, normalizedLanguage)
}

export const handleDistrictScopeClarification = ({
  message,
  currentFilters,
  parsedFromMessage,
  parsed,
  newLifestyleConceptsInMessage,
  language = 'en',
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
      // Confidence-tiered resolution (only here, inside the pending
      // district-scope branch — never touches an ordinary search):
      //   T1  a clear deterministic BROADEN phrase ("anywhere", "other
      //       districts") is essentially never negated or ambiguous, so it
      //       wins outright — even over a weak or malformed Gemini action.
      //   T2  otherwise a valid, context-aware districtScopeAction decides.
      //       This is what lets Gemini CORRECT an unsafe deterministic keep or
      //       replace under negation ("don't keep it there", "kalmasın",
      //       "لا تبقَ في نفس المنطقة") — cases the deterministic layer cannot
      //       detect and must not be allowed to win.
      //   T3  only when Gemini gives nothing (unclear / outage) do we fall back
      //       to the remaining deterministic result — the narrowed keep set or
      //       an explicit district -> replace — else 'unclear' triggers retry.
      // parsedFromMessage is this turn's already-coerced parse, so no
      // stale/echoed action value can leak in.
      const deterministicAnswer = resolveDistrictScopeAnswer(message, parsedFromMessage)
      const scopeAction = ['keep', 'broaden', 'replace'].includes(parsedFromMessage?.districtScopeAction)
        ? parsedFromMessage.districtScopeAction
        : 'unclear'
      const districtAnswer =
        deterministicAnswer === 'broaden'
          ? 'broaden'
          : scopeAction !== 'unclear'
          ? scopeAction
          : deterministicAnswer

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
        const districtScopeRetryReply = buildDistrictScopeRetryQuestion(parsed, language)

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
      const districtAnswer = resolveDistrictScopeAnswer(message, parsedFromMessage)

      if (districtAnswer === 'broaden') {
        parsed.district = null
        parsed.districts = []
      } else if (districtAnswer === 'unclear') {
        const conceptIds = extractConceptIds(message)
        const districtScopeQuestionReply = buildDistrictScopeQuestion(parsed, conceptIds, language)

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
