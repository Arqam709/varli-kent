// backend/services/chatConversationMemory.js
//
// Moved verbatim out of routes/chat.js (move-only refactor — chat.js split,
// stage 5). Owns conversation-state resolution: what should be remembered,
// what should be forgotten, whether this message is a continuation, a fresh
// search, "show more", an answer to a clarification, a lifestyle-concept
// switch, or a combine.
//
// No behavior change from the original routes/chat.js code — same
// conditions, same regexes, same decision order, same field names. This
// module does not search MongoDB, build replies, generate match reasons,
// perform property search, know about Express/req/res, persist
// conversations, perform lead flow, or perform district-scope
// clarification.

import { findConceptForWord } from '../utils/lifestyleConcepts.js'
import { defaultParsed, hasSoftDescriptionSearch } from './chatMessageParsing.js'

const hasValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

// Fields that represent the visitor stating a new/changed search criterion
// in THIS message (as opposed to a plain "show me more" continuation).
const CRITERIA_FIELDS = [
  'listingType',
  'propertyType',
  'district',
  'beds',
  'baths',
  'minPrice',
  'maxPrice',
  'minSqm',
  'maxSqm',
  'furnished',
  'balcony',
  'elevator',
  'pool',
  'garden',
  'parking',
  'descriptionQuery',
]

export const messageHasNewCriteria = (parsedFromMessage = {}) => {
  const hasArrayCriteria = ['districts', 'lifestyle', 'mustHave', 'niceToHave', 'requirements'].some(
    (field) => Array.isArray(parsedFromMessage[field]) && parsedFromMessage[field].length > 0
  )

  return CRITERIA_FIELDS.some((field) => hasValue(parsedFromMessage[field])) || hasArrayCriteria
}

// Structured (non-lifestyle) fields that count toward deciding whether a
// message is a short single-slot answer ("buy", "Beylikdüzü") versus a
// fresh, self-contained structured search ("Show me apartments in
// Büyükçekmece", which states TWO things at once).
const STRUCTURED_CRITERIA_FIELDS = CRITERIA_FIELDS.filter((field) => field !== 'descriptionQuery')

// Only counts a field as "new" if it genuinely differs from what's already
// known (currentFilters) — not merely present in parsedFromMessage. Gemini
// routinely echoes back already-known scalar fields (listingType,
// propertyType) on continuation messages out of its own "carry forward
// context" instinct; treating those echoes as fresh criteria wrongly
// classified plain continuation replies ("no, show me what you have") as
// multi-field fresh searches, which then cleared preserved
// lifestyle/semantic search context that should have survived.
export const countNewStructuredCriteria = (parsedFromMessage = {}, currentFilters = {}) => {
  let count = STRUCTURED_CRITERIA_FIELDS.filter((field) => {
    const value = parsedFromMessage[field]
    return hasValue(value) && value !== currentFilters[field]
  }).length

  if (Array.isArray(parsedFromMessage.districts) && parsedFromMessage.districts.length > 0) {
    const currentDistricts = Array.isArray(currentFilters.districts) ? currentFilters.districts : []
    const sameDistricts =
      parsedFromMessage.districts.length === currentDistricts.length &&
      parsedFromMessage.districts.every((d) => currentDistricts.includes(d))

    if (!sameDistricts) count += 1
  }

  return count
}

// Detects a plain "show me more" style continuation directly from the raw
// message text. This must win over parsedFromMessage, because Gemini/keyword
// parsing tends to repeat old filters from conversation memory even when the
// visitor only asked to see more results.
const SHOW_MORE_PATTERNS = [
  /^show( me)? more( properties)?$/,
  /^show another$/,
  /^more$/,
  /^more properties$/,
  /^next$/,
  /^another$/,
  /^any more\??$/,
  /^load more$/,
]

export const isShowMoreRequest = (message = '') => {
  const text = message.trim().toLowerCase()
  return SHOW_MORE_PATTERNS.some((pattern) => pattern.test(text))
}

// Phrases that mean "yes, I still mean the same place" when the visitor
// switches Sale <-> Rent without repeating the district. Without one of
// these, a listingType change is treated as a new request (see rule 8).
const CONTINUITY_PATTERNS = [
  /same district/,
  /same area/,
  /same place/,
  /same location/,
  /\bthere\b/,
  /still in/,
  /keep (it |the search )?in/,
]

export const hasExplicitContinuityPhrase = (message = '') => {
  const text = message.trim().toLowerCase()
  return CONTINUITY_PATTERNS.some((pattern) => pattern.test(text))
}

// Feature toggles that a stale search may have left active.
const FEATURE_FIELDS = ['furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking']

// Phrases that mean "yes, keep applying my earlier feature requirements" when
// a new lifestyle/description-style message doesn't repeat them itself.
const FEATURE_CONTINUITY_PATTERNS = [
  /same requirements/,
  /same features/,
  /same criteria/,
  /also with/,
  /also have/,
  /also need/,
  /still (need|want|require)/,
  /keep the same/,
  /\bkeep\b/,
]

const hasFeatureContinuityPhrase = (message = '') => {
  const text = message.trim().toLowerCase()
  return FEATURE_CONTINUITY_PATTERNS.some((pattern) => pattern.test(text))
}

const mergeParsedWithContext = (currentFilters = {}, newParsed = {}) => {
  const merged = {
    ...defaultParsed,
    ...currentFilters,
  }

  const fieldsToMerge = [
    'intent',
    'intentType',
'replyType',
'nextQuestion',
    'searchMode',
  'descriptionQuery',
    'listingType',
    'propertyType',
    'district',
    'beds',
    'baths',
    'minPrice',
    'maxPrice',
    'minSqm',
    'maxSqm',
    'furnished',
    'balcony',
    'elevator',
    'pool',
    'garden',
    'parking',
  ]

  for (const field of fieldsToMerge) {
    if (hasValue(newParsed[field])) {
      merged[field] = newParsed[field]
    }
  }

  // If user gives multiple districts, use districts[] and clear single district
  if (Array.isArray(newParsed.districts) && newParsed.districts.length > 0) {
    merged.districts = newParsed.districts
    merged.district = null
  }

  // Same pattern for property type: multiple/uncertain types use
  // propertyTypes[] and clear the single propertyType. A genuine single-type
  // statement ("actually just apartment") clears any remembered ambiguity.
  if (Array.isArray(newParsed.propertyTypes) && newParsed.propertyTypes.length > 0) {
    merged.propertyTypes = newParsed.propertyTypes
    merged.propertyType = null
  } else if (hasValue(newParsed.propertyType)) {
    merged.propertyTypes = []
  }

  // Keep previous arrays unless Gemini gives new meaningful arrays
  merged.mustHave =
    Array.isArray(newParsed.mustHave) && newParsed.mustHave.length > 0
      ? newParsed.mustHave
      : merged.mustHave || []

  merged.niceToHave =
    Array.isArray(newParsed.niceToHave) && newParsed.niceToHave.length > 0
      ? newParsed.niceToHave
      : merged.niceToHave || []

  merged.lifestyle =
    Array.isArray(newParsed.lifestyle) && newParsed.lifestyle.length > 0
      ? newParsed.lifestyle
      : merged.lifestyle || []

  merged.requirements =
    Array.isArray(newParsed.requirements) && newParsed.requirements.length > 0
      ? newParsed.requirements
      : merged.requirements || []

  // Do not blindly trust Gemini clarification after we already have memory.
  // We will decide missing info ourselves.
  merged.needsClarification = false
  merged.clarifyingQuestion = null

  return merged
}

export const normalizeWord = (word = '') => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Prefer Gemini's short, tagged lifestyle/requirement phrases — they stay
// close to what the visitor actually said. Only fall back to the broader
// descriptionQuery (which Gemini tends to pad with loosely-related
// synonyms) when nothing more specific was tagged at all.
const getConceptSourcePhrases = (parsed = {}) => {
  const taggedPhrases = [
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ]

  if (taggedPhrases.length > 0) return taggedPhrases

  return parsed.descriptionQuery ? [parsed.descriptionQuery] : []
}

// Words/phrases that mean "yes, combine this with what I already asked for"
// when a NEW lifestyle concept appears alongside an OLD one already active in
// memory. Without one of these, a new concept REPLACES the old one instead
// of stacking on top of it (see isLifestyleConceptSwitch in the main route).
const LIFESTYLE_COMBINE_PATTERNS = [
  /\balso\b/,
  /\bsame requirements\b/,
  /\bsame criteria\b/,
  /\bsame features\b/,
  /\bboth\b/,
  /\bplus\b/,
  /\bkeep the same\b/,
  /\btoo\b/,
  /\bas well\b/,
  /\band\b/,
]

const hasLifestyleCombinePhrase = (message = '') => {
  const text = message.trim().toLowerCase()
  return LIFESTYLE_COMBINE_PATTERNS.some((pattern) => pattern.test(text))
}

// Phrases that mean "I don't have a preference, just show me what's
// available" when answering a district/budget-style follow-up. These must
// never be read as a fresh search or as a semantic search query — the
// query always comes from `parsed` (see buildSemanticSearchQuery), never
// the raw message text, so a "no preference" reply can't accidentally
// become the thing being searched for.
const NO_PREFERENCE_PATTERNS = [
  /\bno preference\b/,
  /\bany area\b/,
  /\bany district\b/,
  /\bno particular\b/,
  /^\s*no\b/,
  /\bshow me what you have\b/,
  /\bwhatever you have\b/,
  /\bdon'?t have (a )?preference\b/,
  /\bnot sure\b/,
]

const isNoPreferenceAnswer = (message = '') => {
  const text = message.trim().toLowerCase()
  return NO_PREFERENCE_PATTERNS.some((pattern) => pattern.test(text))
}

// A short answer to a pending clarifying question ("buy", "Beylikdüzü",
// "under 5 million", "no district yet") introduces no lifestyle concept of
// its own and states at most one new structured detail. A message stating
// two or more structured details at once ("Show me apartments in
// Büyükçekmece") is a fresh, self-contained search instead. An explicit
// continuity phrase ("same requirements in Kadıköy") or a "no preference"
// answer always counts as a slot answer regardless of how many fields
// parsedFromMessage happens to restate.
const isShortSlotAnswer = (message = '', parsedFromMessage = {}, currentFilters = {}, newLifestyleConceptsCount = 0) => {
  if (newLifestyleConceptsCount > 0) return false
  if (hasLifestyleCombinePhrase(message)) return true
  if (isNoPreferenceAnswer(message)) return true
  return countNewStructuredCriteria(parsedFromMessage, currentFilters) <= 1
}

// Detects which known lifestyle concepts are literally invoked by a piece of
// text. Used on the VISITOR'S OWN raw message text (not Gemini's parsed
// output), so it stays reliable even if Gemini blends an old concept into
// this turn's JSON on its own initiative.
const detectConceptsInText = (text = '') => {
  const concepts = new Set()

  text
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeWord)
    .forEach((word) => {
      const concept = findConceptForWord(word)
      if (concept) concepts.add(concept.name)
    })

  return concepts
}

const phraseConceptNames = (phrase = '') => {
  return phrase
    .split(/\s+/)
    .map(normalizeWord)
    .map(findConceptForWord)
    .filter(Boolean)
    .map((concept) => concept.name)
}

// Drops phrases that are entirely about a concept the visitor is moving away
// from. A phrase that also touches a still-relevant concept is kept, and any
// phrase this dictionary can't classify is left untouched (safe default).
const dropConceptsFromPhrases = (phrases = [], conceptsToDrop) => {
  if (!Array.isArray(phrases) || !conceptsToDrop || conceptsToDrop.size === 0) return phrases || []

  return phrases.filter((phrase) => {
    const names = phraseConceptNames(phrase)
    if (names.length === 0) return true
    return !names.every((name) => conceptsToDrop.has(name))
  })
}

// ─── Conversation-state resolution wrapper ────────────────────────────────
// Extraction of the inline sequence that used to live directly in
// routes/chat.js's route handler, copied exactly, in the exact same order:
//   merge previous memory -> fresh-description reset -> listingType-switch
//   reset -> fresh-lifestyle feature reset -> concept detection -> slot-
//   answer/concept-switch/concept-combine resolution.
// Do not reorder these steps — later steps depend on `parsed` as mutated by
// earlier ones, and the ordering encodes specific, deliberately-chosen
// precedence rules (see the inline comments below, preserved exactly).
//
// Returns only what routes/chat.js's remaining code (district-scope
// clarification, in particular) still reads afterward:
// `newLifestyleConceptsInMessage` is referenced by the district-scope
// clarification trigger check once this call returns. Every other
// intermediate (oldLifestyleConcepts, conceptsToDrop, isSlotFillingAnswer,
// isLifestyleConceptSwitch, shouldCombineLifestyle, isFreshLifestyleMessage,
// listingTypeChanged, messageRepeatsOldCriteria) is purely internal to this
// resolution and was never read again after it in the original code either.
export const resolveConversationState = ({ message, currentFilters, parsedFromMessage }) => {
  // 4. Merge previous search memory with the latest message
  let parsed = mergeParsedWithContext(currentFilters, parsedFromMessage)
  // If Gemini clearly says this is a fresh description search,
  // do not allow old frontend filters like "Villa" to accidentally narrow it.
  if (
    parsedFromMessage.searchMode === 'description' &&
    parsedFromMessage.descriptionQuery &&
    !parsedFromMessage.listingType &&
    !parsedFromMessage.propertyType &&
    (!Array.isArray(parsedFromMessage.propertyTypes) || parsedFromMessage.propertyTypes.length === 0) &&
    !parsedFromMessage.district &&
    (!Array.isArray(parsedFromMessage.districts) || parsedFromMessage.districts.length === 0)
  ) {
    parsed.listingType = null
    parsed.propertyType = null
    parsed.propertyTypes = []
    parsed.district = null
    parsed.districts = []
    parsed.beds = null
    parsed.baths = null
    parsed.minPrice = null
    parsed.maxPrice = null
    parsed.minSqm = null
    parsed.maxSqm = null
    parsed.furnished = null
    parsed.balcony = null
    parsed.elevator = null
    parsed.pool = null
    parsed.garden = null
    parsed.parking = null
  }

  // If the visitor switches listingType (Sale <-> Rent) — a major intent
  // change — without repeating the district/property type or signaling they
  // want the same area ("same district", "there", etc.), do not blindly keep
  // the old district/propertyType forever. Treat it as a fresh search in the
  // new listingType instead (rule 8).
  const listingTypeChanged =
    Boolean(currentFilters.listingType) &&
    Boolean(parsedFromMessage.listingType) &&
    currentFilters.listingType !== parsedFromMessage.listingType

  const messageRepeatsOldCriteria =
    hasValue(parsedFromMessage.district) ||
    (Array.isArray(parsedFromMessage.districts) && parsedFromMessage.districts.length > 0) ||
    hasValue(parsedFromMessage.propertyType) ||
    (Array.isArray(parsedFromMessage.propertyTypes) && parsedFromMessage.propertyTypes.length > 0) ||
    hasExplicitContinuityPhrase(message)

  if (listingTypeChanged && !messageRepeatsOldCriteria) {
    parsed.district = null
    parsed.districts = []
    parsed.propertyType = null
    parsed.propertyTypes = []
  }

  // If this message is a genuine lifestyle/description-style search (e.g.
  // "near a school"), it's a new angle on the conversation, not a request to
  // keep enforcing every earlier feature toggle forever. Clear only the
  // feature fields this message did NOT itself restate, and only if the
  // visitor didn't ask to keep them ("same requirements", "also with", etc.).
  // listingType/propertyType/district are untouched here — they already have
  // their own reset rules above.
  const isFreshLifestyleMessage = !isShowMoreRequest(message) && hasSoftDescriptionSearch(parsedFromMessage)

  if (isFreshLifestyleMessage && !hasFeatureContinuityPhrase(message)) {
    FEATURE_FIELDS.forEach((field) => {
      if (!hasValue(parsedFromMessage[field])) {
        parsed[field] = null
      }
    })
  }

  // Concepts (school, seaView, metroTransport, ...) detected directly from the
  // raw message text — used below to decide whether a new lifestyle concept
  // should REPLACE or COMBINE WITH whatever concept is already active in
  // currentFilters, and whether this message is a short slot answer at all.
  // Detected from raw text, not Gemini's parse, so this stays reliable even
  // if Gemini blends old + new concepts together on its own, or fails to tag
  // a concept it should have.
  const oldLifestyleConcepts = detectConceptsInText(getConceptSourcePhrases(currentFilters).join(' '))
  const newLifestyleConceptsInMessage = detectConceptsInText(message)
  const conceptsToDrop = new Set(
    [...oldLifestyleConcepts].filter((concept) => !newLifestyleConceptsInMessage.has(concept))
  )

  // General pending-search memory: a short slot-filling answer ("buy",
  // "apartment", a district name, a budget number, "same requirements in
  // Kadıköy") is very likely completing a PENDING request rather than
  // starting a fresh one — restore the previously gathered lifestyle from
  // memory. A message stating multiple new structured details at once ("Show
  // me apartments in Büyükçekmece") is a fresh, self-contained search
  // instead, and should NOT inherit stale lifestyle content just because it
  // didn't repeat it.
  const isSlotFillingAnswer = isShortSlotAnswer(message, parsedFromMessage, currentFilters, newLifestyleConceptsInMessage.size)

  const isLifestyleConceptSwitch =
    newLifestyleConceptsInMessage.size > 0 &&
    conceptsToDrop.size > 0 &&
    !hasLifestyleCombinePhrase(message)

  const shouldCombineLifestyle =
    newLifestyleConceptsInMessage.size > 0 && hasLifestyleCombinePhrase(message)

  if (isSlotFillingAnswer && hasSoftDescriptionSearch(currentFilters)) {
    // Slot-filling answer — nothing new about lifestyle was said, so fully
    // restore the pending lifestyle/description criteria from memory.
    parsed.lifestyle = Array.isArray(currentFilters.lifestyle) ? currentFilters.lifestyle : []
    parsed.mustHave = Array.isArray(currentFilters.mustHave) ? currentFilters.mustHave : []
    parsed.niceToHave = Array.isArray(currentFilters.niceToHave) ? currentFilters.niceToHave : []
    parsed.requirements = Array.isArray(currentFilters.requirements) ? currentFilters.requirements : []
    parsed.descriptionQuery = currentFilters.descriptionQuery || null
    parsed.searchMode = currentFilters.searchMode || parsed.searchMode
  } else if (isLifestyleConceptSwitch) {
    // A genuinely different lifestyle concept was named with no combine
    // phrase — replace the old concept's content rather than stacking onto it
    // (e.g. "near school" -> "what about sea view apartment").
    parsed.lifestyle = dropConceptsFromPhrases(parsed.lifestyle, conceptsToDrop)
    parsed.mustHave = dropConceptsFromPhrases(parsed.mustHave, conceptsToDrop)
    parsed.niceToHave = dropConceptsFromPhrases(parsed.niceToHave, conceptsToDrop)
    parsed.requirements = dropConceptsFromPhrases(parsed.requirements, conceptsToDrop)
    // Let the $text query regenerate from the now-filtered arrays (or the
    // current message) instead of keeping the old, now-stale free-text phrase.
    parsed.descriptionQuery = null
  } else if (shouldCombineLifestyle) {
    // An explicit combine phrase was used ("also", "same requirements",
    // "both", "plus", "too", "and", ...) — union old + new rather than
    // trusting either Gemini's array or the plain merge alone.
    const unionArrays = (a, b) => Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]))

    parsed.lifestyle = unionArrays(currentFilters.lifestyle, parsedFromMessage.lifestyle)
    parsed.mustHave = unionArrays(currentFilters.mustHave, parsedFromMessage.mustHave)
    parsed.niceToHave = unionArrays(currentFilters.niceToHave, parsedFromMessage.niceToHave)
    parsed.requirements = unionArrays(currentFilters.requirements, parsedFromMessage.requirements)
    parsed.descriptionQuery =
      [currentFilters.descriptionQuery, parsedFromMessage.descriptionQuery].filter(Boolean).join(' ') ||
      parsed.descriptionQuery
  } else if (!isSlotFillingAnswer && newLifestyleConceptsInMessage.size === 0 && hasSoftDescriptionSearch(currentFilters)) {
    // A fresh, self-contained structured search (multiple new structured
    // details, no lifestyle concept of its own, no continuity phrase) —
    // clear stale lifestyle memory instead of silently carrying it forward
    // via the default merge's "keep old if new is empty" behavior.
    parsed.lifestyle = []
    parsed.mustHave = []
    parsed.niceToHave = []
    parsed.requirements = []
    parsed.descriptionQuery = null
  }

  return { parsed, newLifestyleConceptsInMessage }
}
