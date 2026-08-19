import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../components/AdminLayout'
import ColorSwatchButton from '../components/ColorSwatchButton'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import api from '../lib/api'

const DEFAULT_MATERIALS = [
  { name: 'Calacatta Marble', color: '#f2ede8', image: '' },
  { name: 'Raw Concrete', color: '#8a8a8a', image: '' },
  { name: 'Dark Walnut', color: '#3d2b1f', image: '' },
  { name: 'Aged Brass', color: '#C9A35A', image: '' },
  { name: 'Nero Stone', color: '#1a1a1a', image: '' },
  { name: 'Linen White', color: '#f8f5f0', image: '' },
  { name: 'Forest Green', color: '#5E7F52', image: '' },
  { name: 'Midnight Navy', color: '#202a36', image: '' },
]
const DEFAULT_WALL_FINISHES = [
  { label: 'Ivory', color: '#f5f0e8' },
  { label: 'Warm Sand', color: '#e8ddd0' },
  { label: 'Slate Blue', color: '#8fa3b1' },
  { label: 'Sage', color: '#8fa88a' },
  { label: 'Charcoal', color: '#3d4655' },
  { label: 'Navy', color: '#202a36' },
]
const DEFAULT_FLOOR_FINISHES = [
  { label: 'Dark Oak', color: '#4a3728' },
  { label: 'Light Ash', color: '#c4a882' },
  { label: 'Concrete', color: '#8a8a8a' },
  { label: 'Marble', color: '#efe9e1' },
]

const LIMITS = { materials: 24, wallFinishes: 16, floorFinishes: 16 }
const HEX = /^#[0-9a-fA-F]{6}$/
const cloneDefaults = () => ({
  materials: DEFAULT_MATERIALS.map(item => ({ ...item })),
  wallFinishes: DEFAULT_WALL_FINISHES.map(item => ({ ...item })),
  floorFinishes: DEFAULT_FLOOR_FINISHES.map(item => ({ ...item })),
})
const snapshot = value => JSON.stringify(value)

const normalizeMaterials = value => Array.isArray(value) && value.length
  ? value.map(item => ({ name: typeof item?.name === 'string' ? item.name : '', color: typeof item?.color === 'string' ? item.color : '#cccccc', image: typeof item?.image === 'string' ? item.image : '' }))
  : cloneDefaults().materials
const normalizeFinishes = (value, defaults) => Array.isArray(value) && value.length
  ? value.map(item => ({ label: typeof item?.label === 'string' ? item.label : '', color: typeof item?.color === 'string' ? item.color : '#cccccc' }))
  : defaults.map(item => ({ ...item }))

const validatePalette = ({ materials, wallFinishes, floorFinishes }) => {
  const groups = [
    ['materials', materials, LIMITS.materials],
    ['wallFinishes', wallFinishes, LIMITS.wallFinishes],
    ['floorFinishes', floorFinishes, LIMITS.floorFinishes],
  ]
  for (const [name, entries, maximum] of groups) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > maximum) return `${name}: 1–${maximum}`
  }
  for (const item of materials) {
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 80) return 'material name'
    if (!HEX.test(item.color)) return 'material color'
    if (item.image) {
      try {
        const url = new URL(item.image.trim())
        if (!['http:', 'https:'].includes(url.protocol)) return 'material image URL'
      } catch { return 'material image URL' }
    }
  }
  for (const item of [...wallFinishes, ...floorFinishes]) {
    if (typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > 80) return 'finish label'
    if (!HEX.test(item.color)) return 'finish color'
  }
  return null
}

export default function AdminStudioPalette() {
  const { isOwner, hasPermission } = useAuth()
  const { t } = useLanguage()
  const sp = t.adminPages?.studioPalette || {}
  const canAccess = isOwner || hasPermission('manage_studio_colors')
  const initial = useMemo(cloneDefaults, [])
  const [activePage, setActivePage] = useState('renovation')
  const [materials, setMaterials] = useState(initial.materials)
  const [wallFinishes, setWallFinishes] = useState(initial.wallFinishes)
  const [floorFinishes, setFloorFinishes] = useState(initial.floorFinishes)
  const [loadedSnapshot, setLoadedSnapshot] = useState(snapshot(initial))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState(null)

  const palette = useMemo(() => ({ materials, wallFinishes, floorFinishes }), [floorFinishes, materials, wallFinishes])
  const dirty = snapshot(palette) !== loadedSnapshot
  const pages = [
    { key: 'renovation', label: sp.renovationStudio || 'Renovation Studio' },
    { key: 'interior-design', label: sp.interiorDesign || 'Interior Design' },
  ]

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      return undefined
    }
    let active = true
    setLoading(true)
    api.get(`/studio-palette/${activePage}`)
      .then(response => {
        if (!active) return
        const defaults = cloneDefaults()
        const stored = response.data?.palette
        const next = stored ? {
          materials: normalizeMaterials(stored.materials),
          wallFinishes: normalizeFinishes(stored.wallFinishes, defaults.wallFinishes),
          floorFinishes: normalizeFinishes(stored.floorFinishes, defaults.floorFinishes),
        } : defaults
        setMaterials(next.materials)
        setWallFinishes(next.wallFinishes)
        setFloorFinishes(next.floorFinishes)
        setLoadedSnapshot(snapshot(next))
      })
      .catch(() => {
        if (!active) return
        const defaults = cloneDefaults()
        setMaterials(defaults.materials)
        setWallFinishes(defaults.wallFinishes)
        setFloorFinishes(defaults.floorFinishes)
        setLoadedSnapshot(snapshot(defaults))
        toast.error(sp.loadFailed || 'Could not load the saved palette. Local defaults are shown.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activePage, canAccess, sp.loadFailed])

  const updateMaterial = (index, change) => setMaterials(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item))
  const updateFinish = (setter, index, change) => setter(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item))

  const selectPage = pageKey => {
    if (pageKey === activePage) return
    if (dirty && !window.confirm(sp.discardConfirm || 'Discard unsaved changes and switch palettes?')) return
    setActivePage(pageKey)
  }

  const handleSave = async () => {
    if (saving || resetting) return
    const validationError = validatePalette(palette)
    if (validationError) {
      toast.error(sp.invalidPalette || 'Please correct the palette data before saving.')
      return
    }
    const payload = {
      materials: materials.map(item => ({ name: item.name.trim(), color: item.color, image: item.image.trim() })),
      wallFinishes: wallFinishes.map(item => ({ label: item.label.trim(), color: item.color })),
      floorFinishes: floorFinishes.map(item => ({ label: item.label.trim(), color: item.color })),
    }
    setSaving(true)
    try {
      const response = await api.put(`/studio-palette/${activePage}`, payload)
      const saved = response.data?.palette || payload
      const next = {
        materials: normalizeMaterials(saved.materials),
        wallFinishes: normalizeFinishes(saved.wallFinishes, payload.wallFinishes),
        floorFinishes: normalizeFinishes(saved.floorFinishes, payload.floorFinishes),
      }
      setMaterials(next.materials)
      setWallFinishes(next.wallFinishes)
      setFloorFinishes(next.floorFinishes)
      setLoadedSnapshot(snapshot(next))
      toast.success(sp.paletteSaved || 'Palette saved')
    } catch (error) {
      toast.error(error.response?.data?.message || sp.saveFailed || 'Failed to save')
    } finally { setSaving(false) }
  }

  const handleReset = async () => {
    if (saving || resetting || !window.confirm(sp.resetConfirm || 'Reset this palette to its original defaults?')) return
    setResetting(true)
    try {
      await api.delete(`/studio-palette/${activePage}`)
      const defaults = cloneDefaults()
      setMaterials(defaults.materials)
      setWallFinishes(defaults.wallFinishes)
      setFloorFinishes(defaults.floorFinishes)
      setLoadedSnapshot(snapshot(defaults))
      toast.success(sp.resetDone || 'Reset to defaults')
    } catch (error) {
      toast.error(error.response?.data?.message || sp.resetFailed || 'Failed to reset')
    } finally { setResetting(false) }
  }

  const uploadImage = async (file, index) => {
    if (!file?.type?.startsWith('image/')) {
      toast.error(sp.imageOnly || 'Please select an image file.')
      return
    }
    setUploadingIndex(index)
    try {
      const form = new FormData()
      form.append('image', file)
      const response = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      updateMaterial(index, { image: response.data.url })
      toast.success(sp.imageUploaded || 'Image uploaded')
    } catch (error) {
      toast.error(error.response?.data?.message || sp.uploadFailed || 'Upload failed')
    } finally { setUploadingIndex(null) }
  }

  const inputClass = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]'
  const removeLabel = sp.remove || 'Remove'

  if (!canAccess) return (
    <AdminLayout><div className="flex flex-col items-center justify-center py-20 text-center"><p className="text-lg font-semibold text-slate-700">{sp.ownerOnly || 'Owner access or the Studio Color Palettes permission is required.'}</p></div></AdminLayout>
  )

  const renderFinishGroup = (title, items, setter, group) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#202a36]" style={{ fontFamily: 'Cinzel, serif' }}>{title}</h2>
        <button type="button" disabled={items.length >= LIMITS[group]} onClick={() => setter(current => [...current, { label: sp.newFinish || 'New Finish', color: '#cccccc' }])} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{sp.addFinish || '+ Add Finish'}</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <ColorSwatchButton color={item.color} onChange={color => updateFinish(setter, index, { color })} label={`${title}: ${item.label || index + 1}`} basicColorsLabel={sp.basicColors || 'Basic Colors'} />
            <input aria-label={sp.finishNamePlaceholder || 'Finish name'} maxLength={80} value={item.label} onChange={event => updateFinish(setter, index, { label: event.target.value })} className={inputClass} placeholder={sp.finishNamePlaceholder || 'Finish name'} />
            <button type="button" aria-label={`${removeLabel} ${item.label || index + 1}`} disabled={items.length <= 1} onClick={() => setter(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30">✕</button>
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <AdminLayout>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold text-[#202a36]" style={{ fontFamily: 'Cinzel, serif' }}>{sp.title || 'Studio Color Palettes'}</h1><p className="mt-1 text-sm text-slate-500">{sp.subtitle || 'Edit Renovation and Interior Design studio colors.'}</p></div>
          <div className="flex gap-3">
            <button type="button" disabled={saving || resetting || loading} onClick={handleReset} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">{resetting ? (sp.resetting || 'Resetting…') : (sp.resetDefaults || 'Reset to Defaults')}</button>
            <button type="button" disabled={saving || resetting || loading || !dirty} onClick={handleSave} className="rounded-xl bg-[#4b6741] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d5535] disabled:opacity-50">{saving ? (sp.saving || 'Saving…') : (sp.saveChanges || 'Save Changes')}</button>
          </div>
        </header>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label={sp.title || 'Studio palettes'}>
          {pages.map(page => <button key={page.key} type="button" role="tab" aria-selected={activePage === page.key} onClick={() => selectPage(page.key)} className={`rounded-full px-5 py-2 text-sm font-semibold transition ${activePage === page.key ? 'bg-[#202a36] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{page.label}</button>)}
        </div>

        {loading ? <div className="flex justify-center py-10" role="status" aria-label={sp.loading || 'Loading'}><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div> : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-[#202a36]" style={{ fontFamily: 'Cinzel, serif' }}>{sp.materials || 'Materials'}</h2><button type="button" disabled={materials.length >= LIMITS.materials} onClick={() => setMaterials(current => [...current, { name: sp.newMaterial || 'New Material', color: '#cccccc', image: '' }])} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{sp.addMaterial || '+ Add Material'}</button></div>
              <p className="mb-4 text-xs text-slate-400">{sp.materialsHint || 'Colors and optional texture images for the studio palette.'}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {materials.map((item, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <ColorSwatchButton color={item.color} onChange={color => updateMaterial(index, { color })} label={`${sp.materials || 'Material'}: ${item.name || index + 1}`} basicColorsLabel={sp.basicColors || 'Basic Colors'} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <input aria-label={sp.materialNamePlaceholder || 'Material name'} maxLength={80} value={item.name} onChange={event => updateMaterial(index, { name: event.target.value })} className={inputClass} placeholder={sp.materialNamePlaceholder || 'Material name'} />
                      <div className="flex items-center gap-2">
                        {item.image ? <div className="relative"><img src={item.image} alt={item.name} className="h-8 w-8 rounded border border-slate-200 object-cover" /><button type="button" aria-label={sp.removeImage || 'Remove image'} onClick={() => updateMaterial(index, { image: '' })} className="absolute -end-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] text-white">✕</button></div> : <label className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400 hover:border-[#4b6741] hover:text-[#4b6741]" aria-label={sp.uploadTexture || 'Upload texture'}>{uploadingIndex === index ? '…' : '📷'}<input type="file" accept="image/*" disabled={uploadingIndex !== null} className="hidden" onChange={event => event.target.files?.[0] && uploadImage(event.target.files[0], index)} /></label>}
                        <span className="text-[10px] text-slate-400">{item.image ? (sp.texturePhotoSet || 'Texture photo set') : (sp.noTexturePhoto || 'No texture photo')}</span>
                      </div>
                    </div>
                    <button type="button" aria-label={`${removeLabel} ${item.name || index + 1}`} disabled={materials.length <= 1} onClick={() => setMaterials(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30">✕</button>
                  </div>
                ))}
              </div>
            </section>

            {renderFinishGroup(sp.wallFinishes || 'Wall Finishes', wallFinishes, setWallFinishes, 'wallFinishes')}
            {renderFinishGroup(sp.floorFinishes || 'Floor Finishes', floorFinishes, setFloorFinishes, 'floorFinishes')}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-[#202a36]" style={{ fontFamily: 'Cinzel, serif' }}>{sp.livePreview || 'Live Preview'}</h2>
              <div className="h-24 rounded-xl" style={{ background: `linear-gradient(135deg, ${materials?.[0]?.color || '#cccccc'} 0%, ${wallFinishes?.[0]?.color || '#cccccc'} 55%, ${floorFinishes?.[0]?.color || '#cccccc'} 100%)` }} />
              <p className="mt-2 text-xs text-slate-400">{sp.livePreviewHint || 'Preview using the first available entry in each group.'}</p>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
