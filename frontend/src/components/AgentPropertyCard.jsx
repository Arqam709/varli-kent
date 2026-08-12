import { Link } from 'react-router-dom'
import { formatPrice } from '../lib/formatPrice'



const STATUS_STYLES = {
  Available: 'bg-green-100 text-green-700',
  Pending: 'bg-amber-100 text-amber-700',
  Sold: 'bg-slate-200 text-slate-700',
  Rented: 'bg-blue-100 text-blue-700',
}

const PhotoFallback = () => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400">
    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
    <span className="text-[10px] uppercase tracking-widest">No photo</span>
  </div>
)

const AgentPropertyCard = ({ property }) => {
  const image = property.mainImage || property.images?.[0] || ''

  return (
    <div className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="h-28 w-36 shrink-0 overflow-hidden rounded-xl">
        {image
          ? <img src={image} alt={property.title} className="h-full w-full object-cover" loading="lazy" />
          : <PhotoFallback />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold text-[#202a36]">{property.title}</h3>
          {property.status && (
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[property.status] || 'bg-slate-100 text-slate-600'}`}>
              {property.status}
            </span>
          )}
        </div>

        <p className="mt-0.5 text-sm text-slate-500">
          {property.district} · {property.propertyType}
        </p>

        <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
          {property.listingType === 'Rent' ? 'For Rent' : 'For Sale'}
        </p>

        <p style={{ fontFamily: 'Cinzel, serif' }} className="mt-1 text-lg font-bold text-[#d97706]">
          {formatPrice(property.price, property.listingType, property.priceLabel)}
        </p>

        <div className="mt-auto pt-3">
          {/* The normal public listing page — the agent sees exactly what a
              customer sees, which is the useful view when answering questions
              about it. */}
          <Link
            to={`/properties/${property._id}`}
            className="inline-block rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            View Property
          </Link>
        </div>
      </div>
    </div>
  )
}

export default AgentPropertyCard
