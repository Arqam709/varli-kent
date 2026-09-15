import { useState, useEffect, useRef, useId } from 'react'
import { useLocation } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'

const STORAGE_KEY = 'vk_privacy_ack'
const GOLD = '#C9A35A'
const GOLD_HOVER = '#B88D3B'

function PrivacyPolicyModal({ onClose }) {
  const { t } = useLanguage()
  const p = t.privacyPolicy || {}
  const dialogRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector('button')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab') {
      const buttons = dialogRef.current.querySelectorAll('button')
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(8,10,14,0.72)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white"
        style={{ maxHeight: '85vh', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-8 py-6">
          <div>
            <h2 id={titleId} style={{ fontFamily: 'Cinzel, serif' }} className="text-xl font-bold text-[#1E1E1C]">{p.title}</h2>
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

        <div className="vk-scroll-gold min-h-0 flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {(p.sections || []).map((s, i) => (
            <div key={i}>
              <h3 style={{ fontFamily: 'Cinzel, serif' }} className="mb-2 text-sm font-semibold text-[#1E1E1C]">{s.heading}</h3>
              <p className="text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-100 px-8 py-5">
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
  const [acknowledged, setAcknowledged] = useState(() => {
    try { return Boolean(localStorage.getItem(STORAGE_KEY)) }
    catch { return false }
  })
  const [policyOpen, setPolicyOpen] = useState(false)

  const accept = () => {
    // Storage may be blocked; acknowledgement still works for this mount.
    try { localStorage.setItem(STORAGE_KEY, '1') }
    catch { /* Keep the notice usable when browser storage is unavailable. */ }
    setAcknowledged(true)
  }
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
