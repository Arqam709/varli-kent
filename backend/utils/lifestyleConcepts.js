// backend/utils/lifestyleConcepts.js
//
// Canonical lifestyle concept registry — deterministic, no AI. A property is
// only a genuine lifestyle match if it contains a keyword from a concept the
// visitor actually asked about, not just any word that happened to appear in
// Gemini's expanded free-text description query (which tends to pad in
// loosely-related synonyms, e.g. "family friendly" for a plain "near school"
// request).
//
// Single source of truth for the concept vocabulary — moved out of
// routes/chat.js (Phase A of the chatbot architecture rework) so it can be
// shared by future consumers (e.g. constraining Gemini's own prompt to this
// same vocabulary) without duplicating the list.

// `id` is the stable, snake_case canonical vocabulary (Phase B) — this is
// what future Gemini output / sanitizeConcepts() will speak. `name` is the
// original camelCase identifier routes/chat.js already compares against
// (detectConceptsInText, phraseConceptNames, dropConceptsFromPhrases) and is
// left untouched so this stays a purely additive change.
export const LIFESTYLE_CONCEPTS = [
  { id: 'school', name: 'school', keywords: ['school', 'schools', 'educational', 'education', 'kindergarten', 'university', 'campus'] },
  { id: 'sea_view', name: 'seaView', keywords: ['sea', 'seaside', 'view', 'deniz', 'manzara', 'waterfront', 'coast', 'coastal'] },
  { id: 'metro_transport', name: 'metroTransport', keywords: ['metro', 'subway', 'transport', 'transportation', 'bus', 'station', 'marmaray'] },
  { id: 'family', name: 'family', keywords: ['family', 'families', 'children', 'child', 'kids', 'childfriendly'] },
  { id: 'peaceful_safe', name: 'peacefulSafe', keywords: ['peaceful', 'quiet', 'calm', 'secure', 'security', 'safe', 'safety'] },
  { id: 'park_green', name: 'parkGreen', keywords: ['park', 'parks', 'green', 'garden', 'gardens'] },
  { id: 'investment', name: 'investment', keywords: ['investment', 'yield', 'rentalincome', 'appreciation', 'roi'] },
  { id: 'luxury', name: 'luxury', keywords: ['luxury', 'premium', 'highend', 'prestigious'] },
]

// Simple singular/plural tolerance so "schools" still matches a concept
// keyword list that only lists "school", and vice versa. Local to this
// module — routes/chat.js has its own separate copy for its own, unrelated
// use (matching literal words against property text), kept independent
// rather than shared to avoid coupling two otherwise-unrelated utilities.
const toSingular = (word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

export const findConceptForWord = (word) => {
  const singular = toSingular(word)
  return LIFESTYLE_CONCEPTS.find(
    (concept) => concept.keywords.includes(word) || concept.keywords.includes(singular)
  )
}

// ─── Canonical concept ID validation (Phase B) ─────────────────────────────
// Not called anywhere yet — this is the validator that will sit in front of
// Gemini's future `lifestyleConcepts` output (a later, separately-approved
// phase) so unrecognized/hallucinated concept ids never reach search or
// memory logic. Added now, ahead of that wiring, so the safety net exists
// before anything needs to trust it.

export const CANONICAL_CONCEPT_IDS = LIFESTYLE_CONCEPTS.map((concept) => concept.id)

export const isValidConceptId = (id) => CANONICAL_CONCEPT_IDS.includes(id)

// sanitizeConcepts(rawConcepts) — defensively normalizes arbitrary input
// into a clean, deduped array of only recognized canonical ids. Safe against
// non-array input, non-string entries, and mixed case.
export const sanitizeConcepts = (rawConcepts) => {
  if (!Array.isArray(rawConcepts)) return []

  const seen = new Set()

  for (const entry of rawConcepts) {
    if (typeof entry !== 'string') continue

    const normalized = entry.trim().toLowerCase()
    if (isValidConceptId(normalized)) seen.add(normalized)
  }

  return [...seen]
}
