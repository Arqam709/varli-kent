import { useState, useEffect, useRef } from 'react'
import { assets } from '../assets/assets'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import useSeo from '../lib/useSeo'
import { C } from '../contexts/ThemeContext'

const DEFAULT = {
  heroLabel: 'Our Story',
  heroHeading: 'About Varlikent',
  heroSubtext: "Istanbul's premier luxury real estate agency, connecting discerning buyers and renters with exceptional properties.",
  missionLabel: 'Our Mission',
  missionHeading: 'A refined approach to luxury real estate.',
  missionParagraph1: "We bring together market insight, local expertise, and exceptional service to help buyers and sellers make confident, premium decisions across Istanbul's most desirable neighborhoods.",
  missionParagraph2: "Founded with a passion for Istanbul's unique architectural heritage and its exciting modern developments, Varlikent has been a trusted partner for international investors, expatriates, and local families seeking their ideal property.",
  missionImage: '',
  teamLabel: 'Our Team',
  teamHeading: 'Meet Our Experts',
  stats: [
    { value: '10+', label: 'Years Experience' },
    { value: '500+', label: 'Properties Listed' },
    { value: '120+', label: 'Happy Clients' },
    { value: '50+', label: 'Districts Covered' },
  ],
  team: [
    { name: 'Selin Kaya', role: 'Senior Agent', avatar: '' },
    { name: 'Mert Demir', role: 'Investment Advisor', avatar: '' },
    { name: 'Lina Öztürk', role: 'Rental Specialist', avatar: '' },
  ],
  contentBlocks: [],
}

const FALLBACK_AVATARS = [assets.profile_img_1, assets.profile_img_2, assets.profile_img_3]

const isVideo = (url) => url && (url.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(url))

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const DarkGlow = () => (
  <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
)

const AboutPage = () => {
  const { language } = useLanguage()
  useSeo({
    title: 'About Varlikent — Istanbul Luxury Real Estate',
    description: 'Learn about Varlikent, Istanbul\'s premier luxury real estate agency. Our mission, our team, and our commitment to exceptional service.',
    path: '/about',
  })
  const [data, setData] = useState(DEFAULT)
  const [displayData, setDisplayData] = useState(DEFAULT)
  const translationCache = useRef({})

  useEffect(() => {
    api.get('/about').then(res => {
      if (res.data?.about) setData({ ...DEFAULT, ...res.data.about })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (language === 'en') { setDisplayData(data); return }
    if (translationCache.current[language]) { setDisplayData(translationCache.current[language]); return }

    const blocks = data.contentBlocks || []
    const texts = [
      data.heroLabel, data.heroHeading, data.heroSubtext,
      data.missionLabel, data.missionHeading, data.missionParagraph1, data.missionParagraph2,
      data.teamLabel, data.teamHeading,
      ...data.stats.map(s => s.label),
      ...data.team.map(m => m.role),
      ...blocks.flatMap(b => [b.heading, ...(b.paragraphs || [])]),
    ]

    api.post('/translate', { texts, targetLang: language }).then(r => {
      if (!r.data?.translations) { setDisplayData(data); return }
      const tr = r.data.translations
      let i = 0
      const next = () => tr[i++] ?? ''
      const translated = {
        ...data,
        heroLabel: next(), heroHeading: next(), heroSubtext: next(),
        missionLabel: next(), missionHeading: next(), missionParagraph1: next(), missionParagraph2: next(),
        teamLabel: next(), teamHeading: next(),
        stats: data.stats.map(s => ({ ...s, label: next() })),
        team: data.team.map(m => ({ ...m, role: next() })),
        contentBlocks: blocks.map(b => ({
          ...b,
          heading: next(),
          paragraphs: (b.paragraphs || []).map(() => next()),
        })),
      }
      translationCache.current[language] = translated
      setDisplayData(translated)
    }).catch(() => setDisplayData(data))
  }, [data, language])

  const sortedStats = [...displayData.stats].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const sortedTeam = [...displayData.team].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const sortedBlocks = [...(displayData.contentBlocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <div style={{ minHeight: '100vh', backgroundColor: C.charcoal }}>

      {/* ── 1. Hero — DARK + green glow ───────────────────────────────────── */}
      <section className="relative overflow-hidden pt-36 pb-24" style={{ backgroundColor: C.charcoal }}>
        <DarkGlow />
        <div className="relative z-10 container mx-auto px-6 text-center">
          <p className="text-xs uppercase tracking-[0.5em] font-medium mb-4" style={{ color: C.accent }}>
            {displayData.heroLabel}
          </p>
          <h1 style={{ fontFamily: 'Cinzel, serif', color: C.marble }} className="text-5xl lg:text-6xl font-bold leading-tight">
            {displayData.heroHeading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: 'rgba(var(--vk-light-rgb, 246,243,237), 0.55)' }}>
            {displayData.heroSubtext}
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
                  {s.label}
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
                {displayData.missionLabel}
              </p>
              <h2 style={{ fontFamily: 'Cinzel, serif', color: C.marble }} className="text-4xl font-semibold leading-snug">
                {displayData.missionHeading}
              </h2>
              <p className="mt-6 text-lg leading-8" style={{ color: 'rgba(var(--vk-light-rgb, 246,243,237), 0.65)' }}>
                {displayData.missionParagraph1}
              </p>
              <p className="mt-4 leading-7" style={{ color: 'rgba(var(--vk-light-rgb, 246,243,237), 0.5)' }}>
                {displayData.missionParagraph2}
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: '1px solid rgba(var(--vk-light-rgb, 246,243,237), 0.08)' }}>
              {isVideo(displayData.missionImage) ? (
                <video src={displayData.missionImage} autoPlay muted loop playsInline className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />
              ) : (
                <img
                  src={displayData.missionImage || assets.brand_img}
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
                          : <img src={block.image} alt={block.heading} className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />}
                      </div>
                    )}
                    <div>
                      {block.heading && (
                        <h2 style={{ fontFamily: 'Cinzel, serif', color: headingColor }} className="text-3xl font-semibold mb-6 leading-snug">
                          {block.heading}
                        </h2>
                      )}
                      <div className="space-y-4">
                        {block.paragraphs.filter(Boolean).map((p, pi) => (
                          <p key={pi} className="leading-7" style={{ color: pi === 0 ? bodyColor0 : bodyColorN }}>{p}</p>
                        ))}
                      </div>
                    </div>
                    {!imgLeft && (
                      <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: imgBorder }}>
                        {isVideo(block.image)
                          ? <video src={block.image} autoPlay muted loop playsInline className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />
                          : <img src={block.image} alt={block.heading} className="h-full w-full object-cover" style={{ aspectRatio: '4/3' }} />}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto text-center">
                    {block.heading && (
                      <h2 style={{ fontFamily: 'Cinzel, serif', color: headingColor }} className="text-3xl font-semibold mb-6">
                        {block.heading}
                      </h2>
                    )}
                    <div className="space-y-4">
                      {block.paragraphs.filter(Boolean).map((p, pi) => (
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
                {displayData.teamLabel}
              </p>
              <h2 style={{ fontFamily: 'Cinzel, serif', color: C.charcoal }} className="text-4xl font-semibold">
                {displayData.teamHeading}
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
                  <p className="mt-1 text-sm font-medium" style={{ color: C.accent }}>{m.role}</p>
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
