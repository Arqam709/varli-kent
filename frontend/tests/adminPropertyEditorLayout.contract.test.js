// The Add/Edit Property editor's shape — overlay, section order, and the
// blocks that must travel together.
//
// ── Why this file exists ────────────────────────────────────────────────
// The editor was reorganised to match the reference design: a fixed overlay so
// the listing grid stays put behind it, the reference's row pairings, Featured
// closing the basic block, and Property Location as its own section. Everything
// else — agent assignment, the permission-gated AI assistant, tri-state optional
// fields, the location state machine — had to survive untouched.
//
// The dangerous move was Location. It is not just <PropertyLocationPicker />:
// the 'loading' branch, the 'unknown' branch (hint + permission-gated retry)
// and the none/set branch are one state machine, and locationDirty/LOCATION_NONE
// are what tell handleSubmit whether to omit the key, send null, or send
// coordinates. Moving the picker alone would compile, look right, and silently
// overwrite stored pins. So the contracts below check the whole block landed,
// not that a map renders.
//
// The overlay carries its own risk, and it is the one the Showroom editor hit:
// an items-center overlay with no overflow pushes a tall panel off BOTH edges
// with no way to scroll it back. This form is far longer than that one, so the
// scroll contract below is load-bearing, not cosmetic.
//
// Static source contracts, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const readSrc = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')
const adminProperties = () => readSrc('pages', 'AdminProperties.jsx')

/** Just the editor panel: `{formOpen && (` through the end of its </form>. */
const editor = async () => {
  const src = await adminProperties()
  const start = src.indexOf('{formOpen && (')
  assert.notEqual(start, -1, 'the editor panel was not found')
  const end = src.indexOf('</form>', start)
  assert.notEqual(end, -1, 'the editor form has no closing tag')
  return src.slice(start, end)
}

/** Source offset of a marker, asserted to occur exactly once. */
const at = (src, marker) => {
  const i = src.indexOf(marker)
  assert.notEqual(i, -1, `marker not found: ${marker}`)
  assert.equal(src.indexOf(marker, i + 1), -1, `marker appears more than once: ${marker}`)
  return i
}

/* ══════════════ OVERLAY ══════════════ */

test('the editor renders in a fixed overlay above the listing grid', async () => {
  const block = await editor()
  const overlay = /<div className="(fixed inset-0[^"]*)">/.exec(block)
  assert.ok(overlay, 'the editor is not a fixed overlay — opening it would push the property cards down the page')

  const classes = overlay[1].split(/\s+/)
  assert.ok(classes.includes('fixed') && classes.includes('inset-0'), 'the overlay does not cover the viewport')
  assert.ok(classes.some((c) => /^z-\d+$/.test(c)), 'the overlay has no z-index and could render under the admin chrome')
  assert.ok(classes.includes('bg-black/50'), 'the overlay has no dark scrim')
})

test('the overlay scrolls, so this very long form cannot trap the admin', async () => {
  const block = await editor()
  const overlay = /<div className="(fixed inset-0[^"]*)">/.exec(block)[1].split(/\s+/)

  // The exact pair that went wrong in the Showroom editor: items-center with no
  // overflow pushes a tall panel off the top AND the bottom, with no scrollbar
  // anywhere to reach the header or the Save button.
  assert.ok(overlay.includes('overflow-y-auto'),
    'the overlay does not scroll — a form taller than the viewport becomes unreachable')
  assert.ok(overlay.includes('items-start'),
    'the overlay centres its panel vertically; with a form this tall that pushes the header off-screen')
  assert.equal(overlay.includes('items-center'), false,
    'items-center on a scrolling overlay re-creates the trapped-panel bug')
})

test('the panel is width-capped inside the overlay', async () => {
  const block = await editor()
  const panel = /<div className="(w-full max-w-[^"]*)">/.exec(block)
  assert.ok(panel, 'the editor panel has no width cap — its 2-column rows would stretch across the viewport')

  const classes = panel[1].split(/\s+/)
  assert.ok(classes.includes('max-w-3xl'), `expected max-w-3xl, got: ${panel[1]}`)
  assert.ok(classes.includes('w-full'), 'the panel lost w-full — it would not stay fluid below the cap')
})

test('the panel is not itself height-capped, so the overlay owns scrolling', async () => {
  const block = await editor()
  const panel = /<div className="(w-full max-w-[^"]*)">/.exec(block)[1]

  // Either the overlay scrolls or the panel does. Capping both is what produces
  // a nested scrollbar the admin has to find.
  assert.equal(/max-h-/.test(panel), false,
    'the panel is height-capped as well as the overlay scrolling — that nests two scroll areas')
})

test('the listing grid is not nested inside the overlay', async () => {
  const src = await adminProperties()
  const block = await editor()

  // The cards must stay in page flow behind the scrim, not be re-parented into
  // the dialog, or closing the editor would take the grid with it.
  assert.equal(/visibleProperties\.map/.test(block), false,
    'the property card grid moved inside the editor overlay')
  assert.ok(/visibleProperties\.map/.test(src), 'the property card grid disappeared entirely')
})

test('no backdrop click-to-close was introduced on the overlay', async () => {
  const block = await editor()
  const overlayTag = block.slice(block.indexOf('fixed inset-0') - 40, block.indexOf('fixed inset-0') + 300)

  // A stray click must not discard a form this long; there is no unsaved-changes
  // guard behind it. X, Cancel and Escape are the deliberate ways out.
  assert.equal(/onClick=\{\(\) => setFormOpen\(false\)\}/.test(overlayTag), false,
    'the overlay closes on a backdrop click — a misclick would discard the whole form')
  assert.equal(/stopPropagation/.test(block), false,
    'stopPropagation appeared, which is the tell-tale of a backdrop close handler')
})

test('Escape closes the editor and the listener is cleaned up', async () => {
  const src = await adminProperties()
  const effect = /useEffect\(\(\) => \{\s*if \(!formOpen\) return[\s\S]*?\}, \[formOpen[^\]]*\]\)/.exec(src)
  assert.ok(effect, 'the Escape effect is missing or no longer bails out when the form is closed')

  assert.ok(/e\.key !== 'Escape'/.test(effect[0]), 'the handler reacts to keys other than Escape')
  assert.ok(/removeEventListener\('keydown'/.test(effect[0]),
    'the keydown listener is never removed — it outlives the form')
  assert.ok(/if \(saving\) return/.test(effect[0]), 'Escape can close the form mid-save')
})

test('X, Cancel and Escape share one close handler', async () => {
  const src = await adminProperties()
  const block = await editor()

  assert.ok(/const closeForm = useCallback\(/.test(src), 'the shared close handler is gone')
  assert.ok(/<button type="button" onClick=\{closeForm\}[^>]*aria-label=/.test(block),
    'the header X is missing, is not type="button", or has no accessible label')
})

/* ══════════════ SECTION ORDER ══════════════ */

test('the form sections run in the intended order', async () => {
  const block = await editor()

  const order = [
    'AdminPropertyAssistant',
    'id="featured"',
    "p.sectionSizeLayout || 'Size & Layout'",
    "p.sectionBuilding || 'Building Details'",
    "p.sectionAmenities || 'Amenities'",
    "p.sectionLegalUsage || 'Legal & Usage'",
    "p.sectionTransport || 'Nearby Transport'",
    "p.sectionVirtualTour || 'Virtual Tour'",
    "p.propertyLocation || 'Property Location'",
    "p.images || 'Property Images'",
  ]

  let previous = -1
  for (const marker of order) {
    const i = at(block, marker)
    assert.ok(i > previous, `'${marker}' is out of order in the editor`)
    previous = i
  }
})

test('Featured closes the basic block, right after the contact fields', async () => {
  const block = await editor()

  const whatsapp = at(block, "p.whatsapp || 'WhatsApp Number'")
  const featured = at(block, 'id="featured"')
  const location = at(block, "p.propertyLocation || 'Property Location'")

  assert.ok(featured > whatsapp, 'Featured no longer follows the agent/contact fields')
  assert.ok(featured < location, 'Location is back above Featured, splitting the basic block again')

  // Nothing but the closing of the grid should sit between them.
  const between = block.slice(whatsapp, featured)
  assert.equal(/PropertyLocationPicker/.test(between), false,
    'the location picker is back between the contact fields and Featured')
})

test('the Featured control itself was moved, not rewritten', async () => {
  const block = await editor()

  assert.ok(/<input type="checkbox" id="featured" checked=\{form\.featured\}/.test(block),
    'the Featured checkbox no longer binds to form.featured')
  assert.ok(/featured: e\.target\.checked/.test(block),
    'the Featured checkbox no longer writes a boolean')
})

/* ══════════════ LOCATION MOVED WHOLE ══════════════ */

test('Property Location is its own section, using the shared section classes', async () => {
  const block = await editor()
  const i = at(block, "p.propertyLocation || 'Property Location'")
  const context = block.slice(Math.max(0, i - 200), i + 100)

  assert.ok(/className=\{sectionCls\}/.test(context),
    'the location block is not wrapped in sectionCls — it will not match the other sections')
  assert.ok(/className=\{sectionTitleCls\}/.test(context),
    'the location heading does not use sectionTitleCls')

  // It is a heading now, not a field label inside a grid cell.
  assert.equal(/md:col-span-2/.test(context), false,
    'the location block is still a grid cell — it was not lifted out of the basic grid')
})

test('every branch of the location state machine travelled with it', async () => {
  const block = await editor()
  const start = at(block, "p.propertyLocation || 'Property Location'")
  const section = block.slice(start, block.indexOf("p.images || 'Property Images'", start))

  // Moving only <PropertyLocationPicker /> would compile and look correct while
  // dropping the states that stop a stored pin being overwritten.
  for (const [marker, why] of [
    ["location.status === 'loading'", 'the loading branch'],
    ["p.locationLoading || 'Loading saved location…'", 'the loading message'],
    ["location.status === 'unknown'", 'the unknown branch'],
    ['p.locationUnavailable ||', 'the unavailable message'],
    ['p.locationUnavailableHint ||', 'the do-not-overwrite hint'],
    ["p.locationRetry || 'Retry'", 'the retry control'],
    ['loadAdminLocation(editingId)', 'the retry handler'],
    ["hasPermission('edit_listing')", 'the retry permission gate'],
    ["location.status === 'none' || location.status === 'set'", 'the none/set branch'],
    ['<PropertyLocationPicker', 'the picker'],
    ['setLocationDirty(true)', 'the dirty flag that drives preserve-vs-clear'],
    ['LOCATION_NONE', 'the explicit-clear sentinel'],
    ['onDraftErrorChange={setLocationDraftError}', 'the draft error wiring'],
  ]) {
    assert.ok(section.includes(marker), `${why} did not survive the move (missing: ${marker})`)
  }
})

test('the location block was moved, not duplicated', async () => {
  const block = await editor()

  // Two pickers would mean two sources of truth writing the same state.
  const pickers = (block.match(/<PropertyLocationPicker/g) || []).length
  assert.equal(pickers, 1, `found ${pickers} location pickers in the editor — the block was copied, not moved`)

  const dirty = (block.match(/setLocationDirty\(true\)/g) || []).length
  assert.equal(dirty, 1, 'the location onChange handler exists more than once')
})

test('the submit handler still decides preserve vs clear the same way', async () => {
  const src = await adminProperties()

  // The layout move must not have touched the three-way write contract.
  assert.ok(/if \(locationDirty && location\.status === 'set'\)/.test(src),
    'the set-a-pin branch of handleSubmit changed')
  assert.ok(/locationDraftError/.test(src), 'the half-typed-coordinate guard is gone')
})

/* ══════════════ NOTHING ELSE MOVED ══════════════ */

test('agent assignment survived the reorganisation', async () => {
  const block = await editor()

  assert.ok(/p\.assignedAgent \|\| 'Assigned Agent'/.test(block), 'the Assigned Agent field is gone')
  assert.ok((await adminProperties()).includes('agentIdOf'), 'agentIdOf is gone')

  // The reference uses four free-text fields including a typed agent name.
  // Adopting that would drop the User-id relationship entirely.
  assert.equal(/form\.agentName/.test(block), false,
    'a free-text agentName field appeared — agent is an assigned User id')
})

test('the AI assistant kept its gating and callbacks', async () => {
  const block = await editor()

  assert.ok(/\{canUseAssistant && \(/.test(block), 'the assistant is no longer permission-gated')
  for (const prop of ['copyContext', 'onApplyParsedFields', 'onApplyCopy']) {
    assert.ok(block.includes(prop), `the assistant lost its ${prop} wiring`)
  }
  assert.equal(/<AdminPropertyAssistant form=\{form\} setForm=\{setForm\} \/>/.test(block), false,
    'the assistant was swapped for the simpler ungated form')
})

test('optional detail fields keep their unset/true/false semantics', async () => {
  const src = await adminProperties()

  // Plain checkboxes would send `false` for "never touched" and erase stored
  // values on every save.
  assert.ok(/triStateField/.test(src), 'tri-state optional fields were replaced with plain checkboxes')
  assert.ok(/TRISTATE_BOOLEANS/.test(src), 'the tri-state vocabulary is gone')
  assert.ok(/detailLabel/.test(src), 'localized detail labels were replaced with hardcoded text')

  const block = await editor()
  assert.ok(/p\.blankPreservesHint \|\|/.test(block), 'the blank-preserves hint disappeared')
})

test('the editor still has both ways out and one submit', async () => {
  const block = await editor()

  assert.ok(/<button type="submit"/.test(block), 'the Save button is gone')
  assert.ok(/type="button"[^>]*onClick=\{\(\) => setFormOpen\(false\)\}/.test(block)
    || /onClick=\{\(\) => setFormOpen\(false\)\}[^>]*type="button"/.test(block),
    'Cancel is missing or is not type="button"')
})
