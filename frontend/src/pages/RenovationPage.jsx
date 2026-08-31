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

const LIGHTING_MOOD_CONFIGS = [
  { id: 'day', filter: 'brightness(1.08) saturate(1.05)', tint: 'rgba(245,240,232,0.06)' },
  { id: 'warm', filter: 'brightness(0.96) saturate(1.15) sepia(0.12)', tint: 'rgba(var(--vk-gold-rgb), 0.10)' },
  { id: 'cool', filter: 'brightness(0.95) saturate(0.9)', tint: 'rgba(143,163,177,0.10)' },
  { id: 'night', filter: 'brightness(0.7) saturate(1.1)', tint: 'rgba(32,42,54,0.35)' },
]

const RenovationStudio = ({ p, materials, wallFinishes, floorFinishes }) => {
  const [reveal, setReveal] = useState(50)
  const [material, setMaterial] = useState(() => materials.at(0) || null)
  const [wall, setWall] = useState(() => (wallFinishes.at(1) || wallFinishes.at(0))?.color || '')
  const [floor, setFloor] = useState(() => floorFinishes.at(0)?.color || '')
  const [moodIdx, setMoodIdx] = useState(0)
  const mood = LIGHTING_MOOD_CONFIGS[moodIdx]
  const moodLabels = p.lightingMoods

  useEffect(() => {
    setMaterial(current => materials.find(item => item.name === current?.name && item.color === current?.color) || materials.at(0) || null)
    setWall(current => wallFinishes.some(item => item.color === current) ? current : (wallFinishes.at(1) || wallFinishes.at(0))?.color || '')
    setFloor(current => floorFinishes.some(item => item.color === current) ? current : floorFinishes.at(0)?.color || '')
  }, [materials, wallFinishes, floorFinishes])

  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="text-xs tracking-[0.3em] uppercase text-slate-500 mb-4 text-center">{p.dragLabel}</p>
        <div className="relative w-full overflow-hidden rounded-xl select-none" style={{ height: 380, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(0deg, #2a2a2a 0px, #2a2a2a 27px, #232323 28px)',
            filter: 'grayscale(0.4) brightness(0.7)',
          }}>
            <div className="absolute left-4 top-4 text-xs tracking-widest text-white/30 uppercase">{p.before}</div>
          </div>
          <div className="absolute inset-0 transition-[clip-path] duration-150"
            style={{
              clipPath: `inset(0 ${100 - reveal}% 0 0)`,
              background: `linear-gradient(135deg, ${material?.color || C.gold} 0%, ${wall || C.softWhite} 55%, ${floor || C.charcoal} 100%)`,
              filter: mood.filter,
            }}>
            <div className="absolute inset-0" style={{ backgroundColor: mood.tint }} />
            <div className="absolute right-4 top-4 text-xs tracking-widest uppercase" style={{ color: C.gold }}>{p.after}</div>
          </div>
          <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${reveal}%`, width: 2, backgroundColor: C.gold }} />
          <input type="range" min={0} max={100} value={reveal} onChange={(e) => setReveal(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize" aria-label="Before and after reveal slider" />
          <div className="absolute pointer-events-none flex items-center justify-center rounded-full h-9 w-9"
            style={{ left: `${reveal}%`, top: '50%', transform: 'translate(-50%, -50%)', backgroundColor: C.gold, border: `2px solid ${C.charcoal}` }}>
            <svg className="h-4 w-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l-4 3 4 3m8-6l4 3-4 3" />
            </svg>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <p className="text-xs tracking-[0.3em] uppercase text-slate-500 mb-4">{p.materialLabel}</p>
          <div className="flex flex-wrap gap-2">
            {materials.map((m, index) => (
              <button key={`material-swatch-${index}`} onClick={() => setMaterial(m)} title={m.name}
                className="h-9 w-9 rounded-full cursor-pointer transition-transform hover:scale-110"
                style={{ backgroundColor: m.color, outline: material?.name === m.name && material?.color === m.color ? `2px solid ${C.gold}` : '1px solid rgba(255,255,255,0.15)', outlineOffset: 2 }} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs tracking-[0.3em] uppercase text-slate-500 mb-4">{p.wallLabel}</p>
          <div className="flex flex-wrap gap-2">
            {wallFinishes.map((f, index) => (
              <button key={`wall-finish-${index}`} onClick={() => setWall(f.color)} title={f.label}
                className="h-9 w-9 rounded-full cursor-pointer transition-transform hover:scale-110"
                style={{ backgroundColor: f.color, outline: wall === f.color ? `2px solid ${C.gold}` : '1px solid rgba(255,255,255,0.15)', outlineOffset: 2 }} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs tracking-[0.3em] uppercase text-slate-500 mb-4">{p.floorLabel}</p>
          <div className="flex flex-wrap gap-2">
            {floorFinishes.map((f, index) => (
              <button key={`floor-finish-${index}`} onClick={() => setFloor(f.color)} title={f.label}
                className="h-9 w-9 rounded-full cursor-pointer transition-transform hover:scale-110"
                style={{ backgroundColor: f.color, outline: floor === f.color ? `2px solid ${C.gold}` : '1px solid rgba(255,255,255,0.15)', outlineOffset: 2 }} />
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs tracking-[0.3em] uppercase text-slate-500 mb-4 text-center">{p.lightingLabel}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {moodLabels.map((label, i) => (
            <button key={i} onClick={() => setMoodIdx(i)}
              className={`px-4 py-2 text-xs tracking-wider uppercase cursor-pointer transition-colors ${
                moodIdx === i ? 'border' : 'text-slate-500 border border-white/10 hover:text-white hover:border-white/30'
              }`}
              style={moodIdx === i ? { color: C.gold, borderColor: C.gold } : {}}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const fadeUp = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.7 } } }

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const SECTION_ORDER = ['transform', 'studio', 'palette', 'services', 'showroom', 'cta']
const DEFAULT_BANDS = {
  transform: 'light',
  studio: 'dark',
  palette: 'light',
  services: 'dark',
  showroom: 'light',
  cta: 'dark',
}

const SECTION_BG = {
  transform: C.softWhite,
  studio: C.charcoal,
  palette: C.softWhite,
  services: C.charcoal,
  showroom: C.softWhite,
  cta: C.charcoal,
}
const CANONICAL_BG = { dark: C.charcoal, light: C.softWhite }

export default function RenovationPage() {
  useSeo({
    title: 'Renovation Services — Varlikent Istanbul',
    description: 'Varlikent renovates luxury homes and commercial spaces across Istanbul, blending craftsmanship with modern design.',
    path: '/renovation',
  })
  const { t } = useLanguage()
  const p = t.renovationPage
  const { get: cms, isSectionVisible, bandFor } = usePageContent('renovation', SECTION_ORDER, DEFAULT_BANDS)
  const bg = (key) => sectionBackground(key, bandFor(key), DEFAULT_BANDS, SECTION_BG, CANONICAL_BG)
  const { settings } = useSiteSettings()
  const [images, setImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)
  const { materials, wallFinishes, floorFinishes } = useStudioPalette('renovation')

  useEffect(() => {
    api.get('/showroom/renovation')
      .then(r => setImages(r.data.images || []))
      .catch(() => setImages([]))
      .finally(() => setLoadingImages(false))
  }, [])

  const showroomEnabled = settings?.showroomEnabled?.renovation !== false

  return (
    <div style={{ minHeight: '100vh', backgroundColor: C.charcoal }}>

      {/* Hero – DARK */}
      <section className="relative min-h-[70vh] flex flex-col items-center justify-center px-6 text-center pt-24"
        style={{ backgroundColor: C.charcoal, position: 'relative', overflow: 'hidden' }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
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
            <a href="#renovation-studio" className="px-8 py-3 border border-white/20 text-white tracking-wider uppercase text-sm hover:border-white/50 transition-colors">
              {cms('heroCtaSecondary', p.ctaSecondary)}
            </a>
          </motion.div>
        </motion.div>
      </section>

      {isSectionVisible('transform') && <GoldDivider />}

      {/* Before / After – WHITE */}
      {isSectionVisible('transform') && (
      <section className="py-16 md:py-28 px-6" style={{ backgroundColor: bg('transform'), color: C.charcoal, position: 'relative' }}>
        <div className="max-w-5xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {cms('transformLabel', p.transformLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)', color: C.charcoal, marginBottom: '3rem' }} className="text-center">
            {cms('transformHeading', p.transformHeading)}
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              className="p-8 rounded-xl" style={{ backgroundColor: '#fff', border: '1px solid rgba(30,30,28,0.08)' }}>
              <p className="text-xs tracking-[0.3em] uppercase mb-5" style={{ color: 'rgba(var(--vk-dark-rgb), 0.55)' }}>{cms('beforeTitle', p.before)}</p>
              <ul className="space-y-3">
                {p.beforeItems.map((item, i) => (
                  <li key={item} className="flex items-center gap-3" style={{ color: 'rgba(var(--vk-dark-rgb), 0.55)' }}>
                    <span className="w-px h-4 block" style={{ backgroundColor: 'rgba(30,30,28,0.2)' }} />{cms(`beforeItem${i + 1}`, item)}
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              className="p-8 rounded-xl" style={{ backgroundColor: '#fff', border: `1px solid rgba(var(--vk-gold-rgb), 0.3)` }}>
              <p className="text-xs tracking-[0.3em] uppercase mb-5" style={{ color: C.gold }}>{cms('afterTitle', p.after)}</p>
              <ul className="space-y-3">
                {p.afterItems.map((item, i) => (
                  <li key={item} className="flex items-center gap-3" style={{ color: C.charcoal }}>
                    <span className="w-px h-4 block" style={{ backgroundColor: C.gold }} />{cms(`afterItem${i + 1}`, item)}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('studio') && <GoldDivider />}

      {/* Renovation Studio – DARK */}
      {isSectionVisible('studio') && (
      <section id="renovation-studio" className="py-16 md:py-28 px-6"
        style={{ backgroundColor: bg('studio'), position: 'relative', overflow: 'hidden' }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
        <div className="max-w-4xl mx-auto relative z-10">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {cms('studioLabel', p.studioLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: '#ffffff', marginBottom: '0.75rem' }} className="text-center">
            {cms('studioHeading', p.studioHeading)}
          </motion.h2>
          <p className="text-center text-slate-500 text-sm mb-10">{cms('studioDesc', p.studioDesc)}</p>
          <motion.div initial={{ opacity: 0, scale: 0.98 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <RenovationStudio p={p} materials={materials} wallFinishes={wallFinishes} floorFinishes={floorFinishes} />
          </motion.div>
        </div>
      </section>
      )}

      {isSectionVisible('palette') && <GoldDivider />}

      {/* Material Palette – WHITE */}
      {isSectionVisible('palette') && (
      <section className="py-16 md:py-28 px-6" style={{ backgroundColor: bg('palette'), color: C.charcoal, position: 'relative' }}>
        <div className="max-w-5xl mx-auto">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
            {cms('paletteLabel', p.paletteLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.4rem, 3.5vw, 2rem)', color: C.charcoal, marginBottom: '3rem' }} className="text-center">
            {cms('paletteHeading', p.paletteHeading)}
          </motion.h2>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {materials.map((m, i) => (
              <motion.div key={`material-${i}`} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.05 }} className="flex flex-col items-center gap-2">
                <div className="w-full aspect-square rounded-lg bg-cover bg-center" style={{ backgroundColor: m.color, backgroundImage: m.image ? `url(${m.image})` : undefined, border: '1px solid rgba(30,30,28,0.12)' }} />
                <span className="text-xs tracking-wider text-center uppercase leading-tight" style={{ color: 'rgba(var(--vk-dark-rgb), 0.5)' }}>{m.name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('services') && <GoldDivider />}

      {/* Services – DARK */}
      {isSectionVisible('services') && (
      <section className="py-16 md:py-28 px-6" style={{ backgroundColor: bg('services'), position: 'relative', overflow: 'hidden' }}>
        <div className="max-w-6xl mx-auto relative z-10">
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3">
            {cms('servicesLabel', p.servicesLabel)}
          </motion.p>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', color: '#ffffff', marginBottom: '3rem' }}>
            {cms('servicesHeading', p.servicesHeading)}
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {p.services.map((svc, i) => (
              <motion.div key={svc.num} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }}
                className="p-8 rounded-xl transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                <div style={{ fontFamily: 'Cinzel, serif', fontSize: '3.5rem', color: 'rgba(255,255,255,0.07)', lineHeight: 1 }} className="mb-4">{svc.num}</div>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.1rem', color: '#ffffff' }} className="mb-3">{cms(`service${i + 1}Title`, svc.title)}</h3>
                <p style={{ color: 'rgba(246,243,237,0.55)' }} className="leading-relaxed">{cms(`service${i + 1}Desc`, svc.desc)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      )}

      {isSectionVisible('showroom') && <GoldDivider />}

      {/* Showroom – WHITE */}
      {isSectionVisible('showroom') && showroomEnabled && (
        <section className="py-20 px-6" style={{ backgroundColor: bg('showroom'), color: C.charcoal, position: 'relative' }}>
          <div className="max-w-6xl mx-auto">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              style={{ color: C.gold, letterSpacing: '0.4em', fontSize: '0.7rem', textTransform: 'uppercase' }} className="mb-3 text-center">
              {cms('showroomLabel', p.showroomLabel || 'Our Work')}
            </motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
              style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)', color: C.charcoal, marginBottom: '2.5rem', textAlign: 'center' }}>
              {cms('showroomHeading', p.showroomHeading || 'Renovation Showcase')}
            </motion.h2>
            <ShowroomCarousel images={images} loading={loadingImages} bgColor='#FCFAF6' />
          </div>
        </section>
      )}

      {isSectionVisible('cta') && <GoldDivider />}

      {/* Final CTA – DARK */}
      {isSectionVisible('cta') && (
      <section className="py-14 md:py-24 text-center px-6" style={{ backgroundColor: bg('cta'), position: 'relative', overflow: 'hidden' }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="relative z-10">
          <span className="section-rule mx-auto block mb-8" />
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
