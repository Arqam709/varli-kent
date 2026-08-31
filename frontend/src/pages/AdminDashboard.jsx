import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

/*
 * Wave 14C — the donor's Showroom Media card.
 *
 * Donor semantics, kept exactly: every record across all four services,
 * hidden ones included (that is what `/showroom/:service/all` returns), split
 * into images and videos by URL. The number answers "how much media have we
 * uploaded", not "how much is live".
 *
 * `isVideoUrl` is the same predicate ShowroomCarousel uses to decide whether
 * to render a <video>. It is duplicated here rather than exported from that
 * component — the Wave 14B carousel is not being touched — and a contract
 * test asserts the two stay identical.
 */
const SHOWROOM_SERVICES = ['architecture', 'interior', 'construction', 'renovation']
const isVideoUrl = (url) => Boolean(url) && (url.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(url))

const StatCard = ({ label, value, color = '#202a36' }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <p className="text-xs uppercase tracking-widest text-slate-500">{label}</p>
    <p style={{ fontFamily: 'Cinzel, serif', color }} className="mt-3 text-4xl font-bold">{value ?? '—'}</p>
  </div>
)

const AdminDashboard = () => {
  const navigate = useNavigate()
  const { user, isOwner, hasPermission } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.dashboard || {}
  const [stats, setStats] = useState({ total: 0, sale: 0, rent: 0, leads: 0, newLeads: 0 })
  const [recentLeads, setRecentLeads] = useState([])
  const [loading, setLoading] = useState(true)
  // null until the four requests resolve, so the card appears with a real
  // number rather than flashing 0. A failed service contributes 0 and the
  // rest of the card still renders.
  const [showroomStats, setShowroomStats] = useState(null)

  useEffect(() => {
    const fetches = [
      api.get('/properties').catch(() => ({ data: { count: 0 } })),
      api.get('/properties/sale').catch(() => ({ data: { count: 0 } })),
      api.get('/properties/rent').catch(() => ({ data: { count: 0 } })),
    ]
    if (hasPermission('view_contacts')) {
      fetches.push(api.get('/contact').catch(() => ({ data: { submissions: [] } })))
    }
    Promise.all(fetches).then(([all, sale, rent, contacts]) => {
      const subs = contacts?.data?.submissions || []
      setStats({
        total: all.data.count || 0,
        sale: sale.data.count || 0,
        rent: rent.data.count || 0,
        leads: subs.length,
        newLeads: subs.filter(s => s.status === 'New').length,
      })
      setRecentLeads(subs.slice(0, 4))
    }).finally(() => setLoading(false))

    // Gated the way every other admin surface is: someone without
    // manage_showroom would get four 403s and an empty card, so they are not
    // requested at all. Separate from the Promise.all above so a slow showroom
    // response never delays the property stats.
    if (!hasPermission('manage_showroom')) return

    Promise.all(SHOWROOM_SERVICES.map(s => api.get(`/showroom/${s}/all`).catch(() => ({ data: { images: [] } }))))
      .then(results => {
        const all = results.flatMap(r => r.data.images || [])
        setShowroomStats({
          images: all.filter(m => !isVideoUrl(m.url)).length,
          videos: all.filter(m => isVideoUrl(m.url)).length,
        })
      })
      .catch(() => {})
  }, [])

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Dashboard'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {p.signedIn || 'Signed in as'} <span className="font-semibold capitalize">{user?.role}</span> — {user?.email}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={p.totalProperties || 'Total Properties'} value={stats.total} />
          <StatCard label={p.forSale || 'For Sale'} value={stats.sale} color="#4b6741" />
          <StatCard label={p.forRent || 'For Rent'} value={stats.rent} color="#4b6741" />
          {hasPermission('view_contacts') ? (
            <StatCard label={`${p.leads || 'Leads'} (${stats.newLeads} ${p.new || 'New'})`} value={stats.leads} color="#d97706" />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 flex items-center justify-center text-sm text-slate-400">{p.noContactsAccess || 'No contacts access'}</div>
          )}
        </div>

        {showroomStats && (
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: '#7c3aed' }} />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{p.showroomMedia || 'Showroom Media'}</p>
                <p className="mt-0.5 text-xs text-slate-400">{p.showroomMediaHint || 'Across Architecture, Interior, Construction & Renovation'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-5">
                <span className="flex items-center gap-2 text-sm font-semibold text-[#202a36]">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> {showroomStats.images} {p.imagesLabel || 'images'}
                </span>
                <span className="flex items-center gap-2 text-sm font-semibold text-[#202a36]">
                  <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> {showroomStats.videos} {p.videosLabel || 'videos'}
                </span>
                <button onClick={() => navigate('/admin/showroom')} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
                  {p.viewAll || 'View All'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
          {hasPermission('view_contacts') && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36]">{p.recentLeads || 'Recent Leads'}</h2>
                <button onClick={() => navigate('/admin/messages')} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">{p.viewAll || 'View All'}</button>
              </div>
              {recentLeads.length === 0 ? (
                <p className="text-sm text-slate-400">{p.noLeads || 'No leads yet.'}</p>
              ) : (
                <div className="space-y-4">
                  {recentLeads.map(msg => (
                    <div key={msg._id} className="flex items-start justify-between rounded-xl bg-slate-50 p-4 gap-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#202a36] truncate">{msg.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{msg.interestType} — {msg.email}</p>
                        <p className="text-sm text-slate-600 mt-1 line-clamp-1">{msg.message}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${msg.status === 'New' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{msg.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36] mb-6">{p.quickActions || 'Quick Actions'}</h2>
            <div className="space-y-3">
              {hasPermission('add_listing') && (
                <button onClick={() => navigate('/admin/properties')} className="w-full rounded-full bg-[#202a36] py-3 text-sm font-semibold text-white hover:bg-[#4b6741] transition cursor-pointer">{p.addProperty || '+ Add Property'}</button>
              )}
              <button onClick={() => navigate('/admin/properties')} className="w-full rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer">{p.manageProperties || 'Manage Properties'}</button>
              {hasPermission('view_contacts') && (
                <button onClick={() => navigate('/admin/messages')} className="w-full rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer">{p.reviewLeads || 'Review Leads'}</button>
              )}
              {isOwner && (
                <button onClick={() => navigate('/admin/users')} className="w-full rounded-full border border-[#4b6741] py-3 text-sm font-semibold text-[#4b6741] hover:bg-green-50 transition cursor-pointer">{p.manageUsers || 'Manage Users & Permissions'}</button>
              )}
            </div>

            {!isOwner && (
              <div className="mt-6 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">
                <p className="font-semibold text-slate-600 mb-1">{p.yourPermissions || 'Your permissions'}</p>
                {user?.permissions?.length > 0
                  ? user.permissions.map(perm => <span key={perm} className="mr-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs">{perm.replace('_', ' ')}</span>)
                  : (p.noPermissions || 'No custom permissions assigned.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminDashboard
