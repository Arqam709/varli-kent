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
// Phase 5 (multilingual deterministic fallback parsing) added the Turkish/
// Arabic entries in each keyword list below — single whitespace-separated
// tokens only (this matcher is word-by-word, see extractConceptIdsFromText),
// not multi-word phrases. Purely additive: every pre-existing English/Turkish
// keyword is untouched.
//
// Arabic also gets the common "ال" (definite article, "the") prefixed form
// listed explicitly alongside the bare noun (e.g. both "مدرسة" and
// "المدرسة") since the prefix is fused onto the word with no space —
// normalizeWord only strips punctuation, not this grammatical prefix, so
// "المدارس" would otherwise silently fail to match "مدارس". This is a small,
// explicit alternate-spelling list, not general Arabic morphological
// analysis. Turkish grammatical case suffixes (e.g. dative "okullara" =
// "to schools", not the listed nominative "okullar") are NOT similarly
// covered — that would require real stemming, out of scope for this
// optional, deliberately minimal lifestyle-fallback signal; only the base
// (nominative/plural) Turkish form is recognized.
export const LIFESTYLE_CONCEPTS = [
  { id: 'school', name: 'school', keywords: ['school', 'schools', 'educational', 'education', 'kindergarten', 'university', 'campus', 'okul', 'okullar', 'eğitim', 'egitim', 'مدرسة', 'مدارس', 'المدرسة', 'المدارس'] },
  { id: 'sea_view', name: 'seaView', keywords: ['sea', 'seaside', 'view', 'deniz', 'manzara', 'waterfront', 'coast', 'coastal', 'بحر', 'شاطئ', 'إطلالة', 'اطلالة', 'البحر', 'الشاطئ'] },
  { id: 'metro_transport', name: 'metroTransport', keywords: ['metro', 'subway', 'transport', 'transportation', 'bus', 'station', 'marmaray', 'otobüs', 'otobus', 'durak', 'مترو', 'مواصلات', 'محطة', 'المترو', 'المحطة'] },
  { id: 'family', name: 'family', keywords: ['family', 'families', 'children', 'child', 'kids', 'childfriendly', 'aile', 'çocuk', 'cocuk', 'çocuklar', 'cocuklar', 'عائلة', 'أطفال', 'اطفال', 'العائلة'] },
  { id: 'peaceful_safe', name: 'peacefulSafe', keywords: ['peaceful', 'quiet', 'calm', 'secure', 'security', 'safe', 'safety', 'sakin', 'huzurlu', 'güvenli', 'guvenli', 'güvenlik', 'guvenlik', 'هادئ', 'آمن', 'امن', 'أمان', 'امان', 'الأمان'] },
  { id: 'park_green', name: 'parkGreen', keywords: ['park', 'parks', 'green', 'garden', 'gardens', 'yeşil', 'yesil', 'bahçe', 'bahce', 'حديقة', 'خضراء', 'الحديقة'] },
  { id: 'investment', name: 'investment', keywords: ['investment', 'yield', 'rentalincome', 'appreciation', 'roi', 'yatırım', 'yatirim', 'استثمار', 'الاستثمار'] },
  { id: 'luxury', name: 'luxury', keywords: ['luxury', 'premium', 'highend', 'prestigious', 'lüks', 'luks', 'فاخر', 'فخم'] },
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

// The İ (U+0130, Turkish dotted capital I) fold must happen BEFORE
// .toLowerCase() — JS's default locale-unaware lowercasing expands "İ" into
// "i" + a stray combining-dot-above character instead of plain "i" (see the
// same fix in locales/chatParsingVocabulary.js's normalizeForMatching).
const normalizeWord = (word = '') => word.replace(/İ/g, 'i').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Canonical concept ids literally present in a piece of text — word-by-word,
// exact-keyword-list match (via findConceptForWord/toSingular above). This
// is the STRICT verification primitive: shared by chatPropertySearch.js
// (search evidence: which requested soft criteria did the returned
// properties actually confirm) and chatReplyBuilder.js (per-card match
// labels), so both layers agree on what counts as "verified." It is
// deliberately stricter than chatPropertySearch.js's own candidate-selection
// relevance check (propertyMatchesSignificantTerm), which stays lenient
// (substring-based, pooled across all requested terms) on purpose — broad
// recall for what gets RETURNED is fine; this function is only used for
// what gets CLAIMED as verified, and those are different jobs with
// different correct strictness levels.
export const extractConceptIdsFromText = (text = '') => {
  const ids = new Set()

  text
    .replace(/İ/g, 'i')
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeWord)
    .forEach((word) => {
      const concept = findConceptForWord(word)
      if (concept) ids.add(concept.id)
    })

  return Array.from(ids)
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
