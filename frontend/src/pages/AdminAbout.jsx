import { useState, useEffect, useRef } from 'react'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useLanguage } from '../contexts/LanguageContext'

const UPLOAD_HINT = 'JPG, PNG, WEBP, GIF — max 10 MB · MP4, MOV, WEBM — max 100 MB'

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

const Section = ({ title, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
    <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-base font-bold text-[#202a36] border-b border-slate-100 pb-3">{title}</h2>
    {children}
  </div>
)

function UploadField({ label, value, onChange, hint = UPLOAD_HINT }) {
  const ref = useRef()
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const fd = new FormData()
    fd.append('image', file)
    setUploading(true)
    try {
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      onChange(r.data.url)
    } catch {
      alert('Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const isVideo = value && (value.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(value))

  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex gap-2 items-center">
        <input className={inputCls} value={value} onChange={e => onChange(e.target.value)} placeholder="https://... or upload below" />
        <button type="button" onClick={() => ref.current.click()} disabled={uploading}
          className="shrink-0 rounded-lg border border-[#4b6741] px-3 py-2.5 text-xs font-semibold text-[#4b6741] hover:bg-[#4b6741] hover:text-white transition disabled:opacity-50 cursor-pointer">
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={ref} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{hint}</p>
      {value && (
        <div className="mt-2 relative inline-block">
          {isVideo
            ? <video src={value} className="h-20 rounded-lg object-cover" muted />
            : <img src={value} alt="" className="h-20 rounded-lg object-cover" />}
          <button type="button" onClick={() => onChange('')}
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] cursor-pointer">✕</button>
        </div>
      )}
    </div>
  )
}

const emptyBlock = { heading: '', paragraphs: [''], image: '', imagePosition: 'right', order: 0 }
const emptyMember = { name: '', role: '', avatar: '', order: 0 }
const emptyStat = { value: '', label: '', order: 0 }

const AdminAbout = () => {
  const { t } = useLanguage()
  const p = t.adminPages?.about || {}
  const c = t.adminPages?.common || {}
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/about').then(res => {
      const a = res.data.about
      setForm({
        heroLabel: a.heroLabel || '',
        heroHeading: a.heroHeading || '',
        heroSubtext: a.heroSubtext || '',
        missionLabel: a.missionLabel || '',
        missionHeading: a.missionHeading || '',
        missionParagraph1: a.missionParagraph1 || '',
        missionParagraph2: a.missionParagraph2 || '',
        missionImage: a.missionImage || '',
        teamLabel: a.teamLabel || '',
        teamHeading: a.teamHeading || '',
        stats: a.stats?.length ? a.stats : [{ value: '10+', label: 'Years Experience', order: 0 }],
        team: a.team?.length ? a.team : [emptyMember],
        contentBlocks: a.contentBlocks?.length ? a.contentBlocks : [],
      })
    }).catch(() => setError('Failed to load about content'))
  }, [])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const setList = (listKey, idx, field, val) => setForm(f => {
    const arr = [...f[listKey]]
    arr[idx] = { ...arr[idx], [field]: val }
    return { ...f, [listKey]: arr }
  })

  const addItem = (listKey, emptyVal) => setForm(f => ({
    ...f,
    [listKey]: [...f[listKey], { ...emptyVal, order: f[listKey].length }],
  }))

  const removeItem = (listKey, idx) => setForm(f => ({
    ...f,
    [listKey]: f[listKey].filter((_, i) => i !== idx),
  }))

  const setBlockParagraph = (bi, pi, val) => setForm(f => {
    const blocks = [...f.contentBlocks]
    const paras = [...blocks[bi].paragraphs]
    paras[pi] = val
    blocks[bi] = { ...blocks[bi], paragraphs: paras }
    return { ...f, contentBlocks: blocks }
  })
  const addParagraph = (bi) => setForm(f => {
    const blocks = [...f.contentBlocks]
    blocks[bi] = { ...blocks[bi], paragraphs: [...blocks[bi].paragraphs, ''] }
    return { ...f, contentBlocks: blocks }
  })
  const removeParagraph = (bi, pi) => setForm(f => {
    const blocks = [...f.contentBlocks]
    blocks[bi] = { ...blocks[bi], paragraphs: blocks[bi].paragraphs.filter((_, i) => i !== pi) }
    return { ...f, contentBlocks: blocks }
  })

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      await api.put('/about', form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!form) return (
    <AdminLayout>
      <div className="text-sm text-slate-400 py-12 text-center">{p.loading || 'Loading content…'}</div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
      <form onSubmit={handleSave} className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'About Page'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Edit the content shown on the public About page'}</p>
          </div>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
            {saving ? (c.saving || 'Saving…') : saved ? '✓ Saved!' : (p.saveChanges || 'Save Changes')}
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
        {saved && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{p.savedSuccess || 'Changes saved successfully.'}</div>}

        <Section title={p.heroSection || 'Hero Section'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{p.labelAbove || 'Label (above heading)'}</label>
              <input className={inputCls} value={form.heroLabel} onChange={e => set('heroLabel', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{p.heading || 'Heading'}</label>
              <input className={inputCls} value={form.heroHeading} onChange={e => set('heroHeading', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>{p.subtext || 'Subtext'}</label>
            <textarea className={inputCls} rows={2} value={form.heroSubtext} onChange={e => set('heroSubtext', e.target.value)} />
          </div>
        </Section>

        <Section title={p.missionSection || 'Mission Section'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{p.labelAbove || 'Label'}</label>
              <input className={inputCls} value={form.missionLabel} onChange={e => set('missionLabel', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{p.heading || 'Heading'}</label>
              <input className={inputCls} value={form.missionHeading} onChange={e => set('missionHeading', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>{p.paragraph1 || 'Paragraph 1'}</label>
            <textarea className={inputCls} rows={3} value={form.missionParagraph1} onChange={e => set('missionParagraph1', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{p.paragraph2 || 'Paragraph 2'}</label>
            <textarea className={inputCls} rows={3} value={form.missionParagraph2} onChange={e => set('missionParagraph2', e.target.value)} />
          </div>
          <UploadField label={p.sectionImage || 'Section Image'} value={form.missionImage} onChange={v => set('missionImage', v)} />
        </Section>

        <Section title={p.additionalSections || 'Additional Content Sections'}>
          <p className="text-xs text-slate-400 -mt-2">{p.additionalSectionsHint || 'Add extra heading + paragraph blocks. Each can have an optional image (left or right). They auto-layout on the About page.'}</p>
          <div className="space-y-6">
            {form.contentBlocks.map((block, bi) => (
              <div key={bi} className="rounded-xl border border-slate-100 bg-slate-50 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{p.sectionNum || 'Section'} {bi + 1}</span>
                  <button type="button" onClick={() => removeItem('contentBlocks', bi)} className="text-red-400 hover:text-red-600 cursor-pointer">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>{p.heading || 'Heading'}</label>
                    <input className={inputCls} value={block.heading} onChange={e => setList('contentBlocks', bi, 'heading', e.target.value)} placeholder="Section heading" />
                  </div>
                  <div>
                    <label className={labelCls}>{p.imagePosition || 'Image Position'}</label>
                    <select className={inputCls} value={block.imagePosition} onChange={e => setList('contentBlocks', bi, 'imagePosition', e.target.value)}>
                      <option value="right">{p.imageRight || 'Image Right'}</option>
                      <option value="left">{p.imageLeft || 'Image Left'}</option>
                      <option value="none">{p.noImage || 'No Image (full-width)'}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>{p.paragraphs || 'Paragraphs'}</label>
                  <div className="space-y-2">
                    {block.paragraphs.map((para, pi) => (
                      <div key={pi} className="flex gap-2 items-start">
                        <textarea className={inputCls} rows={2} value={para} onChange={e => setBlockParagraph(bi, pi, e.target.value)} placeholder={`Paragraph ${pi + 1}`} />
                        {block.paragraphs.length > 1 && (
                          <button type="button" onClick={() => removeParagraph(bi, pi)} className="mt-1 shrink-0 text-red-400 hover:text-red-600 cursor-pointer">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => addParagraph(bi)} className="mt-2 text-xs text-[#4b6741] hover:underline font-medium cursor-pointer">{p.addParagraph || '+ Add Paragraph'}</button>
                </div>
                {block.imagePosition !== 'none' && (
                  <UploadField label={p.sectionImage || 'Section Image'} value={block.image} onChange={v => setList('contentBlocks', bi, 'image', v)} />
                )}
                <div>
                  <label className={labelCls}>{p.orderLabel || 'Display Order'}</label>
                  <input type="number" className="w-24 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white" value={block.order} min={0} onChange={e => setList('contentBlocks', bi, 'order', Number(e.target.value))} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('contentBlocks', emptyBlock)} className="flex items-center gap-2 text-sm text-[#4b6741] hover:underline font-medium cursor-pointer">
            {p.addContentSection || '+ Add Content Section'}
          </button>
        </Section>

        <Section title={p.statsSection || 'Stats'}>
          <div className="space-y-3">
            {form.stats.map((s, i) => (
              <div key={i} className="flex gap-3 items-center">
                <input className={inputCls} placeholder={p.valueLabel || 'Value e.g. 10+'} value={s.value} onChange={e => setList('stats', i, 'value', e.target.value)} />
                <input className={inputCls} placeholder="Label e.g. Years Experience" value={s.label} onChange={e => setList('stats', i, 'label', e.target.value)} />
                <input type="number" className="w-20 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white" placeholder={p.orderLabel || 'Order'} value={s.order} onChange={e => setList('stats', i, 'order', Number(e.target.value))} min={0} />
                <button type="button" onClick={() => removeItem('stats', i)} className="shrink-0 text-red-400 hover:text-red-600 cursor-pointer">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('stats', emptyStat)} className="text-sm text-[#4b6741] hover:underline font-medium cursor-pointer">{p.addStat || '+ Add Stat'}</button>
        </Section>

        <Section title={p.teamSection || 'Team Members'}>
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <div>
              <label className={labelCls}>{p.sectionLabel || 'Section Label'}</label>
              <input className={inputCls} value={form.teamLabel} onChange={e => set('teamLabel', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{p.sectionHeading || 'Section Heading'}</label>
              <input className={inputCls} value={form.teamHeading} onChange={e => set('teamHeading', e.target.value)} />
            </div>
          </div>
          <div className="space-y-4">
            {form.team.map((m, i) => (
              <div key={i} className="rounded-xl border border-slate-100 p-4 bg-slate-50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{p.memberLabel || 'Member'} {i + 1}</span>
                  <button type="button" onClick={() => removeItem('team', i)} className="text-red-400 hover:text-red-600 cursor-pointer">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>{p.nameLabel || 'Name'}</label>
                    <input className={inputCls} value={m.name} onChange={e => setList('team', i, 'name', e.target.value)} placeholder="Full name" />
                  </div>
                  <div>
                    <label className={labelCls}>{p.roleTitle || 'Role / Title'}</label>
                    <input className={inputCls} value={m.role} onChange={e => setList('team', i, 'role', e.target.value)} placeholder="e.g. Senior Agent" />
                  </div>
                  <div>
                    <label className={labelCls}>{p.orderLabel || 'Order'}</label>
                    <input type="number" className={inputCls} value={m.order} onChange={e => setList('team', i, 'order', Number(e.target.value))} min={0} />
                  </div>
                </div>
                <UploadField label={p.avatarPhoto || 'Avatar Photo'} value={m.avatar} onChange={v => setList('team', i, 'avatar', v)} hint="JPG, PNG, WEBP — max 10 MB · Square crop recommended" />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('team', emptyMember)} className="mt-3 text-sm text-[#4b6741] hover:underline font-medium cursor-pointer">{p.addTeamMember || '+ Add Team Member'}</button>
        </Section>

        <div className="flex justify-end pb-6">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-6 py-3 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
            {saving ? (c.saving || 'Saving…') : (p.saveAll || 'Save All Changes')}
          </button>
        </div>
      </form>
    </AdminLayout>
  )
}

export default AdminAbout
