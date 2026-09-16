import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatPrice } from '../lib/formatPrice'
import PropertyLocationPicker from '../components/PropertyLocationPicker'
import AdminPropertyAssistant from '../components/AdminPropertyAssistant'

// `agent` is the assigned agent's User id, or '' for Unassigned. There is no
// agentName field: the name now comes from the selected account, so an admin
// never types the same person's name twice. agentEmail is read-only and filled
// from the selection; phone and WhatsApp stay manual.
const emptyForm = { title:'', listingType:'Sale', price:'', priceLabel:'$', district:'', address:'', propertyType:'Apartment', beds:'', baths:'', sqm:'', description:'', agent:'', agentPhone:'', agentEmail:'', whatsappNumber:'', featured:false, status:'Available' }


/*
 * Option vocabularies.
 *
 * The first five are CURRENT's own, copied verbatim from the public filter on
 * PropertiesPage so the admin can only enter values the public site can filter
 * on. The donor's equivalents are deliberately NOT used: its room list is 13
 * entries against CURRENT's 43, and its heating, parking and building-age
 * vocabularies disagree outright. Adopting them would have stranded every
 * listing already stored under a CURRENT value.
 *
 * The rest mirror the enums in backend/routes/properties.js. These are the
 * values the server accepts — stored canonically in English and translated
 * only for display, so a listing entered in Turkish still filters in English.
 */
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
const HEATING_OPTIONS = [
  'Stove','Natural Gas Stove','Central Heating','Central','Central (Meter)',
  'Combi Boiler (Natural Gas)','Individual Gas','Floor Heating','Air Conditioning','None',
]
const PARKING_OPTIONS = [
  'Open Parking','Closed Parking','Open Parking Lot','Parking Garage',
  'Open & Covered Parking','None',
]
// Twelve canonical buckets. The three this site used to offer
// ('0 (New)', '1-5', '21+') are deliberately absent: they are still
// accepted by the public filter route for old links, but no NEW listing
// should be filed under a bucket that cannot answer a relative-age query.
const BUILDING_AGE_OPTIONS = ['0','1','2','3','4','5','6-10','11-15','16-20','21-25','26-30','31+']
// All twelve schema values. The form previously offered only the first eight,
// so Shop, Warehouse, Hotel and Farm were unreachable from the admin.
const PROPERTY_TYPES = ['Apartment','Villa','Penthouse','Duplex','Studio','Office','Commercial','Land','Shop','Warehouse','Hotel','Farm']

const FLOOR_LOCATIONS = ['Ground floor','High Entrance','Penthouse','Duplex','Triplex']
const KITCHEN_TYPES = ['Open (American)','Closed']
const USAGE_STATUSES = ['Empty','Tenant','Property Owner']
const TITLE_DEED_STATUSES = [
  'Shared Title Deed','Independent Title Deed','Land with Title Deed',
  'Cooperative Share Title Deed','Established Usufruct Right',
]
const TRANSPORT_OPTIONS = ['Metro','Metrobus','Bus','Ferry','Train','Tram','Highway Access']
const CURRENCIES = ['TL','USD','EUR','GBP']
const CURRENCY_TO_SYMBOL = { TL: '\u20BA', USD: '$', EUR: '\u20AC', GBP: '\u00A3' }

/*
 * The two amenity groups are NOT interchangeable, which is why they are two
 * lists rather than one.
 *
 * CLASSIC_BOOLEANS predate this wave and carry `default: false` in the schema,
 * so every stored property already has a real true/false for them. A checkbox
 * is honest there.
 *
 * TRISTATE_BOOLEANS were added in Wave 10B1 with NO default, precisely so that
 * "nobody has ever recorded whether this flat has a sauna" stays different from
 * "this flat has no sauna". A checkbox cannot express that third state: it
 * would render every legacy unknown as unchecked and then save it as a
 * confident false the first time an admin edited the title. They get a
 * Yes / No / Not specified select instead.
 */
const CLASSIC_BOOLEANS = ['furnished','balcony','elevator','pool','garden']
const TRISTATE_BOOLEANS = [
  'sauna','jacuzzi','steamRoom','turkishBath','basement',
  'withinSite','eligibleForCredit','exchange',
]
const OPTIONAL_NUMBERS = ['netSqm','openAreaSqm','coefficient','floor','totalFloors']
const OPTIONAL_ENUMS = [
  'currency','rooms','floorLocation','buildingAge','heating','parking',
  'kitchenType','usageStatus','titleDeedStatus',
]

// English fallbacks, used only until a translation key is present. The keys
// are field names, so they cannot double as display text the way the enum
// vocabularies above can.
const DETAIL_FALLBACK = {
  netSqm: 'Net Area (m\u00B2)', openAreaSqm: 'Open Area (m\u00B2)', coefficient: 'Coefficient',
  floor: 'Floor (number)', totalFloors: 'Total Floors in Building',
  currency: 'Currency', rooms: 'Room Layout', floorLocation: 'Floor Location',
  buildingAge: 'Building Age', heating: 'Heating', parking: 'Parking',
  kitchenType: 'Kitchen Type', usageStatus: 'Usage Status',
  titleDeedStatus: 'Title Deed Status', hasVirtualTour: 'Has a Virtual Tour',
  virtualTourUrl: 'Virtual Tour URL',
}

const AMENITY_FALLBACK = {
  furnished: 'Furnished', balcony: 'Balcony', elevator: 'Lift / Elevator',
  pool: 'Pool', garden: 'Garden', sauna: 'Sauna', jacuzzi: 'Jacuzzi',
  steamRoom: 'Steam Room', turkishBath: 'Turkish Bath', basement: 'Basement',
  withinSite: 'Within a Site / Complex', eligibleForCredit: 'Eligible for Credit',
  exchange: 'Open to Exchange',
}

/** Mirrors symbolToCurrency() in backend/routes/properties.js. */
const symbolToCurrency = (label) => {
  const trimmed = String(label ?? '').trim()
  if (!trimmed) return null
  if (trimmed.toUpperCase() === 'TL') return 'TL'
  const match = Object.entries(CURRENCY_TO_SYMBOL).find(([, symbol]) => symbol === trimmed)
  return match ? match[0] : null
}

/*
 * Detail fields live OUTSIDE `form` on purpose.
 *
 * handleSubmit builds its payload with `{ ...form }`, so anything added to
 * form is sent unconditionally. That is exactly wrong for these: a blank
 * optional number must not be transmitted as '', and an unset tri-state must
 * not be transmitted at all. Keeping them separate means the only way they
 * reach the server is through buildDetailsPayload below, which decides field
 * by field whether a key is sent.
 *
 * Everything is held as the string an input actually produces. Nothing is
 * converted on keystroke — Number() on every change turns a half-typed '1.'
 * into 1 and fights the admin's cursor.
 */
const emptyDetails = {
  netSqm: '', openAreaSqm: '', coefficient: '', floor: '', totalFloors: '',
  // A new listing is priced in something, so USD is a real default here. On an
  // EXISTING listing this is derived instead — see detailsFromProperty.
  currency: 'USD',
  rooms: '', floorLocation: '', buildingAge: '', heating: '', parking: '',
  kitchenType: '', usageStatus: '', titleDeedStatus: '',
  furnished: false, balcony: false, elevator: false, pool: false, garden: false,
  // '' | 'true' | 'false'. '' is the unknown that must survive a round trip.
  sauna: '', jacuzzi: '', steamRoom: '', turkishBath: '', basement: '',
  withinSite: '', eligibleForCredit: '', exchange: '', hasVirtualTour: '',
  nearbyTransport: [],
  virtualTourUrl: '',
}

const numberToInput = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const stringToInput = (v) => (typeof v === 'string' ? v : '')
/** true -> 'true', false -> 'false', anything else -> '' (never recorded). */
const booleanToTriState = (v) => (v === true ? 'true' : v === false ? 'false' : '')

/**
 * Builds the detail half of the form from a stored property.
 *
 * `??` and explicit type tests throughout rather than `||`, because false and 0
 * are legitimate stored values that `||` would quietly replace with a default.
 */
const detailsFromProperty = (prop) => {
  const out = { ...emptyDetails }

  for (const field of OPTIONAL_NUMBERS) out[field] = numberToInput(prop[field])
  for (const field of OPTIONAL_ENUMS) out[field] = stringToInput(prop[field])
  for (const field of CLASSIC_BOOLEANS) out[field] = prop[field] === true
  for (const field of [...TRISTATE_BOOLEANS, 'hasVirtualTour']) {
    out[field] = booleanToTriState(prop[field])
  }

  out.nearbyTransport = Array.isArray(prop.nearbyTransport)
    ? prop.nearbyTransport.filter((entry) => TRANSPORT_OPTIONS.includes(entry))
    : []
  out.virtualTourUrl = stringToInput(prop.virtualTourUrl)

  /*
   * Currency is DERIVED, never defaulted, when editing.
   *
   * Defaulting to USD here is the bug the donor form shipped: a legacy listing
   * priced '\u20AC' with no stored currency would load as USD, and saving it would be
   * rejected by the server for contradicting its own price label — or worse,
   * accepted and relabelled. So: use the stored currency if there is one, fall
   * back to whatever the price label unambiguously means, and otherwise leave
   * it unspecified. A custom label like 'Price on request' maps to nothing and
   * is left exactly as the admin wrote it.
   */
  out.currency = CURRENCIES.includes(prop.currency)
    ? prop.currency
    : symbolToCurrency(prop.priceLabel) || ''

  return out
}

/**
 * Turns detail state into the keys that may be sent.
 *
 * The omissions are the point of this function:
 *
 *   blank optional number -> omitted. Wave 10B1 treats a skipped value as a
 *       no-op, so an omitted key preserves what is stored. Sending '' would
 *       be asking for a clear the backend does not implement.
 *   unset tri-state       -> omitted, so an unknown amenity stays unknown.
 *   untouched transport   -> omitted, so a stored list is not replaced by [].
 *   blank tour URL        -> omitted, for the same reason as the numbers.
 *
 * The five classic booleans are always sent, because they always have a real
 * value; omitting them would be the anomaly.
 */
const buildDetailsPayload = (details, transportTouched) => {
  const out = {}

  for (const field of OPTIONAL_NUMBERS) {
    const raw = String(details[field]).trim()
    if (raw === '') continue
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) out[field] = parsed
  }

  for (const field of OPTIONAL_ENUMS) {
    if (details[field]) out[field] = details[field]
  }

  for (const field of CLASSIC_BOOLEANS) out[field] = details[field] === true

  for (const field of [...TRISTATE_BOOLEANS, 'hasVirtualTour']) {
    if (details[field] === 'true') out[field] = true
    else if (details[field] === 'false') out[field] = false
  }

  if (transportTouched) out.nearbyTransport = [...details.nearbyTransport]

  const tourUrl = details.virtualTourUrl.trim()
  if (tourUrl) out.virtualTourUrl = tourUrl

  return out
}

/** The list endpoint returns a raw id; a populated response returns an object. */
const agentIdOf = (agent) => (agent && typeof agent === 'object' ? agent._id : agent) || ''

/*
 * Location is held OUTSIDE `form` and as a small state machine rather than a
 * plain object, because "this property has no location" and "we do not yet
 * know this property's location" must never be confused.
 *
 *   { status: 'none' }              no location — nothing stored, or cleared
 *   { status: 'set',     value }    a complete, validated coordinate
 *   { status: 'loading' }           fetching the exact pin for an edit
 *   { status: 'unknown' }           the fetch FAILED
 *
 * The 'unknown' state is the whole reason this is not a plain object. A public
 * listing payload for an APPROXIMATE property legitimately contains no
 * coordinates (Wave 9a redacts them), so an admin-location request that fails
 * would otherwise look exactly like "there is no pin" — and the next save
 * would quietly erase a location the admin never touched.
 */
const LOCATION_NONE = { status: 'none' }

const isValidLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90
const isValidLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180

/** Normalises an /admin-location response into the state machine above. */
const locationStateFromApi = (loc) =>
  loc && isValidLat(loc.lat) && isValidLng(loc.lng)
    ? {
        status: 'set',
        value: {
          lat: loc.lat,
          lng: loc.lng,
          isApproximate: loc.isApproximate === true,
          approxRadiusKm: Number.isFinite(loc.approxRadiusKm) ? loc.approxRadiusKm : 5,
        },
      }
    : LOCATION_NONE

const AdminProperties = () => {
  const { user, hasPermission } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.properties || {}
  const c = t.adminPages?.common || {}
  const [properties, setProperties] = useState([])
  const [tab, setTab] = useState('all')
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [images, setImages] = useState([])
  const [mainImage, setMainImage] = useState('')
  const editorSession = useRef(0)
  const locationRequest = useRef(0)
  const propertiesRequest = useRef(0)
  const [loadError, setLoadError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [agents, setAgents] = useState([])
  // 'idle' | 'loading' | 'ready' | 'error'. Until the list is 'ready', an
  // assigned agent missing from it is simply not known yet — not inactive.
  const [agentsStatus, setAgentsStatus] = useState('idle')
  const agentsRequest = useRef(0)
  const [details, setDetails] = useState(emptyDetails)
  // Nearby transport is the one list where "empty" is ambiguous: it can mean
  // "no transport recorded" or "recorded as nothing nearby". Only an admin who
  // actually touched a checkbox has said which, so an untouched list is never
  // transmitted and the stored value is left alone.
  const [transportTouched, setTransportTouched] = useState(false)
  const [location, setLocation] = useState(LOCATION_NONE)
  // True only once the admin has actually touched the location controls, which
  // is what lets an untouched edit OMIT `location` and leave the stored pin
  // exactly as it is (Wave 9a: omitted means preserve).
  const [locationDirty, setLocationDirty] = useState(false)
  const [locationDraftError, setLocationDraftError] = useState(false)

  const fetchProperties = () => {
    const requestId = ++propertiesRequest.current
    setLoading(true)
    setLoadError(false)
    return api.get('/properties')
      .then(r => { if (requestId === propertiesRequest.current) setProperties(r.data.properties || []) })
      .catch(() => { if (requestId === propertiesRequest.current) setLoadError(true) })
      .finally(() => { if (requestId === propertiesRequest.current) setLoading(false) })
  }
  useEffect(() => { fetchProperties() }, [])
  useEffect(() => () => {
    propertiesRequest.current++
    editorSession.current++
    locationRequest.current++
    agentsRequest.current++
  }, [])

  /**
   * Real agent accounts for the selector — never a hardcoded list. The
   * endpoint returns ACTIVE agents only and just four public fields.
   *
   * Fetched every time the editor opens, not once per page mount. A one-shot
   * mount load kept whatever the list was when the page first rendered: an
   * account promoted to agent afterwards, or a request that failed while the
   * backend was restarting, left the dropdown at "Unassigned" until a full
   * page reload.
   *
   * A failure is reported, never swallowed into an empty list, and keeps the
   * last good list. Every other field still works, and the server rejects an
   * id that is not an active agent regardless.
   */
  const loadAgents = async () => {
    const requestId = ++agentsRequest.current
    setAgentsStatus('loading')

    try {
      const r = await api.get('/users/agents')
      if (requestId !== agentsRequest.current) return
      setAgents(r.data?.agents || [])
      setAgentsStatus('ready')
    } catch {
      if (requestId !== agentsRequest.current) return
      setAgentsStatus('error')
      toast.error(p.agentsLoadError || 'Could not load agents. Close and reopen the form to try again.')
    }
  }

  /**
   * Choosing an agent rewrites the agent-derived contact state.
   *
   * Email is copied straight from the selected account — the admin never types
   * it. Phone and WhatsApp are CLEARED whenever the agent actually changes,
   * because carrying the previous agent's numbers over to a new one would
   * publish "Agent: Mehmet / Phone: Ahmet's number" on the listing. Re-picking
   * the same agent is not a change and leaves them alone.
   *
   * The server enforces the same rules independently — this is here so the
   * admin sees the truth while filling the form, not as the safeguard.
   */
  const handleAgentChange = (nextAgentId) => {
    setForm(prev => {
      if (prev.agent === nextAgentId) return prev

      const selected = agents.find(a => a._id === nextAgentId)

      return {
        ...prev,
        agent: nextAgentId,
        agentEmail: selected?.email || '',
        agentPhone: '',
        whatsappNumber: '',
      }
    })
  }

  /**
   * Keeps currency and priceLabel from contradicting each other.
   *
   * The server rejects a bare label that disagrees with the currency, so
   * switching to EUR while the label still reads '$' would fail the save. The
   * label is therefore rewritten — but ONLY when it is a bare currency symbol
   * or empty. A custom label the admin composed ('Price on request',
   * '$1,850,000') maps to no currency, cannot contradict anything, and is left
   * untouched rather than being overwritten with a symbol.
   */
  const handleCurrencyChange = (nextCurrency) => {
    setDetails(prev => ({ ...prev, currency: nextCurrency }))

    if (!nextCurrency) return

    setForm(prev => {
      const current = prev.priceLabel.trim()
      if (current !== '' && !symbolToCurrency(current)) return prev
      return { ...prev, priceLabel: CURRENCY_TO_SYMBOL[nextCurrency] }
    })
  }

  const CORE_AI_FIELDS = new Set([
    'title', 'description', 'price', 'listingType', 'propertyType',
    'district', 'address', 'beds', 'baths', 'sqm',
  ])
  const DETAIL_AI_NUMBERS = new Set(['netSqm', 'openAreaSqm', 'floor', 'totalFloors'])
  const DETAIL_AI_ENUMS = new Set([
    'rooms', 'floorLocation', 'buildingAge', 'heating', 'kitchenType',
    'parking', 'usageStatus', 'titleDeedStatus',
  ])

  const applyParsedFields = (selected) => {
    const core = {}
    const detailValues = {}
    let nextCurrency
    let nextTransport

    for (const [field, value] of Object.entries(selected)) {
      if (CORE_AI_FIELDS.has(field)) {
        core[field] = ['price', 'beds', 'baths', 'sqm'].includes(field) ? String(value) : value
      } else if (DETAIL_AI_NUMBERS.has(field)) {
        detailValues[field] = String(value)
      } else if (DETAIL_AI_ENUMS.has(field)) {
        detailValues[field] = value
      } else if (CLASSIC_BOOLEANS.includes(field) && typeof value === 'boolean') {
        detailValues[field] = value
      } else if (TRISTATE_BOOLEANS.includes(field) && typeof value === 'boolean') {
        detailValues[field] = value ? 'true' : 'false'
      } else if (field === 'currency' && CURRENCIES.includes(value)) {
        nextCurrency = value
      } else if (field === 'nearbyTransport' && Array.isArray(value)) {
        nextTransport = value.filter((option) => TRANSPORT_OPTIONS.includes(option))
      }
    }

    if (Object.keys(core).length) setForm(prev => ({ ...prev, ...core }))
    if (Object.keys(detailValues).length) setDetails(prev => ({ ...prev, ...detailValues }))
    if (nextCurrency) handleCurrencyChange(nextCurrency)
    if (nextTransport) {
      setDetails(prev => ({ ...prev, nearbyTransport: [...new Set(nextTransport)] }))
      setTransportTouched(true)
    }
  }

  const applySuggestedCopy = (copy) => {
    setForm(prev => ({
      ...prev,
      ...(typeof copy.title === 'string' ? { title: copy.title } : {}),
      ...(typeof copy.description === 'string' ? { description: copy.description } : {}),
    }))
  }

  const toggleTransport = (option) => {
    setTransportTouched(true)
    setDetails(prev => ({
      ...prev,
      nearbyTransport: prev.nearbyTransport.includes(option)
        ? prev.nearbyTransport.filter(entry => entry !== option)
        : [...prev.nearbyTransport, option],
    }))
  }

  const resetLocationState = (next) => {
    setLocation(next)
    setLocationDirty(false)
    setLocationDraftError(false)
  }

  const openAdd = () => {
    editorSession.current++
    locationRequest.current++
    setUploading(false)
    setMainImage('')
    setEditingId(null)
    setForm(emptyForm)
    setDetails(emptyDetails)
    setTransportTouched(false)
    setImages([])
    resetLocationState(LOCATION_NONE)
    loadAgents()
    setFormOpen(true)
  }

  /**
   * Loads the EXACT stored pin for editing.
   *
   * The public list object deliberately cannot be used here: for an approximate
   * listing it carries no coordinates at all. This endpoint is gated on
   * edit_listing, so an admin holding only add_listing never receives the
   * private coordinate of an existing property — they simply edit without the
   * location controls, which is the correct outcome rather than a bug.
   */
  const loadAdminLocation = async (propertyId) => {
    const requestId = ++locationRequest.current
    const session = editorSession.current
    if (!hasPermission('edit_listing')) {
      resetLocationState({ status: 'unknown' })
      return
    }

    resetLocationState({ status: 'loading' })

    try {
      const r = await api.get(`/properties/${propertyId}/admin-location`)
      if (session !== editorSession.current || requestId !== locationRequest.current) return
      resetLocationState(locationStateFromApi(r.data?.location))
    } catch {
      if (session !== editorSession.current || requestId !== locationRequest.current) return
      // Deliberately NOT LOCATION_NONE. Treating a failed request as "no
      // location" is how a stored pin gets silently destroyed on the next save.
      resetLocationState({ status: 'unknown' })
      toast.error(p.locationLoadError || 'Could not load the saved location. Location editing is disabled until it loads.')
    }
  }

  // One way out, shared by the header X, Cancel and Escape, so the three
  // cannot drift into doing different cleanup.
  const closeForm = useCallback(() => {
    if (saving) return
    editorSession.current++
    locationRequest.current++
    agentsRequest.current++
    setFormOpen(false)
  }, [saving])

  // Escape closes the editor. Bound only while it is open and removed on
  // close/unmount, so no listener outlives the form. Deliberately does NOT
  // fire while saving: the request is already in flight and hiding it would
  // leave the admin unsure whether the property was written.
  useEffect(() => {
    if (!formOpen) return
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (saving) return
      closeForm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [formOpen, saving, closeForm])

  const openEdit = (prop) => {
    editorSession.current++
    setUploading(false)
    setMainImage(prop.mainImage || '')
    setEditingId(prop._id)
    loadAdminLocation(prop._id)
    setForm({ title: prop.title, listingType: prop.listingType, price: prop.price, priceLabel: prop.priceLabel || '', district: prop.district, address: prop.address, propertyType: prop.propertyType, beds: prop.beds, baths: prop.baths, sqm: prop.sqm, description: prop.description || '', agent: agentIdOf(prop.agent), agentPhone: prop.agentPhone || '', agentEmail: prop.agentEmail || '', whatsappNumber: prop.whatsappNumber || '', featured: prop.featured ?? false, status: prop.status })
    setDetails(detailsFromProperty(prop))
    setTransportTouched(false)
    setImages(prop.images || [])
    loadAgents()
    setFormOpen(true)
  }

  const handleImage = async (e) => {
  const input = e.target
  const session = editorSession.current
  const files = Array.from(e.target.files || [])

  if (!files.length) return

  setUploading(true)

  try {
    const uploadedUrls = []

    for (const file of files) {
      const fd = new FormData()
      fd.append('image', file)

      const r = await api.post('/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      if (session !== editorSession.current) return
      uploadedUrls.push(r.data.url)
      // Retain successful files even if a later file in this batch fails.
      setImages(prev => [...prev, r.data.url])
    }

    toast.success(p.filesUploaded.replace('{n}', uploadedUrls.length))
  } catch (err) {
    if (session !== editorSession.current) return
    console.error(err)
    toast.error(c.uploadFailed || 'Upload failed')
  } finally {
    if (session === editorSession.current) setUploading(false)
    input.value = ''
  }
}

  const removeImage = (index) => {
    const remaining = images.filter((_, i) => i !== index)
    if (images[index] === mainImage && !remaining.includes(mainImage)) setMainImage(remaining[0] || '')
    setImages(remaining)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (uploading || saving) return

    // A half-typed coordinate is a UI mistake, not something to hand to the
    // server and hope. The backend is still the authority; this is usability.
    if (locationDraftError) {
      toast.error(p.locationIncomplete || 'Enter both latitude and longitude, or clear the location.')
      return
    }

    setSaving(true)
    // '' means Unassigned — sent as an explicit null so an edit that clears
    // the agent actually clears it, rather than being read as "unchanged".
    // Detail fields are MERGED, not spread from form state, so that a blank
    // optional number and an unset amenity are absent from the request rather
    // than being sent as '' and false. See buildDetailsPayload.
    const payload = {
      ...form,
      ...buildDetailsPayload(details, transportTouched),
      agent: form.agent || null,
      price: Number(form.price),
      beds: Number(form.beds),
      baths: Number(form.baths),
      sqm: Number(form.sqm),
      images,
      mainImage: mainImage || images[0] || '',
    }

    /*
     * Location is attached deliberately, never spread from form state.
     *
     *   untouched            -> omit the key   (backend preserves what is stored)
     *   deliberately cleared -> location: null (the ONLY clear signal Wave 9a accepts)
     *   set to a valid pin   -> a normalised object of real Numbers
     *
     * `unknown` always omits: if we could not read the stored pin we have no
     * business rewriting it.
     */
    if (locationDirty && location.status === 'set') {
      payload.location = {
        lat: Number(location.value.lat),
        lng: Number(location.value.lng),
        isApproximate: location.value.isApproximate === true,
        approxRadiusKm: Number(location.value.approxRadiusKm),
      }
    } else if (locationDirty && location.status === 'none') {
      payload.location = null
    }
    try {
      if (editingId) {
        await api.put(`/properties/${editingId}`, payload)
        toast.success(p.propertyUpdated)
      } else {
        await api.post('/properties', payload)
        toast.success(p.propertyAdded)
      }
      setFormOpen(false)
      editorSession.current++
      locationRequest.current++
      fetchProperties()
    } catch (err) {
      toast.error(err.response?.data?.message || c.saveFailed || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(p.confirmDelete)) return
    try {
      await api.delete(`/properties/${id}`)
      toast.success(p.propertyDeleted)
      fetchProperties()
    } catch {
      toast.error(p.deleteFailed)
    }
  }

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]'
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500'
  const sectionCls = 'border-t border-slate-100 pt-5'
  const sectionTitleCls = 'mb-3 text-xs font-bold uppercase tracking-widest text-slate-400'

  // Translated display labels. Canonical English enum values double as their
  // own fallback, so a missing key degrades to the stored value rather than
  // to an empty option.
  const notSpecified = p.notSpecified || '\u2014 Not specified \u2014'
  const optionLabels = {
    floorLocation: p.floorLocationOptions || {},
    kitchenType: p.kitchenOptions || {},
    usageStatus: p.usageStatusOptions || {},
    titleDeedStatus: p.titleDeedOptions || {},
  }
  const transportLabels = p.transportOptions || {}
  const amenityLabels = p.amenityOptions || {}

  const detailLabel = (field) => p[field] || DETAIL_FALLBACK[field]
  const amenityLabel = (field) => amenityLabels[field] || AMENITY_FALLBACK[field]
  const setDetail = (field, value) => setDetails(prev => ({ ...prev, [field]: value }))

  const numberField = (field, placeholder, extra = {}) => (
    <div key={field}>
      <label htmlFor={`detail-${field}`} className={labelCls}>{detailLabel(field)}</label>
      <input
        id={`detail-${field}`}
        type="number"
        value={details[field]}
        onChange={e => setDetail(field, e.target.value)}
        className={inputCls}
        placeholder={placeholder}
        {...extra}
      />
    </div>
  )

  const selectField = (field, options) => (
    <div key={field}>
      <label htmlFor={`detail-${field}`} className={labelCls}>{detailLabel(field)}</label>
      <select
        id={`detail-${field}`}
        value={details[field]}
        onChange={e => setDetail(field, e.target.value)}
        className={inputCls}
      >
        <option value="">{notSpecified}</option>
        {options.map(option => (
          <option key={option} value={option}>{optionLabels[field]?.[option] || option}</option>
        ))}
      </select>
    </div>
  )

  /*
   * Yes / No / Not specified.
   *
   * A native select rather than a styled widget: it is keyboard operable and
   * announced correctly by screen readers for free, and "Not specified" reads
   * as a real choice instead of as an unchecked box that looks like "No".
   */
  const triStateField = (field, label) => (
    <div key={field}>
      <label htmlFor={`detail-${field}`} className={labelCls}>{label}</label>
      <select
        id={`detail-${field}`}
        value={details[field]}
        onChange={e => setDetail(field, e.target.value)}
        className={inputCls}
      >
        <option value="">{notSpecified}</option>
        <option value="true">{p.yes || 'Yes'}</option>
        <option value="false">{p.no || 'No'}</option>
      </select>
    </div>
  )

  const copyContext = {
    district: form.district,
    address: form.address,
    propertyType: form.propertyType,
    listingType: form.listingType,
    beds: form.beds,
    baths: form.baths,
    sqm: form.sqm,
    netSqm: details.netSqm,
    openAreaSqm: details.openAreaSqm,
    rooms: details.rooms,
    floor: details.floor,
    floorLocation: details.floorLocation,
    totalFloors: details.totalFloors,
    buildingAge: details.buildingAge,
    heating: details.heating,
    kitchenType: details.kitchenType,
    parking: details.parking,
    nearbyTransport: details.nearbyTransport,
    usageStatus: details.usageStatus,
    titleDeedStatus: details.titleDeedStatus,
    ...Object.fromEntries(CLASSIC_BOOLEANS.map(field => [field, details[field] === true])),
    ...Object.fromEntries(TRISTATE_BOOLEANS.flatMap(field =>
      details[field] === '' ? [] : [[field, details[field] === 'true']]
    )),
  }
  const canUseAssistant = user?.role === 'owner' || (
    user?.role === 'admin' && (hasPermission('add_listing') || hasPermission('edit_listing'))
  )

  const checkboxField = (field) => (
    <label key={field} htmlFor={`detail-${field}`} className="flex items-center gap-2 cursor-pointer">
      <input
        id={`detail-${field}`}
        type="checkbox"
        checked={details[field]}
        onChange={e => setDetail(field, e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[#4b6741]"
      />
      <span className="text-sm text-slate-700">{amenityLabel(field)}</span>
    </label>
  )

  /*
   * Wave 14C — the donor's All / For Sale / For Rent tabs.
   *
   * ONE derived list, so anything else that narrows the admin list later
   * composes with the tab instead of competing with it: add the extra
   * predicate here and both constraints apply together. `properties` itself
   * is never mutated, so switching tabs cannot lose a record.
   *
   * The counts are the donor's, and they count the WHOLE list — a tab's badge
   * has to say how many it would show, not how many are showing now.
   */
  const visibleProperties = properties.filter(prop => (
    tab === 'all' ? true : tab === 'sale' ? prop.listingType === 'Sale' : prop.listingType === 'Rent'
  ))
  const saleCount = properties.filter(prop => prop.listingType === 'Sale').length
  const rentCount = properties.filter(prop => prop.listingType === 'Rent').length

  const TABS = [
    { id: 'all', label: p.all || 'All', count: properties.length },
    { id: 'sale', label: p.forSale || 'For Sale', count: saleCount },
    { id: 'rent', label: p.forRent || 'For Rent', count: rentCount },
  ]

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">{p.title || 'Property Management'}</h1>
            <p className="mt-1 text-sm text-slate-500">{properties.length} {p.totalListings || 'total listings'}</p>
          </div>
          {hasPermission('add_listing') && (
            <button onClick={openAdd} className="rounded-full bg-[#202a36] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4b6741] transition cursor-pointer">{p.addProperty || '+ Add Property'}</button>
          )}
        </div>

        {/* Real tabs: a tablist of buttons, so arrow-free keyboard use and
            screen readers both get the selected state without extra script. */}
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={p.title || 'Property Management'}>
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`relative rounded-full px-5 py-2 text-sm font-semibold transition cursor-pointer ${tab === item.id ? 'bg-[#202a36] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
            >
              {item.label} <span className={`ms-1 text-xs ${tab === item.id ? 'text-white/70' : 'text-slate-400'}`}>{item.count}</span>
            </button>
          ))}
        </div>

        {formOpen && (
          /*
            A fixed overlay, so opening the editor leaves the listing grid
            exactly where it was instead of pushing the cards down the page.
            The cards stay visible behind the scrim, which is what makes this
            read as "editing that listing" rather than "the page changed".

            Scroll safety, because this is a very long form: the OVERLAY
            scrolls (overflow-y-auto) and aligns to the top (items-start), so
            the panel is never taller than a scrollable area and Save is always
            reachable. That is the opposite of the trap the Showroom editor had,
            where an items-center overlay with no overflow pushed the panel off
            both edges with no way to scroll it back.

            No backdrop click-to-close: this form holds a lot of unsaved typing
            and there is no unsaved-changes guard, so a stray click must not
            discard it. The X, Cancel and Escape are the deliberate ways out.
          */
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto vk-scroll-gold bg-black/50 backdrop-blur-sm p-4 py-10">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36]">{editingId ? (p.editProperty || 'Edit Property') : (p.addPropertyTitle || 'Add Property')}</h2>
              <button type="button" onClick={closeForm} disabled={saving} aria-label={c.close || 'Close'} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              {canUseAssistant && (
                <AdminPropertyAssistant
                  form={form}
                  copyContext={copyContext}
                  onApplyParsedFields={applyParsedFields}
                  onApplyCopy={applySuggestedCopy}
                />
              )}
              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.titleLabel || 'Title'}</label>
                  <input value={form.title} onChange={e => setForm(prev => ({...prev, title: e.target.value}))} className={inputCls} placeholder="e.g. Levent Sky Residences" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.listingType || 'Listing Type'}</label>
                  <select value={form.listingType} onChange={e => setForm(prev => ({...prev, listingType: e.target.value}))} className={inputCls}>
                    <option value="Sale">{p.sale || 'Sale'}</option>
                    <option value="Rent">{p.rent || 'Rent'}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.price || 'Price (number)'}</label>
                  <input type="number" value={form.price} onChange={e => setForm(prev => ({...prev, price: e.target.value}))} className={inputCls} placeholder="1850000" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.priceLabel || 'Price Label (display)'}</label>
                  <input value={form.priceLabel} onChange={e => setForm(prev => ({...prev, priceLabel: e.target.value}))} className={inputCls} placeholder="$1,850,000" />

                  {/*
                    Stacked under Price Label, not given its own grid column.
                    Two reasons: it keeps the basic rows paired exactly as the
                    reference design pairs them (Price Label | District), and
                    this select exists only to drive the price label above it,
                    so separating them would hide the cause from the effect.
                  */}
                  <div className="mt-3">
                  <label htmlFor="detail-currency" className={labelCls}>{detailLabel('currency')}</label>
                  <select
                    id="detail-currency"
                    value={details.currency}
                    onChange={e => handleCurrencyChange(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">{notSpecified}</option>
                    {CURRENCIES.map(code => (
                      <option key={code} value={code}>{`${code} (${CURRENCY_TO_SYMBOL[code]})`}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11px] text-slate-400">{p.currencyHint || 'Sets the price label symbol. A custom label you have written is left as it is.'}</p>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.district || 'Istanbul District'}</label>
                  <input value={form.district} onChange={e => setForm(prev => ({...prev, district: e.target.value}))} className={inputCls} placeholder="e.g. Levent" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.address || 'Full Address'}</label>
                  <input value={form.address} onChange={e => setForm(prev => ({...prev, address: e.target.value}))} className={inputCls} placeholder="Street / Building" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.propertyType || 'Property Type'}</label>
                  <select value={form.propertyType} onChange={e => setForm(prev => ({...prev, propertyType: e.target.value}))} className={inputCls}>
                    {PROPERTY_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.beds || 'Bedrooms'}</label>
                  <input type="number" value={form.beds} onChange={e => setForm(prev => ({...prev, beds: e.target.value}))} className={inputCls} placeholder="3" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.baths || 'Bathrooms'}</label>
                  <input type="number" value={form.baths} onChange={e => setForm(prev => ({...prev, baths: e.target.value}))} className={inputCls} placeholder="2" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.area || 'Area (m²)'}</label>
                  <input type="number" value={form.sqm} onChange={e => setForm(prev => ({...prev, sqm: e.target.value}))} className={inputCls} placeholder="150" required min="0" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.status || 'Status'}</label>
                  <select value={form.status} onChange={e => setForm(prev => ({...prev, status: e.target.value}))} className={inputCls}>
                    <option value="Available">{p.available || 'Available'}</option>
                    <option value="Sold">{p.sold || 'Sold'}</option>
                    <option value="Rented">{p.rented || 'Rented'}</option>
                    <option value="Pending">{p.pending || 'Pending'}</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.description || 'Description'}</label>
                  <textarea value={form.description} onChange={e => setForm(prev => ({...prev, description: e.target.value}))} rows={4} className={inputCls} placeholder="Property description..." />
                </div>
                {/*
                  Row formation follows the reference (agent identity | phone,
                  then email | whatsapp), but the first cell stays the Assigned
                  Agent dropdown rather than the reference's free-text agent
                  name: the listing points at a real User account, and the name
                  and email are derived from it server-side.
                */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.assignedAgent || 'Assigned Agent'}</label>
                  <select value={form.agent} onChange={e => handleAgentChange(e.target.value)} className={inputCls}>
                    <option value="">{p.unassigned || 'Unassigned'}</option>
                    {agents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
                    {/*
                      Keeps a previously-assigned agent visible if they have
                      since been deactivated or demoted, instead of the form
                      quietly resetting to Unassigned and wiping the link on
                      the next save. Saving it unchanged is rejected by the
                      server, which is the honest outcome.
                    */}
                    {form.agent && !agents.some(a => a._id === form.agent) && (
                      <option value={form.agent}>
                        {agentsStatus === 'ready' ? 'Currently assigned — no longer an active agent' : 'Currently assigned agent'}
                      </option>
                    )}
                  </select>
                  {agentsStatus === 'loading' ? (
                    <p className="mt-1.5 text-[11px] text-slate-400">Loading agents…</p>
                  ) : agentsStatus === 'error' ? (
                    <p className="mt-1.5 text-[11px] text-red-600">
                      Could not load agents. Close and reopen the form to try again.
                    </p>
                  ) : form.agent && !agents.some(a => a._id === form.agent) ? (
                    <p className="mt-1.5 text-[11px] text-amber-600">
                      The assigned account is no longer an active agent. Pick another agent or set Unassigned before saving.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      The listing&apos;s agent name and email come from this account. Phone and WhatsApp are entered below.
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.agentPhone || 'Agent Phone'}</label>
                  <input value={form.agentPhone} onChange={e => setForm(prev => ({...prev, agentPhone: e.target.value}))} className={inputCls} placeholder="+90 530 123 4567" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.agentEmail || 'Agent Email'}</label>
                  {/*
                    Read-only: when an agent is assigned this mirrors their
                    account email, and the server derives it again on save
                    regardless of what is sent. Legacy listings with no
                    assigned agent keep whatever address they already had.
                  */}
                  <input
                    value={form.agentEmail}
                    readOnly
                    className={`${inputCls} cursor-not-allowed text-slate-500`}
                    placeholder={form.agent ? '' : 'Assign an agent to fill this'}
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {form.agent
                      ? 'Automatically taken from the assigned Agent account.'
                      : 'Assign an agent to set this automatically.'}
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.whatsapp || 'WhatsApp Number'}</label>
                  <input value={form.whatsappNumber} onChange={e => setForm(prev => ({...prev, whatsappNumber: e.target.value}))} className={inputCls} placeholder="+905301234567" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="featured" checked={form.featured} onChange={e => setForm(prev => ({...prev, featured: e.target.checked}))} className="h-4 w-4 accent-[#4b6741]" />
                  <label htmlFor="featured" className="text-sm font-medium text-slate-700 cursor-pointer">{p.featured || 'Mark as Featured'}</label>
                </div>
              </div>


              {editingId && (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500">
                  {p.blankPreservesHint || 'Leaving an optional field blank keeps whatever is already stored — it does not erase it.'}
                </p>
              )}

              <div className={sectionCls}>
                <p className={sectionTitleCls}>{p.sectionSizeLayout || 'Size & Layout'}</p>
                <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
                  {numberField('netSqm', 'e.g. 130', { min: '0', step: '0.01' })}
                  {numberField('openAreaSqm', 'e.g. 20', { min: '0', step: '0.01' })}
                  {selectField('rooms', ROOM_OPTIONS)}
                  {numberField('floor', 'e.g. 4', { step: '1' })}
                  {selectField('floorLocation', FLOOR_LOCATIONS)}
                  {numberField('totalFloors', 'e.g. 12', { min: '0', step: '1' })}
                </div>
              </div>

              <div className={sectionCls}>
                <p className={sectionTitleCls}>{p.sectionBuilding || 'Building Details'}</p>
                <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
                  {selectField('buildingAge', BUILDING_AGE_OPTIONS)}
                  {selectField('heating', HEATING_OPTIONS)}
                  {selectField('parking', PARKING_OPTIONS)}
                  {selectField('kitchenType', KITCHEN_TYPES)}
                  {numberField('coefficient', 'e.g. 8', { step: '0.01' })}
                </div>
              </div>

              <fieldset className={sectionCls}>
                <legend className={sectionTitleCls}>{p.sectionAmenities || 'Amenities'}</legend>

                {/*
                  Two groups, shown as two groups on purpose.

                  The checkboxes below carry a schema default of false, so every
                  stored property already has a real answer for them and an
                  unchecked box genuinely means "no".

                  The selects underneath do not. Rendering them as checkboxes
                  would show every never-recorded amenity as unchecked, and the
                  next save would turn that guess into a stored false.
                */}
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
                  {CLASSIC_BOOLEANS.map(field => checkboxField(field))}
                </div>

                <p className="mt-5 mb-2 text-[11px] text-slate-400">
                  {p.tristateHint || 'Leave as “Not specified” for anything that has never been recorded — saving will not turn it into a “No”.'}
                </p>
                <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-4">
                  {TRISTATE_BOOLEANS.map(field => triStateField(field, amenityLabel(field)))}
                </div>
              </fieldset>

              <div className={sectionCls}>
                <p className={sectionTitleCls}>{p.sectionLegalUsage || 'Legal & Usage'}</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  {selectField('usageStatus', USAGE_STATUSES)}
                  {selectField('titleDeedStatus', TITLE_DEED_STATUSES)}
                </div>
              </div>

              <fieldset className={sectionCls}>
                <legend className={sectionTitleCls}>{p.sectionTransport || 'Nearby Transport'}</legend>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
                  {TRANSPORT_OPTIONS.map(option => (
                    <label key={option} htmlFor={`transport-${option}`} className="flex items-center gap-2 cursor-pointer">
                      <input
                        id={`transport-${option}`}
                        type="checkbox"
                        checked={details.nearbyTransport.includes(option)}
                        onChange={() => toggleTransport(option)}
                        className="h-4 w-4 shrink-0 accent-[#4b6741]"
                      />
                      <span className="text-sm text-slate-700">{transportLabels[option] || option}</span>
                    </label>
                  ))}
                </div>
                {editingId && !transportTouched && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    {p.transportUntouchedHint || 'Untouched, this list is left exactly as stored.'}
                  </p>
                )}
              </fieldset>

              <div className={sectionCls}>
                <p className={sectionTitleCls}>{p.sectionVirtualTour || 'Virtual Tour'}</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  {triStateField('hasVirtualTour', detailLabel('hasVirtualTour'))}
                  <div>
                    <label htmlFor="detail-virtualTourUrl" className={labelCls}>{detailLabel('virtualTourUrl')}</label>
                    {/*
                      Shown unconditionally. Hiding it behind the toggle would
                      put a stored URL out of sight of the admin deciding
                      whether to keep it, which is how a value gets lost by
                      accident rather than on purpose.
                    */}
                    <input
                      id="detail-virtualTourUrl"
                      type="url"
                      value={details.virtualTourUrl}
                      onChange={e => setDetail('virtualTourUrl', e.target.value)}
                      className={inputCls}
                      placeholder="https://my.matterport.com/show/?m=..."
                    />
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {p.virtualTourHint || 'HTTPS links from Matterport, Kuula, YouTube or Vimeo only.'}
                    </p>
                  </div>
                </div>
              </div>

              {/*
                Location was previously a md:col-span-2 cell wedged between the
                agent fields and the Featured checkbox, splitting the basic block
                in half around a map picker. It is a section in its own right, so
                it now sits with the other sections.

                Moved verbatim: every status branch travels together. Only the
                picker would have been the tempting thing to move, but the
                'loading' branch, the 'unknown' branch (with its hint and
                permission-gated retry) and the none/set branch are one state
                machine — locationDirty and LOCATION_NONE are what tell
                handleSubmit whether to omit the key, send null, or send
                coordinates. Dropping any branch would silently overwrite a
                stored pin.
              */}
              <div className={sectionCls}>
                <p className={sectionTitleCls}>{p.propertyLocation || 'Property Location'}</p>

                {location.status === 'loading' && (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    {p.locationLoading || 'Loading saved location…'}
                  </p>
                )}

                {location.status === 'unknown' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-medium text-amber-800">
                      {p.locationUnavailable || 'The saved location could not be loaded.'}
                    </p>
                    <p className="mt-1 text-xs text-amber-700">
                      {p.locationUnavailableHint || 'Location editing is disabled so the stored location is not overwritten. Saving now leaves it unchanged.'}
                    </p>
                    {editingId && hasPermission('edit_listing') && (
                      <button
                        type="button"
                        onClick={() => loadAdminLocation(editingId)}
                        className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        {p.locationRetry || 'Retry'}
                      </button>
                    )}
                  </div>
                )}

                {(location.status === 'none' || location.status === 'set') && (
                  <PropertyLocationPicker
                    value={location.status === 'set' ? location.value : null}
                    onChange={(next) => {
                      setLocationDirty(true)
                      setLocation(next ? { status: 'set', value: next } : LOCATION_NONE)
                    }}
                    onDraftErrorChange={setLocationDraftError}
                    labels={p}
                  />
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{p.images || 'Property Images'}</label>
                  <span className="text-[10px] text-slate-400">JPG, PNG, WEBP, GIF — max 10 MB · MP4, MOV, WEBM — max 100 MB</span>
                </div>
                <div className="flex flex-wrap gap-3 mb-3">
                  {images.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img} alt="" className="h-20 w-28 rounded-xl object-cover border border-slate-200" />
                      <button type="button" onClick={() => removeImage(i)} disabled={saving}
                        className="absolute -top-2 -right-2 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white cursor-pointer">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  <label className="flex h-20 w-28 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:border-[#4b6741] hover:text-[#4b6741] transition">
                    {uploading ? <span className="text-xs">{c.uploading || 'Uploading...'}</span> : <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>}
                    <input
  type="file"
  accept="image/*,video/*"
  multiple
  onChange={handleImage}
  className="hidden"
  disabled={uploading || saving}
/>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving || uploading} className="rounded-full bg-[#202a36] px-8 py-3 text-sm font-semibold text-white hover:bg-[#4b6741] transition disabled:opacity-60 cursor-pointer">
                  {saving ? (c.saving || 'Saving...') : editingId ? (p.updateProperty || 'Update Property') : (p.saveProperty || 'Save Property')}
                </button>
                <button type="button" onClick={closeForm} disabled={saving} className="rounded-full border border-slate-200 px-8 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">{c.cancel || 'Cancel'}</button>
              </div>
            </form>
          </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border p-6 text-center" style={{ borderColor: 'var(--vk-border)', color: 'var(--vk-text)' }}>
            <p>{p.loadError}</p>
            <button type="button" onClick={fetchProperties} className="mt-3 underline cursor-pointer">{p.locationRetry}</button>
          </div>
        ) : visibleProperties.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-400">{p.noListings}</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visibleProperties.map(prop => (
              <div key={prop._id} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex gap-4">
                {/*
                  Reads the stored boolean directly — the same field the public
                  Home carousel queries via GET /properties?featured=true. There
                  is no separate admin-side featured list to keep in sync, so a
                  card showing this badge is a listing Home is actually serving.

                  The checkbox in the editor below has always written this field;
                  what was missing was any way to see the result without opening
                  each listing one at a time.
                */}
                {prop.featured && (
                  <span className="absolute -top-2.5 left-4 flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L10 15l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z" /></svg>
                    {p.featuredBadge || 'Featured on Homepage'}
                  </span>
                )}
                <img src={prop.mainImage || prop.images?.[0] || 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=200&q=60'} alt={prop.title} className="h-28 w-40 shrink-0 rounded-xl object-cover" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold text-[#202a36] truncate">{prop.title}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${prop.listingType === 'Rent' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{prop.listingType}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{prop.district} · {prop.propertyType}</p>
                  <p className="text-sm font-semibold text-[#d97706] mt-1">
  {formatPrice(prop.price, prop.listingType, prop.priceLabel)}
</p>
                  <p className="text-xs text-slate-400 mt-0.5">{prop.beds}bd · {prop.baths}ba · {prop.sqm}m²</p>
                  <div className="mt-3 flex gap-2">
                    {hasPermission('edit_listing') && (
                      <button onClick={() => openEdit(prop)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer">{c.edit || 'Edit'}</button>
                    )}
                    {hasPermission('delete_listing') && (
                      <button onClick={() => handleDelete(prop._id)} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 cursor-pointer">{c.delete || 'Delete'}</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminProperties
