import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useLanguage } from '../contexts/LanguageContext'

const empty = { name: '', logo: '', link: '', circular: false, order: 0, visible: true }
const CROP_BOX = 300
const CROP_OUTPUT = 600
const MIN_SCALE = 1
const MAX_SCALE = 6

const CropModal = ({ src, onCancel, onApply, labels }) => {
  const [natural, setNatural] = useState(null)
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const imgRef = useRef(null)

  const baseScale = natural ? Math.min(CROP_BOX / natural.w, CROP_BOX / natural.h) : 1
  const drawW = natural ? natural.w * baseScale * scale : CROP_BOX
  const drawH = natural ? natural.h * baseScale * scale : CROP_BOX

  const clamp = (p, w, h) => {
    const maxX = Math.max(0, (w - CROP_BOX) / 2)
    const maxY = Math.max(0, (h - CROP_BOX) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) }
  }

  const onImgLoad = () => {
    const img = imgRef.current
    if (img) setNatural({ w: img.naturalWidth, h: img.naturalHeight })
  }

  // Listeners go on window, not the small circular div — otherwise the
  // drag stops dead the instant the cursor exits that 300px circle, which
  // happens almost immediately once you're zoomed in enough to need a real
  // drag distance to reposition anything.
  const moveDrag = (clientX, clientY) => {
    if (!dragRef.current) return
    const dx = clientX - dragRef.current.startX
    const dy = clientY - dragRef.current.startY
    setPos(clamp({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }, drawW, drawH))
  }

  const startDrag = (clientX, clientY) => {
    dragRef.current = { startX: clientX, startY: clientY, origX: pos.x, origY: pos.y }
    const handleMove = (e) => {
      const p = e.touches ? e.touches[0] : e
      moveDrag(p.clientX, p.clientY)
    }
    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleUp)
  }

  const onWheel = (e) => {
    e.preventDefault()
    setScale(s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.0025)))
  }

  useEffect(() => { setPos(p => clamp(p, drawW, drawH)) }, [scale, natural])

  const handleApply = () => {
    const canvas = document.createElement('canvas')
    canvas.width = CROP_OUTPUT
    canvas.height = CROP_OUTPUT
    const ctx = canvas.getContext('2d')
    const outScale = CROP_OUTPUT / CROP_BOX
    ctx.save()
    ctx.beginPath()
    ctx.arc(CROP_OUTPUT / 2, CROP_OUTPUT / 2, CROP_OUTPUT / 2, 0, Math.PI * 2)
    ctx.clip()
    const w = drawW * outScale
    const h = drawH * outScale
    const x = CROP_OUTPUT / 2 - w / 2 + pos.x * outScale
    const y = CROP_OUTPUT / 2 - h / 2 + pos.y * outScale
    ctx.drawImage(imgRef.current, x, y, w, h)
    ctx.restore()
    canvas.toBlob(blob => onApply(blob), 'image/png')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center">
        <h3 style={{ fontFamily: 'Cinzel, serif' }} className="text-base font-bold text-[#202a36] mb-1">{labels.title || 'Position Your Logo'}</h3>
        <p className="text-xs text-slate-500 mb-4">{labels.hint || 'The whole logo is shown to start — zoom in with the slider or your scroll wheel, then drag to position it.'}</p>
        <div
          className="relative mx-auto select-none overflow-hidden rounded-full border border-slate-200 bg-slate-100"
          style={{ width: CROP_BOX, height: CROP_BOX, cursor: dragRef.current ? 'grabbing' : 'grab' }}
          onWheel={onWheel}
          onMouseDown={e => startDrag(e.clientX, e.clientY)}
          onTouchStart={e => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            onLoad={onImgLoad}
            draggable={false}
            className="absolute top-1/2 left-1/2 pointer-events-none"
            style={{ width: drawW, height: drawH, maxWidth: 'none', maxHeight: 'none', transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` }}
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input type="range" min={MIN_SCALE} max={MAX_SCALE} step="0.01" value={scale} onChange={e => setScale(Number(e.target.value))} className="w-full accent-[#4b6741]" />
          <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
        </div>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">{labels.cancel || 'Cancel'}</button>
          <button type="button" onClick={handleApply} className="flex-1 rounded-xl bg-[#4b6741] py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer">{labels.apply || 'Apply Crop'}</button>
        </div>
      </div>
    </div>
  )
}

const ConfirmModal = ({ message, onConfirm, onCancel, cancelLabel, deleteLabel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg className="h-6 w-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      <div className="mt-5 flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">{cancelLabel || 'Cancel'}</button>
        <button onClick={onConfirm} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition cursor-pointer">{deleteLabel || 'Delete'}</button>
      </div>
    </div>
  </div>
)

const AdminPartners = () => {
  const { t } = useLanguage()
  const p = t.adminPages?.partners || {}
  const c = t.adminPages?.common || {}
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [cropSrc, setCropSrc] = useState(null)
  const pendingFileRef = useRef(null)

  const load = () => {
    setLoading(true)
    api.get('/partners/all')
      .then(r => setPartners(r.data.partners || []))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ ...empty, order: partners.length }); setModal('create') }
  const openEdit = (pt) => { setForm({ name: pt.name, logo: pt.logo || '', link: pt.link || '', circular: pt.circular ?? false, order: pt.order ?? 0, visible: pt.visible ?? true }); setModal(pt) }

  const uploadBlob = async (blob) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', blob, 'logo.png')
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setForm(f => ({ ...f, logo: r.data.url }))
      toast.success(p.logoUploaded || 'Logo uploaded')
    } catch (err) {
      toast.error(c.uploadFailed || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    pendingFileRef.current = file
    if (form.circular) {
      setCropSrc(URL.createObjectURL(file))
    } else {
      await uploadBlob(file)
    }
    e.target.value = ''
  }

  const handleCircularToggle = (checked) => {
    setForm(f => ({ ...f, circular: checked }))
    if (checked && pendingFileRef.current) {
      setCropSrc(URL.createObjectURL(pendingFileRef.current))
    }
  }

  const handleCropApply = async (blob) => {
    setCropSrc(null)
    await uploadBlob(blob)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error(p.nameRequired || 'Company name is required'); return }
    if (!form.logo) { toast.error(p.logoRequired || 'A logo image is required'); return }
    setSaving(true)
    try {
      if (modal === 'create') {
        const r = await api.post('/partners', form)
        setPartners(prev => [...prev, r.data.partner])
        toast.success(p.added || 'Partner added')
      } else {
        const r = await api.put(`/partners/${modal._id}`, form)
        setPartners(prev => prev.map(x => x._id === modal._id ? r.data.partner : x))
        toast.success(p.updated || 'Partner updated')
      }
      setModal(null)
    } catch (err) {
      toast.error(err.response?.data?.message || c.failed || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const askDelete = (pt) => {
    setConfirm({
      message: `${p.deleteConfirm || 'Delete'} "${pt.name}"? ${p.deleteConfirmSub || 'This cannot be undone.'}`,
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.delete(`/partners/${pt._id}`)
          setPartners(prev => prev.filter(x => x._id !== pt._id))
          toast.success(p.deleted || 'Partner deleted')
        } catch (err) {
          toast.error(err.response?.data?.message || c.failed || 'Failed')
        }
      },
    })
  }

  const move = async (pt, dir) => {
    const sorted = [...partners].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const idx = sorted.findIndex(x => x._id === pt._id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx], b = sorted[swapIdx]
    const aOrder = a.order ?? 0, bOrder = b.order ?? 0
    try {
      const [ra, rb] = await Promise.all([
        api.put(`/partners/${a._id}`, { order: bOrder }),
        api.put(`/partners/${b._id}`, { order: aOrder }),
      ])
      setPartners(prev => prev.map(x => x._id === a._id ? ra.data.partner : x._id === b._id ? rb.data.partner : x))
    } catch {
      toast.error(c.saveFailed || 'Failed to reorder')
    }
  }

  const toggleVisible = async (pt) => {
    try {
      const r = await api.put(`/partners/${pt._id}`, { visible: !pt.visible })
      setPartners(prev => prev.map(x => x._id === pt._id ? r.data.partner : x))
    } catch {
      toast.error(c.saveFailed || 'Failed to update')
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
  const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

  const sorted = [...partners].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Partner Companies'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Manage the scrolling logo strip shown on the homepage before "What Our Clients Say."'}</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            {p.addPartner || 'Add Partner'}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
            {p.empty || 'No partner companies yet. Add your first logo.'}
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((pt, i) => (
              <div key={pt._id} className={`flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm ${!pt.visible ? 'opacity-60' : ''}`}>
                <div className="flex flex-col gap-1">
                  <button disabled={i === 0} onClick={() => move(pt, -1)} className="h-6 w-6 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 cursor-pointer">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button disabled={i === sorted.length - 1} onClick={() => move(pt, 1)} className="h-6 w-6 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 cursor-pointer">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
                <div className={`flex h-16 w-28 shrink-0 items-center justify-center border border-slate-100 bg-slate-50 p-2 ${pt.circular ? 'rounded-full !w-16' : 'rounded-xl'}`}>
                  <img src={pt.logo} alt={pt.name} className={`max-h-full max-w-full ${pt.circular ? 'h-full w-full rounded-full object-cover' : 'object-contain'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#202a36] truncate">{pt.name}</p>
                  {pt.link ? (
                    <p className="text-xs text-[#4b6741] truncate mt-0.5">{p.linksTo || 'Links to'}: {pt.link}</p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-0.5">{p.noLink || 'No link — logo is not clickable'}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleVisible(pt)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer ${pt.visible ? 'bg-green-100 text-green-700' : 'bg-slate-700 text-white'}`}>
                    {pt.visible ? (c.visible || 'Visible') : (c.hidden || 'Hidden')}
                  </button>
                  <button onClick={() => openEdit(pt)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                    {c.edit || 'Edit'}
                  </button>
                  <button onClick={() => askDelete(pt)} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 transition cursor-pointer">
                    {c.delete || 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-[#202a36]">
                {modal === 'create' ? (p.addPartnerTitle || 'Add Partner Company') : (p.editPartnerTitle || 'Edit Partner')}
              </h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className={labelCls}>{p.companyName || 'Company Name'}</label>
                <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Istanbul Metropolitan Bank" />
              </div>
              <div>
                <label className={labelCls}>{p.logoImage || 'Logo Image'}</label>
                <div className="flex items-center gap-3">
                  <div className={`flex h-16 w-28 shrink-0 items-center justify-center border border-dashed border-slate-300 bg-slate-50 p-2 ${form.circular ? 'rounded-full !w-16' : 'rounded-xl'}`}>
                    {form.logo ? <img src={form.logo} alt="" className={`max-h-full max-w-full ${form.circular ? 'h-full w-full rounded-full object-cover' : 'object-contain'}`} /> : <span className="text-[10px] text-slate-400 text-center">{p.noLogoYet || 'No logo yet'}</span>}
                  </div>
                  <label className="flex-1 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 py-4 text-xs font-medium text-slate-500 hover:border-[#4b6741] hover:text-[#4b6741] transition">
                    {uploading ? (c.uploading || 'Uploading...') : (p.uploadLogo || 'Click to upload logo')}
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={uploading} />
                  </label>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">{p.logoHint || 'Transparent PNG or SVG logos look best in the strip. Use "Circular" below for square photos or logos without a transparent background.'}</p>
                <label className="mt-2 flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-[#4b6741]" checked={form.circular} onChange={e => handleCircularToggle(e.target.checked)} />
                  <span className="text-sm text-slate-600">{p.circularOption || 'Crop logo into a circle (like a profile picture)'}</span>
                </label>
                {form.circular && form.logo && (
                  <button
                    type="button"
                    onClick={() => pendingFileRef.current ? setCropSrc(URL.createObjectURL(pendingFileRef.current)) : toast.error(p.recropNeedsFile || 'Re-upload the logo to reposition the crop.')}
                    className="mt-2 text-xs font-semibold text-[#4b6741] hover:underline cursor-pointer"
                  >
                    {p.adjustCrop || 'Adjust crop position & zoom'}
                  </button>
                )}
              </div>
              <div>
                <label className={labelCls}>{p.websiteLink || 'Website Link (optional)'}</label>
                <input className={inputCls} value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} placeholder="https://partner-website.com" />
                <p className="mt-1 text-[10px] text-slate-400">{p.linkHint || "Leave blank to make this logo not clickable on the homepage."}</p>
              </div>
              <div className="flex flex-col">
                <label className={labelCls}>{c.visible || 'Visible'}</label>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-[#4b6741]" checked={form.visible} onChange={e => setForm(f => ({ ...f, visible: e.target.checked }))} />
                  <span className="text-sm text-slate-600">{p.showOnHomepage || 'Show in the homepage strip'}</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                  {c.cancel || 'Cancel'}
                </button>
                <button type="submit" disabled={saving || uploading} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving...') : modal === 'create' ? (p.addPartnerBtn || 'Add Partner') : (p.saveChanges || 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} cancelLabel={c.cancel} deleteLabel={c.delete} />}

      {cropSrc && (
        <CropModal
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onApply={handleCropApply}
          labels={{ title: p.cropTitle, hint: p.cropHint, cancel: c.cancel, apply: p.cropApply }}
        />
      )}
    </AdminLayout>
  )
}

export default AdminPartners
