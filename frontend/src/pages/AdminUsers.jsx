import { useState, useEffect, useMemo } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

const ALL_PERMISSIONS = [
  // Listings
  { key: 'add_listing',     group: 'Listings',         label: 'Add Listing' },
  { key: 'edit_listing',    group: 'Listings',         label: 'Edit Listing' },
  { key: 'delete_listing',  group: 'Listings',         label: 'Delete Listing' },
  { key: 'mark_featured',   group: 'Listings',         label: 'Mark Featured' },
  { key: 'manage_images',   group: 'Listings',         label: 'Manage Images' },
  // Sales & Rentals
  { key: 'manage_sales',    group: 'Sales & Rentals',  label: 'Manage Sales' },
  { key: 'manage_rentals',  group: 'Sales & Rentals',  label: 'Manage Rentals' },
  // Contacts & Leads
  { key: 'view_contacts',   group: 'Contacts & Leads', label: 'View Contacts' },
  { key: 'reply_contacts',  group: 'Contacts & Leads', label: 'Reply to Contacts' },
  // Content
  { key: 'manage_reviews',  group: 'Content',          label: 'Manage Reviews' },
  { key: 'manage_team',     group: 'Content',          label: 'Manage Team Members' },
  { key: 'manage_projects', group: 'Content',          label: 'Manage Projects' },
  { key: 'manage_showroom', group: 'Content',          label: 'Manage Showroom' },
  { key: 'manage_about',    group: 'Content',          label: 'Manage About Page' },
  // Users & Security
  { key: 'user_management', group: 'Users & Security', label: 'User Management' },
  { key: 'manage_passwords',group: 'Users & Security', label: 'Change User Passwords' },
]

const PERMISSION_GROUPS = [...new Set(ALL_PERMISSIONS.map(p => p.group))]

const roleBadgeCls = (role) => {
  if (role === 'owner') return 'bg-amber-100 text-amber-700'
  if (role === 'admin') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-600'
}

const ConfirmModal = ({ message, onConfirm, onCancel, danger = true }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center">
      <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
        <svg className={`h-6 w-6 ${danger ? 'text-red-500' : 'text-amber-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      <div className="mt-5 flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">Cancel</button>
        <button onClick={onConfirm} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition cursor-pointer ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#4b6741] hover:bg-[#3d5535]'}`}>Confirm</button>
      </div>
    </div>
  </div>
)

const emptyCreate = { name: '', email: '', password: '', role: 'admin', permissions: [] }

const AdminUsers = () => {
  const { isOwner, user: currentUser, hasPermission } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.users || {}
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [permModal, setPermModal] = useState(null)
  const [tempPerms, setTempPerms] = useState([])
  const [createModal, setCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [creating, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [pwModal, setPwModal] = useState(null)
  const [newPw, setNewPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  const canAccess = isOwner || hasPermission('user_management')
  const canChangePasswords = isOwner || hasPermission('manage_passwords')

  const load = () => {
    setLoading(true)
    api.get('/users').then(r => setUsers(r.data.users || [])).catch(() => setUsers([])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    return users.filter(u => {
      const matchSearch = !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
      const matchRole = roleFilter === 'all' || u.role === roleFilter
      return matchSearch && matchRole
    })
  }, [users, search, roleFilter])

  const adminsAndOwners = filtered.filter(u => u.role === 'admin' || u.role === 'owner')
  const regularUsers = filtered.filter(u => u.role === 'user')

  if (!canAccess) return (
    <AdminLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-semibold text-slate-700">{p.ownerOnly || 'Owner access required'}</p>
      </div>
    </AdminLayout>
  )

  const changeRole = async (userId, role) => {
    try {
      await api.put(`/users/${userId}/role`, { role })
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, role } : u))
      toast.success('Role updated')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed')
    }
  }

  const openPermissions = (u) => {
    setPermModal(u)
    setTempPerms([...u.permissions]) //save the permissions in a temp state so we can cancel changes if needed
  }

  const savePermissions = async () => {
    try {
      await api.put(`/users/${permModal._id}/permissions`, { permissions: tempPerms })
      setUsers(prev => prev.map(u => u._id === permModal._id ? { ...u, permissions: tempPerms } : u))
      toast.success('Permissions saved')
      setPermModal(null)
    } catch {
      toast.error('Failed to save permissions')
    }
  }

  const togglePerm = (perm) => setTempPerms(prev => prev.includes(perm) ? prev.filter(x => x !== perm) : [...prev, perm])

  const openChangePassword = (u) => { setPwModal(u); setNewPw('') }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return }
    setPwSaving(true)
    try {
      await api.put(`/users/${pwModal._id}/password`, { newPassword: newPw })
      toast.success(`Password updated for ${pwModal.name}`)
      setPwModal(null)
      setNewPw('')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update password')
    } finally {
      setPwSaving(false)
    }
  }

  const askDeactivate = (u) => {
    setConfirm({
      message: `Deactivate ${u.name}? They will no longer be able to log in.`,
      danger: true,
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.put(`/users/${u._id}/role`, { role: u.role, isActive: false })
          setUsers(prev => prev.map(x => x._id === u._id ? { ...x, isActive: false } : x))
          toast.success('User deactivated')
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed')
        }
      },
    })
  }

  const askDelete = (u) => {
    setConfirm({
      message: `Permanently delete ${u.name}? This cannot be undone.`,
      danger: true,
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.delete(`/users/${u._id}`)
          setUsers(prev => prev.filter(x => x._id !== u._id))
          toast.success('User permanently deleted')
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed')
        }
      },
    })
  }

  const askReactivate = (u) => {
    setConfirm({
      message: `Reactivate ${u.name}? They will be able to log in again.`,
      danger: false,
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.put(`/users/${u._id}/role`, { role: u.role, isActive: true })
          setUsers(prev => prev.map(x => x._id === u._id ? { ...x, isActive: true } : x))
          toast.success('User reactivated')
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed')
        }
      },
    })
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      toast.error('Name, email and password are required')
      return
    }
    setSaving(true)
    try {
      const res = await api.post('/auth/register', createForm)
      if (createForm.role !== 'user') {
        await api.put(`/users/${res.data.user._id}/role`, { role: createForm.role })
      }
      toast.success('Account created')
      setCreateModal(false)
      setCreateForm(emptyCreate)
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create account')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] bg-white'
  const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'

  const UserCard = ({ u }) => {
    const isSelf = u._id === currentUser?._id
    const isAnotherOwner = u.role === 'owner' && !isSelf
    const canEditThis = !isAnotherOwner && !isSelf
    return (
      <div className={`rounded-2xl border bg-white p-5 shadow-sm transition ${!u.isActive ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#202a36] text-sm font-bold text-white">
              {u.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <p className="font-semibold text-[#202a36]">
                {u.name} {isSelf && <span className="text-xs font-normal text-slate-400">({p.you || 'you'})</span>}
              </p>
              <p className="text-sm text-slate-500">{u.email}</p>
              <p className="text-xs text-slate-400 mt-0.5">{p.joined || 'Joined'} {new Date(u.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${roleBadgeCls(u.role)}`}>{u.role}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {u.isActive ? (p.active || 'Active') : (p.inactive || 'Inactive')}
            </span>

            {canEditThis && (
              <>
                {isOwner && (
                  <select
                    value={u.role}
                    onChange={e => changeRole(u._id, e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#4b6741]"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                )}

                {(isOwner || hasPermission('user_management')) && u.role === 'admin' && (
                  <button
                    onClick={() => openPermissions(u)}
                    className="rounded-full border border-[#4b6741] px-3 py-1.5 text-xs font-semibold text-[#4b6741] hover:bg-green-50 transition cursor-pointer"
                  >
                    {p.permissions || 'Permissions'}
                  </button>
                )}

                {canChangePasswords && (
                  <button
                    onClick={() => openChangePassword(u)}
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                  >
                    Change Password
                  </button>
                )}

                {isOwner && (
                  <>
                    {u.isActive ? (
                      <button onClick={() => askDeactivate(u)} className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 transition cursor-pointer">
                        {p.deactivate || 'Deactivate'}
                      </button>
                    ) : (
                      <button onClick={() => askReactivate(u)} className="rounded-full border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-600 hover:bg-green-50 transition cursor-pointer">
                        {p.reactivate || 'Reactivate'}
                      </button>
                    )}
                    <button onClick={() => askDelete(u)} className="rounded-full border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition cursor-pointer">
                      Delete
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {u.role === 'admin' && u.permissions?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-slate-100">
            {u.permissions.map(perm => (
              <span key={perm} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-600">{perm.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'User Management'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Manage accounts, roles, and permissions.'}</p>
          </div>
          {isOwner && (
            <button
              onClick={() => { setCreateForm(emptyCreate); setCreateModal(true) }}
              className="flex items-center gap-2 rounded-xl bg-[#4b6741] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {p.createAccount || 'Create Account'}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-52">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
              placeholder={p.search || 'Search by name or email...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741] cursor-pointer"
          >
            <option value="all">{p.allRoles || 'All Roles'}</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-8">
            {adminsAndOwners.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{p.adminsOwners || 'Admins & Owners'} ({adminsAndOwners.length})</h2>
                <div className="space-y-3">{adminsAndOwners.map(u => <UserCard key={u._id} u={u} />)}</div>
              </div>
            )}
            {regularUsers.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{p.regularUsers || 'Regular Users'} ({regularUsers.length})</h2>
                <div className="space-y-3">{regularUsers.map(u => <UserCard key={u._id} u={u} />)}</div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
                {p.noUsers || 'No users match your search.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Permissions Modal */}
      {permModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
              <div>
                <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36]">{p.permissions || 'Permissions'}</h2>
                <p className="text-sm text-slate-500">{permModal.name}</p>
              </div>
              <button onClick={() => setPermModal(null)} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-5">
              <p className="text-xs text-slate-500">{p.permissionsDesc || 'Select what this admin is allowed to do.'}</p>
              {PERMISSION_GROUPS.map(group => {
                const perms = ALL_PERMISSIONS.filter(p => p.group === group)
                return (
                  <div key={group}>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{group}</p>
                    <div className="space-y-2">
                      {perms.map(({ key, label }) => {
                        const grantable = isOwner || currentUser?.permissions?.includes(key)
                        return (
                          <label key={key} className={`flex items-center gap-3 ${grantable ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
                            <input
                              type="checkbox"
                              checked={tempPerms.includes(key)}
                              onChange={() => grantable && togglePerm(key)}
                              disabled={!grantable}
                              className="h-4 w-4 accent-[#4b6741]"
                            />
                            <span className="text-sm text-slate-700">{label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4 shrink-0">
              <button onClick={() => setPermModal(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">Cancel</button>
              <button onClick={savePermissions} className="flex-1 rounded-xl bg-[#202a36] py-2.5 text-sm font-semibold text-white hover:bg-[#4b6741] transition cursor-pointer">Save Permissions</button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {pwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-[#202a36]">Change Password</h2>
                <p className="text-sm text-slate-500">{pwModal.name}</p>
              </div>
              <button onClick={() => setPwModal(null)} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">New Password</label>
                <input
                  type="password"
                  className={inputCls}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setPwModal(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">Cancel</button>
                <button type="submit" disabled={pwSaving} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {pwSaving ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Account Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-[#202a36]">{p.createAccount || 'Create Account'}</h2>
              <button onClick={() => setCreateModal(false)} className="text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <div>
                <label className={labelCls}>{p.fullName || 'Full Name'}</label>
                <input className={inputCls} value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
              </div>
              <div>
                <label className={labelCls}>{p.email || 'Email'}</label>
                <input type="email" className={inputCls} value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@example.com" />
              </div>
              <div>
                <label className={labelCls}>{p.password || 'Password'}</label>
                <input type="password" className={inputCls} value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" />
              </div>
              <div>
                <label className={labelCls}>{p.role || 'Role'}</label>
                <select className={inputCls} value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setCreateModal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer">Cancel</button>
                <button type="submit" disabled={creating} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] transition disabled:opacity-60 cursor-pointer">
                  {creating ? (p.creating || 'Creating...') : (p.createAccount || 'Create Account')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirm && <ConfirmModal message={confirm.message} danger={confirm.danger} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
    </AdminLayout>
  )
}

export default AdminUsers
