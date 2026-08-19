import { useCallback, useEffect, useRef, useState } from 'react'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function hsvToRgb(h, s, v) {
  const saturation = s / 100
  const brightness = v / 100
  const c = brightness * saturation
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = brightness - c
  let rgb = [0, 0, 0]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return Object.fromEntries(['r', 'g', 'b'].map((channel, index) => [channel, Math.round((rgb[index] + m) * 255)]))
}

function rgbToHsv(r, g, b) {
  const channels = [r, g, b].map(value => value / 255)
  const max = Math.max(...channels)
  const min = Math.min(...channels)
  const delta = max - min
  let h = 0
  if (delta) {
    if (max === channels[0]) h = ((channels[1] - channels[2]) / delta) % 6
    else if (max === channels[1]) h = (channels[2] - channels[0]) / delta + 2
    else h = (channels[0] - channels[1]) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? (delta / max) * 100 : 0, v: max * 100 }
}

const rgbToHex = (r, g, b) => `#${[r, g, b].map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`
const hexToRgb = (hex) => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return match ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) } : null
}

const BASIC_COLORS = [
  '#F2EDE8', '#F8F5F0', '#EFE9E1', '#E8DDD0', '#C4A882', '#D4B483', '#B08D57', '#8A8A8A',
  '#4A3728', '#3D2B1F', '#1A1A1A', '#202A36', '#3D4655', '#8FA3B1', '#8FA88A', '#5E7F52',
  '#C9A35A', '#D97706', '#B85C38', '#7A1F1F', '#4B6741', '#1C6B7A', '#5A3E85', '#202A36',
]

function useDragSurface(ref, onDrag) {
  const report = useCallback((clientX, clientY) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    onDrag(clamp((clientX - rect.left) / rect.width, 0, 1), clamp((clientY - rect.top) / rect.height, 0, 1))
  }, [onDrag, ref])

  return useCallback((clientX, clientY) => {
    report(clientX, clientY)
    const move = (event) => {
      event.preventDefault()
      const point = event.touches?.[0] || event
      report(point.clientX, point.clientY)
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', stop)
  }, [report])
}

export default function ColorPicker({ value, onChange, basicColorsLabel = 'Basic Colors' }) {
  const initialRgb = hexToRgb(value) || { r: 200, g: 200, b: 200 }
  const initialHsv = rgbToHsv(initialRgb.r, initialRgb.g, initialRgb.b)
  const [h, setH] = useState(initialHsv.h)
  const [s, setS] = useState(initialHsv.s)
  const [v, setV] = useState(initialHsv.v)
  const [hexInput, setHexInput] = useState(value)
  const squareRef = useRef(null)
  const hueRef = useRef(null)

  useEffect(() => {
    const rgb = hexToRgb(value)
    if (!rgb) return
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    setH(hsv.h)
    setS(hsv.s)
    setV(hsv.v)
    setHexInput(value)
  }, [value])

  const commit = useCallback((nextH, nextS, nextV) => {
    const rgb = hsvToRgb(nextH, nextS, nextV)
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b)
    setHexInput(hex)
    onChange(hex)
  }, [onChange])

  const changeSquare = useCallback((x, y) => {
    const nextS = x * 100
    const nextV = (1 - y) * 100
    setS(nextS)
    setV(nextV)
    commit(h, nextS, nextV)
  }, [commit, h])
  const changeHue = useCallback((x) => {
    const nextH = x * 360
    setH(nextH)
    commit(nextH, s, v)
  }, [commit, s, v])
  const startSquareDrag = useDragSurface(squareRef, changeSquare)
  const startHueDrag = useDragSurface(hueRef, changeHue)

  const rgb = hsvToRgb(h, s, v)
  const currentHex = rgbToHex(rgb.r, rgb.g, rgb.b)
  const handleHexChange = (input) => {
    setHexInput(input)
    const nextRgb = hexToRgb(input)
    if (!nextRgb) return
    const hsv = rgbToHsv(nextRgb.r, nextRgb.g, nextRgb.b)
    setH(hsv.h)
    setS(hsv.s)
    setV(hsv.v)
    onChange(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b))
  }
  const handleRgbChange = (channel, input) => {
    const next = { ...rgb, [channel]: clamp(Number(input) || 0, 0, 255) }
    handleHexChange(rgbToHex(next.r, next.g, next.b))
  }

  return (
    <div className="w-72 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-2xl" dir="ltr" aria-label="Color picker">
      <div
        ref={squareRef}
        role="slider"
        tabIndex={0}
        aria-label="Color saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v)}
        aria-valuetext={`Saturation ${Math.round(s)}%, brightness ${Math.round(v)}%`}
        onKeyDown={event => {
          const step = event.shiftKey ? 10 : 2
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const nextS = clamp(s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 100)
          const nextV = clamp(v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), 0, 100)
          setS(nextS); setV(nextV); commit(h, nextS, nextV)
        }}
        onMouseDown={event => startSquareDrag(event.clientX, event.clientY)}
        onTouchStart={event => startSquareDrag(event.touches[0].clientX, event.touches[0].clientY)}
        className="relative h-40 w-full cursor-crosshair rounded-lg select-none focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))` }}
      >
        <div className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${s}%`, top: `${100 - v}%`, backgroundColor: currentHex, boxShadow: '0 0 0 1px rgba(0,0,0,0.3)' }} />
      </div>

      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const nextH = clamp(h + (event.key === 'ArrowRight' ? 5 : -5), 0, 360)
          setH(nextH); commit(nextH, s, v)
        }}
        onMouseDown={event => startHueDrag(event.clientX, event.clientY)}
        onTouchStart={event => startHueDrag(event.touches[0].clientX, event.touches[0].clientY)}
        className="relative mt-3 h-4 w-full cursor-pointer rounded-full select-none focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <div className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${(h / 360) * 100}%`, backgroundColor: `hsl(${h}, 100%, 50%)`, boxShadow: '0 0 0 1px rgba(0,0,0,0.3)' }} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-lg border border-slate-200" style={{ backgroundColor: currentHex }} aria-hidden="true" />
        <div className="flex-1 space-y-1.5">
          <input aria-label="Hex color" value={hexInput} onChange={event => handleHexChange(event.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-[#4b6741]" placeholder="#RRGGBB" />
          <div className="grid grid-cols-3 gap-1">
            {['r', 'g', 'b'].map(channel => (
              <input key={channel} aria-label={`${channel.toUpperCase()} color channel`} type="number" min="0" max="255" value={rgb[channel]} onChange={event => handleRgbChange(channel, event.target.value)} className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4b6741]" />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{basicColorsLabel}</p>
      <div className="grid grid-cols-8 gap-1" aria-label="Preset colors">
        {BASIC_COLORS.map((color, index) => (
          <button key={`${color}-${index}`} type="button" onClick={() => handleHexChange(color)} aria-label={`Select color ${color}`} className="h-5 w-5 rounded-sm border border-black/10 cursor-pointer transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#4b6741]" style={{ backgroundColor: color }} title={color} />
        ))}
      </div>
    </div>
  )
}
