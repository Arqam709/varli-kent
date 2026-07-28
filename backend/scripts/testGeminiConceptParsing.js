// backend/scripts/testGeminiConceptParsing.js
//
// Phase C observation/test script — calls parsePropertyMessageWithGemini
// directly, bypassing the /chat route and routes/chat.js entirely, so this
// never touches live chatbot behavior. Purpose: see whether Gemini reliably
// returns the new structured-meaning fields (lifestyleConcepts,
// excludedConcepts, changedMind, noPreference, propertyTypes,
// uncertainPropertyType) before any future phase wires them into
// search/memory logic.
//
// Usage: node scripts/testGeminiConceptParsing.js

import dotenv from 'dotenv'
import { parsePropertyMessageWithGemini } from '../utils/geminiPropertyParser.js'
import { isValidConceptId } from '../utils/lifestyleConcepts.js'

dotenv.config()

const TEST_CASES = [
  { label: '1) Sea view via family context', message: 'my wife wants to see the sea from the apartment' },
  { label: '2) Sea view, structured phrasing', message: 'sea facing rental apartment' },
  { label: '3) Sea view, Turkish', message: 'deniz manzaralı ev' },
  { label: '4) School + family concept', message: 'near schools for my children' },
  { label: '5) Peaceful + family concept', message: 'peaceful family home' },
  { label: '6) Exclusion + changed mind', message: 'sea view is not important anymore, schools are more important' },
  { label: '7) No preference', message: 'no preference, show me what you have' },
  { label: '8) Uncertain property type', message: 'buy but I am not sure apartment or villa' },
  { label: '9) Peaceful + family (safe for kids)', message: 'I want a safe place for my kids' },
  { label: '10) Investment concept', message: 'I want something good for investment' },
  { label: '11) Exclusion + park concept', message: 'actually I do not care about metro anymore, I want parks nearby' },
  { label: '12) Control: plain structured search (no lifestyle content)', message: 'I want to rent an apartment in Beylikdüzü budget 20000' },
  { label: '13) Control: casual chat (all new fields should stay default)', message: 'how are you?' },
]

const NEW_FIELDS = [
  'lifestyleConcepts',
  'excludedConcepts',
  'changedMind',
  'noPreference',
  'propertyTypes',
  'uncertainPropertyType',
]

const checkConceptIds = (label, fieldName, ids = []) => {
  const invalid = ids.filter((id) => !isValidConceptId(id))
  if (invalid.length > 0) {
    console.log(`  ⚠ ${fieldName} contains INVALID concept id(s): ${JSON.stringify(invalid)}`)
  }
}

const run = async () => {
  for (const testCase of TEST_CASES) {
    console.log('')
    console.log('='.repeat(70))
    console.log(testCase.label)
    console.log(`MESSAGE: "${testCase.message}"`)
    console.log('-'.repeat(70))

    const parsed = await parsePropertyMessageWithGemini(testCase.message, [])

    if (!parsed) {
      console.log('  RESULT: null (Gemini call failed or API key missing)')
      continue
    }

    console.log('  New structured-meaning fields:')
    for (const field of NEW_FIELDS) {
      console.log(`    ${field}: ${JSON.stringify(parsed[field])}`)
    }

    checkConceptIds(testCase.label, 'lifestyleConcepts', parsed.lifestyleConcepts)
    checkConceptIds(testCase.label, 'excludedConcepts', parsed.excludedConcepts)

    console.log('  Existing fields (sanity check — should look normal/unaffected):')
    console.log(`    intentType: ${parsed.intentType}, replyType: ${parsed.replyType}`)
    console.log(`    listingType: ${parsed.listingType}, propertyType: ${parsed.propertyType}`)
    console.log(`    descriptionQuery: ${JSON.stringify(parsed.descriptionQuery)}`)
    console.log(`    lifestyle: ${JSON.stringify(parsed.lifestyle)}`)
  }

  console.log('')
  console.log('='.repeat(70))
  console.log('Done. This script never touched routes/chat.js or the live /chat route.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
