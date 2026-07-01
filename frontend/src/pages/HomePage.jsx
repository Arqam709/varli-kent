import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import api from '../lib/api'
import PropertyCard from '../components/PropertyCard'
import { assets } from '../assets/assets'
import { useLanguage } from '../contexts/LanguageContext'
import { C } from '../contexts/ThemeContext'

gsap.registerPlugin(ScrollTrigger)

/* ─── Motion variants ──────────────────────────────────────────────────────── */
const ease = [0.16, 1, 0.3, 1]
const slideUp    = (d = 0, y = 60) => ({ hidden: { opacity: 0, y }, show: { opacity: 1, y: 0, transition: { duration: 0.85, ease, delay: d } } })
const slideLeft  = (d = 0)         => ({ hidden: { opacity: 0, x: -60 }, show: { opacity: 1, x: 0, transition: { duration: 0.85, ease, delay: d } } })
const slideRight = (d = 0)         => ({ hidden: { opacity: 0, x:  60 }, show: { opacity: 1, x: 0, transition: { duration: 0.85, ease, delay: d } } })
const clipReveal = (d = 0)         => ({ hidden: { clipPath: 'inset(100% 0 0 0)', opacity: 0 }, show: { clipPath: 'inset(0% 0 0 0)', opacity: 1, transition: { duration: 0.85, ease, delay: d } } })
const fadeIn     = (d = 0)         => ({ hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.7, delay: d } } })
const stagger    = (s = 0.1)       => ({ hidden: {}, show: { transition: { staggerChildren: s } } })

const useMotionVariants = () => {
  const reduce = useReducedMotion()
  if (reduce) {
    const inst = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0 } } }
    return { slideUp: () => inst, slideLeft: () => inst, slideRight: () => inst, clipReveal: () => inst, fadeIn: () => inst, stagger: () => ({ hidden: {}, show: {} }) }
  }
  return { slideUp, slideLeft, slideRight, clipReveal, fadeIn, stagger }
}

const vp = { once: true, margin: '-60px' }

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const CountUp = ({ target, suffix = '' }) => {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const started = useRef(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true
        const num = parseInt(target), step = Math.ceil(num / 60)
        let cur = 0
        const t = setInterval(() => { cur = Math.min(cur + step, num); setCount(cur); if (cur >= num) clearInterval(t) }, 22)
      }
    })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [target])
  return <span ref={ref}>{count}{suffix}</span>
}

const Spinner = () => (
  <div className="flex justify-center py-20">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: C.green, borderTopColor: 'transparent' }} />
  </div>
)

const GoldRule = ({ dark = false, className = '' }) => (
  <div className={`flex items-center justify-center gap-3 ${className}`}>
    <div style={{ width: 48, height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.7))' }} />
    <div style={{ width: 64, height: 1, backgroundColor: C.gold, opacity: 0.95 }} />
    <div style={{ width: 48, height: 1, background: 'linear-gradient(to left, transparent, rgba(var(--vk-gold-rgb), 0.7))' }} />
  </div>
)

const SectionLabel = ({ children, dark = false }) => (
  <p style={{ color: dark ? C.gold : C.green, letterSpacing: '0.5em', fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase' }} className="mb-4">
    {children}
  </p>
)

const SVC_ICONS = {
  realestate:   <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" /></svg>,
  architecture: <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  construction: <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 21h8m-4 0v-4m-7-4h18M5 3h14l1 10H4L5 3z" /></svg>,
  renovation:   <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z" /></svg>,
  interior:     <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>,
}
const SVC_KEYS  = ['realestate', 'architecture', 'construction', 'renovation', 'interior']
const SVC_HREFS = { realestate: '/properties', architecture: '/architecture', construction: '/construction', renovation: '/renovation', interior: '/interior-design' }

const TRUST_PATHS = {
  trusted:       'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  local:         'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z',
  endtoend:      'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  international: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129',
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PINNED HERO — GSAP ScrollTrigger
   ═══════════════════════════════════════════════════════════════════════════════ */
function PinnedHero({ t, prefersReducedMotion }) {
  const sectionRef  = useRef(null)
  const bgRef       = useRef(null)
  const overlayRef  = useRef(null)
  const headlineRef = useRef(null)
  const subRef      = useRef(null)
  const statsRef    = useRef(null)
  const brandRef    = useRef(null)
  const taglineRef  = useRef(null)
  const fogRef      = useRef(null)
  const scrollRef   = useRef(null)

  useEffect(() => {
    if (prefersReducedMotion) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          end: '+=200%',
          scrub: 1.4,
          pin: true,
          anticipatePin: 1,
        },
      })
      tl.to(scrollRef.current,   { opacity: 0, duration: 0.10 }, 0.00)
        .to(headlineRef.current, { opacity: 0, y: -90, duration: 0.30, ease: 'power2.in' }, 0.00)
        .to(subRef.current,      { opacity: 0, y: -60, duration: 0.24, ease: 'power2.in' }, 0.04)
        .to(statsRef.current,    { opacity: 0, y: -40, duration: 0.20, ease: 'power2.in' }, 0.08)
        .to(bgRef.current,       { scale: 1.20, duration: 1.00, ease: 'none' }, 0.00)
        .to(overlayRef.current,  { opacity: 0.72, duration: 0.28 }, 0.28)
        .fromTo(brandRef.current,
          { opacity: 0, y: 70, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: 0.36, ease: 'power3.out' }, 0.34)
        .fromTo(brandRef.current.querySelector('p'),
          { color: 'rgba(246,243,237,0.05)' },
          { color: 'rgba(246,243,237,0.78)', duration: 0.50, ease: 'none' }, 0.34)
        .fromTo(taglineRef.current,
          { opacity: 0, y: 32 },
          { opacity: 1, y: 0, duration: 0.28, ease: 'power3.out' }, 0.46)
        .fromTo(fogRef.current,
          { opacity: 0, y: 50 },
          { opacity: 1, y: 0, duration: 0.36 }, 0.52)
        .to(sectionRef.current, { opacity: 0, duration: 0.20 }, 0.82)
    }, sectionRef)
    return () => ctx.revert()
  }, [prefersReducedMotion])

  const scrollToServices = () => {
  const servicesSection = document.getElementById('services')

  if (servicesSection) {
    servicesSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }
}

  return (
    <section ref={sectionRef} style={{ position: 'relative', height: '100vh', overflow: 'hidden', backgroundColor: C.charcoal }}>

      {/* Villa BG */}
      <div ref={bgRef} style={{ position: 'absolute', inset: 0, transformOrigin: 'center', willChange: 'transform' }}>
        <img src="/images/hero-villa.jpg.png" onError={e => { e.currentTarget.style.display = 'none' }}
          alt="Luxury Istanbul villa" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>

      {/* Gradient overlays */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(var(--vk-dark-rgb), 0.15) 0%, rgba(var(--vk-dark-rgb), 0.52) 42%, rgba(var(--vk-dark-rgb), 0.97) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(var(--vk-dark-rgb), 0.40) 0%, transparent 28%, transparent 72%, rgba(var(--vk-dark-rgb), 0.40) 100%)', pointerEvents: 'none' }} />

      {/* Animated overlay */}
      <div ref={overlayRef} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(var(--vk-dark-rgb), 0.45)', opacity: 0.45, pointerEvents: 'none' }} />

      {/* Fog */}
      <div ref={fogRef} style={{
        position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 120% 60% at 50% 100%, rgba(var(--vk-green-rgb), 0.32) 0%, transparent 65%), radial-gradient(ellipse 80% 40% at 20% 80%, rgba(var(--vk-gold-rgb), 0.08) 0%, transparent 60%)',
        filter: 'blur(2px)',
      }} />

      {/* Stage 1 — headline content */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 1.5rem', paddingTop: '9rem' }}>

        <div ref={headlineRef} style={{ willChange: 'transform, opacity' }}>
          <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(2rem, 5.5vw, 4.2rem)', lineHeight: 1.12, fontWeight: 700, color: C.marble, maxWidth: '700px' }}>
            {t.hero?.heading1 || 'We Design, Build'}
            <br />
            <span style={{ color: C.marble }}>{t.hero?.heading2 || '& Deliver Exceptional'}</span>
            <br />
            <span style={{ color: C.green }}>{t.hero?.heading3 || 'Spaces in Istanbul'}</span>
          </h1>
        </div>

        <GoldRule dark className="my-7" />

        <div ref={subRef} style={{ willChange: 'transform, opacity' }}>
          <p style={{ color: C.gold, letterSpacing: '0.42em', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2rem' }}>
            {t.hero?.label || 'Istanbul · Architecture · Construction · Real Estate'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center' }}>
            <button
  type="button"
  onClick={scrollToServices}
  style={{
    backgroundColor: C.green,
    color: '#fff',
    borderRadius: '9999px',
    padding: '0.9rem 2.4rem',
    fontSize: '0.68rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.16em',
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
  }}
>
  {t.hero?.ctaPrimary || 'Explore Services'}
</button>
            <Link to="/properties" style={{ border: `1px solid rgba(246,243,237,0.3)`, color: C.marble, borderRadius: '9999px', padding: '0.9rem 2.4rem', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', textDecoration: 'none' }}>
              {t.hero?.ctaSecondary || 'View Properties'}
            </Link>
          </div>
        </div>

        <div ref={statsRef} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'clamp(1rem, 4vw, 3rem)', marginTop: '3rem', willChange: 'transform, opacity' }}>
          {[
            { n: '500', s: '+', l: t.hero?.stats?.properties  || 'Properties' },
            { n: '10',  s: '+', l: t.hero?.stats?.years       || 'Years' },
            { n: '40',  s: '+', l: t.hero?.stats?.districts   || 'Districts' },
            { n: '98',  s: '%', l: t.hero?.stats?.satisfaction || 'Satisfaction' },
          ].map(({ n, s, l }) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ fontFamily: 'Cinzel, serif', fontSize: '1.75rem', color: C.marble, fontWeight: 700 }}><CountUp target={n} suffix={s} /></span>
              <span style={{ fontSize: '0.58rem', letterSpacing: '0.35em', textTransform: 'uppercase', color: 'rgba(246,243,237,0.45)' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stage 3 — Brand reveal */}
      <div ref={brandRef} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0, pointerEvents: 'none', textAlign: 'center', padding: '0 1.5rem' }}>
        <p style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(4rem, 16vw, 14rem)', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(246,243,237,0.05)', lineHeight: 1, userSelect: 'none', whiteSpace: 'nowrap' }}>
          VARLIKENT
        </p>
        <div ref={taglineRef} style={{ opacity: 0, marginTop: '1.5rem', willChange: 'transform, opacity' }}>
          <p style={{ color: C.gold, fontSize: 'clamp(0.58rem, 1.5vw, 0.82rem)', letterSpacing: '0.45em', textTransform: 'uppercase', fontWeight: 500 }}>
            Real Estate &nbsp;·&nbsp; Architecture &nbsp;·&nbsp; Construction &nbsp;·&nbsp; Renovation &nbsp;·&nbsp; Interior Design
          </p>
        </div>
      </div>

      {/* Scroll cue */}
      <div ref={scrollRef} style={{ position: 'absolute', bottom: '2.5rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.58rem', letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(246,243,237,0.35)' }}>{t.hero?.scroll || 'Scroll'}</span>
        <div style={{ width: 1, height: 44, backgroundColor: C.gold, opacity: 0.65, animation: 'vk-pulse 1.8s ease-in-out infinite' }} />
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.33), transparent)' }} />
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════════
   FEATURED PROPERTIES CAROUSEL
   ═══════════════════════════════════════════════════════════════════════════════ */
function useFeaturedCards() {
  const [cards, setCards] = useState(3.4)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setCards(w < 640 ? 1.05 : w < 1024 ? 2.1 : 3.4)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cards
}

function FeaturedCarousel({ loading, featured, t, navigate, C, mv, vp, SectionLabel }) {
  const [idx, setIdx] = useState(0)
  const cardsVisible = useFeaturedCards()
  const maxIdx = Math.max(0, featured.length - Math.floor(cardsVisible))
  const showArrows = featured.length > Math.floor(cardsVisible)

  if (loading) return (
    <section style={{ backgroundColor: C.marble, padding: '5rem 0' }}>
      <div className="flex justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: C.green, borderTopColor: 'transparent' }} />
      </div>
    </section>
  )
  if (!featured || featured.length === 0) return null

  const cardWidthPct = 100 / cardsVisible
  const gapPx = 24
  const translateX = idx > 0 ? `calc(-${idx} * (${cardWidthPct}% + ${gapPx}px))` : '0'

  return (
    <section aria-label="Featured Properties" style={{ backgroundColor: C.marble }}>
      <div className="py-20 md:py-28">
        {/* Header */}
        <motion.div initial="hidden" whileInView="show" viewport={vp} variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }} className="mb-10 md:mb-14 text-center px-4 sm:px-6">
          <motion.div variants={mv.fadeIn()}><SectionLabel>{t.featured?.label || 'Handpicked'}</SectionLabel></motion.div>
          <div style={{ overflow: 'hidden' }}>
            <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.8rem)', color: C.charcoal, margin: 0 }}>
              {t.featured?.heading || 'Featured Properties'}
            </motion.h2>
          </div>
          <motion.p variants={mv.slideUp(0.12)} className="mx-auto mt-4 text-sm leading-relaxed max-w-lg" style={{ color: C.muted }}>
            {t.featured?.subtitle || 'Exclusive homes curated for discerning buyers and renters across Istanbul.'}
          </motion.p>
        </motion.div>

        {/* Carousel */}
        <div className="relative px-4 sm:px-6">
          <div style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: gapPx, transform: `translateX(${translateX})`, transition: 'transform 400ms cubic-bezier(0.22,1,0.36,1)', willChange: 'transform' }}>
              {featured.map((p) => (
                <div key={p._id} style={{ flex: `0 0 ${cardWidthPct}%`, minWidth: 0 }}>
                  <PropertyCard property={p} />
                </div>
              ))}
            </div>
          </div>

          {/* Right fog */}
          {showArrows && idx < maxIdx && (
            <div style={{ position: 'absolute', top: 0, right: '1rem', width: '4rem', height: '100%', background: `linear-gradient(to right, transparent, ${C.marble})`, pointerEvents: 'none' }} />
          )}
        </div>

        {/* Navigation */}
        {showArrows && (
          <div className="mt-8 flex items-center justify-center gap-4">
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Previous"
              className="flex h-11 w-11 items-center justify-center rounded-full border transition-all cursor-pointer disabled:opacity-25"
              style={{ borderColor: 'rgba(var(--vk-dark-rgb), 0.2)', backgroundColor: C.charcoal, color: '#fff' }}>
              ←
            </button>
            <span className="text-xs tracking-widest" style={{ color: C.muted }}>{idx + 1} / {maxIdx + 1}</span>
            <button onClick={() => setIdx(i => Math.min(maxIdx, i + 1))} disabled={idx >= maxIdx} aria-label="Next"
              className="flex h-11 w-11 items-center justify-center rounded-full border transition-all cursor-pointer disabled:opacity-25"
              style={{ borderColor: 'rgba(var(--vk-dark-rgb), 0.2)', backgroundColor: C.charcoal, color: '#fff' }}>
              →
            </button>
          </div>
        )}

        {/* View All button */}
        <div className="mt-10 text-center">
          <button onClick={() => navigate('/properties')} className="inline-flex cursor-pointer items-center gap-2 rounded-full px-8 py-3.5 text-xs font-semibold uppercase tracking-widest transition-all duration-300 hover:opacity-85"
            style={{ backgroundColor: '#4b6741', color: '#ffffff' }}>
            {t.featured?.viewAll || 'View All Properties'}
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </section>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const { t }    = useLanguage()
  const mv       = useMotionVariants()
  const prefersReducedMotion = useReducedMotion()

  const scrollToServices = () => {
  const servicesSection = document.getElementById('services')

  if (servicesSection) {
    servicesSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }
}

  const [featured,  setFeatured]  = useState([])
  const [saleCount, setSaleCount] = useState(0)
  const [rentCount, setRentCount] = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [reviews,   setReviews]   = useState([])

  useEffect(() => {
    document.title = 'VarliKent — Architecture, Construction, Interior Design & Real Estate Istanbul'
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    meta.content = "VarliKent is Istanbul's full-service property company — architecture, construction, renovation, interior design and real estate."
  }, [])

  useEffect(() => {
    Promise.all([
      api.get('/properties?featured=true&limit=6').catch(() => ({ data: { properties: [] } })),
      api.get('/properties/sale').catch(() => ({ data: { count: 0 } })),
      api.get('/properties/rent').catch(() => ({ data: { count: 0 } })),
    ]).then(([f, s, r]) => {
      setFeatured(f.data.properties || [])
      setSaleCount(s.data.count || 0)
      setRentCount(r.data.count || 0)
    }).finally(() => setLoading(false))
    api.get('/reviews').then(r => setReviews(r.data.reviews || [])).catch(() => {})
  }, [])

  return (
    <>
      <style>{`@keyframes vk-pulse { 0%,100%{transform:scaleY(0);opacity:0} 50%{transform:scaleY(1);opacity:1} }`}</style>

      <main className="w-full overflow-x-hidden" style={{ backgroundColor: C.marble }}>

        {/* ── HERO ── */}
        <PinnedHero t={t} prefersReducedMotion={prefersReducedMotion} />

        {/* ── SERVICES — dark charcoal + green glow ── */}
        <section id="services" aria-label="Services" style={{ backgroundColor: C.charcoal }} className="relative overflow-hidden">
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(var(--vk-green-rgb), 0.30) 0%, transparent 65%)' }} />
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.6), transparent)' }} />
          <div className="relative mx-auto max-w-7xl px-6 py-28">
            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.09)} className="mb-16 text-center">
              <motion.div variants={mv.fadeIn()}><SectionLabel dark>{t.services?.label || 'What We Do'}</SectionLabel></motion.div>
              <div className="overflow-hidden">
                <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', color: C.marble, lineHeight: 1.15 }}>
                  {t.services?.heading || 'Five Services. One Company.'}
                </motion.h2>
              </div>
              <motion.p variants={mv.slideUp(0.12)} className="mx-auto mt-4 max-w-xl text-sm leading-relaxed" style={{ color: '#9A9A92' }}>
                {t.services?.subheading || 'From the first sketch to the final sale — we cover every stage of the property lifecycle.'}
              </motion.p>
            </motion.div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {SVC_KEYS.map((key, i) => (
                <motion.div key={key} initial="hidden" whileInView="show" viewport={vp} variants={mv.slideUp(i * 0.08)}>
                  <Link to={SVC_HREFS[key]} className="group flex h-full flex-col gap-5 rounded-2xl p-7 transition-all duration-300 hover:-translate-y-1 cursor-pointer" style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(var(--vk-green-rgb), 0.22)', boxShadow: '0 2px 16px rgba(0,0,0,0.25)' }}>
                    <span style={{ color: C.green }} className="transition-colors duration-300 group-hover:text-[#C9A35A]">{SVC_ICONS[key]}</span>
                    <div className="flex-1">
                      <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '0.85rem', color: C.marble }} className="mb-2 transition-colors duration-300 group-hover:text-[#C9A35A]">
                        {t.services?.items?.[key]?.label || key}
                      </h3>
                      <p className="text-xs leading-relaxed" style={{ color: '#8A8A83' }}>{t.services?.items?.[key]?.desc || ''}</p>
                    </div>
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1" style={{ color: C.gold }}>
                      {t.services?.learnMore || 'Learn more'}
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.4), transparent)' }} />
        </section>

        {/* ── ABOUT / WHO WE ARE — soft white bg ── */}
        <section aria-label="About VarliKent" style={{ backgroundColor: C.softWhite }}>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.53), transparent)' }} />
          <div className="mx-auto max-w-7xl px-6 py-32">
            <div className="grid gap-20 lg:grid-cols-2 items-center">

              <div className="flex flex-col gap-5">
                {[
                  { value: t.about?.stat1value || '10+',  label: t.about?.stat1label || 'Years of Excellence' },
                  { value: t.about?.stat2value || '500+', label: t.about?.stat2label || 'Projects Delivered' },
                  { value: t.about?.stat3value || '5',    label: t.about?.stat3label || 'Services Under One Roof' },
                ].map((stat, i) => (
                  <motion.div key={i} initial="hidden" whileInView="show" viewport={vp} variants={mv.slideLeft(i * 0.1)}
                    className="flex items-center gap-7 rounded-2xl p-8"
                    style={{ backgroundColor: '#fff', border: `1px solid rgba(var(--vk-gold-rgb), 0.18)`, boxShadow: '0 2px 20px rgba(var(--vk-dark-rgb), 0.06)' }}>
                    <span style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(2.4rem, 4.5vw, 3rem)', color: C.gold, fontWeight: 700, lineHeight: 1, minWidth: '5rem' }}>{stat.value}</span>
                    <span style={{ fontSize: '0.78rem', color: C.charcoal, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>{stat.label}</span>
                  </motion.div>
                ))}
              </div>

              <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.08)} className="lg:pl-10">
                <motion.div variants={mv.fadeIn()}><SectionLabel>{t.about?.label || 'Who We Are'}</SectionLabel></motion.div>
                <div className="overflow-hidden mb-6">
                  <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.8rem, 3.8vw, 2.6rem)', color: C.charcoal, lineHeight: 1.18 }}>
                    {t.about?.heading || "Istanbul's Complete Property Company"}
                  </motion.h2>
                </div>
                <motion.p variants={mv.slideUp(0.1)} className="mb-4 leading-relaxed text-sm" style={{ color: C.muted }}>
                  {t.about?.body1 || "VarliKent is Istanbul's full-service property company. We don't just find properties — we design them, build them, renovate them, and bring them to life with exceptional interior work."}
                </motion.p>
                <motion.p variants={mv.slideUp(0.16)} className="mb-10 leading-relaxed text-sm" style={{ color: C.muted }}>
                  {t.about?.body2 || 'Founded with a vision to unify the property lifecycle under one trusted name, we serve homeowners, developers, and investors seeking excellence at every stage.'}
                </motion.p>
                <motion.div variants={mv.slideUp(0.22)}>
                  <Link to="/about" className="inline-flex items-center gap-2 rounded-full px-9 py-3.5 text-xs font-semibold uppercase tracking-widest transition-all duration-300 hover:opacity-85"
                    style={{ backgroundColor: C.deepGreen, color: '#fff' }}>
                    {t.about?.cta || 'Our Story'}
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </Link>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── FOR SALE / RENT — dark charcoal + green glow ── */}
        <section aria-label="Buy or Rent" style={{ backgroundColor: C.charcoal }} className="relative overflow-hidden">
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse 80% 70% at 50% 50%, rgba(var(--vk-green-rgb), 0.28) 0%, transparent 65%)` }} />
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.6), transparent)' }} />
          <div className="relative mx-auto max-w-7xl px-6 py-28">
            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.09)} className="mb-14 text-center">
              <motion.div variants={mv.fadeIn()}><SectionLabel dark>{t.browse?.label || 'Browse By Type'}</SectionLabel></motion.div>
              <div className="overflow-hidden">
                <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', color: C.marble }}>
                  {t.browse?.heading || 'For Sale or Rent'}
                </motion.h2>
              </div>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Sale */}
              <motion.div initial="hidden" whileInView="show" viewport={vp} variants={mv.slideLeft()} onClick={() => navigate('/buy')}
                className="group relative cursor-pointer overflow-hidden rounded-2xl p-12 transition-all duration-300 hover:-translate-y-1"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: `1px solid rgba(var(--vk-green-rgb), 0.25)`, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
                <div className="absolute -top-10 -right-10 h-44 w-44 rounded-full opacity-20 blur-3xl transition-opacity duration-300 group-hover:opacity-40" style={{ backgroundColor: C.green }} />
                <svg className="relative h-10 w-10 mb-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: C.green }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" /></svg>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.4rem', color: C.marble }} className="mb-3">{t.browse?.sale?.title || 'Properties for Sale'}</h3>
                <p className="text-sm leading-relaxed mb-8" style={{ color: '#9A9A92' }}>{t.browse?.sale?.desc || 'Invest in Istanbul — from city apartments to Bosphorus villas.'}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: '#7A7A72' }}>{saleCount} {t.browse?.listings || 'listings'}</span>
                  <span className="flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-white transition-all duration-300 group-hover:opacity-85" style={{ backgroundColor: C.green }}>
                    {t.browse?.sale?.btn || 'Explore Sales'}
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </span>
                </div>
              </motion.div>

              {/* Rent */}
              <motion.div initial="hidden" whileInView="show" viewport={vp} variants={mv.slideRight()} onClick={() => navigate('/rent')}
                className="group relative cursor-pointer overflow-hidden rounded-2xl p-12 transition-all duration-300 hover:-translate-y-1"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: `1px solid rgba(var(--vk-gold-rgb), 0.25)`, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
                <div className="absolute -top-10 -right-10 h-44 w-44 rounded-full opacity-20 blur-3xl transition-opacity duration-300 group-hover:opacity-40" style={{ backgroundColor: C.gold }} />
                <svg className="relative h-10 w-10 mb-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: C.gold }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.4rem', color: C.marble }} className="mb-3">{t.browse?.rent?.title || 'Properties for Rent'}</h3>
                <p className="text-sm leading-relaxed mb-8" style={{ color: '#9A9A92' }}>{t.browse?.rent?.desc || "Flexible rental options across Istanbul's most sought-after neighbourhoods."}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: '#7A7A72' }}>{rentCount} {t.browse?.listings || 'listings'}</span>
                  <span className="flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-white transition-all duration-300 group-hover:opacity-85" style={{ backgroundColor: C.gold }}>
                    {t.browse?.rent?.btn || 'Explore Rentals'}
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </span>
                </div>
              </motion.div>
            </div>
          </div>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.4), transparent)' }} />
        </section>

        {/* ── WHY VARLIKENT — soft white bg ── */}
        <section aria-label="Why VarliKent" style={{ backgroundColor: C.softWhite }}>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.53), transparent)' }} />
          <div className="mx-auto max-w-7xl px-6 py-32">
            <div className="grid gap-20 lg:grid-cols-2 items-center">

              <motion.div initial="hidden" whileInView="show" viewport={vp} variants={mv.slideLeft()} className="relative">
                <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid rgba(var(--vk-gold-rgb), 0.18)`, boxShadow: '0 8px 40px rgba(var(--vk-dark-rgb), 0.10)' }}>
                  <img src="/images/why-villa.png" alt="VarliKent luxury property Istanbul" className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="absolute -bottom-6 -right-6 hidden lg:block rounded-xl px-6 py-5" style={{ backgroundColor: '#fff', border: `1px solid rgba(var(--vk-gold-rgb), 0.3)`, boxShadow: '0 4px 20px rgba(var(--vk-dark-rgb), 0.1)' }}>
                  <p style={{ fontFamily: 'Cinzel, serif', fontSize: '2rem', color: C.gold, fontWeight: 700, lineHeight: 1 }}>10+</p>
                  <p className="text-xs tracking-widest uppercase mt-1.5" style={{ color: C.muted }}>{t.trust?.stat || 'Years of Excellence'}</p>
                </div>
              </motion.div>

              <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.08)} className="lg:pl-8">
                <motion.div variants={mv.fadeIn()}><SectionLabel>{t.trust?.label || 'Why VarliKent'}</SectionLabel></motion.div>
                <div className="overflow-hidden mb-6">
                  <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.7rem, 3.6vw, 2.4rem)', color: C.charcoal, lineHeight: 1.22 }}>
                    {t.trust?.heading || 'A refined approach to property — from design to delivery.'}
                  </motion.h2>
                </div>
                <motion.p variants={mv.slideUp(0.10)} className="mb-10 leading-relaxed text-sm" style={{ color: C.muted }}>
                  {t.trust?.body || 'We bring together market intelligence, architectural expertise, and exceptional service — guiding clients through every stage.'}
                </motion.p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(t.trust?.points || {}).map(([key, pt], i) => (
                    <motion.div key={key} variants={mv.slideUp(i * 0.07)} className="flex gap-4 p-5 rounded-xl transition-all duration-300 hover:shadow-md"
                      style={{ backgroundColor: '#fff', border: `1px solid rgba(var(--vk-green-rgb), 0.12)`, boxShadow: '0 1px 8px rgba(var(--vk-dark-rgb), 0.04)' }}>
                      <svg className="h-5 w-5 shrink-0 mt-0.5" style={{ color: C.green }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={TRUST_PATHS[key]} /></svg>
                      <div>
                        <h4 style={{ fontFamily: 'Cinzel, serif', fontSize: '0.78rem', color: C.charcoal }} className="mb-1">{pt.title}</h4>
                        <p className="text-xs leading-relaxed" style={{ color: C.muted }}>{pt.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── PROCESS — charcoal bg ── */}
        <section id="process" aria-label="How We Work" style={{ backgroundColor: C.charcoal }} className="relative overflow-hidden">
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.33), transparent)' }} />
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(var(--vk-gold-rgb), 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--vk-gold-rgb), 0.04) 1px, transparent 1px)`, backgroundSize: '52px 52px' }} />

          <div className="relative mx-auto max-w-7xl px-6 py-32">
            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.09)} className="mb-20 text-center">
              <motion.div variants={mv.fadeIn()}><SectionLabel dark>{t.process?.label || 'How We Work'}</SectionLabel></motion.div>
              <div className="overflow-hidden">
                <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', color: C.marble }}>
                  {t.process?.heading || 'From Vision to Handover'}
                </motion.h2>
              </div>
            </motion.div>

            <div className="relative">
              <div className="absolute top-10 left-0 right-0 hidden lg:block h-px" style={{ background: 'linear-gradient(to right, transparent 3%, rgba(var(--vk-gold-rgb), 0.2) 12%, rgba(var(--vk-gold-rgb), 0.2) 88%, transparent 97%)' }} />
              <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
                {(t.process?.steps || [
                  { num: '01', title: 'Consult',           desc: 'We listen to your vision, brief and budget — then map a clear path forward.' },
                  { num: '02', title: 'Design',            desc: 'Our architects craft plans balancing beauty, function and long-term value.' },
                  { num: '03', title: 'Build',             desc: "Our construction teams deliver to Istanbul's highest quality standards." },
                  { num: '04', title: 'Renovate & Finish', desc: 'Precision renovation and premium interior fit-out transforms every space.' },
                  { num: '05', title: 'Sell or Rent',      desc: 'Our real estate team places your property with the right buyers and tenants.' },
                ]).map((step, i) => (
                  <motion.article key={step.num} initial="hidden" whileInView="show" viewport={vp} variants={mv.slideUp(i * 0.1)} className="relative flex flex-col">
                    <div className="relative mb-7">
                      <span style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(3rem, 5.5vw, 4.5rem)', fontWeight: 700, lineHeight: 1, color: 'rgba(var(--vk-gold-rgb), 0.13)', userSelect: 'none', display: 'block' }}>{step.num}</span>
                      <div className="absolute bottom-2 left-0 h-px w-8" style={{ backgroundColor: C.gold, opacity: 0.55 }} />
                    </div>
                    <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '0.85rem', color: C.marble }} className="mb-3">{step.title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: C.muted }}>{step.desc}</p>
                  </motion.article>
                ))}
              </div>
            </div>
          </div>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.53), transparent)' }} />
        </section>

        {/* ── FEATURED PROPERTIES — marble bg carousel ── */}
        <FeaturedCarousel
          loading={loading}
          featured={featured}
          t={t}
          navigate={navigate}
          C={C}
          mv={mv}
          vp={vp}
          SectionLabel={SectionLabel}
        />

        {/* ── FEATURED PROJECTS — dark grey bg ── */}
        <section aria-label="Selected Projects" style={{ backgroundColor: C.darkGrey }} className="relative overflow-hidden">
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.53), transparent)' }} />
          <div className="mx-auto max-w-7xl px-6 py-32">
            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.09)} className="mb-14 text-center">
              <motion.div variants={mv.fadeIn()}><SectionLabel dark>{t.projects?.label || 'Our Work'}</SectionLabel></motion.div>
              <div className="overflow-hidden">
                <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', color: C.marble }}>
                  {t.projects?.heading || 'Selected Projects'}
                </motion.h2>
              </div>
              <motion.p variants={mv.slideUp(0.12)} className="mx-auto mt-4 max-w-xl text-sm leading-relaxed" style={{ color: C.muted }}>
                {t.projects?.subtitle || 'A glimpse into the spaces we have designed, built and transformed across Istanbul.'}
              </motion.p>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-3">
              {[
                { key: 'architecture', image: '/images/floor-plan.png',    href: '/architecture',    variant: mv.slideLeft() },
                { key: 'interior',     image: '/images/interior-main.png', href: '/interior-design', variant: mv.slideUp() },
                { key: 'construction', image: '/images/construction.png',  href: '/construction',    variant: mv.slideRight() },
              ].map(({ key, image, href, variant }) => {
                const item = t.projects?.items?.[key] || {}
                return (
                  <motion.article key={key} initial="hidden" whileInView="show" viewport={vp} variants={variant}
                    className="group relative overflow-hidden rounded-2xl" style={{ aspectRatio: '3/4', minHeight: 280, border: `1px solid rgba(var(--vk-gold-rgb), 0.12)` }}>
                    <img src={image} alt={item.label || key} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(var(--vk-dark-rgb), 0.96) 0%, rgba(var(--vk-dark-rgb), 0.45) 50%, rgba(var(--vk-dark-rgb), 0.05) 100%)' }} />
                    <div className="absolute inset-0 flex flex-col justify-end p-8">
                      <span className="mb-3 inline-block rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest" style={{ backgroundColor: 'rgba(var(--vk-green-rgb), 0.87)', color: '#fff', width: 'fit-content' }}>{item.tag || key}</span>
                      <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.2rem', color: C.marble }} className="mb-2">{item.label || key}</h3>
                      <p className="mb-5 text-xs leading-relaxed" style={{ color: C.muted }}>{item.desc}</p>
                      <Link to={href} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest transition-all duration-300 group-hover:gap-3" style={{ color: C.gold }}>
                        Explore
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </Link>
                    </div>
                  </motion.article>
                )
              })}
            </div>

            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={mv.slideUp(0.1)} className="mt-14 text-center">
              <Link to="/architecture" className="inline-flex items-center gap-2 rounded-full px-9 py-3.5 text-xs font-semibold uppercase tracking-widest transition-all duration-300 hover:opacity-80"
                style={{ border: '1px solid rgba(var(--vk-gold-rgb), 0.33)', color: C.marble }}>
                {t.projects?.viewAll || 'See All Projects'}
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </motion.div>
          </div>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.53), transparent)' }} />
        </section>

        {/* ── STATS — charcoal bg ── */}
        <section aria-label="Statistics" style={{ backgroundColor: C.charcoal }} className="relative py-24">
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid grid-cols-2 gap-10 text-center md:grid-cols-4">
              {[
                { n: '500', s: '+', l: t.stats?.properties || 'Properties Listed' },
                { n: '10',  s: '+', l: t.stats?.years      || 'Years Experience' },
                { n: '120', s: '+', l: t.stats?.clients    || 'Happy Clients' },
                { n: '40',  s: '+', l: t.stats?.districts  || 'Districts Covered' },
              ].map(({ n, s, l }, i) => (
                <motion.div key={l} initial="hidden" whileInView="show" viewport={vp} variants={mv.slideUp(i * 0.1)}>
                  <div style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(2rem, 3.8vw, 2.8rem)', color: C.gold, fontWeight: 700 }}><CountUp target={n} suffix={s} /></div>
                  <div className="mt-2 text-[10px] tracking-[0.32em] uppercase" style={{ color: C.muted }}>{l}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TESTIMONIALS — soft white bg ── */}
        <section aria-label="Client Testimonials" style={{ backgroundColor: C.softWhite }}>
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.53), transparent)' }} />
          <div className="mx-auto max-w-7xl px-6 py-32">
            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.09)} className="mb-14 text-center">
              <motion.div variants={mv.fadeIn()}><SectionLabel>{t.testimonials?.label || 'Client Stories'}</SectionLabel></motion.div>
              <div className="overflow-hidden">
                <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', color: C.charcoal }}>
                  {t.testimonials?.heading || 'What Our Clients Say'}
                </motion.h2>
              </div>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-3">
              {(reviews.length > 0 ? reviews.slice(0, 3) : [
                { name: 'Elif Acar',    role: 'Investment Executive', text: 'The team delivered exceptional service from search to closing. The property selection and support were outstanding.', rating: 5 },
                { name: 'Can Yıldırım', role: 'Executive Consultant', text: 'Working with them made buying our home effortless. Professional guidance and excellent communication throughout.', rating: 5 },
                { name: 'Aylin Şener',  role: 'Architect',            text: 'A refined, thoughtful approach to property marketing. They helped us close quickly at the right price.', rating: 5 },
              ]).map((item, i) => (
                <motion.article key={item._id || i} initial="hidden" whileInView="show" viewport={vp}
                  variants={i === 0 ? mv.slideLeft() : i === 2 ? mv.slideRight() : mv.slideUp()}
                  className="flex flex-col rounded-2xl p-8" style={{ backgroundColor: '#fff', border: `1px solid rgba(var(--vk-gold-rgb), 0.12)`, boxShadow: '0 2px 20px rgba(var(--vk-dark-rgb), 0.06)' }}>
                  <div className="flex gap-1 mb-5">
                    {Array.from({ length: item.rating || 5 }).map((_, j) => (
                      <svg key={j} className="h-3.5 w-3.5" style={{ color: C.gold }} fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  <p className="mb-1.5 leading-none select-none text-5xl font-serif" style={{ color: 'rgba(var(--vk-gold-rgb), 0.19)' }}>"</p>
                  <p className="flex-1 text-sm leading-relaxed" style={{ color: C.muted }}>{item.text}</p>
                  <div className="mt-7 flex items-center gap-4 pt-5" style={{ borderTop: `1px solid rgba(var(--vk-gold-rgb), 0.12)` }}>
                    {item.avatar
                      ? <img src={item.avatar} alt={item.name} className="h-11 w-11 rounded-full object-cover shrink-0" loading="lazy" />
                      : <div className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ backgroundColor: C.green }}>{item.name?.[0]?.toUpperCase()}</div>
                    }
                    <div>
                      <p style={{ fontFamily: 'Cinzel, serif', fontSize: '0.8rem', color: C.charcoal }}>{item.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: C.muted }}>{item.role || item.title}</p>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA — charcoal bg ── */}
        <section aria-label="Call to Action" className="relative overflow-hidden py-36" style={{ backgroundColor: C.charcoal }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse 80% 70% at 50% 50%, rgba(var(--vk-green-rgb), 0.28) 0%, transparent 65%)` }} />
          <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(var(--vk-gold-rgb), 0.33), transparent)', position: 'absolute', top: 0, left: 0, right: 0 }} />

          <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
            <motion.div initial="hidden" whileInView="show" viewport={vp} variants={stagger(0.11)}>
              <motion.div variants={mv.fadeIn()}><SectionLabel dark>{t.cta?.label || 'Get Started'}</SectionLabel></motion.div>
              <div className="overflow-hidden mb-6">
                <motion.h2 variants={mv.clipReveal(0.05)} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(2rem, 4.8vw, 3rem)', color: C.marble, lineHeight: 1.16 }}>
                  {t.cta?.heading || 'Ready to Start Your Project?'}
                </motion.h2>
              </div>
              <motion.p variants={mv.slideUp(0.12)} className="mx-auto max-w-lg leading-relaxed text-sm" style={{ color: C.muted }}>
                {t.cta?.body || 'Whether you are buying, building, renovating or designing — our team guides you from the first conversation to final delivery.'}
              </motion.p>
              <motion.div variants={mv.slideUp(0.20)} className="mt-12 flex flex-wrap items-center justify-center gap-5">
                <button
  type="button"
  onClick={scrollToServices}
  className="rounded-full px-11 py-4 text-xs font-semibold uppercase tracking-widest text-white transition-all duration-300 hover:opacity-85"
  style={{
    backgroundColor: C.green,
    border: 'none',
    cursor: 'pointer',
  }}
>
  {t.cta?.browse || 'Explore Services'}
</button>
                <Link to="/contact" className="rounded-full border px-11 py-4 text-xs font-semibold uppercase tracking-widest transition-all duration-300 hover:opacity-75"
                  style={{ borderColor: 'rgba(var(--vk-gold-rgb), 0.38)', color: C.marble }}>
                  {t.cta?.contact || 'Contact Us'}
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

      </main>
    </>
  )
}
