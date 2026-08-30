// Wave 14A — the Rich Team profile, as consumed by the two pages.
//
// Static source contracts in the style of pageContentCoverage.test.js: no
// React testing dependency, run with plain `node --test` from frontend/.
//
// The donor's three fields must be BOTH editable in the admin and rendered on
// the public page. A field that only exists in one half is the failure mode
// these guard against.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const read = async (...p) =>
  (await readFile(join(here, '..', 'src', ...p), 'utf8'))
    // Comments stripped so a field named only in prose never counts.
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

const RICH_FIELDS = ['secondaryPhoto', 'longBio', 'workImages']
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

/* ═══════════ 1. Admin can edit every donor field ═══════════ */

test('1a. the admin form carries all three rich fields', async () => {
  const s = await read('pages', 'AdminTeam.jsx')

  for (const f of RICH_FIELDS) {
    assert.ok(new RegExp(`${f}:`).test(s), `AdminTeam has no '${f}' in its form state`)
  }
  assert.match(s, /workImages: \[\]/, 'workImages does not default to an empty array in the form')
})

test('1b. editing loads the SOURCE text for the localized longBio', async () => {
  const s = await read('pages', 'AdminTeam.jsx')

  // Same treatment role/bio already get: the admin edits their own words, not
  // a machine translation, and never "[object Object]".
  assert.match(s, /longBio: editableText\(m\.longBio\)/, 'longBio is not unwrapped with editableText')
  assert.match(s, /role: editableText\(m\.role\)/, 'role unwrapping regressed')
  assert.match(s, /bio: editableText\(m\.bio\)/, 'bio unwrapping regressed')
})

test('1c. images upload through the existing /api/upload route', async () => {
  const s = await read('pages', 'AdminTeam.jsx')

  assert.match(s, /api\.post\('\/upload', fd/, 'a new upload path was introduced')
  assert.match(s, /fd\.append\('image', file\)/, 'the existing upload form field was not reused')
  // No second storage architecture.
  for (const banned of ['cloudinary', 'FileReader', 'readAsDataURL', 's3', 'presigned']) {
    assert.ok(!s.toLowerCase().includes(banned.toLowerCase()), `AdminTeam references ${banned}`)
  }
})

test('1e. BOTH single-image fields use the one uploader', async () => {
  // The donor uploads its main grid photo as well as the secondary one.
  // CURRENT previously had a URL-only input for `photo`, so wiring the new
  // component to secondaryPhoto alone would have left that donor capability
  // unmigrated.
  const s = await read('pages', 'AdminTeam.jsx')

  const uploaders = [...s.matchAll(/<ImageUploadField\b[\s\S]*?\/>/g)].map((m) => m[0])
  assert.equal(uploaders.length, 2, `expected two ImageUploadField usages, found ${uploaders.length}`)

  const main = uploaders.find((u) => u.includes('value={form.photo}'))
  const secondary = uploaders.find((u) => u.includes('value={form.secondaryPhoto}'))

  assert.ok(main, 'the main grid photo does not use ImageUploadField')
  assert.ok(secondary, 'the secondary profile photo does not use ImageUploadField')

  assert.match(main, /onChange=\{url => setForm\(f => \(\{ \.\.\.f, photo: url \}\)\)\}/, 'main photo is not wired to form.photo')
  assert.match(secondary, /onChange=\{url => setForm\(f => \(\{ \.\.\.f, secondaryPhoto: url \}\)\)\}/, 'secondary photo is not wired to form.secondaryPhoto')

  // One component, not a second abstraction per field.
  for (const banned of ['MainPhotoUpload', 'PhotoUploader', 'SinglePhotoField']) {
    assert.ok(!s.includes(banned), `a duplicate uploader (${banned}) was introduced`)
  }
})

test('1f. replacing the old input did not remove manual URL entry', async () => {
  // CURRENT's `photo` field was a plain URL input. The uploader keeps a text
  // input alongside the upload control, so pasting an already-hosted URL still
  // works for BOTH single-image fields — a capability the donor's own
  // uploader does not have.
  const s = await read('pages', 'AdminTeam.jsx')
  const component = s.slice(s.indexOf('const ImageUploadField'), s.indexOf('const WorkGalleryField'))

  assert.match(component, /value=\{value \|\| ''\}/, 'the manual URL input was removed')
  assert.match(component, /onChange=\{e => onChange\(e\.target\.value\)\}/, 'the manual URL input is not wired')
  assert.match(component, /placeholder="https:\/\/…"/, 'the URL input lost its placeholder')

  // And the old URL-only field is genuinely gone, not merely duplicated.
  assert.ok(
    !/value=\{form\.photo\}\s+onChange=\{e => setForm/.test(s),
    'the old URL-only photo input is still present'
  )
})

test('1d. gallery items can be removed individually and are bounded', async () => {
  const s = await read('pages', 'AdminTeam.jsx')

  assert.match(s, /onChange\(list\.filter\(\(_, j\) => j !== i\)\)/, 'a gallery image cannot be removed')
  assert.match(s, /MAX_WORK_IMAGES/, 'the gallery is unbounded in the admin')
})

/* ═══════════ 2. The public page consumes every field ═══════════ */

test('2a. the profile modal renders all three rich fields', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  assert.match(s, /member\.secondaryPhoto \|\| member\.photo/, 'secondaryPhoto is not used, or has no fallback')
  assert.match(s, /loc\(member\.longBio\)/, 'longBio is not rendered')
  assert.match(s, /member\.workImages/, 'workImages is not rendered')
})

test('2b. localized values resolve through the shared resolver', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  // One localization interpretation for the whole frontend.
  assert.match(s, /const loc = \(value\) => localizedText\(value, language\)/, 'a second resolver was introduced')
  assert.ok(!/isPoisonedTranslation/.test(s), 'a second poison check was introduced')
  // And no live translation on a public page.
  for (const banned of ['mymemory', 'translated.net', 'localizeText', '/translate']) {
    assert.ok(!s.toLowerCase().includes(banned.toLowerCase()), `TeamPage references ${banned}`)
  }
})

test('2c. optional data degrades safely', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  // A missing gallery hides the Work tab rather than rendering an empty grid.
  assert.match(s, /const hasWork = workImages\.length > 0/, 'gallery presence is not checked')
  assert.match(s, /\{hasWork && \(/, 'the Work tab is rendered unconditionally')
  // A missing longBio falls back to bio, then to a localized message.
  assert.match(s, /longBio \|\| bio \|\|/, 'longBio has no fallback chain')
  // A broken image hides itself instead of leaving an empty frame.
  assert.match(s, /onError=\{\(e\) => \{ e\.currentTarget\.style\.display = 'none' \}\}/, 'a broken gallery image is not handled')
  // Non-array workImages cannot crash .length / .map
  assert.match(s, /Array\.isArray\(member\.workImages\) \? member\.workImages : \[\]/, 'workImages is not defensively normalised')
})

test('2d. the existing card content is preserved', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  for (const kept of ['m.photo', 'loc(m.role)', 'loc(m.bio)', 'm.name']) {
    assert.ok(s.includes(kept), `the card lost ${kept}`)
  }
})

/* ═══════════ 3. Accessibility of the new interaction ═══════════ */

test('3a. the card is a real button, not a clickable div', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  assert.match(s, /<motion\.button/, 'the card is not a button')
  assert.match(s, /aria-label=\{`\$\{m\.name\}/, 'the card button has no accessible name')
  assert.match(s, /onClick=\{\(\) => setSelected\(m\)\}/, 'the card does not open the profile')
})

test('3b. the modal has dialog semantics, Escape and a close control', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  assert.match(s, /role="dialog"/, 'no dialog role')
  assert.match(s, /aria-modal="true"/, 'not marked as modal')
  assert.match(s, /e\.key === 'Escape'/, 'Escape does not close the modal')
  assert.match(s, /aria-label=\{t\.teamPage\?\.closeProfile/, 'the close button has no accessible name')
  // Backdrop closes; the panel itself must not.
  assert.match(s, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, 'clicking inside the modal closes it')
  // No native dialogs.
  assert.ok(!/window\.(alert|confirm)/.test(s), 'a native dialog was introduced')
})

test('3c. body scroll is locked and restored to its previous value', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  assert.match(s, /const previousOverflow = document\.body\.style\.overflow/, 'the previous overflow is not captured')
  assert.match(s, /document\.body\.style\.overflow = previousOverflow/, 'scrolling is not restored on close')
})

test('3d. a member that disappears closes the modal', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  assert.match(
    s,
    /members\.find\(\(m\) => m\._id === selected\._id\) \|\| null/,
    'the modal renders a captured object rather than the live member'
  )
})

/* ═══════════ 4. Boundaries ═══════════ */

test('4a. the Team page CMS wiring from Wave 13A is untouched', async () => {
  const s = await read('pages', 'TeamPage.jsx')

  for (const key of ['heroLabel', 'heroHeading', 'heroSubtitle', 'emptyText']) {
    assert.ok(s.includes(`cms('${key}'`), `TeamPage stopped reading CMS ${key}`)
  }
  assert.match(s, /usePageContent\('team'\)/, 'the CMS hook was removed')
})

test('4b. team member data was not moved into the CMS', async () => {
  const registry = await readFile(join(here, '..', 'src', 'lib', 'pageContentRegistry.js'), 'utf8')
  const team = registry.slice(registry.indexOf('  team: {'), registry.indexOf('  contact: {'))

  for (const f of [...RICH_FIELDS, 'photo', 'role', 'bio']) {
    assert.ok(!team.includes(`'${f}'`), `${f} was added to the Page Content registry`)
  }
})

test('4c. no Showroom work leaked into this wave', async () => {
  const s = await read('pages', 'TeamPage.jsx')
  for (const banned of ['ShowroomCarousel', 'detailText', 'lightbox']) {
    assert.ok(!s.includes(banned), `TeamPage references ${banned}`)
  }
})

/* ═══════════ 5. Six languages ═══════════ */

test('5a. every new public label exists in all six languages', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  for (const lang of LANGS) {
    for (const key of ['viewProfile', 'aboutTab', 'workTab', 'noBio', 'closeProfile']) {
      const value = translations[lang]?.teamPage?.[key]
      assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}.teamPage.${key} is missing`)
    }
  }
})

test('5b. every new admin label exists in all six languages', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  const keys = [
    'profileSectionLabel', 'profilePhoto', 'profilePhotoHint',
    'detailedInfo', 'detailedInfoPlaceholder', 'detailedInfoHint',
    'workGallery', 'workGalleryHint',
    'clickToUpload', 'uploading', 'uploaded', 'uploadFailed',
    'noImage', 'removeImage', 'imagesAdded', 'galleryFull',
  ]

  for (const lang of LANGS) {
    for (const key of keys) {
      const value = translations[lang]?.adminPages?.team?.[key]
      assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}.adminPages.team.${key} is missing`)
    }
  }
})

test('5c. the count placeholders survive translation', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  for (const lang of LANGS) {
    const team = translations[lang].adminPages.team
    assert.ok(team.imagesAdded.includes('{n}'), `${lang} imagesAdded lost its {n}`)
    assert.ok(team.galleryFull.includes('{n}'), `${lang} galleryFull lost its {n}`)
  }
})
