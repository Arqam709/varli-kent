import { Link } from 'react-router-dom'
import { useFavourites } from '../contexts/FavouritesContext'
import { formatPrice } from '../lib/formatPrice'

const BedIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12v-2a4 4 0 014-4h10a4 4 0 014 4v2M3 12v4h18v-4M3 12h18M7 12V8m10 4V8" />
  </svg>
)
const BathIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 12h16M4 12a2 2 0 01-2-2V6a2 2 0 012-2h1a2 2 0 012 2v4M4 12v4a2 2 0 002 2h12a2 2 0 002-2v-4M16 6a2 2 0 012-2h1a2 2 0 012 2v4" />
  </svg>
)
const AreaIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
  </svg>
)
const HeartIcon = ({ filled }) => (
  <svg className="h-4.5 w-4.5" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
)
const PinIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)
const ArrowIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
  </svg>
)

const PropertyCard = ({ property, showFavourite = true }) => {
  const { isFavourite, toggleFavourite } = useFavourites()
  const fav = isFavourite(property._id)
  const image = property.mainImage || (property.images && property.images[0]) || property.image

  const isRent = property.listingType === 'Rent'
  const isFeatured = property.featured && !isRent

  

  return (
    <div className="group relative flex flex-col overflow-hidden bg-white border border-slate-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:border-slate-200">
      {/* Image */}
      <div className="relative overflow-hidden h-64">
        <img
          src={image || 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=600&q=80'}
          alt={property.title}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        {/* Dark overlay on hover */}
        <div className="absolute inset-0 bg-[#080a0e]/0 group-hover:bg-[#080a0e]/20 transition-colors duration-300" />

        {/* Left-edge badge */}
        <div
          className="absolute left-0 top-6 px-4 py-1.5 text-xs font-semibold tracking-widest uppercase text-white"
          style={{ backgroundColor: isRent ? '#4b6741' : isFeatured ? '#c4993a' : '#202a36' }}
        >
          {isRent ? 'For Rent' : isFeatured ? 'Featured' : 'For Sale'}
        </div>

        {/* Favourite */}
        {showFavourite && (
          <button
            onClick={(e) => { e.preventDefault(); toggleFavourite(property._id) }}
            className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center transition-colors duration-150 cursor-pointer ${
              fav ? 'bg-red-500 text-white' : 'bg-white/90 text-slate-500 hover:text-red-500'
            }`}
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
          >
            <HeartIcon filled={fav} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-6">
        {/* Price */}
        <p style={{ fontFamily: 'Cinzel, serif' }} className="text-xl font-semibold text-[#202a36] tracking-tight">
  {formatPrice(property.price, property.listingType, property.priceLabel)}
</p>

        {/* Title */}
        <h3 style={{ fontFamily: 'Cinzel, serif' }} className="mt-2 text-sm font-medium text-slate-700 line-clamp-2 leading-snug">
          {property.title}
        </h3>

        {/* Location */}
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
          <PinIcon />
          <span>{property.district}, Istanbul</span>
        </div>

        <div className="mt-1 text-xs text-slate-400 tracking-[0.15em] uppercase">{property.propertyType}</div>

        {/* Stats */}
        <div className="mt-5 flex items-center gap-5 pt-5 border-t border-slate-100 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <BedIcon />
            <span>{property.beds} Beds</span>
          </span>
          <span className="flex items-center gap-1.5">
            <BathIcon />
            <span>{property.baths} Baths</span>
          </span>
          <span className="flex items-center gap-1.5">
            <AreaIcon />
            <span>{property.sqm} m²</span>
          </span>
        </div>

        {/* CTA */}
        <Link
          to={`/properties/${property._id}`}
          className="mt-5 flex w-full items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-widest text-white transition-colors duration-200 cursor-pointer group/btn"
          style={{ backgroundColor: '#4b6741' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3a5030'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = '#4b6741'}
        >
          <span>View Details</span>
          <ArrowIcon />
        </Link>
      </div>
    </div>
  )
}

export default PropertyCard
