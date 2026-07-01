import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import ConstructionClipViewer from '../components/three/ConstructionClipViewer'
import ShowroomCarousel from '../components/ShowroomCarousel'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import { C } from '../contexts/ThemeContext'

const fadeUp = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } } }
const stagger = { visible: { transition: { staggerChildren: 0.12 } } }

const DEFAULT_SERVICES = [
  { num: '01', title: 'General Contracting', desc: 'Turn-key construction for residential, commercial and mixed-use developments.' },
  { num: '02', title: 'Structural Works', desc: 'Reinforced concrete and steel frame solutions built to seismic zone standards.' },
  { num: '03', title: 'MEP Engineering', desc: 'Mechanical, electrical and plumbing systems fully integrated into the build.' },
  { num: '04', title: 'Envelope & Façade', desc: 'Glass curtain walls, cladding systems and high-performance insulation.' },
]

const DEFAULT_PROCESS = [
  { step: '01', label: 'Site Survey' },
  { step: '02', label: 'Foundation' },
  { step: '03', label: 'Structural Frame' },
  { step: '04', label: 'Fit-Out' },
  { step: '05', label: 'Handover' },
]

const DEFAULT_SEISMIC = [
  { title: 'Reinforced Concrete Frames', desc: 'Ductile reinforced concrete systems designed to absorb and dissipate seismic energy without structural failure.' },
  { title: 'Steel Structural Reinforcement', desc: 'Structural steel bracing and moment-resisting frames integrated where required for additional lateral stability.' },
  { title: 'Seismic Zone Compliance', desc: "All designs follow current Turkish Building Earthquake Code (TBDY) standards for Istanbul's seismic zone classification." },
  { title: 'Foundation Safety Analysis', desc: 'Soil studies and foundation engineering calibrated to local ground conditions before any excavation begins.' },
  { title: 'Independent Engineering Supervision', desc: 'Licensed structural engineers inspect and sign off on every load-bearing milestone during construction.' },
  { title: 'Material Quality Verification', desc: 'Concrete strength testing, rebar certification, and batch quality checks at every pour.' },
]

const DEFAULT_PHASES = [
  { label: 'Foundation & Groundwork', pct: 100 },
  { label: 'Structural Frame', pct: 100 },
  { label: 'Envelope & Façade', pct: 78 },
  { label: 'MEP Systems', pct: 55 },
  { label: 'Interior Fit-Out', pct: 30 },
  { label: 'Landscaping & Handover', pct: 0 },
]

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const Glow = () => (
  <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
)

export default function ConstructionPage() {
  const { t } = useLanguage()
  const p = t.constructionPage
  const { settings } = useSiteSettings()
  const [project, setProject] = useState(null)
  const [images, setImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)

  useEffect(() => {
    api.get('/projects/featured').then(res => { if (res.data.project) setProject(res.data.project) }).catch(() => {})
    api.get('/showroom/construction')
      .then(r => setImages(r.data.images || []))
      .catch(() => setImages([]))
      .finally(() => setLoadingImages(false))
  }, [])

  const services = p.services || DEFAULT_SERVICES
  const processSteps = p.processSteps || DEFAULT_PROCESS
  const seismicItems = p.seismicItems || DEFAULT_SEISMIC

  const activePhases = project?.phases?.length
    ? [...project.phases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : DEFAULT_PHASES
  const projectName = project?.name || 'Bosphorus Residences — Phase II'
  const projectCompletion = project?.completion || 'Q3 2026'
  const showroomEnabled = settings?.showroomEnabled?.construction !== false

  return (
    <div style={{ minHeight: '100vh' }}>

      {/* 1. Hero – DARK */}
      <section style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }}
        className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <Glow />
        <div className="absolute inset-0 blueprint-grid opacity-10 pointer-events-none" />
        <motion.div initial="hidden" animate="visible" variants={stagger}
          className="relative z-10 flex flex-col items-center gap-6 max-w-4xl">
          <motion.p variants={fadeUp} style={{ letterSpacing: '0.5em', color: C.gold, fontSize: '0.75rem', textTransform: 'uppercase' }}>
            {p.label}
          </motion.p>
          <motion.h1 variants={fadeUp}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(3rem, 10vw, 6rem)', lineHeight: 1.05, color: '#ffffff' }}>
            {p.h1}
          </motion.h1>
          <motion.p variants={fadeUp} className="max-w-lg text-lg leading-relaxed" style={{ color: 'rgba(246,243,237,0.6)' }}>{p.subtitle}</motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap gap-4 justify-center mt-4">
            <Link to="/contact" style={{ backgroundColor: C.gold, color: '#000000' }}
              className="px-8 py-3 font-semibold tracking-wider uppercase text-sm transition-opacity hover:opacity-90">
              {p.ctaPrimary}
            </Link>
            <a href="#progress" className="px-8 py-3 border border-white/20 text-white tracking-wider uppercase text-sm hover:border-white/50 transition-colors">
              {p.ctaSecondary}
            </a>
          </motion.div>
        </motion.div>
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10">
          <span className="text-xs tracking-[0.3em] uppercase" style={{ color: 'rgba(246,243,237,0.3)' }}>{p.scroll}</span>
          <motion.div
            animate={{ scaleY: [0, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 1, height: 48, backgroundColor: C.gold, transformOrigin: 'top' }}
          />
        </div>
      </section>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 2. Construction Viewer + Progress – LIGHT */}
      <div style={{ backgroundColor: C.softWhite, position: 'relative', overflow: 'hidden' }}>
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} transition={{ duration: 0.8 }} viewport={{ once: true }}
          className="relative z-10">
          <div className="text-center px-6 py-14">
            <p style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3">{p.viewerLabel}</p>
            <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)', color: C.charcoal }}>{p.viewerHeading}</h2>
            <p className="max-w-xl mx-auto mt-4 leading-relaxed" style={{ color: 'rgba(var(--vk-dark-rgb), 0.55)' }}>{p.viewerDesc}</p>
          </div>
          <ConstructionClipViewer />
        </motion.div>

        {/* Project Progress */}
        <section id="progress" className="py-16 md:py-28 px-6 relative z-10">
          <div className="max-w-2xl mx-auto">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3">
              {p.progressLabel}
            </motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.3rem, 3vw, 1.8rem)', color: C.charcoal, marginBottom: '0.5rem' }}>
              {projectName}
            </motion.h2>
            <p className="text-sm mb-12 tracking-wide" style={{ color: 'rgba(var(--vk-dark-rgb), 0.45)' }}>{p.completionLabel} {projectCompletion}</p>
            <div className="space-y-6">
              {activePhases.map((phase, i) => (
                <motion.div key={phase.label} initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5 }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm" style={{ color: phase.pct === 100 ? C.charcoal : 'rgba(var(--vk-dark-rgb), 0.45)' }}>{phase.label}</span>
                    <span className="text-sm font-mono" style={{ color: phase.pct > 0 ? C.gold : 'rgba(var(--vk-dark-rgb), 0.2)' }}>{phase.pct}%</span>
                  </div>
                  <div className="h-px w-full overflow-hidden" style={{ backgroundColor: 'rgba(var(--vk-dark-rgb), 0.10)' }}>
                    <motion.div
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: phase.pct / 100 }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.2, delay: i * 0.1, ease: 'easeOut' }}
                      style={{ transformOrigin: 'left', backgroundColor: phase.pct === 100 ? C.green : C.gold, height: '1px' }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 3. Services – WHITE */}
      <section style={{ backgroundColor: C.softWhite, color: C.charcoal, position: 'relative' }} className="py-16 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3">
            {p.servicesLabel}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: C.charcoal, marginBottom: '3rem' }}>
            {p.servicesHeading}
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {services.map((svc, i) => (
              <motion.div key={svc.num} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }}
                className="p-8 rounded-xl transition-colors"
                style={{ backgroundColor: '#fff', border: '1px solid rgba(var(--vk-green-rgb), 0.15)' }}>
                <div style={{ fontFamily: 'Cinzel, serif', fontSize: '3.5rem', color: 'rgba(var(--vk-dark-rgb), 0.05)', lineHeight: 1 }} className="mb-4">{svc.num}</div>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.1rem', color: C.charcoal }} className="mb-3">{svc.title}</h3>
                <p style={{ color: 'rgba(var(--vk-dark-rgb), 0.6)' }} className="leading-relaxed">{svc.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 4. Process Timeline – DARK */}
      <section style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }} className="py-16 md:py-28 px-6">
        <Glow />
        <div className="max-w-5xl mx-auto relative z-10">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {p.processLabel}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: '#ffffff', marginBottom: '4rem' }} className="text-center">
            {p.processHeading}
          </motion.h2>
          <div className="relative flex justify-between items-start">
            <div className="absolute top-4 left-0 right-0 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            {processSteps.map((s, i) => (
              <motion.div key={s.step || i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.12 }}
                className="flex flex-col items-center gap-3 relative z-10 flex-1">
                <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-mono"
                  style={{ backgroundColor: C.gold, color: '#000' }}>{s.step}</div>
                <span className="text-xs tracking-wider text-center uppercase" style={{ color: 'rgba(246,243,237,0.5)' }}>{s.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 5. Seismic Safety – WHITE */}
      <section style={{ backgroundColor: C.softWhite, color: C.charcoal, position: 'relative' }} className="py-16 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3">
            {p.seismicLabel}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: C.charcoal, marginBottom: '1.5rem' }}>
            {p.seismicHeading}
          </motion.h2>
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: 'rgba(var(--vk-dark-rgb), 0.6)' }} className="max-w-2xl leading-relaxed mb-12">
            {p.seismicBody}
          </motion.p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {seismicItems.map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5 }}
                className="p-7 rounded-xl" style={{ backgroundColor: '#fff', border: '1px solid rgba(var(--vk-green-rgb), 0.12)' }}>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1rem', color: C.charcoal }} className="mb-3">{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(var(--vk-dark-rgb), 0.6)' }}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 6. Showroom – DARK */}
      {showroomEnabled && (
        <section style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }} className="py-20 px-6">
          <Glow />
          <div className="max-w-6xl mx-auto relative z-10">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
              {p.showroomLabel || 'Our Work'}
            </motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)', color: '#ffffff', marginBottom: '2.5rem', textAlign: 'center' }}>
              {p.showroomHeading || 'Construction Showcase'}
            </motion.h2>
            <ShowroomCarousel images={images} loading={loadingImages} bgColor='#1E1E1C' />
          </div>
        </section>
      )}

      {/* Gold Divider */}
      <GoldDivider />

      {/* 7. CTA – LIGHT */}
      <section style={{ backgroundColor: C.softWhite, position: 'relative', overflow: 'hidden' }} className="py-14 md:py-24 text-center px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="relative z-10">
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: C.charcoal }} className="mb-4">{p.ctaHeading}</h2>
          <p style={{ color: 'rgba(var(--vk-dark-rgb), 0.55)' }} className="mb-8 max-w-md mx-auto">{p.ctaBody}</p>
          <Link to="/contact" style={{ backgroundColor: C.charcoal, color: '#ffffff' }}
            className="inline-block px-10 py-4 text-sm font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity">
            {p.ctaBtn}
          </Link>
        </motion.div>
      </section>

    </div>
  )
}
