import test from 'node:test'
import assert from 'node:assert/strict'
import TeamMember from '../models/TeamMember.js'
import { normalizeTeamWorkPayload, localizeTeamWorkPayload } from '../utils/teamWork.js'

const id = number => number.toString(16).padStart(24, '0')
const work = () => ({
  photo: '/photo.jpg', photoCropUrl: '/photo-crop.jpg', secondaryPhoto: '/profile.jpg', secondaryPhotoCropUrl: '/profile-crop.jpg',
  workSections: [{ _id: id(1), label: 'Interior', title: 'Villa', description: 'Introduction', conclusion: 'Completed', order: 0,
    items: [{ _id: id(2), url: '/original.jpg', cropUrl: '/crop.jpg', width: 400, height: 300, title: 'Bathroom', description: 'Marble finishes' }] }],
  workFiles: [{ _id: id(3), url: '/portfolio.pdf', name: 'Portfolio', fileType: 'pdf' }],
})

test('real schema stores every introduced field and retains Mixed localization', async () => {
  const member = new TeamMember({ name: 'Ada', role: 'Architect', ...work() })
  await member.validate()
  const output = JSON.parse(JSON.stringify(member.toObject()))
  for (const field of ['photoCropUrl', 'secondaryPhotoCropUrl', 'workSections', 'workFiles']) assert.deepEqual(output[field], work()[field])
  const sectionSchema = TeamMember.schema.path('workSections').schema
  for (const field of ['label', 'title', 'description', 'conclusion']) assert.equal(sectionSchema.path(field).instance, 'Mixed')
  for (const field of ['title', 'description']) assert.equal(sectionSchema.path('items').schema.path(field).instance, 'Mixed')
  for (const field of ['role', 'bio', 'longBio']) assert.equal(TeamMember.schema.path(field).instance, 'Mixed')
})
test('legacy members still validate with absent optional portfolio data', async () => {
  const member = new TeamMember({ name: 'Legacy', role: 'Architect', bio: 'Original biography' })
  await member.validate()
  assert.deepEqual(member.workSections.toObject(), [])
  assert.deepEqual(member.workFiles.toObject(), [])
  assert.equal(member.photoCropUrl, '')
  assert.equal(member.workImages, undefined)
  assert.deepEqual(normalizeTeamWorkPayload({ order: 2 }, member.toObject()), { order: 2 })
})
test('allow-list excludes unknown keys at every nesting level', () => {
  const payload = work()
  payload.isOwner = true
  payload.workSections[0].junk = { arbitrary: 1 }
  payload.workSections[0].items[0].junk = 'no'
  payload.workFiles[0].junk = 'no'
  const normalized = normalizeTeamWorkPayload(payload)
  assert.deepEqual(normalized, work())
})
test('malformed arrays, oversized collections, invalid URLs and dimensions return 400', () => {
  const section = work().workSections[0]
  const bad = [
    { workSections: {} }, { workSections: [null] }, { workSections: Array(13).fill({}) },
    { workSections: [{ items: {} }] }, { workSections: [{ items: [null] }] },
    { workSections: [{ items: Array(25).fill({ url: '/a.jpg' }) }] },
    { workSections: [{ ...section, title: 'x'.repeat(101) }] },
    { workSections: [{ ...section, description: { en: 'text', admin: 'junk' } }] },
    { workSections: [{ items: [{ url: 'javascript:alert(1)' }] }] },
    { workSections: [{ items: [{ url: '//evil.test/a.jpg' }] }] },
    { workSections: [{ items: [{ url: '/a.jpg', cropUrl: '/c.jpg', width: 0, height: 1 }] }] },
    { workSections: [{ items: [{ url: '/a.jpg', width: 1.2 }] }] },
    { workSections: [{ items: [{ url: '/a.jpg', width: 4097 }] }] },
    { workSections: [section, section] }, { workFiles: 'bad' }, { workFiles: Array(13).fill({ url: '/a.pdf' }) },
    { workFiles: [{ url: 'data:text/html,evil', name: 'evil' }] }, { workFiles: [{ url: '/a', fileType: 'exe' }] },
    { photoCropUrl: '/crop.jpg' },
  ]
  for (const payload of bad) assert.throws(() => normalizeTeamWorkPayload(payload), error => error.status === 400)
})
test('supplied array entries merge by stable ID; omitted arrays and text remain untouched', () => {
  const existing = new TeamMember({ name: 'Ada', role: 'Architect', ...work() }).toObject()
  const result = normalizeTeamWorkPayload({ workSections: [{ _id: id(1), order: 1 }] }, existing)
  assert.equal(result.workSections[0].title, 'Villa')
  assert.equal(result.workSections[0].items[0].description, 'Marble finishes')
  assert.equal(result.workFiles, undefined)
  assert.equal(result.photo, undefined)
})
test('replacing originals clears crops without destructive changes; explicit clear is supported', () => {
  const existing = work()
  const changed = normalizeTeamWorkPayload({ photo: '/new.jpg', workSections: [{ _id: id(1), items: [{ _id: id(2), url: '/new-work.jpg' }] }] }, existing)
  assert.equal(changed.photoCropUrl, '')
  assert.equal(changed.workSections[0].items[0].cropUrl, '')
  assert.equal(changed.workSections[0].items[0].width, 0)
  assert.deepEqual(normalizeTeamWorkPayload({ workSections: [], workFiles: [] }, existing), { workSections: [], workFiles: [] })
})
test('nested localization skips unchanged source and preserves failed languages across reordering', async () => {
  const localized = value => ({ sourceLang: 'en', en: value, tr: 'Turkish ' + value, ar: 'Arabic ' + value, de: 'German ' + value, ru: 'Russian ' + value, ur: 'Urdu ' + value })
  const existing = work()
  for (const key of ['label', 'title', 'description', 'conclusion']) existing.workSections[0][key] = localized(existing.workSections[0][key])
  const item = existing.workSections[0].items[0]
  item.title = localized(item.title); item.description = localized(item.description)
  let calls = 0
  const failed = async () => { calls++; return { ok: false } }
  const unchanged = await localizeTeamWorkPayload({ workSections: [{ _id: id(1), title: 'Villa', items: [{ _id: id(2), title: 'Bathroom', description: 'Marble finishes' }] }] }, [], existing, failed)
  assert.equal(calls, 0)
  assert.equal(unchanged.workSections[0].items[0].title.tr, 'Turkish Bathroom')
  const changed = await localizeTeamWorkPayload({ workSections: [{ _id: id(1), order: 2, items: [{ _id: id(4), url: '/other.jpg' }, { _id: id(2), description: 'New finishes' }] }] }, [], existing, failed)
  assert.equal(calls, 5)
  assert.equal(changed.workSections[0].items[1].description.en, 'New finishes')
  assert.equal(changed.workSections[0].items[1].description.tr, 'Turkish Marble finishes')
  assert.equal(changed.workSections[0].items[1].url, '/original.jpg')
})
