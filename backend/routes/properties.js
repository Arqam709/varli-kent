import express from 'express'
import Property from '../models/Property.js'
import { protect } from '../middleware/auth.js'
import { requireRole, requirePermission } from '../middleware/checkPermission.js'
import { generatePropertyEmbedding, embeddingSourceFieldsChanged } from '../services/propertyEmbeddingService.js'
import { resolveAgentContact, publicAgent, AGENT_POPULATE_FIELDS } from '../services/agentAssignment.js'
// Not called directly — importing it registers the 'User' model with Mongoose,
// which populate('agent') below depends on.
import '../models/User.js'

const router = express.Router()

const PUBLIC_PROPERTY_EXCLUDE = '-descriptionEmbedding -embeddingUpdatedAt'

/**
 * Builds the write payload with every agent-related field decided by the
 * server rather than the browser.
 *
 * req.body cannot be trusted straight through here: `agent` is a pointer to a
 * user document, and `agentEmail` is supposed to belong to that user. Without
 * this, a request could assign Ahmet while storing someone else's address, or
 * leave the previous agent's phone number attached to a new one.
 *
 * `existingProperty` is null on create. Returns null when the assignment was
 * rejected — the caller has already responded.
 */
const applyAgentContact = async (body, res, existingProperty = null) => {
  const resolved = await resolveAgentContact(body, existingProperty)

  if (!resolved.ok) {
    res.status(400).json({ success: false, message: resolved.message })
    return null
  }

  const data = { ...body }

  // Never write the legacy free-text agent name from this route. Existing
  // documents keep whatever they already have — see the Property model.
  delete data.agentName

  // Fields the server refuses to let this request change at all.
  for (const field of resolved.drop) delete data[field]

  // Server-decided values win over anything the client sent.
  Object.assign(data, resolved.changes)

  return data
}

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

    const properties = await Property.find(filter)
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .sort({ createdAt: -1 })
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
    const properties = await Property.find({ listingType: 'Sale' })
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .sort({ createdAt: -1 })
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/rent - MUST be before /:id
router.get('/rent', async (req, res, next) => {
  try {
    const properties = await Property.find({ listingType: 'Rent' })
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .sort({ createdAt: -1 })
    res.json({ success: true, count: properties.length, properties })
  } catch (err) {
    next(err)
  }
})

// GET /api/properties/:id
//
// The one endpoint that populates the assigned agent, because it is the one
// that renders them. The list endpoints deliberately do not — a card shows no
// agent, and populating there would be one lookup per listing for nothing.
// (The raw `agent` id still rides along in the list payload as an ordinary
// field, which is what lets the admin edit form preselect the current agent
// without a second request.)
router.get('/:id', async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
      .select(PUBLIC_PROPERTY_EXCLUDE)
      .populate('agent', AGENT_POPULATE_FIELDS)

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' })
    }

    // publicAgent() is a whitelist, not a trim: role and isActive are fetched
    // only so it can decide whether to show the agent at all, and never reach
    // the response. An agent since deactivated or demoted reads back as null.
    const propertyJson = property.toObject()
    propertyJson.agent = publicAgent(property.agent)

    res.json({ success: true, property: propertyJson })
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
      // Validate the agent BEFORE any other work, so a bad assignment costs
      // nothing and never reaches the database. No existing property on
      // create, so there is no previous agent whose details could go stale.
      let propertyData = await applyAgentContact(req.body, res, null)
      if (!propertyData) return

      try {
        const embeddingResult = await generatePropertyEmbedding(req.body)
        if (embeddingResult) {
          propertyData = { ...propertyData, ...embeddingResult }
        }
      } catch (embeddingErr) {
        console.log('Property embedding generation failed (create):', embeddingErr.message)
      }

      const property = await Property.create(propertyData)
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
      const existingProperty = await Property.findById(req.params.id)
      if (!existingProperty) {
        return res.status(404).json({ success: false, message: 'Property not found' })
      }

      // The existing property is what makes "did the agent actually change?"
      // answerable — which is what decides whether the previous agent's phone
      // and WhatsApp are cleared.
      let updateData = await applyAgentContact(req.body, res, existingProperty)
      if (!updateData) return

      if (embeddingSourceFieldsChanged(existingProperty, req.body)) {
        try {
          const mergedForEmbedding = {
            title: req.body.title ?? existingProperty.title,
            description: req.body.description ?? existingProperty.description,
            district: req.body.district ?? existingProperty.district,
            address: req.body.address ?? existingProperty.address,
          }

          const embeddingResult = await generatePropertyEmbedding(mergedForEmbedding)
          if (embeddingResult) {
            updateData = { ...updateData, ...embeddingResult }
          }
        } catch (embeddingErr) {
          console.log('Property embedding generation failed (update):', embeddingErr.message)
        }
      }

      const property = await Property.findByIdAndUpdate(req.params.id, updateData, {
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
