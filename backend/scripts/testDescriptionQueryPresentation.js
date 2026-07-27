// backend/scripts/testDescriptionQueryPresentation.js
//
// Presentation-layer fix: descriptionQuery (Gemini's/the fallback parser's
// internal, English-only free-text search phrase) must never be interpolated
// into visitor-facing prose, in any language. This was the exact reported
// bug: a Turkish reply containing "Şununla ilgili detaylar aradım: family
// home near schools." — a raw English internal search phrase leaking into an
// otherwise fully Turkish sentence.
//
// This file proves, deterministically (no DB, no Gemini, no network):
//   - the exact reported Turkish bug is fixed
//   - English and Arabic get the same natural, localized treatment
//   - the generic fallback (no recognized concept id) never leaks English
//   - all four affected sentence slots (soft-match summary, structured
//     mismatch notice, semantic match-reason, description match-reason) are
//     covered in all three languages
//   - descriptionQuery remains completely present and unchanged INSIDE the
//     plan object (internal data, for search/debugging) while never
//     appearing in any RENDERED string
//   - requestedConceptIds (what was searched for) is never conflated with
//     matchedConceptIds/unmatchedConceptIds (what was actually verified) —
//     the core search-honesty requirement
//
// Usage: node scripts/testDescriptionQueryPresentation.js

import { buildSearchResultPlan, buildMatchReasonPlan } from '../services/chatReplyPlan.js'
import { renderSearchResultPlan, renderMatchReasonPlan } from '../services/chatReplyRenderer.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const deepEqual = (a, b) => {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => deepEqual(a[key], b[key]))
}

const assertEqual = (label, actual, expected) => {
  const pass = deepEqual(actual, expected)
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

// ─── Fixtures ────────────────────────────────────────────────────────────
const RAW_BUG_QUERY = 'family home near schools'
const parsedBugReport = {
  descriptionQuery: RAW_BUG_QUERY,
  lifestyle: [RAW_BUG_QUERY],
  listingType: 'Rent',
  propertyType: 'Apartment',
  district: 'Kadıköy',
}
const matchedProperty = {
  _id: 'p1',
  title: 'Family apartment',
  description: 'A cozy family friendly apartment near a great school',
  address: '',
  district: 'Kadıköy',
}

const GENERIC_QUERY = 'modern kitchen with rooftop terrace'
const parsedGeneric = {
  descriptionQuery: GENERIC_QUERY,
  lifestyle: [GENERIC_QUERY],
}
const genericProperty = {
  _id: 'p2',
  title: 'Renovated flat',
  description: 'modern kitchen with rooftop terrace',
  address: '',
  district: 'Kadıköy',
}

line()
console.log('A. Exact reported Turkish bug — descriptionQuery must never appear')
line()

{
  const plan = buildSearchResultPlan({
    properties: [matchedProperty],
    parsed: parsedBugReport,
    matchedViaDescription: true,
    descriptionSearchAttempted: true,
  })

  assertEqual('plan.type is soft_match', plan.type, 'soft_match')
  assertEqual('requestedConceptIds recognizes both family and school', plan.requestedConceptIds.slice().sort(), ['family', 'school'])
  assertEqual('plan.descriptionQuery is unchanged internal data (still the raw English phrase)', plan.descriptionQuery, RAW_BUG_QUERY)

  const tr = renderSearchResultPlan(plan, null, 'tr')
  assertTrue('TR reply does NOT contain the raw English phrase', !tr.includes(RAW_BUG_QUERY))
  assertTrue('TR reply does NOT contain any raw English words from the query ("family", "home", "schools")', !/\bfamily\b|\bhome\b|\bschools\b/i.test(tr))
  assertTrue('TR reply naturally names the family concept', tr.includes('aileler için uygunluk'))
  assertTrue('TR reply naturally names the school concept', tr.includes('okullara yakınlık'))
  console.log(`    TR output: "${tr}"`)

  const en = renderSearchResultPlan(plan, null, 'en')
  assertTrue('EN reply does NOT contain the raw descriptionQuery as a quoted/colon-style search phrase', !en.includes(RAW_BUG_QUERY))
  assertTrue('EN reply avoids search-engine wording ("searched for details related to")', !/searched for details related to/i.test(en))
  assertTrue('EN reply naturally names both concepts', en.includes('family-friendly suitability') && en.includes('school proximity'))
  console.log(`    EN output: "${en}"`)

  const ar = renderSearchResultPlan(plan, null, 'ar')
  assertTrue('AR reply does NOT contain the raw English phrase', !ar.includes(RAW_BUG_QUERY))
  assertTrue('AR reply naturally names both concepts', ar.includes('الملاءمة للعائلات') && ar.includes('القرب من المدارس'))
  console.log(`    AR output: "${ar}"`)
}

line()
console.log('B. Generic fallback — no recognized concept id, still never raw English')
line()

{
  const plan = buildSearchResultPlan({
    properties: [genericProperty],
    parsed: parsedGeneric,
    matchedViaDescription: true,
    descriptionSearchAttempted: true,
  })

  assertEqual('requestedConceptIds is empty (vocabulary outside the 8 concepts)', plan.requestedConceptIds, [])
  assertEqual('plan.descriptionQuery is unchanged internal data', plan.descriptionQuery, GENERIC_QUERY)

  const en = renderSearchResultPlan(plan, null, 'en')
  const tr = renderSearchResultPlan(plan, null, 'tr')
  const ar = renderSearchResultPlan(plan, null, 'ar')

  assertTrue('EN generic fallback uses the shared natural phrase', en.includes('the preferences you described'))
  assertTrue('EN generic fallback never leaks the raw English query', !en.includes(GENERIC_QUERY))
  assertTrue('TR generic fallback uses the shared natural phrase', tr.includes('belirttiğiniz tercihler'))
  assertTrue('TR generic fallback never leaks the raw English query', !tr.includes(GENERIC_QUERY))
  assertTrue('AR generic fallback uses the shared natural phrase', ar.includes('التفضيلات التي وصفتها'))
  assertTrue('AR generic fallback never leaks the raw English query', !ar.includes(GENERIC_QUERY))
}

line()
console.log('C. Structured mismatch notice — all three languages')
line()

{
  const parsed = { ...parsedBugReport, listingType: 'Sale' }
  const plan = buildSearchResultPlan({
    properties: [{ ...matchedProperty, description: 'nothing relevant here' }],
    parsed,
    matchedViaDescription: false,
    matchedViaSemantic: false,
    descriptionSearchAttempted: true,
    fallbackLevel: 1,
  })

  assertEqual('plan.type is structured', plan.type, 'structured')
  assertEqual('structured plan carries requestedConceptIds too', plan.requestedConceptIds.slice().sort(), ['family', 'school'])

  const en = renderSearchResultPlan(plan, null, 'en')
  const tr = renderSearchResultPlan(plan, null, 'tr')
  const ar = renderSearchResultPlan(plan, null, 'ar')

  assertTrue('EN mismatch notice never leaks raw descriptionQuery', !en.includes(RAW_BUG_QUERY))
  assertTrue('EN mismatch notice names the concepts naturally', en.includes('family-friendly suitability') && en.includes('school proximity'))
  assertTrue('TR mismatch notice never leaks raw descriptionQuery', !tr.includes(RAW_BUG_QUERY))
  assertTrue('TR mismatch notice names the concepts naturally', tr.includes('aileler için uygunluk') && tr.includes('okullara yakınlık'))
  assertTrue('AR mismatch notice never leaks raw descriptionQuery', !ar.includes(RAW_BUG_QUERY))
  assertTrue('AR mismatch notice names the concepts naturally', ar.includes('الملاءمة للعائلات') && ar.includes('القرب من المدارس'))
}

line()
console.log('D. Match-reason: semantic generic claim — all three languages')
line()

{
  const property = { title: 'X', description: 'no matching keywords at all', address: '', district: 'Kadıköy' }
  const plan = buildMatchReasonPlan(property, parsedGeneric, false, true)

  assertTrue('semanticGenericClaim fires (no concept confirmed for a semantic match)', plan.semanticGenericClaim)
  assertEqual('plan.descriptionQuery is unchanged internal data', plan.descriptionQuery, GENERIC_QUERY)

  const en = renderMatchReasonPlan(plan, 'en')
  const tr = renderMatchReasonPlan(plan, 'tr')
  const ar = renderMatchReasonPlan(plan, 'ar')

  assertTrue('EN semantic generic claim never leaks raw descriptionQuery', !en.includes(GENERIC_QUERY))
  assertTrue('EN semantic generic claim uses the natural generic clause', en.includes('reflects the preferences you described'))
  assertTrue('TR semantic generic claim never leaks raw descriptionQuery', !tr.includes(GENERIC_QUERY))
  assertTrue('TR semantic generic claim uses the natural generic clause', tr.includes('belirttiğiniz tercihler ile uyumlu'))
  assertTrue('AR semantic generic claim never leaks raw descriptionQuery', !ar.includes(GENERIC_QUERY))
  assertTrue('AR semantic generic claim uses the natural generic clause', ar.includes('يتماشى مع التفضيلات التي وصفتها'))
}

line()
console.log('E. Match-reason: description generic claim — all three languages')
line()

{
  const property = { title: 'X', description: 'no matching keywords at all', address: '', district: 'Kadıköy' }
  const plan = buildMatchReasonPlan(property, parsedGeneric, true, false)

  assertTrue('descriptionGenericClaim fires (no concept requested/confirmed for a description match)', plan.descriptionGenericClaim)

  const en = renderMatchReasonPlan(plan, 'en')
  const tr = renderMatchReasonPlan(plan, 'tr')
  const ar = renderMatchReasonPlan(plan, 'ar')

  assertTrue('EN description generic claim never leaks raw descriptionQuery', !en.includes(GENERIC_QUERY))
  assertTrue('EN description generic claim uses the natural generic clause', en.includes('reflects the preferences you described'))
  assertTrue('TR description generic claim never leaks raw descriptionQuery', !tr.includes(GENERIC_QUERY))
  assertTrue('TR description generic claim uses the natural generic clause', tr.includes('belirttiğiniz tercihler ile uyumlu'))
  assertTrue('AR description generic claim never leaks raw descriptionQuery', !ar.includes(GENERIC_QUERY))
  assertTrue('AR description generic claim uses the natural generic clause', ar.includes('يتماشى مع التفضيلات التي وصفتها'))
}

line()
console.log('F. Search-honesty: requestedConceptIds (searched for) vs matchedConceptIds (verified)')
line()

{
  // Property text confirms "family" but has no school-related words at all —
  // requestedConceptIds still names BOTH (that is what was asked for), but
  // the per-property match-reason must only ever claim what THIS property's
  // own evidence actually confirmed.
  const familyOnlyProperty = {
    title: 'Family apartment',
    description: 'A cozy family friendly apartment in a quiet building',
    address: '',
    district: 'Kadıköy',
    listingType: 'Rent',
    propertyType: 'Apartment',
  }
  const parsed = { ...parsedBugReport }

  const searchPlan = buildSearchResultPlan({
    properties: [familyOnlyProperty],
    parsed,
    matchedViaDescription: true,
    descriptionSearchAttempted: true,
  })
  assertEqual('summary-level requestedConceptIds still names both requested concepts', searchPlan.requestedConceptIds.slice().sort(), ['family', 'school'])

  const reasonPlan = buildMatchReasonPlan(familyOnlyProperty, parsed, true, false)
  assertEqual('per-property matchedConceptIds only contains the concept THIS property actually confirmed (family)', reasonPlan.matchedConceptIds, ['family'])
  assertTrue('school is not in matchedConceptIds', !reasonPlan.matchedConceptIds.includes('school'))

  const enReason = renderMatchReasonPlan(reasonPlan, 'en')
  const trReason = renderMatchReasonPlan(reasonPlan, 'tr')
  const arReason = renderMatchReasonPlan(reasonPlan, 'ar')

  assertTrue('EN match-reason claims family was matched', enReason.includes('is family-friendly'))
  assertTrue('EN match-reason never claims school was matched ("is near schools")', !enReason.includes('is near schools'))
  assertTrue('TR match-reason claims family was matched', trReason.includes('aileler için uygun'))
  assertTrue('TR match-reason never claims school was matched ("okullara yakın")', !trReason.includes('okullara yakın'))
  assertTrue('AR match-reason claims family was matched', arReason.includes('مناسب للعائلات'))
  assertTrue('AR match-reason never claims school was matched ("قريب من المدارس")', !arReason.includes('قريب من المدارس'))

  console.log(`    EN match-reason: "${enReason}"`)
  console.log(`    TR match-reason: "${trReason}"`)
  console.log(`    AR match-reason: "${arReason}"`)
}

line()
console.log('G. Purity — no mutation of plan objects/arrays')
line()

{
  const parsed = { ...parsedBugReport }
  const parsedSnapshotBefore = JSON.stringify(parsed)

  const plan = buildSearchResultPlan({
    properties: [matchedProperty],
    parsed,
    matchedViaDescription: true,
    descriptionSearchAttempted: true,
  })

  renderSearchResultPlan(plan, null, 'tr')
  renderSearchResultPlan(plan, null, 'en')
  renderSearchResultPlan(plan, null, 'ar')

  assertEqual('parsed input object is not mutated by buildSearchResultPlan/renderSearchResultPlan', JSON.stringify(parsed), parsedSnapshotBefore)

  const requestedConceptIdsSnapshot = [...plan.requestedConceptIds]
  renderSearchResultPlan(plan, null, 'tr')
  assertEqual('plan.requestedConceptIds array is not mutated by rendering', plan.requestedConceptIds, requestedConceptIdsSnapshot)

  const reasonPlan = buildMatchReasonPlan(matchedProperty, parsed, true, false)
  const reasonPlanSnapshot = JSON.stringify(reasonPlan)
  renderMatchReasonPlan(reasonPlan, 'tr')
  renderMatchReasonPlan(reasonPlan, 'en')
  renderMatchReasonPlan(reasonPlan, 'ar')
  assertEqual('match-reason plan object is not mutated by rendering', JSON.stringify(reasonPlan), reasonPlanSnapshot)
}

line()
console.log('H. descriptionQuery stays internal — present in plan data, absent from every rendered string')
line()

{
  const parsed = { ...parsedBugReport }
  const searchPlan = buildSearchResultPlan({
    properties: [matchedProperty],
    parsed,
    matchedViaDescription: true,
    descriptionSearchAttempted: true,
  })
  const reasonPlan = buildMatchReasonPlan(matchedProperty, parsed, true, false)

  assertEqual('search-result plan.descriptionQuery is present and unchanged (internal/search data)', searchPlan.descriptionQuery, RAW_BUG_QUERY)
  assertEqual('match-reason plan.descriptionQuery is present and unchanged (internal/search data)', reasonPlan.descriptionQuery, RAW_BUG_QUERY)

  for (const lang of ['en', 'tr', 'ar']) {
    assertTrue(`rendered search-result summary (${lang}) never contains raw descriptionQuery`, !renderSearchResultPlan(searchPlan, null, lang).includes(RAW_BUG_QUERY))
    assertTrue(`rendered match-reason (${lang}) never contains raw descriptionQuery`, !renderMatchReasonPlan(reasonPlan, lang).includes(RAW_BUG_QUERY))
  }
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
