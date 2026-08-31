// Wave 14B — the Rich Showroom, as consumed by the admin and the four service
// pages.
//
// Static source contracts in the style of teamRichProfile.contract.test.js:
// no React testing dependency, run with plain `node --test` from frontend/.
//
// The donor's two fields must be BOTH editable in the admin and rendered on
// the public page, and the carousel's new timers must all be torn down. A
// field that exists in only one half, or a timer with no cleanup, is the
// failure mode these guard against.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const read = async (...p) =>
  (await readFile(join(here, '..', 'src', ...p), 'utf8'))
    // Comments stripped so a field named only in prose never counts. Anchored
    // to line start so `accept="image/*"` is not read as a block comment.
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

const RICH_FIELDS = ['title', 'detailText']
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

/* ═══════════ 1. Admin can edit every donor field ═══════════ */

test('1a. the admin form carries both rich fields alongside caption', async () => {
  const s = await read('pages', 'AdminShowroom.jsx')

  const empty = s.match(/const empty = \{[^}]*\}/)
  assert.ok(empty, 'the form default object moved or was renamed')

  for (const f of [...RICH_FIELDS, 'caption']) {
    assert.ok(empty[0].includes(`${f}: ''`), `'${f}' is missing from the empty form state`)
  }
  // Scalars the donor never localized must keep their own defaults.
  assert.ok(empty[0].includes('style:'), 'style fell out of the form')
  assert.ok(empty[0].includes('visible:'), 'visible fell out of the form')
})

test('1b. editing loads the SOURCE text for all three localized fields', async () => {
  const s = await read('pages', 'AdminShowroom.jsx')

  // Same treatment caption already had: the admin edits their own words, not
  // a machine translation, and never "[object Object]".
  for (const f of [...RICH_FIELDS, 'caption']) {
    assert.match(
      s, new RegExp(`${f}: editableText\\(img\\.${f}\\)`),
      `'${f}' is not unwrapped with editableText when the edit form opens`
    )
  }
  // Scalars must NOT be run through the localized unwrapper.
  assert.ok(!/style: editableText/.test(s), 'style is being treated as localized prose')
  assert.ok(!/url: editableText/.test(s), 'the media URL is being treated as localized prose')
})

test('1c. every rich field has a real input bound to the form', async () => {
  const s = await read('pages', 'AdminShowroom.jsx')

  for (const f of RICH_FIELDS) {
    assert.match(s, new RegExp(`value=\\{form\\.${f}\\}`), `'${f}' has no bound input`)
    assert.match(
      s, new RegExp(`setForm\\(f => \\(\\{ \\.\\.\\.f, ${f}: e\\.target\\.value \\}\\)\\)`),
      `'${f}' has an input that never writes back to the form`
    )
  }
  // detailText is prose, so it needs room to write.
  assert.match(s, /<textarea[\s\S]{0,500}value=\{form\.detailText\}/, 'detailText is not a textarea')
})

test('1d. no new upload or storage architecture was introduced', async () => {
  const s = await read('pages', 'AdminShowroom.jsx')

  assert.match(s, /api\.post\('\/upload'/, 'the existing upload route is no longer used')

  // Every upload must go through that one route.
  for (const path of [...s.matchAll(/api\.post\('([^']+)'/g)].map((m) => m[1])) {
    assert.ok(
      path === '/upload' || path.startsWith('/showroom'),
      `AdminShowroom posts to an unexpected endpoint: ${path}`
    )
  }

  // No second storage SDK and no client-side encoder. Checked on imports and
  // API calls rather than on the bare word, because 'cloudinary' also appears
  // in a URL placeholder that predates this wave.
  assert.ok(!/^import .*(cloudinary|aws|mux|uppy)/im.test(s), 'a storage SDK was imported')
  for (const banned of ['FileReader', 'readAsDataURL', 'presigned', 'youtube.com', 'vimeo.com', 'cloudinary.uploader']) {
    assert.ok(!s.includes(banned), `AdminShowroom uses ${banned}`)
  }
})

test('1e. the word counters guide but never block a save', async () => {
  const s = await read('pages', 'AdminShowroom.jsx')

  assert.match(s, /const CAPTION_WORDS = \d+/, 'the caption guidance limit is gone')
  assert.match(s, /const DETAIL_WORDS = \d+/, 'the detail guidance limit is gone')

  // A word count must not appear in a disabled/guard expression — a caption's
  // right length is an editorial judgement, not a data constraint.
  for (const g of [...s.matchAll(/disabled=\{[^}]*\}/g)].map((m) => m[0])) {
    assert.ok(!/WORDS|wordCount/.test(g), `a word count is blocking a control: ${g}`)
  }
  assert.ok(
    !/return[^\n]*(CAPTION_WORDS|DETAIL_WORDS)/.test(s),
    'a submit handler bails out on the word count'
  )
})

/* ═══════════ 2. The public carousel consumes what the admin writes ═══════════ */

test('2a. the carousel resolves all three localized fields', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  for (const f of [...RICH_FIELDS, 'caption']) {
    assert.match(
      s, new RegExp(`loc\\((item|img)\\.${f}\\)`),
      `'${f}' is never resolved for display`
    )
  }
  assert.match(s, /const loc = \(value\) => localizedText\(value, language\)/, 'the resolver changed shape')
  // A media URL is not prose.
  assert.ok(!/loc\((item|img)\.url\)/.test(s), 'the media URL is being run through the localizer')
})

test('2b. detailText drives the expanded panel, and its absence is handled', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  assert.match(s, /const hasDetail = detailText\.trim\(\) !== ''/, 'the empty-detail case is not computed')
  assert.match(s, /\{hasDetail && \(/, 'the detail panel is not conditional on having detail')
  // An item with no detail must still open full size, so the lightbox itself
  // is never gated on detailText.
  assert.ok(!/detailText && <ShowroomLightbox/.test(s), 'items without detail cannot be opened')
  assert.match(s, /\{lightbox && <ShowroomLightbox/, 'the lightbox is not rendered from state')
})

test('2c. opening the lightbox is a real button, not a click handler on a div', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  const opener = s.match(/<button[\s\S]{0,600}?onClick=\{\(\) => setLightbox\(img\)\}[\s\S]{0,400}?>/)
  assert.ok(opener, 'the card that opens the lightbox is not a <button>')
  assert.match(opener[0], /type="button"/, 'the opener has no explicit button type')
  assert.match(opener[0], /aria-label=/, 'the opener has no accessible name')
})

test('2d. the lightbox is a dismissible modal', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  assert.match(s, /role="dialog"/, 'the lightbox is not announced as a dialog')
  assert.match(s, /aria-modal="true"/, 'the lightbox does not trap assistive focus')
  assert.match(s, /e\.key === 'Escape'/, 'Escape does not close the lightbox')
  assert.match(s, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, 'clicking the panel closes the lightbox')
})

test('2e. every timer and listener the carousel starts is torn down', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  const pairs = [
    [/setInterval\(/g, /clearInterval\(/g, 'interval'],
    [/setTimeout\(/g, /clearTimeout\(/g, 'timeout'],
    [/addEventListener\(/g, /removeEventListener\(/g, 'listener'],
  ]
  for (const [start, stop, label] of pairs) {
    const starts = (s.match(start) || []).length
    const stops = (s.match(stop) || []).length
    assert.ok(starts > 0, `no ${label} found — the autoplay/lightbox work is missing`)
    assert.ok(stops >= starts, `${starts} ${label}(s) started but only ${stops} cleaned up`)
  }
  // The body-scroll lock must restore what was there, not assume ''.
  assert.match(s, /const previousOverflow = document\.body\.style\.overflow/, 'the scroll lock does not save the previous value')
  assert.match(s, /document\.body\.style\.overflow = previousOverflow/, 'the scroll lock is not restored')
})

/*
 * The autoplay suspension guard, lifted out of the source and turned into a
 * real predicate.
 *
 * Matching the guard as a string only ever proved that *some* conditions were
 * named — which is exactly why an earlier version of this file passed while
 * manual pause and page visibility shared one boolean and silently cancelled
 * each other. Evaluating the expression instead lets the scenarios below be
 * asserted as outcomes rather than as spelling.
 */
const autoplayGuard = async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  // The autoplay effect is the one that STARTS the interval — anchored on
  // setInterval, because the region above the first useEffect also mentions
  // AUTOPLAY_INTERVAL_MS where the constant is declared.
  const effects = s
    .split('useEffect(')
    .slice(1)
    .filter((chunk) => chunk.includes('setInterval(') && chunk.includes('AUTOPLAY_INTERVAL_MS'))
  assert.equal(effects.length, 1, `expected exactly one autoplay effect, found ${effects.length}`)

  const guard = effects[0].match(/if \(([^)]*)\) return/)
  assert.ok(guard, 'the autoplay effect has no suspension guard')

  const expression = guard[1]
  const names = [...new Set(expression.match(/[A-Za-z_$][\w$]*/g) || [])]

  // Every name the guard reads must be a state value of this component, so
  // the predicate below is evaluating the same thing React does.
  for (const name of names) {
    assert.ok(
      new RegExp(`const \\[${name},`).test(s) || new RegExp(`const ${name} =`).test(s),
      `the guard reads '${name}', which is not a value this component holds`
    )
  }

  // suspended(state) — true when autoplay must NOT run.
  const suspended = new Function(...names, `return Boolean(${expression})`)

  return { source: s, expression, names, suspended: (state) => suspended(...names.map((n) => state[n])) }
}

// The state of a carousel with several images, visible tab, motion allowed,
// no lightbox and no recent interaction: autoplay's one running condition.
const RUNNING = { manualPaused: false, pageHidden: false, motionOk: true, showArrows: true, lightbox: null }

test('2f. manual pause and page visibility are SEPARATE states', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  // Two distinct useState declarations, not one shared flag.
  assert.match(s, /const \[manualPaused, setManualPaused\] = useState\(/, 'there is no dedicated manual-pause state')
  assert.match(s, /const \[pageHidden, setPageHidden\] = useState\(/, 'there is no dedicated page-hidden state')
  assert.ok(!/const \[paused, setPaused\]/.test(s), 'the shared `paused` boolean is still present')

  // A manual arrow touches ONLY the manual state.
  const handler = s.match(/const handleManualStep = \(dir\) => \{[\s\S]*?\n {2}\}/)
  assert.ok(handler, 'handleManualStep moved or was renamed')
  assert.match(handler[0], /setManualPaused\(true\)/, 'a manual arrow does not pause autoplay')
  assert.ok(!/setPageHidden/.test(handler[0]), 'a manual arrow writes the page-visibility state')

  // The 15s resume timer clears ONLY the manual state.
  assert.match(
    s, /setTimeout\(\(\) => setManualPaused\(false\), RESUME_AFTER_MS\)/,
    'the resume timer does not clear the manual pause'
  )
  assert.ok(!/setTimeout\([^)]*setPageHidden/.test(s), 'the resume timer writes the page-visibility state')

  // visibilitychange touches ONLY the page state.
  const onVisibility = s.match(/const onVisibility = [\s\S]{0,120}?\n/)
  assert.ok(onVisibility, 'the visibility handler moved or was renamed')
  assert.match(onVisibility[0], /setPageHidden\(document\.hidden\)/, 'visibility does not track document.hidden')
  assert.ok(!/setManualPaused/.test(onVisibility[0]), 'visibility overwrites the manual pause')

  // Each click restarts the countdown rather than stacking timers.
  assert.match(handler[0], /clearTimeout\(resumeTimerRef\.current\)/, 'a second click does not restart the countdown')
})

test('2g. the autoplay guard reads BOTH pause states independently', async () => {
  const { expression, names } = await autoplayGuard()

  for (const state of ['manualPaused', 'pageHidden', 'motionOk', 'showArrows', 'lightbox']) {
    assert.ok(names.includes(state), `the autoplay guard ignores '${state}': ${expression}`)
  }
})

test('2h. SCENARIO 1 — the manual timer cannot resume autoplay in a hidden tab', async () => {
  const { suspended } = await autoplayGuard()

  // click → hide → the 15s timer expires while still hidden.
  let state = { ...RUNNING, manualPaused: true }
  assert.equal(suspended(state), true, 'a manual click did not suspend autoplay')

  state = { ...state, pageHidden: true }
  assert.equal(suspended(state), true)

  state = { ...state, manualPaused: false }
  assert.equal(suspended(state), true, 'autoplay restarted while the tab was still hidden')
})

test('2i. SCENARIO 2 — returning to the tab does not cut a manual pause short', async () => {
  const { suspended } = await autoplayGuard()

  // click → hide → show again, all inside the 15 seconds.
  let state = { ...RUNNING, manualPaused: true, pageHidden: true }
  state = { ...state, pageHidden: false }
  assert.equal(suspended(state), true, 'becoming visible cancelled an active manual pause')

  // Only when its own timer expires may autoplay resume.
  state = { ...state, manualPaused: false }
  assert.equal(suspended(state), false, 'autoplay never resumes after the manual pause expires')
})

test('2j. SCENARIO 3 — a hidden tab stops autoplay, and returning resumes it', async () => {
  const { suspended } = await autoplayGuard()

  assert.equal(suspended(RUNNING), false, 'autoplay never runs at all')
  assert.equal(suspended({ ...RUNNING, pageHidden: true }), true, 'autoplay keeps running in a hidden tab')
  assert.equal(suspended({ ...RUNNING, pageHidden: false }), false, 'autoplay does not resume when the tab returns')
})

test('2k. SCENARIO 4 — mounting into an already-hidden tab does not start autoplay', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  // Seeded from document.hidden, not blindly false. Lazy so it is read once
  // at mount rather than on every render.
  assert.match(
    s, /const \[pageHidden, setPageHidden\] = useState\(\(\) => document\.hidden\)/,
    'pageHidden is not seeded from document.hidden at mount'
  )
})

test('2l. SCENARIO 5 — reduced motion disables autoplay regardless of visibility', async () => {
  const { suspended } = await autoplayGuard()

  for (const pageHidden of [true, false]) {
    for (const manualPaused of [true, false]) {
      assert.equal(
        suspended({ ...RUNNING, motionOk: false, pageHidden, manualPaused }), true,
        `autoplay ran under reduced motion (pageHidden=${pageHidden}, manualPaused=${manualPaused})`
      )
    }
  }
  assert.match(await read('components', 'ShowroomCarousel.jsx'), /prefers-reduced-motion: reduce/, 'the preference is never queried')
})

test('2m. the lightbox suspends autoplay, and closing it restores the other rules', async () => {
  const { suspended } = await autoplayGuard()

  assert.equal(suspended({ ...RUNNING, lightbox: { url: '/a.png' } }), true, 'autoplay runs behind an open lightbox')

  // Closing it may resume — but only if nothing else is holding.
  assert.equal(suspended({ ...RUNNING, lightbox: null }), false)
  assert.equal(suspended({ ...RUNNING, lightbox: null, manualPaused: true }), true)
  assert.equal(suspended({ ...RUNNING, lightbox: null, pageHidden: true }), true)
  assert.equal(suspended({ ...RUNNING, lightbox: null, motionOk: false }), true)
  assert.equal(suspended({ ...RUNNING, lightbox: null, showArrows: false }), true)
})

test('2n. no single condition can be cancelled by another', async () => {
  const { suspended } = await autoplayGuard()

  // Exhaustive: autoplay runs in exactly ONE of the 32 combinations, the one
  // where every condition permits it. That is the property the shared
  // boolean broke.
  const flags = ['manualPaused', 'pageHidden', 'motionOk', 'showArrows']
  let running = 0

  for (let mask = 0; mask < 32; mask++) {
    const state = { lightbox: mask & 16 ? { url: '/a.png' } : null }
    flags.forEach((f, i) => { state[f] = Boolean(mask & (1 << i)) })
    if (!suspended(state)) running += 1
  }

  assert.equal(running, 1, `autoplay runs under ${running} state combinations; exactly one is correct`)
})

/* ═══════════ 3. No CMS duplication, no new call sites ═══════════ */

test('3a. showroom prose is stored on the record, not in the CMS registry', async () => {
  const registry = await read('lib', 'pageContentRegistry.js')

  for (const f of ['showroomTitle', 'showroomDetail', 'showroomCaption']) {
    assert.ok(!registry.includes(f), `the CMS registry duplicates showroom prose as '${f}'`)
  }
})

test('3b. the four service pages did not need changing', async () => {
  // isDarkBackground() measures the literal hex each page already passes, so
  // no call site had to learn a new prop. If a page starts passing `dark`,
  // that is fine — but a page that passes title/caption/detail data would
  // mean the carousel stopped owning its own rendering.
  for (const page of ['ArchitecturePage', 'ConstructionPage', 'InteriorDesignPage', 'RenovationPage']) {
    const s = await read('pages', `${page}.jsx`)
    const uses = [...s.matchAll(/<ShowroomCarousel[\s\S]{0,400}?\/>/g)]
    assert.ok(uses.length > 0, `${page} no longer renders the carousel`)

    for (const use of uses) {
      assert.match(use[0], /bgColor=/, `${page} stopped passing bgColor, which the ink contrast is measured from`)
      for (const f of [...RICH_FIELDS, 'caption']) {
        assert.ok(!use[0].includes(`${f}=`), `${page} passes '${f}' — the carousel should own that`)
      }
    }
  }
})

/* ═══════════ 4. Six languages ═══════════ */

test('4a. every new static label exists in all six languages', async () => {
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

  const COMMON = ['noImagesYet', 'previous', 'next', 'explore', 'close', 'image', 'video']
  const ADMIN = ['titleLabel', 'titleHint', 'captionHint', 'detailText', 'detailHint', 'previewLabel', 'words']

  for (const lang of LANGS) {
    for (const key of [...COMMON, ...ADMIN]) {
      assert.match(blocks[lang], new RegExp(`\\b${key}: '`), `'${key}' is missing from '${lang}'`)
    }
  }
})

test('4b. the carousel reads its labels from the dictionary, with a fallback', async () => {
  const s = await read('components', 'ShowroomCarousel.jsx')

  for (const key of ['noImagesYet', 'previous', 'next', 'explore', 'close', 'image', 'video']) {
    assert.match(
      s, new RegExp(`t\\.common\\?\\.${key} \\|\\| '`),
      `'${key}' is hard-coded rather than read from the dictionary with a fallback`
    )
  }
})
