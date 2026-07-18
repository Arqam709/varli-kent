// backend/scripts/testChatPropertySearch.js
//
// Focused characterization tests for services/chatPropertySearch.js.
//
// Sections A-E, H, I need real MongoDB queries (searchWithFallback and
// searchByDescription are thin wrappers around Property.find()), so this
// script connects to the real database and creates a small set of
// dedicated, uniquely-tagged temporary properties (title prefix
// "[STAGE4 TEMP]", district names that cannot collide with real or other
// seeded data) — created once at the top, deleted in a `finally` block
// regardless of pass/fail. No leads are created, no production/user data is
// touched, and chatPropertySearch.js itself never writes anything (every
// function here is a read-only Property.find()).
//
// Sections F and G (pure text-processing helpers) need no DB at all.
//
// Usage: node scripts/testChatPropertySearch.js

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import Property from '../models/Property.js'
import {
  searchWithFallback,
  searchByDescription,
  stripStructuredTerms,
  getRelevanceCheckTerms,
  propertyMatchesSignificantTerm,
  getDescriptionSearchQuery,
  runPropertySearch,
} from '../services/chatPropertySearch.js'

dotenv.config()

const TEMP_PREFIX = '[STAGE4 TEMP]'
// Matches the escaping approach already used by scripts/seedChatbotTestProperties.js.
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TEMP_PREFIX_FILTER = { title: { $regex: `^${escapeRegExp(TEMP_PREFIX)}` } }
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

const assertTrue = (label, condition, detail = '') => {
  if (condition) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}${detail ? ` (${detail})` : ''}`)
  }
}

const idsOf = (properties) => properties.map((p) => String(p._id))

const run = async () => {
  await connectDB()

  // ── fixture setup ─────────────────────────────────────────────────────
  const A_DISTRICT = 'Stage4DistrictA'
  const B_DISTRICT = 'Stage4DistrictB'
  const C1_DISTRICT = 'Stage4DistrictC1'
  const C2_DISTRICT = 'Stage4DistrictC2'
  const E_DISTRICT = 'Stage4DistrictE'
  const H_DISTRICT = 'Stage4DistrictH'

  const base = {
    address: '1 Test St',
    baths: 1,
    sqm: 80,
    status: 'Available',
  }

  const docs = [
    // A: exact match (fallbackLevel 0)
    {
      ...base,
      title: `${TEMP_PREFIX} A Exact Match`,
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: A_DISTRICT,
      price: 1500000,
      beds: 2,
    },
    // B: mustHave enforcement at fallbackLevel 1
    {
      ...base,
      title: `${TEMP_PREFIX} B Villa With Pool`,
      listingType: 'Rent',
      propertyType: 'Villa',
      district: B_DISTRICT,
      price: 50000,
      beds: 4,
      pool: true,
    },
    {
      ...base,
      title: `${TEMP_PREFIX} B Villa No Pool`,
      listingType: 'Rent',
      propertyType: 'Villa',
      district: B_DISTRICT,
      price: 50000,
      beds: 4,
      pool: false,
    },
    // C: district relaxed (fallbackLevel 2) — nothing seeded in C1_DISTRICT
    {
      ...base,
      title: `${TEMP_PREFIX} C Studio`,
      listingType: 'Sale',
      propertyType: 'Studio',
      district: C2_DISTRICT,
      price: 2000000,
      beds: 1,
    },
    // E: shown-property exclusion
    {
      ...base,
      title: `${TEMP_PREFIX} E One`,
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: E_DISTRICT,
      price: 1000000,
      beds: 2,
    },
    {
      ...base,
      title: `${TEMP_PREFIX} E Two`,
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: E_DISTRICT,
      price: 1000000,
      beds: 2,
    },
    // H/I: description search + wrapper orchestration
    {
      ...base,
      title: `${TEMP_PREFIX} H Peaceful Home Near Schools`,
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: H_DISTRICT,
      price: 3000000,
      beds: 3,
      description: 'A peaceful home near several well regarded schools, perfect for families.',
    },
    {
      ...base,
      title: `${TEMP_PREFIX} H Generic Listing`,
      listingType: 'Sale',
      propertyType: 'Apartment',
      district: H_DISTRICT,
      price: 3000000,
      beds: 3,
      description: 'A modern apartment with great value for money.',
    },
  ]

  let inserted = []

  try {
    inserted = await Property.insertMany(docs)
    const byTitle = Object.fromEntries(inserted.map((p) => [p.title, p]))

    // ═══════════════════════════════════════════════════════════════════
    // A. searchWithFallback exact level
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('A. searchWithFallback exact level')
    line()
    {
      const filter = {
        status: 'Available',
        listingType: 'Sale',
        propertyType: 'Apartment',
        district: { $regex: A_DISTRICT, $options: 'i' },
        beds: 2,
        price: { $gte: 1000000, $lte: 2000000 },
      }
      const result = await searchWithFallback(filter, {})
      assertEqual('fallbackLevel === 0', result.fallbackLevel, 0)
      assertEqual(
        'exact fixture returned, alone',
        idsOf(result.properties),
        [String(byTitle[`${TEMP_PREFIX} A Exact Match`]._id)]
      )
    }

    // ═══════════════════════════════════════════════════════════════════
    // B. fallback level 1 (price/beds relaxed, mustHave still enforced)
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('B. fallback level 1')
    line()
    {
      const filter = {
        status: 'Available',
        listingType: 'Rent',
        propertyType: 'Villa',
        district: { $regex: B_DISTRICT, $options: 'i' },
        price: { $gte: 100, $lte: 200 }, // impossible range -> exact search fails
        pool: true,
      }
      const mustHaveFilter = { pool: true }
      const result = await searchWithFallback(filter, mustHaveFilter)
      assertEqual('fallbackLevel === 1', result.fallbackLevel, 1)
      assertEqual(
        'only the pool fixture returned — mustHave stays enforced even after price/beds relax',
        idsOf(result.properties),
        [String(byTitle[`${TEMP_PREFIX} B Villa With Pool`]._id)]
      )
    }

    // ═══════════════════════════════════════════════════════════════════
    // C. fallback level 2 (district relaxed, propertyType retained)
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('C. fallback level 2')
    line()
    {
      const filter = {
        status: 'Available',
        listingType: 'Sale',
        propertyType: 'Studio',
        district: { $regex: C1_DISTRICT, $options: 'i' }, // nothing lives here
      }
      const result = await searchWithFallback(filter, {})
      assertEqual('fallbackLevel === 2', result.fallbackLevel, 2)
      assertEqual(
        'result comes from the other district (C2), same propertyType',
        idsOf(result.properties),
        [String(byTitle[`${TEMP_PREFIX} C Studio`]._id)]
      )
    }

    // ═══════════════════════════════════════════════════════════════════
    // D. final fallback (listingType+propertyType only)
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('D. final fallback')
    line()
    {
      // Empirical precheck rather than an assumption: confirm this
      // listingType+propertyType combination genuinely has zero matches
      // anywhere in the live database (real + seeded), so fallbackLevel 3
      // is guaranteed to be reached with an empty result — this mirrors
      // the current implementation's actual behavior: step3 and step4
      // build byte-identical filters, so fallbackLevel 3 is only ever
      // reached (and only ever returns empty) when step3 already found
      // nothing.
      const zeroMatchCount = await Property.countDocuments({
        status: 'Available',
        listingType: 'Rent',
        propertyType: 'Farm',
      })

      if (zeroMatchCount > 0) {
        console.log(
          `  (skipped) Found ${zeroMatchCount} real Rent/Farm propert(y/ies) in this database — ` +
            'the zero-match assumption for this scenario no longer holds here; skipping D rather than asserting a false premise.'
        )
      } else {
        const filter = {
          status: 'Available',
          listingType: 'Rent',
          propertyType: 'Farm',
          district: { $regex: C1_DISTRICT, $options: 'i' },
        }
        const result = await searchWithFallback(filter, {})
        assertEqual('fallbackLevel === 3', result.fallbackLevel, 3)
        assertEqual(
          'properties empty — step3 and step4 build identical filters in the current implementation',
          result.properties,
          []
        )
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // E. shown-property exclusion
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('E. shown-property exclusion')
    line()
    {
      const eOneId = byTitle[`${TEMP_PREFIX} E One`]._id
      const eTwoId = byTitle[`${TEMP_PREFIX} E Two`]._id

      const baseFilter = {
        status: 'Available',
        listingType: 'Sale',
        propertyType: 'Apartment',
        district: { $regex: E_DISTRICT, $options: 'i' },
      }

      const freshResult = await searchWithFallback(baseFilter, {})
      assertEqual(
        'fresh search (no exclusion) returns both fixtures',
        idsOf(freshResult.properties).sort(),
        [String(eOneId), String(eTwoId)].sort()
      )

      const excludedFilter = { ...baseFilter, _id: { $nin: [eOneId] } }
      const excludedResult = await searchWithFallback(excludedFilter, {})
      assertEqual(
        'excluding E One leaves only E Two',
        idsOf(excludedResult.properties),
        [String(eTwoId)]
      )
    }

    // ═══════════════════════════════════════════════════════════════════
    // F. description query generation (pure, no DB)
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('F. description query generation')
    line()

    assertEqual(
      'structured-term stripping removes listing/property-type words only',
      stripStructuredTerms('a nice apartment for rent near schools'),
      'a nice for near schools'
    )
    assertEqual(
      'concatenates descriptionQuery + lifestyle/mustHave/niceToHave/requirements',
      getDescriptionSearchQuery({ descriptionQuery: 'a broad padded phrase about homes', lifestyle: ['near schools'] }, 'irrelevant'),
      'a broad padded phrase about near schools'
    )
    assertEqual(
      'falls back to descriptionQuery when no tagged phrases exist',
      getDescriptionSearchQuery({ descriptionQuery: 'peaceful home near parks' }, 'irrelevant'),
      'peaceful near parks'
    )
    assertEqual(
      'falls back to the raw message when parsed has nothing at all',
      getDescriptionSearchQuery({}, 'a nice apartment near schools'),
      'a nice near schools'
    )
    assertEqual(
      'cleaning that removes every word falls back to the uncleaned text',
      getDescriptionSearchQuery({ descriptionQuery: 'apartment rent sale' }, ''),
      'apartment rent sale'
    )
    assertEqual(
      'concept keyword expansion (schools -> full school-concept synonym set)',
      getRelevanceCheckTerms({ lifestyle: ['near schools'] }),
      ['school', 'schools', 'educational', 'education', 'kindergarten', 'university', 'campus']
    )
    assertEqual(
      'unknown words are kept literally',
      getRelevanceCheckTerms({ lifestyle: ['modern kitchen'] }),
      ['modern', 'kitchen']
    )
    assertEqual('empty when nothing tagged', getRelevanceCheckTerms({}), [])

    // ═══════════════════════════════════════════════════════════════════
    // G. per-property relevance verification (pure, no DB)
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('G. per-property relevance verification')
    line()

    const prop = (overrides) => ({
      title: 'Sample Title', description: 'Sample description', address: 'Sample address', district: 'Sample district',
      ...overrides,
    })

    assertTrue('title match', propertyMatchesSignificantTerm(prop({ title: 'A home near the metro station' }), ['metro']))
    assertTrue('description match', propertyMatchesSignificantTerm(prop({ description: 'Close to schools and parks' }), ['school']))
    assertTrue('address match', propertyMatchesSignificantTerm(prop({ address: 'Near the sea coast' }), ['coast']))
    assertTrue('district match', propertyMatchesSignificantTerm(prop({ district: 'Kadıköy near the water' }), ['water']))
    assertTrue(
      'concept-word match via toSingular (property says "school", term is "schools")',
      propertyMatchesSignificantTerm(prop({ description: 'Walking distance to the local school' }), ['schools'])
    )
    assertTrue(
      'no significant term present -> rejected',
      propertyMatchesSignificantTerm(prop({ description: 'nothing relevant at all' }), ['golf']) === false
    )
    assertTrue(
      'empty terms array -> not rejected (nothing to verify against)',
      propertyMatchesSignificantTerm(prop({}), []) === true
    )

    // ═══════════════════════════════════════════════════════════════════
    // H. searchByDescription (seeded fixtures)
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('H. searchByDescription')
    line()
    {
      const hardFilter = {
        status: 'Available',
        listingType: 'Sale',
        propertyType: 'Apartment',
        district: { $regex: H_DISTRICT, $options: 'i' },
      }

      const matchResult = await searchByDescription({
        parsed: { descriptionQuery: 'peaceful home near schools', lifestyle: ['near schools'] },
        filter: hardFilter,
        message: 'irrelevant',
      })
      assertEqual('descriptionSearchUsed: true', matchResult.descriptionSearchUsed, true)
      assertEqual('descriptionSearchError: null', matchResult.descriptionSearchError, null)
      assertEqual(
        'only the genuinely-matching property is returned (hard filter + relevance both enforced)',
        idsOf(matchResult.properties),
        [String(byTitle[`${TEMP_PREFIX} H Peaceful Home Near Schools`]._id)]
      )

      const mismatchResult = await searchByDescription({
        parsed: { descriptionQuery: 'a home close to a golf course', lifestyle: ['golf course'] },
        filter: hardFilter,
        message: 'irrelevant',
      })
      assertEqual(
        'query attempted but no verified match -> descriptionSearchUsed: false',
        mismatchResult.descriptionSearchUsed,
        false
      )
      assertEqual('mismatch -> properties: []', mismatchResult.properties, [])
      assertEqual('mismatch -> descriptionSearchError: null (not an error, just no match)', mismatchResult.descriptionSearchError, null)

      const noQueryResult = await searchByDescription({
        parsed: {},
        filter: hardFilter,
        message: '',
      })
      assertEqual('no usable query at all -> descriptionSearchUsed: false', noQueryResult.descriptionSearchUsed, false)
      assertEqual('no usable query -> descriptionSearchQuery: null', noQueryResult.descriptionSearchQuery, null)
      assertEqual('no usable query -> properties: []', noQueryResult.properties, [])
    }

    // ═══════════════════════════════════════════════════════════════════
    // I. runPropertySearch wrapper
    // ═══════════════════════════════════════════════════════════════════
    line()
    console.log('I. runPropertySearch wrapper')
    line()
    {
      const filter = {
        status: 'Available',
        listingType: 'Sale',
        propertyType: 'Apartment',
        district: { $regex: H_DISTRICT, $options: 'i' },
      }

      // No soft-search request -> semantic/description skipped entirely,
      // straight to searchWithFallback.
      const noSoftResult = await runPropertySearch({
        parsed: { listingType: 'Sale', propertyType: 'Apartment' },
        filter,
        mustHaveFilter: {},
        message: 'show me apartments',
      })
      assertEqual('no soft-search request -> descriptionSearchAttempted: false', noSoftResult.descriptionSearchAttempted, false)
      assertEqual('no soft-search request -> matchedViaSemantic: false', noSoftResult.matchedViaSemantic, false)
      assertEqual('no soft-search request -> matchedViaDescription: false', noSoftResult.matchedViaDescription, false)
      assertEqual('no soft-search request -> fallbackLevel: 0 (both H fixtures match structurally)', noSoftResult.fallbackLevel, 0)
      assertEqual(
        'no soft-search request -> both H fixtures returned',
        idsOf(noSoftResult.properties).sort(),
        [String(byTitle[`${TEMP_PREFIX} H Peaceful Home Near Schools`]._id), String(byTitle[`${TEMP_PREFIX} H Generic Listing`]._id)].sort()
      )

      // Soft-search request: semantic is attempted (buildSemanticSearchQuery
      // returns non-empty) but these fixtures have no descriptionEmbedding
      // (deliberately, per the earlier baseline stages' fixture design), so
      // it deterministically returns empty and falls through to
      // searchByDescription, which succeeds — this exercises "semantic
      // empty result allows description search" AND "description success
      // stops fallback" in the same real call.
      const softSuccessResult = await runPropertySearch({
        parsed: { listingType: 'Sale', propertyType: 'Apartment', descriptionQuery: 'peaceful home near schools', lifestyle: ['near schools'] },
        filter,
        mustHaveFilter: {},
        message: 'a peaceful home near schools',
      })
      assertEqual('soft search -> descriptionSearchAttempted: true', softSuccessResult.descriptionSearchAttempted, true)
      assertEqual('semantic yields no results (no embeddings on test fixtures) -> matchedViaSemantic: false', softSuccessResult.matchedViaSemantic, false)
      assertEqual('description search succeeds -> matchedViaDescription: true', softSuccessResult.matchedViaDescription, true)
      assertEqual('description success stops fallback -> fallbackLevel stays 0', softSuccessResult.fallbackLevel, 0)
      assertEqual(
        'only the genuinely matching fixture returned',
        idsOf(softSuccessResult.properties),
        [String(byTitle[`${TEMP_PREFIX} H Peaceful Home Near Schools`]._id)]
      )

      // Soft-search request whose description query matches nothing ->
      // falls all the way through to structured fallback.
      const softMismatchResult = await runPropertySearch({
        parsed: { listingType: 'Sale', propertyType: 'Apartment', descriptionQuery: 'a home close to a golf course', lifestyle: ['golf course'] },
        filter,
        mustHaveFilter: {},
        message: 'a home close to a golf course',
      })
      assertEqual('mismatch -> matchedViaSemantic: false', softMismatchResult.matchedViaSemantic, false)
      assertEqual('mismatch -> matchedViaDescription: false', softMismatchResult.matchedViaDescription, false)
      assertEqual('mismatch -> structured fallback used, fallbackLevel: 0 (fixtures match structurally)', softMismatchResult.fallbackLevel, 0)
      assertEqual(
        'mismatch -> structured fallback returns both H fixtures (same as no-soft-search case)',
        idsOf(softMismatchResult.properties).sort(),
        [String(byTitle[`${TEMP_PREFIX} H Peaceful Home Near Schools`]._id), String(byTitle[`${TEMP_PREFIX} H Generic Listing`]._id)].sort()
      )

      console.log('  (info) "semantic success stops later searches" is NOT covered by a focused test here —')
      console.log('  see report section 14 for why (requires a live, non-deterministic Gemini embedding call).')
    }
  } finally {
    if (inserted.length > 0) {
      const deleted = await Property.deleteMany(TEMP_PREFIX_FILTER)
      console.log('')
      console.log(`Cleaned up ${deleted.deletedCount} temporary "${TEMP_PREFIX}"-prefixed test properties.`)
    }

    line()
    console.log('SUMMARY')
    line()
    console.log(`${passCount} passed, ${failCount} failed`)

    await mongoose.disconnect()
  }

  process.exit(failCount > 0 ? 1 : 0)
}

run().catch(async (err) => {
  console.error(err)
  try {
    await Property.deleteMany(TEMP_PREFIX_FILTER)
  } catch (_) {
    // best-effort cleanup even on crash
  }
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
