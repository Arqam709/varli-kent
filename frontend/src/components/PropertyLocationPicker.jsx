import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Bundled through Vite rather than fetched from unpkg at runtime. A CDN icon is
// a third-party request on every admin page load: it breaks behind a strict
// CSP, breaks offline, and pins the marker artwork to whatever version unpkg
// happens to serve. These resolve to fingerprinted local assets instead.
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
const ZOOM_WITH_LOCATION = 13
const ZOOM_WITHOUT_LOCATION = 10

const LAT_MIN = -90
const LAT_MAX = 90
const LNG_MIN = -180
const LNG_MAX = 180
const RADIUS_MIN_KM = 1
const RADIUS_MAX_KM = 20
const RADIUS_DEFAULT_KM = 5

// Mirrors backend/routes/properties.js. Never `if (lat && lng)` — latitude 0
// and longitude 0 are real coordinates off the coast of Africa, and every
// truthiness check silently throws them away.
const isValidLat = (v) => Number.isFinite(v) && v >= LAT_MIN && v <= LAT_MAX
const isValidLng = (v) => Number.isFinite(v) && v >= LNG_MIN && v <= LNG_MAX
const isValidRadius = (v) => Number.isFinite(v) && v >= RADIUS_MIN_KM && v <= RADIUS_MAX_KM

/**
 * Parses one typed coordinate field.
 *
 * An empty field is "not filled in yet", which is different from "invalid" —
 * the caller must not treat a half-typed form as an error the instant the
 * admin clears a box to retype it.
 */
const parseCoordText = (text) => {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { state: 'empty', value: null }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { state: 'invalid', value: null }
  return { state: 'ok', value }
}

const coordToText = (v) => (Number.isFinite(v) ? String(v) : '')

/** Keeps the viewport following the committed coordinate. */
function Recenter({ lat, lng }) {
  const map = useMap()

  useEffect(() => {
    if (!isValidLat(lat) || !isValidLng(lng)) return
    // setView rather than remounting MapContainer: `center` is only an INITIAL
    // value in react-leaflet, so a plain prop change moves the marker but
    // leaves the viewport wherever the admin last dragged it.
    map.setView([lat, lng], Math.max(map.getZoom(), ZOOM_WITH_LOCATION))
  }, [lat, lng, map])

  return null
}

function ClickCapture({ onPick, disabled }) {
  useMapEvents({
    click: (e) => {
      if (disabled) return
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/**
 * Admin coordinate picker.
 *
 * ── The contract with the parent ────────────────────────────────────────
 * `onChange` only ever emits a COMPLETE, valid location object or an explicit
 * null (from Clear). Half-typed input never escapes this component, so the
 * parent's payload builder cannot accidentally send `{ lat: 41, lng: null }`
 * to a backend that would 400 it — or worse, send something a future backend
 * might misread as "erase the pin".
 *
 * `onDraftErrorChange` is how the parent learns to block Save while a field is
 * mid-edit or out of range. It is separate from onChange precisely because an
 * invalid draft has no value to report.
 *
 * ── The map is an enhancement, not the interface ────────────────────────
 * Everything is reachable from the latitude/longitude inputs. A Leaflet canvas
 * is not keyboard navigable in any meaningful way, so a click-only picker would
 * make the field unusable without a mouse.
 */
export default function PropertyLocationPicker({
  value = null,
  onChange,
  onDraftErrorChange,
  disabled = false,
  labels = {},
}) {
  const lat = value?.lat
  const lng = value?.lng
  const isApproximate = value?.isApproximate === true
  const radiusKm = Number.isFinite(value?.approxRadiusKm) ? value.approxRadiusKm : RADIUS_DEFAULT_KM

  const hasLocation = isValidLat(lat) && isValidLng(lng)

  // Text mirrors of the two coordinates. Held separately so a partially typed
  // value survives re-renders instead of being stomped back to the last
  // committed number on every keystroke.
  const [latText, setLatText] = useState(() => coordToText(lat))
  const [lngText, setLngText] = useState(() => coordToText(lng))
  // Radius is a draft field for the same reason the coordinates are: silently
  // rewriting 21 to 20 hides the mistake instead of reporting it, and the admin
  // walks away believing they saved a 21 km radius.
  const [radiusText, setRadiusText] = useState(() => String(radiusKm))

  // Re-sync when the value changes from OUTSIDE (edit loads, map click, clear).
  useEffect(() => {
    setLatText(coordToText(lat))
    setLngText(coordToText(lng))
  }, [lat, lng])

  // Separate effect, keyed only on the committed radius. An invalid draft never
  // commits, so `radiusKm` does not change and this cannot stomp what the admin
  // is still typing — which is also why there is no feedback loop.
  useEffect(() => {
    setRadiusText(String(radiusKm))
  }, [radiusKm])

  const latParsed = parseCoordText(latText)
  const lngParsed = parseCoordText(lngText)

  const latError = latParsed.state === 'invalid' || (latParsed.state === 'ok' && !isValidLat(latParsed.value))
  const lngError = lngParsed.state === 'invalid' || (lngParsed.state === 'ok' && !isValidLng(lngParsed.value))
  // One box filled and the other empty is a half pair — not submittable.
  const halfPair = (latParsed.state === 'empty') !== (lngParsed.state === 'empty')

  const radiusParsed = parseCoordText(radiusText)
  const radiusValueBad =
    radiusParsed.state === 'invalid' ||
    (radiusParsed.state === 'ok' && !isValidRadius(radiusParsed.value))
  // An empty box counts as incomplete rather than malformed, but it is still
  // not submittable while the radius is the thing being published.
  const radiusIncomplete = radiusParsed.state === 'empty'
  // Only meaningful in approximate mode. In exact mode the radius is neither
  // shown nor published, so a stale draft must not be able to block Save.
  const radiusError = isApproximate && hasLocation && (radiusValueBad || radiusIncomplete)

  const draftError = latError || lngError || halfPair || radiusError

  useEffect(() => {
    onDraftErrorChange?.(draftError)
  }, [draftError, onDraftErrorChange])

  const emit = (next) => { if (!disabled) onChange?.(next) }

  /** Commits only when BOTH boxes hold an in-range number. */
  const commitFromText = (nextLatText, nextLngText) => {
    const a = parseCoordText(nextLatText)
    const b = parseCoordText(nextLngText)
    if (a.state !== 'ok' || b.state !== 'ok') return
    if (!isValidLat(a.value) || !isValidLng(b.value)) return
    emit({ lat: a.value, lng: b.value, isApproximate, approxRadiusKm: radiusKm })
  }

  const handleLatText = (text) => { setLatText(text); commitFromText(text, lngText) }
  const handleLngText = (text) => { setLngText(text); commitFromText(latText, text) }

  const handleMapPick = (nextLat, nextLng) => {
    // Rounded to ~1cm. Leaflet hands back 15 significant digits, which is
    // false precision for a property pin and noisy in the coordinate boxes.
    const round = (n) => Math.round(n * 1e7) / 1e7
    emit({ lat: round(nextLat), lng: round(nextLng), isApproximate, approxRadiusKm: radiusKm })
  }

  // Toggling mode must never move the pin — only isApproximate changes.
  const handleApproximateToggle = (checked) => {
    if (!hasLocation) return
    emit({ lat, lng, isApproximate: checked, approxRadiusKm: radiusKm })
  }

  /**
   * Commits a radius only when it is genuinely in range.
   *
   * Nothing is clamped. 0, -1 and 21 are refused outright and surfaced as a
   * validation error, because quietly substituting a different number than the
   * one the admin typed is worse than telling them it was wrong.
   */
  const handleRadius = (text) => {
    setRadiusText(text)
    if (!hasLocation) return
    const parsed = parseCoordText(text)
    if (parsed.state !== 'ok' || !isValidRadius(parsed.value)) return
    emit({ lat, lng, isApproximate, approxRadiusKm: parsed.value })
  }

  // The one deliberate destructive action. The parent turns this into an
  // explicit `location: null`; nothing else in this component can.
  const handleClear = () => {
    setLatText('')
    setLngText('')
    // Back to the default so the next location starts from 5 rather than
    // inheriting whatever half-typed radius was on screen when Clear was hit.
    setRadiusText(String(RADIUS_DEFAULT_KM))
    emit(null)
  }

  const center = useMemo(
    () => (hasLocation ? [lat, lng] : ISTANBUL_CENTER),
    [hasLocation, lat, lng]
  )

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741] disabled:cursor-not-allowed disabled:opacity-60'
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500'
  const errCls = 'mt-1 text-xs font-medium text-red-600'

  return (
    <div className="space-y-3">
      {/* Coordinates — the keyboard-accessible path, deliberately above the map. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="property-latitude" className={labelCls}>
            {labels.latitude || 'Latitude'}
          </label>
          <input
            id="property-latitude"
            type="number"
            inputMode="decimal"
            step="any"
            min={LAT_MIN}
            max={LAT_MAX}
            value={latText}
            disabled={disabled}
            onChange={(e) => handleLatText(e.target.value)}
            className={inputCls}
            placeholder="41.0082"
            aria-invalid={latError || undefined}
            aria-describedby={latError ? 'property-latitude-error' : undefined}
          />
          {latError && (
            <p id="property-latitude-error" className={errCls} role="alert">
              {labels.invalidLatitude || 'Latitude must be a number between -90 and 90.'}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="property-longitude" className={labelCls}>
            {labels.longitude || 'Longitude'}
          </label>
          <input
            id="property-longitude"
            type="number"
            inputMode="decimal"
            step="any"
            min={LNG_MIN}
            max={LNG_MAX}
            value={lngText}
            disabled={disabled}
            onChange={(e) => handleLngText(e.target.value)}
            className={inputCls}
            placeholder="28.9784"
            aria-invalid={lngError || undefined}
            aria-describedby={lngError ? 'property-longitude-error' : undefined}
          />
          {lngError && (
            <p id="property-longitude-error" className={errCls} role="alert">
              {labels.invalidLongitude || 'Longitude must be a number between -180 and 180.'}
            </p>
          )}
        </div>
      </div>

      {halfPair && !latError && !lngError && (
        <p className={errCls} role="alert">
          {labels.incompletePair || 'Enter both latitude and longitude, or clear the location.'}
        </p>
      )}

      {/* Mode + radius */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="property-approximate"
            checked={isApproximate}
            disabled={disabled || !hasLocation}
            onChange={(e) => handleApproximateToggle(e.target.checked)}
            className="h-4 w-4 accent-[#4b6741] disabled:cursor-not-allowed disabled:opacity-60"
          />
          <label
            htmlFor="property-approximate"
            className="cursor-pointer text-sm font-medium text-slate-700"
          >
            {labels.approximateLocation || 'Approximate location'}
          </label>
        </div>

        {isApproximate && hasLocation && (
          <div className="flex items-center gap-2">
            <label htmlFor="property-radius" className="text-sm font-medium text-slate-700">
              {labels.approximateRadius || 'Approximate radius'}
            </label>
            <input
              id="property-radius"
              type="number"
              inputMode="numeric"
              min={RADIUS_MIN_KM}
              max={RADIUS_MAX_KM}
              step="1"
              value={radiusText}
              disabled={disabled}
              onChange={(e) => handleRadius(e.target.value)}
              className="w-20 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741] disabled:cursor-not-allowed disabled:opacity-60"
              aria-invalid={radiusError || undefined}
              aria-describedby={radiusError ? 'property-radius-error' : undefined}
            />
            <span className="text-sm text-slate-500">{labels.kilometres || 'km'}</span>
          </div>
        )}
      </div>

      {radiusError && (
        <p id="property-radius-error" className={errCls} role="alert">
          {labels.invalidRadius || 'Approximate radius must be a number between 1 and 20 km.'}
        </p>
      )}

      {isApproximate && (
        <p className="text-xs text-slate-500">
          {labels.approximateHint || 'Public pages will show only the radius — the exact coordinates stay private.'}
        </p>
      )}

      {/* Map — an enhancement over the inputs above, never the only route. */}
      <div
        className="overflow-hidden rounded-xl border border-slate-200"
        role="group"
        aria-label={labels.mapLabel || 'Property location map'}
      >
        <div className="h-[240px] w-full sm:h-[320px]">
          <MapContainer
            center={center}
            zoom={hasLocation ? ZOOM_WITH_LOCATION : ZOOM_WITHOUT_LOCATION}
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickCapture onPick={handleMapPick} disabled={disabled} />
            <Recenter lat={lat} lng={lng} />
            {hasLocation && !isApproximate && <Marker position={[lat, lng]} icon={markerIcon} />}
            {hasLocation && isApproximate && (
              <Circle
                center={[lat, lng]}
                radius={radiusKm * 1000}
                pathOptions={{ color: '#4b6741', fillColor: '#4b6741', fillOpacity: 0.18 }}
              />
            )}
          </MapContainer>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {hasLocation
            ? (labels.mapInstruction || 'Click the map or type coordinates to move the location.')
            : (labels.noLocationSelected || 'No location selected. Click the map or enter coordinates.')}
        </p>

        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || !hasLocation}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#4b6741] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.clearLocation || 'Clear location'}
        </button>
      </div>

      {/* Address and coordinates are independent by design — no geocoding. */}
      <p className="text-xs text-slate-400">
        {labels.addressIndependentHint || 'Changing the address does not automatically move the map location.'}
      </p>
    </div>
  )
}
