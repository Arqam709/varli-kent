import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ColorPicker from './ColorPicker'

const PICKER_WIDTH = 288
const PICKER_HEIGHT = 380

export default function ColorSwatchButton({ color, onChange, size = 36, label = 'Choose color', basicColorsLabel }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const ref = useRef(null)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const rtl = getComputedStyle(ref.current).direction === 'rtl'
    const preferredLeft = rtl ? rect.right - PICKER_WIDTH : rect.left
    const below = rect.bottom + 8
    const top = below + PICKER_HEIGHT <= window.innerHeight
      ? below
      : Math.max(8, rect.top - PICKER_HEIGHT - 8)
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - PICKER_WIDTH - 8, preferredLeft)),
      top,
    })
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = event => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    const closeEscape = event => { if (event.key === 'Escape') setOpen(false) }
    const closeOnViewportChange = () => setOpen(false)
    window.addEventListener('mousedown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      window.removeEventListener('mousedown', closeOutside)
      window.removeEventListener('keydown', closeEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block shrink-0">
      <button type="button" onClick={() => setOpen(value => !value)} aria-label={`${label}: ${color}`} aria-haspopup="dialog" aria-expanded={open} className="shrink-0 rounded-full border-2 border-white shadow cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#4b6741]" style={{ backgroundColor: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)', width: size, height: size }} />
      {open && (
        <div role="dialog" aria-label={label} className="fixed z-[100]" style={{ left: position.left, top: position.top }}>
          <ColorPicker value={color} onChange={onChange} basicColorsLabel={basicColorsLabel} />
        </div>
      )}
    </div>
  )
}
