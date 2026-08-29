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
