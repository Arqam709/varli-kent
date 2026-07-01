import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import PropertyCard from '../components/PropertyCard'
import { useLanguage } from '../contexts/LanguageContext'
import useSeo from '../lib/useSeo'
import { C } from '../contexts/ThemeContext'

const ROOM_OPTIONS = [
  'Studio (1+0)','1+1','1.5+1','2+0','2+1','2.5+1','2+2',
  '3+0','3+1','3.5+1','3+2','3+3',
  '4+0','4+1','4.5+1','4.5+2','4+2','4+3','4+4',
  '5+1','5.5+1','5+2','5+3','5+4',
  '6+1','6+2','6.5+1','6+3','6+4',
  '7+1','7+2','7+3',
  '8+1','8+2','8+3','8+4',
  '9+1','9+2','9+3','9+4','9+5','9+6',
  '10+1','10+2','Out of 10',
]

const PROPERTY_TYPES = ['Apartment','Villa','Penthouse','Duplex','Studio','Office','Commercial','Land','Shop','Warehouse','Hotel','Farm']

const HEATING = ['Central','Individual Gas','Floor Heating','Air Conditioning','None']
const PARKING = ['Open Parking','Closed Parking','None']
const BUILDING_AGE = ['0 (New)','1-5','6-10','11-15','16-20','21+']

const Spinner = () => (
  <div className="flex justify-center py-20">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#5E7F52] border-t-transparent" />
  </div>
)

const SkeletonCard = () => (
  <div className="animate-pulse rounded-2xl border border-slate-200 bg-white overflow-hidden">
    <div className="h-60 bg-slate-200" />
    <div className="p-5 space-y-3">
      <div className="h-5 bg-slate-200 rounded w-2/3" />
      <div className="h-4 bg-slate-200 rounded w-full" />
      <div className="h-4 bg-slate-200 rounded w-1/2" />
    </div>
  </div>
)

const Label = ({ children }) => (
  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</label>
)

const PropertiesPage = () => {
  const { t } = useLanguage()
  useSeo({
    title: 'Properties for Sale & Rent in Istanbul',
    description: 'Browse luxury apartments, villas, penthouses and more across Istanbul\'s most prestigious neighbourhoods. Filter by price, location, and property type.',
    path: '/properties',
  })
  const [searchParams, setSearchParams] = useSearchParams()
  const [properties, setProperties] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [listingType, setListingType] = useState(searchParams.get('listingType') || '')
  const [district,    setDistrict]    = useState(searchParams.get('district') || '')
  const [propertyType,setPropertyType]= useState(searchParams.get('propertyType') || '')
  const [minPrice,    setMinPrice]    = useState(searchParams.get('minPrice') || '')
  const [maxPrice,    setMaxPrice]    = useState(searchParams.get('maxPrice') || '')
  const [rooms,       setRooms]       = useState(searchParams.get('rooms') || '')
  const [minSqm,      setMinSqm]      = useState(searchParams.get('minSqm') || '')
  const [maxSqm,      setMaxSqm]      = useState(searchParams.get('maxSqm') || '')
  const [floor,       setFloor]       = useState(searchParams.get('floor') || '')
  const [totalFloors, setTotalFloors] = useState(searchParams.get('totalFloors') || '')
  const [heating,     setHeating]     = useState(searchParams.get('heating') || '')
  const [parking,     setParking]     = useState(searchParams.get('parking') || '')
  const [buildingAge, setBuildingAge] = useState(searchParams.get('buildingAge') || '')
  const [furnished,   setFurnished]   = useState(searchParams.get('furnished') || '')
  const [balcony,     setBalcony]     = useState(searchParams.get('balcony') || '')
  const [elevator,    setElevator]    = useState(searchParams.get('elevator') || '')
  const [pool,        setPool]        = useState(searchParams.get('pool') || '')
  const [garden,      setGarden]      = useState(searchParams.get('garden') || '')

  useEffect(() => {
    api.get('/properties/areas').then(r => setAreas(r.data.areas || [])).catch(() => {})
  }, [])

  const fetchProperties = useCallback(() => {
    setLoading(true)
    const params = {}
    if (listingType)  params.listingType  = listingType
    if (district)     params.district     = district
    if (propertyType) params.propertyType = propertyType
    if (minPrice)     params.minPrice     = minPrice
    if (maxPrice)     params.maxPrice     = maxPrice
    if (rooms)        params.rooms        = rooms
    if (minSqm)       params.minSqm       = minSqm
    if (maxSqm)       params.maxSqm       = maxSqm
    if (floor)        params.floor        = floor
    if (totalFloors)  params.totalFloors  = totalFloors
    if (heating)      params.heating      = heating
    if (parking)      params.parking      = parking
    if (buildingAge)  params.buildingAge  = buildingAge
    if (furnished)    params.furnished    = furnished
    if (balcony)      params.balcony      = balcony
    if (elevator)     params.elevator     = elevator
    if (pool)         params.pool         = pool
    if (garden)       params.garden       = garden

    api.get('/properties', { params })
      .then(r => { setProperties(r.data.properties || []); setTotal(r.data.count || 0) })
      .catch(() => { setProperties([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [listingType, district, propertyType, minPrice, maxPrice, rooms, minSqm, maxSqm, floor, totalFloors, heating, parking, buildingAge, furnished, balcony, elevator, pool, garden])

  useEffect(() => { fetchProperties() }, [fetchProperties])

  const clearFilters = () => {
    setListingType(''); setDistrict(''); setPropertyType(''); setMinPrice(''); setMaxPrice('')
    setRooms(''); setMinSqm(''); setMaxSqm(''); setFloor(''); setTotalFloors('')
    setHeating(''); setParking(''); setBuildingAge(''); setFurnished('')
    setBalcony(''); setElevator(''); setPool(''); setGarden('')
    setSearchParams({})
    setMobileFilterOpen(false)
  }

  const inp = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5E7F52]'
  const chk = 'h-4 w-4 rounded border-slate-300 text-[#5E7F52] focus:ring-[#5E7F52]'

  const FilterPanel = () => (
    <div className="space-y-5">
      {/* Listing type */}
      <div>
        <Label>{t.propertiesPage?.filterType || 'Type'}</Label>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {[['', t.propertiesPage?.all || 'All'], ['Sale', t.propertiesPage?.forSale || 'For Sale'], ['Rent', t.propertiesPage?.forRent || 'For Rent']].map(([val, label]) => (
            <button key={val} type="button" onClick={() => setListingType(val)}
              className={`flex-1 py-2 text-xs font-semibold transition cursor-pointer ${listingType === val ? 'bg-[#4b6741] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div>
        <Label>{t.propertiesPage?.district || 'District'}</Label>
        <select value={district} onChange={e => setDistrict(e.target.value)} className={inp}>
          <option value="">{t.propertiesPage?.allDistricts || 'All Districts'}</option>
          {areas.map(a => <option key={a.district} value={a.district}>{a.district} ({a.count})</option>)}
        </select>
      </div>

      {/* Property type */}
      <div>
        <Label>{t.propertiesPage?.propertyType || 'Property Type'}</Label>
        <select value={propertyType} onChange={e => setPropertyType(e.target.value)} className={inp}>
          <option value="">{t.propertiesPage?.allTypes || 'All Types'}</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Rooms */}
      <div>
        <Label>{t.propertiesPage?.rooms || 'Number of Rooms'}</Label>
        <select value={rooms} onChange={e => setRooms(e.target.value)} className={inp}>
          <option value="">Any</option>
          {ROOM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Price */}
      <div>
        <Label>{t.propertiesPage?.priceRange || 'Price Range ($)'}</Label>
        <div className="flex gap-2">
          <input type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)} className={inp} min="0" />
          <input type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} className={inp} min="0" />
        </div>
      </div>

      {/* Area sqm */}
      <div>
        <Label>{t.propertiesPage?.area || 'Area (m²)'}</Label>
        <div className="flex gap-2">
          <input type="number" placeholder="Min" value={minSqm} onChange={e => setMinSqm(e.target.value)} className={inp} min="0" />
          <input type="number" placeholder="Max" value={maxSqm} onChange={e => setMaxSqm(e.target.value)} className={inp} min="0" />
        </div>
      </div>

      {/* Advanced toggle */}
      <button type="button" onClick={() => setShowAdvanced(v => !v)}
        className="flex items-center gap-2 text-xs font-semibold text-[#5E7F52] hover:underline cursor-pointer w-full">
        {showAdvanced ? (t.propertiesPage?.hideAdvanced || '▲ Hide advanced filters') : (t.propertiesPage?.showAdvanced || '▼ Show advanced filters')}
      </button>

      {showAdvanced && (
        <div className="space-y-5 border-t border-slate-100 pt-5">
          {/* Floor */}
          <div>
            <Label>{t.propertiesPage?.floor || 'Floor'}</Label>
            <div className="flex gap-2">
              <input type="number" placeholder="Floor no." value={floor} onChange={e => setFloor(e.target.value)} className={inp} min="0" />
              <input type="number" placeholder="Total floors" value={totalFloors} onChange={e => setTotalFloors(e.target.value)} className={inp} min="0" />
            </div>
          </div>

          {/* Building age */}
          <div>
            <Label>{t.propertiesPage?.buildingAge || 'Building Age'}</Label>
            <select value={buildingAge} onChange={e => setBuildingAge(e.target.value)} className={inp}>
              <option value="">Any</option>
              {BUILDING_AGE.map(a => <option key={a} value={a}>{a} yrs</option>)}
            </select>
          </div>

          {/* Heating */}
          <div>
            <Label>{t.propertiesPage?.heating || 'Heating'}</Label>
            <select value={heating} onChange={e => setHeating(e.target.value)} className={inp}>
              <option value="">Any</option>
              {HEATING.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>

          {/* Parking */}
          <div>
            <Label>{t.propertiesPage?.parking || 'Parking'}</Label>
            <select value={parking} onChange={e => setParking(e.target.value)} className={inp}>
              <option value="">Any</option>
              {PARKING.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Checkboxes */}
          <div>
            <Label>{t.propertiesPage?.features || 'Features'}</Label>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['furnished', t.propertiesPage?.furnished || 'Furnished', furnished, setFurnished],
                ['balcony', t.propertiesPage?.balcony || 'Balcony', balcony, setBalcony],
                ['elevator', t.propertiesPage?.elevator || 'Elevator', elevator, setElevator],
                ['pool', t.propertiesPage?.pool || 'Pool', pool, setPool],
                ['garden', t.propertiesPage?.garden || 'Garden', garden, setGarden],
              ].map(([key, label, val, setter]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" className={chk} checked={val === 'true'} onChange={e => setter(e.target.checked ? 'true' : '')} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <button type="button" onClick={fetchProperties} className="w-full rounded-full bg-[#4b6741] py-3 text-sm font-semibold text-white transition hover:bg-[#3a5030] cursor-pointer">
          {t.propertiesPage?.apply || 'Apply Filters'}
        </button>
        <button type="button" onClick={clearFilters} className="w-full text-center text-sm text-slate-500 hover:text-slate-800 cursor-pointer">
          {t.propertiesPage?.clearAll || 'Clear All'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero banner */}
      <section style={{ backgroundColor: C.charcoal, paddingTop: '7rem', paddingBottom: '3rem' }}>
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: C.green }}>{t.propertiesPage?.locationLabel || 'Istanbul Real Estate'}</p>
          <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', color: C.marble, marginBottom: '0.5rem' }}>{t.propertiesPage?.heading || 'Properties in Istanbul'}</h1>
          <p className="text-slate-400 text-sm">{total} {total === 1 ? 'property' : 'properties'} {t.propertiesPage?.found || 'found'}</p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Mobile filter button */}
        <div className="lg:hidden mb-4">
          <button onClick={() => setMobileFilterOpen(true)} className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm cursor-pointer">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" /></svg>
            {t.propertiesPage?.filters || 'Filters'}
          </button>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="hidden lg:block w-72 shrink-0">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-h-[calc(100vh-7rem)] overflow-y-auto">
              <h3 style={{ fontFamily: 'Cinzel, serif' }} className="mb-5 text-base font-semibold text-[#1E1E1C]">{t.propertiesPage?.filters || 'Filters'}</h3>
              <FilterPanel />
            </div>
          </aside>

          {/* Results */}
          <main className="flex-1 min-w-0">
            {loading ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : properties.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                <h3 className="mt-4 text-xl font-semibold text-slate-700">{t.propertiesPage?.noResults || 'No properties found'}</h3>
                <p className="mt-2 text-slate-500">{t.propertiesPage?.noResultsHint || 'Try adjusting your filters.'}</p>
                <button onClick={clearFilters} className="mt-4 rounded-full bg-[#5E7F52] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer">{t.propertiesPage?.clearFilters || 'Clear Filters'}</button>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {properties.map(p => <PropertyCard key={p._id} property={p} />)}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileFilterOpen(false)} />
          <div className="relative ml-auto h-full w-80 overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h3 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#1E1E1C]">{t.propertiesPage?.filters || 'Filters'}</h3>
              <button onClick={() => setMobileFilterOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <FilterPanel />
          </div>
        </div>
      )}
    </div>
  )
}

export default PropertiesPage
