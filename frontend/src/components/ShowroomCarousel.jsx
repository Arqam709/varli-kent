import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { localizedText } from '../lib/localizedText'

const C = {
  charcoal: '#1E1E1C',
  darkGrey: '#2B2B28',
  gold: '#C9A35A',
  green: '#5E7F52',
  marble: '#F6F3ED',
}

const AUTOPLAY_INTERVAL_MS = 4500
const RESUME_AFTER_MS = 15000

const isVideoUrl = (url) => Boolean(url) && (url.includes('/video/') || /\.(mp4|mov|webm|avi)$/i.test(url))

/*
 * Whether a hex background is dark enough to need light ink on top.
 *
 * The donor takes this as a `dark` prop because its bgColor is a CSS custom
 * property that cannot be parsed. CURRENT's four consumers all pass a literal
 * hex ('#FCFAF6' on Architecture and Renovation, '#1E1E1C' on Construction
 * and Interior), so it can simply be measured — which keeps all four call
 * sites untouched. An explicit `dark` prop still wins if a caller passes one.
 */
const isDarkBackground = (hex) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!match) return true

  const n = parseInt(match[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  // Rec. 601 luma, which is enough to answer 'light or dark ground'.
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140
}

/*
 * Media lightbox — donor behaviour: the image or video full size on the left,
 * and, when the item has detailText, a panel of prose beside it. An item with
 * no detail still opens, just as a plain full-size view.
 */
function ShowroomLightbox({ item, onClose }) {
  const { t, language } = useLanguage()
  const loc = (value) => localizedText(value, language)

  const vid = isVideoUrl(item.url)
  const caption = loc(item.caption)
  const title = loc(item.title)
  const detailText = loc(item.detailText)
  const hasDetail = detailText.trim() !== ''

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)

    // Restoring the previous value rather than assuming '': the page may
    // already have had its own overflow set.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8"
      style={{ background: 'rgba(10,10,9,0.92)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || caption || (t.common?.image || 'Image')}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full border transition cursor-pointer"
        style={{ borderColor: 'rgba(246,243,237,0.25)', color: C.marble }}
        aria-label={t.common?.close || 'Close'}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div
        className={`flex w-full max-w-5xl overflow-hidden rounded-2xl ${hasDetail ? 'flex-col lg:flex-row' : ''}`}
        style={{ background: hasDetail ? C.darkGrey : 'transparent', maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={hasDetail ? 'flex shrink-0 items-center justify-center bg-black lg:w-3/5' : 'flex items-center justify-center'}
          style={{ maxHeight: '88vh' }}
        >
          {vid ? (
            <video src={item.url} className="max-h-[88vh] w-full object-contain" controls autoPlay playsInline />
          ) : (
            <img
              src={item.url}
              alt={caption || title || ''}
              className="max-h-[88vh] w-full object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
        </div>

        {hasDetail && (
          <div className="overflow-y-auto p-7 sm:p-9 lg:w-2/5">
            {(title || caption) && (
              <h3 style={{ fontFamily: 'Cinzel, serif', color: C.marble }} className="mb-4 text-xl font-semibold">
                {title || caption}
              </h3>
            )}
            <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'rgba(246,243,237,0.75)' }}>
              {detailText}
            </p>
          </div>
        )}
      </div>
    </div>
  )
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

export default function ShowroomCarousel({ images = [], loading = false, bgColor = '#2B2B28', dark }) {
  const { t, language } = useLanguage()

  /*
   * Wave 12A2 — captions are stored per language and read here.
   * Wave 14B — title and detailText join them, resolved the same way.
   *
   * A pure lookup, no network. Legacy rows hold plain strings and resolve
   * unchanged. Media URLs, video vs image handling, order and visibility are
   * all untouched.
   */
  const loc = (value) => localizedText(value, language)

  const onDark = dark === undefined ? isDarkBackground(bgColor) : dark

  const [idx, setIdx] = useState(0)
  const [noTransition, setNoTransition] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  /*
   * Two INDEPENDENT reasons autoplay may be suspended, deliberately not one
   * shared boolean:
   *
   *   manualPaused  the visitor used an arrow; clears 15s after the LAST one
   *   pageHidden    the tab is in the background
   *
   * Sharing one flag let each reason clear the other — the manual timer could
   * fire while the tab was still hidden and restart autoplay, and returning
   * to the tab could cancel a manual pause that had seconds left to run.
   * Neither may cancel the other, so each owns its own state and the autoplay
   * effect checks both.
   *
   * pageHidden is seeded from document.hidden rather than false, so a
   * carousel mounted in an already-backgrounded tab does not start playing.
   */
  const [manualPaused, setManualPaused] = useState(false)
  const [pageHidden, setPageHidden] = useState(() => document.hidden)

  const cardsVisible = useCardsVisible()
  const showArrows = images.length > Math.floor(cardsVisible)
  const resumeTimerRef = useRef(null)

  /*
   * Circular loop: a few clones of the leading cards are appended after the
   * real list, so advancing past the end keeps scrolling forward into the
   * clones and then silently snaps back to index 0 — visually identical, so
   * the snap is invisible — instead of rewinding across the whole strip.
   */
  const cloneCount = Math.min(images.length, Math.ceil(cardsVisible))
  const wrapPoint = images.length
  const extendedImages = images.length > 0 ? [...images, ...images.slice(0, cloneCount)] : images

  useEffect(() => {
    if (idx !== wrapPoint) return

    const timer = setTimeout(() => {
      setNoTransition(true)
      setIdx(0)
      requestAnimationFrame(() => requestAnimationFrame(() => setNoTransition(false)))
    }, 750)

    return () => clearTimeout(timer)
  }, [idx, wrapPoint])

  // Plain function, not useCallback: it is called only by handleManualStep
  // below and never handed to a memoized child or an effect, so memoizing it
  // buys nothing and blocks the compiler from optimizing the component.
  const step = (dir) => {
    setIdx((i) => (dir > 0 ? Math.min(wrapPoint, i + 1) : Math.max(0, i - 1)))
  }

  // A manual arrow pauses autoplay, and only resumes 15s after the LAST
  // interaction — each click restarts the countdown. It touches manualPaused
  // and nothing else; visibility is not its business.
  const handleManualStep = (dir) => {
    step(dir)
    setManualPaused(true)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => setManualPaused(false), RESUME_AFTER_MS)
  }

  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  /*
   * Slow autoplay, stepped rather than a seamless scroll because this
   * carousel has captions and a counter that read better on a discrete move.
   *
   * Suspended while the lightbox is open, while the user is interacting, and
   * — beyond the donor — when the tab is hidden or the visitor has asked for
   * reduced motion. Those are four separate conditions and none of them
   * clears another. The interval is created inside the effect and cleared by
   * its own teardown, so a rerender cannot leave a second timer running and
   * nothing ticks after unmount.
   */
  const [motionOk, setMotionOk] = useState(true)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setMotionOk(!query.matches)
    sync()
    query.addEventListener('change', sync)

    // Mirrors document.hidden only. It never touches manualPaused, so
    // returning to the tab cannot cut a manual pause short.
    const onVisibility = () => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      query.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    // Every suspension reason checked independently: whichever clears first,
    // the others still hold.
    if (manualPaused || pageHidden || !motionOk || !showArrows || lightbox) return

    const id = setInterval(() => setIdx((i) => Math.min(wrapPoint, i + 1)), AUTOPLAY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [manualPaused, pageHidden, motionOk, showArrows, lightbox, wrapPoint])

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
    // Measured from bgColor, so the placeholder stays readable on the light
    // Architecture/Renovation bands as well as the dark ones.
    return (
      <div
        className="flex items-center justify-center rounded-xl py-20"
        style={{ border: onDark ? '1px dashed rgba(255,255,255,0.12)' : '1px dashed rgba(30,30,28,0.15)' }}
      >
        <p
          className="text-xs tracking-[0.2em] uppercase"
          style={{ color: onDark ? 'rgba(246,243,237,0.3)' : 'rgba(30,30,28,0.35)' }}
        >
          {t.common?.noImagesYet || 'No images yet'}
        </p>
      </div>
    )
  }

  // Solid gold with white ink, not tinted to the section, so a caption reads
  // the same on every service page regardless of that page's band.
  const captionBg = C.gold
  const captionTextStrong = '#FFFFFF'
  const captionTextMuted = 'rgba(255,255,255,0.88)'

  const cardWidthPct = 100 / cardsVisible
  const gapPx = 16
  const translateX = idx > 0 ? `calc(-${idx} * (${cardWidthPct}% + ${gapPx}px))` : '0'

  return (
    <div className="relative">
      <div className="overflow-hidden">
        <div
          className="flex items-start"
          style={{
            gap: gapPx,
            transform: `translateX(${translateX})`,
            transition: noTransition ? 'none' : 'transform 0.85s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          {extendedImages.map((img, i) => {
            const vid = isVideoUrl(img.url)
            const caption = loc(img.caption)
            // A one-or-two-word caption reads as a label; a longer one reads
            // as a sentence. Donor behaviour, kept.
            const wordCount = caption.trim().split(/\s+/).filter(Boolean).length

            return (
              <div key={`${img._id || i}-${i}`} className="shrink-0" style={{ width: `${cardWidthPct}%` }}>
                <button
                  type="button"
                  onClick={() => setLightbox(img)}
                  aria-label={`${caption || (vid ? (t.common?.video || 'Video') : (t.common?.image || 'Image'))} — ${t.common?.explore || 'Expand'}`}
                  className="group relative block w-full overflow-hidden rounded-xl cursor-pointer"
                  style={{ aspectRatio: '4/3' }}
                >
                  {vid ? (
                    <video
                      src={img.url}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      autoPlay muted loop playsInline
                    />
                  ) : (
                    <img
                      src={img.url}
                      alt={caption || ''}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  )}

                  <span
                    className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    style={{ background: 'rgba(20,20,18,0.65)', color: C.marble }}
                  >
                    {vid ? (t.common?.video || 'Video') : (t.common?.image || 'Image')}
                  </span>

                  <span
                    className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    style={{ background: 'rgba(10,10,9,0.25)' }}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'rgba(246,243,237,0.9)' }}>
                      <svg className="h-4 w-4" style={{ color: C.charcoal }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </span>
                  </span>
                </button>

                {/*
                  Caption box below the media, sized to whatever the admin
                  typed rather than a fixed-height overlay strip — which is
                  what lets a caption run to a full line without covering the
                  image.
                */}
                {caption && (
                  <div className="mt-2.5 rounded-lg px-3 py-2" style={{ background: captionBg }}>
                    <p
                      className={wordCount > 8 ? 'text-xs leading-relaxed' : 'text-xs uppercase tracking-wider'}
                      style={{ color: wordCount > 8 ? captionTextMuted : captionTextStrong }}
                    >
                      {caption}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right fog */}
      {showArrows && (
        <div
          className="pointer-events-none absolute right-0 top-0 w-12 sm:w-20"
          style={{ background: `linear-gradient(to right, transparent, ${bgColor})`, aspectRatio: '4/3' }}
        />
      )}

      {/* Arrows — next loops forward, previous stops at the start */}
      {showArrows && (
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => handleManualStep(-1)}
            disabled={idx === 0}
            className="flex h-11 w-11 items-center justify-center rounded-full border transition-all cursor-pointer disabled:opacity-25"
            style={{ borderColor: 'rgba(201,163,90,0.4)', color: C.gold }}
            aria-label={t.common?.previous || 'Previous'}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs tracking-widest" style={{ color: onDark ? 'rgba(246,243,237,0.3)' : 'rgba(30,30,28,0.4)' }}>
            {(idx % wrapPoint) + 1} / {images.length}
          </span>
          <button
            type="button"
            onClick={() => handleManualStep(1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border transition-all cursor-pointer"
            style={{ borderColor: 'rgba(201,163,90,0.4)', color: C.gold }}
            aria-label={t.common?.next || 'Next'}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {lightbox && <ShowroomLightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
