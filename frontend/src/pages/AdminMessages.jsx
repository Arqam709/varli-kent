import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

const AdminMessages = () => {
  const { hasPermission } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.messages || {}
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    api.get('/contact')
      .then(r => setMessages(r.data.submissions || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false))
  }, [])

  const deleteMessage = async (id) => {
    if (!confirm('Delete this message permanently?')) return
    try {
      await api.delete(`/contact/${id}`)
      setMessages(prev => prev.filter(m => m._id !== id))
      toast.success('Message deleted')
    } catch {
      toast.error('Failed to delete message')
    }
  }

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/contact/${id}/status`, { status })
      setMessages(prev => prev.map(m => m._id === id ? { ...m, status } : m))
      toast.success(`Marked as ${status}`)
    } catch {
      toast.error('Failed to update status')
    }
  }

  const filterLabels = {
    All: p.all || 'All',
    New: p.new || 'New',
    Replied: p.replied || 'Replied',
    Archived: p.archived || 'Archived',
  }

  const filtered = filter === 'All' ? messages : messages.filter(m => m.status === filter)

  if (!hasPermission('view_contacts')) return (
    <AdminLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        <p className="mt-4 text-lg font-semibold text-slate-700">{p.noAccess || 'No access'}</p>
        <p className="mt-2 text-sm text-slate-500">{p.noAccessDesc || 'You need the "view_contacts" permission to see submissions.'}</p>
      </div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Lead Inbox'}</h1>
          <p className="mt-1 text-sm text-slate-500">{messages.filter(m => m.status === 'New').length} {p.newMessages || 'new messages'}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {['All', 'New', 'Replied', 'Archived'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition cursor-pointer ${filter === s ? 'bg-[#202a36] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >{filterLabels[s]} {s === 'All' ? `(${messages.length})` : `(${messages.filter(m => m.status === s).length})`}</button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">{p.noMessages || 'No messages found.'}</p>
        ) : (
          <div className="space-y-4">
            {filtered.map(msg => (
              <div key={msg._id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-[#202a36]">{msg.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        {msg.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        {msg.phone}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium">{msg.interestType}</span>
                      {msg.source === 'ai_assistant' && (
                        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">🤖 AI Assistant</span>
                      )}
                      <span className="text-xs text-slate-400">{new Date(msg.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${msg.status === 'New' ? 'bg-amber-100 text-amber-700' : msg.status === 'Replied' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-700'}`}>
                    {msg.status}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">{msg.message}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a href={`mailto:${msg.email}?subject=Re: Your Varlikent Inquiry`} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">{p.replyByEmail || 'Reply by Email'}</a>
                  {msg.phone && <a href={`tel:${msg.phone}`} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">{p.call || 'Call'}</a>}
                  {hasPermission('reply_contacts') && msg.status === 'New' && (
                    <button onClick={() => updateStatus(msg._id, 'Replied')} className="rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d5535] cursor-pointer">{p.markReplied || 'Mark Replied'}</button>
                  )}
                  {msg.status !== 'Archived' && (
                    <button onClick={() => updateStatus(msg._id, 'Archived')} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">{p.archive || 'Archive'}</button>
                  )}
                  {hasPermission('reply_contacts') && (
                    <button onClick={() => deleteMessage(msg._id)} className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer">Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminMessages
