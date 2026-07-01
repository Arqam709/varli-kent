import { Link } from 'react-router-dom'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import { C } from '../contexts/ThemeContext'

const Footer = () => {
  const { settings } = useSiteSettings()

  const email = settings?.email || 'info@varlikent.com'
  const phone = settings?.phone || '+90 530 123 4567'
  const whatsapp = settings?.whatsapp || '905301234567'
  const instagram = settings?.instagram || ''
  const linkedin = settings?.linkedin || ''

  return (
    <footer style={{ backgroundColor: C.charcoal, borderTop: '1px solid rgba(255,255,255,0.06)', color: C.textLight }}>
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid gap-14 md:grid-cols-2 lg:grid-cols-5">

          {/* Brand — spans 2 cols on lg */}
          <div className="lg:col-span-2">
            <Link to="/" className="inline-block mb-6">
              <span style={{ fontFamily: 'Cinzel, serif', letterSpacing: '0.2em' }} className="text-2xl font-bold">
                VARLI<span style={{ color: C.accent }}>KENT</span>
              </span>
            </Link>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
              Istanbul's full-service property company — architecture, construction, renovation, interior design and real estate, all under one roof.
            </p>
            <div className="mt-8">
              <span className="block mb-3 text-xs tracking-[0.3em] uppercase text-slate-600">Contact</span>
              <a href={`mailto:${email}`} className="text-sm text-slate-400 hover:text-[#C9A35A] transition-colors block mb-1">{email}</a>
              <a href={`tel:${phone.replace(/\s/g, '')}`} className="text-sm text-slate-400 hover:text-[#C9A35A] transition-colors block">{phone}</a>
            </div>
            {/* Social */}
            <div className="mt-6 flex gap-3">
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
                className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-500 hover:border-[#C9A35A]/50 hover:text-[#C9A35A] transition-colors cursor-pointer"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.12 1.523 5.851L.057 23.535a.75.75 0 00.937.93l5.815-1.484A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.698 9.698 0 01-4.964-1.364l-.356-.213-3.694.943.975-3.605-.232-.371A9.705 9.705 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
                </svg>
              </a>
              <a
                href={instagram || '#'}
                target={instagram ? '_blank' : undefined}
                rel="noreferrer"
                aria-label="Instagram"
                className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-500 hover:border-[#C9A35A]/50 hover:text-[#C9A35A] transition-colors cursor-pointer"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
              </a>
              <a
                href={linkedin || '#'}
                target={linkedin ? '_blank' : undefined}
                rel="noreferrer"
                aria-label="LinkedIn"
                className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-500 hover:border-[#C9A35A]/50 hover:text-[#C9A35A] transition-colors cursor-pointer"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Company */}
          <div>
            <h3 style={{ fontFamily: 'Cinzel, serif' }} className="text-xs font-semibold tracking-[0.3em] text-white uppercase mb-6">Company</h3>
            <ul className="space-y-3">
              {[
                { label: 'Home', to: '/' },
                { label: 'About', to: '/about' },
                { label: 'Properties', to: '/properties' },
                { label: 'Contact', to: '/contact' },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-slate-500 text-sm hover:text-[#C9A35A] transition-colors">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Browse */}
          <div>
            <h3 style={{ fontFamily: 'Cinzel, serif' }} className="text-xs font-semibold tracking-[0.3em] text-white uppercase mb-6">Browse</h3>
            <ul className="space-y-3">
              {[
                { label: 'For Sale', to: '/properties?listingType=Sale' },
                { label: 'For Rent', to: '/properties?listingType=Rent' },
                { label: 'Featured', to: '/properties?featured=true' },
                { label: 'Favourites', to: '/favourites' },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-slate-500 text-sm hover:text-[#C9A35A] transition-colors">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 style={{ fontFamily: 'Cinzel, serif' }} className="text-xs font-semibold tracking-[0.3em] text-white uppercase mb-6">Services</h3>
            <ul className="space-y-3">
              {[
                { label: 'Architecture', to: '/architecture' },
                { label: 'Construction', to: '/construction' },
                { label: 'Renovation', to: '/renovation' },
                { label: 'Interior Design', to: '/interior-design' },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-slate-500 text-sm hover:text-[#C9A35A] transition-colors">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 flex flex-col items-center justify-between gap-4 sm:flex-row"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-slate-600 text-xs tracking-wide">© 2025 Varlikent. All rights reserved.</p>
          <p className="text-slate-700 text-xs tracking-[0.2em] uppercase">Architecture · Construction · Real Estate · Istanbul</p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
