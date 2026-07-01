import { useState, useEffect } from 'react'

const C = {
  charcoal: '#1E1E1C',
  darkGrey: '#2B2B28',
  gold: '#C9A35A',
  green: '#5E7F52',
  marble: '#F6F3ED',
}

function useCardsVisible() {
  const [cards, setCards] = useState(3.4)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setCards(w < 640 ? 1.15 : w < 1024 ? 2.2 : 3.4)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cards
}

export default function ShowroomCarousel({ images = [], loading = false, bgColor = '#2B2B28' }) {
  const [idx, setIdx] = useState(0)
  const cardsVisible = useCardsVisible()
  const maxIdx = Math.max(0, images.length - Math.floor(cardsVisible))
  const showArrows = images.length > Math.floor(cardsVisible)

  if (loading) {
    return (
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2].map(i => (
          <div key={i} className="shrink-0 rounded-xl animate-pulse" style={{ width: 'calc(33.33% - 11px)', aspectRatio: '4/3', backgroundColor: 'rgba(255,255,255,0.06)' }} />
        ))}
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl py-20" style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
        <p className="text-xs tracking-[0.2em] uppercase" style={{ color: 'rgba(246,243,237,0.3)' }}>No images yet</p>
      </div>
    )
  }

  const cardWidthPct = 100 / cardsVisible
  const gapPx = 16
  const translateX = idx > 0 ? `calc(-${idx} * (${cardWidthPct}% + ${gapPx}px))` : '0'

  return (
    <div className="relative">
      <div className="overflow-hidden">
        <div
          className="flex"
          style={{ gap: gapPx, transform: `translateX(${translateX})`, transition: 'transform 0.5s cubic-bezier(0.22,1,0.36,1)' }}
        >
          {images.map((img, i) => {
            const vid = img.url && (img.url.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(img.url))
            return (
              <div
                key={img._id || i}
                className="shrink-0 overflow-hidden rounded-xl group cursor-pointer"
                style={{ width: `${cardWidthPct}%` }}
              >
                <div className="relative" style={{ aspectRatio: '4/3' }}>
                  {vid ? (
                    <video
                      src={img.url}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      autoPlay muted loop playsInline
                    />
                  ) : (
                    <img
                      src={img.url}
                      alt={img.caption || ''}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                  {img.caption && (
                    <div
                      className="absolute inset-x-0 bottom-0 px-4 py-3"
                      style={{ background: 'linear-gradient(to top, rgba(30,30,28,0.85), transparent)' }}
                    >
                      <p className="text-xs tracking-wider uppercase" style={{ color: C.marble }}>{img.caption}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right fog */}
      {showArrows && idx < maxIdx && (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 sm:w-20"
          style={{ background: `linear-gradient(to right, transparent, ${bgColor})` }}
        />
      )}

      {/* Arrows */}
      {showArrows && (
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="flex h-11 w-11 items-center justify-center rounded-full border transition-all cursor-pointer disabled:opacity-25"
            style={{ borderColor: 'rgba(201,163,90,0.4)', color: C.gold }}
            aria-label="Previous"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs tracking-widest" style={{ color: 'rgba(246,243,237,0.3)' }}>
            {idx + 1} / {maxIdx + 1}
          </span>
          <button
            onClick={() => setIdx(i => Math.min(maxIdx, i + 1))}
            disabled={idx >= maxIdx}
            className="flex h-11 w-11 items-center justify-center rounded-full border transition-all cursor-pointer disabled:opacity-25"
            style={{ borderColor: 'rgba(201,163,90,0.4)', color: C.gold }}
            aria-label="Next"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
