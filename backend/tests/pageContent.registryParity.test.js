// Keeps the two Page Content registries from drifting apart.
//
// The contract lives in two files on purpose:
//
//   backend/config/pageContentRegistry.js  — the compact SECURITY contract.
//     Which pages, which field keys and types, which sections. Consulted on
//     every write, because the browser's copy is the attacker's copy.
//
//   frontend/src/lib/pageContentRegistry.js — the EDITOR contract.
//     The same skeleton plus labels and the current live default text, which
//     the server has no use for.
//
// They are not imported across the Vite/Node boundary — that boundary is not
// worth complicating for one object — so the risk is a field added to the
// editor and forgotten on the server, which fails only later, as a 400 the
// admin cannot explain. This file turns that into a failing test instead.
//
// The frontend registry is plain data with no imports, so Node loads it
// directly. tests/seoParity.test.js already reaches into src/lib/ the same way.

import test from 'node:test'
import assert from 'node:assert/strict'

const { PAGE_CONTENT_CONTRACT, PAGE_KEYS, MAX_TEXT_LENGTH } = await import('../config/pageContentRegistry.js')
const { PAGE_CONTENT_REGISTRY, allFieldDefs } = await import('../../frontend/src/lib/pageContentRegistry.js')

const EXPECTED_PAGES = ['home', 'architecture', 'construction', 'renovation', 'interior-design', 'team', 'contact']

test('1. both registries describe exactly the same seven pages', () => {
  assert.deepEqual([...PAGE_KEYS].sort(), [...EXPECTED_PAGES].sort())
  assert.deepEqual(Object.keys(PAGE_CONTENT_REGISTRY).sort(), [...EXPECTED_PAGES].sort())
})

test('2. every page has the same field keys and types on both sides', () => {
  for (const pageKey of EXPECTED_PAGES) {
    const backend = PAGE_CONTENT_CONTRACT[pageKey].fields
    const frontend = Object.fromEntries(allFieldDefs(pageKey).map((f) => [f.key, f.type]))

    assert.deepEqual(
      Object.keys(frontend).sort(),
      Object.keys(backend).sort(),
      `field keys differ on '${pageKey}'`
    )

    for (const [key, type] of Object.entries(frontend)) {
      assert.equal(type, backend[key], `field '${key}' on '${pageKey}' has a different type on each side`)
    }
  }
})

test('3. every page has the same section keys on both sides', () => {
  for (const pageKey of EXPECTED_PAGES) {
    const backend = PAGE_CONTENT_CONTRACT[pageKey].sections
    const frontend = PAGE_CONTENT_REGISTRY[pageKey].sections.map((s) => s.key)

    assert.deepEqual(frontend, backend, `section keys or their order differ on '${pageKey}'`)
  }
})

test('4. field keys are unique within a page', () => {
  for (const pageKey of EXPECTED_PAGES) {
    const keys = allFieldDefs(pageKey).map((f) => f.key)
    assert.equal(new Set(keys).size, keys.length, `duplicate field key on '${pageKey}'`)
  }
})

test('5. section keys are unique within a page', () => {
  for (const pageKey of EXPECTED_PAGES) {
    const keys = PAGE_CONTENT_REGISTRY[pageKey].sections.map((s) => s.key)
    assert.equal(new Set(keys).size, keys.length, `duplicate section key on '${pageKey}'`)
  }
})

test('6. only text and image field types exist', () => {
  for (const pageKey of EXPECTED_PAGES) {
    for (const field of allFieldDefs(pageKey)) {
      assert.ok(['text', 'image'].includes(field.type), `'${field.key}' on '${pageKey}' has type '${field.type}'`)
    }
  }
})

test('7. every field carries a label and every section a title', () => {
  for (const pageKey of EXPECTED_PAGES) {
    for (const field of allFieldDefs(pageKey)) {
      assert.ok(field.label && field.label.trim() !== '', `'${field.key}' on '${pageKey}' has no label`)
    }
    for (const section of PAGE_CONTENT_REGISTRY[pageKey].sections) {
      assert.ok(section.defaultTitle && section.defaultTitle.trim() !== '', `a section on '${pageKey}' has no defaultTitle`)
    }
  }
})

test('8. every TEXT field has a non-empty default — the editor never opens blank', () => {
  // This is the property that lets Wave 13A2 write `cms(key, fallback)` and
  // lets the admin form show real copy before anything has ever been saved.
  // Image fields may legitimately default to '' (no override).
  for (const pageKey of EXPECTED_PAGES) {
    for (const field of allFieldDefs(pageKey)) {
      if (field.type !== 'text') continue
      assert.ok(
        typeof field.default === 'string' && field.default.trim() !== '',
        `text field '${field.key}' on '${pageKey}' has no default`
      )
    }
  }
})

test('9. no default exceeds the length the server will accept', () => {
  for (const pageKey of EXPECTED_PAGES) {
    for (const field of allFieldDefs(pageKey)) {
      if (field.type !== 'text') continue
      assert.ok(
        field.default.length <= MAX_TEXT_LENGTH,
        `'${field.key}' on '${pageKey}' is ${field.default.length} chars, over the ${MAX_TEXT_LENGTH} limit`
      )
    }
  }
})

test('10. dynamic collections are not duplicated as CMS fields', () => {
  // The CMS owns the copy AROUND properties/projects/reviews/team/showroom —
  // never the records themselves, which have their own admin screens. A field
  // key naming an individual record is the shape that mistake would take.
  const FORBIDDEN = /^(propertyItem|projectItem|reviewItem|teamMember|showroomImage)/i
  for (const pageKey of EXPECTED_PAGES) {
    for (const field of allFieldDefs(pageKey)) {
      assert.ok(!FORBIDDEN.test(field.key), `'${field.key}' on '${pageKey}' looks like a dynamic record`)
    }
  }
})

/* ── Wave 13A2 registry corrections ────────────────────────────────────
 *
 * Six defects were found by mapping the registry against the real rendered
 * JSX rather than against translations.js. These pin the corrections so the
 * ghosts cannot come back.
 */

test('11. removed ghost fields are absent on BOTH sides', () => {
  const gone = [
    ['contact', 'formHeading'],          // ContactPage renders no form heading
    ['architecture', 'modelLabel'],      // ArchitecturePage has no model section
    ['architecture', 'modelHeading'],
    ['architecture', 'modelDesc'],
    ['architecture', 'modelBtn'],
    ['interior-design', 'modelLabel'],   // InteriorDesignPage has no model section
    ['interior-design', 'modelHeading'],
    ['interior-design', 'modelDesc'],
    ['interior-design', 'modelBtn'],
  ]

  for (const [pageKey, fieldKey] of gone) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(PAGE_CONTENT_CONTRACT[pageKey].fields, fieldKey),
      `backend still registers '${fieldKey}' on '${pageKey}'`
    )
    assert.ok(
      !allFieldDefs(pageKey).some((f) => f.key === fieldKey),
      `frontend still registers '${fieldKey}' on '${pageKey}'`
    )
  }
})

test('12. the ghost `model` section is gone from both service pages', () => {
  for (const pageKey of ['architecture', 'interior-design']) {
    assert.ok(!PAGE_CONTENT_CONTRACT[pageKey].sections.includes('model'), `backend '${pageKey}'`)
    assert.ok(
      !PAGE_CONTENT_REGISTRY[pageKey].sections.some((s) => s.key === 'model'),
      `frontend '${pageKey}'`
    )
  }
})

test('13. architecture gained its real `stats` bar as a toggle-only section', () => {
  assert.ok(PAGE_CONTENT_CONTRACT.architecture.sections.includes('stats'))

  const stats = PAGE_CONTENT_REGISTRY.architecture.sections.find((s) => s.key === 'stats')
  assert.ok(stats, 'frontend registry has no architecture stats section')
  assert.deepEqual(stats.fields, [], 'stats must stay toggle-only in 13A2')
})

test('14. section order matches the order the pages actually render', () => {
  // bandFor walks these lists to decide dark/light alternation, so a wrong
  // order is a visual bug the moment a section is hidden.
  const RENDERED_ORDER = {
    home: ['services', 'about', 'browse', 'trust', 'process', 'featured', 'projects', 'stats', 'testimonials', 'partners', 'cta'],
    architecture: ['showroom', 'stats', 'services', 'process', 'cta'],
    construction: ['viewer', 'services', 'process', 'seismic', 'showroom', 'cta'],
    renovation: ['transform', 'studio', 'palette', 'services', 'showroom', 'cta'],
    'interior-design': ['styles', 'showroom', 'finishes', 'palette', 'services', 'cta'],
    team: [],
    contact: [],
  }

  for (const [pageKey, order] of Object.entries(RENDERED_ORDER)) {
    assert.deepEqual(PAGE_CONTENT_CONTRACT[pageKey].sections, order, `backend order wrong on '${pageKey}'`)
    assert.deepEqual(
      PAGE_CONTENT_REGISTRY[pageKey].sections.map((s) => s.key),
      order,
      `frontend order wrong on '${pageKey}'`
    )
  }
})

test('15. the eight Homepage ghost fields stay removed', () => {
  // Registered in 13A1 from translations.js keys that HomePage never renders.
  // heroSubtitle / processSubheading / featuredEmpty / testimonialsDisclaimer
  // have no element at all; statsValue1-4 feed <CountUp target suffix> from a
  // split numeric string that a single CMS value cannot drive.
  const gone = [
    'heroSubtitle', 'processSubheading', 'featuredEmpty', 'testimonialsDisclaimer',
    'statsValue1', 'statsValue2', 'statsValue3', 'statsValue4',
  ]

  for (const key of gone) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(PAGE_CONTENT_CONTRACT.home.fields, key),
      `backend still registers home.${key}`
    )
    assert.ok(
      !allFieldDefs('home').some((f) => f.key === key),
      `frontend still registers home.${key}`
    )
  }
})

test('16. the surviving stats labels are still registered', () => {
  // The labels ARE language-aware and ARE rendered; only the numbers went.
  for (const key of ['statsLabel1', 'statsLabel2', 'statsLabel3', 'statsLabel4']) {
    assert.ok(Object.prototype.hasOwnProperty.call(PAGE_CONTENT_CONTRACT.home.fields, key), key)
  }
})

test('17. field counts are what the wave settled on', () => {
  const counts = {}
  for (const pageKey of EXPECTED_PAGES) counts[pageKey] = allFieldDefs(pageKey).length

  assert.deepEqual(counts, {
    home: 49,
    architecture: 26,
    construction: 22,
    renovation: 37,
    'interior-design': 27,
    team: 4,
    contact: 8,
  })

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  assert.equal(total, 173)
})
