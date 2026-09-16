import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import PropertyCard from '../components/PropertyCard'
import PropertyMapView from '../components/PropertyMapView'
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

/*
 * Compatibility union, not a preference.
 *
 * This deployment shares one MongoDB database with a second front-end that
 * ships a different, longer vocabulary for these two fields. Listings written
 * there are already in the collection — a real one stores heating
 * 'Combi Boiler (Natural Gas)' and parking 'Open & Covered Parking' — and
 * neither value existed in any list here, so the filters could never reach
 * them and the editor could never reproduce them.
 *
 * So both sets are carried, and nothing is aliased: 'Combi Boiler (Natural
 * Gas)' is NOT folded into 'Individual Gas', and 'Open & Covered Parking' is
 * NOT folded into 'Open Parking' — the latter plausibly means both kinds of
 * space exist, which is a third state, not a synonym. Collapsing them is a
 * product decision, and until someone makes it the stored meaning is kept.
 */
const HEATING = [
  'Stove','Natural Gas Stove','Central Heating','Central','Central (Meter)',
  'Combi Boiler (Natural Gas)','Individual Gas','Floor Heating','Air Conditioning','None',
]
const PARKING = [
  'Open Parking','Closed Parking','Open Parking Lot','Parking Garage',
  'Open & Covered Parking','None',
]
// Mirrors AdminProperties.jsx. The three retired buckets are not offered
// here — a visitor must never be asked to choose between "1-5" and "3" as
// if they were alternatives.
const BUILDING_AGE = ['0','1','2','3','4','5','6-10','11-15','16-20','21-25','26-30','31+']

/*
 * Wave 10B4 vocabularies. These mirror the enums in
 * backend/routes/properties.js exactly — the server drops any value it cannot
 * store, so a control offering something else would just return nothing.
 */
const FLOOR_LOCATIONS = ['Ground floor','High Entrance','Penthouse','Duplex','Triplex']
const KITCHEN_TYPES = ['Open (American)','Closed']
const USAGE_STATUSES = ['Empty','Tenant','Property Owner']
const TITLE_DEED_STATUSES = [
  'Shared Title Deed','Independent Title Deed','Land with Title Deed',
  'Cooperative Share Title Deed','Established Usufruct Right',
]
const TRANSPORT_OPTIONS = ['Metro','Metrobus','Bus','Ferry','Train','Tram','Highway Access']

/*
 * Amenities that carry no schema default, so a listing can be true, false, or
 * never recorded. The control offers Any / Yes / No rather than a checkbox: an
 * unchecked box would read as "No" and quietly exclude every listing that",
 * predates the field.
 */
const TRISTATE_AMENITIES = ['sauna','jacuzzi','steamRoom','turkishBath','basement']
const TRISTATE_LEGAL = ['withinSite','eligibleForCredit','exchange']

// Sent as a day count, not as an absolute instant: a shared or bookmarked
// link then keeps meaning "the last 7 days" instead of drifting further into
// the past for whoever opens it tomorrow.
const LISTED_SINCE_DAYS = ['1','3','7','15','30']

const BATHS_OPTIONS = ['1','2','3','4','5']

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

/*
 * One collapsible filter row.
 *
 * Declared at module scope on purpose: a component defined inside
 * PropertiesPage would be a brand-new type on every render, so React would
 * unmount and remount every section and each one would forget whether it was
 * open the moment anything else on the page changed.
 *
 * Sections hold their own open state and nothing coordinates them, so several
 * can be open at once — opening Heating must not close Parking.
 *
 * The body stays mounted and is hidden with the `hidden` attribute rather than
 * being conditionally rendered, so `aria-controls` always points at a real
 * element and a half-typed number is not thrown away by collapsing the row.
 */
const FilterSection = ({ id, title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = `${id}-panel`

  return (
    <div className="border-b border-slate-100 pb-4">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 cursor-pointer text-start"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="mt-3">{children}</div>
    </div>
  )
}

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
  const [loadError, setLoadError] = useState(false)
  const propertiesRequest = useRef(0)
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  // Presentation only, and deliberately NOT in the URL: a shared filter
  // link should carry the filters, not dictate how the recipient views them.
  const [viewMode, setViewMode] = useState('grid')

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
  // Arrays, not strings: these three are any-of multi-selects now, and getAll
  // is what restores every value from a shared ?heating=A&heating=B link
  // rather than only the first one.
  const [heating,     setHeating]     = useState(() => searchParams.getAll('heating'))
  const [parking,     setParking]     = useState(() => searchParams.getAll('parking'))
  const [buildingAge, setBuildingAge] = useState(() => searchParams.getAll('buildingAge'))
  const [furnished,   setFurnished]   = useState(searchParams.get('furnished') || '')
  const [balcony,     setBalcony]     = useState(searchParams.get('balcony') || '')
  const [elevator,    setElevator]    = useState(searchParams.get('elevator') || '')
  const [pool,        setPool]        = useState(searchParams.get('pool') || '')
  const [garden,      setGarden]      = useState(searchParams.get('garden') || '')

  // ── Wave 10B4 ──
  const [baths,       setBaths]       = useState(searchParams.get('baths') || '')
  const [minNetSqm,   setMinNetSqm]   = useState(searchParams.get('minNetSqm') || '')
  const [maxNetSqm,   setMaxNetSqm]   = useState(searchParams.get('maxNetSqm') || '')
  const [minOpenArea, setMinOpenArea] = useState(searchParams.get('minOpenArea') || '')
  const [maxOpenArea, setMaxOpenArea] = useState(searchParams.get('maxOpenArea') || '')
  const [minCoefficient, setMinCoefficient] = useState(searchParams.get('minCoefficient') || '')
  const [maxCoefficient, setMaxCoefficient] = useState(searchParams.get('maxCoefficient') || '')
  const [floorLocation, setFloorLocation] = useState(() => searchParams.getAll('floorLocation'))
  const [kitchenType, setKitchenType] = useState(() => searchParams.getAll('kitchenType'))
  const [usageStatus, setUsageStatus] = useState(() => searchParams.getAll('usageStatus'))
  const [titleDeedStatus, setTitleDeedStatus] = useState(() => searchParams.getAll('titleDeedStatus'))
  const [nearbyTransport, setNearbyTransport] = useState(() => searchParams.getAll('nearbyTransport'))
  const [listedSince, setListedSince] = useState(searchParams.get('listedSince') || '')
  // One object rather than nine useStates: they are handled identically and
  // the grouping keeps the query builder and the reset honest.
  const [triState, setTriState] = useState(() => {
    const initial = {}
    for (const field of [...TRISTATE_AMENITIES, ...TRISTATE_LEGAL, 'hasVirtualTour']) {
      initial[field] = searchParams.get(field) || ''
    }
    return initial
  })

  // Reconcile external navigation before rendering controls or issuing requests.
  // The guard also handles our own URL replacement without remounting sections.
  const urlSearch = searchParams.toString()
  const [restoredSearch, setRestoredSearch] = useState(urlSearch)
  if (urlSearch !== restoredSearch) {
    setRestoredSearch(urlSearch)
    setListingType(searchParams.get('listingType') || '')
    setDistrict(searchParams.get('district') || '')
    setPropertyType(searchParams.get('propertyType') || '')
    setMinPrice(searchParams.get('minPrice') || '')
    setMaxPrice(searchParams.get('maxPrice') || '')
    setRooms(searchParams.get('rooms') || '')
    setMinSqm(searchParams.get('minSqm') || '')
    setMaxSqm(searchParams.get('maxSqm') || '')
    setFloor(searchParams.get('floor') || '')
    setTotalFloors(searchParams.get('totalFloors') || '')
    setFurnished(searchParams.get('furnished') || '')
    setBalcony(searchParams.get('balcony') || '')
    setElevator(searchParams.get('elevator') || '')
    setPool(searchParams.get('pool') || '')
    setGarden(searchParams.get('garden') || '')
    setBaths(searchParams.get('baths') || '')
    setMinNetSqm(searchParams.get('minNetSqm') || '')
    setMaxNetSqm(searchParams.get('maxNetSqm') || '')
    setMinOpenArea(searchParams.get('minOpenArea') || '')
    setMaxOpenArea(searchParams.get('maxOpenArea') || '')
    setMinCoefficient(searchParams.get('minCoefficient') || '')
    setMaxCoefficient(searchParams.get('maxCoefficient') || '')
    setListedSince(searchParams.get('listedSince') || '')
    setHeating(searchParams.getAll('heating'))
    setParking(searchParams.getAll('parking'))
    setBuildingAge(searchParams.getAll('buildingAge'))
    setFloorLocation(searchParams.getAll('floorLocation'))
    setKitchenType(searchParams.getAll('kitchenType'))
    setUsageStatus(searchParams.getAll('usageStatus'))
    setTitleDeedStatus(searchParams.getAll('titleDeedStatus'))
    setNearbyTransport(searchParams.getAll('nearbyTransport'))
    const nextTriState = {}
    for (const field of [...TRISTATE_AMENITIES, ...TRISTATE_LEGAL, 'hasVirtualTour']) {
      nextTriState[field] = searchParams.get(field) || ''
    }
    setTriState(nextTriState)
  }

  useEffect(() => {
    api.get('/properties/areas').then(r => setAreas(r.data.areas || [])).catch(() => {})
  }, [])

  /*
   * One query string drives BOTH the request and the address bar, so the two
   * can never disagree. Built as URLSearchParams rather than an axios params
   * object because a multi-select must serialise as repeated keys
   * (?nearbyTransport=Metro&nearbyTransport=Ferry) — which is what the route
   * normalises into an any-of match. Axios would encode an array as
   * `nearbyTransport[]`, a key the server does not read.
   */
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    const setIf = (key, value) => { if (value) params.set(key, value) }
    const appendAll = (key, values) => { for (const v of values) params.append(key, v) }

    setIf('listingType', listingType)
    setIf('district', district)
    setIf('propertyType', propertyType)
    setIf('minPrice', minPrice)
    setIf('maxPrice', maxPrice)
    setIf('rooms', rooms)
    setIf('minSqm', minSqm)
    setIf('maxSqm', maxSqm)
    setIf('floor', floor)
    setIf('totalFloors', totalFloors)
    setIf('furnished', furnished)
    setIf('balcony', balcony)
    setIf('elevator', elevator)
    setIf('pool', pool)
    setIf('garden', garden)

    setIf('baths', baths)
    setIf('minNetSqm', minNetSqm)
    setIf('maxNetSqm', maxNetSqm)
    setIf('minOpenArea', minOpenArea)
    setIf('maxOpenArea', maxOpenArea)
    setIf('minCoefficient', minCoefficient)
    setIf('maxCoefficient', maxCoefficient)
    setIf('listedSince', listedSince)

    appendAll('heating', heating)
    appendAll('parking', parking)
    appendAll('buildingAge', buildingAge)
    appendAll('floorLocation', floorLocation)
    appendAll('kitchenType', kitchenType)
    appendAll('usageStatus', usageStatus)
    appendAll('titleDeedStatus', titleDeedStatus)
    appendAll('nearbyTransport', nearbyTransport)

    for (const [field, value] of Object.entries(triState)) setIf(field, value)

    return params.toString()
  }, [
    listingType, district, propertyType, minPrice, maxPrice, rooms, minSqm, maxSqm,
    floor, totalFloors, heating, parking, buildingAge,
    furnished, balcony, elevator, pool, garden,
    baths, minNetSqm, maxNetSqm, minOpenArea, maxOpenArea, minCoefficient, maxCoefficient,
    floorLocation, kitchenType, usageStatus, titleDeedStatus, nearbyTransport,
    listedSince, triState,
  ])

  /** Distinct filters in play — a multi-select counts once, not once per value. */
  const activeFilterCount = useMemo(
    () => new Set([...new URLSearchParams(queryString).keys()]).size,
    [queryString]
  )

  const fetchProperties = useCallback(() => {
    const requestId = ++propertiesRequest.current
    setLoading(true)
    setLoadError(false)
    return api.get(`/properties${queryString ? '?' + queryString : ''}`)
      .then(r => {
        if (requestId !== propertiesRequest.current) return
        setProperties(r.data.properties || [])
        setTotal(r.data.count || 0)
      })
      .catch(() => {
        if (requestId !== propertiesRequest.current) return
        setLoadError(true)
      })
      .finally(() => { if (requestId === propertiesRequest.current) setLoading(false) })
  }, [queryString])

  useEffect(() => {
    fetchProperties()
    const requests = propertiesRequest
    return () => { requests.current++ }
  }, [fetchProperties])

  /*
   * Keeps the address bar in step, so a filtered search survives a refresh and
   * can be shared. `replace` because the list refetches as the user types —
   * pushing a history entry per keystroke would bury the previous page under
   * dozens of near-identical states and make Back useless.
   */
  useEffect(() => {
    setSearchParams(queryString, { replace: true })
  }, [queryString, setSearchParams])


  const clearFilters = () => {
    setListingType(''); setDistrict(''); setPropertyType(''); setMinPrice(''); setMaxPrice('')
    setRooms(''); setMinSqm(''); setMaxSqm(''); setFloor(''); setTotalFloors('')
    setHeating([]); setParking([]); setBuildingAge([]); setFurnished('')
    setBalcony(''); setElevator(''); setPool(''); setGarden('')
    setBaths(''); setMinNetSqm(''); setMaxNetSqm(''); setMinOpenArea(''); setMaxOpenArea('')
    setMinCoefficient(''); setMaxCoefficient(''); setListedSince('')
    setFloorLocation([]); setKitchenType([]); setUsageStatus([]); setTitleDeedStatus([])
    setNearbyTransport([])
    setTriState(prev => Object.fromEntries(Object.keys(prev).map(field => [field, ''])))
    setSearchParams({})
    setMobileFilterOpen(false)
  }

  const inp = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5E7F52]'
  const chk = 'h-4 w-4 rounded border-slate-300 text-[#5E7F52] focus:ring-[#5E7F52]'

  const pp = t.propertiesPage || {}
  // Canonical-value labels were translated in Waves 10B2/10B3; reused rather
  // than duplicated so the public filter and the admin form cannot drift.
  const optionLabels = t.adminPages?.properties || {}

  const toggleInArray = (setter) => (option) =>
    setter(prev => (prev.includes(option) ? prev.filter(v => v !== option) : [...prev, option]))

  const setTri = (field, value) => setTriState(prev => ({ ...prev, [field]: value }))

  const rangeRow = (key, labelText, minValue, setMin, maxValue, setMax, step, srOnly) => (
    <div key={key}>
      {srOnly ? <span className="sr-only">{labelText}</span> : <Label>{labelText}</Label>}
      <div className="flex gap-2">
        <input
          type="number" inputMode="decimal" step={step} min="0"
          aria-label={`${labelText} — ${pp.min || 'Min'}`}
          placeholder={pp.min || 'Min'}
          value={minValue} onChange={e => setMin(e.target.value)} className={inp}
        />
        <input
          type="number" inputMode="decimal" step={step} min="0"
          aria-label={`${labelText} — ${pp.max || 'Max'}`}
          placeholder={pp.max || 'Max'}
          value={maxValue} onChange={e => setMax(e.target.value)} className={inp}
        />
      </div>
    </div>
  )

  const multiSelect = (idPrefix, field, labelText, options, values, setter, labelMap, srOnly) => (
    <fieldset key={field}>
      <legend className={srOnly ? 'sr-only' : 'mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500'}>{labelText}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map(option => (
          <label key={option} htmlFor={`${idPrefix}-${field}-${option}`} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
            <input
              id={`${idPrefix}-${field}-${option}`}
              type="checkbox"
              className={chk}
              checked={values.includes(option)}
              onChange={() => setter(option)}
            />
            <span>{labelMap?.[option] || option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )

  /*
   * Any / Yes / No, never a checkbox.
   *
   * These amenities have no schema default, so a listing is true, false, or
   * never recorded. A checkbox can only say "yes" or "not yes", which would
   * fold "we never asked" into "it has none" — exactly the distinction Waves
   * 10B1 to 10B3 kept intact.
   */
  /*
   * A plain checkbox, for the five fields the route only ever narrows on when
   * they are true (`if (furnished === 'true')`). Unticked means "do not filter",
   * which is exactly what an unchecked box should say — so unlike the tri-state
   * fields below, nothing is lost by using one here.
   */
  const yesOnly = (idPrefix, field, labelText, value, setter) => (
    <label key={field} htmlFor={`${idPrefix}-${field}`} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
      <input
        id={`${idPrefix}-${field}`}
        type="checkbox"
        className={chk}
        checked={value === 'true'}
        onChange={e => setter(e.target.checked ? 'true' : '')}
      />
      <span>{labelText}</span>
    </label>
  )

  const triSelect = (idPrefix, field, labelText, srOnly) => (
    <div key={field}>
      <label htmlFor={`${idPrefix}-${field}`} className={srOnly ? 'sr-only' : 'mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500'}>{labelText}</label>
      <select id={`${idPrefix}-${field}`} value={triState[field]} onChange={e => setTri(field, e.target.value)} className={inp}>
        <option value="">{pp.any || 'Any'}</option>
        <option value="true">{pp.yes || 'Yes'}</option>
        <option value="false">{pp.no || 'No'}</option>
      </select>
    </div>
  )

  /*
   * Rendered TWICE: the desktop sidebar, which is always mounted and merely
   * hidden by CSS below the `lg` breakpoint, and the mobile drawer, which
   * mounts only while it is open. With the drawer open both trees are in the
   * DOM at once, so every generated id is scoped to its instance.
   *
   * Without the prefix each id existed twice, and `htmlFor` resolves to the
   * FIRST match in document order — the hidden desktop control. Clicking a
   * label in the drawer would have moved focus to an element the user cannot
   * see, and the duplicate ids were invalid HTML besides.
   *
   * Called as a normal function, never mounted as a component type: that is
   * what keeps inputs from being torn down and re-created on every keystroke.
   */
  const renderFilterPanel = (instanceId, onDone) => (
    <div className="space-y-4">
      {/*
        Every filter's heading is visible while scrolling; only its controls are
        collapsed. There is no master "show advanced filters" gate any more —
        that hid two thirds of the panel behind one click and made the site look
        like it filtered on far less than it does.

        The four controls above the accordions stay permanently open because
        they are the ones almost every search touches.
      */}

      {/* Listing type */}
      <div className="pb-4 border-b border-slate-100">
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

      {/* District */}
      <div className="pb-4 border-b border-slate-100">
        <label htmlFor={`${instanceId}-district`} className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t.propertiesPage?.district || 'District'}</label>
        <select id={`${instanceId}-district`} value={district} onChange={e => setDistrict(e.target.value)} className={inp}>
          <option value="">{t.propertiesPage?.allDistricts || 'All Districts'}</option>
          {areas.map(a => <option key={a.district} value={a.district}>{a.district} ({a.count})</option>)}
        </select>
      </div>

      {/* Property type */}
      <div className="pb-4 border-b border-slate-100">
        <label htmlFor={`${instanceId}-propertyType`} className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t.propertiesPage?.propertyType || 'Property Type'}</label>
        <select id={`${instanceId}-propertyType`} value={propertyType} onChange={e => setPropertyType(e.target.value)} className={inp}>
          <option value="">{t.propertiesPage?.allTypes || 'All Types'}</option>
          {PROPERTY_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </div>

      {/* Price */}
      <div className="pb-4 border-b border-slate-100">
        {rangeRow('price', t.propertiesPage?.priceRange || 'Price Range ($)', minPrice, setMinPrice, maxPrice, setMaxPrice)}
      </div>

      <FilterSection id={`${instanceId}-rooms`} title={t.propertiesPage?.rooms || 'Number of Rooms'} defaultOpen>
        <label htmlFor={`${instanceId}-rooms-select`} className="sr-only">{t.propertiesPage?.rooms || 'Number of Rooms'}</label>
        <select id={`${instanceId}-rooms-select`} value={rooms} onChange={e => setRooms(e.target.value)} className={inp}>
          <option value="">{pp.any || 'Any'}</option>
          {ROOM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </FilterSection>

      <FilterSection id={`${instanceId}-grossArea`} title={pp.grossArea || 'Area (Gross m²)'} defaultOpen>
        {rangeRow('sqm', pp.grossArea || 'Area (Gross m²)', minSqm, setMinSqm, maxSqm, setMaxSqm, undefined, true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-netArea`} title={pp.netArea || 'Area (Net m²)'}>
        {rangeRow('netSqm', pp.netArea || 'Area (Net m²)', minNetSqm, setMinNetSqm, maxNetSqm, setMaxNetSqm, '0.01', true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-openArea`} title={pp.openArea || 'Open Area (m²)'}>
        {rangeRow('openArea', pp.openArea || 'Open Area (m²)', minOpenArea, setMinOpenArea, maxOpenArea, setMaxOpenArea, '0.01', true)}
      </FilterSection>

      {/* Any-of, like the other enum filters: a buyer usually has a band in mind
          ("anything under 10 years"), not one exact bracket. */}
      <FilterSection id={`${instanceId}-buildingAge`} title={pp.buildingAge || 'Building Age'}>
        {multiSelect(instanceId, 'buildingAge', pp.buildingAge || 'Building Age', BUILDING_AGE,
          buildingAge, toggleInArray(setBuildingAge), optionLabels.buildingAgeOptions, true)}
      </FilterSection>

      {/* Deliberately labelled with no unit or interpretation — the reference
          documents none, so none is invented here. */}
      <FilterSection id={`${instanceId}-coefficient`} title={pp.coefficient || 'Coefficient'}>
        {rangeRow('coefficient', pp.coefficient || 'Coefficient', minCoefficient, setMinCoefficient, maxCoefficient, setMaxCoefficient, '0.01', true)}
      </FilterSection>

      {/* Floor number, total floors and the named floor positions are one
          question ("where in the building?"), so they share a row. */}
      <FilterSection id={`${instanceId}-floor`} title={t.propertiesPage?.floor || 'Floor'}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input type="number" aria-label={pp.floorNo || 'Floor no.'} placeholder={pp.floorNo || 'Floor no.'}
              value={floor} onChange={e => setFloor(e.target.value)} className={inp} min="0" />
            <input type="number" aria-label={pp.totalFloors || 'Total floors'} placeholder={pp.totalFloors || 'Total floors'}
              value={totalFloors} onChange={e => setTotalFloors(e.target.value)} className={inp} min="0" />
          </div>
          {multiSelect(instanceId, 'floorLocation', pp.floorLocation || 'Floor Location', FLOOR_LOCATIONS,
            floorLocation, toggleInArray(setFloorLocation), optionLabels.floorLocationOptions)}
        </div>
      </FilterSection>

      <FilterSection id={`${instanceId}-heating`} title={pp.heating || 'Heating'}>
        {multiSelect(instanceId, 'heating', pp.heating || 'Heating', HEATING,
          heating, toggleInArray(setHeating), optionLabels.heatingOptions, true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-baths`} title={pp.baths || 'Number of Bathrooms'}>
        <label htmlFor={`${instanceId}-baths-select`} className="sr-only">{pp.baths || 'Number of Bathrooms'}</label>
        <select id={`${instanceId}-baths-select`} value={baths} onChange={e => setBaths(e.target.value)} className={inp}>
          <option value="">{pp.any || 'Any'}</option>
          {BATHS_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </FilterSection>

      <FilterSection id={`${instanceId}-kitchenType`} title={pp.kitchenType || 'Kitchen'}>
        {multiSelect(instanceId, 'kitchenType', pp.kitchenType || 'Kitchen', KITCHEN_TYPES,
          kitchenType, toggleInArray(setKitchenType), optionLabels.kitchenOptions, true)}
      </FilterSection>

      {/*
        balcony / elevator / furnished / pool / garden are stored one-way — the
        route only narrows on `true` — so a checkbox is the honest control for
        them. The tri-state fields below get Any/Yes/No instead, because for
        those "not recorded" and "no" are different answers and a checkbox
        cannot say which one it means.
      */}
      <FilterSection id={`${instanceId}-balcony`} title={t.propertiesPage?.balcony || 'Balcony'}>
        {yesOnly(instanceId, 'balcony', t.propertiesPage?.balcony || 'Balcony', balcony, setBalcony)}
      </FilterSection>

      <FilterSection id={`${instanceId}-elevator`} title={pp.lift || t.propertiesPage?.elevator || 'Lift'}>
        {yesOnly(instanceId, 'elevator', pp.lift || t.propertiesPage?.elevator || 'Lift', elevator, setElevator)}
      </FilterSection>

      <FilterSection id={`${instanceId}-parking`} title={pp.parking || 'Parking'}>
        {multiSelect(instanceId, 'parking', pp.parking || 'Parking', PARKING,
          parking, toggleInArray(setParking), optionLabels.parkingOptions, true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-furnished`} title={t.propertiesPage?.furnished || 'Furnished'}>
        {yesOnly(instanceId, 'furnished', t.propertiesPage?.furnished || 'Furnished', furnished, setFurnished)}
      </FilterSection>

      <FilterSection id={`${instanceId}-usageStatus`} title={pp.usageStatus || 'Usage Status'}>
        {multiSelect(instanceId, 'usageStatus', pp.usageStatus || 'Usage Status', USAGE_STATUSES,
          usageStatus, toggleInArray(setUsageStatus), optionLabels.usageStatusOptions, true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-withinSite`} title={optionLabels.amenityOptions?.withinSite || 'Within a Site/Complex'}>
        {triSelect(instanceId, 'withinSite', optionLabels.amenityOptions?.withinSite || 'Within a Site/Complex', true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-eligibleForCredit`} title={optionLabels.amenityOptions?.eligibleForCredit || 'Eligible for Credit'}>
        {triSelect(instanceId, 'eligibleForCredit', optionLabels.amenityOptions?.eligibleForCredit || 'Eligible for Credit', true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-titleDeedStatus`} title={pp.titleDeedStatus || 'Title Deed Status'}>
        {multiSelect(instanceId, 'titleDeedStatus', pp.titleDeedStatus || 'Title Deed Status', TITLE_DEED_STATUSES,
          titleDeedStatus, toggleInArray(setTitleDeedStatus), optionLabels.titleDeedOptions, true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-exchange`} title={optionLabels.amenityOptions?.exchange || 'Open to Exchange'}>
        {triSelect(instanceId, 'exchange', optionLabels.amenityOptions?.exchange || 'Open to Exchange', true)}
      </FilterSection>

      {/*
        Pool and garden are the one-way pair; the five wellness rooms are
        tri-state. They share a row because that is the question a visitor asks,
        and each field still appears exactly once in the whole panel.
      */}
      <FilterSection id={`${instanceId}-wellness`} title={pp.sectionWellness || 'Pool, Sauna & Wellness'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {yesOnly(instanceId, 'pool', t.propertiesPage?.pool || 'Pool', pool, setPool)}
            {yesOnly(instanceId, 'garden', t.propertiesPage?.garden || 'Garden', garden, setGarden)}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TRISTATE_AMENITIES.map(field =>
              triSelect(instanceId, field, optionLabels.amenityOptions?.[field] || field))}
          </div>
        </div>
      </FilterSection>

      <FilterSection id={`${instanceId}-nearbyTransport`} title={pp.nearbyTransport || 'Nearby Transportation'}>
        {multiSelect(instanceId, 'nearbyTransport', pp.nearbyTransport || 'Nearby Transportation', TRANSPORT_OPTIONS,
          nearbyTransport, toggleInArray(setNearbyTransport), optionLabels.transportOptions, true)}
      </FilterSection>

      <FilterSection id={`${instanceId}-listedSince`} title={pp.sectionListingDate || 'Date of Announcement'}>
        <label htmlFor={`${instanceId}-listedSince`} className="sr-only">{pp.listedSince || 'Listed'}</label>
        <select id={`${instanceId}-listedSince`} value={listedSince} onChange={e => setListedSince(e.target.value)} className={inp}>
          <option value="">{pp.anyTime || 'Any time'}</option>
          {LISTED_SINCE_DAYS.map(days => (
            <option key={days} value={days}>
              {pp[`last${days}Days`] || `Last ${days} days`}
            </option>
          ))}
        </select>
      </FilterSection>

      {/*
        The reference calls this row "Photo, Video" and puts a video-only
        checkbox in it. There is no video field on the schema — it matches a
        regex against image URLs — so only the filter that is real is offered
        here, under its real name.
      */}
      <FilterSection id={`${instanceId}-hasVirtualTour`} title={pp.hasVirtualTour || 'Virtual Tour'}>
        {triSelect(instanceId, 'hasVirtualTour', pp.hasVirtualTour || 'Virtual Tour', true)}
      </FilterSection>

      <div className="flex flex-col gap-2 pt-2">
        {/*
          No "Apply" on desktop: results already refetch as the query string
          changes, so a button implying unapplied changes would be a lie. In the
          mobile drawer the same button has a real job — closing the drawer over
          the results it just filtered.
        */}
        {onDone && (
          <button type="button" onClick={onDone} className="w-full rounded-full bg-[#4b6741] py-3 text-sm font-semibold text-white transition hover:bg-[#3a5030] cursor-pointer">
            {t.propertiesPage?.apply || 'Apply Filters'}
          </button>
        )}
        <button type="button" onClick={clearFilters} className="w-full text-center text-sm text-slate-500 hover:text-slate-800 cursor-pointer">
          {t.propertiesPage?.clearAll || 'Clear All'}
          {activeFilterCount > 0 && (
            <span className="ms-2 rounded-full bg-[#5E7F52] px-2 py-0.5 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
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

          {/* List stays the default and the accessible representation; the map
              is an alternate view of the same result set, never a replacement. */}
          <div
            className="inline-flex items-center gap-1 rounded-full border p-1"
            style={{ borderColor: 'var(--vk-border)' }}
            role="group"
            aria-label={t.propertiesPage?.viewToggleLabel || 'Choose how to view results'}
          >
            {[
              ['grid', t.propertiesPage?.listView || 'List'],
              ['map', t.propertiesPage?.mapView || 'Map'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition cursor-pointer"
                style={viewMode === mode
                  ? { backgroundColor: C.accent, color: '#ffffff' }
                  : { color: 'var(--vk-text-muted)' }}
              >
                {label}
              </button>
            ))}
          </div>
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
            <div className="vk-scroll-gold sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-h-[calc(100vh-7rem)] overflow-y-auto">
              <h3 style={{ fontFamily: 'Cinzel, serif' }} className="mb-5 text-base font-semibold text-[#1E1E1C]">{t.propertiesPage?.filters || 'Filters'}</h3>
              {renderFilterPanel('desktop')}
            </div>
          </aside>

          {/* Results */}
          <main className="flex-1 min-w-0">
            {loading ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : loadError ? (
              <div role="alert" className="rounded-2xl border p-8 text-center" style={{ borderColor: 'var(--vk-border)', color: 'var(--vk-text)' }}>
                <p>{pp.loadError}</p>
                <button type="button" onClick={fetchProperties} className="mt-3 underline cursor-pointer">{pp.retry}</button>
              </div>
            ) : properties.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                <h3 className="mt-4 text-xl font-semibold text-slate-700">{t.propertiesPage?.noResults || 'No properties found'}</h3>
                <p className="mt-2 text-slate-500">{t.propertiesPage?.noResultsHint || 'Try adjusting your filters.'}</p>
                <button onClick={clearFilters} className="mt-4 rounded-full bg-[#5E7F52] px-6 py-2.5 text-sm font-semibold text-white cursor-pointer">{t.propertiesPage?.clearFilters || 'Clear Filters'}</button>
              </div>
            ) : viewMode === 'map' ? (
              /* The SAME array the grid renders. Filtering happens server-side
                 in fetchProperties(), so both views see one result set and no
                 second query or parallel filter logic can drift. */
              <PropertyMapView properties={properties} labels={t.propertiesPage || {}} />
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
          <div className="vk-scroll-gold relative ms-auto h-full w-80 max-w-full overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h3 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#1E1E1C]">{t.propertiesPage?.filters || 'Filters'}</h3>
              <button onClick={() => setMobileFilterOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {renderFilterPanel('mobile', () => setMobileFilterOpen(false))}
          </div>
        </div>
      )}
    </div>
  )
}

export default PropertiesPage
