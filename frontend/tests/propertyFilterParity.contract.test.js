// Public property filter parity with the reference sidebar.
//
// ── Why this file exists ────────────────────────────────────────────────
// The reference project's Properties page exposes 41 filters. This one exposes
// all of them except `hasVideo`, which is deliberately absent (see below), and
// it exposes them through a stricter backend: allow-listed enums instead of raw
// $in, a validated day-count for "listed since" instead of new Date() on
// arbitrary input, and no map bounding-box parameters at all.
//
// Three of them — heating, parking, buildingAge — were single-value selects
// here until recently, so asking for "Central OR Floor Heating" was impossible.
// They are any-of multi-selects now, which is the one genuine functional gap
// the comparison turned up.
//
// The contracts below pin the reference's filter list so a filter cannot be
// dropped by accident, and pin the query-string shape, because a multi-select
// that serialises as `heating[]=A` instead of `heating=A&heating=B` silently
// stops filtering while still looking correct in the UI.
//
// Static source contracts, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const readSrc = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')
const readBackend = async (...p) => readFile(join(here, '..', '..', 'backend', ...p), 'utf8')
const propertiesPage = () => readSrc('pages', 'PropertiesPage.jsx')

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const loadTranslations = async () => {
  const raw = await readSrc('locales', 'translations.js')
  const mod = { exports: {} }
  new Function('module', 'exports', raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = '))(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

/**
 * Every filter the reference sidebar exposes, transcribed from its state
 * declarations. The value is the query parameter it sends.
 */
const REFERENCE_FILTERS = [
  'listingType', 'district', 'propertyType', 'minPrice', 'maxPrice', 'rooms',
  'minSqm', 'maxSqm', 'minNetSqm', 'maxNetSqm', 'minOpenArea', 'maxOpenArea',
  'floor', 'floorLocation', 'totalFloors', 'baths',
  'heating', 'kitchenType', 'parking', 'buildingAge',
  'minCoefficient', 'maxCoefficient',
  'furnished', 'balcony', 'elevator', 'pool', 'garden',
  'sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement',
  'nearbyTransport', 'usageStatus', 'withinSite', 'eligibleForCredit',
  'titleDeedStatus', 'exchange', 'hasVirtualTour', 'listedSince',
]

/**
 * Deliberately NOT carried over.
 *
 * hasVideo: the reference implements it as a $regex over every entry of the
 * images array, matching .mp4/.mov/.webm/.avi or "/video/". There is no video
 * field on the schema here, and uploads go to a CDN whose URLs often carry no
 * extension at all — so the filter would quietly miss real videos while
 * running an unanchored regex over every document. It is a heuristic standing
 * in for data that does not exist, not a feature.
 */
const REJECTED = ['hasVideo']

/** Filters the reference sends as repeated keys (any-of multi-selects). */
const REFERENCE_MULTI = [
  'floorLocation', 'heating', 'kitchenType', 'parking',
  'buildingAge', 'nearbyTransport', 'usageStatus', 'titleDeedStatus',
]

/* ══════════════ EVERY REFERENCE FILTER IS PRESENT ══════════════ */

test('the query builder sends every reference filter', async () => {
  const src = await propertiesPage()
  const start = src.indexOf('const queryString = useMemo')
  assert.notEqual(start, -1, 'the query builder was not found')
  const builder = src.slice(start, src.indexOf('return params.toString()', start))

  // The nine tri-state amenity/legal filters are emitted by a loop over the
  // `triState` object rather than named individually, so they are checked
  // against that object's membership lists instead of the builder text.
  const src2 = src
  const triStateMembers = new Set([
    ...[...(/const TRISTATE_AMENITIES = \[([^\]]*)\]/.exec(src2)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    ...[...(/const TRISTATE_LEGAL = \[([^\]]*)\]/.exec(src2)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    'hasVirtualTour',
  ])
  assert.ok(/for \(const \[field, value\] of Object\.entries\(triState\)\) setIf\(field, value\)/.test(builder),
    'the tri-state filters are no longer emitted into the query string')

  const missing = REFERENCE_FILTERS.filter(
    (f) => !new RegExp(`(setIf|appendAll)\\('${f}'`).test(builder) && !triStateMembers.has(f)
  )

  assert.deepEqual(missing, [],
    `these reference filters are never sent to the API: ${missing.join(', ')}`)
})

test('the reference filter list was not quietly trimmed', async () => {
  assert.equal(REFERENCE_FILTERS.length, 40,
    'the reference filter list changed size — re-audit the reference sidebar first')
  assert.equal(new Set(REFERENCE_FILTERS).size, REFERENCE_FILTERS.length,
    'the reference filter list has a duplicate')
})

test('every filter sent is one the backend actually reads', async () => {
  const routes = await readBackend('routes', 'properties.js')
  const destructured = /const \{([\s\S]*?)\} = req\.query/.exec(routes)
  assert.ok(destructured, 'the route no longer destructures req.query')

  const read = new Set(
    destructured[1].split(/[,\s]+/).map((w) => w.replace(/\/\/.*/, '').trim()).filter(Boolean)
  )

  // A filter the UI sends but the route never reads is a control that appears
  // to work and silently does nothing.
  const ignored = REFERENCE_FILTERS.filter((f) => !read.has(f))
  assert.deepEqual(ignored, [],
    `the UI sends these but the route ignores them: ${ignored.join(', ')}`)
})

/* ══════════════ THE THREE THAT BECAME MULTI-SELECT ══════════════ */

for (const field of ['heating', 'parking', 'buildingAge']) {
  test(`${field} is an any-of multi-select end to end`, async () => {
    const src = await propertiesPage()
    const routes = await readBackend('routes', 'properties.js')

    // Restored from EVERY repeated key, not just the first.
    assert.ok(new RegExp(`searchParams\\.getAll\\('${field}'\\)`).test(src),
      `${field} is restored with get() — a shared link would lose all but one value`)
    // Serialised as repeated keys, which is what the route normalises.
    assert.ok(new RegExp(`appendAll\\('${field}'`).test(src),
      `${field} is still sent with set() — a second value would overwrite the first`)
    assert.equal(new RegExp(`setIf\\('${field}'`).test(src), false,
      `${field} is still sent as a single value`)
    // Rendered as a checkbox group, not a <select>.
    assert.ok(new RegExp(`multiSelect\\(instanceId, '${field}'`).test(src),
      `${field} is not rendered as a multi-select control`)
    // Allow-listed server-side.
    assert.ok(new RegExp(`applyEnumFilter\\(filter, '${field}'`).test(routes),
      `${field} is not run through the allow-listed enum filter`)
  })
}

/** String-literal members of a `const <name> = [ ... ]` array. */
const listOf = (text, name) => {
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text)
  assert.ok(m, `${name} not found`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** The canonical twelve, as the route defines them. */
const routeCanonicalAges = (routes) => listOf(routes, 'BUILDING_AGES_CANONICAL')

/** The retired three, accepted for old links but offered nowhere. */
const routeDeprecatedAges = (routes) => listOf(routes, 'BUILDING_AGES_DEPRECATED')

/** Everything the route will accept: canonical + deprecated. */
const routeBuildingAges = (routes) => {
  assert.ok(/const BUILDING_AGES = \[\.\.\.BUILDING_AGES_CANONICAL, \.\.\.BUILDING_AGES_DEPRECATED\]/.test(routes),
    'BUILDING_AGES is no longer the canonical + deprecated union')
  return [...routeCanonicalAges(routes), ...routeDeprecatedAges(routes)]
}

/** The twelve canonical buckets, in order. */
const CANONICAL_AGES = ['0', '1', '2', '3', '4', '5', '6-10', '11-15', '16-20', '21-25', '26-30', '31+']

/** Retired here, still accepted by the route so old links keep working. */
const DEPRECATED_AGES = ['0 (New)', '1-5', '21+']

test('heating and parking agree across editor, filter and route', async () => {
  const admin = await readSrc('pages', 'AdminProperties.jsx')
  const src = await propertiesPage()
  const routes = await readBackend('routes', 'properties.js')

  // Three copies of each list, so all three have to be checked against each
  // other. A value the editor can store but the filter cannot offer is an
  // unreachable listing; a value the filter offers but the route rejects is a
  // checkbox that silently returns nothing.
  for (const [adminName, uiName, routeName] of [
    ['HEATING_OPTIONS', 'HEATING', 'HEATING_OPTIONS'],
    ['PARKING_OPTIONS', 'PARKING', 'PARKING_OPTIONS'],
  ]) {
    const inEditor = listOf(admin, adminName)
    const inFilter = listOf(src, uiName)
    const inRoute = listOf(routes, routeName)

    assert.deepEqual(inFilter, inEditor,
      `${uiName}: the filter and the editor offer different values`)
    assert.deepEqual(inRoute, inEditor,
      `${routeName}: the route allow-list has drifted from the editor`)
  }
})

test('the canonical twelve are the vocabulary everywhere a value is chosen', async () => {
  const admin = await readSrc('pages', 'AdminProperties.jsx')
  const src = await propertiesPage()
  const routes = await readBackend('routes', 'properties.js')
  const assistant = await readBackend('routes', 'propertyAssistant.js')
  const chat = await readBackend('locales', 'chatParsingVocabulary.js')

  // Four surfaces decide what a value can BE: the editor that saves it, the
  // filter that offers it, the assistant that suggests it, and the chat
  // vocabulary that parses it. All four must agree exactly.
  assert.deepEqual(listOf(admin, 'BUILDING_AGE_OPTIONS'), CANONICAL_AGES, 'admin editor')
  assert.deepEqual(listOf(src, 'BUILDING_AGE'), CANONICAL_AGES, 'public filter')
  assert.deepEqual(listOf(assistant, 'BUILDING_AGE_OPTIONS'), CANONICAL_AGES, 'AI assistant')
  assert.deepEqual(routeCanonicalAges(routes), CANONICAL_AGES, 'route canonical list')

  // The chat buckets carry maxYears as well, so compare just the labels.
  const chatLabels = [...chat.matchAll(/\{ label: '([^']+)', maxYears:/g)].map((m) => m[1])
  assert.deepEqual(chatLabels, CANONICAL_AGES, 'chat vocabulary')
})

test('the retired buckets are accepted by the route and offered nowhere', async () => {
  const admin = await readSrc('pages', 'AdminProperties.jsx')
  const src = await propertiesPage()
  const routes = await readBackend('routes', 'properties.js')
  const assistant = await readBackend('routes', 'propertyAssistant.js')

  assert.deepEqual(routeDeprecatedAges(routes), DEPRECATED_AGES,
    'the deprecated list changed — old shared links depend on exactly these three')

  // Accepted, so an old link or a listing saved just before the switch resolves.
  for (const retired of DEPRECATED_AGES) {
    assert.ok(routeBuildingAges(routes).includes(retired),
      `the route stopped accepting '${retired}' — old links break`)
  }

  // But never offered as a choice: a visitor must not be asked to pick between
  // '1-5' and '3' as if they were alternatives.
  for (const retired of DEPRECATED_AGES) {
    assert.equal(listOf(admin, 'BUILDING_AGE_OPTIONS').includes(retired), false,
      `the editor offers the retired bucket '${retired}'`)
    assert.equal(listOf(src, 'BUILDING_AGE').includes(retired), false,
      `the public filter offers the retired bucket '${retired}'`)
    assert.equal(listOf(assistant, 'BUILDING_AGE_OPTIONS').includes(retired), false,
      `the assistant can still file a new listing under '${retired}'`)
  }
})

test('the retired buckets are not described as the newer system', async () => {
  const routes = await readBackend('routes', 'properties.js')
  const chat = await readBackend('locales', 'chatParsingVocabulary.js')

  // The comments here previously argued the twelve were unusable because no
  // listing carried one. That reasoning was retired with the vocabulary.
  for (const [label, text] of [['the route', routes], ['the chat vocabulary', chat]]) {
    assert.equal(/no listing in this database carries one/.test(text), false,
      `${label} still carries the obsolete "nothing uses these" argument`)
    assert.equal(/BUILDING_AGES_LEGACY/.test(text), false,
      `${label} still calls the canonical buckets "legacy"`)
  }
})

test('the assistant prompt no longer maps a stated age onto a retired bucket', async () => {
  const assistant = await readBackend('routes', 'propertyAssistant.js')

  // The old prompt said: stated ages 1-5 to "1-5", 21 or more to "21+".
  // Leaving it would have the model fight the vocabulary it is handed.
  assert.equal(/stated ages 1-5 to "1-5"/.test(assistant), false,
    'the prompt still folds every age from 1 to 5 into one retired bucket')
  assert.equal(/21 or more to "21\+"/.test(assistant), false,
    'the prompt still maps everything past 21 onto the retired unbounded bucket')
  assert.ok(/31 or more to "31\+"/.test(assistant),
    'the prompt does not tell the model where the top bucket starts')
})

/* ══════════════ THE VALUES ACTUALLY IN THE SHARED DATABASE ══════════════ */

/*
 * This deployment shares one MongoDB database with a second front-end that
 * ships a longer vocabulary. A read-only audit of the live collection found
 * these values already stored, none of which the lists here could reach:
 *
 *   heating     'Combi Boiler (Natural Gas)'   1 listing
 *   parking     'Open & Covered Parking'       1 listing
 *   parking     '1 covered parking spot'       1 listing  <- free text, not canonical
 *   buildingAge '11-15'                        1 listing  (was already covered)
 *
 * These are fixtures, not a live query: the suite must not depend on a database
 * connection. They pin the outcome of that audit so the vocabularies cannot
 * narrow back and strand the same listings again.
 */
const LIVE_VALUES = [
  ['heating', 'HEATING', 'Combi Boiler (Natural Gas)'],
  ['parking', 'PARKING', 'Open & Covered Parking'],
]

for (const [field, uiName, value] of LIVE_VALUES) {
  test(`a listing stored with ${field} '${value}' is reachable`, async () => {
    const admin = await readSrc('pages', 'AdminProperties.jsx')
    const src = await propertiesPage()
    const routes = await readBackend('routes', 'properties.js')
    const t = await loadTranslations()

    assert.ok(listOf(src, uiName).includes(value),
      `the filter cannot offer '${value}', so that listing can never be found`)
    assert.ok(listOf(admin, `${uiName}_OPTIONS`).includes(value),
      `the editor cannot reproduce '${value}', so re-saving that listing would lose it`)
    assert.ok(listOf(routes, `${uiName}_OPTIONS`).includes(value),
      `the route's allow-list drops '${value}' before it reaches Mongo`)

    for (const lang of LANGS) {
      assert.ok(t[lang]?.adminPages?.properties?.[`${field}Options`]?.[value],
        `${lang}: '${value}' has no label`)
    }
  })
}

test('every canonical bucket is reachable end to end', async () => {
  const src = await propertiesPage()
  const routes = await readBackend('routes', 'properties.js')
  const offered = listOf(src, 'BUILDING_AGE')
  const accepted = routeBuildingAges(routes)

  for (const bucket of CANONICAL_AGES) {
    assert.ok(offered.includes(bucket), `the filter does not offer '${bucket}'`)
    assert.ok(accepted.includes(bucket), `the route does not accept '${bucket}'`)
  }

  // 11-15 is the one value a listing in the database actually carries, and it
  // survived the vocabulary change unchanged.
  assert.ok(offered.includes('11-15') && accepted.includes('11-15'))
})

test('the building-age labels cover all twelve in all six languages', async () => {
  const t = await loadTranslations()

  for (const lang of LANGS) {
    const labels = t[lang]?.adminPages?.properties?.buildingAgeOptions
    assert.ok(labels, `${lang}: buildingAgeOptions is missing`)
    assert.deepEqual(Object.keys(labels).sort(), [...CANONICAL_AGES].sort(),
      `${lang}: buildingAgeOptions does not cover exactly the canonical twelve`)

    const values = Object.values(labels)
    assert.equal(new Set(values).size, values.length,
      `${lang}: two buckets share a label`)
    for (const [key, value] of Object.entries(labels)) {
      assert.ok(typeof value === 'string' && value.trim(), `${lang}: label for '${key}' is blank`)
    }
  }
})

test('the free-text parking value was NOT made canonical', async () => {
  const admin = await readSrc('pages', 'AdminProperties.jsx')
  const src = await propertiesPage()
  const routes = await readBackend('routes', 'properties.js')

  // One listing stores '1 covered parking spot'. It is prose, not a category,
  // and it belongs in no vocabulary — that listing needs correcting by hand.
  // Adding it here would enshrine bad data as a permanent option.
  const bad = '1 covered parking spot'
  for (const [label, text] of [['the editor', admin], ['the filter', src], ['the route', routes]]) {
    assert.equal(text.includes(bad), false,
      `${label} lists '${bad}' as a parking option — it is free text, not a category`)
  }
})

test('no value was aliased away instead of being carried', async () => {
  const routes = await readBackend('routes', 'properties.js')
  const heating = listOf(routes, 'HEATING_OPTIONS')
  const parking = listOf(routes, 'PARKING_OPTIONS')

  // Both members of each pair must exist independently. Folding one into the
  // other would rewrite what a listing actually says: 'Open & Covered Parking'
  // plausibly means both kinds of space exist, which is a third state.
  assert.ok(heating.includes('Combi Boiler (Natural Gas)') && heating.includes('Individual Gas'),
    'Combi Boiler and Individual Gas were merged — they are distinct appliances')
  assert.ok(parking.includes('Open & Covered Parking') && parking.includes('Open Parking'),
    'Open & Covered Parking was merged into Open Parking — that discards the "both" case')

  // And no alias/normalisation table crept in.
  assert.equal(/HEATING_ALIAS|PARKING_ALIAS|normalizeHeating|normalizeParking/.test(routes), false,
    'a silent normalisation table appeared — stored meaning must be preserved')
})

test('the new option labels exist in all six languages', async () => {
  const t = await loadTranslations()

  for (const map of ['heatingOptions', 'parkingOptions', 'buildingAgeOptions']) {
    const en = t.en?.adminPages?.properties?.[map]
    assert.ok(en && Object.keys(en).length, `${map} is missing in English`)

    for (const lang of LANGS) {
      const labels = t[lang]?.adminPages?.properties?.[map]
      assert.ok(labels, `${lang}: ${map} is missing — the checkboxes fall back to English`)
      assert.deepEqual(Object.keys(labels).sort(), Object.keys(en).sort(),
        `${lang}: ${map} covers different option values than English`)
      for (const [key, value] of Object.entries(labels)) {
        assert.ok(typeof value === 'string' && value.trim(), `${lang}: ${map}['${key}'] is blank`)
      }
    }
  }
})

test('the canonical values are sent, never the translated labels', async () => {
  const src = await propertiesPage()
  const t = await loadTranslations()

  // The label map is display-only; the checkbox value stays the English
  // canonical the schema stores.
  assert.ok(/labelMap\?\.\[option\] \|\| option/.test(src),
    'the multi-select no longer separates the display label from the submitted value')

  const translated = new Set()
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    for (const map of ['heatingOptions', 'parkingOptions']) {
      for (const v of Object.values(t[lang].adminPages.properties[map])) translated.add(v)
    }
  }
  const heating = /const HEATING = \[([^\]]*)\]/.exec(src)[1]
  for (const value of [...heating.matchAll(/'([^']+)'/g)].map((m) => m[1])) {
    assert.equal(translated.has(value), false,
      `'${value}' is a localized label, not a canonical filter value`)
  }
})

/* ══════════════ RESET, URL, PAGINATION ══════════════ */

test('reset clears every filter, including the three new arrays', async () => {
  const src = await propertiesPage()
  const start = src.indexOf('const clearFilters = ')
  assert.notEqual(start, -1, 'clearFilters not found')
  const resetEnd = src.indexOf('setSearchParams({})', start)
  assert.notEqual(resetEnd, -1, 'reset no longer clears the address bar')
  const reset = src.slice(start, resetEnd + 'setSearchParams({})'.length)

  for (const field of ['heating', 'parking', 'buildingAge']) {
    const setter = `set${field[0].toUpperCase()}${field.slice(1)}`
    assert.ok(new RegExp(`${setter}\\(\\[\\]\\)`).test(reset),
      `${field} is reset to '' rather than [] — a stale value would survive the reset`)
  }
  assert.ok(/setSearchParams\(\{\}\)/.test(reset), 'reset no longer clears the address bar')
})

test('one query string drives both the request and the address bar', async () => {
  const src = await propertiesPage()

  // Two separate serialisers would let the URL and the request disagree.
  assert.ok(/api\.get\(`\/properties\$\{queryString \? '\?' \+ queryString : ''\}`\)/.test(src),
    'the request no longer uses the shared query string')
  assert.ok(/setSearchParams\(queryString, \{ replace: true \}\)/.test(src),
    'the address bar no longer follows the shared query string')
})

/* ══════════════ WHAT WAS DELIBERATELY NOT COPIED ══════════════ */

test('hasVideo was not revived', async () => {
  const src = await propertiesPage()
  const routes = await readBackend('routes', 'properties.js')

  for (const field of REJECTED) {
    assert.equal(src.includes(field), false,
      `${field} appeared in the filter UI — there is no schema field behind it`)
    assert.equal(routes.includes(field), false,
      `${field} appeared in the route — it would be a regex heuristic, not a real filter`)
  }
})

test('no public map bounding-box filter exists', async () => {
  const routes = await readBackend('routes', 'properties.js')
  const src = await propertiesPage()

  // The reference accepts minLat/maxLat/minLng/maxLng on the public list. Exact
  // coordinates are deliberately private here, and a bounding box can be
  // binary-searched to recover one.
  for (const param of ['minLat', 'maxLat', 'minLng', 'maxLng']) {
    assert.equal(new RegExp(`\\b${param}\\b`).test(routes), false,
      `${param} appeared on the public property route — it leaks exact location by probing`)
    assert.equal(src.includes(param), false, `${param} appeared in the filter UI`)
  }
})

test('the public list still hides private location and internal fields', async () => {
  const routes = await readBackend('routes', 'properties.js')

  assert.ok(/withPublicLocation/.test(routes), 'the public location mask is gone')
  assert.ok(/PUBLIC_PROPERTY_EXCLUDE/.test(routes), 'the public projection is gone')
})

test('enum filters are allow-listed rather than passed to $in raw', async () => {
  const routes = await readBackend('routes', 'properties.js')

  // The reference does `{ $in: toArray(v) }` with no validation, so a crafted
  // query string can put an object inside $in.
  assert.equal(/\$in: toArray\(/.test(routes), false,
    'a raw client array reaches $in — enum filters must go through the allow-list')
  assert.ok(/allowed\.includes\(value\)/.test(routes),
    'applyEnumFilter no longer checks values against the allow-list')
})

test('listedSince is parsed, not handed to new Date()', async () => {
  const routes = await readBackend('routes', 'properties.js')

  assert.ok(/parseListedSince/.test(routes), 'the listedSince parser is gone')
  assert.equal(/createdAt = \{ \$gte: new Date\(listedSince\) \}/.test(routes), false,
    'listedSince is passed straight to new Date() — an unparseable value reaches Mongo')
})
