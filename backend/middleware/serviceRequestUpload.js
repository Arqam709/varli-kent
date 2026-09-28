import multer from 'multer'
import { ROOM_PHOTO_MAX_UPLOAD_BYTES } from '../config/designRoomPhotos.js'
import { SERVICE_REQUEST_LIMITS } from '../config/serviceRequests.js'

// Receives a service-request submit: ONE multipart request carrying the JSON
// `payload` field and up to SERVICE_REQUEST_LIMITS.photos `photos` files.
//
// One request rather than "upload photos, then submit" on purpose: there are
// no temporary uploads to track or clean up when a customer abandons the form.
// A failed submit leaves nothing behind on the server, and the photos are still
// on the device for the retry.
//
// Same per-file ceiling as a room photo; each file is then validated and
// re-encoded by the same image pipeline. A request with no photos may be sent
// as plain JSON instead.

export const SERVICE_REQUEST_PAYLOAD_FIELD = 'payload'
export const SERVICE_REQUEST_PHOTOS_FIELD = 'photos'

const reject = (res, status, code, message) => res.status(status).json({ success: false, code, message })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ROOM_PHOTO_MAX_UPLOAD_BYTES,
    files: SERVICE_REQUEST_LIMITS.photos,
    fields: 1,
    fieldNameSize: 64,
    fieldSize: SERVICE_REQUEST_LIMITS.payloadBytes,
    headerPairs: 50,
  },
}).array(SERVICE_REQUEST_PHOTOS_FIELD, SERVICE_REQUEST_LIMITS.photos)

export function receiveServiceRequest(req, res, next) {
  if (!req.is('multipart/form-data')) {
    // Plain JSON (no photos): the app-wide express.json() already parsed it.
    req.serviceRequestPayload = req.body
    req.files = []
    return next()
  }

  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return reject(res, 413, 'PHOTO_FILE_TOO_LARGE', 'This photo file is too large.')
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return reject(res, 400, 'TOO_MANY_PHOTOS', `You can attach up to ${SERVICE_REQUEST_LIMITS.photos} photos.`)
      }
      return reject(res, 400, 'INVALID_UPLOAD', 'The request could not be read.')
    }
    if (err) return reject(res, 400, 'INVALID_UPLOAD', 'The request could not be read.')

    try {
      req.serviceRequestPayload = JSON.parse(req.body?.[SERVICE_REQUEST_PAYLOAD_FIELD] ?? '')
    } catch {
      return reject(res, 400, 'INVALID_UPLOAD', 'The request details could not be read.')
    }
    next()
  })
}
