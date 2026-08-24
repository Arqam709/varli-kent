import { useState } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'

const PARSED_FIELD_ORDER = [
  'title', 'description', 'price', 'currency', 'listingType', 'propertyType',
  'district', 'address', 'beds', 'baths', 'sqm', 'netSqm', 'openAreaSqm',
  'rooms', 'floor', 'floorLocation', 'totalFloors', 'buildingAge', 'heating',
  'kitchenType', 'parking', 'furnished', 'balcony', 'elevator', 'pool',
  'garden', 'sauna', 'jacuzzi', 'steamRoom', 'turkishBath', 'basement',
  'nearbyTransport', 'usageStatus', 'withinSite', 'eligibleForCredit',
  'titleDeedStatus', 'exchange',
]

const LANGUAGE_CODES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const AMENITY_FIELDS = new Set([
  'furnished', 'balcony', 'elevator', 'pool', 'garden', 'sauna', 'jacuzzi',
  'steamRoom', 'turkishBath', 'basement', 'withinSite', 'eligibleForCredit', 'exchange',
])
const FIELD_FALLBACKS = {
  title: 'Title', description: 'Description', price: 'Price', currency: 'Currency',
  listingType: 'Listing Type', propertyType: 'Property Type', district: 'District',
  address: 'Address', beds: 'Bedrooms', baths: 'Bathrooms', sqm: 'Gross Area (m²)',
  netSqm: 'Net Area (m²)', openAreaSqm: 'Open Area (m²)', rooms: 'Room Layout',
  floor: 'Floor', floorLocation: 'Floor Location', totalFloors: 'Total Floors',
  buildingAge: 'Building Age', heating: 'Heating', kitchenType: 'Kitchen Type',
  parking: 'Parking', nearbyTransport: 'Nearby Transport', usageStatus: 'Usage Status',
  titleDeedStatus: 'Title Deed Status',
}

const AdminPropertyAssistant = ({
  form,
  copyContext,
  onApplyParsedFields,
  onApplyCopy,
}) => {
  const { t } = useLanguage()
  const pa = t.adminPages?.propertyAssistant || {}
  const propertyLabels = t.adminPages?.properties || {}
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('parse')
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [selectedFields, setSelectedFields] = useState(new Set())
  const [facts, setFacts] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [previewLanguage, setPreviewLanguage] = useState('en')

  const inputCls = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]'

  const errorMessage = (error, fallback) => {
    const status = error.response?.status
    if (status === 400) return pa.invalidInput || 'Please check the information and try again.'
    if (status === 401 || status === 403) return pa.permissionDenied || 'You do not have permission to use this assistant.'
    if (status === 502 || status === 503) return pa.unavailable || 'The assistant is temporarily unavailable.'
    return error.response?.data?.message || fallback
  }

  const fieldLabel = (field) => {
    if (AMENITY_FIELDS.has(field)) return propertyLabels.amenityOptions?.[field] || field
    const aliases = { title: 'titleLabel', propertyType: 'propertyType', beds: 'beds', baths: 'baths', sqm: 'area' }
    return propertyLabels[aliases[field] || field] || FIELD_FALLBACKS[field] || field
  }

  const formatValue = (value) => {
    if (value === true) return propertyLabels.yes || pa.yes || 'Yes'
    if (value === false) return propertyLabels.no || pa.no || 'No'
    if (Array.isArray(value)) return value.join(', ')
    return String(value)
  }

  const parseListing = async () => {
    if (parsing) return
    if (!pasteText.trim()) {
      toast.error(pa.pasteRequired || 'Paste listing text first.')
      return
    }
    setParsing(true)
    try {
      const response = await api.post('/admin/property-assistant/parse-listing-text', { text: pasteText })
      const fields = response.data?.fields && typeof response.data.fields === 'object'
        ? Object.fromEntries(PARSED_FIELD_ORDER.filter((field) =>
            Object.prototype.hasOwnProperty.call(response.data.fields, field)
          ).map((field) => [field, response.data.fields[field]]))
        : {}
      setPreview(fields)
      setSelectedFields(new Set(Object.keys(fields)))
      if (!Object.keys(fields).length) toast.info(pa.noParsedFields || 'No supported facts were found.')
    } catch (error) {
      toast.error(errorMessage(error, pa.parseFailed || 'The listing could not be analyzed.'))
    } finally {
      setParsing(false)
    }
  }

  const toggleSelected = (field) => {
    setSelectedFields((current) => {
      const next = new Set(current)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const applySelected = () => {
    if (!preview) return
    const selected = Object.fromEntries(
      Object.entries(preview).filter(([field]) => selectedFields.has(field))
    )
    if (!Object.keys(selected).length) {
      toast.info(pa.selectAtLeastOne || 'Select at least one field.')
      return
    }
    onApplyParsedFields(selected)
    toast.success(pa.fieldsApplied || 'Selected fields applied to the form.')
  }

  const suggestCopy = async () => {
    if (suggesting) return
    setSuggesting(true)
    setSuggestion(null)
    try {
      const response = await api.post('/admin/property-assistant/suggest-copy', {
        facts,
        existingTitle: form.title,
        existingDescription: form.description,
        context: copyContext,
      })
      setSuggestion({ title: response.data.title, description: response.data.description })
      setPreviewLanguage('en')
    } catch (error) {
      toast.error(errorMessage(error, pa.suggestFailed || 'Copy could not be generated.'))
    } finally {
      setSuggesting(false)
    }
  }

  const applyCopy = (mode) => {
    if (!suggestion) return
    const title = suggestion.title?.[previewLanguage]
    const description = suggestion.description?.[previewLanguage]
    onApplyCopy({
      ...(mode !== 'description' ? { title } : {}),
      ...(mode !== 'title' ? { description } : {}),
    })
    toast.success(pa.copyApplied || 'Suggested copy applied to the form.')
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-[#202a36]">{pa.title || 'AI Listing Assistant'}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-emerald-100 p-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={pa.title || 'AI Listing Assistant'}>
            {[
              ['parse', pa.parseTab || 'Parse Listing'],
              ['copy', pa.copyTab || 'Suggest Copy'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${tab === key ? 'bg-[#202a36] text-white' : 'bg-white text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'parse' && (
            <div className="space-y-3" role="tabpanel">
              <div>
                <label htmlFor="assistant-listing-text" className="mb-1 block text-xs font-semibold text-slate-600">
                  {pa.pasteLabel || 'Pasted listing text'}
                </label>
                <textarea
                  id="assistant-listing-text"
                  rows={6}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  className={inputCls}
                  placeholder={pa.pastePlaceholder || 'Paste listing title, description, price and specifications…'}
                />
              </div>
              <button
                type="button"
                onClick={parseListing}
                disabled={parsing}
                aria-busy={parsing}
                className="rounded-full bg-[#202a36] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {parsing ? (pa.parsing || 'Analyzing…') : (pa.parseButton || 'Analyze Listing')}
              </button>

              {preview && Object.keys(preview).length > 0 && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[#202a36]">{pa.previewTitle || 'Parsed field preview'}</h3>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedFields(new Set(Object.keys(preview)))} className="text-xs font-semibold text-[#4b6741]">
                        {pa.selectAll || 'Select all'}
                      </button>
                      <button type="button" onClick={() => setSelectedFields(new Set())} className="text-xs font-semibold text-slate-500">
                        {pa.selectNone || 'Select none'}
                      </button>
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    {Object.entries(preview).map(([field, value]) => (
                      <label key={field} className="flex min-w-0 items-start gap-2 rounded-lg bg-slate-50 p-3">
                        <input
                          type="checkbox"
                          checked={selectedFields.has(field)}
                          onChange={() => toggleSelected(field)}
                          aria-label={`${pa.selectField || 'Select'} ${fieldLabel(field)}`}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#4b6741]"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-500">{fieldLabel(field)}</span>
                          <span className="block break-words text-sm text-slate-800">{formatValue(value)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button type="button" onClick={applySelected} className="rounded-full bg-[#4b6741] px-5 py-2 text-sm font-semibold text-white">
                    {pa.applySelected || 'Apply Selected Fields'}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'copy' && (
            <div className="space-y-3" role="tabpanel">
              <div>
                <label htmlFor="assistant-copy-facts" className="mb-1 block text-xs font-semibold text-slate-600">
                  {pa.factsLabel || 'Additional property facts (optional)'}
                </label>
                <textarea
                  id="assistant-copy-facts"
                  rows={3}
                  value={facts}
                  onChange={(event) => setFacts(event.target.value)}
                  className={inputCls}
                  placeholder={pa.factsPlaceholder || 'Only add facts you know are accurate…'}
                />
              </div>
              <button
                type="button"
                onClick={suggestCopy}
                disabled={suggesting}
                aria-busy={suggesting}
                className="rounded-full bg-[#202a36] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {suggesting ? (pa.suggesting || 'Writing…') : (pa.suggestButton || 'Suggest Title & Description')}
              </button>

              {suggestion && (
                <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label={pa.copyLanguages || 'Suggestion languages'}>
                    {LANGUAGE_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="tab"
                        aria-selected={previewLanguage === code}
                        onClick={() => setPreviewLanguage(code)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${previewLanguage === code ? 'bg-[#202a36] text-white' : 'bg-slate-100 text-slate-600'}`}
                      >
                        {pa.languages?.[code] || code.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div dir={['ar', 'ur'].includes(previewLanguage) ? 'rtl' : 'auto'} className="min-w-0 space-y-2">
                    <p className="break-words text-sm font-semibold text-[#202a36]">{suggestion.title[previewLanguage]}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{suggestion.description[previewLanguage]}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => applyCopy('title')} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold">{pa.applyTitle || 'Apply Title'}</button>
                    <button type="button" onClick={() => applyCopy('description')} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold">{pa.applyDescription || 'Apply Description'}</button>
                    <button type="button" onClick={() => applyCopy('both')} className="rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white">{pa.applyBoth || 'Apply Both'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default AdminPropertyAssistant
