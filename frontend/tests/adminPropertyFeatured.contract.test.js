// Featured-on-Homepage — the admin's view of a field that was already wired.
//
// ── Why this file exists ────────────────────────────────────────────────
// Every layer of this feature already worked before the badge existed:
// Property.featured is a Boolean(default false), GET /properties?featured=true
// filters on it, HomePage requests exactly that, the editor has a checkbox, and
// handleSubmit spreads form state into the payload. The one thing missing was
// FEEDBACK — nothing in the listing grid told an admin which properties were
// featured, so the only way to find out was to open each listing in turn.
//
// That makes the interesting contracts the ones about the CHAIN rather than
// about the badge alone: the badge must read the same field the editor writes
// and the public Home queries, or it becomes a second source of truth that
// drifts. These assert that chain end to end, across both packages.
//
// Static source contracts, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const readSrc = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')
const readBackend = async (...p) => readFile(join(here, '..', '..', 'backend', ...p), 'utf8')

const adminProperties = () => readSrc('pages', 'AdminProperties.jsx')

const loadTranslations = async () => {
  const raw = await readSrc('locales', 'translations.js')
  const mod = { exports: {} }
  new Function('module', 'exports', raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = '))(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

/** The listing-grid card, which is where the badge lives. */
const propertyCard = async () => {
  const src = await adminProperties()
  const start = src.indexOf('visibleProperties.map(prop => (')
  assert.notEqual(start, -1, 'the admin property card grid was not found')
  return src.slice(start, start + 3000)
}

/* ══════════════ THE FIELD IS ONE CANONICAL BOOLEAN ══════════════ */

test('the model still defines featured as a Boolean defaulting to false', async () => {
  const src = await readBackend('models', 'Property.js')

  assert.ok(/featured:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/.test(src),
    'Property.featured is no longer a Boolean(default false) — the create-form default assumes it is')
})

test('nothing invented a parallel featured field', async () => {
  const src = await adminProperties()

  // One canonical name. A second spelling would silently split the feature in
  // half: the editor writing one field and Home querying the other.
  for (const alias of ['isFeatured', 'featuredStatus', 'homepageFeatured', 'featureOnHome']) {
    assert.equal(src.includes(alias), false, `'${alias}' appeared — featured is the only canonical field`)
  }
})

/* ══════════════ THE EDITOR WRITES IT ══════════════ */

test('the create form defaults featured to false, matching the schema', async () => {
  const src = await adminProperties()
  const empty = /const emptyForm = \{[\s\S]*?\}/.exec(src)
  assert.ok(empty, 'emptyForm not found')

  assert.ok(/featured:\s*false/.test(empty[0]),
    'a new property no longer starts un-featured')
})

test('the edit form loads the stored value instead of resetting it', async () => {
  const src = await adminProperties()
  const openEdit = /const openEdit = [\s\S]*?status: prop\.status \}\)/.exec(src)
  assert.ok(openEdit, 'openEdit not found')

  assert.ok(/featured: prop\.featured/.test(openEdit[0]),
    'editing a property no longer reads its stored featured state — every edit would silently un-feature it')

  // A listing saved before the field existed has no key at all. `?? false`
  // normalises only that case; `|| false` would too, but `?? ` is the narrower
  // signal and neither may be dropped, or the checkbox goes uncontrolled.
  assert.ok(/featured: prop\.featured \?\? false/.test(openEdit[0]),
    'featured is loaded raw — an older listing without the key makes the checkbox uncontrolled')
})

test('the editor still offers a control that writes the field', async () => {
  const src = await adminProperties()

  const checkbox = /<input type="checkbox" id="featured" checked=\{form\.featured\}[^>]*onChange=\{e => setForm\(prev => \(\{\.\.\.prev, featured: e\.target\.checked\}\)\)\}/.exec(src)
  assert.ok(checkbox, 'the Featured checkbox is gone or no longer writes form.featured')

  // e.target.checked is a real boolean. A value/string binding here is what
  // would send "true"/"false" to a Boolean schema path.
  assert.equal(/featured: e\.target\.value/.test(src), false,
    'the checkbox writes a string — the schema path is a Boolean')
})

test('the submit payload carries form state through to the API', async () => {
  const src = await adminProperties()
  const payload = /const payload = \{[\s\S]*?\n {4}\}/.exec(src)
  assert.ok(payload, 'the submit payload object was not found')

  // featured is not listed explicitly; it rides the spread. If the spread ever
  // becomes an explicit allow-list, featured has to be named in it.
  assert.ok(/\.\.\.form,/.test(payload[0]),
    'the payload no longer spreads form state — featured must now be sent explicitly')
})

/* ══════════════ THE GRID SHOWS IT ══════════════ */

test('the card shows a badge, and only when the property is featured', async () => {
  const card = await propertyCard()

  assert.ok(/\{prop\.featured && \(/.test(card),
    'the badge is not gated on prop.featured — it would render on every listing')
  assert.ok(/featuredBadge \|\| 'Featured on Homepage'/.test(card),
    'the badge no longer renders the localized Featured-on-Homepage label')

  // Gated on the stored boolean itself, never on a derived or local list.
  assert.equal(/featuredIds|localFeatured|FEATURED_IDS/.test(card), false,
    'the badge reads something other than the stored field — a second source of truth')
})

test('the badge can actually be positioned against the card', async () => {
  const card = await propertyCard()

  // The badge is absolutely positioned; without `relative` on the card it
  // escapes to the nearest positioned ancestor and lands somewhere arbitrary.
  const cardDiv = /<div key=\{prop\._id\} className="([^"]+)"/.exec(card)
  assert.ok(cardDiv, 'the card wrapper was not found')
  assert.ok(cardDiv[1].split(/\s+/).includes('relative'),
    'the card lost `relative`, so the absolutely positioned badge would detach from it')

  assert.ok(/absolute/.test(card), 'the badge is no longer absolutely positioned')
})

test('the badge label is localized in all six languages', async () => {
  const t = await loadTranslations()

  const seen = new Set()
  for (const lang of LANGS) {
    const label = t[lang]?.adminPages?.properties?.featuredBadge
    assert.ok(typeof label === 'string' && label.trim(),
      `${lang}: adminPages.properties.featuredBadge is missing — the badge falls back to English`)
    seen.add(label)

    // The checkbox label is a separate string (an instruction, "Mark as
    // Featured"); the badge is a state ("Featured on Homepage"). Reusing one
    // for the other reads wrong in every language.
    assert.notEqual(label, t[lang]?.adminPages?.properties?.featured,
      `${lang}: the badge reuses the checkbox label`)
  }
  assert.equal(seen.size, LANGS.length,
    'two languages share a badge label — one was left untranslated')
})

/* ══════════════ THE DATABASE STAYS AUTHORITATIVE ══════════════ */

test('the public list filters on the stored field', async () => {
  const src = await readBackend('routes', 'properties.js')

  assert.ok(/if \(featured !== undefined\) filter\.featured = featured === 'true'/.test(src),
    'GET /properties no longer filters on the stored featured field')
})

test('featured is not stripped by the public projection', async () => {
  const src = await readBackend('routes', 'properties.js')
  const projection = /const PUBLIC_PROPERTY_EXCLUDE = '([^']+)'/.exec(src)
  assert.ok(projection, 'PUBLIC_PROPERTY_EXCLUDE not found')

  // It is an exclusion list. The admin grid reads GET /properties, so the day
  // this becomes an inclusion list the badge silently stops rendering.
  const fields = projection[1].split(/\s+/)
  assert.ok(fields.every((f) => f.startsWith('-')),
    'the projection became an inclusion list — featured must be named in it or the badge goes blank')
  assert.equal(fields.includes('-featured'), false, 'featured is excluded from API responses')
})

test('Home asks the API for featured listings rather than curating its own', async () => {
  const src = await readSrc('pages', 'HomePage.jsx')

  assert.ok(/\/properties\?featured=true/.test(src),
    'Home no longer sources its carousel from the featured query')
  assert.equal(/FEATURED_PROPERTY_IDS|hardcodedFeatured/.test(src), false,
    'Home carries a hardcoded featured list — the database must stay authoritative')
})

/* ══════════════ NOTHING ELSE IN THE EDITOR MOVED ══════════════ */

test('the surrounding AdminProperties architecture is intact', async () => {
  const src = await adminProperties()

  // This file is far newer than the reference the badge came from; the badge
  // was transplanted into it rather than the other way round. These are the
  // systems a whole-file copy would have destroyed.
  for (const [marker, what] of [
    ['agentIdOf', 'agent assignment'],
    ['PropertyLocationPicker', 'location picker'],
    ['locationDirty', 'exact/approximate location handling'],
    ['AdminPropertyAssistant', 'property AI assistant'],
    ['buildDetailsPayload', 'extended detail fields'],
    ["hasPermission('edit_listing')", 'edit permission gate'],
    ["hasPermission('delete_listing')", 'delete permission gate'],
  ]) {
    assert.ok(src.includes(marker), `${what} disappeared from AdminProperties`)
  }
})

test('featured is editable only behind the existing permission gate', async () => {
  const src = await adminProperties()

  // The checkbox lives in the editor, and the editor is reached through Edit /
  // Add, both permission-gated. There must be no separate ungated control.
  assert.equal(/toggleFeatured|handleFeatureToggle/.test(src), false,
    'a standalone featured toggle appeared — it would bypass the editor permission gate')

  const backend = await readBackend('routes', 'properties.js')
  assert.equal(/router\.(patch|post)\([^)]*featured/.test(backend), false,
    'a dedicated featured endpoint appeared — the permission-checked update route already covers this')
})
