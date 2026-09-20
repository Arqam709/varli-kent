import multer from 'multer'
import { ROOM_PHOTO_CONSENT_VERSION, ROOM_PHOTO_MAX_UPLOAD_BYTES } from '../config/designRoomPhotos.js'

export const ROOM_PHOTO_FIELD = 'photo'

const reject = (res, status, code, message) => res.status(status).json({ success: false, code, message })

const consentError = () => Object.assign(new Error('Room photo consent is required'), { roomPhotoConsent: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ROOM_PHOTO_MAX_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    fieldNameSize: 64,
    fieldSize: 128,
    headerPairs: 50,
  },
  fileFilter: (req, file, cb) => {
    if (req.body?.consentVersion !== ROOM_PHOTO_CONSENT_VERSION) return cb(consentError())
    cb(null, true)
  },
}).single(ROOM_PHOTO_FIELD)


export function receiveRoomPhoto(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next()

    if (err.roomPhotoConsent) {
      return reject(res, 400, 'CONSENT_REQUIRED', 'Please accept the room photo notice before uploading.')
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return reject(res, 413, 'PHOTO_FILE_TOO_LARGE', 'This photo file is too large.')
      }
      // LIMIT_UNEXPECTED_FILE (wrong field or a second file), LIMIT_FIELD_*,
      // LIMIT_PART_COUNT and friends: the request is not a valid room photo upload.
      return reject(res, 400, 'INVALID_UPLOAD', 'The upload was not a valid room photo request.')
    }

    // Malformed multipart bodies (truncated boundaries, bad headers) from busboy.
    return reject(res, 400, 'INVALID_UPLOAD', 'The upload could not be read.')
  })
}
