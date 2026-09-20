
export const ROOM_PHOTO_CONSENT_VERSION = '2026-09-room-photo-v1'

export const ROOM_PHOTO_ACCEPTED_FORMATS = ['jpeg', 'png', 'webp']


export const ROOM_PHOTO_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


export const ROOM_PHOTO_MAX_INPUT_PIXELS = 50_000_000

export const ROOM_PHOTO_MIN_SHORT_EDGE = 512

export const ROOM_PHOTO_MAX_ASPECT_RATIO = 3


export const ROOM_PHOTO_MAX_LONG_EDGE = 2048


export const ROOM_PHOTO_JPEG_QUALITY = 85

export const ROOM_PHOTO_OUTPUT_FORMAT = 'jpg'
export const ROOM_PHOTO_OUTPUT_CONTENT_TYPE = 'image/jpeg'


export const ROOM_PHOTO_MAX_STORED_PER_USER = 20


export const ROOM_PHOTO_MAX_UPLOADS_PER_DAY = 15


export const ROOM_PHOTO_MAX_ACTIVE_PROCESSING = 1

export const ROOM_PHOTO_MAX_QUEUED_PROCESSING = 3


export const ROOM_PHOTO_RETENTION_DAYS = 30

export const ROOM_PHOTO_STALE_UPLOAD_MS = 30 * 60 * 1000

export const ROOM_PHOTO_PURGED_RECORD_TTL_SECONDS = 30 * 24 * 60 * 60

export const ROOM_PHOTO_SWEEP_FIRST_RUN_MS = 60 * 1000
export const ROOM_PHOTO_SWEEP_INTERVAL_MS = 15 * 60 * 1000
export const ROOM_PHOTO_SWEEP_BATCH_SIZE = 25

export const ROOM_PHOTO_DELIVERY_TYPE = 'authenticated'

export const ROOM_PHOTO_STORAGE_TIMEOUT_MS = 60 * 1000

export const roomPhotoStorageEnvironment = (env = process.env) => {
  const raw = String(env.VARLIKENT_ENV || env.NODE_ENV || 'development').toLowerCase()
  const slug = raw.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  return slug || 'development'
}
