import { localizeFields } from './autoTranslate.js'
import { SUPPORTED_LANGUAGES } from './localizedField.js'

export const TEAM_WORK_LIMITS = { sections: 12, items: 24, totalItems: 120, files: 12, label: 60, title: 100, description: 700, conclusion: 700, itemTitle: 80, itemDescription: 500 }
export const WORK_FILE_TYPES = ['pdf', 'doc', 'docx', 'ppt', 'pptx']
const sectionText = ['label', 'title', 'description', 'conclusion']
const itemText = ['title', 'description']
const own = (value, key) => Object.hasOwn(value, key)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = field => { const error = new Error(`Invalid Team field: ${field}`); error.status = 400; throw error }
const pick = (value, keys) => Object.fromEntries(keys.filter(key => own(value, key)).map(key => [key, value[key]]))

export function validTeamUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32)) return false
  if (!value) return true
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

export function validWorkText(value, max) {
  if (value === undefined) return true
  if (typeof value === 'string') return value.length <= max
  if (!object(value)) return false
  return Object.entries(value).every(([key, text]) => key === 'sourceLang'
    ? SUPPORTED_LANGUAGES.includes(text)
    : SUPPORTED_LANGUAGES.includes(key) && typeof text === 'string' && text.length <= max * 4)
}

const text = (value, max, field) => {
  if (!validWorkText(value, max)) fail(field)
  return value
}
const url = (value, field, required = false) => {
  if (!validTeamUrl(value) || (required && !value)) fail(field)
  return value
}
const array = (value, max, field) => {
  if (!Array.isArray(value) || value.length > max || value.some(entry => !object(entry))) fail(field)
  const ids = value.filter(entry => entry._id !== undefined).map(entry => entry._id)
  if (ids.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) || new Set(ids).size !== ids.length) fail(`${field}._id`)
  return value
}
const number = (value, max, field) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(field)
  return value
}
const previousById = (list, entry) => Array.isArray(list) && entry._id ? list.find(old => String(old._id) === entry._id) || {} : {}

// Supplied arrays replace membership/order; omitted fields on known IDs keep
// their previous values. Omitted top-level arrays are left untouched by PUT.
export function normalizeTeamWorkPayload(body, existing = {}) {
  if (!object(body)) fail('payload')
  const allowed = ['name', 'role', 'bio', 'photo', 'secondaryPhoto', 'longBio', 'workImages', 'order', 'visible', 'photoCropUrl', 'secondaryPhotoCropUrl', 'workSections', 'workFiles']
  const out = pick(body, allowed)
  for (const field of ['photo', 'secondaryPhoto', 'photoCropUrl', 'secondaryPhotoCropUrl']) {
    if (own(out, field)) url(out[field], field)
  }
  for (const [original, crop] of [['photo', 'photoCropUrl'], ['secondaryPhoto', 'secondaryPhotoCropUrl']]) {
    if (own(out, original) && out[original] !== existing[original] && !own(out, crop)) out[crop] = ''
    if (out[crop] && !(out[original] ?? existing[original])) fail(crop)
  }
  if (own(out, 'workImages')) {
    if (!Array.isArray(out.workImages) || out.workImages.length > 24 || !out.workImages.every(validTeamUrl)) fail('workImages')
  }
  if (own(out, 'workSections')) {
    let total = 0
    out.workSections = array(out.workSections, TEAM_WORK_LIMITS.sections, 'workSections').map((incoming, index) => {
      const old = previousById(existing.workSections, incoming)
      const section = { ...pick(old, ['_id', ...sectionText, 'order', 'items']), ...pick(incoming, ['_id', ...sectionText, 'order', 'items']) }
      for (const field of sectionText) if (own(section, field)) text(section[field], TEAM_WORK_LIMITS[field], `section.${field}`)
      section.order = number(section.order ?? index, 10000, 'section.order')
      if (!own(incoming, 'items') && Array.isArray(section.items)) section.items = section.items.map(item => ({ ...item, ...(item._id ? { _id: String(item._id) } : {}) }))
      section.items = array(section.items ?? [], TEAM_WORK_LIMITS.items, 'section.items').map(incomingItem => {
        const previous = previousById(old.items, incomingItem)
        const item = { ...pick(previous, ['_id', 'url', 'cropUrl', 'width', 'height', ...itemText]), ...pick(incomingItem, ['_id', 'url', 'cropUrl', 'width', 'height', ...itemText]) }
        item.url = url(item.url, 'item.url', true)
        if (previous.url !== undefined && own(incomingItem, 'url') && incomingItem.url !== previous.url && !own(incomingItem, 'cropUrl')) {
          item.cropUrl = ''; item.width = 0; item.height = 0
        }
        item.cropUrl = url(item.cropUrl ?? '', 'item.cropUrl')
        item.width = number(item.width ?? 0, 4096, 'item.width')
        item.height = number(item.height ?? 0, 4096, 'item.height')
        if (item.cropUrl && (!item.width || !item.height)) fail('item.crop dimensions')
        if (!item.cropUrl) { item.width = 0; item.height = 0 }
        for (const field of itemText) if (own(item, field)) text(item[field], TEAM_WORK_LIMITS[field === 'title' ? 'itemTitle' : 'itemDescription'], `item.${field}`)
        return item
      })
      total += section.items.length
      return section
    })
    if (total > TEAM_WORK_LIMITS.totalItems) fail('total work images')
  }
  if (own(out, 'workFiles')) {
    out.workFiles = array(out.workFiles, TEAM_WORK_LIMITS.files, 'workFiles').map(incoming => {
      const file = { ...pick(previousById(existing.workFiles, incoming), ['_id', 'url', 'name', 'fileType']), ...pick(incoming, ['_id', 'url', 'name', 'fileType']) }
      file.url = url(file.url, 'file.url', true)
      if (file.name === undefined) file.name = ''
      if (typeof file.name !== 'string' || file.name.length > 200) fail('file.name')
      file.fileType = file.fileType ?? ''
      if (file.fileType !== '' && !WORK_FILE_TYPES.includes(file.fileType)) fail('file.fileType')
      return file
    })
  }
  return out
}

export async function localizeTeamWorkPayload(body, fields, existing = {}, fetchImpl = fetch) {
  const out = await localizeFields(normalizeTeamWorkPayload(body, existing), fields, existing, fetchImpl)
  if (out.workSections) {
    // Sequential sections/items bound provider concurrency to localizeFields' five languages.
    const sections = []
    for (const section of out.workSections) {
      const old = previousById(existing.workSections, section)
      const localized = await localizeFields(section, sectionText, old, fetchImpl)
      localized.items = []
      for (const item of section.items) localized.items.push(await localizeFields(item, itemText, previousById(old.items, item), fetchImpl))
      sections.push(localized)
    }
    out.workSections = sections
  }
  return out
}
