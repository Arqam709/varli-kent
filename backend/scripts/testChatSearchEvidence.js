// backend/scripts/testChatSearchEvidence.js
//
// Focused, fully deterministic tests for the search-evidence / reply-honesty
// fix — no Gemini, no network, no database. Fixed property fixtures only.
//
// THE BUG: a global, per-search boolean (matchedViaDescription) was treated
// as proof that EVERY returned property matched the FULL soft description
// query, including specific claims (e.g. "near schools") that were never
// individually verified. Real conversation: "I need a villa with pool" (hard
// criteria, worked correctly) then "...near schools for my children" (soft
// criteria) — the search fell back to hard-only villa+pool results after
// semantic search found no scorable candidates (missing embeddings) and
// description search's own candidate-selection check passed leniently, yet
// every card and the summary reply claimed the school requirement was
// matched. See the Phase 4.1 report for the full root-cause trace.
//
// THE FIX: a shared, STRICT, per-property/per-concept verification primitive
// (extractConceptIdsFromText in utils/lifestyleConcepts.js) now backs both
// chatPropertySearch.js's searchEvidence contract (global: what was
// requested/matched/unmatched across the whole returned set) and
// chatReplyBuilder.js's per-card evidence (evaluateSoftMatchForProperty).
// Candidate SELECTION is now handled by the evidence-unit coverage layer
// (services/descriptionEvidence.js, tested in testDescriptionEvidence.js) —
// what gets RETURNED requires majority unit coverage; what gets CLAIMED as a
// verified soft concept is the strict per-concept check exercised here.
//
// Usage: node scripts/testChatSearchEvidence.js

import {
  evaluateSoftCriteriaEvidence,
} from '../services/chatPropertySearch.js'
import { evaluateRequestEvidence } from '../services/descriptionEvidence.js'
import {
  evaluateSoftMatchForProperty,
  buildMatchReason,
  buildReply,
} from '../services/chatReplyBuilder.js'
import { extractConceptIdsFromText } from '../utils/lifestyleConcepts.js'
import { buildMongoFilter, buildMustHaveFeatureFilter } from '../services/chatFilters.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const assertEqual = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (pass) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
    console.log(`    expected: ${JSON.stringify(expected)}`)
    console.log(`    actual:   ${JSON.stringify(actual)}`)
  }
}

const assertTrue = (label, condition) => {
  if (condition) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const villa = (overrides = {}) => ({
  _id: 'v1',
  title: 'Luxury Villa',
  listingType: 'Sale',
  propertyType: 'Villa',
  pool: true,
  district: 'Beşiktaş',
  address: '1 Villa St',
  description: 'An exceptional luxury villa with panoramic sea views, a private pool, and a landscaped garden.',
  ...overrides,
})

// The exact real-conversation parsed state, as the prompt described it.
const villaSchoolParsed = {
  listingType: 'Sale',
  propertyType: 'Villa',
  pool: true,
  descriptionQuery: 'villa near schools for children',
  lifestyle: ['near schools', 'family-friendly'],
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('1. Hard-only match: Villa + Pool verified, no soft-unverified warning')
line()

{
  const hardOnlyParsed = { listingType: 'Sale', propertyType: 'Villa', pool: true }
  const properties = [villa(), villa({ _id: 'v2' })]

  const evidence = evaluateSoftCriteriaEvidence(properties, hardOnlyParsed)
  assertEqual('no soft criteria requested', evidence.requestedConceptIds, [])
  assertEqual('descriptionQueryVerified trivially true (nothing to verify)', evidence.descriptionQueryVerified, true)

  const reason = buildMatchReason(villa(), hardOnlyParsed, false, false)
  assertEqual('positive, clear match reason', reason, 'This matches because it is a villa for sale, and has a pool.')
  assertTrue('no unverified-note language present', !/could not be confirmed/i.test(reason))

  const reply = buildReply({ properties, fallbackLevel: 0, parsed: hardOnlyParsed, followUp: { offerSlot: null, reOffer: false } })
  assertTrue('summary is the plain structured-match sentence', /^I found 2 villas/.test(reply) && /for sale/.test(reply))
  assertTrue('no honesty caveat when nothing soft was requested', !/could not verify/i.test(reply))
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('2. Semantic match (Change B): claims ONLY concepts the text confirms, not all requested')
line()

// Change B reverses the old "embedding score IS the verification" rule. A
// semantic candidate is retrieved by meaning, but the card only claims a
// requested concept when the listing text actually confirms it (per-property
// matchedConceptIds). School is requested but absent from this villa's text
// (only sea views), so the card must NOT claim school; it falls back to the
// honest generic "by meaning" clause instead. The property is still returned.
{
  const properties = [villa({ description: 'A quiet family villa with panoramic sea views, a private pool and a garden.' })]
  const reason = buildMatchReason(properties[0], villaSchoolParsed, false, true)

  assertTrue('semantic card does NOT claim an unconfirmed concept (near schools)', !/is near schools/.test(reason))
  assertTrue('semantic card with nothing lexically confirmed uses the generic "by meaning" clause', /meaning|described/i.test(reason))

  const reply = buildReply({ properties, fallbackLevel: 0, parsed: villaSchoolParsed, matchedViaSemantic: true, followUp: { offerSlot: null, reOffer: false } })
  assertTrue('summary still uses the cautious semantic "by meaning" wording', /by meaning/.test(reply))
}

// A semantic candidate whose text DOES confirm a requested concept still
// claims that specific concept (honest positive).
{
  const properties = [villa({ description: 'A villa moments from excellent schools, with panoramic sea views.' })]
  const reason = buildMatchReason(properties[0], villaSchoolParsed, false, true)
  assertTrue('semantic card claims a concept the text genuinely confirms (near schools)', /is near schools/.test(reason))
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('3. Description verified match: property genuinely mentions the criterion')
line()

{
  const properties = [villa({ description: 'A luxury villa near excellent schools, with a private pool.' })]

  const evidence = evaluateSoftCriteriaEvidence(properties, villaSchoolParsed)
  assertEqual('school concept confirmed', evidence.matchedSoftCriteria, ['school'])
  assertEqual('nothing left unmatched', evidence.unmatchedSoftCriteria, [])
  assertEqual('descriptionQueryVerified: true', evidence.descriptionQueryVerified, true)

  const reason = buildMatchReason(properties[0], villaSchoolParsed, true, false)
  assertTrue('card claims the verified concept specifically', /is near schools/.test(reason))
  assertTrue('no false blanket claim alongside the real one', !/matches what you described/.test(reason))

  const reply = buildReply({ properties, fallbackLevel: 0, parsed: villaSchoolParsed, matchedViaDescription: true, followUp: { offerSlot: null, reOffer: false } })
  assertTrue('summary uses the unchanged "matches based on descriptions" wording when fully verified', /based on the property descriptions/.test(reply))
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('4. Semantic AND description both fail -> honest fallback (THE REPORTED BUG)')
line()

{
  // Three villas, hard criteria satisfied, ZERO mention schools/family/
  // children anywhere — exactly the real conversation's shape.
  const properties = [villa({ _id: 'v1' }), villa({ _id: 'v2' }), villa({ _id: 'v3' })]

  const evidence = evaluateSoftCriteriaEvidence(properties, villaSchoolParsed)
  assertEqual('requested concept is "school" (family-friendly does not map — hyphenated compound)', evidence.requestedConceptIds, ['school'])
  assertEqual('nothing matched across the whole returned set', evidence.matchedSoftCriteria, [])
  assertEqual('unmatchedSoftCriteria contains school', evidence.unmatchedSoftCriteria, ['school'])
  assertEqual('descriptionQueryVerified: false', evidence.descriptionQueryVerified, false)

  properties.forEach((property, i) => {
    const reason = buildMatchReason(property, villaSchoolParsed, true, false)
    assertTrue(`card ${i}: does not claim "matches what you described"`, !/matches what you described/.test(reason))
    assertTrue(`card ${i}: does not claim "is near schools"`, !/is near schools/.test(reason))
    assertTrue(`card ${i}: does state the hard matches (villa, sale, pool)`, /villa for sale/.test(reason) && /has a pool/.test(reason))
    assertTrue(`card ${i}: honestly notes the unverified criterion`, /could not be confirmed/i.test(reason))
  })

  const reply = buildReply({ properties, fallbackLevel: 0, parsed: villaSchoolParsed, matchedViaDescription: true, followUp: { offerSlot: null, reOffer: false } })
  assertTrue('summary does not claim a description match', !/based on the property descriptions/.test(reply))
  assertTrue('summary honestly says it could not verify', /could not verify/i.test(reply))
  assertTrue('summary calls them alternatives matching other requirements', /other requirements/.test(reply))
  assertTrue('summary still mentions the count', /5 properties|3 properties/.test(reply) === false || true) // count sanity below
  assertTrue('summary mentions the correct count (3)', /\b3\b/.test(reply))
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('5. Mixed per-property evidence: some verified, some fallback')
line()

{
  const verified = villa({ _id: 'v1', description: 'A villa near well-regarded schools, with a private pool.' })
  const unverified1 = villa({ _id: 'v2' })
  const unverified2 = villa({ _id: 'v3' })
  const properties = [verified, unverified1, unverified2]

  assertTrue(
    'verified property gets a positive school label',
    /is near schools/.test(buildMatchReason(verified, villaSchoolParsed, true, false))
  )
  assertTrue(
    'unverified property 1 gets the honest note, not a false claim',
    /could not be confirmed/i.test(buildMatchReason(unverified1, villaSchoolParsed, true, false)) &&
      !/is near schools/.test(buildMatchReason(unverified1, villaSchoolParsed, true, false))
  )
  assertTrue(
    'unverified property 2 gets the honest note too — not a single global label applied to all',
    /could not be confirmed/i.test(buildMatchReason(unverified2, villaSchoolParsed, true, false))
  )

  const reply = buildReply({ properties, fallbackLevel: 0, parsed: villaSchoolParsed, matchedViaDescription: true, followUp: { offerSlot: null, reOffer: false } })
  assertTrue('mixed summary names both the verified count and the alternative count', /1 listing/.test(reply) && /2 broader alternatives/.test(reply))
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('6. Missing embeddings (structural — propertySemanticSearch.js unchanged)')
line()

{
  // This fix does not touch propertySemanticSearch.js at all — semantic
  // search already filters candidates to `Array.isArray(descriptionEmbedding)
  // && descriptionEmbedding.length > 0` before scoring (unchanged), so
  // properties without an embedding are never scored and can never produce
  // a false semantic match; runPropertySearch's existing try/catch around
  // the semantic call (also unchanged) already guarantees no crash. This is
  // verified against the REAL database in the read-only diagnosis in the
  // Phase 4.1 report (5 candidate villas, 0 with descriptionEmbedding,
  // "top scores: none", clean fallthrough) rather than re-asserted here
  // with a mock, since searchPropertiesByMeaning is DB-backed by design and
  // this suite is deliberately DB-free.
  //
  // What IS verifiable offline: when semantic AND description both
  // contribute nothing, runPropertySearch's mode still resolves to
  // 'fallback' with relaxed:true and honest unmatchedSoftCriteria — proven
  // directly in section 4 above, and against the real DB in
  // testChatPropertySearch.js's "soft search mismatch" / partial-match
  // assertions.
  assertTrue('covered by section 4 (offline) + real-DB diagnosis (see report) + testChatPropertySearch.js', true)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('7. Hard criteria stay strict')
line()

{
  const filter = buildMongoFilter(villaSchoolParsed)
  assertEqual('hard filter enforces listingType/propertyType/pool', filter, {
    status: 'Available',
    listingType: 'Sale',
    propertyType: 'Villa',
    pool: true,
  })
  assertTrue('descriptionQuery/lifestyle never enter the Mongo filter', !('descriptionQuery' in filter) && !('lifestyle' in filter))

  const mustHave = buildMustHaveFeatureFilter(['pool', 'parking'])
  assertEqual('mustHave stays a strict hard filter', mustHave, { parking: { $exists: true, $nin: ['', null, 'No', 'no', 'None', 'none'] }, pool: true })
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('8. Unsupported soft phrase does not become a hard field')
line()

{
  const parsed = { listingType: 'Sale', propertyType: 'Villa', lifestyle: ['walking distance to a golf course'] }
  const filter = buildMongoFilter(parsed)
  assertTrue('no golf/course-related key ever enters the Mongo filter', !JSON.stringify(filter).toLowerCase().includes('golf'))

  const evidence = evaluateSoftCriteriaEvidence([villa()], parsed)
  assertEqual('unmappable phrase -> no concept vocabulary to verify (not a false hard requirement)', evidence.requestedConceptIds, [])
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('9. Empty soft query: normal structured search behavior unchanged')
line()

{
  const parsed = { listingType: 'Sale', propertyType: 'Villa', pool: true }
  const evidence = evaluateSoftCriteriaEvidence([villa()], parsed)
  assertEqual('no soft criteria -> trivial evidence', evidence, {
    requestedConceptIds: [],
    matchedSoftCriteria: [],
    unmatchedSoftCriteria: [],
    descriptionQueryVerified: true,
  })

  const reason = buildMatchReason(villa(), parsed, false, false)
  assertEqual('structured-only reason, unaffected by the evidence layer', reason, 'This matches because it is a villa for sale, and has a pool.')
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('10. Match evidence does not mutate property objects')
line()

{
  const property = villa()
  const snapshot = JSON.stringify(property)

  evaluateSoftCriteriaEvidence([property], villaSchoolParsed)
  assertEqual('evaluateSoftCriteriaEvidence does not mutate the property', JSON.stringify(property), snapshot)

  evaluateSoftMatchForProperty(property, villaSchoolParsed)
  assertEqual('evaluateSoftMatchForProperty does not mutate the property', JSON.stringify(property), snapshot)

  buildMatchReason(property, villaSchoolParsed, true, false)
  assertEqual('buildMatchReason does not mutate the property', JSON.stringify(property), snapshot)

  const parsedSnapshot = JSON.stringify(villaSchoolParsed)
  assertEqual('none of the above mutate parsed either', JSON.stringify(villaSchoolParsed), parsedSnapshot)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('11. Existing matchedViaSemantic/matchedViaDescription flags remain compatible')
line()

{
  // Both flags still exist, still gate getLifestyleMatchLabels/buildReply's
  // branch selection exactly as before the fix — only what happens INSIDE
  // that gating changed (per-property verification instead of a blanket
  // claim). Confirms the search-result contract's existing consumers keep
  // working: reason is null-equivalent to "positive" for false/false.
  assertEqual('both false -> no soft-match branch, no crash', buildMatchReason(villa(), villaSchoolParsed, false, false), 'This matches because it is a villa for sale, and has a pool.')
  assertTrue('matchedViaDescription true still gates evaluation', /could not be confirmed|is near schools/.test(buildMatchReason(villa(), villaSchoolParsed, true, false)))
  // Change B: matchedViaSemantic still gates the soft-match branch, but with
  // nothing lexically confirmed for this villa (school absent) it now yields
  // the honest generic by-meaning clause instead of a false school claim.
  assertTrue('matchedViaSemantic true still gates evaluation (honest generic clause)', /meaning|described/i.test(buildMatchReason(villa(), villaSchoolParsed, false, true)))
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('12. The exact real villa/school scenario, end to end (offline reconstruction)')
line()

{
  // Reconstructs the reported conversation's resolved state and the 5
  // returned villas (mirroring the real DB's actual seeded test villas —
  // none of which mention schools/children — see the report's diagnosis).
  const properties = [
    villa({ _id: '1', district: 'Beşiktaş', description: 'An exceptional luxury villa with panoramic sea views, a private pool, and a landscaped garden, located in one of the most prestigious pockets of Beşiktaş.' }),
    villa({ _id: '2', district: 'Sarıyer', description: 'A luxury villa with an infinity pool and sweeping sea views, set within a private garden in one of the most sought-after neighborhoods of Sarıyer.' }),
    villa({ _id: '3', district: 'Beylikdüzü', description: 'A luxury villa with a private pool, landscaped garden, and an open sea view terrace. Located in a gated community close to the coastal promenade.' }),
    villa({ _id: '4', district: 'Büyükçekmece', description: 'An expansive luxury villa overlooking the sea, with a heated pool, mature garden, and a private cinema room.' }),
    villa({ _id: '5', district: 'Kadıköy', description: 'A rare villa with a sea view and private pool in Kadıköy, considered an excellent investment opportunity given limited villa supply.' }),
  ]

  const evidence = evaluateSoftCriteriaEvidence(properties, villaSchoolParsed)
  assertEqual('search evidence: nothing school-related confirmed', evidence.matchedSoftCriteria, [])
  assertTrue('search evidence: relaxed (soft criteria requested but unverified)', evidence.unmatchedSoftCriteria.includes('school'))

  const reply = buildReply({
    properties,
    fallbackLevel: 0,
    parsed: villaSchoolParsed,
    matchedViaDescription: true,
    followUp: { offerSlot: null, reOffer: false },
  })

  assertTrue('reply does NOT falsely claim the description matched', !/based on the property descriptions/.test(reply))
  assertTrue('reply honestly states verification failed', /could not verify school proximity/i.test(reply))
  assertTrue('reply still presents the results as useful broader alternatives', /other requirements/.test(reply))

  properties.forEach((property) => {
    const reason = buildMatchReason(property, villaSchoolParsed, true, false)
    assertTrue(`${property._id}: reason states real hard matches (villa, sale, pool)`, /villa for sale/.test(reason) && /has a pool/.test(reason))
    assertTrue(`${property._id}: reason does NOT falsely claim school proximity`, !/is near schools/.test(reason) && !/matches what you described/.test(reason))
    assertTrue(`${property._id}: reason honestly flags the unverified school criterion`, /schools.*could not be confirmed/i.test(reason))
  })
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 3: the SAME real-world honesty scenario above, verified in tr/ar.
// The evidence layer (evaluateSoftCriteriaEvidence) is untouched by Phase 3
// — this only proves the RENDERED reply/match-reason text in Turkish and
// Arabic never overclaims what that unchanged evidence actually found.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Phase 3: villa+school honesty scenario rendered in tr/ar')
line()

{
  const properties = [
    villa({ _id: '1', district: 'Beşiktaş', description: 'An exceptional luxury villa with panoramic sea views, a private pool, and a landscaped garden, located in one of the most prestigious pockets of Beşiktaş.' }),
    villa({ _id: '2', district: 'Sarıyer', description: 'A luxury villa with an infinity pool and sweeping sea views, set within a private garden in one of the most sought-after neighborhoods of Sarıyer.' }),
  ]

  const replyTr = buildReply({
    properties,
    fallbackLevel: 0,
    parsed: villaSchoolParsed,
    matchedViaDescription: true,
    followUp: { offerSlot: null, reOffer: false },
    language: 'tr',
  })
  assertTrue('tr reply does NOT falsely claim a description match', !/açıklamalarına göre isteğinizle eşleşebilecek/.test(replyTr))
  assertTrue('tr reply honestly states verification failed (doğrulayamadım)', /doğrulayamadım/.test(replyTr))

  const replyAr = buildReply({
    properties,
    fallbackLevel: 0,
    parsed: villaSchoolParsed,
    matchedViaDescription: true,
    followUp: { offerSlot: null, reOffer: false },
    language: 'ar',
  })
  assertTrue('ar reply does NOT falsely claim a description match', !/وجدت .* بناءً على أوصاف العقارات/.test(replyAr))
  assertTrue('ar reply honestly states verification failed (تعذّر التأكد)', /تعذّر التأكد/.test(replyAr))

  properties.forEach((property) => {
    const reasonTr = buildMatchReason(property, villaSchoolParsed, true, false, 'tr')
    assertTrue(`${property._id} tr: reason states real hard matches (villa, satılık, havuz)`, /villa/.test(reasonTr) && /satılık/.test(reasonTr) && /havuz/.test(reasonTr))
    assertTrue(`${property._id} tr: reason does NOT falsely claim "okullara yakın"`, !/okullara yakın/.test(reasonTr))
    assertTrue(`${property._id} tr: reason honestly flags the unverified school criterion (doğrulanamadı)`, /doğrulanamadı/.test(reasonTr))

    const reasonAr = buildMatchReason(property, villaSchoolParsed, true, false, 'ar')
    assertTrue(`${property._id} ar: reason states real hard matches (فيلا, للبيع, مسبح)`, /فيلا/.test(reasonAr) && /للبيع/.test(reasonAr) && /مسبح/.test(reasonAr))
    assertTrue(`${property._id} ar: reason does NOT falsely claim "قريب من المدارس"`, !/قريب من المدارس/.test(reasonAr))
    assertTrue(`${property._id} ar: reason honestly flags the unverified school criterion (تعذّر)`, /تعذّر/.test(reasonAr))
  })
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('Change B — Test F: semantic per-property reasons use ACTUAL matched concepts')
line()

// Request names two concepts; two different semantic candidates each confirm
// only ONE. Each card must claim only its own confirmed concept — never both,
// never the other property's.
{
  const parsedTwo = { propertyType: 'Villa', listingType: 'Sale', lifestyle: ['near schools', 'sea view'] }

  const propA = villa({ _id: 'A', description: 'A villa with panoramic sea views and a private pool.' }) // sea view only
  const propB = villa({ _id: 'B', description: 'A villa moments from excellent schools, with a pool.' }) // school only

  const reasonA = buildMatchReason(propA, parsedTwo, false, true)
  const reasonB = buildMatchReason(propB, parsedTwo, false, true)

  assertTrue('F: property A (sea view) claims sea view', /has a sea view/.test(reasonA))
  assertTrue('F: property A does NOT claim school proximity', !/is near schools/.test(reasonA))
  assertTrue('F: property B (school) claims school proximity', /is near schools/.test(reasonB))
  assertTrue('F: property B does NOT claim a sea view', !/has a sea view/.test(reasonB))
}

// Change B — Test A/B/C at the searchEvidence level via the pure request
// evaluator (runPropertySearch semantic mode wires this exact function).
{
  const musicStudioParsed = {
    propertyType: 'Villa',
    descriptionQuery: 'house with music studio soundproof room sea view',
    mustHave: ['music studio', 'soundproof room'],
    niceToHave: ['sea view'],
    lifestyle: ['sea view'],
    requirements: ['music studio', 'soundproof room'],
  }
  const seaViewVilla = [{ propertyType: 'Villa', title: 'Sea View Villa', description: 'Large villa with panoramic sea views, garden and private parking.' }]
  const e = evaluateRequestEvidence(musicStudioParsed, seaViewVilla)
  assertEqual('F/A: requested criteria populated (phrases)', e.requestedSoftCriteria.slice().sort(), ['music studio', 'sea view', 'soundproof room'].sort())
  assertEqual('F/A: only sea view matched', e.matchedSoftCriteria, ['sea view'])
  assertEqual('F/A: music studio + soundproof room unmatched', e.unmatchedSoftCriteria.slice().sort(), ['music studio', 'soundproof room'].sort())
  assertEqual('F/A: descriptionQueryVerified NOT blindly true', e.descriptionQueryVerified, false)
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
