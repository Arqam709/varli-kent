import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import { useLanguage } from '../contexts/LanguageContext'

const AdminSiteSettings = () => {
  const { isOwner } = useAuth()
  const { setSettings } = useSiteSettings()
  const { t } = useLanguage()
  const p = t.adminPages?.settings || {}
  const [form, setForm] = useState({
    email: '', phone: '', whatsapp: '', address: '', mapsUrl: '', instagram: '', linkedin: '',
    showroomEnabled: { architecture: true, interior: true, construction: true, renovation: true },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/settings')
      .then(r => { if (r.data.settings) setForm(r.data.settings) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await api.put('/settings', form)
      setSettings(r.data.settings)
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
  const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

  if (!isOwner) return (
    <AdminLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-semibold text-slate-700">{p.ownerOnly || 'Owner access required'}</p>
      </div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
      <div className="max-w-2xl space-y-8">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Site Settings'}</h1>
          <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Contact info and social links shown on all pages.'}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-sm font-semibold text-[#202a36] uppercase tracking-widest">{p.contactInfo || 'Contact Information'}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{p.email || 'Email'}</label>
                  <input className={inputCls} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>{p.phone || 'Phone'}</label>
                  <input className={inputCls} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>{p.whatsapp || 'WhatsApp Number (digits only)'}</label>
                  <input className={inputCls} value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="905301234567" />
                </div>
              </div>
              <div>
                <label className={labelCls}>{p.address || 'Address'}</label>
                <textarea rows={2} className={inputCls} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>{p.mapsUrl || 'Google Maps URL'}</label>
                <input className={inputCls} value={form.mapsUrl} onChange={e => setForm(f => ({ ...f, mapsUrl: e.target.value }))} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-sm font-semibold text-[#202a36] uppercase tracking-widest">{p.socialLinks || 'Social Links'}</h2>
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>{p.instagram || 'Instagram URL'}</label>
                  <input className={inputCls} value={form.instagram} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} placeholder="https://instagram.com/..." />
                </div>
                <div>
                  <label className={labelCls}>{p.linkedin || 'LinkedIn URL'}</label>
                  <input className={inputCls} value={form.linkedin} onChange={e => setForm(f => ({ ...f, linkedin: e.target.value }))} placeholder="https://linkedin.com/..." />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-sm font-semibold text-[#202a36] uppercase tracking-widest">{p.showroomSections || 'Showroom Sections'}</h2>
              <p className="text-xs text-slate-500">{p.showroomSectionsHint || 'Toggle showroom visibility on each service page.'}</p>
              <div className="space-y-3">
                {['architecture', 'interior', 'construction', 'renovation'].map(s => (
                  <label key={s} className="flex items-center justify-between cursor-pointer py-2 border-b border-slate-100 last:border-0">
                    <span className="text-sm font-medium text-slate-700 capitalize">{s}</span>
                    <div className="relative">
                      <input type="checkbox" className="sr-only peer"
                        checked={form.showroomEnabled?.[s] ?? true}
                        onChange={e => setForm(f => ({ ...f, showroomEnabled: { ...f.showroomEnabled, [s]: e.target.checked } }))} />
                      <div className="w-11 h-6 bg-slate-200 rounded-full peer-checked:bg-[#4b6741] transition-colors cursor-pointer" />
                      <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" disabled={saving}
              className="rounded-xl bg-[#4b6741] px-8 py-3 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
              {saving ? (p.saving || 'Saving...') : (p.saveSettings || 'Save Settings')}
            </button>
          </form>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminSiteSettings
