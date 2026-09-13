// Percent coordinates remain accurate when the image is resized or zoomed.
export function cropBounds(image, crop) {
  const { naturalWidth: width, naturalHeight: height } = image
  if (![width, height].every(n => Number.isFinite(n) && n > 0) ||
      crop?.unit !== '%' || ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.width <= 0 || crop.height <= 0) throw new Error('Invalid crop')
  const clamp = n => Math.max(0, Math.min(100, n))
  const x = Math.round(clamp(crop.x) * width / 100)
  const y = Math.round(clamp(crop.y) * height / 100)
  const right = Math.round(clamp(crop.x + crop.width) * width / 100)
  const bottom = Math.round(clamp(crop.y + crop.height) * height / 100)
  if (right - x < 1 || bottom - y < 1) throw new Error('Invalid crop')
  return { x, y, width: right - x, height: bottom - y }
}

export async function cropToBlob(image, crop) {
  const bounds = cropBounds(image, crop)
  // Bound the output allocation while preserving the selected aspect ratio.
  const scale = Math.min(1, 4096 / Math.max(bounds.width, bounds.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bounds.width * scale))
  canvas.height = Math.max(1, Math.round(bounds.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image encoding failed')), 'image/jpeg', 0.94)
  })
  return { blob, width: canvas.width, height: canvas.height }
}

export const emptyCrop = { cropUrl: '', width: 0, height: 0, cropWidth: 0, cropHeight: 0 }

// Called only after both uploads succeed. Never put the crop into the original URL.
export function applyShowroomCrop(form, result) {
  if (!result.cropUrl || ![result.cropWidth, result.cropHeight].every(n => Number.isInteger(n) && n > 0)) {
    throw new Error('Invalid crop result')
  }
  return {
    ...form,
    url: result.originalUrl || form.url,
    width: result.width ?? form.width,
    height: result.height ?? form.height,
    cropUrl: result.cropUrl,
    cropWidth: result.cropWidth,
    cropHeight: result.cropHeight,
  }
}
