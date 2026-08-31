// Wave 14C, Part B — the three small donor admin features.
//
//   grouped sidebar navigation      AdminLayout.jsx
//   All / For Sale / For Rent tabs  AdminProperties.jsx
//   Showroom Media statistic        AdminDashboard.jsx
//
// Static source contracts in the style of showroomRich.contract.test.js: no
// React testing dependency, run with plain `node --test` from frontend/.
//
// The failure mode these exist for is a link quietly disappearing behind a
// grouping refactor, or a tab that filters a copy of the list while the page
// keeps rendering the original.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const read = async (...p) =>
  (await readFile(join(here, '..', 'src', ...p), 'utf8'))
    // Comments stripped so a route named only in prose never counts as
    // reachable. Anchored to line start so an inline `/*` in JSX survives.
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

/*
 * The admin destinations reachable from the sidebar at HEAD, before 14C
 * grouped them. Frozen deliberately: this list is the contract. If a route is
 * removed from the sidebar, this test fails and someone has to justify it,
 * which is the whole point of writing it down.
 */
const PRE_14C_ADMIN_ROUTES = [
  '/admin/dashboard',
  '/admin/properties',
  '/admin/messages',
  '/admin/user-chats',
  '/admin/projects',
  '/admin/about',
  '/admin/page-content',
  '/admin/team',
  '/admin/reviews',
  '/admin/showroom',
  '/admin/partners',
  '/admin/studio-palette',
  '/admin/lead-routing',
  '/admin/users',
  '/admin/settings',
  '/admin/activity',
]

const navRoutes = (s) => [...s.matchAll(/\{ to: '(\/admin\/[a-z-]+)'/g)].map((m) => m[1])

/* ═══════════ 1. Grouped navigation ═══════════ */

test('1a. every pre-14C admin route is still in the sidebar, exactly once', async () => {
  const s = await read('components', 'AdminLayout.jsx')
  const routes = navRoutes(s)

  for (const route of PRE_14C_ADMIN_ROUTES) {
    assert.equal(
      routes.filter((r) => r === route).length, 1,
      `${route} is no longer reachable exactly once from the sidebar`
    )
  }
  assert.equal(routes.length, PRE_14C_ADMIN_ROUTES.length, `sidebar route count changed: ${routes.join(' ')}`)
})

test('1b. every sidebar route is placed in exactly one group', async () => {
  const s = await read('components', 'AdminLayout.jsx')
  const routes = navRoutes(s)

  const groups = [...s.matchAll(/routes: \[([^\]]*)\]/g)]
    .map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  assert.ok(groups.length >= 2, 'the navigation is not grouped')

  const placed = groups.flat()
  for (const route of routes) {
    assert.equal(
      placed.filter((r) => r === route).length, 1,
      `${route} is placed in ${placed.filter((r) => r === route).length} groups, not 1`
    )
  }
  // No heading may claim a route the sidebar does not have.
  for (const route of placed) {
    assert.ok(routes.includes(route), `a group names ${route}, which is not a sidebar link`)
  }
})

test('1c. grouping is presentational — every permission gate survives', async () => {
  const s = await read('components', 'AdminLayout.jsx')

  // The exact gates the sidebar had before 14C.
  const GATES = [
    "hasPermission('add_listing')", "hasPermission('edit_listing')", "hasPermission('delete_listing')",
    "hasPermission('view_contacts')", "hasPermission('view_chats')", "hasPermission('manage_projects')",
    "hasPermission('manage_about')", "hasPermission('manage_page_content')", "hasPermission('manage_team')",
    "hasPermission('manage_reviews')", "hasPermission('manage_showroom')", "hasPermission('manage_partners')",
    "hasPermission('manage_studio_colors')", 'isOwner',
  ]
  for (const gate of GATES) {
    assert.ok(s.includes(gate), `the ${gate} gate was lost while grouping`)
  }

  // The group definitions must carry routes and a label key only — a
  // permission appearing inside NAV_GROUPS would mean visibility moved there.
  const definition = s.match(/const NAV_GROUPS = \[[\s\S]*?\n\]/)
  assert.ok(definition, 'NAV_GROUPS moved or was renamed')
  assert.ok(!/hasPermission|isOwner|role/.test(definition[0]), 'the group table decides visibility')
})

test('1d. an ungrouped route still renders rather than vanishing', async () => {
  const s = await read('components', 'AdminLayout.jsx')

  // A link added later but not named in NAV_GROUPS must fall through to a
  // group, not be filtered away.
  assert.match(
    s, /i === NAV_GROUPS\.length - 1 && !isGrouped\(l\.to\)/,
    'a route missing from NAV_GROUPS would disappear from the sidebar'
  )
  // Empty groups are dropped so a limited agent does not see bare headings.
  assert.match(s, /\.filter\(\(group\) => group\.links\.length > 0\)/, 'empty groups are not dropped')
})

test('1e. group headings are read from the dictionary with a fallback', async () => {
  const s = await read('components', 'AdminLayout.jsx')

  for (const key of ['groupOverview', 'groupListings', 'groupSiteContent', 'groupCustomers', 'groupSystem']) {
    assert.match(s, new RegExp(`key: '${key}'`), `the ${key} heading is missing`)
  }
  assert.match(s, /a\[group\.key\] \|\| group\.fallback/, 'headings are hard-coded rather than translated')
})

test('1f. the grouped sidebar introduces no left/right-specific layout', async () => {
  const s = await read('components', 'AdminLayout.jsx')

  const nav = s.match(/<nav[\s\S]*?<\/nav>/)
  assert.ok(nav, 'the nav element moved')
  // Physical-direction utilities would pin the headings to the left in
  // Arabic and Urdu.
  for (const directional of ['ml-', 'mr-', 'pl-', 'pr-', 'text-left', 'text-right', 'left-', 'right-']) {
    assert.ok(!nav[0].includes(directional), `the nav uses ${directional}, which does not flip in RTL`)
  }
})

/* ═══════════ 2. AdminProperties tabs ═══════════ */

test('2a. all three donor tabs exist and use CURRENT listingType values', async () => {
  const s = await read('pages', 'AdminProperties.jsx')

  assert.match(s, /const \[tab, setTab\] = useState\('all'\)/, 'there is no tab state, defaulting to All')
  for (const id of ["'all'", "'sale'", "'rent'"]) {
    assert.ok(s.includes(`id: ${id}`), `the ${id} tab is missing`)
  }
  // Exactly the values the property schema and the rest of this page use.
  assert.match(s, /prop\.listingType === 'Sale'/, "the Sale tab does not match listingType 'Sale'")
  assert.match(s, /prop\.listingType === 'Rent'/, "the Rent tab does not match listingType 'Rent'")
  assert.ok(!/listingType === '(sale|rent|SALE|RENT)'/.test(s), 'a tab compares against a wrong-case listing type')
})

test('2b. the list renders the derived list, not the raw one', async () => {
  const s = await read('pages', 'AdminProperties.jsx')

  assert.match(s, /const visibleProperties = properties\.filter\(/, 'there is no single derived list')
  assert.match(s, /\{visibleProperties\.map\(prop =>/, 'the grid still renders the unfiltered list')
  assert.ok(!/\{properties\.map\(prop =>/.test(s), 'the raw list is still rendered somewhere')

  // Filtering must not write back to state — switching tabs cannot lose data.
  assert.ok(!/setProperties\(.*filter/.test(s), 'a tab mutates the loaded property list')
})

test('2c. the tab composes with anything else that narrows the list', async () => {
  const s = await read('pages', 'AdminProperties.jsx')

  // One filter expression is the whole point: a second independent list would
  // let a future search silently ignore the tab.
  const derived = s.match(/const visibleProperties = properties\.filter\([\s\S]*?\n\s*\)\)/)
  assert.ok(derived, 'the derived list changed shape')
  assert.ok(derived[0].includes('tab ==='), 'the derived list does not consider the tab')

  const otherLists = [...s.matchAll(/const (\w+) = properties\.filter\(/g)].map((m) => m[1])
  for (const name of otherLists) {
    assert.ok(
      ['visibleProperties', 'saleCount', 'rentCount'].includes(name),
      `'${name}' is a second list derived from properties and may compete with the tab`
    )
  }
})

test('2d. counts describe the whole list, not the current tab', async () => {
  const s = await read('pages', 'AdminProperties.jsx')

  // Donor behaviour: each badge says how many that tab WOULD show.
  assert.match(s, /const saleCount = properties\.filter\(/, 'the Sale count is derived from the filtered list')
  assert.match(s, /const rentCount = properties\.filter\(/, 'the Rent count is derived from the filtered list')
  assert.match(s, /count: properties\.length/, 'the All count is not the full list length')
  assert.ok(!/visibleProperties\.filter/.test(s), 'a count is computed from the already-filtered list')
})

test('2e. the tabs are real, keyboard-operable controls', async () => {
  const s = await read('pages', 'AdminProperties.jsx')

  assert.match(s, /role="tablist"/, 'the tabs are not announced as a tablist')
  const button = s.match(/<button[\s\S]{0,600}?onClick=\{\(\) => setTab\(item\.id\)\}[\s\S]{0,300}?>/)
  assert.ok(button, 'a tab is not a <button>')
  assert.match(button[0], /type="button"/, 'a tab has no explicit button type')
  assert.match(button[0], /role="tab"/, 'a tab is not announced as a tab')
  assert.match(button[0], /aria-selected=\{tab === item\.id\}/, 'the selected tab is not announced')
})

test('2f. tab labels are translated and the count spacing flips in RTL', async () => {
  const s = await read('pages', 'AdminProperties.jsx')

  for (const key of ['all', 'forSale', 'forRent']) {
    assert.match(s, new RegExp(`p\\.${key} \\|\\| '`), `the ${key} label is hard-coded`)
  }
  // ms-1, not ml-1: the count sits after the label in both directions.
  assert.ok(!/className=\{`ml-1 /.test(s), 'the count uses a physical margin that will not flip in RTL')
})

/* ═══════════ 3. Dashboard Showroom Media statistic ═══════════ */

test('3a. the statistic covers all four services through the admin endpoint', async () => {
  const s = await read('pages', 'AdminDashboard.jsx')

  assert.match(
    s, /const SHOWROOM_SERVICES = \['architecture', 'interior', 'construction', 'renovation'\]/,
    'the service list does not match the ShowroomImage serviceType enum'
  )
  // `/all` is the admin route, which returns hidden records too — that is the
  // donor semantic: how much media exists, not how much is live.
  assert.match(s, /api\.get\(`\/showroom\/\$\{s\}\/all`\)/, 'the statistic does not use the admin showroom route')
  assert.match(s, /\.catch\(\(\) => \(\{ data: \{ images: \[\] \} \}\)\)/, 'one failing service breaks the whole card')
})

test('3b. it splits images from videos with the carousel predicate', async () => {
  const dashboard = await read('pages', 'AdminDashboard.jsx')
  const carousel = await read('components', 'ShowroomCarousel.jsx')

  const extract = (s) => {
    const line = s.match(/const isVideoUrl = (.*)/)
    assert.ok(line, 'isVideoUrl is missing')
    return line[1].trim()
  }
  // Duplicated rather than exported (the Wave 14B carousel is not touched),
  // so they are asserted to agree.
  assert.equal(
    extract(dashboard), extract(carousel),
    'the dashboard and the carousel disagree about what counts as a video'
  )

  assert.match(dashboard, /images: all\.filter\(m => !isVideoUrl\(m\.url\)\)\.length/, 'the image count is wrong')
  assert.match(dashboard, /videos: all\.filter\(m => isVideoUrl\(m\.url\)\)\.length/, 'the video count is wrong')
})

test('3c. it is permission-gated and does not disturb the existing stats', async () => {
  const s = await read('pages', 'AdminDashboard.jsx')

  assert.match(
    s, /if \(!hasPermission\('manage_showroom'\)\) return/,
    'the showroom requests are made regardless of permission'
  )
  // Its own request chain, so a slow showroom response cannot delay or fail
  // the property counters.
  assert.ok(
    !/fetches\.push\(api\.get\(`\/showroom/.test(s),
    'the showroom requests were folded into the property Promise.all'
  )
  for (const existing of ['totalProperties', 'forSale', 'forRent', 'noContactsAccess']) {
    assert.ok(s.includes(existing), `the existing '${existing}' stat card was disturbed`)
  }
})

test('3d. the card waits for real numbers instead of flashing zero', async () => {
  const s = await read('pages', 'AdminDashboard.jsx')

  assert.match(s, /const \[showroomStats, setShowroomStats\] = useState\(null\)/, 'the card does not start empty')
  assert.match(s, /\{showroomStats && \(/, 'the card renders before its data arrives')
})

test('3e. the card labels are translated', async () => {
  const s = await read('pages', 'AdminDashboard.jsx')

  for (const key of ['showroomMedia', 'showroomMediaHint', 'imagesLabel', 'videosLabel', 'viewAll']) {
    assert.match(s, new RegExp(`p\\.${key} \\|\\| '`), `the ${key} label is hard-coded`)
  }
})

/* ═══════════ 4. Six languages ═══════════ */

test('4. every new admin label exists in all six languages', async () => {
  const s = await readFile(join(here, '..', 'src', 'locales', 'translations.js'), 'utf8')

  const blocks = {}
  for (const lang of LANGS) {
    const start = s.indexOf(`\n  ${lang}: {`)
    assert.ok(start !== -1, `no '${lang}' block in translations.js`)
    let end = s.length
    for (const other of LANGS) {
      const at = s.indexOf(`\n  ${other}: {`, start + 1)
      if (at !== -1 && at < end) end = at
    }
    blocks[lang] = s.slice(start, end)
  }

  const KEYS = [
    'groupOverview', 'groupListings', 'groupSiteContent', 'groupCustomers', 'groupSystem',
    'all', 'forSale', 'forRent',
    'showroomMedia', 'showroomMediaHint', 'imagesLabel', 'videosLabel', 'viewAll',
  ]
  for (const lang of LANGS) {
    for (const key of KEYS) {
      assert.match(blocks[lang], new RegExp(`\\b${key}: '`), `'${key}' is missing from '${lang}'`)
    }
  }
})

/* ═══════════ 5. Scope ═══════════ */

test('5. 14C touched no protected subsystem from inside the admin pages', async () => {
  // The three admin files must not have grown a filter/permission/CMS
  // responsibility while gaining this polish.
  for (const [dir, file] of [['components', 'AdminLayout.jsx'], ['pages', 'AdminProperties.jsx'], ['pages', 'AdminDashboard.jsx']]) {
    const s = await read(dir, file)
    for (const banned of ['socket.io', 'PropertyConversation', 'PropertyMessage', 'embedding', 'bbox', 'hasVideo']) {
      assert.ok(!s.includes(banned), `${file} references ${banned}`)
    }
  }
})
