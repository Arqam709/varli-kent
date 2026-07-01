import express from 'express'
import multer from 'multer'
import cloudinary from '../config/cloudinary.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB supports video
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
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided' })
      }

      const result = await uploadToCloudinary(req.file.buffer, 'varlikent')
      res.status(201).json({
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
      })
    } catch (err) {
      next(err)
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
