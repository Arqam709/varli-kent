import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatPrice } from '../lib/formatPrice'

const emptyForm = { title:'', listingType:'Sale', price:'', priceLabel:'', district:'', address:'', propertyType:'Apartment', beds:'', baths:'', sqm:'', description:'', agentName:'', agentPhone:'', agentEmail:'', whatsappNumber:'', featured:false, status:'Available' }

const AdminProperties = () => {
  const { hasPermission } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.properties || {}
  const c = t.adminPages?.common || {}
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [images, setImages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchProperties = () => {
    setLoading(true)
    api.get('/properties').then(r => setProperties(r.data.properties || [])).finally(() => setLoading(false))
  }
  useEffect(() => { fetchProperties() }, [])

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setImages([]); setFormOpen(true) }
  const openEdit = (prop) => {
    setEditingId(prop._id)
    setForm({ title: prop.title, listingType: prop.listingType, price: prop.price, priceLabel: prop.priceLabel || '', district: prop.district, address: prop.address, propertyType: prop.propertyType, beds: prop.beds, baths: prop.baths, sqm: prop.sqm, description: prop.description || '', agentName: prop.agentName || '', agentPhone: prop.agentPhone || '', agentEmail: prop.agentEmail || '', whatsappNumber: prop.whatsappNumber || '', featured: prop.featured, status: prop.status })
    setImages(prop.images || [])
    setFormOpen(true)
  }

  const handleImage = async (e) => {
  const files = Array.from(e.target.files || [])

  if (!files.length) return

  setUploading(true)

  try {
    const uploadedUrls = []

    for (const file of files) {
      const fd = new FormData()
      fd.append('image', file)

      const r = await api.post('/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      uploadedUrls.push(r.data.url)
    }

    setImages(prev => [...prev, ...uploadedUrls])
    toast.success(`${uploadedUrls.length} file(s) uploaded`)
  } catch (err) {
    console.error(err)
    toast.error('Upload failed')
  } finally {
    setUploading(false)
    e.target.value = ''
  }
}

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form, price: Number(form.price), beds: Number(form.beds), baths: Number(form.baths), sqm: Number(form.sqm), images, mainImage: images[0] || '' }
    try {
      if (editingId) {
        await api.put(`/properties/${editingId}`, payload)
        toast.success('Property updated')
      } else {
        await api.post('/properties', payload)
        toast.success('Property added')
      }
      setFormOpen(false)
      fetchProperties()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this property?')) return
    try {
      await api.delete(`/properties/${id}`)
      toast.success('Deleted')
      fetchProperties()
    } catch {
      toast.error('Delete failed')
    }
  }

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]'

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Property Management'}</h1>
            <p className="mt-1 text-sm text-slate-500">{properties.length} {p.totalListings || 'total listings'}</p>
          </div>
          {hasPermission('add_listing') && (
            <button onClick={openAdd} className="rounded-full bg-[#202a36] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4b6741] transition cursor-pointer">{p.addProperty || '+ Add Property'}</button>
          )}
        </div>

        {formOpen && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36]">{editingId ? (p.editProperty || 'Edit Property') : (p.addPropertyTitle || 'Add Property')}</h2>
              <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.titleLabel || 'Title'}</label>
                  <input value={form.title} onChange={e => setForm(prev => ({...prev, title: e.target.value}))} className={inputCls} placeholder="e.g. Levent Sky Residences" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.listingType || 'Listing Type'}</label>
                  <select value={form.listingType} onChange={e => setForm(prev => ({...prev, listingType: e.target.value}))} className={inputCls}>
                    <option value="Sale">{p.sale || 'Sale'}</option>
                    <option value="Rent">{p.rent || 'Rent'}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.price || 'Price (number)'}</label>
                  <input type="number" value={form.price} onChange={e => setForm(prev => ({...prev, price: e.target.value}))} className={inputCls} placeholder="1850000" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.priceLabel || 'Price Label (display)'}</label>
                  <input value={form.priceLabel} onChange={e => setForm(prev => ({...prev, priceLabel: e.target.value}))} className={inputCls} placeholder="$1,850,000" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.district || 'Istanbul District'}</label>
                  <input value={form.district} onChange={e => setForm(prev => ({...prev, district: e.target.value}))} className={inputCls} placeholder="e.g. Levent" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.address || 'Full Address'}</label>
                  <input value={form.address} onChange={e => setForm(prev => ({...prev, address: e.target.value}))} className={inputCls} placeholder="Street / Building" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.propertyType || 'Property Type'}</label>
                  <select value={form.propertyType} onChange={e => setForm(prev => ({...prev, propertyType: e.target.value}))} className={inputCls}>
                    {['Apartment','Villa','Penthouse','Duplex','Studio','Office','Commercial','Land'].map(tp => <option key={tp} value={tp}>{tp}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.beds || 'Bedrooms'}</label>
                  <input type="number" value={form.beds} onChange={e => setForm(prev => ({...prev, beds: e.target.value}))} className={inputCls} placeholder="3" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.baths || 'Bathrooms'}</label>
                  <input type="number" value={form.baths} onChange={e => setForm(prev => ({...prev, baths: e.target.value}))} className={inputCls} placeholder="2" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.area || 'Area (m²)'}</label>
                  <input type="number" value={form.sqm} onChange={e => setForm(prev => ({...prev, sqm: e.target.value}))} className={inputCls} placeholder="150" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.status || 'Status'}</label>
                  <select value={form.status} onChange={e => setForm(prev => ({...prev, status: e.target.value}))} className={inputCls}>
                    <option value="Available">{p.available || 'Available'}</option>
                    <option value="Sold">{p.sold || 'Sold'}</option>
                    <option value="Rented">{p.rented || 'Rented'}</option>
                    <option value="Pending">{p.pending || 'Pending'}</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.description || 'Description'}</label>
                  <textarea value={form.description} onChange={e => setForm(prev => ({...prev, description: e.target.value}))} rows={4} className={inputCls} placeholder="Property description..." />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.agentName || 'Agent Name'}</label>
                  <input value={form.agentName} onChange={e => setForm(prev => ({...prev, agentName: e.target.value}))} className={inputCls} placeholder="Selin Kaya" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.agentPhone || 'Agent Phone'}</label>
                  <input value={form.agentPhone} onChange={e => setForm(prev => ({...prev, agentPhone: e.target.value}))} className={inputCls} placeholder="+90 530 123 4567" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.agentEmail || 'Agent Email'}</label>
                  <input value={form.agentEmail} onChange={e => setForm(prev => ({...prev, agentEmail: e.target.value}))} className={inputCls} placeholder="agent@varlikent.com" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.whatsapp || 'WhatsApp Number'}</label>
                  <input value={form.whatsappNumber} onChange={e => setForm(prev => ({...prev, whatsappNumber: e.target.value}))} className={inputCls} placeholder="+905301234567" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="featured" checked={form.featured} onChange={e => setForm(prev => ({...prev, featured: e.target.checked}))} className="h-4 w-4 accent-[#4b6741]" />
                  <label htmlFor="featured" className="text-sm font-medium text-slate-700 cursor-pointer">{p.featured || 'Mark as Featured'}</label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.images || 'Property Images'}</label>
                  <span className="text-[10px] text-slate-400">JPG, PNG, WEBP, GIF — max 10 MB · MP4, MOV, WEBM — max 100 MB</span>
                </div>
                <div className="flex flex-wrap gap-3 mb-3">
                  {images.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img} alt="" className="h-20 w-28 rounded-xl object-cover border border-slate-200" />
                      <button type="button" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                        className="absolute -top-2 -right-2 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white cursor-pointer">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  <label className="flex h-20 w-28 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:border-[#4b6741] hover:text-[#4b6741] transition">
                    {uploading ? <span className="text-xs">{c.uploading || 'Uploading...'}</span> : <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>}
                    <input
  type="file"
  accept="image/*,video/*"
  multiple
  onChange={handleImage}
  className="hidden"
  disabled={uploading}
/>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="rounded-full bg-[#202a36] px-8 py-3 text-sm font-semibold text-white hover:bg-[#4b6741] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving...') : editingId ? (p.updateProperty || 'Update Property') : (p.saveProperty || 'Save Property')}
                </button>
                <button type="button" onClick={() => setFormOpen(false)} className="rounded-full border border-slate-200 px-8 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">{c.cancel || 'Cancel'}</button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {properties.map(prop => (
              <div key={prop._id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex gap-4">
                <img src={prop.mainImage || prop.images?.[0] || 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=200&q=60'} alt={prop.title} className="h-28 w-40 shrink-0 rounded-xl object-cover" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold text-[#202a36] truncate">{prop.title}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${prop.listingType === 'Rent' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{prop.listingType}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{prop.district} · {prop.propertyType}</p>
                  <p className="text-sm font-semibold text-[#d97706] mt-1">
  {formatPrice(prop.price, prop.listingType, prop.priceLabel)}
</p>
                  <p className="text-xs text-slate-400 mt-0.5">{prop.beds}bd · {prop.baths}ba · {prop.sqm}m²</p>
                  <div className="mt-3 flex gap-2">
                    {hasPermission('edit_listing') && (
                      <button onClick={() => openEdit(prop)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer">{c.edit || 'Edit'}</button>
                    )}
                    {hasPermission('delete_listing') && (
                      <button onClick={() => handleDelete(prop._id)} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 cursor-pointer">{c.delete || 'Delete'}</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminProperties
