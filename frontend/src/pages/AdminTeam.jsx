import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useLanguage } from '../contexts/LanguageContext'

const empty = { name: '', role: '', bio: '', photo: '', order: 0, visible: true }

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

const AdminTeam = () => {
  const { t } = useLanguage()
  const p = t.adminPages?.team || {}
  const c = t.adminPages?.common || {}
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/team/all')
      .then(r => setMembers(r.data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm(empty); setModal('create') }
  const openEdit = (m) => { setForm({ name: m.name, role: m.role, bio: m.bio || '', photo: m.photo || '', order: m.order ?? 0, visible: m.visible ?? true }); setModal(m) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.role.trim()) { toast.error('Name and role are required'); return }
    setSaving(true)
    try {
      if (modal === 'create') {
        const r = await api.post('/team', form)
        setMembers(prev => [...prev, r.data.member])
        toast.success('Member added')
      } else {
        const r = await api.put(`/team/${modal._id}`, form)
        setMembers(prev => prev.map(m => m._id === modal._id ? r.data.member : m))
        toast.success('Member updated')
      }
      setModal(null)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const askDelete = (m) => {
    setConfirm({
      message: `Delete ${m.name} from the team? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.delete(`/team/${m._id}`)
          setMembers(prev => prev.filter(x => x._id !== m._id))
          toast.success('Member deleted')
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed')
        }
      },
    })
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
  const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Team Members'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Manage the people shown on the Our Team page.'}</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            {p.addMember || 'Add Member'}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : members.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
            {p.empty || 'No team members yet. Add your first member.'}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map(m => (
              <div key={m._id} className={`rounded-2xl border bg-white p-5 shadow-sm flex gap-4 ${!m.visible ? 'opacity-60' : ''}`}>
                <div className="shrink-0">
                  {m.photo ? (
                    <img src={m.photo} alt={m.name} className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#202a36] text-lg font-bold text-white" style={{ fontFamily: 'Cinzel, serif' }}>
                      {m.name?.[0]?.toUpperCase() || 'V'}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#202a36] truncate">{m.name}</p>
                  <p className="text-xs text-[#4b6741] font-medium uppercase tracking-wide mt-0.5">{m.role}</p>
                  {m.bio && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{m.bio}</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.visible ? 'bg-green-100 text-green-700' : 'bg-slate-700 text-white'}`}>
                      {m.visible ? (c.visible || 'Visible') : (c.hidden || 'Hidden')}
                    </span>
                    <button onClick={() => openEdit(m)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                      {c.edit || 'Edit'}
                    </button>
                    <button onClick={() => askDelete(m)} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 transition cursor-pointer">
                      {c.delete || 'Delete'}
                    </button>
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
                {modal === 'create' ? (p.addMemberTitle || 'Add Team Member') : (p.editMemberTitle || 'Edit Member')}
              </h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className={labelCls}>{p.fullName || 'Full Name'}</label>
                <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ahmet Yilmaz" />
              </div>
              <div>
                <label className={labelCls}>{p.roleTitle || 'Title / Role'}</label>
                <input className={inputCls} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Senior Architect" />
              </div>
              <div>
                <label className={labelCls}>{p.bio || 'Bio'}</label>
                <textarea rows={3} className={inputCls} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} placeholder="Short biography..." />
              </div>
              <div>
                <label className={labelCls}>{p.photoUrl || 'Photo URL'}</label>
                <input className={inputCls} value={form.photo} onChange={e => setForm(f => ({ ...f, photo: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{c.order || 'Display Order'}</label>
                  <input type="number" className={inputCls} value={form.order} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
                </div>
                <div className="flex flex-col">
                  <label className={labelCls}>{c.visible || 'Visible'}</label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-[#4b6741]" checked={form.visible} onChange={e => setForm(f => ({ ...f, visible: e.target.checked }))} />
                    <span className="text-sm text-slate-600">{p.showOnPage || 'Show on team page'}</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                  {c.cancel || 'Cancel'}
                </button>
                <button type="submit" disabled={saving} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving...') : modal === 'create' ? (p.addMemberBtn || 'Add Member') : (p.saveChanges || 'Save Changes')}
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

export default AdminTeam
