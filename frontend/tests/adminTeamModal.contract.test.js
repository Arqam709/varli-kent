import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'

const source = readFileSync(new URL('../src/pages/AdminTeam.jsx', import.meta.url), 'utf8')
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
const elements = []
function walk(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'JSXElement') elements.push(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') walk(value)
  }
}
walk(ast)
const name = node => node.openingElement.name.name
const attr = (node, key) => node.openingElement.attributes.find(a => a.name?.name === key)
const classes = node => new Set(attr(node, 'className')?.value?.value?.split(/\s+/))
const hasClasses = (node, required) => required.forEach(c => assert.ok(classes(node).has(c), `missing ${c} on ${name(node)}`))
const children = node => node.children.filter(child => child.type === 'JSXElement')
const panel = elements.find(node => classes(node).has('max-h-[90dvh]'))
const form = children(panel).find(node => name(node) === 'form')

test('Team modal bounds the panel and permits the form flex child to shrink', () => {
  hasClasses(panel, ['max-h-[90dvh]', 'flex', 'flex-col', 'overflow-hidden'])
  hasClasses(form, ['flex', 'flex-col', 'min-h-0', 'flex-1'])
  hasClasses(children(panel)[0], ['shrink-0'])
})

test('Team scroll owner is a shrinking div with the disabled fieldset inside it', () => {
  const body = children(form)[0]
  assert.equal(name(body), 'div')
  hasClasses(body, ['min-h-0', 'min-w-0', 'flex-1', 'overflow-y-auto', 'overscroll-contain'])
  const fields = children(body)[0]
  assert.equal(name(fields), 'fieldset')
  hasClasses(fields, ['min-w-0'])
  assert.equal(attr(fields, 'disabled').value.expression.name, 'busy')
  const contents = source.slice(fields.start, fields.end)
  for (const field of ['form.secondaryPhoto', 'form.longBio', 'TeamWorkEditor', 'form.workSections', 'form.workFiles', 'WorkGalleryField', 'form.visible']) assert.ok(contents.includes(field), `${field} stays within the scroll body`)
})

test('Team actions are a non-overlay sibling after the scrolling body', () => {
  const [body, footer] = children(form)
  assert.equal(children(form).length, 2)
  assert.ok(body.end < footer.start)
  hasClasses(footer, ['shrink-0'])
  for (const c of ['absolute', 'fixed', 'sticky', 'overflow-y-auto']) assert.ok(!classes(footer).has(c))
  const buttons = children(footer)
  assert.deepEqual(buttons.map(button => attr(button, 'type').value.value), ['button', 'submit'])
})
