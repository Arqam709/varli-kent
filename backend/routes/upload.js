import express from 'express'
import multer from 'multer'
import cloudinary from '../config/cloudinary.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'

const router = express.Router()

/* ─────────────────────────── Accepted media ───────────────────────────
 *
 * Two caps, not one, because the two media types fail differently.
 *
 * 10 MB for an image is Cloudinary's own limit on this account's plan, and it
 * is already the number printed under the picker in the admin form. Before
 * this file enforced it, multer accepted the file at 100 MB, the admin waited
 * out the whole upload, and Cloudinary rejected it at the far end — a failure
 * that cost minutes and arrived as a bare 500.
 *
 * multer's `limits.fileSize` has to stay at the VIDEO cap, since it cannot
 * vary per mimetype. The image cap is therefore checked after the buffer
 * arrives. That is still far better than the previous behaviour: the file is
 * refused before it is handed to Cloudinary, with a message naming the limit.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

const mb = (bytes) => Math.round(bytes / (1024 * 1024))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype) || ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      return cb(null, true)
    }
    cb(Object.assign(new Error('Unsupported file type. Use JPG, PNG, WEBP, GIF or AVIF for images, or MP4, MOV or WEBM for video.'), { status: 415 }))
  },
})

/**
 * multer with its errors translated into answers a person can act on.
 *
 * Without this, a MulterError reached server.js's global handler, which reads
 * `err.status` — a property MulterError does not have. An oversized file
 * therefore came back as `500 File too large`: a server fault, by status, for
 * something the caller can fix. The admin form showed it as "Upload failed".
 */
const singleFile = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (!err) return next()

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: `That file is too large. Images may be up to ${mb(MAX_IMAGE_BYTES)} MB and videos up to ${mb(MAX_VIDEO_BYTES)} MB.`,
        })
      }
      return res.status(400).json({ success: false, message: 'Upload one file per request.' })
    }

    return next(err)
  })

const uploadToCloudinary = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' }, // auto handles images + videos
      (error, result) => {
        if (error) return reject(error)
        resolve(result)
      }
    )
    stream.end(buffer)
  })
}

// POST /api/upload
router.post(
  '/',
  protect,
  requireRole('owner', 'admin'),
  singleFile,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided' })
      }

      const isImage = ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)
      if (isImage && req.file.size > MAX_IMAGE_BYTES) {
        return res.status(413).json({
          success: false,
          message: `${req.file.originalname || 'That image'} is ${(req.file.size / (1024 * 1024)).toFixed(1)} MB. Images may be up to ${mb(MAX_IMAGE_BYTES)} MB — resize it and try again.`,
        })
      }

      const result = await uploadToCloudinary(req.file.buffer, 'varlikent')
      res.status(201).json({
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
      })
    } catch (err) {
      /*
       * Cloudinary's own message is NOT forwarded. It can name the cloud, the
       * folder and the API surface, none of which belongs in a toast. What the
       * admin gets instead is the one thing that changes what they should do:
       * whether the file was refused (fix the file) or the service was
       * unreachable (try again). The full error still reaches the server log.
       */
      const providerStatus = err?.http_code || err?.error?.http_code
      console.error('[upload] Cloudinary upload failed:', err?.message || err)

      if (providerStatus && providerStatus >= 400 && providerStatus < 500) {
        return res.status(400).json({
          success: false,
          message: 'The media service rejected this file. Check that it is a valid image or video within the size limits.',
        })
      }

      return res.status(502).json({
        success: false,
        message: 'The media service is unavailable right now. Please try again in a moment.',
      })
    }
  }
)

// DELETE /api/upload/:publicId
router.delete('/:publicId', protect, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    await cloudinary.uploader.destroy(req.params.publicId)
    res.json({ success: true, message: 'Image deleted from Cloudinary' })
  } catch (err) {
    next(err)
  }
})

export default router
