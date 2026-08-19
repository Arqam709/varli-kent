import { C } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import useSeo from '../lib/useSeo'

const Section = ({ title, children }) => (
  <div className="mb-8">
    <h2 style={{ fontFamily: 'Cinzel, serif', color: C.textDark }} className="text-xl font-semibold mb-3">{title}</h2>
    <div className="text-sm leading-relaxed space-y-3" style={{ color: C.muted }}>{children}</div>
  </div>
)

const PrivacyPolicyPage = () => {
  const { t } = useLanguage()
  const p = t.privacyPolicy

  useSeo({
    title: 'Privacy Policy — Varlikent',
    description: 'How Varlikent collects, uses, and protects your information.',
    path: '/privacy',
  })

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.softWhite }}>
      <div className="pt-28 pb-14" style={{ backgroundColor: C.charcoal }}>
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: C.gold }}>Legal</p>
          <h1 style={{ fontFamily: 'Cinzel, serif', color: C.textLight, fontSize: 'clamp(2rem, 5vw, 3rem)' }}>{p.title}</h1>
          <p className="mt-4 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{p.lastUpdated}</p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-14">
        {p.sections.map((section, i) => (
          <Section key={i} title={section.heading}>
            <p>{section.body}</p>
          </Section>
        ))}
      </div>
    </div>
  )
}

export default PrivacyPolicyPage
