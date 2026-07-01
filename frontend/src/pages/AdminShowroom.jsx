import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useLanguage } from '../contexts/LanguageContext'

const SERVICES = ['architecture', 'interior', 'construction', 'renovation']
const SERVICE_LABELS = { architecture: 'Architecture', interior: 'Interior Design', construction: 'Construction', renovation: 'Renovation' }
const UPLOAD_HINT = 'JPG, PNG, WEBP, GIF — max 10 MB · MP4, MOV, WEBM — max 100 MB'

const empty = { url: '', caption: '', style: '', order: 0, visible: true }

const isVideo = (url) => url && (url.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(url))

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg className="h-6 w-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      <div className="mt-5 flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">Cancel</button>
        <button onClick={onConfirm} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition cursor-pointer">Delete</button>
      </div>
    </div>
  </div>
)

const AdminShowroom = () => {
  const { t } = useLanguage()
  const p = t.adminPages?.showroom || {}
  const c = t.adminPages?.common || {}
  const [activeTab, setActiveTab] = useState('architecture')
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const fileRef = useRef()

  const load = (service) => {
    setLoading(true)
    api.get(`/showroom/${service}/all`)
      .then(r => setImages(r.data.images || []))
      .catch(() => setImages([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(activeTab) }, [activeTab])

  const openCreate = () => { setForm({ ...empty, serviceType: activeTab }); setModal('create') }
  const openEdit = (img) => {
    setForm({ url: img.url, caption: img.caption || '', style: img.style || '', order: img.order ?? 0, visible: img.visible ?? true })
    setModal(img)
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const fd = new FormData()
    fd.append('image', file)
    setUploading(true)
    try {
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setForm(f => ({ ...f, url: r.data.url }))
      toast.success('File uploaded')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.url.trim()) { toast.error('Please upload or paste a file URL'); return }
    setSaving(true)
    try {
      if (modal === 'create') {
        await api.post('/showroom', { ...form, serviceType: activeTab })
        toast.success('Added to showroom')
      } else {
        await api.put(`/showroom/${modal._id}`, form)
        toast.success('Updated')
      }
      setModal(null)
      load(activeTab)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const askDelete = (img) => {
    setConfirm({
      message: 'Delete this showroom item? This cannot be undone.',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.delete(`/showroom/${img._id}`)
          setImages(prev => prev.filter(x => x._id !== img._id))
          toast.success('Deleted')
        } catch {
          toast.error('Failed')
        }
      },
    })
  }

  const toggleVisible = async (img) => {
    try {
      const r = await api.put(`/showroom/${img._id}`, { ...img, visible: !img.visible })
      setImages(prev => prev.map(x => x._id === img._id ? r.data.image : x))
    } catch {
      toast.error('Failed')
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
  const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Showroom'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Manage showroom images and videos for each service page.'}</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            {p.addMedia || 'Add Media'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200">
          {SERVICES.map(s => (
            <button key={s} onClick={() => setActiveTab(s)}
              className={`px-5 py-2.5 text-sm font-semibold rounded-t-xl transition cursor-pointer ${activeTab === s ? 'bg-[#4b6741] text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}>
              {p.tabs?.[s] || SERVICE_LABELS[s]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
          </div>
        ) : images.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
            {p.empty || `No media yet for ${SERVICE_LABELS[activeTab]}. Add your first showroom image or video.`}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map(img => (
              <div key={img._id} className={`rounded-2xl border bg-white overflow-hidden shadow-sm ${!img.visible ? 'opacity-60' : ''}`}>
                <div className="relative aspect-video bg-slate-100">
                  {isVideo(img.url)
                    ? <video src={img.url} className="h-full w-full object-cover" muted playsInline />
                    : <img src={img.url} alt={img.caption || ''} className="h-full w-full object-cover" onError={e => { e.target.style.display = 'none' }} />}
                  {isVideo(img.url) && (
                    <div className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white tracking-wide">VIDEO</div>
                  )}
                </div>
                <div className="p-4">
                  {img.caption && <p className="text-sm font-semibold text-[#202a36] truncate">{img.caption}</p>}
                  {img.style && <p className="text-xs text-[#4b6741] font-medium uppercase tracking-wide mt-0.5">{img.style}</p>}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button onClick={() => toggleVisible(img)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer transition ${img.visible ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-700 text-white hover:bg-slate-600'}`}>
                      {img.visible ? (c.visible || 'Visible') : (c.hidden || 'Hidden')}
                    </button>
                    <span className="text-xs text-slate-400">{c.order || 'Order'}: {img.order}</span>
                    <button onClick={() => openEdit(img)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer">{c.edit || 'Edit'}</button>
                    <button onClick={() => askDelete(img)} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 transition cursor-pointer">{c.delete || 'Delete'}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-[#202a36]">
                {modal === 'create' ? (p.addMediaTitle || 'Add Media') : (p.editMediaTitle || 'Edit Media')}
              </h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

              <div>
                <label className={labelCls}>{p.uploadLabel || 'Upload Image or Video'}</label>
                <div
                  onClick={() => fileRef.current.click()}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-6 cursor-pointer hover:border-[#4b6741] hover:bg-slate-50 transition"
                >
                  {uploading ? (
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#4b6741] border-t-transparent" />
                  ) : (
                    <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  )}
                  <p className="text-sm font-medium text-slate-500">{uploading ? (c.uploading || 'Uploading…') : (p.clickToUpload || 'Click to upload')}</p>
                  <p className="text-[10px] text-slate-400 text-center px-4">{UPLOAD_HINT}</p>
                </div>
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />
              </div>

              {form.url && (
                <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-100">
                  {isVideo(form.url)
                    ? <video src={form.url} className="h-full w-full object-cover" muted playsInline />
                    : <img src={form.url} alt="" className="h-full w-full object-cover" />}
                  <button type="button" onClick={() => setForm(f => ({ ...f, url: '' }))}
                    className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white text-xs cursor-pointer">✕</button>
                </div>
              )}

              <div>
                <label className={labelCls}>{p.orPasteUrl || 'Or paste URL'}</label>
                <input className={inputCls} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://res.cloudinary.com/..." />
              </div>

              <div>
                <label className={labelCls}>{p.caption || 'Caption (optional)'}</label>
                <input className={inputCls} value={form.caption} onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} placeholder="e.g. Bosphorus Villa — 2024" />
              </div>

              {activeTab === 'interior' && (
                <div>
                  <label className={labelCls}>{p.designStyle || 'Design Style (optional)'}</label>
                  <select className={inputCls} value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))}>
                    <option value="">{p.allStyles || 'All Styles'}</option>
                    <option value="contemporary">{p.contemporary || 'Contemporary'}</option>
                    <option value="warm">{p.warmModern || 'Warm Modern'}</option>
                    <option value="coastal">{p.coastal || 'Coastal'}</option>
                    <option value="classic">{p.classic || 'Classic'}</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{p.orderLabel || 'Display Order'}</label>
                  <input type="number" className={inputCls} value={form.order} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
                </div>
                <div className="flex flex-col">
                  <label className={labelCls}>{c.visible || 'Visible'}</label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-[#4b6741]" checked={form.visible} onChange={e => setForm(f => ({ ...f, visible: e.target.checked }))} />
                    <span className="text-sm text-slate-600">{p.showOnPage || 'Show on page'}</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">{c.cancel || 'Cancel'}</button>
                <button type="submit" disabled={saving || uploading} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving…') : modal === 'create' ? (p.addToShowroom || 'Add to Showroom') : (c.save || 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </AdminLayout>
  )
}

export default AdminShowroom
