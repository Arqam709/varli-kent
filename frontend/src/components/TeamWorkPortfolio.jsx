import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { teamWorkLabels } from '../locales/teamWork'
import { C } from '../contexts/ThemeContext'

export default function TeamWorkPortfolio({ sections, files, onOpen, children }) {
  const { language } = useLanguage()
  const labels = teamWorkLabels(language)
  return <div className="min-w-0 space-y-7 [overflow-wrap:anywhere]" data-testid="team-work-portfolio">
    {sections.map((section, index) => <section key={section._id || index} className="min-w-0 space-y-3 border-b border-white/10 pb-6">
      {section.label && <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.gold }}>{section.label}</p>}
      {section.title && <h4 className="text-lg font-semibold" style={{ color: C.marble }}>{section.title}</h4>}
      {section.description && <p className="whitespace-pre-line text-sm text-white/75">{section.description}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {section.items.map((item, itemIndex) => <button key={item._id || itemIndex} type="button" onClick={() => onOpen(item)} aria-label={item.title || `${labels.image} ${itemIndex + 1}`} className="min-w-0 overflow-hidden rounded-lg">
          <img src={item.url} alt={item.title || labels.image} loading="lazy" className="aspect-square w-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
        </button>)}
      </div>
      {section.conclusion && <p className="whitespace-pre-line text-sm italic text-white/60">{section.conclusion}</p>}
    </section>)}
    {children}
    {files.length > 0 && <section className="space-y-3">
      <h4 className="text-sm font-semibold" style={{ color: C.gold }}>{labels.documents}</h4>
      {files.map((file, index) => <a key={file._id || index} href={file.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-3 rounded-lg border border-white/15 p-3 text-sm text-white/85">
        <span className="shrink-0 rounded bg-white/10 px-2 py-1 text-xs">{file.fileType?.toUpperCase() || labels.documents}</span>
        <span className="min-w-0 break-words">{file.name || labels.documents}</span>
      </a>)}
    </section>}
  </div>
}

export function TeamWorkImageDialog({ item, onClose }) {
  const { language } = useLanguage()
  const labels = teamWorkLabels(language)
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current.focus()
    const keydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose() }
      if (e.key === 'Tab') { e.preventDefault(); ref.current.querySelector('button').focus() }
    }
    window.addEventListener('keydown', keydown, true)
    return () => { window.removeEventListener('keydown', keydown, true); previous?.focus() }
  }, [onClose])
  return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={item.title || labels.image} dir={['ar', 'ur'].includes(language) ? 'rtl' : 'ltr'}
    className="fixed inset-0 z-[80] flex items-center justify-center bg-black/95 p-4" onClick={e => { e.stopPropagation(); onClose() }}>
    <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[#2B2B28]" onClick={e => e.stopPropagation()}>
      <div className="flex shrink-0 justify-end p-3"><button type="button" onClick={onClose} className="rounded-lg border border-white/30 px-3 py-2 text-sm text-white">{labels.closeImage}</button></div>
      <div className="min-h-0 overflow-y-auto p-4 [overflow-wrap:anywhere]">
        <img src={item.cropUrl || item.url} alt={item.title || labels.image} className="mx-auto max-h-[55dvh] w-full object-contain" onError={e => {
          if (item.cropUrl && e.currentTarget.getAttribute('src') !== item.url) e.currentTarget.src = item.url
          else e.currentTarget.style.display = 'none'
        }} />
        {item.title && <h3 className="mt-4 text-xl font-semibold text-white">{item.title}</h3>}
        {item.description && <p className="mt-3 whitespace-pre-line text-sm text-white/80">{item.description}</p>}
      </div>
    </div>
  </div>, document.body)
}
