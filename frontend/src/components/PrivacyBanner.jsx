import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'

const STORAGE_KEY = 'vk_privacy_ack'
const GOLD = '#C9A35A'
const GOLD_HOVER = '#B88D3B'

function PrivacyPolicyModal({ onClose }) {
  const { t } = useLanguage()
  const p = t.privacyPolicy || {}

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(8,10,14,0.72)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white"
        style={{ maxHeight: '85vh', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
          <div>
            <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-xl font-bold text-[#1E1E1C]">{p.title}</h2>
            <p className="mt-1 text-xs text-slate-400">{p.lastUpdated}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={p.close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto px-8 py-6 space-y-6">
          {(p.sections || []).map((s, i) => (
            <div key={i}>
              <h3 style={{ fontFamily: 'Cinzel, serif' }} className="mb-2 text-sm font-semibold text-[#1E1E1C]">{s.heading}</h3>
              <p className="text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-8 py-5">
          <button
            onClick={onClose}
            className="rounded-full px-7 py-2.5 text-sm font-semibold text-white transition cursor-pointer"
            style={{ backgroundColor: GOLD }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = GOLD_HOVER}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = GOLD}
          >
            {p.close}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PrivacyBanner() {
  const { t } = useLanguage()
  const location = useLocation()
  const [acknowledged, setAcknowledged] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  useEffect(() => {
    setAcknowledged(!!localStorage.getItem(STORAGE_KEY))
  }, [])

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setAcknowledged(true)
  }

  // Re-checked on every route change (not just once at app load) — admin
  // staff can navigate here from a public page mid-session without this
  // floating over their own UI and eating clicks.
  const isAdminRoute = location.pathname.startsWith('/admin')
  const visible = !isAdminRoute && !acknowledged

  const p = t.privacyBanner || {}

  return (
    <>
      {visible && (
        <div
          className="fixed inset-x-4 bottom-4 z-[9998] mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl bg-white px-6 py-6 text-center sm:right-4 sm:left-auto sm:inset-x-auto"
          style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.22)' }}
        >
          <p className="text-sm leading-relaxed text-[#1E1E1C]">{p.message}</p>
          <button
            type="button"
            onClick={() => setPolicyOpen(true)}
            className="text-xs font-semibold uppercase tracking-widest cursor-pointer"
            style={{ color: GOLD }}
          >
            {p.learnMore}
          </button>
          <button
            onClick={accept}
            className="rounded-full px-8 py-2.5 text-sm font-semibold text-white transition cursor-pointer"
            style={{ backgroundColor: GOLD }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = GOLD_HOVER}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = GOLD}
          >
            {p.accept}
          </button>
        </div>
      )}

      {policyOpen && <PrivacyPolicyModal onClose={() => setPolicyOpen(false)} />}
    </>
  )
}
