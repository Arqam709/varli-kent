// The Showroom editor modal — the structure that keeps an admin from being
// trapped inside it.
//
// ── Why this file exists ────────────────────────────────────────────────
// The editor is the tallest form in the admin: upload box, media preview, two
// textareas (one 5 rows), a live caption preview, and the order/visible row.
// It used to render as an unbounded panel inside a `fixed inset-0` overlay
// that had `items-center` and no scrolling of any kind. Once the content grew
// past the viewport the panel overflowed EQUALLY off the top and the bottom:
// the header — and the close button in it — went above y=0, the footer went
// below the fold, and because the overlay is `fixed` with `overflow: visible`
// there was no scrollbar anywhere to reach either one. At 1366x768 the admin
// could open the editor and have no way out short of reloading the page.
//
// The fix is the shape AdminUsers.jsx's permissions dialog already uses: a
// height-bounded flex column whose header and footer are shrink-0 and whose
// field list is the only part that scrolls.
//
// These assert STRUCTURE, not styling: which element carries the height bound,
// which one scrolls, and that the ways out exist and cannot submit the form.
// Tailwind class ORDER is never asserted — only that the required utilities
// are present on the right element.
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

const loadTranslations = async () => {
  const raw = await readSrc('locales', 'translations.js')
  const mod = { exports: {} }
  new Function('module', 'exports', raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = '))(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

/** The editor modal only — not the delete-confirmation dialog above it. */
const editorModal = async () => {
  const src = await readSrc('pages', 'AdminShowroom.jsx')
  const start = src.indexOf('{modal !== null && (')
  assert.notEqual(start, -1, 'the editor modal block was not found')
  const end = src.indexOf('{confirm && <ConfirmModal', start)
  assert.notEqual(end, -1, 'could not find the end of the editor modal block')
  return src.slice(start, end)
}

/**
 * The class list of the element whose OWN className contains `marker`.
 *
 * Deliberately not "the next className after the marker": every marker used
 * below sits inside the class list it is meant to identify, so scanning forward
 * would return the child element's classes instead.
 */
const classesOf = (block, marker) => {
  const lists = [...block.matchAll(/className="([^"]+)"/g)].map((m) => m[1])
  const hit = lists.filter((list) => list.includes(marker))
  assert.equal(hit.length, 1,
    `expected exactly one element whose className contains '${marker}', found ${hit.length}`)
  return hit[0].split(/\s+/)
}

/**
 * The <div> nesting depth at which each marked element opens.
 *
 * Used to assert sibling-vs-child relationships structurally, without depending
 * on indentation or on how many wrapper divs the form happens to contain.
 *
 * A plain /<div[^>]*>/ will not do: JSX attributes contain `>` characters of
 * their own (`onClick={() => ...}`), so a regex ends the tag early and the
 * depth count silently drifts. This walks to each tag's real closing `>`,
 * skipping over quoted strings and braced expressions.
 */
const divDepths = (block, markers) => {
  const found = markers.map((m) => [m, null])
  let depth = 0

  for (let i = 0; i < block.length; i += 1) {
    if (block.startsWith('</div>', i)) {
      depth -= 1
      i += 5
      continue
    }
    if (!block.startsWith('<div', i) || !/[\s>]/.test(block[i + 4] || '')) continue

    let j = i + 4
    let braces = 0
    let quote = null
    for (; j < block.length; j += 1) {
      const ch = block[j]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
      } else if (ch === '{') {
        braces += 1
      } else if (ch === '}') {
        braces -= 1
      } else if (ch === '>' && braces === 0) {
        break
      }
    }

    const tag = block.slice(i, j + 1)
    for (const entry of found) {
      if (entry[1] === null && tag.includes(entry[0])) entry[1] = depth
    }
    // The upload spinner is a self-closing `<div ... />`; counting it as an
    // open would drift every depth measured after it by one.
    if (!tag.endsWith('/>')) depth += 1
    i = j
  }

  for (const [marker, d] of found) assert.notEqual(d, null, `no <div> found carrying '${marker}'`)
  return found.map(([, d]) => d)
}

/* ══════════════ HEIGHT IS BOUNDED BY THE VIEWPORT ══════════════ */

test('the modal panel is bounded by the viewport height', async () => {
  const block = await editorModal()

  // Some max-height keyed to the viewport must exist, or the panel grows with
  // its content and overflows the fixed overlay again.
  const bound = /max-h-\[\d+(dvh|vh)\]/.exec(block)
  assert.ok(bound, 'the panel has no viewport-relative max-height — it can outgrow the screen again')

  const pct = Number(/\d+/.exec(bound[0])[0])
  assert.ok(pct > 0 && pct <= 95,
    `max-height is ${pct}% of the viewport — leave visible breathing room around the modal`)
})

test('the height bound sits on the panel, not the overlay', async () => {
  const block = await editorModal()

  // The overlay is `fixed inset-0`, already exactly the viewport. Bounding it
  // does nothing; the bound has to be on the panel that actually grows.
  const overlay = classesOf(block, 'fixed inset-0')
  assert.ok(overlay.includes('fixed') && overlay.includes('inset-0'))
  assert.equal(overlay.some((cls) => cls.startsWith('max-h-[')), false,
    'the max-height is on the overlay, where it has no effect')

  const panel = classesOf(block, 'max-w-md')
  assert.ok(panel.some((cls) => /^max-h-\[\d+(dvh|vh)\]$/.test(cls)),
    'the panel that grows is not the element carrying the height bound')
  assert.ok(panel.includes('flex') && panel.includes('flex-col'),
    'the panel must be a flex column for its body to scroll inside it')
})

/* ══════════════ ONLY THE FIELDS SCROLL ══════════════ */

test('the form body scrolls inside the panel', async () => {
  const block = await editorModal()
  const body = classesOf(block, 'overflow-y-auto')

  assert.ok(body.includes('overflow-y-auto'), 'nothing in the modal scrolls')
  // Without min-h-0 a flex child refuses to shrink below its content height and
  // overflow-y-auto silently never engages — the exact trap being fixed.
  assert.ok(body.includes('min-h-0'),
    'the scroll container has no min-h-0, so it will not shrink and will not scroll')
  assert.ok(body.includes('flex-1'),
    'the scroll container does not claim the leftover height between header and footer')
})

test('the depth walk agrees with the file it is reading', async () => {
  // A self-check on the helper above, since a silently drifting depth count
  // would make the sibling assertion below pass or fail for the wrong reason.
  const block = await editorModal()
  const [overlay, panel] = divDepths(block, ['fixed inset-0', 'max-w-md'])

  assert.equal(overlay, 0, 'the overlay is not the outermost element of the modal block')
  assert.equal(panel, 1, 'the panel is not a direct child of the overlay')
})

test('the header and footer are excluded from the scrolling region', async () => {
  const block = await editorModal()

  // Both must be shrink-0, or a tall body squeezes them to nothing.
  const header = classesOf(block, 'border-b border-slate-100')
  assert.ok(header.includes('shrink-0'), 'the header can be squeezed away by a tall form')

  const footer = classesOf(block, 'border-t border-slate-100')
  assert.ok(footer.includes('shrink-0'), 'the footer can be squeezed away by a tall form')

  // And the footer must live OUTSIDE the scroll container, or Save scrolls away
  // with the fields. Compare <div> depth so the check says what it means: the
  // two are siblings, not parent and child.
  const [scrollDepth, footerDepth] = divDepths(block, ['overflow-y-auto', 'border-t border-slate-100'])
  assert.equal(footerDepth, scrollDepth,
    'the footer is nested inside the scroll container — Save and Cancel scroll out of reach')
})

/* ══════════════ THE WAYS OUT ══════════════ */

test('the header carries a close button that cannot submit the form', async () => {
  const block = await editorModal()

  const close = /<button type="button" onClick=\{closeModal\}[^>]*aria-label=/.exec(block)
  assert.ok(close,
    'the header close button is missing, is not type="button", or has no accessible label')

  // An X glyph, not a text character pretending to be one.
  const header = block.slice(0, block.indexOf('<form'))
  assert.ok(/M6 18L18 6M6 6l12 12/.test(header), 'the close control is not the X icon')
})

test('the close label is localized in all six languages', async () => {
  const t = await loadTranslations()
  for (const lang of LANGS) {
    const label = t[lang]?.adminPages?.common?.close
    assert.ok(typeof label === 'string' && label.trim(),
      `${lang}: adminPages.common.close is missing — the close button falls back to English`)
  }
})

test('Cancel exists, is type="button", and closes rather than submits', async () => {
  const block = await editorModal()

  const cancel = /<button type="button" onClick=\{closeModal\}[^>]*>\{c\.cancel \|\| 'Cancel'\}<\/button>/.exec(block)
  assert.ok(cancel, 'the Cancel button is missing or no longer routes through closeModal')
})

test('X, Cancel and Escape all go through one close handler', async () => {
  const src = await readSrc('pages', 'AdminShowroom.jsx')

  assert.ok(/const closeModal = useCallback\(/.test(src), 'the shared close handler is gone')

  // Nothing inside the modal may close it by poking state directly — that is how
  // the three paths drift into doing different cleanup.
  const block = await editorModal()
  assert.equal(/onClick=\{\(\) => setModal\(null\)\}/.test(block), false,
    'a control still closes the modal without going through closeModal()')
})

test('Escape closes the editor and the listener is cleaned up', async () => {
  const src = await readSrc('pages', 'AdminShowroom.jsx')
  const effect = /useEffect\(\(\) => \{\s*if \(modal === null\) return[\s\S]*?\}, \[modal[^\]]*\]\)/.exec(src)
  assert.ok(effect, 'the Escape effect is missing or no longer bails out when the modal is closed')

  assert.ok(/e\.key !== 'Escape'/.test(effect[0]),
    'the handler reacts to keys other than Escape')
  assert.ok(/removeEventListener\('keydown'/.test(effect[0]),
    'the keydown listener is never removed — it outlives the modal')
  assert.ok(/if \(saving \|\| uploading\) return/.test(effect[0]),
    'Escape can close the modal mid-save or mid-upload')
})

/* ══════════════ SAVE, AND EVERY FIELD, SURVIVED ══════════════ */

test('the submit button and every existing field are still present', async () => {
  const block = await editorModal()

  assert.ok(/<button type="submit"/.test(block), 'the Save/Add button is gone')
  assert.ok(/onSubmit=\{handleSubmit\}/.test(block), 'the form no longer submits through handleSubmit')

  for (const marker of [
    'p.uploadLabel',      // Click to upload
    'p.orPasteUrl',       // Paste URL
    'p.titleLabel',       // Title
    'p.caption',          // Caption
    'p.previewLabel',     // Preview on public page
    'p.detailText',       // Detail text
    'p.orderLabel',       // Display order
    'p.showOnPage',       // Visible
    'p.designStyle',      // Interior-only style select
  ]) {
    assert.ok(block.includes(marker), `the ${marker} field was dropped from the editor`)
  }

  // Both media modes still render from the same preview branch.
  assert.ok(/isVideo\(form\.url\)/.test(block), 'the video/image preview branch is gone')
})

test('long unbroken text cannot widen the panel', async () => {
  const block = await editorModal()

  // The caption preview renders raw admin text; everything else is an input or
  // a wrapped hint. An unbroken URL pasted as a caption must wrap, not scroll.
  const preview = block.slice(block.indexOf('p.previewLabel'))
  assert.ok(/break-words/.test(preview.slice(0, 800)),
    'the caption preview does not break long words — it can force horizontal overflow')
})

test('the modal keeps the admin z-index convention', async () => {
  const block = await editorModal()
  const overlay = classesOf(block, 'fixed inset-0')

  assert.ok(overlay.includes('z-50'),
    'the overlay left the z-50 convention every other admin modal uses')
  assert.equal(/z-\[\d{3,}\]/.test(block), false,
    'an arbitrary huge z-index was introduced instead of the shared layer')
})

/* ══════════════ NOTHING GETS STUCK ══════════════ */

test('the modal does not lock body scrolling', async () => {
  const src = await readSrc('pages', 'AdminShowroom.jsx')

  // The panel has its own scroll, so a body lock buys nothing and adds five
  // exit paths that could each leave `overflow: hidden` stuck on <body>.
  assert.equal(/document\.body\.style/.test(src), false,
    'a body scroll lock was introduced — it must be cleaned up on every exit path')
})
