// Field parity with the reference property editor.
//
// ── Why this file exists ────────────────────────────────────────────────
// The reference project's Add/Edit Property form carries 48 fields. This one
// carries all 48, but they do not all live in the same place: the reference
// keeps everything in one flat `form` object, while here the optional detail
// fields live in a separate `details` object on purpose (so a blank optional
// number is omitted from the request rather than sent as '') and the map pin
// lives in its own `location` state (so an untouched pin is omitted rather
// than overwritten).
//
// That split is deliberate and worth keeping, but it makes "did we drop a
// field?" impossible to answer by eye. So the reference's field list is pinned
// here verbatim, and every entry must resolve to one of the three CURRENT
// stores — or to a documented, justified substitution.
//
// There is exactly ONE substitution: the reference's free-text `agentName` is
// replaced by `agent`, a User id pointing at a real account, from which the
// server derives the agent's name and email. That is a deliberate upgrade, not
// a gap, and it is asserted as such below.
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
const adminProperties = () => readSrc('pages', 'AdminProperties.jsx')

/**
 * The reference editor's complete field list, transcribed from its emptyForm.
 * `location` is its nested pin object; its four inner keys are covered by the
 * location contract rather than listed individually.
 */
const REFERENCE_FIELDS = [
  'title', 'listingType', 'price', 'priceLabel', 'currency', 'district', 'address', 'propertyType',
  'beds', 'baths', 'sqm', 'netSqm', 'openAreaSqm', 'description',
  'agentName', 'agentPhone', 'agentEmail', 'whatsappNumber',
  'featured', 'status',
  'rooms', 'floor', 'floorLocation', 'totalFloors', 'buildingAge', 'coefficient',
  'heating', 'kitchenType', 'parking',
  'furnished', 'balcony', 'elevator', 'pool', 'garden',
  'sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement',
  'nearbyTransport', 'usageStatus', 'withinSite', 'eligibleForCredit', 'titleDeedStatus', 'exchange',
  'hasVirtualTour', 'virtualTourUrl',
  'location',
]

/** The one intentional substitution: free-text name -> assigned User id. */
const SUBSTITUTIONS = { agentName: 'agent' }

/**
 * Keys of a top-level `const <name> = { ... }` object literal.
 *
 * Brace-matched rather than scanned to the next "\n}": emptyForm is written on
 * a single line, so a naive scan runs straight past it and swallows every
 * object declared below — including the label maps, which repeat the same field
 * names. A field genuinely deleted from emptyDetails would still look present.
 */
const objectKeys = (src, name) => {
  const start = src.indexOf(`const ${name} = {`)
  assert.notEqual(start, -1, `${name} not found`)

  const open = src.indexOf('{', start)
  let depth = 0
  let end = -1
  let quote = null
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (quote) {
      if (ch === quote && src[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  assert.notEqual(end, -1, `${name} has no closing brace`)

  const body = src
    .slice(open, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/^\s*\/\/.*$/gm, ' ')        // line comments
  return new Set([...body.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((m) => m[1]))
}

/** Every field this editor can hold, across its three deliberate stores. */
const currentFields = async () => {
  const src = await adminProperties()
  const all = new Set([...objectKeys(src, 'emptyForm'), ...objectKeys(src, 'emptyDetails')])
  // The map pin is its own state machine, not a key in either object.
  if (/const LOCATION_NONE/.test(src)) all.add('location')
  return all
}

/* ══════════════ EVERY REFERENCE FIELD IS ACCOUNTED FOR ══════════════ */

test('every field the reference form carries exists here', async () => {
  const have = await currentFields()

  const missing = REFERENCE_FIELDS
    .map((f) => SUBSTITUTIONS[f] || f)
    .filter((f) => !have.has(f))

  assert.deepEqual(missing, [],
    `these reference fields have no home in emptyForm, emptyDetails or location state: ${missing.join(', ')}`)
})

test('the reference field list itself was not quietly trimmed', async () => {
  // Guards the guard: shrinking REFERENCE_FIELDS would make the test above
  // pass without the editor actually covering the reference form.
  assert.equal(REFERENCE_FIELDS.length, 48,
    'the reference field list changed size — re-audit the reference form before editing it')
  assert.equal(new Set(REFERENCE_FIELDS).size, REFERENCE_FIELDS.length,
    'the reference field list has a duplicate')
})

test('the agent substitution is the only one, and it is the stronger direction', async () => {
  const src = await adminProperties()
  const have = await currentFields()

  assert.deepEqual(Object.keys(SUBSTITUTIONS), ['agentName'],
    'a new field substitution appeared — each one needs its own justification')

  // The upgrade: a User id, not typed text.
  assert.ok(have.has('agent'), 'the assigned-agent field is gone')
  assert.equal(have.has('agentName'), false,
    'a free-text agentName came back — the listing must point at a real account')
  assert.ok(src.includes('agentIdOf'), 'agentIdOf is gone — agent would no longer resolve to a User id')
})

/* ══════════════ THE FIELDS ARE REACHABLE AND PERSIST ══════════════ */

test('optional details are sent through the payload builder, not spread blindly', async () => {
  const src = await adminProperties()

  // This is what keeps a blank optional number from being transmitted as ''
  // and an unset tri-state from being transmitted at all. Folding details into
  // `form` would send every one of them on every save.
  assert.ok(/buildDetailsPayload/.test(src), 'the details payload builder is gone')
  assert.ok(/\.\.\.buildDetailsPayload\(details, transportTouched\)/.test(src),
    'the submit payload no longer merges the detail fields')
  assert.ok(/const \[details, setDetails\] = useState/.test(src),
    'detail fields were folded into form state, losing the omit-when-blank behaviour')
})

test('editing repopulates both stores from the saved property', async () => {
  const src = await adminProperties()

  // If either half is dropped, a field renders blank on edit and then
  // overwrites the stored value on save.
  assert.ok(/setDetails\(detailsFromProperty\(prop\)\)/.test(src),
    'the edit form no longer repopulates the detail fields')
  assert.ok(/loadAdminLocation\(prop\._id\)/.test(src),
    'the edit form no longer loads the saved location')
  assert.ok(/setImages\(prop\.images \|\| \[\]\)/.test(src),
    'the edit form no longer repopulates images')
})

/* ══════════════ THE BACKEND ACTUALLY STORES THEM ══════════════ */

test('every reference field is a real path on the Property schema', async () => {
  const model = await readBackend('models', 'Property.js')

  // A field that renders but is not on the schema is fake parity: the admin
  // types it, saves, and it silently disappears.
  const notStored = REFERENCE_FIELDS
    .map((f) => SUBSTITUTIONS[f] || f)
    .filter((f) => !new RegExp(`\\b${f}\\s*:`).test(model))

  assert.deepEqual(notStored, [],
    `these fields are in the editor but not on the Property schema: ${notStored.join(', ')}`)
})

test('the extended fields are parsed server-side rather than trusted raw', async () => {
  const routes = await readBackend('routes', 'properties.js')

  assert.ok(/parseExtendedPropertyFields\(req\.body\)/.test(routes),
    'extended property fields are no longer validated on the way in')
  assert.ok(/parsePropertyLocation\(req\.body\?\.location\)/.test(routes),
    'the location payload is no longer validated on the way in')

  // Both the create and the update route must run them, or one path writes raw.
  const parses = (routes.match(/parseExtendedPropertyFields\(req\.body\)/g) || []).length
  assert.ok(parses >= 2, `only ${parses} route(s) parse extended fields — create and update both need it`)
})

/* ══════════════ ROW FORMATION MATCHES THE REFERENCE ══════════════ */

test('the basic block pairs its rows the way the reference does', async () => {
  const src = await adminProperties()
  const start = src.indexOf('{formOpen && (')
  const block = src.slice(start, src.indexOf('</form>', start))

  // Reference order, top to bottom:
  //   Title (full) / ListingType | Price / PriceLabel | District /
  //   Address | PropertyType / Beds | Baths / Area | Status /
  //   Description (full) / agent-identity | AgentPhone / AgentEmail | WhatsApp /
  //   Featured
  const order = [
    "p.titleLabel || 'Title'",
    "p.listingType || 'Listing Type'",
    "p.price || 'Price (number)'",
    "p.priceLabel || 'Price Label (display)'",
    "p.district || 'Istanbul District'",
    "p.address || 'Full Address'",
    "p.propertyType || 'Property Type'",
    "p.beds || 'Bedrooms'",
    "p.baths || 'Bathrooms'",
    "p.area || 'Area (m²)'",
    "p.status || 'Status'",
    "p.description || 'Description'",
    "p.assignedAgent || 'Assigned Agent'",
    "p.agentPhone || 'Agent Phone'",
    "p.agentEmail || 'Agent Email'",
    "p.whatsapp || 'WhatsApp Number'",
    'id="featured"',
  ]

  let previous = -1
  for (const marker of order) {
    const i = block.indexOf(marker)
    assert.notEqual(i, -1, `basic-block field not found: ${marker}`)
    assert.ok(i > previous, `'${marker}' is out of reference order in the basic block`)
    previous = i
  }
})

test('Title and Description are the only full-width cells in the basic block', async () => {
  const src = await adminProperties()
  const start = src.indexOf('{formOpen && (')
  const grid = src.slice(src.indexOf('grid gap-5 md:grid-cols-2', start), src.indexOf('id="featured"', start))

  // The reference spans exactly these two. A third span would shift every row
  // pairing below it by one.
  const spans = (grid.match(/md:col-span-2/g) || []).length
  assert.equal(spans, 2, `expected 2 full-width cells (Title, Description), found ${spans}`)
})

test('Currency stays with the price label it drives', async () => {
  const src = await adminProperties()
  const priceLabel = src.indexOf("p.priceLabel || 'Price Label (display)'")
  const currency = src.indexOf("detailLabel('currency')")
  const district = src.indexOf("p.district || 'Istanbul District'")

  assert.ok(priceLabel !== -1 && currency !== -1 && district !== -1, 'price/currency/district fields not found')

  // The reference has no currency-to-price-label coupling, so it files currency
  // under specs. Here the select rewrites the label above it, so it is stacked
  // inside that cell — which also keeps the row pairing identical (PriceLabel |
  // District) rather than consuming a grid column of its own.
  assert.ok(currency > priceLabel && currency < district,
    'the currency select left the price-label cell — the row pairing no longer matches the reference')
  assert.ok(/p\.currencyHint \|\|/.test(src), 'the currency hint explaining the coupling is gone')
})
