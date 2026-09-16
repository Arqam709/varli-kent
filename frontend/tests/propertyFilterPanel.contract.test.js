// The public filter sidebar's shape: individual collapsible sections.
//
// ── Why this file exists ────────────────────────────────────────────────
// The panel used to show six filters and hide the other thirty-odd behind one
// "Show advanced filters" button. Every filter worked, but the sidebar looked
// like the site filtered on far less than it does, and opening the toggle
// dumped everything out at once as a single wall of controls.
//
// It is now a stack of individually collapsible rows, matching the reference
// design: every heading is visible while scrolling, only the controls are
// collapsed, and sections open independently.
//
// The contracts below pin that architecture. The order is pinned too, because
// it is the whole point of the change — a later edit that quietly folds three
// rows back into a "Legal & Usage" group would otherwise go unnoticed.
//
// Static source contracts, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const readSrc = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')
const propertiesPage = () => readSrc('pages', 'PropertiesPage.jsx')

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const loadTranslations = async () => {
  const raw = await readSrc('locales', 'translations.js')
  const mod = { exports: {} }
  new Function('module', 'exports', raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = '))(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

/**
 * The panel's sections, in render order, as `{ id, defaultOpen }`.
 *
 * Ids are read rather than titles because the titles are translated — asserting
 * on English display text would make the contract fail the moment someone
 * improved a label.
 */
const sections = async () => {
  const src = await propertiesPage()
  return [...src.matchAll(/<FilterSection id=\{`\$\{instanceId\}-([a-zA-Z]+)`\}([\s\S]{0,220}?)>/g)]
    .map((m) => ({ id: m[1], defaultOpen: /\bdefaultOpen\b/.test(m[2]) }))
}

/**
 * The reference sidebar's order. Position 23 is the one deliberate deviation:
 * the reference calls it "Photo, Video" and pairs a virtual-tour checkbox with
 * a video-only one. There is no video field on the schema — that filter matches
 * a regex against image URLs — so only the real half is offered, under its real
 * name.
 */
const EXPECTED_ORDER = [
  'rooms', 'grossArea', 'netArea', 'openArea', 'buildingAge', 'coefficient',
  'floor', 'heating', 'baths', 'kitchenType', 'balcony', 'elevator', 'parking',
  'furnished', 'usageStatus', 'withinSite', 'eligibleForCredit', 'titleDeedStatus',
  'exchange', 'wellness', 'nearbyTransport', 'listedSince', 'hasVirtualTour',
]

/** Open on first paint, matching the reference. Everything else starts closed. */
const EXPECTED_DEFAULT_OPEN = ['rooms', 'grossArea']

/* ══════════════ THE MASTER TOGGLE IS GONE ══════════════ */

test('no global advanced-filters toggle gates the panel', async () => {
  const src = await propertiesPage()

  // Not merely hidden with CSS — the state and the button are gone, so nothing
  // can gate filter visibility as a group again.
  for (const marker of ['showAdvanced', 'setShowAdvanced', 'hideAdvanced']) {
    assert.equal(src.includes(marker), false,
      `${marker} is back — filters must not hide behind one master toggle`)
  }
})

test('the old grouped-section helper is gone', async () => {
  const src = await propertiesPage()

  // `section(key, title, children)` rendered a static heading with everything
  // underneath — the "Size & Area" / "Legal & Usage" blocks. Individual
  // collapsible rows replaced it.
  assert.equal(/const section = \(key, title, children\)/.test(src), false,
    'the grouped-section helper is back')
  for (const oldGroup of ['sectionSizeArea', 'sectionBuildingLayout', 'sectionAmenitiesExtra', 'sectionLegalUsage']) {
    assert.equal(src.includes(oldGroup), false,
      `the '${oldGroup}' grouped block is back — those filters need their own rows`)
  }
})

/* ══════════════ EVERY HEADING IS A REAL, INDEPENDENT ACCORDION ══════════════ */

test('the section component lives at module scope so open state survives', async () => {
  const src = await propertiesPage()

  const declared = src.indexOf('const FilterSection = ')
  const componentStart = src.indexOf('const PropertiesPage = ')
  assert.notEqual(declared, -1, 'FilterSection is gone')
  assert.ok(declared < componentStart,
    'FilterSection moved inside PropertiesPage — it would be a new type every render, ' +
    'so React would remount every section and each would forget whether it was open')

  assert.ok(/const \[open, setOpen\] = useState\(defaultOpen\)/.test(src),
    'sections no longer hold their own open state')
})

test('sections open independently', async () => {
  const src = await propertiesPage()
  const start = src.indexOf('const FilterSection = ')
  const body = src.slice(start, src.indexOf('const Label = ', start))

  // An exclusive accordion would need to know about its siblings. Nothing here
  // may reach outside its own state: opening Heating must not close Parking.
  assert.equal(/openSection|activeSection|onlyOne|exclusive/i.test(body), false,
    'the sections coordinate with each other — they must be independent')
  assert.ok(/setOpen\(v => !v\)/.test(body), 'the header no longer toggles its own section')
})

test('the accordion header is a real button with the right ARIA', async () => {
  const src = await propertiesPage()
  const start = src.indexOf('const FilterSection = ')
  const body = src.slice(start, src.indexOf('const Label = ', start))

  assert.ok(/<button\s+type="button"/.test(body), 'the header is not a type="button" button')
  assert.ok(/aria-expanded=\{open\}/.test(body), 'the header does not report its expanded state')
  assert.ok(/aria-controls=\{panelId\}/.test(body), 'the header does not point at its panel')
  assert.ok(/id=\{panelId\}/.test(body), 'the panel has no id for aria-controls to reference')

  // aria-controls must reference an element that exists, so the body is hidden
  // rather than unmounted.
  assert.ok(/hidden=\{!open\}/.test(body),
    'the panel is conditionally rendered — aria-controls would point at nothing when closed')
})

test('the chevron rotates rather than swapping icons', async () => {
  const src = await propertiesPage()
  const start = src.indexOf('const FilterSection = ')
  const body = src.slice(start, src.indexOf('const Label = ', start))

  assert.ok(/rotate-180/.test(body), 'the chevron does not indicate open state')
  assert.ok(/aria-hidden="true"/.test(body), 'the decorative chevron is exposed to screen readers')
})

/* ══════════════ ORDER AND DEFAULTS ══════════════ */

test('the sections run in the reference order', async () => {
  const found = (await sections()).map((s) => s.id)
  assert.deepEqual(found, EXPECTED_ORDER,
    'the filter panel order has drifted from the reference sidebar')
})

test('only the two reference sections start open', async () => {
  const open = (await sections()).filter((s) => s.defaultOpen).map((s) => s.id)
  assert.deepEqual(open, EXPECTED_DEFAULT_OPEN,
    'the default-open sections changed — the panel should open on rooms and gross area only')
})

test('every section id is unique', async () => {
  const ids = (await sections()).map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'two sections share an id')
})

/* ══════════════ DESKTOP AND MOBILE SHARE ONE RENDERER ══════════════ */

test('desktop and mobile render the same panel, with scoped ids', async () => {
  const src = await propertiesPage()

  // One renderer, so a filter can never exist on desktop and be missing on
  // mobile. Both trees can be in the DOM at once, so every generated id is
  // prefixed with its instance — otherwise htmlFor resolves to the hidden
  // desktop control and the ids are invalid HTML besides.
  assert.ok(/const renderFilterPanel = \(instanceId, onDone\) =>/.test(src),
    'the shared panel renderer changed shape')
  assert.ok(/renderFilterPanel\('desktop'\)/.test(src), 'the desktop sidebar no longer renders the panel')
  assert.ok(/renderFilterPanel\('mobile', \(\) => setMobileFilterOpen\(false\)\)/.test(src),
    'the mobile drawer no longer renders the panel, or its Apply no longer closes the drawer')

  // Every section id is instance-scoped.
  const unscoped = [...src.matchAll(/<FilterSection id=\{`([^`]+)`\}/g)]
    .map((m) => m[1])
    .filter((id) => !id.startsWith('${instanceId}-'))
  assert.deepEqual(unscoped, [], `these section ids are not instance-scoped: ${unscoped.join(', ')}`)
})

test('Apply only exists where it does something', async () => {
  const src = await propertiesPage()

  // Results refetch as the query string changes, so a desktop "Apply" would
  // imply pending changes that do not exist. In the drawer the same button has
  // a real job: closing it over the results it just filtered.
  assert.ok(/\{onDone && \(/.test(src),
    'the Apply button is unconditional — on desktop it would suggest filters are not yet applied')
  const panel = src.slice(src.indexOf('const renderFilterPanel ='), src.indexOf('/* Hero banner */'))
  assert.equal(/onClick=\{fetchProperties\}/.test(panel), false,
    'a manual refetch button is back; filtering is already immediate')
})

/* ══════════════ THE CONTROLS INSIDE KEPT THEIR SEMANTICS ══════════════ */

test('one-way booleans use a checkbox, unknown-capable ones use Any/Yes/No', async () => {
  const src = await propertiesPage()

  // The route narrows on these only when true (`if (furnished === 'true')`), so
  // an unticked box meaning "do not filter" is honest.
  assert.ok(/const yesOnly = \(idPrefix, field, labelText, value, setter\)/.test(src),
    'the checkbox helper for one-way boolean fields is gone')
  for (const field of ['balcony', 'elevator', 'furnished', 'pool', 'garden']) {
    assert.ok(new RegExp(`yesOnly\\(instanceId, '${field}'`).test(src),
      `${field} no longer uses the one-way checkbox`)
  }

  // These have no schema default, so "not recorded" and "no" are different
  // answers and a checkbox cannot say which it means.
  assert.ok(/const triSelect = /.test(src), 'the tri-state helper is gone')
  for (const field of ['withinSite', 'eligibleForCredit', 'exchange', 'hasVirtualTour']) {
    assert.ok(new RegExp(`triSelect\\(instanceId, '${field}'`).test(src),
      `${field} lost its Any/Yes/No control`)
  }
})

test('each filter field appears in exactly one section', async () => {
  const src = await propertiesPage()
  const panel = src.slice(src.indexOf('const renderFilterPanel = '))

  // A field rendered twice would give two controls writing the same state, and
  // the second would silently win.
  for (const field of ['buildingAge', 'heating', 'parking', 'kitchenType', 'usageStatus',
    'titleDeedStatus', 'nearbyTransport', 'floorLocation']) {
    const uses = (panel.match(new RegExp(`multiSelect\\(instanceId, '${field}'`, 'g')) || []).length
    assert.equal(uses, 1, `${field} is rendered ${uses} times in the panel`)
  }
  for (const field of ['balcony', 'elevator', 'furnished', 'pool', 'garden']) {
    const uses = (panel.match(new RegExp(`yesOnly\\(instanceId, '${field}'`, 'g')) || []).length
    assert.equal(uses, 1, `${field} is rendered ${uses} times in the panel`)
  }
})

test('the section headings are translated, not hardcoded English', async () => {
  const src = await propertiesPage()
  const t = await loadTranslations()

  // Every heading reads from the translation object with an English fallback.
  const titles = [...src.matchAll(/<FilterSection id=\{`\$\{instanceId\}-[a-zA-Z]+`\} title=\{([^}]*)\}/g)]
    .map((m) => m[1])
  assert.equal(titles.length, EXPECTED_ORDER.length, 'a section heading is not an expression')
  for (const title of titles) {
    assert.ok(/(pp|t\.propertiesPage|optionLabels)\??\./.test(title),
      `a heading is hardcoded rather than translated: ${title}`)
  }

  // The keys introduced for the new rows exist in every language.
  for (const key of ['grossArea', 'lift', 'sectionWellness', 'sectionListingDate', 'floorNo', 'totalFloors']) {
    for (const lang of LANGS) {
      const value = t[lang]?.propertiesPage?.[key]
      assert.ok(typeof value === 'string' && value.trim(),
        `${lang}: propertiesPage.${key} is missing — the heading falls back to English`)
    }
  }
})

test('no fake video filter was added for visual parity', async () => {
  const src = await propertiesPage()

  assert.equal(src.includes('hasVideo'), false,
    'a video filter appeared — there is no video field on the schema to back it')
  for (const param of ['minLat', 'maxLat', 'minLng', 'maxLng']) {
    assert.equal(src.includes(param), false, `${param} appeared — exact location stays private`)
  }
})
