// Wave 15A, Part B — resolving a named listing against our own inventory.
//
// The properties under test: a model can never decide which listing is meant,
// user text can never become a regex, ambiguity is reported rather than
// guessed at, a lookup failure is never reported as "no such listing", and
// nothing outside the public projection can reach a reply.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  escapeRegex,
  extractTitlePhrase,
  findTitleMatches,
  normalizeTitle,
  resolvePropertyByName,
} from '../services/propertyNameResolver.js'

import { PROPERTY_SELECT } from '../services/chatPropertySearch.js'

/* ── A stand-in for the Mongoose model, recording exactly what was asked ── */

const fakeModel = (rows, options = {}) => {
  const calls = []

  const model = {
    calls,
    find(filter) {
      const call = { filter, select: null, limit: null }
      calls.push(call)

      const chain = {
        select(fields) { call.select = fields; return chain },
        limit(n) { call.limit = n; return chain },
        then(resolve, reject) {
          if (options.throwOn && options.throwOn(filter)) {
            return Promise.reject(new Error('connection lost')).then(resolve, reject)
          }
          return Promise.resolve(rows(filter, call)).then(resolve, reject)
        },
      }
      return chain
    },
  }

  return model
}

const property = (id, title, extra = {}) => ({ _id: id, title, status: 'Available', ...extra })

const INVENTORY = [
  property('p1', 'Marina Residence', { price: 450000, priceLabel: 'USD', district: 'Kadıköy', beds: 3, parking: true }),
  property('p2', 'Bosphorus Residence A'),
  property('p3', 'Bosphorus Residence B'),
  property('p4', 'Kadıköy Modern Residence'),
  property('p5', 'Sunset Villa', { parking: false }),
]

// Text-index behaviour, approximated: any row sharing a word with the phrase.
const textSearch = (phrase) => {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean)
  return INVENTORY.filter((row) => words.some((word) => row.title.toLowerCase().includes(word)))
}

const inventoryModel = (extra = {}) =>
  fakeModel((filter) => {
    if (filter.title instanceof RegExp) return INVENTORY.filter((row) => filter.title.test(row.title))
    if (filter.$text) return textSearch(filter.$text.$search)
    return INVENTORY
  }, extra)

/* ═══════════ 1. Extraction — when is this even a title question ═══════════ */

test('1a. explicit specific-listing phrasing is extracted, in all three languages', () => {
  const cases = [
    ['Tell me about Marina Residence', 'Marina Residence'],
    ['tell me about Marina Residence.', 'Marina Residence'],
    ['Show me Bosphorus View Apartment', 'Bosphorus View Apartment'],
    ['How much is Sunset Villa?', 'Sunset Villa'],
    ["What's the price of Marina Residence?", 'Marina Residence'],
    ['Details about Marina Residence', 'Marina Residence'],
    ['Marina Residence hakkında bilgi', 'Marina Residence'],
    ['Sunset Villa ne kadar?', 'Sunset Villa'],
    ['أخبرني عن Marina Residence', 'Marina Residence'],
    ['كم سعر Sunset Villa', 'Sunset Villa'],
  ]

  for (const [message, expected] of cases) {
    assert.equal(extractTitlePhrase(message), expected, `bad extraction for: ${message}`)
  }
})

test('1b. an ordinary requirements search is NOT a title question', () => {
  // The important half. "Kadıköy Modern Residence" is a real listing title,
  // so a search whose words overlap it must still be a search.
  const searches = [
    'Find modern apartments in Kadıköy',
    'I want a 3 bedroom villa with a pool',
    'apartments in Kadıköy under 500000',
    'show me more',
    'do you have anything with parking',
    'what documents do I need to buy property in Turkey',
    '',
    '   ',
  ]

  for (const message of searches) {
    assert.equal(extractTitlePhrase(message), null, `wrongly treated as a title question: ${message}`)
  }
})

test('1c. no extraction means no database call at all', async () => {
  const model = inventoryModel()
  const result = await resolvePropertyByName('Find modern apartments in Kadıköy', model)

  assert.equal(result.status, 'not-a-title-question')
  assert.equal(model.calls.length, 0, 'an ordinary search paid for a resolver query')
})

/* ═══════════ 2. Normalization ═══════════ */

test('2a. folds case, spacing and punctuation only', () => {
  assert.equal(normalizeTitle('  Marina   Residence  '), 'marina residence')
  assert.equal(normalizeTitle('MARINA RESIDENCE'), 'marina residence')
  assert.equal(normalizeTitle('Marina-Residence!'), 'marina residence')
  // Turkish İ folds before lowercasing, so it matches a plain i.
  assert.equal(normalizeTitle('İstanbul Residence'), 'istanbul residence')
})

test('2b. never merges genuinely different listings', () => {
  // The explicit warning case: a distinguishing final token must survive.
  assert.notEqual(normalizeTitle('Bosphorus Residence A'), normalizeTitle('Bosphorus Residence B'))
  assert.notEqual(normalizeTitle('Marina Residence'), normalizeTitle('Marina Residence 2'))
})

/* ═══════════ 3. Matching ═══════════ */

test('3a. an exact normalized title wins outright over a longer superset', () => {
  const rows = [property('a', 'Bosphorus Residence'), property('b', 'Bosphorus Residence Annex')]

  const matches = findTitleMatches('bosphorus residence', rows)
  assert.equal(matches.length, 1, 'an exactly named listing was reported as ambiguous')
  assert.equal(matches[0]._id, 'a')
})

test('3b. a short phrase must match in full, not partially', () => {
  // Donor rule: one shared word out of two is far too loose across a
  // catalogue of titles.
  assert.deepEqual(findTitleMatches('Marina Tower', [property('a', 'Marina Residence')]), [])
  assert.equal(findTitleMatches('Marina Residence', [property('a', 'Marina Residence')]).length, 1)
})

test('3c. a longer phrase needs a strict majority of its tokens', () => {
  const rows = [property('a', 'Bosphorus View Luxury Apartment')]

  assert.equal(findTitleMatches('Bosphorus View Luxury', rows).length, 1)
  assert.deepEqual(findTitleMatches('Something Totally Different Entirely', rows), [])
})

/* ═══════════ 4. Regex safety ═══════════ */

test('4a. every regex metacharacter is escaped', () => {
  assert.equal(escapeRegex('a+b'), 'a\\+b')
  assert.equal(escapeRegex('(a+)+$'), '\\(a\\+\\)\\+\\$')
  assert.equal(escapeRegex('.*'), '\\.\\*')
})

test('4b. hostile input becomes a literal, never an expression', async () => {
  const model = inventoryModel()
  await resolvePropertyByName('Tell me about (a+)+$', model)

  const regexCall = model.calls.find((call) => call.filter.title instanceof RegExp)
  assert.ok(regexCall, 'no anchored title lookup was made')

  const pattern = regexCall.filter.title
  // It matches the literal text and nothing else — in particular it does not
  // treat the input as a quantifier group.
  assert.ok(pattern.test('(a+)+$'), 'the escaped pattern no longer matches its own literal')
  assert.ok(!pattern.test('aaaaaaaaaa'), 'user input was executed as a regular expression')
})

test('4c. the text-index path passes a search string, not an expression', async () => {
  const model = inventoryModel()
  await resolvePropertyByName('Tell me about $where this', model)

  for (const call of model.calls) {
    if (!call.filter.$text) continue
    assert.equal(typeof call.filter.$text.$search, 'string', '$search stopped being a plain string')
  }
  // No operator injection reached the filter.
  const serialized = JSON.stringify(model.calls.map((call) => call.filter))
  assert.ok(!serialized.includes('"$where"'), '$where reached the query')
})

/* ═══════════ 5. Resolution outcomes ═══════════ */

test('5a. an exact title resolves to exactly one listing', async () => {
  const result = await resolvePropertyByName('Tell me about Marina Residence', inventoryModel())

  assert.equal(result.status, 'resolved')
  assert.equal(result.property._id, 'p1')
  assert.equal(result.property.title, 'Marina Residence')
})

test('5b. case and surrounding whitespace still resolve', async () => {
  for (const message of ['tell me about   marina residence  ', 'Tell me about MARINA RESIDENCE']) {
    const result = await resolvePropertyByName(message, inventoryModel())
    assert.equal(result.status, 'resolved', `did not resolve: ${message}`)
    assert.equal(result.property._id, 'p1')
  }
})

test('5c. an ambiguous name reports candidates instead of guessing', async () => {
  const result = await resolvePropertyByName('Tell me about Bosphorus Residence', inventoryModel())

  assert.equal(result.status, 'ambiguous', 'a listing was silently chosen')
  const titles = result.candidates.map((candidate) => candidate.title).sort()
  assert.deepEqual(titles, ['Bosphorus Residence A', 'Bosphorus Residence B'])
})

test('5d. a name we do not carry resolves to nothing, and invents nothing', async () => {
  const result = await resolvePropertyByName('Tell me about Atlantis Palace Tower', inventoryModel())

  assert.equal(result.status, 'none')
  assert.equal(result.phrase, 'Atlantis Palace Tower')
  assert.ok(!('property' in result), 'a property was returned for a name we do not have')
})

test('5e. a failed lookup is reported as an error, never as "no such listing"', async () => {
  const model = inventoryModel({ throwOn: () => true })
  const result = await resolvePropertyByName('Tell me about Marina Residence', model)

  assert.equal(result.status, 'error', 'a database failure was reported as an empty inventory')
  assert.notEqual(result.status, 'none')
})

/* ═══════════ 6. Eligibility and privacy ═══════════ */

test('6a. only publicly available listings are ever queried', async () => {
  const model = inventoryModel()
  await resolvePropertyByName('Tell me about Marina Residence', model)

  assert.ok(model.calls.length > 0)
  for (const call of model.calls) {
    assert.equal(call.filter.status, 'Available', `a query omitted the public status filter: ${JSON.stringify(call.filter)}`)
  }
})

test('6b. the projection is the public one, and excludes location', async () => {
  const model = inventoryModel()
  await resolvePropertyByName('Tell me about Marina Residence', model)

  for (const call of model.calls) {
    assert.equal(call.select, PROPERTY_SELECT, 'the resolver uses its own projection')
  }
  // Wave 9: exact coordinates must not be selectable through this path.
  for (const field of ['location', 'lat', 'lng', 'descriptionEmbedding']) {
    assert.ok(!PROPERTY_SELECT.split(/\s+/).includes(field), `${field} is in the public projection`)
  }
})

test('6c. every query is bounded', async () => {
  const model = inventoryModel()
  await resolvePropertyByName('Tell me about Some Name That Does Not Exist', model)

  for (const call of model.calls) {
    assert.equal(typeof call.limit, 'number', 'an unbounded query could load the collection')
    assert.ok(call.limit <= 25, `a query limit of ${call.limit} is too large`)
  }
})

test('6d. resolution is read-only', async () => {
  // The fake model exposes only `find`. Any write would throw here, so a
  // passing run is itself the assertion — plus an explicit check that no
  // write-shaped method was reached for.
  const model = inventoryModel()
  for (const method of ['create', 'updateOne', 'findOneAndUpdate', 'deleteOne', 'save']) {
    assert.equal(model[method], undefined)
  }

  const result = await resolvePropertyByName('Tell me about Marina Residence', model)
  assert.equal(result.status, 'resolved')
})

/* ═══════════ 7. Property facts come from the database ═══════════ */

test('7. resolved facts are the stored values, with absence left absent', async () => {
  const result = await resolvePropertyByName('How much is Marina Residence?', inventoryModel())
  const resolved = result.property

  // Price and district are whatever the record holds — no model, no FX.
  assert.equal(resolved.price, 450000)
  assert.equal(resolved.priceLabel, 'USD')
  assert.equal(resolved.district, 'Kadıköy')

  // Booleans keep all three states. The one that matters: a field the listing
  // never set stays undefined, so a renderer can say "not specified" rather
  // than turning silence into "no".
  assert.equal(resolved.parking, true)

  const villa = (await resolvePropertyByName('How much is Sunset Villa?', inventoryModel())).property
  assert.equal(villa.parking, false, 'an explicit false was lost')
  assert.equal(villa.beds, undefined, 'an unset field was materialised into a value')
  assert.ok(!('beds' in villa) || villa.beds === undefined, 'absence was collapsed into a default')
})
