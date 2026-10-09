import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { PAGE_CONTENT_REGISTRY, PAGE_CONTENT_KEYS, allFieldDefs, defaultValues } from '../lib/pageContentRegistry'
import { editableText } from '../lib/localizedText'
import { buildSavePayload, isEmptyPayload } from '../lib/pageContentResolve'
import { pageContentFieldLabel, pageContentPageLabel, pageContentSectionTitle } from '../lib/pageContentAdminLabels'
import { summarizeSaveReport, languageList } from '../lib/pageContentSaveReport'
import { describeFieldTranslations } from '../lib/pageContentTranslationStatus'
import { FieldTranslationStatus, PageTranslationSummary } from '../components/PageContentTranslationStatus'
import { useLanguage } from '../contexts/LanguageContext'
import ContactInterestsManager from '../components/ContactInterestsManager'

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

function FieldRows({ fields, values, setField, pc, translations, language }) {
  if (!fields.length) {
    return <p className="text-sm italic text-slate-400">{pc.managedElsewhere || 'The records in this section are managed on their own admin page — here you can only show or hide it.'}</p>
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((f) => {
        // Layout keys off the stable ENGLISH caption, so a translation can never
        // change which fields get the wide textarea.
        const isLong = /paragraph|body|description|subtitle|subheading/i.test(f.label)
        const caption = pageContentFieldLabel(pc, f)
        return (
          <div key={f.key} className={isLong || f.type === 'image' ? 'sm:col-span-2' : ''}>
            {f.type === 'image' ? (
              <ImageField label={caption} value={values[f.key]} onChange={(v) => setField(f.key, v)} pc={pc} />
            ) : (
              <div>
                <label className={labelCls}>{caption}</label>
                <textarea
                  className={inputCls}
                  rows={isLong ? 3 : 1}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
                {translations?.[f.key] && (
                  <FieldTranslationStatus rows={translations[f.key]} caption={caption} language={language} pc={pc} />
                )}
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

function SectionCard({ section, title, visible, onToggleVisible, values, setField, pc, translations, language }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3 px-6 py-4">
        <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: visible ? GREEN : '#CBD5E1' }} />
        <span style={{ fontFamily: 'Cinzel, serif' }} className="min-w-0 flex-1 truncate text-sm font-semibold text-[#202a36]">
          {title}
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
          <FieldRows fields={section.fields} values={values} setField={setField} pc={pc} translations={translations} language={language} />
        </div>
      )}
    </div>
  )
}

// "Section — Field" for every field on a page, to name the ones a save report
// mentions. Captions repeat between sections ("Heading"), so the section is
// part of the name.
const fieldCaptions = (pageKey, pc) => {
  const page = PAGE_CONTENT_REGISTRY[pageKey]
  const captions = {}
  for (const f of page.hero.fields) captions[f.key] = `${pc.hero || 'Hero'} — ${pageContentFieldLabel(pc, f)}`
  for (const section of page.sections) {
    for (const f of section.fields) captions[f.key] = `${pageContentSectionTitle(pc, pageKey, section)} — ${pageContentFieldLabel(pc, f)}`
  }
  return captions
}

/*
 * What the last save could not translate, field by field. Shown until it is
 * dismissed or the next save replaces it — a toast is gone in five seconds,
 * and "German still shows the old text" is something to act on, not glance at.
 */
function SaveReport({ report, pageKey, language, pc, onDismiss }) {
  const captions = fieldCaptions(pageKey, pc)

  return (
    <div role="status" data-testid="save-report" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-4">
        <p className="font-semibold">{pc.saveReportTitle}</p>
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs font-semibold underline cursor-pointer">
          {pc.saveReportDismiss}
        </button>
      </div>
      <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto">
        {report.issues.map((issue) => (
          <li key={issue.fieldKey}>
            <p className="font-medium">{captions[issue.fieldKey] || issue.fieldKey}</p>
            {issue.previous.length > 0 && (
              <p className="mt-0.5">{pc.saveIssuePrevious.replace('{languages}', () => languageList(issue.previous, language))}</p>
            )}
            {issue.missing.length > 0 && (
              <p className="mt-0.5">{pc.saveIssueMissing.replace('{languages}', () => languageList(issue.missing, language))}</p>
            )}
            {issue.tooLong && <p className="mt-0.5">{pc.saveIssueTooLong}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

const AdminPageContent = () => {
  const { t, language } = useLanguage()
  const pc = t.adminPages?.pageContent || {}

  const [pageKey, setPageKey] = useState(PAGE_CONTENT_KEYS[0])
  const page = PAGE_CONTENT_REGISTRY[pageKey]

  const [values, setValues] = useState({})
  const [sections, setSections] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [heroOpen, setHeroOpen] = useState(true)
  // The translation problems of the most recent save, or null.
  const [saveReport, setSaveReport] = useState(null)
  /*
   * What is STORED for this page, with the backend's translation state for it:
   * { fields, states }, or null when that state is not available (an older
   * backend, or the richer read failed). It only ever feeds the read-only
   * status display — the form's values and baseline never come from here.
   */
  const [stored, setStored] = useState(null)

  /*
   * What the server last told us this page contains. Every save diffs against
   * it, so an untouched field is never sent and never re-translated.
   *
   * State rather than a ref: the save bar's visibility is derived from the
   * diff, so replacing the baseline after a successful save has to trigger a
   * re-render — otherwise the bar would keep offering to save changes the
   * server already has.
   */
  const [baseline, setBaseline] = useState({ values: {}, sections: {} })

  /*
   * Generation counter for in-flight loads.
   *
   * Switching pages starts a new GET without cancelling the old one, so a slow
   * /home response can land after a fast /architecture one and repopulate the
   * form — and, worse, the BASELINE — with another page's content. The next
   * save would then diff Architecture's values against Home's baseline and
   * submit nearly every field.
   *
   * Each load claims a ticket; only the newest ticket is allowed to write
   * state. Cheaper than AbortController here, and it needs nothing from the
   * axios instance in lib/api.js.
   */
  const loadTicket = useRef(0)

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
    const ticket = ++loadTicket.current
    setLoading(true)
    setLoadFailed(false)
    setSaveReport(null)
    setStored(null)

    const fallback = defaultValues(key)
    setValues(fallback)
    setSections({})
    // Switching pages resets the baseline too, so one page's edits can never
    // be diffed against another's.
    setBaseline({ values: fallback, sections: {} })

    try {
      /*
       * The editors' read returns the same content as the public one plus each
       * field's translation state. It is tried first; if it is not there (a
       * backend from before it existed) or fails, the public read still loads
       * the page — editing never depends on the status display.
       */
      let res
      let states = null
      try {
        res = await api.get(`/page-content/${key}/admin`)
        states = res.data.translationStates || null
      } catch {
        res = await api.get(`/page-content/${key}`)
      }

      const fields = res.data.fields || {}
      const merged = { ...fallback }

      for (const def of allFieldDefs(key)) {
        const field = fields[def.key]
        if (!field) continue

        const value = def.type === 'image' ? field.url : editableText(field)
        // An empty stored value keeps the registry default in the box rather
        // than blanking it — the admin can still clear it deliberately.
        if (typeof value === 'string' && value !== '') merged[def.key] = value
      }

      // A newer page has been selected since this request went out.
      if (ticket !== loadTicket.current) return

      setValues(merged)
      setSections(res.data.sections || {})
      setBaseline({ values: merged, sections: res.data.sections || {} })
      setStored(states ? { fields, states } : null)
    } catch {
      // Everything below still shows the real current site copy from the
      // registry, so the editor stays usable and honest about why.
      if (ticket === loadTicket.current) setLoadFailed(true)
    } finally {
      if (ticket === loadTicket.current) setLoading(false)
    }
  }, [])

  useEffect(() => { loadPage(pageKey) }, [pageKey, loadPage])

  const setField = (key, value) => setValues((prev) => ({ ...prev, [key]: value }))

  const toggleSection = (key) => setSections((prev) => ({ ...prev, [key]: prev[key] === false }))

  const isVisible = (key) => sections[key] !== false

  /*
   * Derived, not tracked. Editing a box and undoing it leaves the value equal
   * to the baseline, so the save bar disappears again instead of offering to
   * save nothing.
   */
  const payload = useMemo(
    () => buildSavePayload({
      fieldDefs: allFieldDefs(pageKey),
      baselineValues: baseline.values,
      values,
      baselineSections: baseline.sections,
      sections,
    }),
    [pageKey, values, sections, baseline]
  )

  const dirty = !isEmptyPayload(payload)

  /*
   * Re-reads the stored translation state after a save, so the chips describe
   * what was just written. A read only. If it fails the status is withdrawn
   * rather than left showing what was true before the save.
   */
  const refreshStored = async (key) => {
    const ticket = loadTicket.current
    try {
      const res = await api.get(`/page-content/${key}/admin`)
      if (ticket !== loadTicket.current) return
      setStored(res.data.translationStates ? { fields: res.data.fields || {}, states: res.data.translationStates } : null)
    } catch {
      if (ticket === loadTicket.current) setStored(null)
    }
  }

  // One row per language for every text field, from what is stored — not from
  // what is being typed: an unsaved edit has no translations yet.
  const translations = useMemo(() => {
    if (!stored) return null
    const rows = {}
    for (const def of allFieldDefs(pageKey)) {
      if (def.type === 'image') continue
      rows[def.key] = describeFieldTranslations({ pageKey, def, field: stored.fields[def.key], states: stored.states[def.key] })
    }
    return rows
  }, [stored, pageKey])

  /*
   * Says what the server reported — nothing more. The source edit is saved in
   * every case that reaches here; what varies is how much of it was translated.
   * A response with no report (a backend that predates it) gets a plain
   * "Saved.", never a claim about translation.
   */
  const announceSave = (report) => {
    const source = report.sourceLangs.length > 0
      ? ` ${pc.savedSourceLanguage.replace('{languages}', () => languageList(report.sourceLangs, language))}`
      : ''

    if (report.outcome === 'complete') {
      toast.success(pc.savedTranslated.replace('{count}', () => report.languageCount) + source)
    } else if (report.outcome === 'partial') {
      toast.warn(pc.savedPartial + source)
    } else if (report.outcome === 'untranslated') {
      toast.warn(pc.savedUntranslated + source)
    } else {
      toast.success(pc.savedNeutral)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await api.put(`/page-content/${pageKey}`, payload)
      const report = summarizeSaveReport(res.data?.translation)
      announceSave(report)
      setSaveReport(report.issues.length > 0 ? report : null)
      // The save succeeded, so what is on screen is now what the server holds.
      // A failed save deliberately leaves the baseline alone, so the same delta
      // is still pending and the admin can simply press Save again.
      setBaseline({ values, sections })
      refreshStored(pageKey)
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
              {pageContentPageLabel(pc, key, PAGE_CONTENT_REGISTRY[key])}
            </button>
          ))}
        </div>

        {saveReport && (
          <SaveReport report={saveReport} pageKey={pageKey} language={language} pc={pc} onDismiss={() => setSaveReport(null)} />
        )}

        {loading && (
          <div className="py-16 text-center text-sm text-slate-400">{pc.loading || 'Loading…'}</div>
        )}

        {!loading && !loadFailed && (translations
          ? <PageTranslationSummary rowsByField={translations} pc={pc} />
          : <p data-testid="translation-status-unavailable" className="px-1 text-xs text-slate-400">{pc.statusUnavailable}</p>
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
                  <FieldRows fields={page.hero.fields} values={values} setField={setField} pc={pc} translations={translations} language={language} />
                </div>
              )}
            </div>

            {page.sections.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                title={pageContentSectionTitle(pc, pageKey, section)}
                visible={isVisible(section.key)}
                onToggleVisible={() => toggleSection(section.key)}
                values={values}
                setField={setField}
                pc={pc}
                translations={translations}
                language={language}
              />
            ))}

            {page.sections.length === 0 && (
              <p className="px-1 text-sm italic text-slate-400">
                {pc.noSections || 'This page has no toggleable sections — just the hero above.'}
              </p>
            )}
          </>
        )}

        {/*
          Contact interests are ContactInterest records, not PageContent fields.
          Shown here for convenience only: the manager saves through
          /api/contact/interests on its own, and nothing in it feeds this
          editor's payload or its Save Changes bar.
        */}
        {pageKey === 'contact' && <ContactInterestsManager />}
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
