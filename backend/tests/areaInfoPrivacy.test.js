// Wave 15B — the location-privacy boundary, asserted where it actually is.
//
// The fixture below deliberately carries a PRIVATE exact coordinate and a
// DIFFERENT public one, so "the exact value never appeared" is a real
// assertion rather than a coincidence of formatting. The boundary is checked
// BEFORE the provider call, not by scrubbing the response afterwards:
// redaction that runs after a network request has already leaked.

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAreaInfoAnswer, detectAreaInfoQuestion } from '../services/areaInfoAnswer.js'
import { publicLocation } from '../routes/properties.js'
import { PROPERTY_SELECT } from '../services/chatPropertySearch.js'
import {
  renderAreaInfoResults,
  renderAreaInfoNoLocation,
  renderAreaInfoNoResults,
  renderAreaInfoProviderError,
  formatPoiDistance,
} from '../services/chatReplyRenderer.js'

/* ── Fixtures ──────────────────────────────────────────────────────────── */

// A listing whose owner PUBLISHED the pin: publicLocation returns it, so it
// is already visible on the public property API and map.
const PUBLISHED_EXACT = { lat: 41.12, lng: 29.65, isApproximate: false, approxRadiusKm: 1 }

// A listing whose owner marked the pin approximate. publicLocation returns
// NO coordinate for this — only the radius — so this exact pair must never
// be used for anything a visitor can observe.
const PRIVATE_EXACT = { lat: 41.123456, lng: 29.654321, isApproximate: true, approxRadiusKm: 2 }

const propertyRow = (title, location) => ({ _id: 'p1', title, status: 'Available', location })

/*
 * Projection-aware, because MongoDB is.
 *
 * An earlier version of this fake treated `.select()` as a no-op chain link,
 * so every fixture came back with `location` attached whether the query asked
 * for it or not. That hid a real bug: the resolver's public projection does
 * NOT include location, so in production the coordinate was always undefined
 * and every nearby question answered "no location". `.select()` here now
 * removes what it was not asked for, and `findOne` exists because the
 * production code reads the coordinate through its own dedicated lookup.
 */
// Applies the same predicates the production query uses, so a document
// the real query would filter out cannot be returned here either.
const matchesFilter = (doc, filter = {}) => {
  if (filter._id !== undefined && String(doc._id) !== String(filter._id)) return false
  if (filter.status !== undefined && doc.status !== filter.status) return false
  if (filter.title instanceof RegExp && !filter.title.test(doc.title)) return false
  return true
}
const applyProjection = (doc, select) => {
  if (!select) return { ...doc }

  const projected = { _id: doc._id }
  for (const field of select.split(/\s+/).filter(Boolean)) {
    if (field in doc) projected[field] = doc[field]
  }
  return projected
}

const modelWith = (rows) => ({
  find(filter) {
    const query = { select: null }
    const chain = {
      select(fields) { query.select = fields; return chain },
      limit: () => chain,
      then: (resolve, reject) => {
        const matched = (filter.title instanceof RegExp
          ? rows.filter((row) => filter.title.test(row.title))
          : rows
        ).map((doc) => applyProjection(doc, query.select))
        return Promise.resolve(matched).then(resolve, reject)
      },
    }
    return chain
  },
  findOne(filter) {
    const query = { select: null }
    const chain = {
      select(fields) { query.select = fields; return chain },
      limit: () => chain,
      then: (resolve, reject) => {
        const doc = rows.find((row) => matchesFilter(row, filter))
        return Promise.resolve(doc ? applyProjection(doc, query.select) : null).then(resolve, reject)
      },
    }
    return chain
  },
})

// Records every coordinate the provider layer is handed.
const recordingPoiFetch = (pois = []) => {
  const calls = []
  const fn = async (args) => {
    calls.push(args)
    return pois
  }
  fn.calls = calls
  return fn
}

const SCHOOLS = [
  { lat: 41.121, lon: 29.651, name: 'Kadıköy Primary' },
  { lat: 41.125, lon: 29.655, name: 'Bosphorus College' },
]

/* ═══════════ 1. publicLocation is the one definition ═══════════ */

test('1a. publicLocation withholds the coordinate of an approximate listing', () => {
  const safe = publicLocation(PRIVATE_EXACT)

  assert.equal(safe.isApproximate, true)
  assert.equal(safe.lat, undefined, 'an approximate listing exposed a latitude')
  assert.equal(safe.lng, undefined, 'an approximate listing exposed a longitude')

  // And it does publish a coordinate the owner chose to publish.
  assert.equal(publicLocation(PUBLISHED_EXACT).lat, 41.12)
})

test('1b. the public projection still has no location field at all', () => {
  for (const field of ['location', 'lat', 'lng', 'descriptionEmbedding']) {
    assert.ok(
      !PROPERTY_SELECT.split(/\s+/).includes(field),
      `${field} was added to the public projection`
    )
  }
})

/* ═══════════ 2. The boundary sits before the network ═══════════ */

test('2a. the provider is handed a category — never a property coordinate', async () => {
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: modelWith([propertyRow('Marina Residence', PUBLISHED_EXACT)]),
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'results')
  assert.equal(fetchPois.calls.length, 1, 'the provider was called more than once')

  // What the provider layer receives, in full.
  const serialized = JSON.stringify(fetchPois.calls[0])
  assert.deepEqual(Object.keys(fetchPois.calls[0]).sort(), ['brand', 'categoryId'])
  for (const leak of ['41.12', '29.65', 'lat', 'lng', 'Marina']) {
    assert.ok(!serialized.includes(leak), `'${leak}' was sent to the POI provider: ${serialized}`)
  }
})

test('2b. an approximate listing stops BEFORE the provider is contacted', async () => {
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: modelWith([propertyRow('Marina Residence', PRIVATE_EXACT)]),
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'no-location', 'a withheld coordinate was used anyway')
  assert.equal(fetchPois.calls.length, 0, 'the provider was contacted for a listing with no public coordinate')
})

test('2c. the private exact pair never appears in the result, in any form', async () => {
  for (const location of [PRIVATE_EXACT, PUBLISHED_EXACT, undefined, null, { lat: 41.1 }]) {
    const result = await buildAreaInfoAnswer({
      message: 'What schools are near Marina Residence?',
      PropertyModel: modelWith([propertyRow('Marina Residence', location)]),
      fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
    })

    const serialized = JSON.stringify(result)
    for (const leak of ['41.123456', '29.654321']) {
      assert.ok(!serialized.includes(leak), `the private coordinate leaked into the result: ${serialized}`)
    }
    // No coordinate key at all reaches the caller.
    assert.ok(!/"lat"|"lng"|"lon"/.test(serialized), `a coordinate key reached the result: ${serialized}`)
  }
})

test('2d. a rendered reply carries names and distances, never coordinates', async () => {
  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: modelWith([propertyRow('Marina Residence', PUBLISHED_EXACT)]),
    fetchPoisForCategoryFn: recordingPoiFetch(SCHOOLS),
  })

  const reply = renderAreaInfoResults(result, 'en')

  assert.match(reply, /Kadıköy Primary/)
  assert.ok(!/41\.\d|29\.\d/.test(reply), `a coordinate appeared in the reply: ${reply}`)
  assert.ok(!reply.includes('overpass'), 'a provider URL appeared in the reply')
})

test('2e. a listing with an unusable stored location is handled, not guessed at', async () => {
  for (const broken of [undefined, null, {}, { lat: 41.1 }, { lat: 'x', lng: 'y' }]) {
    const fetchPois = recordingPoiFetch(SCHOOLS)

    const result = await buildAreaInfoAnswer({
      message: 'What schools are near Marina Residence?',
      PropertyModel: modelWith([propertyRow('Marina Residence', broken)]),
      fetchPoisForCategoryFn: fetchPois,
    })

    assert.equal(result.status, 'no-location', `bad location ${JSON.stringify(broken)} was not caught`)
    assert.equal(fetchPois.calls.length, 0, 'a coordinate was invented for a listing that has none')
  }
})

/* ═══════════ 3. No provider call without a definite target ═══════════ */

test('3a. an ambiguous listing name makes no provider call', async () => {
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Bosphorus Residence?',
    PropertyModel: modelWith([
      propertyRow('Bosphorus Residence A', PUBLISHED_EXACT),
      { _id: 'p2', title: 'Bosphorus Residence B', status: 'Available', location: PUBLISHED_EXACT },
    ]),
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'ambiguous')
  assert.equal(fetchPois.calls.length, 0, 'a POI search ran around a guessed listing')
  assert.equal(result.candidates.length, 2)
})

test('3b. a name we do not carry makes no provider call and invents nothing', async () => {
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Atlantis Palace?',
    PropertyModel: modelWith([]),
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'no-property')
  assert.equal(fetchPois.calls.length, 0)
  // The unknown name is never geocoded into a coordinate and presented as ours.
  assert.ok(!('title' in result), 'a listing title was produced for a name we do not have')
})

test('3c. only publicly available listings can be targeted', async () => {
  const fetchPois = recordingPoiFetch(SCHOOLS)

  const model = {
    find(filter) {
      // The filter must carry the public status; a Sold listing is simply
      // not in the collection this returns.
      assert.equal(filter.status, 'Available', 'the resolver dropped the public status filter')
      const chain = {
        select: () => chain,
        limit: () => chain,
        then: (resolve) => resolve([]),
      }
      return chain
    },
  }

  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Sold Villa?',
    PropertyModel: model,
    fetchPoisForCategoryFn: fetchPois,
  })

  assert.equal(result.status, 'no-property')
  assert.equal(fetchPois.calls.length, 0)
})

/* ═══════════ 4. Provider failure vs genuine absence ═══════════ */

test('4a. an unreachable provider is never reported as an absence of places', async () => {
  const result = await buildAreaInfoAnswer({
    message: 'What hospitals are near Marina Residence?',
    PropertyModel: modelWith([propertyRow('Marina Residence', PUBLISHED_EXACT)]),
    fetchPoisForCategoryFn: async () => { throw new Error('Overpass 503') },
  })

  assert.equal(result.status, 'provider-error')

  const reply = renderAreaInfoProviderError('en')
  assert.match(reply, /couldn't check nearby places/i)
  assert.ok(!/no hospitals|none/i.test(reply), 'a provider outage was worded as an absence')
})

test('4b. a genuine empty radius names the radius it searched', async () => {
  // Provider answered fine, but everything it returned is far away.
  const result = await buildAreaInfoAnswer({
    message: 'What schools are near Marina Residence?',
    PropertyModel: modelWith([propertyRow('Marina Residence', PUBLISHED_EXACT)]),
    fetchPoisForCategoryFn: async () => [{ lat: 40.9, lon: 28.5, name: 'Far Away School' }],
  })

  assert.equal(result.status, 'no-results')
  assert.equal(result.radiusKm, 3)

  const reply = renderAreaInfoNoResults(result, 'en')
  assert.match(reply, /within about 3 km/i, 'the searched radius is not stated')
  assert.match(reply, /Marina Residence/)
})

test('4c. no-location has its own wording, distinct from both', () => {
  const reply = renderAreaInfoNoLocation('Marina Residence', 'en')

  assert.match(reply, /enough location information/i)
  assert.ok(!/no schools|couldn't check/i.test(reply))
})

/* ═══════════ 5. Distance wording ═══════════ */

test('5. distances read as approximate, never survey-grade', () => {
  assert.equal(formatPoiDistance(0.412), '400 m')
  assert.equal(formatPoiDistance(0.697), '700 m')
  assert.equal(formatPoiDistance(1.24), '1.2 km')
  assert.equal(formatPoiDistance(12.349), '12.3 km')

  // Never a false floor of zero, and never a fake decimal metre.
  assert.equal(formatPoiDistance(0.001), '50 m')
  assert.ok(!String(formatPoiDistance(0.697)).includes('.'), 'metres were reported with a decimal')

  for (const bad of [NaN, Infinity, -1, null, undefined, 'x']) {
    assert.equal(formatPoiDistance(bad), null, `a bad distance rendered: ${bad}`)
  }

  // The template says "about".
  const reply = renderAreaInfoResults(
    { title: 'Marina Residence', categoryId: 'school', matches: [{ name: 'A School', distanceKm: 0.697 }] },
    'en'
  )
  assert.match(reply, /about 700 m/)
})

/* ═══════════ 6. Intent — the search/POI split ═══════════ */

test('6. a lifestyle property search is never an area-info question', () => {
  // These must stay with utils/lifestyleConcepts.js and the ordinary search.
  const searches = [
    'Find apartments near schools',
    'find villas near metro',
    'show me flats close to a hospital',
    'I want a house near a park',
    'do you have properties near the metro',
    'show me more',
  ]
  for (const message of searches) {
    assert.equal(detectAreaInfoQuestion(message), null, `wrongly treated as a POI question: ${message}`)
  }

  // These are questions about places around a named target.
  const poiQuestions = [
    'What schools are near Marina Residence?',
    'Are there hospitals near Marina Residence?',
    'Which metro stations are near Sunset Villa?',
    "What's near Marina Residence?",
  ]
  for (const message of poiQuestions) {
    assert.ok(detectAreaInfoQuestion(message), `not recognised as a POI question: ${message}`)
  }
})
