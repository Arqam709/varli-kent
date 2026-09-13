import AutoGrowTextarea from './AutoGrowTextarea'
import { useLanguage } from '../contexts/LanguageContext'
import { teamWorkLabels } from '../locales/teamWork'
import { imageCropLabels } from '../locales/imageCrop'
import { TEAM_WORK_LIMITS as limits, DOCUMENT_ACCEPT, emptyWorkSection, emptyWorkItem, moveWorkEntry } from '../lib/teamWork'

const inputCls = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 [overflow-wrap:anywhere]'
const buttonCls = 'rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:opacity-40'

function ProseField({ label, value = '', max, onChange, multiline = false }) {
  return <label className="block min-w-0 space-y-1 text-xs text-slate-600">
    <span className="flex justify-between gap-3"><span>{label}</span><span aria-hidden="true">{value.length}/{max}</span></span>
    {multiline
      ? <AutoGrowTextarea aria-label={label} minRows={2} maxRows={10} maxLength={max} value={value} onChange={e => onChange(e.target.value.slice(0, max))} className={inputCls} />
      : <input aria-label={label} maxLength={max} value={value} onChange={e => onChange(e.target.value.slice(0, max))} className={inputCls} />}
  </label>
}

function OrderControls({ label, first, last, onMove, onRemove, labels }) {
  return <div className="flex flex-wrap gap-1">
    <button type="button" className={buttonCls} disabled={first} aria-label={`${labels.up}: ${label}`} onClick={() => onMove(-1)}>↑</button>
    <button type="button" className={buttonCls} disabled={last} aria-label={`${labels.down}: ${label}`} onClick={() => onMove(1)}>↓</button>
    <button type="button" className={buttonCls} aria-label={`${labels.remove}: ${label}`} onClick={onRemove}>{labels.remove}</button>
  </div>
}

export default function TeamWorkEditor({ sections, files, onChange, onFilesChange, onUpload, onCrop, busy }) {
  const { language } = useLanguage()
  const labels = teamWorkLabels(language)
  const cropLabels = imageCropLabels(language)
  const updateSection = (id, patch) => onChange(sections.map(section => section._id === id ? { ...section, ...patch } : section))
  const updateItem = (section, id, patch) => updateSection(section._id, { items: section.items.map(item => item._id === id ? { ...item, ...patch } : item) })
  const totalItems = sections.reduce((total, section) => total + section.items.length, 0)
  return <fieldset disabled={busy} className="min-w-0 space-y-4" data-testid="team-work-editor">
    <legend className="mb-2 text-sm font-semibold text-[#4b6741]">{labels.heading}</legend>
    <p className="text-xs text-slate-500">{labels.limits}</p>
    {sections.map((section, index) => <section key={section._id} data-testid="work-section-editor" className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{labels.section} {index + 1}</h3>
        <OrderControls labels={labels} label={`${labels.section} ${index + 1}`} first={index === 0} last={index === sections.length - 1}
          onMove={direction => onChange(moveWorkEntry(sections, section._id, direction))} onRemove={() => onChange(sections.filter(entry => entry._id !== section._id))} />
      </div>
      {['label', 'title', 'description'].map(key => <ProseField key={key} label={labels[key]} value={section[key]} max={limits[key]} multiline={key === 'description'} onChange={value => updateSection(section._id, { [key]: value })} />)}
      {section.items.map((item, itemIndex) => <div key={item._id} data-testid="work-item-editor" className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <OrderControls labels={labels} label={`${labels.image} ${itemIndex + 1}`} first={itemIndex === 0} last={itemIndex === section.items.length - 1}
          onMove={direction => updateSection(section._id, { items: moveWorkEntry(section.items, item._id, direction) })}
          onRemove={() => updateSection(section._id, { items: section.items.filter(entry => entry._id !== item._id) })} />
        {item.url && <img src={item.cropUrl || item.url} alt={item.title || labels.image} className="max-h-36 w-full rounded-lg object-contain" />}
        <label className="block text-xs">{labels.upload}
          <input type="file" accept="image/*" className="block w-full text-xs" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onUpload(file, { sectionId: section._id, itemId: item._id }) }} />
        </label>
        <label className="block text-xs">{labels.url}<input className={inputCls} value={item.url} onChange={e => updateItem(section, item._id, { url: e.target.value, cropUrl: '', width: 0, height: 0 })} /></label>
        {item.url && <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonCls} onClick={() => onCrop(item.url, { sectionId: section._id, itemId: item._id })}>{cropLabels.edit}</button>
          {item.cropUrl && <button type="button" className={buttonCls} onClick={() => updateItem(section, item._id, { cropUrl: '', width: 0, height: 0 })}>{cropLabels.remove}</button>}
        </div>}
        <ProseField label={labels.imageTitle} value={item.title} max={limits.itemTitle} onChange={title => updateItem(section, item._id, { title })} />
        <ProseField label={labels.imageDescription} value={item.description} max={limits.itemDescription} multiline onChange={description => updateItem(section, item._id, { description })} />
      </div>)}
      <button type="button" className={buttonCls} disabled={section.items.length >= limits.items || totalItems >= limits.totalItems} onClick={() => updateSection(section._id, { items: [...section.items, emptyWorkItem()] })}>{labels.addImage}</button>
      <ProseField label={labels.conclusion} value={section.conclusion} max={limits.conclusion} multiline onChange={conclusion => updateSection(section._id, { conclusion })} />
    </section>)}
    <button type="button" className={buttonCls} disabled={sections.length >= limits.sections} onClick={() => onChange([...sections, { ...emptyWorkSection(), order: sections.length }])}>{labels.addSection}</button>
    <h3 className="text-sm font-semibold">{labels.documents}</h3>
    {files.map((file, index) => <div key={file._id} className="min-w-0 space-y-2 rounded-xl border p-3">
      <OrderControls labels={labels} label={file.name || `${labels.documents} ${index + 1}`} first={index === 0} last={index === files.length - 1}
        onMove={direction => onFilesChange(moveWorkEntry(files, file._id, direction))} onRemove={() => onFilesChange(files.filter(entry => entry._id !== file._id))} />
      <ProseField label={labels.fileName} value={file.name} max={200} onChange={name => onFilesChange(files.map(entry => entry._id === file._id ? { ...entry, name } : entry))} />
      <p className="truncate text-xs text-slate-500">{file.fileType?.toUpperCase()} · {file.url}</p>
    </div>)}
    <label className="block text-xs">{labels.addDocument}
      <input type="file" accept={DOCUMENT_ACCEPT} disabled={files.length >= limits.files} className="block w-full text-xs" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onUpload(file, { document: true }) }} />
    </label>
  </fieldset>
}
