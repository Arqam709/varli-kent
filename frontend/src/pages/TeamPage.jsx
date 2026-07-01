import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useLanguage } from '../contexts/LanguageContext'
import api from '../lib/api'
import { C } from '../contexts/ThemeContext'

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const fadeUp = {
  hidden: { opacity: 0, y: 36 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.65, delay: i * 0.09, ease: [0.22, 1, 0.36, 1] } }),
}

export default function TeamPage() {
  const { t } = useLanguage()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/team')
      .then(r => setMembers(r.data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: C.charcoal }}>

      {/* ── Hero — DARK ── */}
      <section className="relative overflow-hidden" style={{ backgroundColor: C.charcoal }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
        <div className="relative z-10 mx-auto max-w-5xl px-6 pt-36 pb-24 text-center">
          <motion.p
            variants={fadeUp} initial="hidden" animate="visible" custom={0}
            style={{ color: C.gold, letterSpacing: '0.5em', fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase' }}
            className="mb-5"
          >
            {t.teamPage?.label || 'The People Behind VarliKent'}
          </motion.p>

          <motion.h1
            variants={fadeUp} initial="hidden" animate="visible" custom={1}
            style={{ fontFamily: 'Cinzel, serif', color: C.marble, fontSize: 'clamp(2.5rem, 7vw, 5rem)', lineHeight: 1.05, fontWeight: 700 }}
          >
            {t.teamPage?.heading || 'Our Team'}
          </motion.h1>

          {/* Gold ornament */}
          <motion.div
            variants={fadeUp} initial="hidden" animate="visible" custom={2}
            className="my-8 flex items-center justify-center gap-3"
          >
            <div style={{ width: 40, height: 1, background: 'linear-gradient(to right, transparent, rgba(201,163,90,0.7))' }} />
            <div style={{ width: 6, height: 6, backgroundColor: C.gold, borderRadius: '50%', opacity: 0.8 }} />
            <div style={{ width: 56, height: 1, backgroundColor: C.gold, opacity: 0.9 }} />
            <div style={{ width: 6, height: 6, backgroundColor: C.gold, borderRadius: '50%', opacity: 0.8 }} />
            <div style={{ width: 40, height: 1, background: 'linear-gradient(to left, transparent, rgba(201,163,90,0.7))' }} />
          </motion.div>

          <motion.p
            variants={fadeUp} initial="hidden" animate="visible" custom={3}
            className="mx-auto max-w-xl text-base leading-relaxed"
            style={{ color: 'rgba(246,243,237,0.55)' }}
          >
            {t.teamPage?.subtitle || 'Architects, designers, engineers and advisors united by a passion for exceptional spaces.'}
          </motion.p>
        </div>
      </section>

      <GoldDivider />

      {/* ── Members — light ── */}
      <section className="py-20 md:py-28" style={{ backgroundColor: C.softWhite }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">

          {loading ? (
            <div className="flex justify-center py-24">
              <div className="h-10 w-10 animate-spin rounded-full border-2"
                style={{ borderColor: C.gold, borderTopColor: 'transparent' }} />
            </div>
          ) : members.length === 0 ? (
            <div className="py-24 text-center">
              <p style={{ color: 'rgba(246,243,237,0.3)', letterSpacing: '0.3em', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                {t.teamPage?.empty || 'Team members coming soon.'}
              </p>
            </div>
          ) : (
            <div className={`grid gap-6 sm:gap-8 ${
              members.length === 1 ? 'max-w-sm mx-auto' :
              members.length === 2 ? 'sm:grid-cols-2 max-w-2xl mx-auto' :
              'sm:grid-cols-2 lg:grid-cols-3'
            }`}>
              {members.map((m, i) => (
                <motion.div
                  key={m._id}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={i % 3}
                  className="group relative overflow-hidden"
                  style={{
                    borderRadius: '1.25rem',
                    border: '1px solid rgba(201,163,90,0.12)',
                    backgroundColor: C.darkGrey,
                    boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
                  }}
                >
                  {/* Photo */}
                  <div className="relative overflow-hidden" style={{ aspectRatio: '3/4' }}>
                    {m.photo ? (
                      <img
                        src={m.photo}
                        alt={m.name}
                        className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ backgroundColor: '#252522' }}
                      >
                        <span style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(3rem, 8vw, 5rem)', color: 'rgba(201,163,90,0.25)', fontWeight: 700 }}>
                          {m.name?.[0]?.toUpperCase() || 'V'}
                        </span>
                      </div>
                    )}

                    {/* Dark gradient overlay — always visible at bottom */}
                    <div
                      className="absolute inset-x-0 bottom-0"
                      style={{
                        height: '55%',
                        background: 'linear-gradient(to top, rgba(30,30,28,0.98) 0%, rgba(30,30,28,0.6) 50%, transparent 100%)',
                      }}
                    />

                    {/* Name + role pinned to bottom of photo */}
                    <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
                      <div className="flex items-end justify-between">
                        <div>
                          <p style={{ fontFamily: 'Cinzel, serif', color: C.marble, fontSize: 'clamp(0.95rem, 2vw, 1.1rem)', fontWeight: 600, lineHeight: 1.2 }}>
                            {m.name}
                          </p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: C.gold }}>
                            {m.role}
                          </p>
                        </div>
                        {/* Gold accent line */}
                        <div style={{ width: 28, height: 1, backgroundColor: C.gold, opacity: 0.5, flexShrink: 0 }} />
                      </div>
                    </div>

                    {/* Gold border reveal on hover */}
                    <div
                      className="absolute inset-0 pointer-events-none transition-opacity duration-500 opacity-0 group-hover:opacity-100"
                      style={{ border: '1px solid rgba(201,163,90,0.35)', borderRadius: '1.25rem' }}
                    />
                  </div>

                  {/* Bio section — only if bio exists */}
                  {m.bio && (
                    <div
                      className="px-6 py-5"
                      style={{ borderTop: '1px solid rgba(201,163,90,0.1)' }}
                    >
                      <p className="text-xs leading-relaxed" style={{ color: 'rgba(246,243,237,0.45)' }}>
                        {m.bio}
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      <GoldDivider />

      {/* ── Bottom CTA strip ── */}
      <section className="py-16 text-center" style={{ backgroundColor: '#161614' }}>
        <p style={{ color: 'rgba(246,243,237,0.2)', letterSpacing: '0.4em', fontSize: '0.6rem', textTransform: 'uppercase' }}>
          Varlikent
        </p>
        <p className="mt-3 text-sm" style={{ fontFamily: 'Cinzel, serif', color: 'rgba(246,243,237,0.35)' }}>
          Architecture · Construction · Real Estate
        </p>
      </section>

    </div>
  )
}
