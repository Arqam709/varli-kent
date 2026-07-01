import express from 'express'
import Property from '../models/Property.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'

const router = express.Router()

// GET /api/properties
router.get('/', async (req, res, next) => {
  try {
    const {
      listingType, district, minPrice, maxPrice, propertyType, beds, baths, featured,
      rooms, minSqm, maxSqm, floor, totalFloors, heating, parking, buildingAge,
      furnished, balcony, elevator, pool, garden,
    } = req.query
    const filter = {}

    if (listingType) filter.listingType = listingType
    if (district) filter.district = district
    if (propertyType) filter.propertyType = propertyType
    if (beds) filter.beds = Number(beds)
    if (baths) filter.baths = Number(baths)
    if (featured !== undefined) filter.featured = featured === 'true'
    if (rooms) filter.rooms = rooms
    if (floor) filter.floor = Number(floor)
    if (totalFloors) filter.totalFloors = Number(totalFloors)
    if (heating) filter.heating = heating
    if (parking) filter.parking = parking
    if (buildingAge) filter.buildingAge = buildingAge
    if (furnished === 'true') filter.furnished = true
    if (balcony === 'true') filter.balcony = true
    if (elevator === 'true') filter.elevator = true
    if (pool === 'true') filter.pool = true
    if (garden === 'true') filter.garden = true
    if (minPrice || maxPrice) {
      filter.price = {}
      if (minPrice) filter.price.$gte = Number(minPrice)
      if (maxPrice) filter.price.$lte = Number(maxPrice)
    }
    if (minSqm || maxSqm) {
      filter.sqm = {}
      if (minSqm) filter.sqm.$gte = Number(minSqm)
      if (maxSqm) filter.sqm.$lte = Number(maxSqm)
    }

    const properties = await Property.find(filter).sort({ createdAt: -1 })
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/areas - MUST be before /:id
router.get('/areas', async (req, res, next) => {
  try {
    const areas = await Property.aggregate([
      { $group: { _id: '$district', count: { $sum: 1 } } },
      { $match: { count: { $gte: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, district: '$_id', count: 1 } },
    ])
    res.json({ success: true, areas })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/sale - MUST be before /:id
router.get('/sale', async (req, res, next) => {
  try {
    const properties = await Property.find({ listingType: 'Sale' }).sort({ createdAt: -1 })
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/rent - MUST be before /:id
router.get('/rent', async (req, res, next) => {
  try {
    const properties = await Property.find({ listingType: 'Rent' }).sort({ createdAt: -1 })
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/:id
router.get('/:id', async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' })
    }
    res.json({ success: true, property })
  } catch (err) {
    next(err)
  }
})

// POST /api/properties
router.post(
  '/',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('add_listing'),
  async (req, res, next) => {
    try {
      const property = await Property.create(req.body)
      res.status(201).json({ success: true, property })
    } catch (err) {
      next(err)
    }
  }
)

// PUT /api/properties/:id
router.put(
  '/:id',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('edit_listing'),
  async (req, res, next) => {
    try {
      const property = await Property.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      })
      if (!property) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }
      res.json({ success: true, property })
    } catch (err) {
      next(err)
    }
  }
)

// DELETE /api/properties/:id
router.delete(
  '/:id',
  protect,
  requireRole('owner', 'admin'),
  requirePermission('delete_listing'),
  async (req, res, next) => {
    try {
      const property = await Property.findByIdAndDelete(req.params.id)
      if (!property) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }
      res.json({ success: true, message: 'Property deleted' })
    } catch (err) {
      next(err)
    }
  }
)

export default router
