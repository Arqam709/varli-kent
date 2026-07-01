import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'react-toastify'
import api from '../lib/api'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import useSeo from '../lib/useSeo'
import { C } from '../contexts/ThemeContext'

const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 32 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay } },
})
const fromLeft = { hidden: { opacity: 0, x: -48 }, show: { opacity: 1, x: 0, transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1] } } }
const fromRight = { hidden: { opacity: 0, x: 48 }, show: { opacity: 1, x: 0, transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1] } } }
const vp = { once: true, margin: '-60px' }

const ContactPage = () => {
  const { t } = useLanguage()
  const c = t.contactPage || {}
  useSeo({
    title: 'Contact Us — Varlikent Istanbul',
    description: 'Get in touch with the Varlikent team. Enquire about buying, selling, renting or investing in Istanbul luxury real estate.',
    path: '/contact',
  })
  const { settings } = useSiteSettings()
  const email = settings?.email || 'info@varlikent.com'
  const phone = settings?.phone || '+90 530 123 4567'
  const whatsapp = settings?.whatsapp || '905301234567'
  const address = settings?.address || 'Nispetiye Cd. No:12, Levent, 34330 Beşiktaş/İstanbul, Türkiye'
  const mapsUrl = settings?.mapsUrl || 'https://maps.google.com/?q=Levent+Besiktas+Istanbul'

  const [form, setForm] = useState({ name: '', email: '', phone: '', interestType: 'Buying', message: '' })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/contact', form)
      setSubmitted(true)
      toast.success('Message sent! Our team will reach out soon.')
    } catch {
      toast.error('Failed to send message. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4b6741] focus:border-[#4b6741] transition-colors'
  const selectCls = inputCls + ' [&>option]:bg-[#1E1E1C] [&>option]:text-white'

  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: C.charcoal, color: '#f5f0e8' }}>

      {/* Header — DARK + green glow */}
      <div className="relative overflow-hidden pt-28 pb-16" style={{ backgroundColor: C.charcoal }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(var(--vk-green-rgb), 0.22) 0%, transparent 65%)' }} />
        <div className="relative z-10 mx-auto max-w-7xl px-6 text-center">
        <motion.p initial="hidden" animate="show" variants={fadeUp(0)}
          style={{ color: C.gold, letterSpacing: '0.45em', fontSize: '0.68rem' }} className="mb-4 uppercase">
          {c.label || 'Get in Touch'}
        </motion.p>
        <motion.h1 initial="hidden" animate="show" variants={fadeUp(0.07)}
          style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(2rem, 5vw, 3.5rem)', color: '#f5f0e8' }}>
          {c.heading || 'Contact VarliKent'}
        </motion.h1>
        <motion.div initial="hidden" animate="show" variants={fadeUp(0.14)}
          className="mx-auto my-6 flex items-center justify-center gap-3">
          <div style={{ width: 32, height: 1, background: 'linear-gradient(to right, transparent, rgba(245,240,232,0.3))' }} />
          <div style={{ width: 40, height: 1, backgroundColor: C.gold, opacity: 0.7 }} />
          <div style={{ width: 32, height: 1, background: 'linear-gradient(to left, transparent, rgba(245,240,232,0.3))' }} />
        </motion.div>
        <motion.p initial="hidden" animate="show" variants={fadeUp(0.2)}
          className="mx-auto max-w-xl text-slate-400 leading-relaxed">
          {c.subtitle || 'Our team of luxury real estate experts is ready to assist you — whether you are buying, selling, or investing in Istanbul.'}
        </motion.p>
        </div>
      </div>

      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--vk-gold) 25%, var(--vk-gold) 75%, transparent)', opacity: 0.5 }} />

      {/* Contact content */}
      <div className="pt-16 pb-4" style={{ backgroundColor: C.charcoal }}>
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 lg:grid-cols-5 items-start">

          {/* Left — contact info */}
          <motion.div initial="hidden" whileInView="show" viewport={vp} variants={fromLeft} className="lg:col-span-2 space-y-4">

            {/* Address */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-start gap-4">
                <span className="mt-0.5 shrink-0" style={{ color: C.accent }}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">{c.officeLocation || 'Main Branch'}</p>
                  <p className="text-white text-sm leading-relaxed">{address}</p>
                  <a href={mapsUrl} target="_blank" rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#4b6741] hover:text-[#C9A35A] transition-colors cursor-pointer">
                    View on Maps
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-start gap-4">
                <span className="mt-0.5 shrink-0" style={{ color: C.accent }}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">{c.emailLabel || 'Email'}</p>
                  <a href={`mailto:${email}`} className="text-white text-sm hover:text-[#C9A35A] transition-colors">{email}</a>
                </div>
              </div>
            </div>

            {/* Phone */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-start gap-4">
                <span className="mt-0.5 shrink-0" style={{ color: C.accent }}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">{c.phoneLabel || 'Phone'}</p>
                  <a href={`tel:${phone.replace(/\s/g, '')}`} className="text-white text-sm hover:text-[#C9A35A] transition-colors">{phone}</a>
                </div>
              </div>
            </div>

            {/* WhatsApp */}
            <a
              href={`https://wa.me/${whatsapp}?text=Hello%2C%20I%20am%20interested%20in%20a%20property%20from%20VarliKent.`}
              target="_blank" rel="noreferrer"
              className="flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: '#25D366' }}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.12 1.523 5.851L.057 23.535a.75.75 0 00.937.93l5.815-1.484A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.698 9.698 0 01-4.964-1.364l-.356-.213-3.694.943.975-3.605-.232-.371A9.705 9.705 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
              </svg>
              {c.whatsappBtn || 'Chat on WhatsApp'}
            </a>

            {/* Hours */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Office Hours</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Monday – Friday</span>
                  <span className="text-white">09:00 – 18:00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Saturday</span>
                  <span className="text-white">10:00 – 15:00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sunday</span>
                  <span className="text-slate-500">Closed</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right — form */}
          <motion.div initial="hidden" whileInView="show" viewport={vp} variants={fromRight} className="lg:col-span-3">
            {submitted ? (
              <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(75,103,65,0.3)' }}>
                <svg className="mx-auto h-16 w-16" style={{ color: C.accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '1.6rem', color: '#f5f0e8' }} className="mt-5 mb-3">{c.successHeading || 'Message Sent'}</h2>
                <p className="text-slate-400 text-sm leading-relaxed">{c.successBody || 'Our team will contact you within 24 hours.'}</p>
                <button
                  onClick={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', interestType: 'Buying', message: '' }) }}
                  className="mt-8 rounded-full px-8 py-3 text-xs font-semibold uppercase tracking-wider text-white transition hover:opacity-90 cursor-pointer"
                  style={{ backgroundColor: C.accent }}
                >
                  {c.sendAnother || 'Send Another Message'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="rounded-2xl p-8 space-y-5" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div>
                  <label className="block mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400" htmlFor="name">{c.nameLabel || 'Full Name'}</label>
                  <input id="name" name="name" type="text" value={form.name} onChange={handleChange}
                    placeholder={c.namePlaceholder || 'Your full name'} className={inputCls} required />
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label className="block mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400" htmlFor="email">{c.emailLabel || 'Email'}</label>
                    <input id="email" name="email" type="email" value={form.email} onChange={handleChange}
                      placeholder="you@example.com" className={inputCls} required />
                  </div>
                  <div>
                    <label className="block mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400" htmlFor="phone">{c.phoneLabel || 'Phone'}</label>
                    <input id="phone" name="phone" type="tel" value={form.phone} onChange={handleChange}
                      placeholder="+90 5xx xxx xxxx" className={inputCls} required />
                  </div>
                </div>
                <div>
                  <label className="block mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400" htmlFor="interestType">{c.interestLabel || 'I am interested in'}</label>
                  <select id="interestType" name="interestType" value={form.interestType} onChange={handleChange} className={selectCls}>
                    {(c.interests || ['Buying','Renting','Selling','Renovation','Interior Design','Architecture','General']).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400" htmlFor="message">{c.messageLabel || 'Message'}</label>
                  <textarea id="message" name="message" rows={6} value={form.message} onChange={handleChange}
                    placeholder={c.messagePlaceholder || 'Tell us how we can help...'} className={inputCls} required />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full py-4 text-xs font-semibold uppercase tracking-wider text-white transition disabled:opacity-50 cursor-pointer hover:opacity-90"
                  style={{ backgroundColor: loading ? C.deepGreen : C.accent }}
                >
                  {loading ? (c.sending || 'Sending...') : (c.sendBtn || 'Send Message')}
                </button>
                <p className="text-center text-xs text-slate-600">Your message is saved securely and our team will respond within 24 hours.</p>
              </form>
            )}
          </motion.div>
        </div>
      </div>
      </div>
    </div>
  )
}

export default ContactPage
