// backend/scripts/testSemanticEvidence.js
//
// Focused, fully deterministic tests for the semantic-result evidence fix
// (Area A) — no Gemini, no MongoDB, no network. Fixed parsed + property
// fixtures only.
//
// THE BUG: semantic (embedding) retrieval was treated as final acceptance. A
// candidate above the cosine threshold was counted as a verified match and its
// card could claim "reflects the preferences you described" (or emphasize a
// structured feature like an elevator) even when the requested requirement was
// never confirmed in the listing text.
//
// THE FIX (demote, don't drop): each semantic candidate now carries per-property,
// per-criterion softEvidence { fullyVerified, verifiedCriteria, unverifiedCriteria }
// computed once in the search layer via the existing evidence-unit primitives.
// The reply count, summary, and per-card reason all read that same object, so
// they can never disagree.
//
// Usage: node scripts/testSemanticEvidence.js

import { evaluatePropertyEvidence, buildRequestCriteria } from '../services/descriptionEvidence.js'
import { buildSearchResultPlan, buildMatchReasonPlan } from '../services/chatReplyPlan.js'
import { buildReply } from '../services/chatReplyBuilder.js'
import {
  renderMatchReasonPlan,
  renderSearchResultPlan,
  genericMatchReasonClause,
} from '../services/chatReplyRenderer.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const assertEqual = (label, actual, expected) => {
  if (deepEqual(actual, expected)) {
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

// ─── Fixtures ────────────────────────────────────────────────────────────────
const forest = {
  propertyType: 'Apartment',
  title: 'Family Apartment Near Forest',
  description: 'A calm family home right next to a big forest with trees.',
  district: 'Kadıköy',
}
const seaView = {
  propertyType: 'Apartment',
  title: 'Bright Apartment',
  description: 'Bright apartment with a stunning sea view over the water.',
  district: 'Kadıköy',
}
const schoolHome = {
  propertyType: 'Apartment',
  title: 'Family Home',
  description: 'Family home a short walk from several schools and a kindergarten.',
  district: 'Kadıköy',
}
const elevatorApt = {
  propertyType: 'Apartment',
  title: 'Modern Apartment',
  description: 'Modern apartment in a new building.',
  elevator: true,
  district: 'Kadıköy',
}

const withEvidence = (property, parsed, criteria = null) => ({
  ...property,
  matchedViaSemantic: true,
  softEvidence: evaluatePropertyEvidence(parsed, property, criteria),
})

// ═══════════════════════════════════════════════════════════════════════
// A. evaluatePropertyEvidence — per-property, per-criterion (pure)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. evaluatePropertyEvidence')
line()
{
  const parsed = { lifestyle: ['sea view'] }
  assertEqual('forest / sea view -> not verified', evaluatePropertyEvidence(parsed, forest), {
    fullyVerified: false, verifiedCriteria: [], unverifiedCriteria: ['sea view'],
  })
  assertEqual('sea-view listing / sea view -> verified', evaluatePropertyEvidence(parsed, seaView), {
    fullyVerified: true, verifiedCriteria: ['sea view'], unverifiedCriteria: [],
  })
}
{
  // Multi-criterion: family + near schools evaluated INDEPENDENTLY — majority
  // coverage of "family" must NOT hide the missing "near schools".
  const parsed = { lifestyle: ['family', 'near schools'] }
  assertEqual('forest / family+schools -> family only (partial)', evaluatePropertyEvidence(parsed, forest), {
    fullyVerified: false, verifiedCriteria: ['family'], unverifiedCriteria: ['near schools'],
  })
  assertEqual('school home / family+schools -> both verified', evaluatePropertyEvidence(parsed, schoolHome), {
    fullyVerified: true, verifiedCriteria: ['family', 'near schools'], unverifiedCriteria: [],
  })
}
{
  // Open requirement (no concept id): an elevator must not verify "wheelchair".
  const parsed = { lifestyle: ['wheelchair suitable'] }
  assertEqual('elevator apt / wheelchair -> not verified', evaluatePropertyEvidence(parsed, elevatorApt), {
    fullyVerified: false, verifiedCriteria: [], unverifiedCriteria: ['wheelchair suitable'],
  })
}
{
  // Quiet villa near a hospital: quiet supported, hospital not -> partial.
  const parsed = { lifestyle: ['quiet', 'near a hospital'] }
  const quietProp = { propertyType: 'Villa', title: 'Villa', description: 'A quiet and peaceful villa on a calm street.', district: 'Sarıyer' }
  assertEqual('quiet villa / quiet+hospital -> quiet only', evaluatePropertyEvidence(parsed, quietProp), {
    fullyVerified: false, verifiedCriteria: ['quiet'], unverifiedCriteria: ['near a hospital'],
  })
}

// ═══════════════════════════════════════════════════════════════════════
// B. buildSearchResultPlan — verified count from softEvidence
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. buildSearchResultPlan verified counting')
line()
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  // none verified
  const none = buildSearchResultPlan({
    properties: [withEvidence(forest, parsed)], parsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  assertEqual('none verified -> verifiedCount 0', none.verifiedCount, 0)
  assertTrue('none verified -> noneVerified true', none.noneVerified === true)
  assertTrue('none verified -> mixedVerified false', none.mixedVerified === false)

  // all verified
  const all = buildSearchResultPlan({
    properties: [withEvidence(seaView, parsed)], parsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  assertEqual('all verified -> verifiedCount 1', all.verifiedCount, 1)
  assertTrue('all verified -> noneVerified false', all.noneVerified === false)

  // mixed: 1 verified + 1 not
  const mixed = buildSearchResultPlan({
    properties: [withEvidence(seaView, parsed), withEvidence(forest, parsed)], parsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  assertEqual('mixed -> count 2', mixed.count, 2)
  assertEqual('mixed -> verifiedCount 1', mixed.verifiedCount, 1)
  assertTrue('mixed -> mixedVerified true', mixed.mixedVerified === true)
}
{
  // Backward-compat: semantic property WITHOUT softEvidence keeps old behavior
  // (counted, not treated as unverified).
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const legacy = buildSearchResultPlan({
    properties: [{ ...forest, matchedViaSemantic: true }], parsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  assertEqual('no softEvidence -> verifiedCount = count (legacy)', legacy.verifiedCount, 1)
  assertTrue('no softEvidence -> noneVerified false (legacy)', legacy.noneVerified === false)
}

// ═══════════════════════════════════════════════════════════════════════
// C. buildMatchReasonPlan — per-card evidence fields from softEvidence
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. buildMatchReasonPlan fields')
line()
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const plan = buildMatchReasonPlan(withEvidence(forest, parsed), parsed, false, true)
  assertEqual('forest unverified: matchedConceptIds []', plan.matchedConceptIds, [])
  assertEqual('forest unverified: unverifiedConceptId sea_view', plan.unverifiedConceptId, 'sea_view')
  assertTrue('forest unverified: hasUnverifiedRequirement', plan.hasUnverifiedRequirement === true)
  assertTrue('forest unverified: NO confident generic claim', plan.semanticGenericClaim === false)
}
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const plan = buildMatchReasonPlan(withEvidence(seaView, parsed), parsed, false, true)
  assertEqual('seaview verified: matchedConceptIds [sea_view]', plan.matchedConceptIds, ['sea_view'])
  assertTrue('seaview verified: hasUnverifiedRequirement false', plan.hasUnverifiedRequirement === false)
}
{
  // Partial: family verified, school not.
  const parsed = { lifestyle: ['family', 'near schools'], propertyType: 'Apartment' }
  const plan = buildMatchReasonPlan(withEvidence(forest, parsed), parsed, false, true)
  assertEqual('partial: matchedConceptIds [family]', plan.matchedConceptIds, ['family'])
  assertEqual('partial: unverifiedConceptId school', plan.unverifiedConceptId, 'school')
  assertTrue('partial: hasUnverifiedRequirement', plan.hasUnverifiedRequirement === true)
}
{
  // Wheelchair (open requirement) with elevator — must not imply accessibility.
  const parsed = { lifestyle: ['wheelchair suitable'], propertyType: 'Apartment', listingType: 'Sale', elevator: true }
  const plan = buildMatchReasonPlan(withEvidence(elevatorApt, parsed), parsed, false, true)
  assertTrue('wheelchair: elevator in matchedFeatureIds', plan.matchedFeatureIds.includes('elevator'))
  assertEqual('wheelchair: unverifiedConceptId null (open req)', plan.unverifiedConceptId, null)
  assertTrue('wheelchair: hasUnverifiedRequirement', plan.hasUnverifiedRequirement === true)
  assertTrue('wheelchair: NO confident generic claim', plan.semanticGenericClaim === false)
}

// ═══════════════════════════════════════════════════════════════════════
// D. renderMatchReasonPlan — card wording (en)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. renderMatchReasonPlan wording')
line()
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const text = renderMatchReasonPlan(buildMatchReasonPlan(withEvidence(forest, parsed), parsed, false, true), 'en')
  assertTrue('unverified card: no "reflects the preferences" claim', !text.includes(genericMatchReasonClause('en')))
  assertTrue('unverified card: states sea view could not be confirmed', /could not be confirmed/i.test(text))
}
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const text = renderMatchReasonPlan(buildMatchReasonPlan(withEvidence(seaView, parsed), parsed, false, true), 'en')
  assertTrue('verified card: mentions a sea view', /sea view/i.test(text))
  assertTrue('verified card: no "could not be confirmed" note', !/could not be confirmed/i.test(text))
}
{
  const parsed = { lifestyle: ['wheelchair suitable'], propertyType: 'Apartment', listingType: 'Sale', elevator: true }
  const text = renderMatchReasonPlan(buildMatchReasonPlan(withEvidence(elevatorApt, parsed), parsed, false, true), 'en')
  assertTrue('wheelchair card: mentions elevator', /elevator/i.test(text))
  assertTrue('wheelchair card: states requirement not confirmed', /could not be confirmed/i.test(text))
  assertTrue('wheelchair card: no confident generic claim', !text.includes(genericMatchReasonClause('en')))
}
{
  // Partial (family + school): confirms family AND states school unconfirmed.
  const parsed = { lifestyle: ['family', 'near schools'], propertyType: 'Apartment' }
  const text = renderMatchReasonPlan(buildMatchReasonPlan(withEvidence(forest, parsed), parsed, false, true), 'en')
  assertTrue('partial card: mentions family-friendly', /family-friendly/i.test(text))
  assertTrue('partial card: states schools could not be confirmed', /could not be confirmed/i.test(text))
}

// ═══════════════════════════════════════════════════════════════════════
// E. renderSearchResultPlan — summary wording (en)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. renderSearchResultPlan summary')
line()
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const nonePlan = buildSearchResultPlan({
    properties: [withEvidence(forest, parsed)], parsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  const noneText = renderSearchResultPlan(nonePlan, null, 'en')
  assertTrue('none-verified summary: says could not verify', /could not verify/i.test(noneText))
  assertTrue('none-verified summary: does NOT claim a by-meaning match', !/may match your request by meaning/i.test(noneText))

  const mixedPlan = buildSearchResultPlan({
    properties: [withEvidence(seaView, parsed), withEvidence(forest, parsed)], parsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  const mixedText = renderSearchResultPlan(mixedPlan, null, 'en')
  assertTrue('mixed summary: mentions broader alternative(s)', /broader alternative/i.test(mixedText))
}

// ═══════════════════════════════════════════════════════════════════════
// F. Turkish / Arabic still render (multilingual smoke)
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. multilingual smoke')
line()
{
  const parsed = { lifestyle: ['sea view'], propertyType: 'Apartment' }
  const trCard = renderMatchReasonPlan(buildMatchReasonPlan(withEvidence(forest, parsed), parsed, false, true), 'tr')
  const arCard = renderMatchReasonPlan(buildMatchReasonPlan(withEvidence(forest, parsed), parsed, false, true), 'ar')
  assertTrue('tr unverified card is a non-empty string', typeof trCard === 'string' && trCard.length > 0)
  assertTrue('ar unverified card is a non-empty string', typeof arCard === 'string' && arCard.length > 0)
  assertTrue('tr card does not include the english generic clause', !trCard.includes(genericMatchReasonClause('en')))
}

// ═══════════════════════════════════════════════════════════════════════
// G. Summary names ONLY set-level unmatched criteria (summary/card agreement)
//    — reuses searchEvidence.matchedSoftCriteria/unmatchedSoftCriteria.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. Summary/card evidence consistency')
line()
{
  // Minimal semantic property carrying only what the SUMMARY needs.
  const semProp = (fullyVerified, verified = [], unverified = []) => ({
    propertyType: 'Apartment', title: 't', description: 'd', listingType: 'Sale',
    matchedViaSemantic: true,
    softEvidence: { fullyVerified, verifiedCriteria: verified, unverifiedCriteria: unverified },
  })
  const parsed = { lifestyle: ['sea view', 'near schools', 'family-friendly'], propertyType: 'Apartment' }
  const plan = (props, searchEvidence) => buildSearchResultPlan({
    properties: props, parsed, matchedViaSemantic: true, descriptionSearchAttempted: true, searchEvidence,
  })

  // Test 1 — the exact bug: school+family matched by some, only sea view unmatched.
  const p1 = plan([semProp(false, ['near schools', 'family-friendly'], ['sea view'])],
    { mode: 'semantic', matchedSoftCriteria: ['near schools', 'family-friendly'], unmatchedSoftCriteria: ['sea view'], descriptionQueryVerified: false })
  assertEqual('T1: noneVerified (no property fully verified)', p1.noneVerified, true)
  assertEqual('T1: unmatchedConceptIds = [sea_view] only', p1.unmatchedConceptIds, ['sea_view'])
  assertEqual('T1: hasUnmatchedCriteria true', p1.hasUnmatchedCriteria, true)
  const s1 = renderSearchResultPlan(p1, null, 'en')
  assertTrue('T1: summary names sea view unverified', /sea view/i.test(s1))
  assertTrue('T1: summary does NOT claim school proximity unverified', !/school proximity/i.test(s1))

  // Test 2 — two genuinely unmatched criteria.
  const p2 = plan([semProp(false, ['family-friendly'], ['sea view', 'near schools'])],
    { unmatchedSoftCriteria: ['sea view', 'near schools'], matchedSoftCriteria: ['family-friendly'] })
  assertEqual('T2: unmatchedConceptIds = [sea_view, school]', p2.unmatchedConceptIds, ['sea_view', 'school'])
  const s2 = renderSearchResultPlan(p2, null, 'en')
  assertTrue('T2: summary may name BOTH sea view and school proximity', /sea view/i.test(s2) && /school proximity/i.test(s2))

  // Test 3 — distributed verification (Example C): each criterion met by SOME
  // listing, none unmatched across the set, yet nothing fully verified.
  const p3 = plan([semProp(false, ['sea view'], ['near schools']), semProp(false, ['near schools'], ['sea view'])],
    { unmatchedSoftCriteria: [], matchedSoftCriteria: ['sea view', 'near schools'] })
  assertEqual('T3: noneVerified true', p3.noneVerified, true)
  assertEqual('T3: hasUnmatchedCriteria false', p3.hasUnmatchedCriteria, false)
  const s3 = renderSearchResultPlan(p3, null, 'en')
  assertTrue('T3: summary does NOT say "could not verify"', !/could not verify/i.test(s3))
  assertTrue('T3: summary explains parts matched / none confirms all', /parts of your request/i.test(s3))

  // Test 4 — fully verified result exists: existing wording preserved.
  const p4 = plan([semProp(true, ['sea view'], [])],
    { unmatchedSoftCriteria: [], matchedSoftCriteria: ['sea view'] })
  assertEqual('T4: verifiedCount 1', p4.verifiedCount, 1)
  assertEqual('T4: noneVerified false', p4.noneVerified, false)
  const s4 = renderSearchResultPlan(p4, null, 'en')
  assertTrue('T4: verified summary makes no "could not verify" claim', !/could not verify/i.test(s4))

  // Test 5 — summary and CARD agree (real evidence, not hand-built softEvidence).
  const consistentParsed = { lifestyle: ['sea view', 'near schools'], propertyType: 'Apartment' }
  const cardProp = withEvidence(schoolHome, consistentParsed) // verifies near schools, not sea view
  const p5 = buildSearchResultPlan({
    properties: [cardProp], parsed: consistentParsed, matchedViaSemantic: true, descriptionSearchAttempted: true,
    searchEvidence: { unmatchedSoftCriteria: ['sea view'], matchedSoftCriteria: ['near schools'] },
  })
  const summary5 = renderSearchResultPlan(p5, null, 'en')
  const card5 = renderMatchReasonPlan(buildMatchReasonPlan(cardProp, consistentParsed, false, true), 'en')
  assertTrue('T5: card says near schools (verified)', /near schools/i.test(card5))
  assertTrue('T5: card says sea view could not be confirmed', /could not be confirmed/i.test(card5))
  assertTrue('T5: summary does NOT contradict the card about schools', !/school proximity/i.test(summary5))
  assertTrue('T5: summary names sea view unverified', /sea view/i.test(summary5))

  // Backward-compat: no searchEvidence → old behavior (name all requested concepts).
  const legacy = buildSearchResultPlan({
    properties: [semProp(false, [], ['sea view'])], parsed: { lifestyle: ['sea view'], propertyType: 'Apartment' },
    matchedViaSemantic: true, descriptionSearchAttempted: true,
  })
  assertEqual('legacy: unmatchedConceptIds falls back to requestedConceptIds', legacy.unmatchedConceptIds, ['sea_view'])
  assertEqual('legacy: hasUnmatchedCriteria true', legacy.hasUnmatchedCriteria, true)

  // Full buildReply integration proves the chat.js → buildReply → plan → renderer plumbing.
  const integrated = buildReply({
    properties: [semProp(false, ['near schools', 'family-friendly'], ['sea view'])], parsed,
    matchedViaSemantic: true, descriptionSearchAttempted: true,
    searchEvidence: { unmatchedSoftCriteria: ['sea view'], matchedSoftCriteria: ['near schools', 'family-friendly'] },
    language: 'en',
  })
  assertTrue('integration: buildReply summary names sea view only', /sea view/i.test(integrated) && !/school proximity/i.test(integrated))
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
