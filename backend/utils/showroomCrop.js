const defaults = { width: 0, height: 0, cropWidth: 0, cropHeight: 0, cropUrl: '' }
const invalid = () => { const error = new Error('Invalid showroom crop metadata'); error.status = 400; throw error }

// Validate complete metadata even on partial updates, and clear an old crop
// when an API client replaces the original without supplying a new crop.
export function normalizeShowroomCrop(body, existing = {}) {
  const changedOriginal = Object.hasOwn(body, 'url') && body.url !== existing.url
  const base = changedOriginal ? defaults : Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, existing[key] ?? value]))
  const crop = { ...base }
  for (const key of Object.keys(defaults)) if (Object.hasOwn(body, key)) crop[key] = body[key]
  for (const key of ['width', 'height', 'cropWidth', 'cropHeight']) {
    if (!Number.isSafeInteger(crop[key]) || crop[key] < 0) invalid()
  }
  if ((crop.width === 0) !== (crop.height === 0)) invalid()
  if (typeof crop.cropUrl !== 'string') invalid()
  if (crop.cropUrl) {
    let url
    try { url = new URL(crop.cropUrl) } catch { invalid() }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid()
    if (crop.cropWidth < 1 || crop.cropHeight < 1 || crop.cropWidth > 4096 || crop.cropHeight > 4096) invalid()
    const originalUrl = body.url ?? existing.url ?? ''
    if (originalUrl.includes('/video/') || /\.(mp4|mov|webm|avi)(?:[?#]|$)/i.test(originalUrl)) invalid()
    if (crop.width && (crop.cropWidth > crop.width || crop.cropHeight > crop.height)) invalid()
  } else {
    crop.cropWidth = 0
    crop.cropHeight = 0
  }
  return { ...body, ...crop }
}
