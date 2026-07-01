import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

const ALL_TYPES = ['Buying', 'Selling', 'Renting', 'Renovation', 'Interior Design', 'Architecture', 'General']

const TYPE_ICONS = {
  Buying: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  Selling: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Renting: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
  Renovation: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" /></svg>,
  'Interior Design': <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>,
  Architecture: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  General: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>,
}

const emptyRecipient = { email: '', label: '' }

const AdminLeadRouting = () => {
  const { isOwner } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.leadRouting || {}
  const [routing, setRouting] = useState(ALL_TYPES.map(t => ({ interestType: t, recipients: [] })))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    api.get('/lead-routing')
      .then(r => {
        if (r.data.routing) setRouting(r.data.routing)
      })
      .catch(() => toast.error('Failed to load routing config'))
      .finally(() => setLoading(false))
  }, [])

  const addRecipient = (type) => {
    setRouting(prev => prev.map(r =>
      r.interestType === type ? { ...r, recipients: [...r.recipients, { ...emptyRecipient }] } : r
    ))
  }

  const removeRecipient = (type, idx) => {
    setRouting(prev => prev.map(r =>
      r.interestType === type ? { ...r, recipients: r.recipients.filter((_, i) => i !== idx) } : r
    ))
  }

  const updateRecipient = (type, idx, field, value) => {
    setRouting(prev => prev.map(r =>
      r.interestType === type
        ? { ...r, recipients: r.recipients.map((rec, i) => i === idx ? { ...rec, [field]: value } : rec) }
        : r
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/lead-routing', { routing })
      toast.success('Lead routing saved')
    } catch {
      toast.error('Failed to save routing config')
    } finally {
      setSaving(false)
    }
  }

  if (!isOwner) return (
    <AdminLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        <p className="mt-4 text-lg font-semibold text-slate-700">{p.ownerOnly || 'Owner access only'}</p>
        <p className="mt-2 text-sm text-slate-500">{p.ownerOnlyDesc || 'Only the site owner can configure lead routing.'}</p>
      </div>
    </AdminLayout>
  )

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]'

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Lead Routing'}</h1>
            <p className="mt-1 text-sm text-slate-500">{p.subtitle || 'Configure which team members receive leads for each inquiry type'}</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-[#202a36] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4b6741] transition disabled:opacity-60 cursor-pointer"
          >
            {saving ? (p.saving || 'Saving...') : (p.saveAll || 'Save All')}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-[#f9f9f7] p-4 text-sm text-slate-600 leading-relaxed">
          <strong className="text-[#202a36]">{p.howItWorks || 'How it works'}:</strong> {p.howItWorksDesc || 'When a lead comes in via the Contact form, the system sends an email notification to the owner and any recipients configured below for that inquiry type. Add a label (e.g. "Sales Agent") to help identify each recipient.'}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : (
          <div className="space-y-3">
            {routing.map(({ interestType, recipients }) => {
              const isOpen = expanded === interestType
              return (
                <div key={interestType} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : interestType)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[#4b6741]">{TYPE_ICONS[interestType]}</span>
                      <span className="font-semibold text-[#202a36]">{interestType}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {recipients.length} {recipients.length === 1 ? (p.recipient || 'recipient') : (p.recipients || 'recipients')}
                      </span>
                    </div>
                    <svg
                      className={`h-5 w-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-6 py-5 space-y-4">
                      <p className="text-xs text-slate-500">
                        Leads tagged <strong>{interestType}</strong> will be emailed to the owner
                        {recipients.length > 0 ? ' plus the recipients below.' : '. Add recipients to include more team members.'}
                      </p>

                      {recipients.length > 0 && (
                        <div className="space-y-3">
                          {recipients.map((rec, idx) => (
                            <div key={idx} className="flex items-center gap-3">
                              <div className="flex-1 grid grid-cols-2 gap-3">
                                <div>
                                  {idx === 0 && <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{p.emailLabel || 'Email'}</label>}
                                  <input
                                    type="email"
                                    value={rec.email}
                                    onChange={e => updateRecipient(interestType, idx, 'email', e.target.value)}
                                    className={inputCls}
                                    placeholder="agent@varlikent.com"
                                  />
                                </div>
                                <div>
                                  {idx === 0 && <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{p.labelOptional || 'Label (optional)'}</label>}
                                  <input
                                    type="text"
                                    value={rec.label}
                                    onChange={e => updateRecipient(interestType, idx, 'label', e.target.value)}
                                    className={inputCls}
                                    placeholder="e.g. Sales Agent"
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeRecipient(interestType, idx)}
                                className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition cursor-pointer ${idx === 0 ? 'mt-5' : ''}`}
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => addRecipient(interestType)}
                        className="flex items-center gap-2 rounded-full border border-dashed border-[#4b6741] px-4 py-2 text-sm font-medium text-[#4b6741] hover:bg-[#4b6741]/5 transition cursor-pointer"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {p.addRecipient || 'Add recipient'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminLeadRouting
