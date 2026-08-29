import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { PAGE_CONTENT_REGISTRY, PAGE_CONTENT_KEYS, allFieldDefs, defaultValues } from '../lib/pageContentRegistry'
import { editableText } from '../lib/localizedText'
import { useLanguage } from '../contexts/LanguageContext'

const GOLD = '#C9A35A'
const GREEN = '#4b6741'
const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 transition focus:outline-none focus:ring-2 focus:ring-[#4b6741]/40 focus:border-[#4b6741] bg-white'
const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1.5'

/*
 * Image field: paste a URL, or upload through the existing /api/upload route
 * that AdminTeam, AdminShowroom and AdminPartners already post to. No new
 * upload architecture — the same endpoint, the same `image` form field.
 */
function ImageField({ label, value, onChange, pc }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const fd = new FormData()
    fd.append('image', file)
    setUploading(true)
    try {
      const res = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      onChange(res.data.url)
      toast.success(pc.uploaded || 'Uploaded')
    } catch {
      toast.error(pc.uploadFailed || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          className={inputCls}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={pc.urlPlaceholder || 'https://… or upload'}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          {uploading ? (pc.uploading || 'Uploading…') : (pc.upload || 'Upload')}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      {value ? (
        <img
          src={value}
          alt=""
          className="mt-3 h-28 rounded-lg border border-slate-200 object-cover shadow-sm"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      ) : null}
    </div>
  )
}

function FieldRows({ fields, values, setField, pc }) {
  if (!fields.length) {
    return <p className="text-sm italic text-slate-400">{pc.managedElsewhere || 'The records in this section are managed on their own admin page — here you can only show or hide it.'}</p>
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((f) => {
        const isLong = /paragraph|body|description|subtitle|subheading/i.test(f.label)
        return (
          <div key={f.key} className={isLong || f.type === 'image' ? 'sm:col-span-2' : ''}>
            {f.type === 'image' ? (
              <ImageField label={f.label} value={values[f.key]} onChange={(v) => setField(f.key, v)} pc={pc} />
            ) : (
              <div>
                <label className={labelCls}>{f.label}</label>
                <textarea
                  className={inputCls}
                  rows={isLong ? 3 : 1}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ExpandButton({ open, onClick, pc }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
        open ? 'text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
      style={open ? { backgroundColor: GREEN } : undefined}
    >
      {open ? (pc.close || 'Close') : (pc.edit || 'Edit')}
      <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

function SectionCard({ section, visible, onToggleVisible, values, setField, pc }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3 px-6 py-4">
        <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: visible ? GREEN : '#CBD5E1' }} />
        <span style={{ fontFamily: 'Cinzel, serif' }} className="min-w-0 flex-1 truncate text-sm font-semibold text-[#202a36]">
          {section.defaultTitle}
        </span>
        <button
          onClick={onToggleVisible}
          aria-pressed={visible}
          title={visible ? (pc.visibleHint || 'Visible on the live site — click to hide') : (pc.hiddenHint || 'Hidden on the live site — click to show')}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer ${visible ? '' : 'bg-slate-300'}`}
          style={visible ? { backgroundColor: GREEN } : undefined}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${visible ? 'translate-x-5' : ''}`} />
        </button>
        <ExpandButton open={open} onClick={() => setOpen((o) => !o)} pc={pc} />
      </div>
      {open && (
        <div className="border-t border-slate-100 px-6 py-6" style={{ background: 'linear-gradient(180deg, #FAFAF7, #F7F6F2)' }}>
          <FieldRows fields={section.fields} values={values} setField={setField} pc={pc} />
        </div>
      )}
    </div>
  )
}

const AdminPageContent = () => {
  const { t } = useLanguage()
  const pc = t.adminPages?.pageContent || {}

  const [pageKey, setPageKey] = useState(PAGE_CONTENT_KEYS[0])
  const page = PAGE_CONTENT_REGISTRY[pageKey]

  const [values, setValues] = useState({})
  const [sections, setSections] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [heroOpen, setHeroOpen] = useState(true)

  /*
   * Stored text is a localized object; the form needs one editable string.
   *
   * editableText() returns the admin's OWN source-language words — the same
   * resolver AdminAbout, AdminTeam and AdminShowroom use. That matters beyond
   * avoiding "[object Object]": showing a Turkish admin the English machine
   * translation of their sentence invites them to "fix" it, which silently
   * changes the record's source language.
   */
  const loadPage = useCallback(async (key) => {
    setLoading(true)
    setLoadFailed(false)
    setDirty(false)

    const fallback = defaultValues(key)
    setValues(fallback)
    setSections({})

    try {
      const res = await api.get(`/page-content/${key}`)
      const stored = res.data.fields || {}
      const merged = { ...fallback }

      for (const def of allFieldDefs(key)) {
        const field = stored[def.key]
        if (!field) continue

        const value = def.type === 'image' ? field.url : editableText(field)
        // An empty stored value keeps the registry default in the box rather
        // than blanking it — the admin can still clear it deliberately.
        if (typeof value === 'string' && value !== '') merged[def.key] = value
      }

      setValues(merged)
      setSections(res.data.sections || {})
    } catch {
      // Everything below still shows the real current site copy from the
      // registry, so the editor stays usable and honest about why.
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPage(pageKey) }, [pageKey, loadPage])

  const setField = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const toggleSection = (key) => {
    setSections((prev) => ({ ...prev, [key]: prev[key] === false }))
    setDirty(true)
  }

  const isVisible = (key) => sections[key] !== false

  const handleSave = async () => {
    setSaving(true)
    try {
      const fields = {}
      for (const def of allFieldDefs(pageKey)) {
        fields[def.key] = def.type === 'image'
          ? { type: 'image', url: values[def.key] ?? '' }
          : { type: 'text', value: values[def.key] ?? '' }
      }

      await api.put(`/page-content/${pageKey}`, { fields, sections })
      toast.success(pc.savedSuccess || 'Saved — translated into all six languages automatically')
      setDirty(false)
    } catch (err) {
      toast.error(err?.response?.data?.message || pc.saveFailed || 'Failed to save — your changes are still here but have not reached the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6 pb-28">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">
            {pc.title || 'Page Content'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {pc.subtitle || 'Show or hide sections and edit their text and images. Write in English, Turkish or Arabic — it is translated into the other languages automatically when you save.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PAGE_CONTENT_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setPageKey(key)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition cursor-pointer ${
                pageKey === key ? 'text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              style={pageKey === key ? { backgroundColor: GREEN } : undefined}
            >
              {PAGE_CONTENT_REGISTRY[key].label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="py-16 text-center text-sm text-slate-400">{pc.loading || 'Loading…'}</div>
        )}

        {!loading && loadFailed && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            {pc.loadFailed || 'Could not reach the page-content API. Everything below shows the real current site content — it will save once the backend is reachable.'}
          </div>
        )}

        {!loading && (
          <>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-3 px-6 py-4">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: GOLD }} />
                <span style={{ fontFamily: 'Cinzel, serif' }} className="flex-1 text-sm font-semibold text-[#202a36]">
                  {pc.hero || 'Hero'}
                </span>
                <span className="text-xs text-slate-400">{pc.alwaysVisible || 'Always visible'}</span>
                <ExpandButton open={heroOpen} onClick={() => setHeroOpen((o) => !o)} pc={pc} />
              </div>
              {heroOpen && (
                <div className="border-t border-slate-100 px-6 py-6" style={{ background: 'linear-gradient(180deg, #FAFAF7, #F7F6F2)' }}>
                  <FieldRows fields={page.hero.fields} values={values} setField={setField} pc={pc} />
                </div>
              )}
            </div>

            {page.sections.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                visible={isVisible(section.key)}
                onToggleVisible={() => toggleSection(section.key)}
                values={values}
                setField={setField}
                pc={pc}
              />
            ))}

            {page.sections.length === 0 && (
              <p className="px-1 text-sm italic text-slate-400">
                {pc.noSections || 'This page has no toggleable sections — just the hero above.'}
              </p>
            )}
          </>
        )}
      </div>

      {/* Sticky save bar, so a toggle or edit can never silently go unsaved. */}
      {!loading && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur lg:pl-72">
          <p className="text-sm text-slate-600">{pc.unsavedChanges || 'You have unsaved changes.'}</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-full px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 cursor-pointer"
            style={{ backgroundColor: GREEN }}
          >
            {saving ? (pc.saving || 'Saving…') : (pc.saveChanges || 'Save Changes')}
          </button>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminPageContent
