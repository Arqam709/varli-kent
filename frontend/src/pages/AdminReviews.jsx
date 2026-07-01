import { useState, useEffect } from 'react'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useLanguage } from '../contexts/LanguageContext'

const STAR_ICON = (
  <svg className="h-4 w-4 text-amber-400 fill-current" viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
)

const empty = { name: '', role: '', text: '', rating: 5, avatar: '', visible: true, order: 0 }

const AdminReviews = () => {
  const { t } = useLanguage()
  const p = t.adminPages?.reviews || {}
  const c = t.adminPages?.common || {}
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/reviews/all')
      setReviews(res.data.reviews || [])
    } catch {
      setError('Failed to load reviews')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(empty); setModal('add') }
  const openEdit = (r) => { setForm({ ...r }); setModal(r) }
  const closeModal = () => { setModal(null); setError('') }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.text.trim()) { setError('Name and review text are required'); return }
    setSaving(true); setError('')
    try {
      if (modal === 'add') {
        await api.post('/reviews', form)
      } else {
        await api.put(`/reviews/${modal._id}`, form)
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
    if (!window.confirm('Delete this review?')) return
    setDeleting(id)
    try {
      await api.delete(`/reviews/${id}`)
      setReviews(prev => prev.filter(r => r._id !== id))
    } catch {
      setError('Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const toggleVisible = async (r) => {
    try {
      const res = await api.put(`/reviews/${r._id}`, { ...r, visible: !r.visible })
      setReviews(prev => prev.map(x => x._id === r._id ? res.data.review : x))
    } catch { setError('Update failed') }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
  const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Reviews'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Manage testimonials displayed on the homepage'}</p>
          </div>
          <button onClick={openAdd} className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            {p.addReview || 'Add Review'}
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="text-sm text-slate-400 py-12 text-center">{p.loadingReviews || 'Loading reviews...'}</div>
        ) : reviews.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
            <p className="text-slate-400 text-sm">{p.empty || 'No reviews yet. Add your first testimonial.'}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {reviews.map(r => (
              <div key={r._id} className={`rounded-2xl border bg-white p-5 shadow-sm flex flex-col gap-3 ${!r.visible ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{r.name}</p>
                    {r.role && <p className="text-xs text-slate-500">{r.role}</p>}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {Array.from({ length: r.rating }).map((_, i) => <span key={i}>{STAR_ICON}</span>)}
                  </div>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">{r.text}</p>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button onClick={() => toggleVisible(r)}
                    className={`text-xs font-semibold rounded-full px-3 py-1 transition cursor-pointer ${r.visible ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {r.visible ? (c.visible || 'Visible') : (c.hidden || 'Hidden')}
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(r)} className="text-xs text-slate-500 hover:text-[#4b6741] font-medium transition cursor-pointer">{c.edit || 'Edit'}</button>
                    <button onClick={() => handleDelete(r._id)} disabled={deleting === r._id}
                      className="text-xs text-red-400 hover:text-red-600 font-medium transition cursor-pointer disabled:opacity-50">
                      {deleting === r._id ? '...' : (c.delete || 'Delete')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-[#202a36]">
                {modal === 'add' ? (p.addReviewTitle || 'Add Review') : (p.editReviewTitle || 'Edit Review')}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>{p.nameLabel || 'Name *'}</label>
                  <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Reviewer name" />
                </div>
                <div>
                  <label className={labelCls}>{p.roleTitle || 'Role / Title'}</label>
                  <input className={inputCls} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Property Investor" />
                </div>
              </div>

              <div>
                <label className={labelCls}>{p.reviewText || 'Review Text *'}</label>
                <textarea className={inputCls} rows={4} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="Write the testimonial..." />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>{p.rating || 'Rating'}</label>
                  <select className={inputCls} value={form.rating} onChange={e => setForm(f => ({ ...f, rating: Number(e.target.value) }))}>
                    {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} Star{n !== 1 ? 's' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{c.order || 'Order'}</label>
                  <input type="number" className={inputCls} value={form.order} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} min={0} />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.visible} onChange={e => setForm(f => ({ ...f, visible: e.target.checked }))} className="h-4 w-4 rounded accent-[#4b6741]" />
                    <span className="text-sm text-slate-700">{c.visible || 'Visible'}</span>
                  </label>
                </div>
              </div>

              <div>
                <label className={labelCls}>{p.avatarUrl || 'Avatar URL (optional)'}</label>
                <input className={inputCls} value={form.avatar} onChange={e => setForm(f => ({ ...f, avatar: e.target.value }))} placeholder="https://..." />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                  {c.cancel || 'Cancel'}
                </button>
                <button type="submit" disabled={saving} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving...') : (p.saveReview || 'Save Review')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminReviews
