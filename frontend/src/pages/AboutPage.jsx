import { useState, useEffect, useMemo } from 'react'
import { assets } from '../assets/assets'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { localizedText } from '../lib/localizedText'
import useSeo from '../lib/useSeo'
import { C } from '../contexts/ThemeContext'

// What the page shows until /about answers, and whenever it cannot: the same
// structure a saved record has, with its wording taken from the translations
// (aboutPage) so it is never English for a visitor reading another language.
const DEFAULT_STAT_VALUES = ['10+', '500+', '120+', '50+']
const DEFAULT_TEAM_NAMES = ['Selin Kaya', 'Mert Demir', 'Lina Öztürk']

const defaultsFor = (copy) => ({
  heroLabel: copy.heroLabel,
  heroHeading: copy.heroHeading,
  heroSubtext: copy.heroSubtext,
  missionLabel: copy.missionLabel,
  missionHeading: copy.missionHeading,
  missionParagraph1: copy.missionParagraph1,
  missionParagraph2: copy.missionParagraph2,
  missionImage: '',
  teamLabel: copy.teamLabel,
  teamHeading: copy.teamHeading,
  stats: DEFAULT_STAT_VALUES.map((value, i) => ({ value, label: copy.stats[i] })),
  team: DEFAULT_TEAM_NAMES.map((name, i) => ({ name, role: copy.teamRoles[i], avatar: '' })),
})

const FALLBACK_AVATARS = [assets.profile_img_1, assets.profile_img_2, assets.profile_img_3]

const isVideo = (url) => url && (url.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(url))

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const DarkGlow = () => (
  <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
)

const AboutPage = () => {
  const { t, language } = useLanguage()
  useSeo({
    title: t.seo.about,
    description: t.seoDescriptions.about,
    language,
    path: '/about',
  })
  const defaults = useMemo(() => defaultsFor(t.aboutPage), [t])
  const [about, setAbout] = useState(null)

  useEffect(() => {
    api.get('/about').then(res => {
      if (res.data?.about) setAbout(res.data.about)
    }).catch(() => {})
  }, [])

  // The saved record wins field by field; anything it lacks keeps its default.
  const data = { ...defaults, ...about }

  
  const loc = (value, fallback = '') => localizedText(value, language, fallback)

  const sortedStats = [...data.stats].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const sortedTeam = [...data.team].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const sortedBlocks = [...(data.contentBlocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <div style={{ minHeight: '100vh', backgroundColor: C.charcoal }}>

      {/* ── 1. Hero — DARK + green glow ───────────────────────────────────── */}
      <section className="relative overflow-hidden pt-36 pb-24" style={{ backgroundColor: C.charcoal }}>
        <DarkGlow />
        <div className="relative z-10 container mx-auto px-6 text-center">
          <p className="text-xs uppercase tracking-[0.5em] font-medium mb-4" style={{ color: C.accent }}>
            {loc(data.heroLabel, defaults.heroLabel)}
          </p>
          <h1 style={{ fontFamily: 'Cinzel, serif', color: C.marble }} className="text-5xl lg:text-6xl font-bold leading-tight">
            {loc(data.heroHeading, defaults.heroHeading)}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: 'rgba(var(--vk-light-rgb, 246,243,237), 0.55)' }}>
            {loc(data.heroSubtext, defaults.heroSubtext)}
          </p>
        </div>
      </section>

      <GoldDivider />

      {/* ── 2. Stats — WHITE ──────────────────────────────────────────────── */}
      <section className="py-20" style={{ backgroundColor: C.softWhite }}>
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 gap-px md:grid-cols-4" style={{ background: 'rgba(var(--vk-dark-rgb), 0.06)' }}>
            {sortedStats.map((s, i) => (
              <div key={i} className="py-10 text-center" style={{ backgroundColor: C.softWhite }}>
                <p style={{ fontFamily: 'Cinzel, serif', color: C.accent, fontSize: '2.5rem', lineHeight: 1 }} className="font-bold">
                  {s.value}
                </p>
                <p className="mt-3 text-sm tracking-wider uppercase" style={{ color: 'rgba(var(--vk-dark-rgb), 0.45)' }}>
                  {loc(s.label)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <GoldDivider />

      {/* ── 3. Mission — DARK ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24" style={{ backgroundColor: C.charcoal }}>
        <div className="relative z-10 container mx-auto px-6">
          <div className="grid gap-16 lg:grid-cols-2 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] font-medium mb-4" style={{ color: C.accent }}>
                {loc(data.missionLabel, defaults.missionLabel)}
              </p>
              <h2 style={{ fontFamily: 'Cinzel, serif', color: C.marble }} className="text-4xl font-semibold leading-snug">
                {loc(data.missionHeading, defaults.missionHeading)}
              </h2>
              <p className="mt-6 text-lg leading-8" style={{ color: 'rgba(var(--vk-light-rgb, 246,243,237), 0.65)' }}>
                {loc(data.missionParagraph1, defaults.missionParagraph1)}
              </p>
              <p className="mt-4 leading-7" style={{ color: 'rgba(var(--vk-light-rgb, 246,243,237), 0.5)' }}>
                {loc(data.missionParagraph2, defaults.missionParagraph2)}
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: '1px solid rgba(var(--vk-light-rgb, 246,243,237), 0.08)' }}>
              {isVideo(data.missionImage) ? (
                <video src={data.missionImage} autoPlay muted loop playsInline className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />
              ) : (
                <img
                  src={data.missionImage || assets.brand_img}
                  alt="Varlikent"
                  className="h-full w-full object-cover"
                  style={{ aspectRatio: '4/3' }}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Dynamic content blocks — alternating starting WHITE ───────────── */}
      {sortedBlocks.map((block, i) => {
        const isDark = i % 2 === 0
        const hasImage = block.imagePosition !== 'none' && block.image
        const imgLeft = block.imagePosition === 'left'

        const headingColor = isDark ? C.marble : C.charcoal
        const bodyColor0 = isDark ? 'rgba(var(--vk-light-rgb, 246,243,237), 0.65)' : 'rgba(var(--vk-dark-rgb), 0.65)'
        const bodyColorN = isDark ? 'rgba(var(--vk-light-rgb, 246,243,237), 0.5)' : 'rgba(var(--vk-dark-rgb), 0.5)'
        const imgBorder = isDark ? '1px solid rgba(var(--vk-light-rgb, 246,243,237), 0.08)' : '1px solid rgba(var(--vk-dark-rgb), 0.08)'

        return (
          <div key={i}>
            <GoldDivider />
            <section
              className={isDark ? 'relative overflow-hidden py-20' : 'py-20'}
              style={{ backgroundColor: isDark ? C.charcoal : C.softWhite }}
            >
              {isDark && <DarkGlow />}
              <div className="relative z-10 container mx-auto px-6">
                {hasImage ? (
                  <div className="grid gap-16 lg:grid-cols-2 items-center">
                    {imgLeft && (
                      <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: imgBorder }}>
                        {isVideo(block.image)
                          ? <video src={block.image} autoPlay muted loop playsInline className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />
                          : <img src={block.image} alt={loc(block.heading)} className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />}
                      </div>
                    )}
                    <div>
                      {loc(block.heading) && (
                        <h2 style={{ fontFamily: 'Cinzel, serif', color: headingColor }} className="text-3xl font-semibold mb-6 leading-snug">
                          {loc(block.heading)}
                        </h2>
                      )}
                      <div className="space-y-4">
                        {block.paragraphs.map((p) => loc(p)).filter(Boolean).map((p, pi) => (
                          <p key={pi} className="leading-7" style={{ color: pi === 0 ? bodyColor0 : bodyColorN }}>{p}</p>
                        ))}
                      </div>
                    </div>
                    {!imgLeft && (
                      <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: imgBorder }}>
                        {isVideo(block.image)
                          ? <video src={block.image} autoPlay muted loop playsInline className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />
                          : <img src={block.image} alt={loc(block.heading)} className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto text-center">
                    {loc(block.heading) && (
                      <h2 style={{ fontFamily: 'Cinzel, serif', color: headingColor }} className="text-3xl font-semibold mb-6">
                        {loc(block.heading)}
                      </h2>
                    )}
                    <div className="space-y-4">
                      {block.paragraphs.map((p) => loc(p)).filter(Boolean).map((p, pi) => (
                        <p key={pi} className="leading-7 text-lg" style={{ color: bodyColor0 }}>{p}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )
      })}

      <GoldDivider />

      {/* ── Team — WHITE (light cards, dark text) ─────────────────────────── */}
      {sortedTeam.length > 0 && (
        <section className="py-24" style={{ backgroundColor: C.softWhite }}>
          <div className="container mx-auto px-6">
            <div className="mb-14 text-center">
              <p className="text-xs uppercase tracking-[0.4em] font-medium mb-4" style={{ color: C.accent }}>
                {loc(data.teamLabel, defaults.teamLabel)}
              </p>
              <h2 style={{ fontFamily: 'Cinzel, serif', color: C.charcoal }} className="text-4xl font-semibold">
                {loc(data.teamHeading, defaults.teamHeading)}
              </h2>
            </div>
            <div className={`grid gap-8 ${sortedTeam.length === 1 ? 'max-w-sm mx-auto' : sortedTeam.length === 2 ? 'md:grid-cols-2 max-w-2xl mx-auto' : 'md:grid-cols-3'}`}>
              {sortedTeam.map((m, i) => (
                <div key={i} className="rounded-2xl p-8 text-center transition-all" style={{ backgroundColor: '#fff', border: '1px solid rgba(var(--vk-dark-rgb), 0.08)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
                  <div className="mx-auto mb-4 h-24 w-24 overflow-hidden rounded-full" style={{ border: '2px solid rgba(var(--vk-green-rgb), 0.35)' }}>
                    <img
                      src={m.avatar || FALLBACK_AVATARS[i % FALLBACK_AVATARS.length]}
                      alt={m.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <h3 style={{ fontFamily: 'Cinzel, serif', color: C.charcoal }} className="text-lg font-semibold">
                    {m.name}
                  </h3>
                  <p className="mt-1 text-sm font-medium" style={{ color: C.accent }}>{loc(m.role)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

    </div>
  )
}

export default AboutPage
