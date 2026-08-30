import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '../contexts/LanguageContext'
import { localizedText } from '../lib/localizedText'
import usePageContent from '../lib/usePageContent'
import api from '../lib/api'
import { C } from '../contexts/ThemeContext'

const GoldDivider = () => (
  <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />
)

const fadeUp = {
  hidden: { opacity: 0, y: 36 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.65, delay: i * 0.09, ease: [0.22, 1, 0.36, 1] } }),
}

/*
 * Rich profile detail, transplanted from the donor's TeamPage.
 *
 * Donor structure kept as-is: portrait on the left, About / Their Work tabs
 * on the right, the Work tab appearing only when the member actually has
 * gallery images. Colours come from CURRENT's theme constants instead of the
 * donor's literals, and every localized value resolves through
 * localizedText() rather than the donor's own inline resolver.
 */
function MemberModal({ member, onClose, t, language }) {
  const [tab, setTab] = useState('about')
  const loc = (value) => localizedText(value, language)

  const workImages = Array.isArray(member.workImages) ? member.workImages : []
  const hasWork = workImages.length > 0

  const role = loc(member.role)
  const bio = loc(member.bio)
  const longBio = loc(member.longBio)

  // The secondary photo is the profile portrait when one exists, otherwise
  // the card photo. Never a placeholder URL — a member with neither gets the
  // same monogram the card uses.
  const image = member.secondaryPhoto || member.photo

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)

    // Locking the page behind the modal, and restoring exactly what was
    // there before rather than assuming ''.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8"
      style={{ background: 'rgba(10,10,9,0.88)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={member.name}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full border transition cursor-pointer"
        style={{ borderColor: 'rgba(246,243,237,0.25)', color: C.marble }}
        aria-label={t.teamPage?.closeProfile || 'Close profile'}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl lg:flex-row"
        style={{ background: C.darkGrey, maxHeight: '88vh' }}
        // Clicking the panel itself must not fall through to the backdrop.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 lg:w-2/5" style={{ minHeight: 260, backgroundColor: C.charcoal }}>
          {image ? (
            <img src={image} alt={member.name} className="h-full max-h-[40vh] w-full object-cover lg:max-h-[88vh]" />
          ) : (
            <div className="flex h-full min-h-[260px] w-full items-center justify-center">
              <span style={{ fontFamily: 'Cinzel, serif', fontSize: '4rem', color: 'rgba(201,163,90,0.25)', fontWeight: 700 }}>
                {member.name?.[0]?.toUpperCase() || 'V'}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto p-7 sm:p-9">
          <div>
            <h3 style={{ fontFamily: 'Cinzel, serif', color: C.marble }} className="text-2xl font-semibold">{member.name}</h3>
            {role && (
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: C.gold }}>{role}</p>
            )}
          </div>

          {hasWork && (
            <div className="mt-6 flex gap-2 rounded-full p-1" style={{ background: 'rgba(255,255,255,0.05)', width: 'fit-content' }}>
              <button
                type="button"
                onClick={() => setTab('about')}
                aria-pressed={tab === 'about'}
                className="rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition cursor-pointer"
                style={{ background: tab === 'about' ? C.gold : 'transparent', color: tab === 'about' ? C.goldText : 'rgba(246,243,237,0.6)' }}
              >
                {t.teamPage?.aboutTab || 'About'}
              </button>
              <button
                type="button"
                onClick={() => setTab('work')}
                aria-pressed={tab === 'work'}
                className="rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition cursor-pointer"
                style={{ background: tab === 'work' ? C.gold : 'transparent', color: tab === 'work' ? C.goldText : 'rgba(246,243,237,0.6)' }}
              >
                {t.teamPage?.workTab || 'Their Work'}
              </button>
            </div>
          )}

          <div className="mt-6">
            {tab === 'about' || !hasWork ? (
              <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'rgba(246,243,237,0.72)' }}>
                {longBio || bio || (t.teamPage?.noBio || 'No additional information yet.')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {workImages.map((url, i) => (
                  <div key={url || i} className="overflow-hidden rounded-lg" style={{ aspectRatio: '1', backgroundColor: C.charcoal }}>
                    <img
                      src={url}
                      alt={`${member.name} — ${i + 1}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      // One unreachable image hides itself instead of leaving
                      // a broken frame in the grid.
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
export default function TeamPage() {
  const { t, language } = useLanguage()

  // Team has no toggleable sections — its members are records owned by
  // /admin/team, not CMS content. Only the static page copy is overridable.
  const { get: cms } = usePageContent('team')

  /*
   * Wave 12A2 — role and bio are stored per language and read here.
   *
   * A pure lookup: switching language selects a different stored string and
   * makes no network request. Legacy rows still hold plain strings and
   * resolve unchanged, which is why no migration is required.
   */
  const loc = (value) => localizedText(value, language)
  const [members, setMembers] = useState([])
  const [selected, setSelected] = useState(null)

  // Resolved from the live list, so a member that disappears from a refetch
  // closes the modal instead of leaving stale data on screen.
  const selectedMember = selected ? members.find((m) => m._id === selected._id) || null : null
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
            {cms('heroLabel', t.teamPage?.label || 'The People Behind VarliKent')}
          </motion.p>

          <motion.h1
            variants={fadeUp} initial="hidden" animate="visible" custom={1}
            style={{ fontFamily: 'Cinzel, serif', color: C.marble, fontSize: 'clamp(2.5rem, 7vw, 5rem)', lineHeight: 1.05, fontWeight: 700 }}
          >
            {cms('heroHeading', t.teamPage?.heading || 'Our Team')}
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
            {cms('heroSubtitle', t.teamPage?.subtitle || 'Architects, designers, engineers and advisors united by a passion for exceptional spaces.')}
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
                {cms('emptyText', t.teamPage?.empty || 'Team members coming soon.')}
              </p>
            </div>
          ) : (
            <div className={`grid gap-6 sm:gap-8 ${
              members.length === 1 ? 'max-w-sm mx-auto' :
              members.length === 2 ? 'sm:grid-cols-2 max-w-2xl mx-auto' :
              'sm:grid-cols-2 lg:grid-cols-3'
            }`}>
              {members.map((m, i) => (
                <motion.button
                  key={m._id}
                  type="button"
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={i % 3}
                  onClick={() => setSelected(m)}
                  aria-label={`${m.name} — ${t.teamPage?.viewProfile || 'View Profile'}`}
                  className="group relative block w-full overflow-hidden text-left cursor-pointer"
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
                            {loc(m.role)}
                          </p>
                        </div>
                        {/* Gold accent line */}
                        <div style={{ width: 28, height: 1, backgroundColor: C.gold, opacity: 0.5, flexShrink: 0 }} />
                      </div>
                    </div>


                    {/* View-profile affordance, as the donor card has. */}
                    <div
                      className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
                      style={{ background: 'rgba(10,10,9,0.35)' }}
                    >
                      <span className="rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ background: C.gold, color: C.goldText }}>
                        {t.teamPage?.viewProfile || 'View Profile'}
                      </span>
                    </div>
                    {/* Gold border reveal on hover */}
                    <div
                      className="absolute inset-0 pointer-events-none transition-opacity duration-500 opacity-0 group-hover:opacity-100"
                      style={{ border: '1px solid rgba(201,163,90,0.35)', borderRadius: '1.25rem' }}
                    />
                  </div>

                  {/* Bio section — only if bio exists */}
                  {loc(m.bio) && (
                    <div
                      className="px-6 py-5"
                      style={{ borderTop: '1px solid rgba(201,163,90,0.1)' }}
                    >
                      <p className="text-xs leading-relaxed" style={{ color: 'rgba(246,243,237,0.45)' }}>
                        {loc(m.bio)}
                      </p>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/*
       * A member hidden or deleted while their profile is open would leave a
       * modal describing something the list no longer has, so selection is
       * resolved against the CURRENT list rather than the captured object.
       */}
      <AnimatePresence>
        {selectedMember && (
          <MemberModal member={selectedMember} onClose={() => setSelected(null)} t={t} language={language} />
        )}
      </AnimatePresence>

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
