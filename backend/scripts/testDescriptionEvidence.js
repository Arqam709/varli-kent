// backend/scripts/testDescriptionEvidence.js
//
// Focused, fully deterministic tests for services/descriptionEvidence.js —
// no DB, no Gemini, no network. Proves that evidence-unit coverage replaces
// the old "any one token overlapped => verified" behavior, and works
// generically for arbitrary open-ended requirements with no per-requirement
// vocabulary.
//
// Usage: node scripts/testDescriptionEvidence.js

import {
  buildEvidenceUnits,
  computeDescriptionCoverage,
  evaluateDescriptionEvidence,
  propertyVerifiesDescription,
  propertyEvidenceText,
  evaluateRequestEvidence,
} from '../services/descriptionEvidence.js'

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

// A requirement expressed the way Gemini tags it (short lifestyle phrase).
// verified(query, description) = does this property lexically verify it?
const verified = (queryPhrase, description) => {
  const units = buildEvidenceUnits({ lifestyle: [queryPhrase] })
  return propertyVerifiesDescription({ description }, units)
}

const coverageOf = (queryPhrase, description) => {
  const units = buildEvidenceUnits({ lifestyle: [queryPhrase] })
  return computeDescriptionCoverage(units, description)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('A. Required false positives — must all be false')
line()

assertEqual('"suitable for a music studio" vs "suitable for first-time buyers"', verified('suitable for a music studio', 'suitable for first-time buyers'), false)
assertEqual('"property near a veterinary hospital" vs "property near local shops"', verified('property near a veterinary hospital', 'property near local shops'), false)
assertEqual('"wheelchair-friendly common areas" vs "family-friendly common areas"', verified('wheelchair-friendly common areas', 'family-friendly common areas'), false)
assertEqual('"rooftop cinema" vs "rooftop terrace"', verified('rooftop cinema', 'a building with a rooftop terrace'), false)
assertEqual('weak-only requirement "suitable" vs "suitable for a small family"', verified('suitable', 'suitable for a small family'), false)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('B. Required positives — must all be true')
line()

assertEqual('"music studio" vs "professional music studio with acoustic treatment"', verified('music studio', 'professional music studio with acoustic treatment'), true)
assertEqual('"near a veterinary hospital" vs "veterinary clinic and animal hospital"', verified('near a veterinary hospital', 'five minutes from a veterinary clinic and animal hospital'), true)
assertEqual('"soundproof" vs "a soundproof room"', verified('soundproof', 'a soundproof room'), true)
assertEqual('"rooftop cinema" vs "private rooftop cinema with projector"', verified('rooftop cinema', 'private rooftop cinema with projector'), true)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('C. Phrase / adjacency reporting')
line()

{
  const c = coverageOf('rooftop cinema', 'private rooftop cinema with projector')
  assertEqual('exact phrase -> phraseMatched true', c.phraseMatched, true)
  assertEqual('exact phrase -> full coverage', c.coverageRatio, 1)
  assertEqual('exact phrase -> verified', evaluateDescriptionEvidence(c).verified, true)
}
{
  const c = coverageOf('rooftop cinema', 'rooftop terrace')
  assertEqual('partial overlap -> phraseMatched false', c.phraseMatched, false)
  assertEqual('partial overlap -> coverage 1/2 = 0.5', c.coverageRatio, 0.5)
  assertEqual('strict majority: 0.5 is NOT enough -> not verified', evaluateDescriptionEvidence(c).verified, false)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('D. Lexical vs semantic boundary (documented: paraphrase is semantic’s job)')
line()

// "music studio" vs a paraphrase covers only 1 of 2 units. The lexical layer
// correctly does NOT verify; the pipeline relies on semantic search for this.
assertEqual(
  '"music studio" vs "sound-insulated recording room designed for music production" -> lexically unverified',
  verified('music studio', 'sound-insulated recording room designed for music production'),
  false
)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('E. Known-concept regression (multilingual surface forms preserved)')
line()

assertEqual('school concept vs English "close to schools"', verified('near schools', 'close to good schools and parks'), true)
assertEqual('school concept vs Turkish "okul"', verified('near schools', 'okul ve parka yakın konum'), true)
assertEqual('school concept vs Arabic "مدرسة"', verified('near schools', 'قريب من مدرسة وحديقة'), true)
assertEqual('family concept English', verified('family friendly', 'a family friendly community for children'), true)
assertEqual('peaceful/safe concept English', verified('peaceful and safe', 'a quiet, secure and safe neighborhood'), true)
assertEqual('sea view concept English', verified('sea view', 'stunning sea view over the bay'), true)
assertEqual('metro/transport concept English', verified('near metro', 'two minutes from the metro station'), true)
assertEqual('concept NOT present -> not verified', verified('near schools', 'a quiet villa with a large garden'), false)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('F. Unit construction: studio preserved, weak words dropped, dedup')
line()

assertEqual(
  '"music studio" keeps BOTH music and studio units',
  buildEvidenceUnits({ lifestyle: ['music studio'] }).map((u) => u.id),
  ['music', 'studio']
)
assertEqual(
  'weak evaluative words never become units',
  buildEvidenceUnits({ lifestyle: ['suitable ideal perfect great nice music'] }).map((u) => u.id),
  ['music']
)
assertEqual('weak-only phrase -> zero units', buildEvidenceUnits({ lifestyle: ['suitable and ideal'] }), [])
assertEqual(
  'duplicate tokens do not create duplicate units',
  buildEvidenceUnits({ lifestyle: ['cinema cinema rooftop'] }).map((u) => u.id),
  ['cinema', 'rooftop']
)
{
  const units = buildEvidenceUnits({ lifestyle: ['near schools'] })
  assertEqual('a concept token yields a single concept unit', units.length, 1)
  assertEqual('concept unit id is the concept id', units[0].id, 'school')
  assertEqual('concept unit is flagged isConcept', units[0].isConcept, true)
  assertTrue('concept unit carries multilingual surface forms', units[0].surfaceForms.includes('okul') && units[0].surfaceForms.includes('مدرسة'))
}
{
  const units = buildEvidenceUnits({ lifestyle: ['rooftop cinema'] })
  assertEqual('token unit is not flagged as concept', units[0].isConcept, false)
}

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('G. evaluateDescriptionEvidence rule + reasons')
line()

assertEqual('zero units -> not verified, stable reason', evaluateDescriptionEvidence({ totalUnits: 0, coveredCount: 0 }), { verified: false, reason: 'no-evidence-units' })
assertEqual('single unit covered (1/1 > 0.5) -> verified', evaluateDescriptionEvidence({ totalUnits: 1, coveredCount: 1 }), { verified: true, reason: 'majority-unit-coverage' })
assertEqual('2/3 majority -> verified', evaluateDescriptionEvidence({ totalUnits: 3, coveredCount: 2 }), { verified: true, reason: 'majority-unit-coverage' })
assertEqual('1/2 (exactly 0.5) -> NOT verified (strict)', evaluateDescriptionEvidence({ totalUnits: 2, coveredCount: 1 }), { verified: false, reason: 'insufficient-unit-coverage' })
assertEqual('phrase match short-circuits to verified', evaluateDescriptionEvidence({ totalUnits: 4, coveredCount: 1, phraseMatched: true }), { verified: true, reason: 'phrase-adjacency-match' })

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('H. Coverage facts shape + no cross-word substring false match')
line()

{
  const c = coverageOf('near a veterinary hospital', 'veterinary clinic and animal hospital')
  assertEqual('totalUnits', c.totalUnits, 2)
  assertEqual('coveredCount', c.coveredCount, 2)
  assertEqual('coverageRatio', c.coverageRatio, 1)
  assertEqual('coveredUnitIds', c.coveredUnitIds.sort(), ['hospital', 'veterinary'])
  assertEqual('unmatchedUnitIds', c.unmatchedUnitIds, [])
}
// "art" must NOT match "apartment" (old substring bug).
assertEqual('token "art" does not match "apartment"', verified('art gallery', 'a spacious apartment downtown'), false)

// ═══════════════════════════════════════════════════════════════════════
line()
console.log('I. Purity, determinism, and complexity guards')
line()

{
  const parsed = { lifestyle: ['rooftop cinema'], descriptionQuery: 'rooftop cinema' }
  const snapshot = JSON.stringify(parsed)
  buildEvidenceUnits(parsed)
  assertEqual('buildEvidenceUnits does not mutate parsed', JSON.stringify(parsed), snapshot)
}
{
  const units = buildEvidenceUnits({ lifestyle: ['rooftop cinema'] })
  const unitsSnapshot = JSON.stringify(units)
  const property = { description: 'private rooftop cinema' }
  const propSnapshot = JSON.stringify(property)
  computeDescriptionCoverage(units, propertyEvidenceText(property))
  assertEqual('computeDescriptionCoverage does not mutate units', JSON.stringify(units), unitsSnapshot)
  assertEqual('computeDescriptionCoverage does not mutate property', JSON.stringify(property), propSnapshot)
}
{
  const a = verified('rooftop cinema', 'private rooftop cinema')
  const b = verified('rooftop cinema', 'private rooftop cinema')
  assertEqual('deterministic: identical inputs -> identical output', a, b)
}
assertEqual('empty parsed -> zero units -> unverified safely', evaluateDescriptionEvidence(computeDescriptionCoverage(buildEvidenceUnits({}), 'anything at all')).verified, false)
{
  // Duplicate surface forms in a unit must not inflate coverage past 1 per unit.
  const c = computeDescriptionCoverage([{ id: 'x', surfaceForms: ['room', 'room', 'rooms'], isConcept: false }], 'a room with a room')
  assertEqual('duplicate surface forms count as one covered unit', c.coveredCount, 1)
}

// ═══════════════════════════════════════════════════════════════════════
// J. evaluateRequestEvidence — Change B: honest request-level soft-criteria
// evidence across a returned set (used for the SEMANTIC path). Phrase-level
// criteria, verified via evidence units; descriptionQueryVerified = every
// requested criterion confirmed by the returned set.
// ═══════════════════════════════════════════════════════════════════════
line()
console.log('J. evaluateRequestEvidence (semantic request-level evidence)')
line()

// The reported parsed request (post Change A).
const musicStudioParsed = {
  propertyType: 'Villa',
  descriptionQuery: 'house with music studio soundproof room sea view',
  mustHave: ['music studio', 'soundproof room'],
  niceToHave: ['sea view'],
  lifestyle: ['sea view'],
  requirements: ['music studio', 'soundproof room'],
}

// Test A — semantic candidate confirms only sea view.
{
  const properties = [{ propertyType: 'Villa', title: 'Sea View Villa', description: 'Large villa with panoramic sea views, garden and private parking.' }]
  const e = evaluateRequestEvidence(musicStudioParsed, properties)
  assertEqual('Test A: requested criteria are the distinct phrases (deduped)', e.requestedSoftCriteria.slice().sort(), ['music studio', 'sea view', 'soundproof room'].sort())
  assertEqual('Test A: only sea view confirmed', e.matchedSoftCriteria, ['sea view'])
  assertEqual('Test A: music studio + soundproof room unmatched', e.unmatchedSoftCriteria.slice().sort(), ['music studio', 'soundproof room'].sort())
  assertEqual('Test A: descriptionQueryVerified is NOT blindly true', e.descriptionQueryVerified, false)
}

// Test B — complete explicit candidate verifies every criterion.
{
  const properties = [{ propertyType: 'Villa', title: 'Studio Villa', description: 'A sea view villa with a professional music studio and a soundproof room.' }]
  const e = evaluateRequestEvidence(musicStudioParsed, properties)
  assertEqual('Test B: nothing unmatched', e.unmatchedSoftCriteria, [])
  assertEqual('Test B: all criteria matched', e.matchedSoftCriteria.slice().sort(), ['music studio', 'sea view', 'soundproof room'].sort())
  assertEqual('Test B: descriptionQueryVerified true', e.descriptionQueryVerified, true)
}

// Test C — paraphrase: lexical evidence does not confirm "music studio".
{
  const parsed = { descriptionQuery: 'music studio', requirements: ['music studio'] }
  const properties = [{ description: 'A sound-insulated recording room designed for music production.' }]
  const e = evaluateRequestEvidence(parsed, properties)
  assertEqual('Test C: music studio not lexically confirmed', e.unmatchedSoftCriteria, ['music studio'])
  assertEqual('Test C: descriptionQueryVerified false (semantic keeps candidate; lexical does not confirm)', e.descriptionQueryVerified, false)
}

// Test D — known multilingual concept confirmed via TR/AR surface forms.
{
  const parsed = { lifestyle: ['near schools'] }
  assertEqual('Test D (TR): school confirmed via "okul"', evaluateRequestEvidence(parsed, [{ description: 'okula yakın, okul ve park' }]).matchedSoftCriteria, ['near schools'])
  assertEqual('Test D (AR): school confirmed via "مدرسة"', evaluateRequestEvidence(parsed, [{ description: 'قريب من مدرسة وحديقة' }]).matchedSoftCriteria, ['near schools'])
  assertEqual('Test D: absent -> unmatched', evaluateRequestEvidence(parsed, [{ description: 'a quiet garden villa' }]).unmatchedSoftCriteria, ['near schools'])
}

// Test E — no soft requirement: nothing to verify, safe.
{
  const parsed = { propertyType: 'Villa', beds: 3, district: 'Beylikdüzü' }
  const e = evaluateRequestEvidence(parsed, [{ description: 'a 3-bed villa' }])
  assertEqual('Test E: no requested soft criteria', e.requestedSoftCriteria, [])
  assertEqual('Test E: no false unmatched criteria', e.unmatchedSoftCriteria, [])
  assertEqual('Test E: trivially verified (nothing to verify)', e.descriptionQueryVerified, true)
}

// Aggregate + dedup + purity guards.
{
  // "matched if ANY returned property confirms it" — sea view in property 2.
  const props = [
    { description: 'a plain villa with a garden' },
    { description: 'a villa with a wonderful sea view' },
  ]
  const e = evaluateRequestEvidence({ lifestyle: ['sea view'] }, props)
  assertEqual('aggregate: criterion matched if ANY property confirms it', e.matchedSoftCriteria, ['sea view'])
}
{
  // A weak-only phrase produces no verifiable units -> not a criterion.
  const e = evaluateRequestEvidence({ lifestyle: ['suitable'] }, [{ description: 'suitable for anyone' }])
  assertEqual('weak-only phrase is not a criterion', e.requestedSoftCriteria, [])
  assertEqual('weak-only -> trivially verified', e.descriptionQueryVerified, true)
}
{
  const parsed = { mustHave: ['music studio'], requirements: ['music studio'] }
  const snapshot = JSON.stringify(parsed)
  const props = [{ description: 'x' }]
  const propsSnapshot = JSON.stringify(props)
  evaluateRequestEvidence(parsed, props)
  assertEqual('evaluateRequestEvidence does not mutate parsed', JSON.stringify(parsed), snapshot)
  assertEqual('evaluateRequestEvidence does not mutate properties', JSON.stringify(props), propsSnapshot)
  assertEqual('duplicate phrase across mustHave+requirements counted once', evaluateRequestEvidence(parsed, props).requestedSoftCriteria, ['music studio'])
}

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
