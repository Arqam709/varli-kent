import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import api from '../lib/api'

const Section = ({ title, description, children }) => (
  <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--t-surface)', borderColor: 'var(--t-border)', boxShadow: 'var(--t-shadow)' }}>
    <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--t-border)' }}>
      <h2 className="text-base font-semibold" style={{ color: 'var(--t-text)' }}>{title}</h2>
      {description && <p className="mt-0.5 text-sm" style={{ color: 'var(--t-muted)' }}>{description}</p>}
    </div>
    <div className="px-6 py-6">{children}</div>
  </div>
)

const Field = ({ label, children }) => (
  <div>
    <label className="block mb-1.5 text-sm font-medium" style={{ color: 'var(--t-text)' }}>{label}</label>
    {children}
  </div>
)

const Input = (props) => (
  <input
    {...props}
    className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition"
    style={{
      background: 'var(--t-input-bg)',
      border: '1px solid var(--t-input-border)',
      color: 'var(--t-text)',
      '--tw-ring-color': 'var(--t-accent)',
    }}
  />
)

const PrimaryBtn = ({ loading, children, ...props }) => (
  <button
    {...props}
    disabled={loading || props.disabled}
    className="rounded-full px-6 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60 cursor-pointer theme-btn-accent"
    style={{ background: 'var(--t-accent)' }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--t-accent-h)'}
    onMouseLeave={e => e.currentTarget.style.background = 'var(--t-accent)'}
  >
    {loading ? 'Saving...' : children}
  </button>
)

const SecondaryBtn = ({ children, ...props }) => (
  <button
    {...props}
    className="rounded-full px-6 py-2.5 text-sm font-semibold transition cursor-pointer border"
    style={{ borderColor: 'var(--t-border)', color: 'var(--t-text)', background: 'transparent' }}
  >
    {children}
  </button>
)

const SettingsPage = () => {
  const { user, updateUser, logout } = useAuth()
  const { theme, setTheme, themes } = useTheme()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' })
  const [profileLoading, setProfileLoading] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwLoading, setPwLoading] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteWord, setDeleteWord] = useState('')

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return }
    setAvatarLoading(true)
    try {
      const form = new FormData()
      form.append('avatar', file)
      const res = await api.put('/users/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      updateUser(res.data.user)
      toast.success('Profile picture updated')
    } catch {
      toast.error('Failed to upload image')
    } finally {
      setAvatarLoading(false)
    }
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    if (!profile.name.trim()) { toast.error('Name cannot be empty'); return }
    setProfileLoading(true)
    try {
      const res = await api.put('/users/me/profile', { name: profile.name, email: profile.email })
      updateUser(res.data.user)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile')
    } finally {
      setProfileLoading(false)
    }
  }

  const handlePasswordSave = async (e) => {
    e.preventDefault()
    if (!pw.currentPassword || !pw.newPassword || !pw.confirmPassword) { toast.error('Please fill in all password fields'); return }
    if (pw.newPassword !== pw.confirmPassword) { toast.error('New passwords do not match'); return }
    if (pw.newPassword.length < 6) { toast.error('New password must be at least 6 characters'); return }
    setPwLoading(true)
    try {
      await api.put('/users/me/password', pw)
      toast.success('Password changed successfully')
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password')
    } finally {
      setPwLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/')
    toast.success('Signed out')
  }

  const roleLabel = user?.role === 'owner' ? 'Owner' : user?.role === 'admin' ? 'Admin' : 'Member'
  const roleColor = user?.role === 'owner'
    ? { background: '#fef3c7', color: '#92400e' }
    : user?.role === 'admin'
    ? { background: '#dbeafe', color: '#1e40af' }
    : { background: '#d1fae5', color: '#065f46' }

  return (
    <div className="min-h-screen" style={{ background: 'var(--t-bg)' }}>
      {/* Top bar */}
      <div className="border-b sticky top-0 z-30" style={{ background: 'var(--t-surface)', borderColor: 'var(--t-border)' }}>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-1.5 text-xs transition cursor-pointer" style={{ color: 'var(--t-muted)' }}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Home
            </Link>
            <span style={{ color: 'var(--t-border)' }}>|</span>
            <span style={{ fontFamily: 'Cinzel, serif', color: 'var(--t-text)' }} className="text-sm font-bold">
              VARLI<span style={{ color: 'var(--t-accent)' }}>KENT</span>
            </span>
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--t-muted)' }}>Account Settings</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Profile hero card */}
        <div className="rounded-2xl px-6 py-5 flex items-center gap-4" style={{ background: 'var(--vk-section-dark)', boxShadow: 'var(--vk-shadow)' }}>
          <div className="relative shrink-0">
            {user?.avatar ? (
              <img src={user.avatar} alt="Avatar" className="h-16 w-16 rounded-full object-cover ring-2" style={{ ringColor: 'var(--t-accent)' }} />
            ) : (
              <div className="h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white" style={{ background: 'var(--t-accent)' }}>
                {user?.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarLoading}
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full flex items-center justify-center text-white cursor-pointer transition"
              style={{ background: 'var(--t-accent)' }}
              title="Change photo"
            >
              {avatarLoading
                ? <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                : <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              }
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-base text-white truncate">{user?.name}</p>
            <p className="text-sm truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>{user?.email}</p>
          </div>
          <span className="ml-auto shrink-0 text-xs font-semibold px-3 py-1 rounded-full" style={roleColor}>
            {roleLabel}
          </span>
        </div>

        {/* Theme picker */}
        <Section title="Appearance" description="Choose a theme for your Varlikent experience.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {themes.map(th => {
              const active = theme === th.id
              return (
                <button
                  key={th.id}
                  onClick={() => setTheme(th.id)}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition cursor-pointer"
                  style={{
                    border: active ? '2px solid var(--t-accent)' : '2px solid var(--t-border)',
                    background: active ? 'rgba(var(--vk-green-rgb, 77,107,69), 0.08)' : 'var(--t-input-bg)',
                  }}
                >
                  {/* Swatch: three-stripe preview */}
                  <div className="shrink-0 h-11 w-11 rounded-lg overflow-hidden" style={{ border: '1px solid var(--t-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                    <div style={{ height: '55%', background: th.preview.dark }} />
                    <div style={{ height: '20%', background: th.preview.accent }} />
                    <div style={{ height: '25%', background: th.preview.light }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--t-text)' }}>{th.label}</p>
                    <p className="text-xs leading-snug mt-0.5" style={{ color: 'var(--t-muted)' }}>{th.description}</p>
                  </div>
                  {active && (
                    <svg className="ml-auto shrink-0 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--t-accent)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </Section>

        {/* Profile info */}
        <Section title="Profile Information" description="Update your display name and email address.">
          <form onSubmit={handleProfileSave} className="space-y-4">
            <Field label="Full Name">
              <Input type="text" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} placeholder="Your full name" required />
            </Field>
            <Field label="Email Address">
              <Input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} placeholder="you@example.com" required />
            </Field>
            <div className="flex justify-end pt-1">
              <PrimaryBtn type="submit" loading={profileLoading}>Save Changes</PrimaryBtn>
            </div>
          </form>
        </Section>

        {/* Change password */}
        <Section title="Change Password" description="Enter your current password, then choose a new one.">
          <form onSubmit={handlePasswordSave} className="space-y-4">
            <Field label="Current Password">
              <Input type="password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} placeholder="••••••••" required />
            </Field>
            <Field label="New Password">
              <Input type="password" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} placeholder="Min. 6 characters" required />
            </Field>
            <Field label="Confirm New Password">
              <Input type="password" value={pw.confirmPassword} onChange={e => setPw(p => ({ ...p, confirmPassword: e.target.value }))} placeholder="Repeat new password" required />
            </Field>
            <div className="flex justify-end pt-1">
              <PrimaryBtn type="submit" loading={pwLoading}>Update Password</PrimaryBtn>
            </div>
          </form>
        </Section>

        {/* Account info */}
        <Section title="Account Details" description="Read-only information about your account.">
          <div className="space-y-0">
            {[
              { label: 'Account ID', value: user?._id },
              { label: 'Role', value: roleLabel },
              { label: 'Member since', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A' },
              { label: 'Status', value: user?.isActive === false ? 'Suspended' : 'Active' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-3 border-b last:border-0" style={{ borderColor: 'var(--t-border)' }}>
                <span className="text-sm" style={{ color: 'var(--t-muted)' }}>{label}</span>
                <span className="text-sm font-medium font-mono truncate max-w-[200px]" style={{ color: 'var(--t-text)' }}>{value}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick links */}
        <Section title="Quick Links">
          <div className="grid grid-cols-2 gap-3">
            {[
              { to: '/properties', label: 'Browse Properties', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
              { to: '/favourites', label: 'My Favourites', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
              { to: '/contact', label: 'Contact Us', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
              ...(user?.role === 'admin' || user?.role === 'owner' ? [{ to: '/admin/dashboard', label: 'Admin Panel', icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7' }] : []),
            ].map(({ to, label, icon }) => (
              <Link key={to} to={to} className="flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium transition cursor-pointer" style={{ borderColor: 'var(--t-border)', color: 'var(--t-text)', background: 'var(--t-input-bg)' }}>
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--t-accent)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                </svg>
                {label}
              </Link>
            ))}
          </div>
        </Section>

        {/* Sign out */}
        <Section title="Session">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--t-text)' }}>Sign out</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--t-muted)' }}>You'll need to log in again to access your account.</p>
            </div>
            <SecondaryBtn onClick={handleLogout} type="button">Sign Out</SecondaryBtn>
          </div>
        </Section>

        {/* Danger zone */}
        <div className="rounded-2xl border overflow-hidden" style={{ background: '#fff1f2', borderColor: '#fecdd3' }}>
          <div className="px-6 py-5 border-b" style={{ borderColor: '#fecdd3' }}>
            <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
            <p className="mt-0.5 text-sm text-red-400">Irreversible actions. Proceed with caution.</p>
          </div>
          <div className="px-6 py-6">
            {!showDeleteConfirm ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--t-text)' }}>Delete account</p>
                  <p className="text-xs mt-0.5 text-red-400">Permanently remove your account and all data.</p>
                </div>
                <button onClick={() => setShowDeleteConfirm(true)} className="rounded-full px-5 py-2 text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-100 transition cursor-pointer">
                  Delete Account
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm" style={{ color: 'var(--t-text)' }}>
                  Type <strong>DELETE</strong> to confirm. This cannot be undone.
                </p>
                <input
                  type="text"
                  value={deleteWord}
                  onChange={e => setDeleteWord(e.target.value)}
                  placeholder='Type "DELETE" to confirm'
                  className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none"
                  style={{ borderColor: '#fca5a5', background: '#fff' }}
                />
                <div className="flex gap-3">
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteWord('') }} className="rounded-full px-5 py-2 text-sm font-medium border border-red-200 text-red-500 hover:bg-red-50 transition cursor-pointer">Cancel</button>
                  <button disabled={deleteWord !== 'DELETE'} onClick={() => toast.info('Account deletion requires support — contact info@varlikent.com')} className="rounded-full px-5 py-2 text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40 cursor-pointer">
                    Permanently Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs pb-4" style={{ color: 'var(--t-muted)' }}>
          Varlikent · Istanbul Luxury Real Estate ·{' '}
          <Link to="/" className="hover:underline" style={{ color: 'var(--t-accent)' }}>Back to Home</Link>
        </p>
      </div>
    </div>
  )
}

export default SettingsPage
