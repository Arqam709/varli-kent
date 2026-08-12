import express from 'express'
import Property from '../models/Property.js'
import { protect } from '../middleware/auth.js'
import { requireRole } from '../middleware/checkPermission.js'

const router = express.Router()


router.use(protect, requireRole('agent'))

const AGENT_PROPERTY_FIELDS = [
  'title',
  'listingType',
  'price',
  'priceLabel',
  'district',
  'propertyType',
  'beds',
  'baths',
  'sqm',
  'mainImage',
  'images',
  'featured',
  'status',
  'createdAt',
].join(' ')

router.get('/properties', async (req, res, next) => {
  try {
    const properties = await Property.find({ agent: req.user._id })
      .select(AGENT_PROPERTY_FIELDS)
      .sort({ createdAt: -1 })

    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

export default router
