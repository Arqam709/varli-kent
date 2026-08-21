import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { Link } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { formatPrice } from '../lib/formatPrice'

import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

const markerIcon = new L.Icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const ISTANBUL_CENTER = [41.0082, 28.9784]
const SINGLE_MARKER_ZOOM = 14
const DETAIL_ZOOM = 15
const FIT_BOUNDS_MAX_ZOOM = 15
const FIT_BOUNDS_PADDING = [40, 40]

const isValidLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90
const isValidLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180


export const isPubliclyMappable = (property) => {
  const loc = property?.location

  return (
    loc?.isApproximate !== true &&
    isValidLat(loc?.lat) &&
    isValidLng(loc?.lng)
  )
}

/** True when the listing is deliberately private, regardless of coordinates. */
export const isApproximateLocation = (property) => property?.location?.isApproximate === true

function FitToMarkers({ points }) {
  const map = useMap()

  // useEffect, not useMemo: setView and fitBounds MUTATE the Leaflet map.
  // Memoisation is for deriving values and must stay pure — running a viewport
  // mutation during render misbehaves under StrictMode's double invocation and
  // under concurrent rendering, where a render may be discarded after the map
  // has already been moved.
  useEffect(() => {
    if (!points.length) return

    if (points.length === 1) {
      map.setView(points[0], SINGLE_MARKER_ZOOM)
      return
    }

    
    map.fitBounds(L.latLngBounds(points), {
      padding: FIT_BOUNDS_PADDING,
      maxZoom: FIT_BOUNDS_MAX_ZOOM,
    })
  }, [points, map])

  return null
}

/**
 * Map view for the public properties list.
 *
 * Receives the SAME array the grid renders, so filters need no separate map
 * query and the two views can never disagree about what the active result set
 * is.
 */
export default function PropertyMapView({ properties = [], labels = {} }) {
  const eligible = useMemo(
    () => properties.filter(isPubliclyMappable),
    [properties]
  )

  const points = useMemo(
    () => eligible.map((p) => [p.location.lat, p.location.lng]),
    [eligible]
  )

  const hiddenCount = properties.length - eligible.length

  const wrapperCls = 'overflow-hidden rounded-2xl border'
  const wrapperStyle = { borderColor: 'var(--vk-border)' }

  // Results exist, but none of them may be placed publicly. A blank map centred
  // on Istanbul would imply "nothing matched here", which is a different and
  // untrue statement — so the map is not drawn at all.
  if (eligible.length === 0) {
    return (
      <div
        className={`${wrapperCls} flex flex-col items-center justify-center px-6 py-20 text-center`}
        style={{ ...wrapperStyle, backgroundColor: 'var(--vk-section-light-alt)' }}
      >
        <svg className="h-14 w-14" style={{ color: 'var(--vk-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <h3 className="mt-4 text-lg font-semibold" style={{ color: 'var(--vk-text)' }}>
          {labels.noMappedProperties || 'None of these listings can be shown on the map'}
        </h3>
        <p className="mt-2 text-sm" style={{ color: 'var(--vk-text-muted)' }}>
          {labels.noMappedPropertiesHint || 'Some properties have private or unavailable map locations.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div
        className={wrapperCls}
        style={wrapperStyle}
        role="group"
        aria-label={labels.mapLabel || 'Map of matching properties'}
      >
        <div className="h-[55vh] min-h-[320px] w-full md:h-[480px] lg:h-[600px]">
          <MapContainer
            center={points[0] || ISTANBUL_CENTER}
            zoom={SINGLE_MARKER_ZOOM}
            // The map sits inside a long scrolling results page; capturing the
            // wheel there is the single most irritating thing an embedded map
            // can do. Dragging and the +/- controls still work normally.
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitToMarkers points={points} />

            {eligible.map((p) => (
              <Marker key={p._id} position={[p.location.lat, p.location.lng]} icon={markerIcon}>
                <Popup>
                  {/* dir="auto" — titles and districts arrive in Turkish, Arabic
                      or Urdu, and Leaflet's popup sits outside the page's own
                      direction context. */}
                  <div className="text-sm" dir="auto">
                    <p className="font-semibold text-[#202a36]">{p.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{p.district}</p>
                    <p className="mt-1 text-xs font-semibold text-[#d97706]">
                      {formatPrice(p.price, p.listingType, p.priceLabel)}
                    </p>
                    {/* A Link, not a button: focusable, middle-clickable, and
                        openable in a new tab the way any other listing link is. */}
                    <Link
                      to={`/properties/${p._id}`}
                      className="mt-2 inline-block text-xs font-semibold text-[#4b6741] underline"
                    >
                      {labels.viewDetails || 'View Details'}
                    </Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      {/*
        Deliberately vague about WHY a listing is missing. "Private or
        unavailable" covers both an owner who chose an approximate location and
        a listing that simply has no coordinates — naming which is which would
        leak the very thing the approximate setting exists to hide.
      */}
      {hiddenCount > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--vk-text-muted)' }}>
          {(labels.someLocationsHidden || '{count} listings are not shown on the map because their locations are private or unavailable.')
            .replace('{count}', String(hiddenCount))}
        </p>
      )}
    </div>
  )
}

/**
 * Single-property map for the details page.
 *
 * Leaflet, not a Google Maps embed. An iframe would put the exact coordinate
 * into a URL bound for a third party, which is the same leak the server-side
 * redaction exists to prevent — only from the opposite direction.
 *
 * Gated on the identical predicate as the list map, so "approximate wins over
 * coordinates" is stated once and obeyed in both places.
 */
export function SinglePropertyMap({ property, labels = {} }) {
  if (!isPubliclyMappable(property)) return null

  const { lat, lng } = property.location
  const position = [lat, lng]

  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200"
      role="group"
      aria-label={labels.mapLabel || 'Property location map'}
    >
      <div className="h-[260px] w-full sm:h-[340px]">
        <MapContainer
          center={position}
          zoom={DETAIL_ZOOM}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={position} icon={markerIcon} />
        </MapContainer>
      </div>
    </div>
  )
}
