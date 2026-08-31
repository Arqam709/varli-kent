import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import usePageContent from '../lib/usePageContent'
import { sectionBackground } from '../lib/pageContentResolve'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import { C } from '../contexts/ThemeContext'
import ShowroomCarousel from '../components/ShowroomCarousel'
import api from '../lib/api'
import useSeo from '../lib/useSeo'


const fadeUp = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.7 } } }

const DESIGN_STYLES = [
  { id: 'contemporary', label: 'Contemporary', bg: '#252523', materials: 'Marble · Glass · Steel' },
  { id: 'warm', label: 'Warm Modern', bg: '#2a201a', materials: 'Oak · Linen · Terracotta' },
  { id: 'coastal', label: 'Coastal', bg: '#1a2228', materials: 'Driftwood · Sea Blue · Rattan' },
  { id: 'classic', label: 'Classic', bg: '#221e18', materials: 'Velvet · Brass · Dark Wood' },
]

const DEFAULT_WALL_FINISHES = [
  { label: 'Ivory', color: '#f5f0e8' },
  { label: 'Warm Sand', color: '#e8ddd0' },
  { label: 'Slate Blue', color: '#8fa3b1' },
  { label: 'Sage', color: '#8fa88a' },
  { label: 'Charcoal', color: '#3d4655' },
  { label: 'Navy', color: '#202a36' },
]

const DEFAULT_FLOOR_FINISHES = [
  { label: 'Dark Oak', color: '#4a3728' },
  { label: 'Light Ash', color: '#c4a882' },
  { label: 'Concrete', color: '#8a8a8a' },
  { label: 'Marble', color: '#efe9e1' },
]

const DEFAULT_MATERIALS = [
  { name: 'Calacatta Marble', color: '#f2ede8' },
  { name: 'Raw Concrete', color: '#8a8a8a' },
  { name: 'Dark Walnut', color: '#3d2b1f' },
  { name: 'Aged Brass', color: C.gold },
  { name: 'Nero Stone', color: '#1a1a1a' },
  { name: 'Linen White', color: '#f8f5f0' },
  { name: 'Forest Green', color: C.green },
  { name: 'Midnight Navy', color: '#202a36' },
]

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

const sanitizedImage = (value) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? value.trim() : ''
  } catch {
    return ''
  }
}

const sanitizedMaterials = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) return null
  if (!value.every(item => item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.name === 'string' && item.name.trim() && item.name.trim().length <= 80
    && typeof item.color === 'string' && HEX_COLOR.test(item.color))) return null
  return value.map(item => ({ name: item.name.trim(), color: item.color, image: sanitizedImage(item.image) }))
}

const sanitizedFinishes = (value, maximum) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) return null
  if (!value.every(item => item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.label === 'string' && item.label.trim() && item.label.trim().length <= 80
    && typeof item.color === 'string' && HEX_COLOR.test(item.color))) return null
  return value.map(item => ({ label: item.label.trim(), color: item.color }))
}

const useStudioPalette = (pageKey) => {
  const [overrides, setOverrides] = useState({ materials: null, wallFinishes: null, floorFinishes: null })
  useEffect(() => {
    let active = true
    api.get(`/studio-palette/${pageKey}`)
      .then(response => {
        if (!active) return
        const palette = response.data?.palette
        setOverrides({
          materials: sanitizedMaterials(palette?.materials),
          wallFinishes: sanitizedFinishes(palette?.wallFinishes, 16),
          floorFinishes: sanitizedFinishes(palette?.floorFinishes, 16),
        })
      })
      .catch(() => {})
    return () => { active = false }
  }, [pageKey])
  return {
    materials: overrides.materials || DEFAULT_MATERIALS,
    wallFinishes: overrides.wallFinishes || DEFAULT_WALL_FINISHES,
    floorFinishes: overrides.floorFinishes || DEFAULT_FLOOR_FINISHES,
  }
}

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const Glow = () => (
  <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
)

const SECTION_ORDER = ['styles', 'showroom', 'finishes', 'palette', 'services', 'cta']
const DEFAULT_BANDS = {
  styles: 'light',
  showroom: 'dark',
  finishes: 'light',
  palette: 'dark',
  services: 'light',
  cta: 'dark',
}

const SECTION_BG = {
  styles: C.softWhite,
  showroom: C.charcoal,
  finishes: C.softWhite,
  palette: C.charcoal,
  services: C.softWhite,
  cta: C.charcoal,
}
const CANONICAL_BG = { dark: C.charcoal, light: C.softWhite }

export default function InteriorDesignPage() {
  useSeo({
    title: 'Interior Design Studio — Varlikent Istanbul',
    description: "Varlikent's interior design studio creates bespoke, luxury interiors for homes and commercial spaces across Istanbul.",
    path: '/interior-design',
  })
  const { t } = useLanguage()
  const p = t.interiorPage
  const { get: cms, isSectionVisible, bandFor } = usePageContent('interior-design', SECTION_ORDER, DEFAULT_BANDS)
  const bg = (key) => sectionBackground(key, bandFor(key), DEFAULT_BANDS, SECTION_BG, CANONICAL_BG)
  const { settings } = useSiteSettings()
  const [selectedStyle, setSelectedStyle] = useState('')
  const [selectedWall, setSelectedWall] = useState('#e8ddd0')
  const [selectedFloor, setSelectedFloor] = useState('#4a3728')
  const [allImages, setAllImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)
  const { materials, wallFinishes, floorFinishes } = useStudioPalette('interior-design')

  useEffect(() => {
    setSelectedWall(current => wallFinishes.some(item => item.color === current) ? current : (wallFinishes.at(1) || wallFinishes.at(0))?.color || '')
    setSelectedFloor(current => floorFinishes.some(item => item.color === current) ? current : floorFinishes.at(0)?.color || '')
  }, [wallFinishes, floorFinishes])

  useEffect(() => {
    api.get('/showroom/interior')
      .then(r => setAllImages(r.data.images || []))
      .catch(() => setAllImages([]))
      .finally(() => setLoadingImages(false))
  }, [])

  const filteredImages = selectedStyle
    ? allImages.filter(img => !img.style || img.style === selectedStyle)
    : allImages

  const showroomEnabled = settings?.showroomEnabled?.interior !== false

  return (
    <div style={{ minHeight: '100vh' }}>

      {/* 1. Hero – DARK */}
      <section style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }}
        className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center pt-24">
        <Glow />
        <div className="absolute inset-0 blueprint-grid opacity-10 pointer-events-none" />
        <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
          className="relative z-10 flex flex-col items-center gap-6 max-w-4xl">
          <motion.p variants={fadeUp} style={{ letterSpacing: '0.5em', color: C.gold, fontSize: '0.75rem', textTransform: 'uppercase' }}>
            {cms('heroLabel', p.label)}
          </motion.p>
          <motion.h1 variants={fadeUp} style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(3rem, 10vw, 6rem)', lineHeight: 1.05, color: '#ffffff' }}>
            {cms('heroHeading', p.h1)}
          </motion.h1>
          <motion.p variants={fadeUp} className="max-w-lg text-lg leading-relaxed" style={{ color: 'rgba(246,243,237,0.6)' }}>{cms('heroSubtitle', p.subtitle)}</motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap gap-4 justify-center mt-4">
            <Link to="/contact" style={{ backgroundColor: C.gold, color: '#000' }}
              className="px-8 py-3 font-semibold tracking-wider uppercase text-sm hover:opacity-90 transition-opacity">
              {cms('heroCtaPrimary', p.ctaPrimary)}
            </Link>
            <a href="#design-styles" className="px-8 py-3 border border-white/20 text-white tracking-wider uppercase text-sm hover:border-white/50 transition-colors">
              {cms('heroCtaSecondary', p.ctaSecondary)}
            </a>
          </motion.div>
        </motion.div>
      </section>

      {isSectionVisible('styles') && <GoldDivider />}

      {/* 2. Design Style Selector – WHITE */}
      {isSectionVisible('styles') && (
      <section id="design-styles" style={{ backgroundColor: bg('styles'), color: C.charcoal, position: 'relative' }} className="py-16 md:py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {cms('stylesLabel', p.stylesLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: C.charcoal, marginBottom: '1rem' }} className="text-center">
            {cms('stylesHeading', p.stylesHeading)}
          </motion.h2>
          <p className="text-center text-sm mb-8" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>
            {cms('stylesFilterHint', p.stylesFilterHint || 'Select a style to filter the showroom')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {DESIGN_STYLES.map((style, i) => (
              <motion.button key={style.id}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                onClick={() => setSelectedStyle(selectedStyle === style.id ? '' : style.id)}
                className="flex flex-col items-start p-6 rounded-xl text-left transition-all cursor-pointer"
                style={{
                  backgroundColor: style.bg,
                  border: selectedStyle === style.id ? `1px solid ${C.gold}` : '1px solid rgba(255,255,255,0.08)',
                  outline: 'none',
                }}>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1rem', color: '#ffffff' }} className="mb-2">{style.label}</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(246,243,237,0.35)' }}>{style.materials}</p>
                {selectedStyle === style.id && (
                  <span className="mt-3 text-xs tracking-widest uppercase" style={{ color: C.gold }}>{p.selectedLabel}</span>
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('showroom') && <GoldDivider />}

      {/* 3. Showroom – DARK */}
      {isSectionVisible('showroom') && showroomEnabled && (
        <section style={{ backgroundColor: bg('showroom'), position: 'relative', overflow: 'hidden' }} className="py-20 px-6">
          <Glow />
          <div className="max-w-6xl mx-auto relative z-10">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
              {cms('showroomLabel', p.showroomLabel || 'Our Work')}
            </motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)', color: '#ffffff', marginBottom: '0.75rem', textAlign: 'center' }}>
              {cms('showroomHeading', p.showroomHeading || 'Interior Showcase')}
            </motion.h2>
            {selectedStyle && (
              <p className="text-center text-xs tracking-widest uppercase mb-8" style={{ color: C.gold }}>
                {DESIGN_STYLES.find(s => s.id === selectedStyle)?.label}
              </p>
            )}
            {!selectedStyle && <div className="mb-8" />}
            <ShowroomCarousel images={filteredImages} loading={loadingImages} bgColor='#1E1E1C' />
          </div>
        </section>
      )}

      {isSectionVisible('finishes') && <GoldDivider />}

      {/* 4. Wall & Floor Selector – WHITE */}
      {isSectionVisible('finishes') && (
      <section style={{ backgroundColor: bg('finishes'), color: C.charcoal, position: 'relative' }} className="py-16 md:py-28 px-6">
        <div className="max-w-3xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {cms('finishesLabel', p.finishesLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: C.charcoal, marginBottom: '3rem' }} className="text-center">
            {cms('finishesHeading', p.finishesHeading)}
          </motion.h2>
          <div className="space-y-8">
            <div>
              <p className="text-xs tracking-[0.3em] uppercase mb-4" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>{p.wallLabel}</p>
              <div className="flex flex-wrap gap-3">
                {wallFinishes.map((f, index) => (
                  <button key={`wall-finish-${index}`} onClick={() => setSelectedWall(f.color)} title={f.label}
                    className="flex flex-col items-center gap-1.5 cursor-pointer group">
                    <div className="h-10 w-10 rounded-full transition-transform group-hover:scale-110"
                      style={{ backgroundColor: f.color, outline: selectedWall === f.color ? `2px solid ${C.gold}` : '1px solid rgba(30,30,28,0.15)', outlineOffset: 3, transform: selectedWall === f.color ? 'scale(1.1)' : '' }} />
                    <span className="text-xs" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs tracking-[0.3em] uppercase mb-4" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>{p.floorLabel}</p>
              <div className="flex flex-wrap gap-3">
                {floorFinishes.map((f, index) => (
                  <button key={`floor-finish-${index}`} onClick={() => setSelectedFloor(f.color)} title={f.label}
                    className="flex flex-col items-center gap-1.5 cursor-pointer group">
                    <div className="h-10 w-10 rounded-full transition-transform group-hover:scale-110"
                      style={{ backgroundColor: f.color, outline: selectedFloor === f.color ? `2px solid ${C.gold}` : '1px solid rgba(30,30,28,0.15)', outlineOffset: 3, transform: selectedFloor === f.color ? 'scale(1.1)' : '' }} />
                    <span className="text-xs" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="mt-6 overflow-hidden rounded-xl" style={{ height: 80 }}>
              <div className="h-1/2 transition-colors duration-500" style={{ backgroundColor: selectedWall }} />
              <div className="h-1/2 transition-colors duration-500" style={{ backgroundColor: selectedFloor }} />
            </motion.div>
            <p className="text-xs text-center tracking-wider" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>{cms('previewLabel', p.previewLabel)}</p>
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('palette') && <GoldDivider />}

      {/* 5. Material Palette – DARK */}
      {isSectionVisible('palette') && (
      <section style={{ backgroundColor: bg('palette'), position: 'relative', overflow: 'hidden' }} className="py-16 md:py-28 px-6">
        <Glow />
        <div className="max-w-5xl mx-auto relative z-10">
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: '#ffffff', marginBottom: '3rem' }} className="text-center">
            {cms('paletteHeading', p.paletteHeading)}
          </motion.h2>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {materials.map((m, i) => (
              <motion.div key={`material-${i}`} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.05 }} className="flex flex-col items-center gap-2">
                <div className="w-full aspect-square rounded-lg bg-cover bg-center" style={{ backgroundColor: m.color, backgroundImage: m.image ? `url(${m.image})` : undefined, border: '1px solid rgba(255,255,255,0.08)' }} />
                <span className="text-xs tracking-wider text-center uppercase leading-tight" style={{ color: 'rgba(246,243,237,0.35)' }}>{m.name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('services') && <GoldDivider />}

      {/* 6. Services – WHITE */}
      {isSectionVisible('services') && (
      <section style={{ backgroundColor: bg('services'), color: C.charcoal, position: 'relative' }} className="py-16 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3">
            {cms('servicesLabel', p.servicesLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: C.charcoal, marginBottom: '3rem' }}>
            {cms('servicesHeading', p.servicesHeading)}
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {p.services.map((svc, i) => (
              <motion.div key={svc.num} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }}
                className="p-8 rounded-xl transition-colors"
                style={{ backgroundColor: '#fff', border: '1px solid rgba(var(--vk-green-rgb), 0.15)' }}>
                <div style={{ fontFamily: 'Cinzel, serif', fontSize: '3.5rem', color: 'rgba(var(--vk-dark-rgb), 0.05)', lineHeight: 1 }} className="mb-4">{svc.num}</div>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.1rem', color: C.charcoal }} className="mb-3">{cms(`service${i + 1}Title`, svc.title)}</h3>
                <p style={{ color: 'rgba(var(--vk-dark-rgb), 0.6)' }} className="leading-relaxed">{cms(`service${i + 1}Desc`, svc.desc)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('cta') && <GoldDivider />}

      {/* 7. CTA – DARK */}
      {isSectionVisible('cta') && (
      <section style={{ backgroundColor: bg('cta'), position: 'relative', overflow: 'hidden' }} className="py-14 md:py-24 text-center px-6">
        <Glow />
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="relative z-10">
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: '#ffffff' }} className="mb-4">{cms('ctaHeading', p.ctaHeading)}</h2>
          <p style={{ color: 'rgba(246,243,237,0.55)' }} className="mb-8 max-w-md mx-auto">{cms('ctaBody', p.ctaBody)}</p>
          <Link to="/contact" style={{ backgroundColor: C.gold, color: '#000' }}
            className="inline-block px-10 py-4 text-sm font-semibold uppercase tracking-wider hover:opacity-90 transition-opacity">
            {cms('ctaBtn', p.ctaBtn)}
          </Link>
        </motion.div>
      </section>
      )}

    </div>
  )
}
