import { editableText, localizedText } from './localizedText.js'

export const TEAM_WORK_LIMITS = { sections: 12, items: 24, totalItems: 120, files: 12, label: 60, title: 100, description: 700, conclusion: 700, itemTitle: 80, itemDescription: 500 }
export const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx'
export const newWorkId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 24)
export const emptyWorkItem = () => ({ _id: newWorkId(), url: '', cropUrl: '', width: 0, height: 0, title: '', description: '' })
export const emptyWorkSection = () => ({ _id: newWorkId(), label: '', title: '', description: '', conclusion: '', order: 0, items: [] })
const list = value => Array.isArray(value) ? value.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)) : []

export const safeWorkUrl = value => {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32)) return ''
  if (value.startsWith('/') && !value.startsWith('//')) return value
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : '' } catch { return '' }
}

export function editableWorkSections(value) {
  return list(value).map(section => ({
    ...section, _id: section._id || newWorkId(),
    ...Object.fromEntries(['label', 'title', 'description', 'conclusion'].map(key => [key, editableText(section[key])])),
    items: list(section.items).map(item => ({ ...item, _id: item._id || newWorkId(), title: editableText(item.title), description: editableText(item.description) })),
  })).sort((a, b) => (a.order || 0) - (b.order || 0))
}

export function teamWorkView(member, language) {
  const sections = list(member.workSections).map(section => ({
    ...section,
    ...Object.fromEntries(['label', 'title', 'description', 'conclusion'].map(key => [key, localizedText(section[key], language)])),
    items: list(section.items).filter(item => safeWorkUrl(item.url)).map(item => ({
      ...item, url: safeWorkUrl(item.url), cropUrl: safeWorkUrl(item.cropUrl), title: localizedText(item.title, language), description: localizedText(item.description, language),
    })),
  })).filter(section => section.items.length || section.label || section.title || section.description || section.conclusion)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
  const files = list(member.workFiles).filter(file => safeWorkUrl(file.url)).map(file => ({ ...file, url: safeWorkUrl(file.url), name: typeof file.name === 'string' ? file.name : '' }))
  return { sections, files }
}

export function moveWorkEntry(entries, id, direction) {
  const from = entries.findIndex(entry => entry._id === id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= entries.length) return entries
  const next = [...entries]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
