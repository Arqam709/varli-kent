// backend/scripts/testSemanticPropertySearch.js
//
// Temporary manual test/calibration script for
// services/propertySemanticSearch.js (Phase 2). Not part of the chatbot
// flow — run directly to sanity check semantic matching, WITH the same
// kind of realistic hard filters buildMongoFilter/
// buildHardFilterForDescriptionSearch would produce, before wiring this
// service into chat.js.
//
// Usage: node scripts/testSemanticPropertySearch.js

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import { searchPropertiesByMeaning } from '../services/propertySemanticSearch.js'

dotenv.config()

const TEST_CASES = [
  {
    label: 'A) Sea-facing rental apartment',
    query: 'sea facing rental apartment',
    hardFilter: { status: 'Available', listingType: 'Rent', propertyType: 'Apartment' },
  },
  {
    label: 'B) Wife wants to see the sea (apartment, any listing type)',
    query: 'my wife wants to see the sea from the apartment',
    hardFilter: { status: 'Available', propertyType: 'Apartment' },
  },
  {
    label: 'C) Near schools for children (apartment)',
    query: 'near schools for my children',
    hardFilter: { status: 'Available', propertyType: 'Apartment' },
  },
  {
    label: 'D) Peaceful family home (any type)',
    query: 'peaceful family home',
    hardFilter: { status: 'Available' },
  },
  {
    label: 'E) Turkish sea view query (any type)',
    query: 'deniz manzaralı ev',
    hardFilter: { status: 'Available' },
  },
]

const run = async () => {
  await connectDB()

  for (const testCase of TEST_CASES) {
    console.log('')
    console.log('='.repeat(70))
    console.log(testCase.label)
    console.log(`QUERY: "${testCase.query}"`)
    console.log(`HARD FILTER: ${JSON.stringify(testCase.hardFilter)}`)
    console.log('-'.repeat(70))

    const results = await searchPropertiesByMeaning({
      query: testCase.query,
      hardFilter: testCase.hardFilter,
    })

    console.log('-'.repeat(70))

    if (results.length === 0) {
      console.log('RETURNED MATCHES: none')
      continue
    }

    console.log('RETURNED MATCHES:')
    results.forEach((property, index) => {
      console.log(
        `  ${index + 1}. ${property.title} — ${property.district} — ${property.listingType} — ` +
          `${property.propertyType} — score: ${property.semanticScore.toFixed(4)}`
      )
    })
  }

  console.log('')
  console.log('='.repeat(70))

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
