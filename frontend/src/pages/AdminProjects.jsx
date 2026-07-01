import { useState, useEffect } from 'react'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useLanguage } from '../contexts/LanguageContext'

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

const emptyPhase = { label: '', pct: 0, order: 0 }
const emptyProject = {
  name: '', location: '', completion: '', status: 'active', visible: true, featured: false, order: 0,
  phases: [
    { label: 'Foundation & Groundwork', pct: 0, order: 0 },
    { label: 'Structural Frame', pct: 0, order: 1 },
    { label: 'Envelope & Façade', pct: 0, order: 2 },
    { label: 'MEP Systems', pct: 0, order: 3 },
    { label: 'Interior Fit-Out', pct: 0, order: 4 },
    { label: 'Landscaping & Handover', pct: 0, order: 5 },
  ],
}

const STATUS_COLORS = { active: 'bg-green-100 text-green-700', completed: 'bg-blue-100 text-blue-700', upcoming: 'bg-amber-100 text-amber-700' }

const AdminProjects = () => {
  const { t } = useLanguage()
  const p = t.adminPages?.projects || {}
  const c = t.adminPages?.common || {}
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyProject)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/projects/all')
      setProjects(res.data.projects || [])
    } catch {
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm({ ...emptyProject, phases: emptyProject.phases.map(ph => ({ ...ph })) }); setModal('add') }
  const openEdit = (proj) => { setForm({ ...proj, phases: proj.phases.map(ph => ({ ...ph })) }); setModal(proj) }
  const closeModal = () => { setModal(null); setError('') }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setPhase = (i, field, val) => setForm(f => {
    const phases = [...f.phases]
    phases[i] = { ...phases[i], [field]: val }
    return { ...f, phases }
  })
  const addPhase = () => setForm(f => ({ ...f, phases: [...f.phases, { ...emptyPhase, order: f.phases.length }] }))
  const removePhase = (i) => setForm(f => ({ ...f, phases: f.phases.filter((_, idx) => idx !== i) }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Project name is required'); return }
    setSaving(true); setError('')
    try {
      if (modal === 'add') {
        await api.post('/projects', form)
      } else {
        await api.put(`/projects/${modal._id}`, form)
      }
      closeModal()
      load()
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this project?')) return
    setDeleting(id)
    try {
      await api.delete(`/projects/${id}`)
      setProjects(prev => prev.filter(proj => proj._id !== id))
    } catch {
      setError('Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Projects'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Manage construction projects shown on the Construction page'}</p>
          </div>
          <button onClick={openAdd} className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            {p.addProject || 'Add Project'}
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="text-sm text-slate-400 py-12 text-center">{p.loadingProjects || 'Loading projects...'}</div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
            <p className="text-slate-400 text-sm">{p.empty || 'No projects yet. Add your first construction project.'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map(proj => {
              const overall = proj.phases.length ? Math.round(proj.phases.reduce((s, ph) => s + ph.pct, 0) / proj.phases.length) : 0
              return (
                <div key={proj._id} className={`rounded-2xl border bg-white p-5 shadow-sm ${!proj.visible ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{proj.name}</h3>
                        <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 capitalize ${STATUS_COLORS[proj.status]}`}>{proj.status}</span>
                        {proj.featured && <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 bg-purple-100 text-purple-700">Featured</span>}
                        {!proj.visible && <span className="text-xs text-slate-400">({c.hidden || 'Hidden'})</span>}
                      </div>
                      {proj.location && <p className="text-sm text-slate-500 mt-1">{proj.location}</p>}
                      {proj.completion && <p className="text-xs text-slate-400 mt-0.5">Est. completion: {proj.completion}</p>}
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>{p.overallProgress || 'Overall Progress'}</span>
                          <span>{overall}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-[#4b6741] transition-all" style={{ width: `${overall}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEdit(proj)} className="text-xs text-slate-500 hover:text-[#4b6741] font-medium transition cursor-pointer">{c.edit || 'Edit'}</button>
                      <button onClick={() => handleDelete(proj._id)} disabled={deleting === proj._id}
                        className="text-xs text-red-400 hover:text-red-600 font-medium transition cursor-pointer disabled:opacity-50">
                        {deleting === proj._id ? '...' : (c.delete || 'Delete')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl mb-8">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-[#202a36]">
                {modal === 'add' ? (p.addProject || 'Add Project') : (p.editProject || 'Edit Project')}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{p.projectName || 'Project Name *'}</label>
                  <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Bosphorus Residences — Phase II" />
                </div>
                <div>
                  <label className={labelCls}>{p.location || 'Location'}</label>
                  <input className={inputCls} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Beşiktaş, Istanbul" />
                </div>
                <div>
                  <label className={labelCls}>{p.estCompletion || 'Est. Completion'}</label>
                  <input className={inputCls} value={form.completion} onChange={e => set('completion', e.target.value)} placeholder="Q3 2026" />
                </div>
                <div>
                  <label className={labelCls}>{p.status || 'Status'}</label>
                  <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
                    <option value="active">{p.active || 'Active'}</option>
                    <option value="upcoming">{p.upcoming || 'Upcoming'}</option>
                    <option value="completed">{p.completed || 'Completed'}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{p.displayOrder || 'Display Order'}</label>
                  <input type="number" className={inputCls} value={form.order} onChange={e => set('order', Number(e.target.value))} min={0} />
                </div>
                <div className="flex items-end gap-6 pb-0.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.visible} onChange={e => set('visible', e.target.checked)} className="h-4 w-4 rounded accent-[#4b6741]" />
                    <span className="text-sm text-slate-700">{p.visibleLabel || 'Visible'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.featured} onChange={e => set('featured', e.target.checked)} className="h-4 w-4 rounded accent-[#4b6741]" />
                    <span className="text-sm text-slate-700">{p.featuredLabel || 'Featured on Construction page'}</span>
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className={labelCls + ' mb-0'}>{p.phases || 'Construction Phases'}</label>
                  <button type="button" onClick={addPhase} className="text-xs text-[#4b6741] hover:underline font-medium cursor-pointer">{p.addPhase || '+ Add Phase'}</button>
                </div>
                <div className="space-y-2">
                  {form.phases.map((ph, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input className={inputCls} placeholder="Phase label" value={ph.label} onChange={e => setPhase(i, 'label', e.target.value)} />
                      <div className="flex items-center gap-1 shrink-0 w-28">
                        <input type="number" className="w-16 rounded-lg border border-slate-200 px-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white text-center"
                          value={ph.pct} onChange={e => setPhase(i, 'pct', Math.min(100, Math.max(0, Number(e.target.value))))} min={0} max={100} />
                        <span className="text-sm text-slate-500">%</span>
                      </div>
                      <button type="button" onClick={() => removePhase(i)} className="shrink-0 text-red-400 hover:text-red-600 transition cursor-pointer">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                  {c.cancel || 'Cancel'}
                </button>
                <button type="submit" disabled={saving} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving...') : (p.saveProject || 'Save Project')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminProjects
