import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import { C } from '../contexts/ThemeContext'
import ShowroomCarousel from '../components/ShowroomCarousel'
import api from '../lib/api'

const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut', delay } },
})

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const DarkGlow = () => (
  <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
)

export default function ArchitecturePage() {
  const { t } = useLanguage()
  const p = t.architecturePage
  const { settings } = useSiteSettings()
  const [images, setImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)

  useEffect(() => {
    api.get('/showroom/architecture')
      .then(r => setImages(r.data.images || []))
      .catch(() => setImages([]))
      .finally(() => setLoadingImages(false))
  }, [])

  const showroomEnabled = settings?.showroomEnabled?.architecture !== false

  return (
    <div style={{ backgroundColor: C.charcoal, minHeight: '100vh' }}>

      {/* 1. Hero – DARK */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 text-center overflow-hidden"
        style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }}>
        <DarkGlow />
        <div className="absolute inset-0 blueprint-grid opacity-20 pointer-events-none" />
        <motion.div
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
          className="relative z-10 flex flex-col items-center gap-6 max-w-4xl"
        >
          <motion.p variants={fadeUp(0)} style={{ letterSpacing: '0.5em', color: C.gold, fontSize: '0.75rem', textTransform: 'uppercase' }}>
            {p.label}
          </motion.p>
          <motion.h1 variants={fadeUp(0.1)}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(3rem, 10vw, 6rem)', lineHeight: 1.05, color: '#ffffff' }}>
            {p.h1}
          </motion.h1>
          <motion.p variants={fadeUp(0.2)} className="max-w-lg text-lg leading-relaxed" style={{ color: 'rgba(246,243,237,0.6)' }}>
            {p.subtitle}
          </motion.p>
          <motion.div variants={fadeUp(0.3)} className="flex flex-wrap gap-4 justify-center mt-4">
            <Link to="/contact" style={{ backgroundColor: C.gold, color: '#000000' }}
              className="px-8 py-3 font-semibold tracking-wider uppercase text-sm transition-opacity hover:opacity-90">
              {p.ctaPrimary}
            </Link>
            <Link to="/properties" className="px-8 py-3 border border-white/20 text-white tracking-wider uppercase text-sm hover:border-white/50 transition-colors">
              {p.ctaSecondary}
            </Link>
          </motion.div>
        </motion.div>
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
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

      {/* 2. Showroom – WHITE */}
      {showroomEnabled && (
        <section style={{ backgroundColor: C.softWhite, color: C.charcoal, position: 'relative' }} className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
              {p.showroomLabel || 'Our Work'}
            </motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)', color: C.charcoal, marginBottom: '2.5rem', textAlign: 'center' }}>
              {p.showroomHeading || 'Architecture Showcase'}
            </motion.h2>
            <ShowroomCarousel images={images} loading={loadingImages} bgColor='#FCFAF6' />
          </div>
        </section>
      )}

      {/* Gold Divider */}
      <GoldDivider />

      {/* 3. Stats Bar – GREY */}
      <section style={{ backgroundColor: '#252523', position: 'relative' }} className="py-16">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-10 text-center">
          {[
            { number: '120+', label: 'Projects' },
            { number: '15+', label: 'Years' },
            { number: '40', label: 'Awards' },
            { number: '98%', label: 'Satisfaction' },
          ].map(stat => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} viewport={{ once: true }}>
              <div style={{ fontFamily: 'Cinzel, serif', color: '#ffffff', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', fontWeight: 700 }}>{stat.number}</div>
              <div className="text-xs tracking-widest uppercase mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 4. Services – WHITE */}
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
            {p.services.map((svc, i) => (
              <motion.div key={svc.num} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }} viewport={{ once: true }}
                className="relative p-8 rounded-xl transition-colors"
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

      {/* 5. Process Timeline – DARK */}
      <section style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }} className="py-16 md:py-28 px-6">
        <DarkGlow />
        <div className="relative z-10 max-w-5xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {p.processLabel}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: '#ffffff', marginBottom: '4rem', textAlign: 'center' }}>
            {p.processHeading}
          </motion.h2>
          <div className="relative">
            <div className="absolute top-4 left-0 right-0 hidden md:block" style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {p.processSteps.map((label, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: i * 0.12 }} viewport={{ once: true }}
                  className="flex flex-col items-center text-center">
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.gold}`,
                    backgroundColor: C.charcoal, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Cinzel, serif', color: C.gold, fontSize: '0.8rem',
                    marginBottom: '1.5rem', position: 'relative', zIndex: 1,
                  }}>{i + 1}</div>
                  <p style={{ color: 'rgba(246,243,237,0.7)' }} className="text-sm leading-snug">{label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Gold Divider */}
      <GoldDivider />

      {/* 6. CTA – LIGHT */}
      <section style={{ backgroundColor: C.softWhite, position: 'relative', overflow: 'hidden' }} className="py-14 md:py-24 px-6 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} viewport={{ once: true }} className="relative z-10 max-w-xl mx-auto">
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: C.charcoal, marginBottom: '1rem' }}>{p.ctaHeading}</h2>
          <p style={{ color: 'rgba(var(--vk-dark-rgb), 0.55)' }} className="mb-8 text-lg">{p.ctaBody}</p>
          <Link to="/contact" style={{ backgroundColor: C.charcoal, color: '#ffffff' }}
            className="inline-block px-10 py-4 font-semibold tracking-wider uppercase text-sm hover:opacity-80 transition-opacity">
            {p.ctaBtn}
          </Link>
        </motion.div>
      </section>

    </div>
  )
}
