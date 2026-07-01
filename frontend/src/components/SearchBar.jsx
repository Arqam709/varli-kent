import { useState, useEffect } from 'react'
import api from '../lib/api'

const SearchBar = ({ onSearch, initialValues = {}, glass = false, t }) => {
  const labels = t || {
    buy: 'Buy', rent: 'Rent', allDistricts: 'All Districts',
    propertyType: 'Property Type', bedrooms: 'Bedrooms',
    minPrice: 'Min Price ($)', maxPrice: 'Max Price ($)', search: 'Search',
  }
  const [listingType, setListingType] = useState(initialValues.listingType || 'Sale')
  const [district, setDistrict] = useState(initialValues.district || '')
  const [propertyType, setPropertyType] = useState(initialValues.propertyType || '')
  const [minPrice, setMinPrice] = useState(initialValues.minPrice || '')
  const [maxPrice, setMaxPrice] = useState(initialValues.maxPrice || '')
  const [beds, setBeds] = useState(initialValues.beds || '')
  const [areas, setAreas] = useState([])

  useEffect(() => {
    api.get('/properties/areas').then((res) => {
      setAreas(res.data.areas || [])
    }).catch(() => {})
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSearch?.({ listingType, district, propertyType, minPrice, maxPrice, beds })
  }

  if (glass) {
    const glassInput = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[#4b6741] focus:border-[#4b6741] transition-colors'
    const glassSelect = glassInput + ' [&>option]:bg-[#111820] [&>option]:text-white'
    return (
      <form onSubmit={handleSubmit} className="w-full rounded-2xl bg-[#0a0f1a]/80 backdrop-blur-xl border border-white/10 p-4">
        <div className="mb-3 flex rounded-xl bg-white/5 p-1 border border-white/8">
          {['Sale', 'Rent'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setListingType(type)}
              className={`flex-1 rounded-lg py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                listingType === type
                  ? 'bg-[#4b6741] text-white shadow-sm'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {type === 'Sale' ? labels.buy : labels.rent}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select value={district} onChange={(e) => setDistrict(e.target.value)} className={glassSelect}>
            <option value="">{labels.allDistricts}</option>
            {areas.map((a) => (
              <option key={a.district} value={a.district}>{a.district} ({a.count})</option>
            ))}
          </select>
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className={glassSelect}>
            <option value="">{labels.propertyType}</option>
            {['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={beds} onChange={(e) => setBeds(e.target.value)} className={glassSelect}>
            <option value="">{labels.bedrooms}</option>
            {['1', '2', '3', '4', '5'].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
          <input
            type="number"
            placeholder={labels.minPrice}
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className={glassInput}
            min="0"
          />
          <input
            type="number"
            placeholder={labels.maxPrice}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className={glassInput}
            min="0"
          />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4b6741] py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-[#3d5535] cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {labels.search}
          </button>
        </div>
      </form>
    )
  }

  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741]'
  const selectClass = inputClass

  return (
    <form onSubmit={handleSubmit} className="w-full rounded-2xl bg-white p-4 shadow-2xl">
      <div className="mb-3 flex rounded-xl bg-slate-100 p-1">
        {['Sale', 'Rent'].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setListingType(type)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors cursor-pointer ${
              listingType === type ? 'bg-[#202a36] text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {type === 'Sale' ? labels.buy : labels.rent}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <select value={district} onChange={(e) => setDistrict(e.target.value)} className={selectClass}>
          <option value="">All Districts</option>
          {areas.map((a) => (
            <option key={a.district} value={a.district}>{a.district} ({a.count})</option>
          ))}
        </select>
        <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className={selectClass}>
          <option value="">Property Type</option>
          {['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={beds} onChange={(e) => setBeds(e.target.value)} className={selectClass}>
          <option value="">Bedrooms</option>
          {['1', '2', '3', '4', '5'].map((n) => (
            <option key={n} value={n}>{n}+</option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Min Price ($)"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          className={inputClass}
          min="0"
        />
        <input
          type="number"
          placeholder="Max Price ($)"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className={inputClass}
          min="0"
        />
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4b6741] py-2.5 text-sm font-semibold text-white transition hover:bg-[#3d5535] cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search
        </button>
      </div>
    </form>
  )
}

export default SearchBar
