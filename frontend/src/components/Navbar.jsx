import { useState, useEffect, useRef } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme, C } from '../contexts/ThemeContext'

const ChevronIcon = ({ open }) => (
  <svg
    className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    fill="none" stroke="currentColor" viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

const SERVICE_ROUTES = [
  { to: '/architecture', key: 'architecture' },
  { to: '/construction', key: 'construction' },
  { to: '/renovation', key: 'renovation' },
  { to: '/interior-design', key: 'interior' },
]

const NAV_ROUTES = [
  { to: '/', key: 'home', end: true },
  { to: '/properties', key: 'properties' },
]

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'tr', label: 'TR' },
  { code: 'ar', label: 'AR' },
]

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false)
  const { isLoggedIn, isAdmin, user, logout } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const userMenuRef = useRef(null)
  const servicesRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false)
      if (servicesRef.current && !servicesRef.current.contains(e.target)) setServicesOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setServicesOpen(false)
    setMobileOpen(false)
    setMobileServicesOpen(false)
  }, [location.pathname])

  const closeMobile = () => setMobileOpen(false)

  const handleLogout = async () => {
    await logout()
    setUserMenuOpen(false)
    navigate('/')
  }

  const { theme } = useTheme()
  const isDarkNav = theme === 'dark' || theme === 'classic' || theme === 'forest'
  const isLight = scrolled && !isDarkNav

  return (
    <>
    <nav
      aria-label="Main navigation"
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={scrolled
        ? {
            backgroundColor: C.navBg,
            backdropFilter: 'blur(12px)',
            borderBottom: `1px solid rgba(0,0,0,0.06)`,
            boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
            backgroundImage: isDarkNav
              ? 'radial-gradient(ellipse 80% 180% at 50% -30%, rgba(var(--vk-green-rgb), 0.28) 0%, transparent 70%)'
              : undefined,
          }
        : { backgroundColor: 'transparent' }
      }
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group" aria-label="VarliKent home">
          <span
            style={{ fontFamily: 'Cinzel, serif', color: isLight ? C.textDark : '#ffffff' }}
            className="text-lg font-bold tracking-[0.2em] transition-colors duration-300"
          >
            VARLI<span style={{ color: C.accent }}>KENT</span>
          </span>
        </Link>

        {/* ── Desktop Nav ── */}
        <div className="hidden items-center gap-8 lg:flex">
          {NAV_ROUTES.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className="text-xs font-medium uppercase tracking-[0.15em] transition-colors duration-200"
              style={({ isActive }) => ({ color: isActive ? C.accent : (scrolled ? (isDarkNav ? 'rgba(255,255,255,0.85)' : C.textDark) : 'rgba(255,255,255,0.8)') })}
            >
              {t.nav[link.key]}
            </NavLink>
          ))}

          {/* Services Dropdown */}
          <div className="relative" ref={servicesRef}>
            <button
              onClick={() => setServicesOpen((v) => !v)}
              aria-expanded={servicesOpen}
              aria-haspopup="true"
              className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.15em] transition-colors duration-200 cursor-pointer"
              style={{ color: scrolled ? (isDarkNav ? 'rgba(255,255,255,0.85)' : C.textDark) : 'rgba(255,255,255,0.8)' }}
            >
              {t.nav.services}
              <ChevronIcon open={servicesOpen} />
            </button>

            <AnimatePresence>
              {servicesOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-0 mt-3 w-56 rounded-xl py-2 shadow-2xl"
                  style={{ backgroundColor: C.charcoal, border: `1px solid rgba(255,255,255,0.08)` }}
                >
                  {SERVICE_ROUTES.map((s) => (
                    <Link
                      key={s.to}
                      to={s.to}
                      className="block px-5 py-3 text-xs font-medium uppercase tracking-[0.12em] transition-colors"
                      style={{ color: C.muted }}
                    >
                      {t.services?.items?.[s.key]?.label || s.key}
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {[{ to: '/about', key: 'about' }, { to: '/team', key: 'team' }, { to: '/contact', key: 'contact' }].map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className="text-xs font-medium uppercase tracking-[0.15em] transition-colors duration-200"
              style={({ isActive }) => ({ color: isActive ? C.accent : (scrolled ? (isDarkNav ? 'rgba(255,255,255,0.85)' : C.textDark) : 'rgba(255,255,255,0.8)') })}
            >
              {t.nav[link.key]}
            </NavLink>
          ))}
        </div>

        {/* ── Desktop Auth + Language ── */}
        <div className="hidden items-center gap-4 lg:flex">
          <div
            className="flex items-center gap-0.5 rounded-full overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {LANGS.map((lang) => (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code)}
                aria-label={`Switch to ${lang.label}`}
                className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                  language === lang.code
                    ? 'bg-[#4b6741] text-white'
                    : isLight ? 'text-slate-500 hover:text-slate-800' : 'text-white/40 hover:text-white'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>

          {isLoggedIn ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] transition-colors cursor-pointer"
                style={{ color: scrolled ? (isDarkNav ? 'rgba(255,255,255,0.85)' : C.textDark) : 'rgba(255,255,255,0.8)' }}
              >
                {user?.avatar
                  ? <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                  : <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--t-accent)' }}>{user?.name?.[0]?.toUpperCase() || 'U'}</span>
                }
                {user?.name?.split(' ')[0]}
                <ChevronIcon open={userMenuOpen} />
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 mt-3 w-52 rounded-xl border border-black/8 bg-white py-2 shadow-2xl"
                  >
                    <Link to="/favourites" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.1em] text-slate-600 hover:bg-slate-50 hover:text-[#4b6741]">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                      {t.nav.favourites}
                    </Link>
                    <Link to="/settings" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.1em] text-slate-600 hover:bg-slate-50 hover:text-[#4b6741]">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Settings
                    </Link>
                    {isAdmin && (
                      <Link to="/admin/dashboard" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.1em] text-slate-600 hover:bg-slate-50 hover:text-[#4b6741]">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                        {t.nav.dashboard}
                      </Link>
                    )}
                    <div className="my-1 border-t border-slate-100" />
                    <button onClick={handleLogout} className="flex w-full items-center gap-3 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.1em] text-red-500 hover:bg-red-50 cursor-pointer">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                      {t.nav.signOut}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              <Link
                to="/login"
                className="text-xs font-medium uppercase tracking-[0.15em] transition-colors"
                style={{ color: scrolled ? (isDarkNav ? 'rgba(255,255,255,0.85)' : C.textDark) : 'rgba(255,255,255,0.8)' }}
              >
                {t.nav.signIn}
              </Link>
              <Link
                to="/register"
                className="rounded-full px-5 py-2.5 text-xs font-medium uppercase tracking-[0.12em] text-white transition-colors"
                style={{ backgroundColor: C.accent }}
              >
                {t.nav.register}
              </Link>
            </>
          )}
        </div>

        {/* ── Mobile Hamburger ── */}
        {/* ── Mobile Hamburger ── */}
<button
  onClick={() => setMobileOpen(true)}
  aria-label="Open navigation menu"
  className={`lg:hidden cursor-pointer p-2 rounded-lg transition-colors ${
    scrolled && !isDarkNav
      ? 'text-slate-900 hover:bg-black/5'
      : 'text-white hover:bg-white/10'
  }`}
>
  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M4 6h16M4 12h16M4 18h16"
    />
  </svg>
</button>
      </div>
       </nav>

      {/* ── Mobile Menu ── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
             initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '100%' }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{ backgroundColor: C.charcoal }}
      className="fixed inset-0 z-[9999] flex h-dvh flex-col overflow-hidden lg:hidden"
      aria-modal="true"
      role="dialog"
      aria-label="Navigation menu"
          >
            {/* Mobile header */}
            <div
              className="flex shrink-0 items-center justify-between px-6 py-5"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <span style={{ fontFamily: 'Cinzel, serif' }} className="text-base font-bold tracking-[0.2em] text-white">
                VARLI<span style={{ color: C.accent }}>KENT</span>
              </span>
              <button
                onClick={closeMobile}
                aria-label="Close menu"
                className="flex h-10 w-10 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Mobile nav links */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <nav className="space-y-0">
                {NAV_ROUTES.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={closeMobile}
                    className="block border-b py-4 text-sm font-medium uppercase tracking-[0.2em] text-white/80 transition-colors hover:text-white"
                    style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                  >
                    {t.nav[link.key]}
                  </Link>
                ))}

                {/* Services accordion */}
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    onClick={() => setMobileServicesOpen(v => !v)}
                    className="flex w-full items-center justify-between py-4 text-sm font-medium uppercase tracking-[0.2em] text-white/80 hover:text-white cursor-pointer"
                  >
                    {t.nav.services}
                    <ChevronIcon open={mobileServicesOpen} />
                  </button>
                  <AnimatePresence>
                    {mobileServicesOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="pb-3 pl-3 space-y-1">
                          {SERVICE_ROUTES.map((s) => (
                            <Link
                              key={s.to}
                              to={s.to}
                              onClick={closeMobile}
                              className="block py-2.5 text-sm font-medium uppercase tracking-[0.15em] text-white/50 transition-colors hover:text-[#4b6741]"
                            >
                              {t.services?.items?.[s.key]?.label || s.key}
                            </Link>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <Link
                  to="/about"
                  onClick={closeMobile}
                  className="block border-b py-4 text-sm font-medium uppercase tracking-[0.2em] text-white/80 transition-colors hover:text-white"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  {t.nav.about}
                </Link>
                <Link
                  to="/team"
                  onClick={closeMobile}
                  className="block border-b py-4 text-sm font-medium uppercase tracking-[0.2em] text-white/80 transition-colors hover:text-white"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  {t.nav.team}
                </Link>
                <Link
                  to="/contact"
                  onClick={closeMobile}
                  className="block border-b py-4 text-sm font-medium uppercase tracking-[0.2em] text-white/80 transition-colors hover:text-white"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  {t.nav.contact}
                </Link>
              </nav>

              {/* Language switcher */}
              <div className="mt-8">
                <p className="mb-3 text-[10px] tracking-[0.3em] uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  Language
                </p>
                <div className="flex gap-2">
                  {LANGS.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={`flex-1 rounded-lg py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors ${
                        language === lang.code
                          ? 'bg-[#4b6741] text-white'
                          : 'text-white/50 hover:text-white'
                      }`}
                      style={language !== lang.code ? { border: '1px solid rgba(255,255,255,0.12)' } : {}}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auth */}
              <div className="mt-6">
                {isLoggedIn ? (
                  <div className="space-y-1">
                    <Link
                      to="/favourites"
                      onClick={closeMobile}
                      className="block py-3 text-sm text-white/60 hover:text-white transition-colors"
                    >
                      {t.nav.favourites}
                    </Link>
                    <Link
                      to="/settings"
                      onClick={closeMobile}
                      className="block py-3 text-sm text-white/60 hover:text-white transition-colors"
                    >
                      Settings
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin/dashboard"
                        onClick={closeMobile}
                        className="block py-3 text-sm text-white/60 hover:text-white transition-colors"
                      >
                        {t.nav.dashboard}
                      </Link>
                    )}
                    <button
                      onClick={() => { handleLogout(); closeMobile() }}
                      className="block w-full py-3 text-left text-sm text-red-400 hover:text-red-300 cursor-pointer transition-colors"
                    >
                      {t.nav.signOut}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 pt-2">
                    <Link
                      to="/login"
                      onClick={closeMobile}
                      className="rounded-full border py-3.5 text-center text-sm font-medium uppercase tracking-[0.15em] text-white transition-colors hover:bg-white/5"
                      style={{ borderColor: 'rgba(255,255,255,0.2)' }}
                    >
                      {t.nav.signIn}
                    </Link>
                    <Link
                      to="/register"
                      onClick={closeMobile}
                      className="rounded-full py-3.5 text-center text-sm font-medium uppercase tracking-[0.15em] text-white transition-colors"
                      style={{ backgroundColor: C.accent }}
                    >
                      {t.nav.register}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
  </>
  )
}

export default Navbar
