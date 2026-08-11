// backend/services/descriptionEvidence.js
//
// Pure, deterministic lexical evidence layer for description search. No DB,
// no Gemini, no HTTP, no rendering. Replaces the previous "any one token
// overlapped -> whole requirement verified" check (getRelevanceCheckTerms +
// propertyMatchesSignificantTerm) with NORMALIZED EVIDENCE UNITS and
// COVERAGE-based verification.
//
// The old failure: "rooftop cinema" verified against "rooftop terrace"
// because a single token ("rooftop") overlapped; "suitable for a music
// studio" verified against "suitable for first-time buyers" via "suitable".
// One matching token was treated as proof of the entire requirement.
//
// The model here:
//   - A requirement is decomposed into EVIDENCE UNITS, each unit = one facet.
//   - Two unit sources, ONE verification path (no separate concept vs literal
//     logic): concept-backed units carry the lifestyle dictionary's full
//     multilingual synonym set; token units are auto-generated from
//     distinctive words and carry only their own normalized/singular forms.
//   - A property VERIFIES a requirement only when it covers a strict MAJORITY
//     of the units (or an adjacency/phrase of 2+ units appears) — never on a
//     single overlap.
//
// Responsibility boundary: this module returns STRUCTURED FACTS (coverage
// numbers, which units matched, phrase adjacency). Whether that is "good
// enough" is a policy question, expressed here only as the pure predicate
// evaluateDescriptionEvidence — imported by both the search layer (to gate
// the verified-description path) and available to the policy layer. It
// contains no requirement-specific vocabulary: unknown requests (podcast
// room, EV charging, veterinary hospital, ...) work through auto-generated
// token units with zero per-requirement code.
//
// Semantic search remains responsible for meaning/paraphrase/cross-language
// recall (unchanged, and it runs first). This lexical layer is strict
// textual CONFIRMATION only — a paraphrase like "recording room for music
// production" for "music studio" may correctly not verify here; semantic
// search is the right path for it.

import { findConceptForWord } from '../utils/lifestyleConcepts.js'

// Independent local copies, matching this codebase's established convention
// (see chatPropertySearch.js's normalizeWord note): İ folded before lowercase
// (JS lowercases "İ" to "i" + a combining mark otherwise), then all
// non-alphanumerics removed so "wheelchair-friendly" -> "wheelchairfriendly"
// consistently on both the requirement and property sides.
const normalizeWord = (word = '') => word.replace(/İ/g, 'i').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Same singular/plural tolerance the rest of the pipeline uses.
const toSingular = (word = '') => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

// ─── Preprocessing stop classes ────────────────────────────────────────────
// Grammatical glue + generic spatial/quantity nouns — never evidence on their
// own. Mirrors chatPropertySearch.js's CONNECTOR_WORDS_TO_IGNORE (kept as an
// independent copy; different purpose — unit construction, not $text cleanup).
const CONNECTOR_STOPWORDS = new Set([
  'near', 'nearby', 'close', 'closer', 'to', 'for', 'with', 'and', 'or',
  'a', 'an', 'the', 'of', 'is', 'are', 'that', 'this', 'some', 'good',
  'any', 'have', 'has', 'does', 'do', 'want', 'need', 'looking', 'like',
  'area', 'place', 'around', 'from', 'into', 'your', 'you', 'me', 'my',
  'we', 'our', 'there', 'here', 'also', 'still', 'same', 'general',
])

// A SMALL, CLOSED, GENERAL class of evaluative/quality adjectives. These are
// pure filler ("suitable for X", "ideal for X") and carry no requirement
// meaning. This set is language-oriented and general — it is NOT a real-estate
// requirement blacklist and MUST NOT grow per requirement (adding "podcast",
// "veterinary", etc. here would be wrong; coverage handles those). "good" is
// already covered by CONNECTOR_STOPWORDS above.
const WEAK_EVALUATIVE_WORDS = new Set([
  'suitable', 'ideal', 'perfect', 'great', 'nice', 'lovely', 'beautiful',
  'wonderful', 'excellent', 'amazing',
])

const isStopword = (word) => CONNECTOR_STOPWORDS.has(word) || WEAK_EVALUATIVE_WORDS.has(word)

// Prefer Gemini's short, tagged requirement phrases over the padded
// descriptionQuery — identical rule to chatPropertySearch.js's own
// getConceptSourcePhrases (independent copy, same reasoning).
const getRequirementPhrases = (parsed = {}) => {
  const tagged = [
    ...(Array.isArray(parsed.lifestyle) ? parsed.lifestyle : []),
    ...(Array.isArray(parsed.mustHave) ? parsed.mustHave : []),
    ...(Array.isArray(parsed.niceToHave) ? parsed.niceToHave : []),
    ...(Array.isArray(parsed.requirements) ? parsed.requirements : []),
  ]

  if (tagged.length > 0) return tagged

  return parsed.descriptionQuery ? [parsed.descriptionQuery] : []
}

// ─── Unit construction ─────────────────────────────────────────────────────
// IMPORTANT: property-type words (studio/office/commercial/...) are NOT
// stripped here. Retrieval-query cleanup (chatPropertySearch.js's
// stripStructuredTerms) still removes them for the $text query, but a
// COMPOUND requirement like "music studio" must keep BOTH "music" and
// "studio" as evidence units — otherwise it collapses to "music" and can
// re-introduce a false positive. Retrieval cleanup != evidence construction.
//
// Returns an array of { id, surfaceForms, isConcept }:
//   - concept unit: id = concept id, surfaceForms = its full multilingual
//     keyword set, isConcept = true.
//   - token unit: id = the singular normalized token, surfaceForms = the
//     token + its singular, isConcept = false.
// Deduped by id (a concept mentioned twice, or "room"/"rooms", collapse to one
// unit — duplicates never inflate coverage). Never mutates `parsed`.
export const buildEvidenceUnits = (parsed = {}) => {
  const words = getRequirementPhrases(parsed)
    .join(' ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)

  const units = []
  const seenIds = new Set()

  for (const word of words) {
    if (word.length < 3) continue

    const singular = toSingular(word)
    if (isStopword(word) || isStopword(singular)) continue

    const concept = findConceptForWord(word)

    if (concept) {
      if (seenIds.has(concept.id)) continue
      seenIds.add(concept.id)
      units.push({
        id: concept.id,
        surfaceForms: [...new Set(concept.keywords.map(normalizeWord).filter(Boolean))],
        isConcept: true,
      })
    } else {
      const id = singular
      if (seenIds.has(id)) continue
      seenIds.add(id)
      units.push({
        id,
        surfaceForms: [...new Set([word, singular])],
        isConcept: false,
      })
    }
  }

  return units
}

// ─── Coverage ──────────────────────────────────────────────────────────────
// Token-level (not substring) matching with singular tolerance, so "art" no
// longer spuriously matches "apartment". A unit is covered if any of its
// surface forms equals a property token (singular-folded on both sides).
// phraseMatched: any two DISTINCT units appear in adjacent property positions
// (order-independent adjacency — captures a literal "rooftop cinema" mention
// without a phrase dictionary). Never mutates inputs.
export const computeDescriptionCoverage = (units = [], propertyText = '') => {
  const totalUnits = units.length

  const propTokens = String(propertyText || '')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)
    .map(toSingular)

  const propTokenSet = new Set(propTokens)

  const unitCovered = (unit) =>
    unit.surfaceForms.some((form) => propTokenSet.has(toSingular(normalizeWord(form))))

  const coveredUnitIds = []
  const unmatchedUnitIds = []

  for (const unit of units) {
    if (unitCovered(unit)) coveredUnitIds.push(unit.id)
    else unmatchedUnitIds.push(unit.id)
  }

  const coveredCount = coveredUnitIds.length
  const coverageRatio = totalUnits > 0 ? coveredCount / totalUnits : 0

  // Adjacency: for each property position, which unit ids does it satisfy?
  // Two different units in consecutive positions => a phrase/adjacency hit.
  let phraseMatched = false
  if (units.length >= 2) {
    const unitIdsAtPos = propTokens.map((tok) =>
      units.filter((unit) => unit.surfaceForms.some((form) => toSingular(normalizeWord(form)) === tok)).map((unit) => unit.id)
    )
    for (let i = 0; i + 1 < unitIdsAtPos.length && !phraseMatched; i++) {
      for (const a of unitIdsAtPos[i]) {
        if (unitIdsAtPos[i + 1].some((b) => b !== a)) {
          phraseMatched = true
          break
        }
      }
    }
  }

  return { totalUnits, coveredCount, coverageRatio, phraseMatched, coveredUnitIds, unmatchedUnitIds }
}

// ─── Verification rule (the "good enough" predicate) ───────────────────────
// Strict majority (> 0.5, NOT >=) OR a phrase/adjacency hit. Zero units is
// never vacuously verified. Pure; deterministic; returns a stable reason id.
export const evaluateDescriptionEvidence = (coverage = {}) => {
  const { totalUnits = 0, coveredCount = 0, phraseMatched = false } = coverage

  if (totalUnits === 0) return { verified: false, reason: 'no-evidence-units' }
  if (phraseMatched) return { verified: true, reason: 'phrase-adjacency-match' }
  if (coveredCount / totalUnits > 0.5) return { verified: true, reason: 'majority-unit-coverage' }

  return { verified: false, reason: 'insufficient-unit-coverage' }
}

// Convenience: build the property haystack the same way the search layer does
// (title + description + address + district), so callers stay consistent.
export const propertyEvidenceText = (property = {}) =>
  [property.title, property.description, property.address, property.district].filter(Boolean).join(' ')

// One-shot helper: does this property lexically verify this requirement?
// Pure composition of the three steps above — the search layer's per-property
// gate. Units can be prebuilt once and passed via `units` to avoid rebuilding
// per candidate.
export const propertyVerifiesDescription = (property, units) => {
  const coverage = computeDescriptionCoverage(units, propertyEvidenceText(property))
  return evaluateDescriptionEvidence(coverage).verified
}

// ─── Per-criterion request model (one criterion per requirement phrase) ─────
// A multi-part request ("family home near schools with a garden") must NOT be
// collapsed into one merged unit pool, or majority coverage could hide a single
// missing criterion (family+home outvoting a missing school). So each distinct
// requirement PHRASE is its own criterion with its own evidence units — the
// exact same granularity evaluateRequestEvidence already used, now shared as one
// source of truth. Pure; deterministic; reuses buildEvidenceUnits (no new
// evidence logic). A phrase with no verifiable units (e.g. "suitable") is
// dropped. Deduped case-insensitively.
export const buildRequestCriteria = (parsed = {}) => {
  const seen = new Set()
  const criteria = []

  for (const phrase of getRequirementPhrases(parsed)) {
    const key = String(phrase).trim().toLowerCase()
    if (!key || seen.has(key)) continue

    const units = buildEvidenceUnits({ lifestyle: [phrase] })
    if (units.length === 0) continue

    seen.add(key)
    criteria.push({ phrase, units })
  }

  return criteria
}

// Per-property, per-criterion evidence for ONE property. Each criterion is
// verified independently against this property's text (majority unit coverage /
// phrase adjacency — the same rule the lexical search path uses), so a property
// that supports only some requested criteria is never reported as fully
// verified. Returns the smallest contract the reply layers need:
//   { fullyVerified, verifiedCriteria, unverifiedCriteria }
// When nothing verifiable was requested, fullyVerified is trivially true and
// both lists are empty. `criteria` may be prebuilt once (via buildRequestCriteria)
// and passed in to avoid rebuilding per candidate. Never mutates inputs.
export const evaluatePropertyEvidence = (parsed = {}, property = {}, criteria = null) => {
  const crit = criteria || buildRequestCriteria(parsed)

  if (crit.length === 0) {
    return { fullyVerified: true, verifiedCriteria: [], unverifiedCriteria: [] }
  }

  const verifiedCriteria = []
  const unverifiedCriteria = []

  for (const { phrase, units } of crit) {
    if (propertyVerifiesDescription(property, units)) verifiedCriteria.push(phrase)
    else unverifiedCriteria.push(phrase)
  }

  return {
    fullyVerified: unverifiedCriteria.length === 0,
    verifiedCriteria,
    unverifiedCriteria,
  }
}

// ─── Request-level soft-criteria evidence (across a returned set) ───────────
// Change B: honest evidence for SEMANTIC results. Semantic retrieval ranks by
// meaning only, so a returned candidate carries NO coverage guarantee — this
// computes what the returned text actually confirms, per requested criterion.
//
// Criteria are the DISTINCT requirement PHRASES the visitor expressed
// (lifestyle/mustHave/niceToHave/requirements, else descriptionQuery) — one
// human-meaningful criterion per phrase ("music studio", "sea view"), not per
// token — deduped case-insensitively so the same phrase repeated across
// mustHave/requirements is counted once. Each phrase's evidence units are
// built ONCE here, before the property loop, then every candidate is checked
// against them (no per-candidate unit rebuild). A phrase with no verifiable
// units (e.g. "suitable") is not a criterion and is dropped.
//
// A criterion is MATCHED if at least one returned property lexically verifies
// it (majority unit coverage / phrase adjacency — the same rule the lexical
// search path uses). descriptionQueryVerified means "every requested criterion
// was confirmed by the returned set" (i.e. nothing left unmatched) — the
// honest all-criteria interpretation, chosen for the semantic path precisely
// because cosine similarity alone must not be treated as confirmation. When
// nothing verifiable was requested, it is trivially true (nothing to verify).
//
// NOTE: this is deliberately phrase-level and used ONLY for the semantic
// searchEvidence. The description/fallback path keeps its concept-id
// evaluateSoftCriteriaEvidence unchanged (those candidates already passed
// unit-coverage at retrieval, so their "at least one concept confirmed"
// reporting stays valid). Both are the same honesty principle at the
// granularity each retrieval mechanism can support — not two competing rules.
export const evaluateRequestEvidence = (parsed = {}, properties = []) => {
  // Shared criterion model (buildRequestCriteria) — identical to the previous
  // inline loop, now the single source of truth also used by
  // evaluatePropertyEvidence, so aggregate and per-property evidence can never
  // disagree about what the criteria are.
  const criteria = buildRequestCriteria(parsed)

  if (criteria.length === 0) {
    return {
      requestedSoftCriteria: [],
      matchedSoftCriteria: [],
      unmatchedSoftCriteria: [],
      descriptionQueryVerified: true,
    }
  }

  const matchedSoftCriteria = []
  const unmatchedSoftCriteria = []

  for (const { phrase, units } of criteria) {
    const confirmed = properties.some((property) => propertyVerifiesDescription(property, units))
    if (confirmed) matchedSoftCriteria.push(phrase)
    else unmatchedSoftCriteria.push(phrase)
  }

  return {
    requestedSoftCriteria: criteria.map((c) => c.phrase),
    matchedSoftCriteria,
    unmatchedSoftCriteria,
    descriptionQueryVerified: unmatchedSoftCriteria.length === 0,
  }
}
