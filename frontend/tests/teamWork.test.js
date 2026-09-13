import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { editableWorkSections, moveWorkEntry, teamWorkView, safeWorkUrl, TEAM_WORK_LIMITS } from '../src/lib/teamWork.js'
import { teamWorkLabels } from '../src/locales/teamWork.js'
const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('empty and malformed optional work data remain safe', () => {
  for (const member of [{}, { workSections: null, workFiles: null }, { workSections: {}, workFiles: {} }, { workSections: [null, {}], workFiles: [null, {}] }]) {
    assert.deepEqual(teamWorkView(member, 'en'), { sections: [], files: [] })
  }
})
test('public work resolves all nested text, order, and safe URLs', () => {
  const result = teamWorkView({ workSections: [
    { _id: 'b', order: 2, label: { tr: 'Etiket' }, conclusion: { tr: 'Sonuç' } },
    { _id: 'a', order: 1, title: { tr: 'Başlık' }, description: { tr: 'Açıklama' }, items: [{ url: '/original', cropUrl: '/crop', title: { tr: 'Görsel' }, description: { tr: 'Detay' } }] },
  ], workFiles: [{ url: 'javascript:alert(1)' }, { url: '/portfolio.pdf', name: 'Portfolio' }] }, 'tr')
  assert.equal(result.sections.length, 2)
  assert.equal(result.sections[0].title, 'Başlık')
  assert.equal(result.sections[0].description, 'Açıklama')
  assert.equal(result.sections[0].items[0].description, 'Detay')
  assert.equal(result.sections[1].conclusion, 'Sonuç')
  assert.equal(result.files.length, 1)
})
test('admin edits original source and reorder preserves stable item identity', () => {
  const sections = editableWorkSections([{ _id: 'one', title: { sourceLang: 'tr', tr: 'Kaynak', en: 'Translation' }, items: [{ _id: 'item', url: '/a', title: { sourceLang: 'tr', tr: 'Resim' } }] }, { _id: 'two' }])
  assert.equal(sections[0].title, 'Kaynak')
  assert.equal(sections[0].items[0].title, 'Resim')
  const moved = moveWorkEntry(sections, 'one', 1)
  assert.equal(moved[1], sections[0])
  assert.equal(moved[1].items[0]._id, 'item')
  assert.equal(moveWorkEntry(sections, 'one', -1), sections)
})
test('unsafe links cannot become public document links', () => {
  for (const value of ['javascript:x', 'data:x', '//evil.test', '/\\evil.test', 'https://user:pass@example.com', {}, null]) assert.equal(safeWorkUrl(value), '')
  assert.equal(safeWorkUrl('/portfolio.pdf'), '/portfolio.pdf')
})
test('editor exposes every introduced prose field with bounded auto-growing text', async () => {
  const source = await read('../src/components/TeamWorkEditor.jsx')
  assert.match(source, /<AutoGrowTextarea/)
  assert.match(source, /maxLength=\{max\}/)
  for (const field of ['label', 'title', 'description', 'conclusion', 'imageTitle', 'imageDescription', 'fileName']) assert.ok(source.includes(field))
  assert.match(source, /section\._id/)
  assert.match(source, /item\._id/)
  assert.match(source, /moveWorkEntry/)
  assert.equal(TEAM_WORK_LIMITS.sections, 12)
})
test('Team admin wires both nested arrays and reuses CURRENT crop component', async () => {
  const source = await read('../src/pages/AdminTeam.jsx')
  for (const field of ['workSections', 'workFiles', 'photoCropUrl', 'secondaryPhotoCropUrl']) assert.ok(source.includes(field))
  assert.match(source, /<TeamWorkEditor sections=\{form.workSections\} files=\{form.workFiles\}/)
  assert.match(source, /import ImageCropModal from '..\/components\/ImageCropModal'/)
  assert.match(source, /<ImageCropModal/)
  assert.doesNotMatch(source, /function ImageCropModal|const ImageCropModal/)
  assert.match(source, /max-h-\[90dvh\]/)
  assert.match(source, /onUpload=\{uploadWorkFile\}/)
})
test('public page connects sections, files and per-image detail while keeping old gallery', async () => {
  const page = await read('../src/pages/TeamPage.jsx')
  const portfolio = await read('../src/components/TeamWorkPortfolio.jsx')
  assert.match(page, /teamWorkView\(member, language\)/)
  assert.match(page, /<TeamWorkPortfolio sections=\{sections\} files=\{files\}/)
  assert.match(page, /workImages.map/)
  for (const field of ['section.label', 'section.title', 'section.description', 'section.conclusion', 'item.title', 'item.description', 'file.name', 'file.url']) assert.ok(portfolio.includes(field))
  assert.match(portfolio, /src=\{item.cropUrl \|\| item.url\}/)
  assert.match(portfolio, /stopImmediatePropagation/)
  assert.match(portfolio, /noopener noreferrer/)
})
test('all six languages have portfolio labels and both RTL languages are supported', async () => {
  for (const language of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) assert.ok(Object.values(teamWorkLabels(language)).every(value => typeof value === 'string' && value.trim()))
  assert.match(await read('../src/components/TeamWorkPortfolio.jsx'), /\['ar', 'ur'\].includes\(language\)/)
})
