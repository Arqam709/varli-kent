import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import api from '../lib/api'
import { useFavourites } from '../contexts/FavouritesContext'
import PropertyCard from '../components/PropertyCard'
import { formatPrice } from '../lib/formatPrice'
import useSeo from '../lib/useSeo'

const PropertyDetailsPage = () => {
  const { id } = useParams()
  const [property, setProperty] = useState(null)
  const [similar, setSimilar] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeImg, setActiveImg] = useState(0)
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' })
  const [sending, setSending] = useState(false)
  const { isFavourite, toggleFavourite } = useFavourites()

  useSeo({
    title: property ? `${property.title} — ${property.district}, Istanbul` : 'Property Details',
    description: property
      ? `${property.listingType === 'Rent' ? 'For Rent' : 'For Sale'}: ${property.title} in ${property.district}, Istanbul. ${property.beds} bed, ${property.baths} bath, ${property.sqm}m².`
      : 'View property details on Varlikent.',
    image: property?.mainImage || property?.images?.[0],
    path: `/properties/${id}`,
    type: 'article',
  })

  useEffect(() => {
    setLoading(true)
    api.get(`/properties/${id}`)
      .then(r => {
        setProperty(r.data.property)
        setActiveImg(0)
        if (r.data.property) {
          api.get('/properties', { params: { district: r.data.property.district, listingType: r.data.property.listingType } })
            .then(r2 => setSimilar((r2.data.properties || []).filter(p => p._id !== id).slice(0, 3)))
            .catch(() => {})
        }
      })
      .catch(() => setProperty(null))
      .finally(() => setLoading(false))
  }, [id])

  const handleContact = async (e) => {
    e.preventDefault()
    if (!contactForm.name || !contactForm.email || !contactForm.message) return
    setSending(true)
    try {
      await api.post('/contact', {
        name: contactForm.name,
        email: contactForm.email,
        phone: 'N/A',
        interestType: property?.listingType === 'Rent' ? 'Renting' : 'Buying',
        message: `Re: ${property?.title} — ${contactForm.message}`,
      })
      toast.success('Message sent! We will contact you soon.')
      setContactForm({ name: '', email: '', message: '' })
    } catch {
      toast.error('Failed to send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center pt-20">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
    </div>
  )

  if (!property) return (
    <div className="min-h-screen flex items-center justify-center pt-20 px-6">
      <div className="text-center">
        <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-3xl font-semibold text-[#202a36]">Property not found</h1>
        <Link to="/properties" className="mt-6 inline-block rounded-full bg-[#202a36] px-6 py-3 text-white text-sm font-semibold">Back to Listings</Link>
      </div>
    </div>
  )

  const images = property.images?.length ? property.images : (property.mainImage ? [property.mainImage] : ['https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80'])
  const fav = isFavourite(property._id)
  const whatsapp = property.whatsappNumber || property.agentPhone || ''

  const getDisplayPrice = (property) => {
  const label = property.priceLabel?.trim()
  const amount = Number(property.price || 0).toLocaleString('en-US')
  const rentSuffix = property.listingType === 'Rent' ? '/mo' : ''

  if (label) {
    if (label === '$') {
      return `$${amount}${rentSuffix}`
    }

    if (label === '₺' || label.toUpperCase() === 'TL') {
      return `₺${amount}${rentSuffix}`
    }

    if (label === '€') {
      return `€${amount}${rentSuffix}`
    }

    return label
  }

  return formatPrice(property.price, property.listingType)
}

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="bg-[#202a36] pt-24 pb-8">
        <div className="container mx-auto px-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400 mb-4">
            <Link to="/" className="hover:text-white transition">Home</Link>
            <span>/</span>
            <Link to="/properties" className="hover:text-white transition">Properties</Link>
            <span>/</span>
            <span className="text-white truncate max-w-xs">{property.title}</span>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold mb-3 ${property.listingType === 'Rent' ? 'bg-[#4b6741] text-white' : 'bg-[#d97706] text-white'}`}>
                {property.listingType === 'Rent' ? 'For Rent' : 'For Sale'}
              </span>
              <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-3xl font-bold text-white md:text-4xl">{property.title}</h1>
              <div className="mt-3 flex items-center gap-2 text-slate-400">
                <svg className="h-4 w-4 text-[#4b6741]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                {property.address}, {property.district}, Istanbul
              </div>
            </div>
            <button
              onClick={() => toggleFavourite(property._id)}
              className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition cursor-pointer ${fav ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              <svg className="h-5 w-5" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
              {fav ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-10">
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div>
            {/* Gallery */}
            <div className="overflow-hidden rounded-2xl shadow-lg">
              <img src={images[activeImg]} alt={property.title} className="h-96 w-full object-cover" loading="lazy" />
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {images.map((img, i) => (
                  <button key={i} onClick={() => setActiveImg(i)} className={`shrink-0 overflow-hidden rounded-xl cursor-pointer ${activeImg === i ? 'ring-2 ring-[#4b6741]' : 'opacity-70 hover:opacity-100'}`}>
                    <img src={img} alt={`${property.title} — photo ${i + 1}`} className="h-20 w-28 object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="mt-8 grid grid-cols-3 gap-4">
              {[
                { icon: '🛏', label: 'Bedrooms', val: property.beds },
                { icon: '🚿', label: 'Bathrooms', val: property.baths },
                { icon: '📐', label: 'Area', val: `${property.sqm} m²` },
              ].map(item => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
                  <p style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{item.val}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.label}</p>
                </div>
              ))}
            </div>

            {/* Description */}
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-semibold text-[#202a36]">About This Property</h2>
              <p className="mt-4 leading-7 text-slate-600">{property.description || 'A premium property in Istanbul managed by the Varlikent team.'}</p>

              <div className="mt-8 grid grid-cols-2 gap-4 text-sm">
                {[
                  ['Property Type', property.propertyType],
                  ['Listing Type', property.listingType === 'Rent' ? 'For Rent' : 'For Sale'],
                  ['District', property.district],
                  ['Status', property.status],
                ].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-slate-500">{l}</span>
                    <span className="font-semibold text-[#202a36]">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Price & Contact */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sticky top-24">
              <p className="text-sm uppercase tracking-wide text-slate-500">Price</p>
              <p style={{ fontFamily: 'Cinzel, serif' }} className="mt-1 text-3xl font-bold text-[#d97706]">
                {formatPrice(property.price, property.listingType, property.priceLabel)}
              </p>

              <hr className="my-5 border-slate-100" />

              {property.agentName && (
                <div className="mb-5">
                  <p className="mb-3 text-sm font-semibold text-slate-700">Agent</p>
                  <p className="font-semibold text-[#202a36]">{property.agentName}</p>
                  {property.agentPhone && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                      <svg className="h-4 w-4 text-[#4b6741]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      {property.agentPhone}
                    </div>
                  )}
                  {property.agentEmail && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                      <svg className="h-4 w-4 text-[#4b6741]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      {property.agentEmail}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {whatsapp && (
                  <a href={`https://wa.me/${whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi, I'm interested in ${property.title}`)}`}
                    target="_blank" rel="noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition hover:bg-green-700 cursor-pointer"
                  >
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.12 1.523 5.851L.057 23.535a.75.75 0 00.937.93l5.815-1.484A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.698 9.698 0 01-4.964-1.364l-.356-.213-3.694.943.975-3.605-.232-.371A9.705 9.705 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>
                    WhatsApp
                  </a>
                )}
                {property.agentEmail && (
                  <a href={`mailto:${property.agentEmail}?subject=Inquiry: ${property.title}`}
                    className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-[#202a36] py-3 text-sm font-semibold text-[#202a36] transition hover:bg-[#202a36] hover:text-white cursor-pointer"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    Email Agent
                  </a>
                )}
                {property.agentPhone && (
                  <a href={`tel:${property.agentPhone}`}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 cursor-pointer"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    Call Agent
                  </a>
                )}
              </div>

              {/* Quick Contact Form */}
              <hr className="my-5 border-slate-100" />
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Send a Message</h3>
              <form onSubmit={handleContact} className="space-y-3">
                <input type="text" placeholder="Your name" value={contactForm.name} onChange={e => setContactForm(p => ({...p, name: e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]" required />
                <input type="email" placeholder="Email address" value={contactForm.email} onChange={e => setContactForm(p => ({...p, email: e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]" required />
                <textarea rows={3} placeholder="Your message..." value={contactForm.message} onChange={e => setContactForm(p => ({...p, message: e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]" required />
                <button type="submit" disabled={sending}
                  className="w-full rounded-full bg-[#4b6741] py-3 text-sm font-semibold text-white transition hover:bg-[#3d5535] disabled:opacity-60 cursor-pointer"
                >
                  {sending ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Similar Properties */}
        {similar.length > 0 && (
          <div className="mt-16">
            <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-semibold text-[#202a36] mb-8">Similar Properties</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {similar.map(p => <PropertyCard key={p._id} property={p} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PropertyDetailsPage
