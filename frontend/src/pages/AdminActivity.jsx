import { useState, useEffect, useCallback } from 'react'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

const METHOD_COLOR = {
  POST: { dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  PUT: { dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50' },
  PATCH: { dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50' },
  DELETE: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
}

const roleBadgeCls = (role) => role === 'owner' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'

const timeAgo = (iso, a) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return a.justNow || 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}${a.minutesAgo || 'm ago'}`
  if (diff < 86400) return `${Math.floor(diff / 3600)}${a.hoursAgo || 'h ago'}`
  return new Date(iso).toLocaleString()
}

const resourceLabel = (resource, a) => {
  const map = {
    properties: a.resource?.properties || 'a property', partners: a.resource?.partners || 'a partner',
    showroom: a.resource?.showroom || 'a showroom item', team: a.resource?.team || 'a team member',
    reviews: a.resource?.reviews || 'a review', projects: a.resource?.projects || 'a project',
    about: a.resource?.about || 'the About page', 'page-content': a.resource?.pageContent || 'page content',
    users: a.resource?.users || 'a user account', contact: a.resource?.contact || 'a lead',
    settings: a.resource?.settings || 'site settings', 'lead-routing': a.resource?.leadRouting || 'lead routing',
  }
  return map[resource] || resource.replace(/-/g, ' ')
}

const AdminActivity = () => {
  const { isOwner } = useAuth()
  const { t } = useLanguage()
  const a = t.adminPages?.activity || {}
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const load = useCallback(() => {
    api.get('/activity?limit=150').then(r => setLogs(r.data.logs || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  if (!isOwner) return (
    <AdminLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-semibold text-slate-700">{a.ownerOnly || 'Owner access required'}</p>
      </div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{a.title || 'Admin Activity'}</h1>
            <p className="mt-1 text-sm text-slate-500">{a.subtitle || 'Every change any admin or owner makes to the site, newest first.'}</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-[#4b6741]" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              {t.adminPages?.common?.autoRefresh || 'Auto-refresh'}
            </label>
            <button onClick={load} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer">
              {t.adminPages?.common?.refresh || 'Refresh'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : logs.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
            {a.empty || 'No activity recorded yet. Actions will start appearing here as admins and owners make changes.'}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            {logs.map(log => {
              const color = METHOD_COLOR[log.method] || { dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-50' }
              return (
                <div key={log._id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50/60 transition">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#202a36] text-xs font-bold text-white mt-0.5">
                    {log.actorName?.[0]?.toUpperCase() || 'A'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#202a36] leading-relaxed">
                      <span className="font-semibold">{log.actorName}</span>{' '}
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold align-middle ${roleBadgeCls(log.actorRole)}`}>{log.actorRole}</span>{' '}
                      <span className="text-slate-500">{log.action}</span>{' '}
                      <span className="font-medium">{resourceLabel(log.resource, a)}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${color.bg} ${color.text}`}>{log.method}</span>
                      <span className="font-mono">{log.path}</span>
                      <span>·</span>
                      <span>{timeAgo(log.createdAt, a)}</span>
                    </p>
                  </div>
                  <span className={`h-2 w-2 rounded-full shrink-0 mt-2 ${color.dot}`} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminActivity
