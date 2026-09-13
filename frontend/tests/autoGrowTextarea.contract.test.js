// AutoGrowTextarea — the sizing rules, and the four fields that use it.
//
// ── Why this file exists ────────────────────────────────────────────────
// The component is small enough to look obviously correct and still be wrong
// in two ways that only show up in a browser:
//
//   1. Without resetting height to 'auto' before measuring, scrollHeight
//      reports the taller of content and current box — so the field grows and
//      then never shrinks again when text is deleted.
//   2. The row floor is expressed in rows of TEXT while the box is sized with
//      border-box, so leaving out padding makes minRows={2} compute 40px
//      against this project's 20px of vertical padding — one cramped row where
//      two were asked for.
//
// Both are pinned below, along with the four fields this was introduced for.
//
// Static source contracts, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const readSrc = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')
const component = () => readSrc('components', 'AutoGrowTextarea.jsx')

/* ══════════════ THE COMPONENT ══════════════ */

test('the component exists and is a controlled textarea', async () => {
  const src = await component()

  assert.ok(/export default AutoGrowTextarea/.test(src), 'the component is not exported')
  assert.ok(/<textarea/.test(src), 'it no longer renders a textarea')
  assert.ok(/value=\{value\}/.test(src) && /onChange=\{onChange\}/.test(src),
    'it is no longer a controlled input')
})

test('it keeps a ref on the textarea and re-measures when the value changes', async () => {
  const src = await component()

  assert.ok(/const ref = useRef\(null\)/.test(src), 'the textarea ref is gone')
  assert.ok(/ref=\{ref\}/.test(src), 'the ref is no longer attached to the textarea')

  // Re-running on minRows/maxRows too, so a caller changing them resizes.
  const deps = /\}, \[([^\]]*)\]\)/.exec(src)
  assert.ok(deps, 'the sizing effect has no dependency array')
  for (const dep of ['value', 'minRows', 'maxRows']) {
    assert.ok(deps[1].includes(dep), `the sizing effect does not re-run on ${dep}`)
  }
})

test('it measures before paint, so an existing long value does not flash', async () => {
  const src = await component()

  assert.ok(/useLayoutEffect/.test(src),
    'the effect runs after paint — opening an edit form on a long value flashes at the wrong height')
  assert.ok(/from 'react'/.test(src) && /useLayoutEffect/.test(src.split('\n')[0]),
    'useLayoutEffect is not imported from react')
})

test('height is reset before measuring, so the field can shrink', async () => {
  const src = await component()

  const reset = src.indexOf("el.style.height = 'auto'")
  const measure = src.indexOf('el.scrollHeight')
  assert.notEqual(reset, -1,
    'height is never reset to auto — scrollHeight would report the current box and the field could only grow')
  assert.ok(reset < measure, 'the reset happens after the measurement, which defeats it')
})

test('the content height comes from scrollHeight', async () => {
  const src = await component()
  assert.ok(/el\.scrollHeight/.test(src), 'the content is no longer measured with scrollHeight')
})

test('the row floor accounts for padding and borders, not just line height', async () => {
  const src = await component()

  // lineHeight * minRows alone is a text height; the box is sized border-box.
  assert.ok(/parseFloat\(styles\.lineHeight\)/.test(src), 'line height is not read from computed styles')
  assert.ok(/paddingTop/.test(src) && /paddingBottom/.test(src),
    'vertical padding is not measured — minRows would render short')
  assert.ok(/borderTopWidth/.test(src) && /borderBottomWidth/.test(src),
    'borders are not measured — the last line clips under border-box')
  assert.ok(/boxSizing/.test(src),
    'box-sizing is not consulted, so the padding correction is applied blindly')

  assert.ok(/lineHeight \* minRows/.test(src), 'minRows no longer drives the floor')
})

test('maxRows is an optional ceiling, unlimited when absent', async () => {
  const src = await component()

  assert.ok(/maxRows \?/.test(src) && /Infinity/.test(src),
    'maxRows is no longer optional — omitting it must mean no ceiling')
  assert.ok(/lineHeight \* maxRows/.test(src), 'maxRows no longer drives the ceiling')
  assert.ok(/Math\.min\(Math\.max\(/.test(src), 'the height is no longer clamped between floor and ceiling')
})

test('the scrollbar appears only once the ceiling is reached', async () => {
  const src = await component()

  const overflow = /el\.style\.overflowY = ([^\n]+)/.exec(src)
  assert.ok(overflow, 'overflow is never set, so a scrollbar flickers while the field is still growing')
  assert.ok(/> maxHeight \? 'auto' : 'hidden'/.test(overflow[1]),
    'overflow is not tied to the ceiling')
})

test('caller classes survive and resize-none is appended', async () => {
  const src = await component()

  assert.ok(/className=\{`\$\{className\} resize-none`\}/.test(src),
    'the caller className is dropped, or the drag handle is left to fight the auto-sizing')
  assert.ok(/className = ''/.test(src), 'className has no safe default')
})

test('remaining textarea props are spread through', async () => {
  const src = await component()

  assert.ok(/\.\.\.rest/.test(src), 'placeholder, style, disabled, id and aria-* would be dropped')
  assert.ok(/rows=\{minRows\}/.test(src), 'the initial rows attribute no longer reflects minRows')
})

test('it pulls in nothing beyond React', async () => {
  const src = await component()

  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imports, ['react'],
    `the component gained a dependency: ${imports.filter((i) => i !== 'react').join(', ')}`)
})

/* ══════════════ THE FOUR FIELDS ══════════════ */

const FIELDS = [
  ['AdminShowroom.jsx', 'caption', { minRows: 2, maxRows: null }],
  ['AdminShowroom.jsx', 'detailText', { minRows: 5, maxRows: 20 }],
  ['AdminTeam.jsx', 'bio', { minRows: 3, maxRows: null }],
  ['AdminTeam.jsx', 'longBio', { minRows: 5, maxRows: 20 }],
]

for (const [file, field, { minRows, maxRows }] of FIELDS) {
  test(`${file} ${field} uses AutoGrowTextarea with minRows=${minRows}`, async () => {
    const src = await readSrc('pages', file)

    assert.ok(new RegExp(`import AutoGrowTextarea from '\\.\\./components/AutoGrowTextarea'`).test(src),
      `${file} does not import the component`)

    // The element wrapping this field's value binding.
    const at = src.indexOf(`value={form.${field}}`)
    assert.notEqual(at, -1, `${field} binding not found in ${file}`)
    const open = src.lastIndexOf('<', at)
    const element = src.slice(open, at)

    assert.ok(element.startsWith('<AutoGrowTextarea'),
      `${field} is still a plain <textarea> — it will not grow`)
    assert.ok(new RegExp(`minRows=\\{${minRows}\\}`).test(element),
      `${field} lost its minRows={${minRows}}, so its starting size changed`)

    if (maxRows) {
      assert.ok(new RegExp(`maxRows=\\{${maxRows}\\}`).test(element),
        `${field} lost its maxRows={${maxRows}} ceiling`)
    } else {
      assert.equal(/maxRows/.test(element), false,
        `${field} gained a ceiling it did not have`)
    }
  })
}

test('the four fields kept their existing bindings and classes', async () => {
  for (const [file, field] of FIELDS) {
    const src = await readSrc('pages', file)
    const at = src.indexOf(`value={form.${field}}`)
    const element = src.slice(src.lastIndexOf('<', at), src.indexOf('/>', at))

    assert.ok(element.includes('className={inputCls}'),
      `${file} ${field} no longer uses the shared input styling`)
    assert.ok(element.includes(`setForm(f => ({ ...f, ${field}:`),
      `${file} ${field} no longer writes back to form state`)
    assert.ok(/placeholder=/.test(element), `${file} ${field} lost its placeholder`)
  }
})

/* ══════════════ SCOPE ══════════════ */

test('no plain textarea is left on the four converted fields', async () => {
  for (const [file, field] of [...FIELDS]) {
    const src = await readSrc('pages', file)
    const at = src.indexOf(`value={form.${field}}`)
    const before = src.slice(Math.max(0, at - 400), at)
    // The nearest opening tag before the binding must not be a bare textarea.
    assert.equal(/<textarea[^>]*$/.test(before), false,
      `${file} ${field} is back to a plain textarea`)
  }
})

test('Batch 3 reuses AutoGrowTextarea for portfolio prose without replacing the original fields', async () => {
  const team = await readSrc('pages', 'AdminTeam.jsx')
  const editor = await readSrc('components', 'TeamWorkEditor.jsx')
  assert.equal((team.match(/<AutoGrowTextarea/g) || []).length, 2)
  assert.match(editor, /<AutoGrowTextarea/)
  assert.match(editor, /multiline=\{key === 'description'\}/)
  assert.match(editor, /label=\{labels.conclusion\}[^\n]+multiline/)
  assert.match(editor, /label=\{labels.imageDescription\}[^\n]+multiline/)
})

test('the agent chat composer was left alone', async () => {
  const thread = await readSrc('components', 'AgentConversationThread.jsx')

  // It has its own inline auto-grow with a hardcoded ceiling. Refactoring it to
  // use this component is a reasonable follow-up, but it is not needed to adopt
  // the feature and is not part of this step.
  assert.equal(thread.includes('AutoGrowTextarea'), false,
    'the chat composer was refactored — out of scope for this step')
  assert.ok(/el\.style\.height = `\$\{Math\.min\(el\.scrollHeight, 140\)\}px`/.test(thread),
    'the chat composer inline sizing changed')
})
