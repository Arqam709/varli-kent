// Every registered CMS field is actually consumed by its public page.
//
// The failure this prevents is silent and expensive: an admin edits a field,
// saves, sees the success toast, and nothing changes on the site — because no
// page ever calls cms() for that key. Wave 13A2 found eleven such ghosts by
// hand; this file turns that audit into a test.
//
// ── Why source scanning, and how it is made non-brittle ─────────────────
// Proving "this key is consumed" without rendering React means reading the
// page source. Two rules keep that honest:
//
//   1. Comments and strings-in-comments are stripped before matching, so a key
//      mentioned in prose never counts as consumed.
//   2. A key only counts when it appears as the FIRST ARGUMENT of a cms(...)
//      call — `cms('heroHeading'` — not merely somewhere in the file.
//
// Index-built keys (`cms(\`service${i + 1}Title\`, …)`) cannot be matched
// literally, so pages declare those families explicitly below. That list is
// small, visible, and itself checked: every family must match at least one
// real template-literal cms() call in the file.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PAGE_CONTENT_REGISTRY, allFieldDefs } from '../src/lib/pageContentRegistry.js'

const here = dirname(fileURLToPath(import.meta.url))
const pagePath = (file) => join(here, '..', 'src', 'pages', file)

const PAGE_FILES = {
  home: 'HomePage.jsx',
  architecture: 'ArchitecturePage.jsx',
  construction: 'ConstructionPage.jsx',
  renovation: 'RenovationPage.jsx',
  'interior-design': 'InteriorDesignPage.jsx',
  team: 'TeamPage.jsx',
  contact: 'ContactPage.jsx',
}

/*
 * Keys built by index inside a .map(). Each entry is a `prefix${…}suffix`
 * family plus the indices it covers.
 */
const INDEXED_FAMILIES = {
  architecture: [
    { prefix: 'service', suffix: 'Title', count: 4 },
    { prefix: 'service', suffix: 'Desc', count: 4 },
    { prefix: 'processStep', suffix: '', count: 4 },
  ],
  renovation: [
    { prefix: 'service', suffix: 'Title', count: 4 },
    { prefix: 'service', suffix: 'Desc', count: 4 },
    { prefix: 'beforeItem', suffix: '', count: 4 },
    { prefix: 'afterItem', suffix: '', count: 4 },
  ],
  'interior-design': [
    { prefix: 'service', suffix: 'Title', count: 4 },
    { prefix: 'service', suffix: 'Desc', count: 4 },
  ],
}

/*
 * Registered but deliberately not consumed, each with the reason.
 *
 * This list must stay EMPTY in a healthy repo. It exists so that a known,
 * reported gap is recorded in code rather than silently tolerated — and so
 * that adding to it is a visible act.
 */
const KNOWN_UNCONSUMED = {}

/** Strips // and /* *\/ comments so a key named in prose never counts. */
const stripComments = (src) =>
  src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

const loadPage = async (pageKey) => stripComments(await readFile(pagePath(PAGE_FILES[pageKey]), 'utf8'))

/** Keys covered by an indexed family, e.g. service1Title … service4Title. */
const expandFamilies = (pageKey) =>
  (INDEXED_FAMILIES[pageKey] || []).flatMap(({ prefix, suffix, count }) =>
    Array.from({ length: count }, (_, i) => `${prefix}${i + 1}${suffix}`)
  )

test('1. every page file exists and calls usePageContent', async () => {
  for (const pageKey of Object.keys(PAGE_CONTENT_REGISTRY)) {
    const src = await loadPage(pageKey)
    assert.match(src, /usePageContent\(/, `${pageKey} does not call usePageContent`)
  }
})

test('2. every registered field is consumed by a real cms() call', async () => {
  const unconsumed = []

  for (const pageKey of Object.keys(PAGE_CONTENT_REGISTRY)) {
    const src = await loadPage(pageKey)
    const indexed = new Set(expandFamilies(pageKey))
    const allowed = new Set(KNOWN_UNCONSUMED[pageKey] || [])

    for (const field of allFieldDefs(pageKey)) {
      if (indexed.has(field.key) || allowed.has(field.key)) continue

      // The key must be the first argument of a cms() call.
      const call = new RegExp(`cms\\(\\s*['"\`]${field.key}['"\`]\\s*,`)
      if (!call.test(src)) unconsumed.push(`${pageKey}.${field.key}`)
    }
  }

  assert.deepEqual(unconsumed, [], 'registered fields nothing renders')
})

test('3. every declared indexed family has a real template-literal call', async () => {
  // Guards the escape hatch above: a family cannot excuse keys unless the page
  // genuinely builds them by index.
  for (const [pageKey, families] of Object.entries(INDEXED_FAMILIES)) {
    const src = await loadPage(pageKey)
    for (const { prefix, suffix } of families) {
      const call = new RegExp('cms\\(\\s*`' + prefix + '\\$\\{[^}]+\\}' + suffix + '`\\s*,')
      assert.ok(call.test(src), `${pageKey} declares the '${prefix}…${suffix}' family but never builds it`)
    }
  }
})

test('4. every indexed family key is registered', async () => {
  // The mirror of test 3: a family must not claim keys the registry lacks.
  for (const pageKey of Object.keys(INDEXED_FAMILIES)) {
    const registered = new Set(allFieldDefs(pageKey).map((f) => f.key))
    for (const key of expandFamilies(pageKey)) {
      assert.ok(registered.has(key), `${pageKey} family key '${key}' is not registered`)
    }
  }
})

test('5. every registered section is gated by isSectionVisible', async () => {
  const ungated = []

  for (const pageKey of Object.keys(PAGE_CONTENT_REGISTRY)) {
    const src = await loadPage(pageKey)
    for (const section of PAGE_CONTENT_REGISTRY[pageKey].sections) {
      const gate = new RegExp(`isSectionVisible\\(\\s*['"\`]${section.key}['"\`]\\s*\\)`)
      if (!gate.test(src)) ungated.push(`${pageKey}.${section.key}`)
    }
  }

  assert.deepEqual(ungated, [], 'registered sections nothing can hide')
})

test('6. pages with no sections do not gate anything', async () => {
  for (const pageKey of ['team', 'contact']) {
    const src = await loadPage(pageKey)
    assert.ok(!/isSectionVisible\(/.test(src), `${pageKey} has no sections but gates something`)
  }
})

test('7. no public page performs live translation', async () => {
  // The whole point of write-time localization: a visitor's page view must
  // never reach a translation provider.
  for (const pageKey of Object.keys(PAGE_CONTENT_REGISTRY)) {
    const src = await loadPage(pageKey)
    for (const banned of ['mymemory', 'translated.net', 'localizeText', '/translate']) {
      assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), `${pageKey} references '${banned}'`)
    }
  }
})

test('8. the known-unconsumed escape hatch is empty', () => {
  assert.deepEqual(
    Object.keys(KNOWN_UNCONSUMED),
    [],
    'a registered field is knowingly unrendered — fix the page or drop the field'
  )
})

/* ── Band consumption ──────────────────────────────────────────────────
 *
 * 13A2's first pass shipped SECTION_ORDER and DEFAULT_BANDS into
 * usePageContent on all five sectioned pages and then never read bandFor —
 * dead infrastructure that the pure computeBands tests happily passed. These
 * assertions exist so that cannot recur: passing arguments in is NOT
 * consumption, and a comment mentioning bandFor is NOT consumption.
 */

const SECTIONED_PAGES = ['home', 'architecture', 'construction', 'renovation', 'interior-design']

test('9. every sectioned page destructures and calls bandFor', async () => {
  for (const pageKey of SECTIONED_PAGES) {
    const src = await loadPage(pageKey)

    assert.match(src, /usePageContent\([^)]*\)/s, `${pageKey}: no usePageContent call`)
    assert.ok(/\bbandFor\b/.test(src), `${pageKey} never mentions bandFor`)
    assert.ok(
      /bandFor\s*\(/.test(src),
      `${pageKey} destructures bandFor but never calls it`
    )
  }
})

test('10. the computed band actually reaches a rendered background', async () => {
  for (const pageKey of SECTIONED_PAGES) {
    const src = await loadPage(pageKey)

    // The band must flow into a background colour, not merely be computed.
    assert.ok(
      /sectionBackground\(\s*key\s*,\s*bandFor\(key\)/.test(src),
      `${pageKey}: bandFor is not fed into sectionBackground`
    )
    assert.ok(
      /backgroundColor:\s*bg\('/.test(src) || /bgColor=\{bg\('/.test(src),
      `${pageKey}: no rendered backgroundColor derives from the band`
    )
  }
})

test('11. every registered section background derives from the band', async () => {
  const missing = []

  for (const pageKey of SECTIONED_PAGES) {
    const src = await loadPage(pageKey)
    for (const section of PAGE_CONTENT_REGISTRY[pageKey].sections) {
      // Either the wrapper styles it, or it is handed down as a prop.
      const wrapper = "backgroundColor: bg('" + section.key + "')"
      const asProp = "bgColor={bg('" + section.key + "')}"
      if (!src.includes(wrapper) && !src.includes(asProp)) missing.push(pageKey + '.' + section.key)
    }
  }

  assert.deepEqual(missing, [], 'sections whose background ignores the computed band')
})

test('12. each page keeps its original colours for unflipped sections', async () => {
  // SECTION_BG is what makes "all sections visible => identical to HEAD" true.
  for (const pageKey of SECTIONED_PAGES) {
    const src = await loadPage(pageKey)
    assert.ok(/const SECTION_BG = \{/.test(src), `${pageKey}: no SECTION_BG map`)
    assert.ok(/const CANONICAL_BG = \{/.test(src), `${pageKey}: no CANONICAL_BG map`)

    for (const section of PAGE_CONTENT_REGISTRY[pageKey].sections) {
      assert.ok(
        src.slice(src.indexOf('const SECTION_BG'), src.indexOf('const CANONICAL_BG')).includes(section.key + ':'),
        `${pageKey}: SECTION_BG has no entry for '${section.key}'`
      )
    }
  }
})

test('13. dividers are bound to a section so hiding one cannot orphan them', async () => {
  // A shared <GoldDivider /> sitting outside the gates would double up when the
  // section between two of them is hidden.
  for (const pageKey of ['architecture', 'construction', 'renovation', 'interior-design']) {
    const src = await loadPage(pageKey)
    const total = (src.match(/<GoldDivider \/>/g) || []).length
    const bound = (src.match(/isSectionVisible\('[a-z-]+'\) && <GoldDivider \/>/g) || []).length

    assert.equal(bound, total, `${pageKey}: ${total - bound} divider(s) not bound to a section`)
  }
})
