import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { useLanguage } from '../contexts/LanguageContext'
import { imageCropLabels } from '../locales/imageCrop'
import { cropBounds, cropToBlob } from '../lib/imageCrop'

const ASPECTS = { free: undefined, square: 1, landscape: 4 / 3, portrait: 3 / 4, wide: 16 / 9, tall: 9 / 16 }
const initialCrop = { unit: '%', x: 10, y: 10, width: 80, height: 80 }
const clampZoom = value => Math.min(4, Math.max(1, value))

// Remount per source: old image loads/encoding can never confirm a new selection.
export default function ImageCropModal(props) {
  return <CropEditor key={props.imageSrc} {...props} />
}

function CropEditor({ imageSrc, onCancel, onConfirm }) {
  const { language } = useLanguage()
  const labels = imageCropLabels(language)
  const [crop, setCrop] = useState(initialCrop)
  const [aspectKey, setAspectKey] = useState('free')
  const [zoom, setZoom] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(false)
  const imageRef = useRef(null)
  const dialogRef = useRef(null)
  const viewportRef = useRef(null)
  const active = useRef(true)
  const busy = useRef(false)
  const pinchRef = useRef(null)

  useEffect(() => {
    active.current = true
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current.focus()
    return () => {
      active.current = false
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const wheel = e => {
      if (!e.ctrlKey || busy.current) return
      e.preventDefault()
      setZoom(value => clampZoom(value - e.deltaY * 0.01))
    }
    const touchStart = e => {
      if (e.touches.length === 2) pinchRef.current = { distance: distance(e.touches), zoom }
    }
    const touchMove = e => {
      if (e.touches.length !== 2 || !pinchRef.current?.distance || busy.current) return
      e.preventDefault()
      setZoom(clampZoom(pinchRef.current.zoom * distance(e.touches) / pinchRef.current.distance))
    }
    const touchEnd = () => { pinchRef.current = null }
    viewport.addEventListener('wheel', wheel, { passive: false })
    viewport.addEventListener('touchstart', touchStart)
    viewport.addEventListener('touchmove', touchMove, { passive: false })
    viewport.addEventListener('touchend', touchEnd)
    return () => {
      viewport.removeEventListener('wheel', wheel)
      viewport.removeEventListener('touchstart', touchStart)
      viewport.removeEventListener('touchmove', touchMove)
      viewport.removeEventListener('touchend', touchEnd)
    }
  }, [zoom])

  const applyAspect = key => {
    setAspectKey(key)
    const image = imageRef.current
    if (ASPECTS[key] && image && loaded) {
      setCrop(centerCrop(makeAspectCrop({ unit: '%', width: 90 }, ASPECTS[key], image.width, image.height), image.width, image.height))
    }
  }
  const cancel = () => {
    if (busy.current) return
    active.current = false
    onCancel()
  }
  const confirm = async () => {
    if (!loaded || busy.current) return
    busy.current = true
    setProcessing(true)
    setError(false)
    try {
      const image = imageRef.current
      const result = await cropToBlob(image, crop)
      if (active.current) await onConfirm(result.blob, result.width, result.height, { width: image.naturalWidth, height: image.naturalHeight })
    } catch {
      if (active.current) setError(true)
    } finally {
      busy.current = false
      if (active.current) setProcessing(false)
    }
  }
  let valid = false
  if (loaded) {
    try { cropBounds(imageRef.current, crop); valid = true } catch { /* Empty selections cannot apply. */ }
  }
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel() }
    if (e.key !== 'Tab') return
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    const first = controls[0]
    const last = controls.at(-1)
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      e.preventDefault(); last?.focus()
    } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
      e.preventDefault(); first?.focus()
    }
  }
  const button = 'rounded-xl border border-white/25 px-3 py-2 text-sm disabled:opacity-40 hover:bg-white/10'
  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={labels.title} tabIndex={-1} onKeyDown={onKeyDown}
      dir={['ar', 'ur'].includes(language) ? 'rtl' : 'ltr'} className="fixed inset-0 z-[9990] flex h-[100dvh] flex-col bg-[#0c0c0a] text-white">
      <h2 className="shrink-0 px-4 py-2 text-center font-semibold">{labels.title}</h2>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto p-4" dir="ltr">
        <div className="flex min-h-full min-w-full items-start justify-start">
          <ReactCrop className="m-auto shrink-0" style={{ maxWidth: zoom === 1 ? '100%' : 'none' }} crop={crop} onChange={(_, percent) => setCrop(percent)} aspect={ASPECTS[aspectKey]} disabled={processing || !loaded} ruleOfThirds keepSelection>
            <img ref={imageRef} src={imageSrc} crossOrigin="anonymous" alt={labels.title}
              onLoad={() => { if (active.current) { setLoaded(true); setError(false) } }}
              onError={() => { setLoaded(false); setError(true) }}
              style={zoom === 1 ? { display: 'block', maxWidth: '100%', maxHeight: '60dvh' } : { display: 'block', height: `${60 * zoom}dvh`, maxWidth: 'none' }} />
          </ReactCrop>
        </div>
      </div>
      <div className="max-h-[45dvh] shrink-0 overflow-y-auto bg-[#171713] p-4">
        <fieldset disabled={processing} className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
          {Object.keys(ASPECTS).map(key => <button key={key} type="button" aria-pressed={aspectKey === key} onClick={() => applyAspect(key)} className={`${button} ${aspectKey === key ? 'bg-[#4b6741]' : ''}`}>{labels[key]}</button>)}
          <button type="button" className={button} aria-label={labels.zoomOut} onClick={() => setZoom(value => clampZoom(value - 0.25))}>−</button>
          <input type="range" min="1" max="4" step="0.01" value={zoom} aria-label={labels.zoom} onChange={e => setZoom(Number(e.target.value))} />
          <button type="button" className={button} aria-label={labels.zoomIn} onClick={() => setZoom(value => clampZoom(value + 0.25))}>+</button>
          <button type="button" className={button} onClick={() => { setZoom(1); setAspectKey('free'); setCrop(initialCrop) }}>{labels.reset}</button>
        </fieldset>
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-white/60">{labels.hint}</p>
        {error && <p role="alert" className="mt-2 text-center text-sm text-red-300">{labels.error}</p>}
        <div className="mx-auto mt-3 flex max-w-2xl justify-end gap-3">
          <button type="button" disabled={processing} className={button} onClick={cancel}>{labels.cancel}</button>
          <button type="button" disabled={processing || !valid} className={`${button} bg-[#4b6741]`} onClick={confirm}>{processing ? labels.applying : labels.apply}</button>
        </div>
      </div>
    </div>, document.body,
  )
}
