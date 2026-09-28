import express from 'express'
import mongoose from 'mongoose'
import ServiceRequest from '../models/ServiceRequest.js'
import ContactSubmission from '../models/ContactSubmission.js'
import { protect } from '../middleware/auth.js'
import { receiveServiceRequest } from '../middleware/serviceRequestUpload.js'
import { normalizeRoomPhoto, RoomPhotoError } from '../services/designRoomPhotos/imagePipeline.js'
import { validateServiceRequestPayload } from '../services/serviceRequests/validation.js'
import { resolveRequestDesign, ServiceRequestDesignError } from '../services/serviceRequests/design.js'
import {
  copyAssetToRequest,
  destroyServiceRequestPhotos,
  openServiceRequestPhotoStream,
  serviceRequestPhotoPublicId,
  SERVICE_REQUEST_PHOTO_CONTENT_TYPE,
  SERVICE_REQUEST_PHOTO_FORMAT,
  uploadServiceRequestPhoto,
} from '../services/serviceRequests/storage.js'
import {
  publicServiceRequest,
  requestStatusFor,
  serviceRequestEmailDetails,
  serviceRequestSummary,
  verifyStaffPhotoLink,
} from '../services/serviceRequests/presentation.js'
import { sendContactNotification } from '../utils/email.js'
import {
  SERVICE_REQUEST_CONTACT_INTEREST,
  SERVICE_REQUEST_PAGE_SIZE,
  SERVICE_REQUEST_PHOTO_DELIVERY_TYPE,
} from '../config/serviceRequests.js'

// Structured Interior Design and Renovation requests from the mobile app.
//
// ── Ownership ────────────────────────────────────────────────────────────
// Every customer route is behind `protect`, and every query carries
// `user: req.user._id`: another customer's request, a malformed id and a
// missing id all answer the same 404. Any design a request attaches is looked
// up the same way (services/serviceRequests/design.js), so a guessed board or
// visualization id cannot be attached.
//
// ── The lead ─────────────────────────────────────────────────────────────
// A request does not bypass Varlikent's workflow. Each one creates exactly ONE
// ordinary ContactSubmission under the existing Interior Design / Renovation
// interest, which the unchanged admin Messages page lists and whose LeadRouting
// recipients get the usual lead email — with a structured block added. There is
// no second notification path.

const router = express.Router()

const DAY_MS = 24 * 60 * 60 * 1000
/** Submits per customer per day; a lead form, not an upload endpoint. */
export const SERVICE_REQUEST_MAX_PER_DAY = 10

const NOT_FOUND = 'Request not found'
const notFound = (res) => res.status(404).json({ success: false, message: NOT_FOUND })
const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ success: false, code, message, ...extra })

const isObjectId = (value) => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)

/** One request's status from its linked ContactSubmission. */
const statusOf = async (request) => {
  if (!request.contactSubmission) return 'submitted'
  const submission = await ContactSubmission.findById(request.contactSubmission).select('status').lean()
  return requestStatusFor(request, new Map(submission ? [[String(submission._id), submission.status]] : []))
}

const respondWithExisting = async (res, request) =>
  res.status(200).json({ success: true, duplicate: true, request: publicServiceRequest(request, await statusOf(request)) })

/* ───────────────────────── Submit ───────────────────────── */

// POST /api/service-requests — multipart: `payload` (JSON) + up to 6 `photos`,
// or plain JSON when there are no photos.
router.post('/', protect, receiveServiceRequest, async (req, res, next) => {
  const files = req.files ?? []
  const userId = req.user._id

  try {
    const { errors, value } = validateServiceRequestPayload(req.serviceRequestPayload)
    if (errors.length > 0) {
      return fail(res, 400, 'VALIDATION_FAILED', 'Please check the request details.', { errors })
    }

    // A retried submit (lost response, double tap) returns what it already made.
    const existing = await ServiceRequest.findOne({ user: userId, idempotencyKey: value.idempotencyKey })
    if (existing) return respondWithExisting(res, existing)

    const today = await ServiceRequest.countDocuments({ user: userId, createdAt: { $gte: new Date(Date.now() - DAY_MS) } })
    if (today >= SERVICE_REQUEST_MAX_PER_DAY) {
      return fail(res, 429, 'REQUEST_DAILY_LIMIT', 'You have sent several requests today. Please try again tomorrow.')
    }

    // Ownership of any design BEFORE a single byte is stored.
    const design = value.type === 'interior_design'
      ? await resolveRequestDesign({ userId, ...value.designRefs })
      : null

    // Every customer photo is validated and re-encoded (EXIF stripped) before
    // anything is uploaded, so a bad fifth photo never leaves four stored.
    const normalized = []
    for (const file of files) {
      normalized.push(await normalizeRoomPhoto(file.buffer))
      file.buffer = null
    }

    const requestId = new mongoose.Types.ObjectId()
    const photos = []
    try {
      for (const image of design?.images ?? []) {
        const photoId = new mongoose.Types.ObjectId()
        const stored = await copyAssetToRequest(image, serviceRequestPhotoPublicId(requestId, photoId))
        photos.push({
          _id: photoId,
          kind: image.kind,
          publicId: stored.publicId,
          deliveryType: SERVICE_REQUEST_PHOTO_DELIVERY_TYPE,
          format: SERVICE_REQUEST_PHOTO_FORMAT,
          width: image.width,
          height: image.height,
          bytes: stored.bytes,
        })
      }
      for (const photo of normalized) {
        const photoId = new mongoose.Types.ObjectId()
        const stored = await uploadServiceRequestPhoto(serviceRequestPhotoPublicId(requestId, photoId), photo.buffer)
        photos.push({
          _id: photoId,
          kind: 'customer',
          publicId: stored.publicId,
          deliveryType: SERVICE_REQUEST_PHOTO_DELIVERY_TYPE,
          format: SERVICE_REQUEST_PHOTO_FORMAT,
          width: photo.width,
          height: photo.height,
          bytes: photo.bytes,
        })
      }
    } catch {
      await destroyServiceRequestPhotos(photos)
      return fail(res, 502, 'PHOTO_STORAGE_FAILED', 'Your photos could not be saved. Please try again.')
    }

    let request
    try {
      request = await ServiceRequest.create({
        _id: requestId,
        user: userId,
        type: value.type,
        contact: value.contact,
        property: value.property,
        budget: value.budget,
        timeline: value.timeline,
        notes: value.notes,
        interiorDesign: value.interiorDesign ? { ...value.interiorDesign, design: design?.design ?? null } : null,
        renovation: value.renovation,
        photos,
        idempotencyKey: value.idempotencyKey,
      })
    } catch (err) {
      await destroyServiceRequestPhotos(photos)
      // Two identical submits raced past the lookup above: return the winner.
      if (err?.code === 11000) {
        const winner = await ServiceRequest.findOne({ user: userId, idempotencyKey: value.idempotencyKey })
        if (winner) return respondWithExisting(res, winner)
      }
      throw err
    }

    // The lead. If it cannot be recorded, the request is rolled back entirely:
    // a request nobody at Varlikent can see would be worse than a failed submit
    // the customer can simply retry.
    let submission
    try {
      submission = await ContactSubmission.create({
        name: value.contact.name,
        email: value.contact.email,
        phone: value.contact.phone,
        interestType: SERVICE_REQUEST_CONTACT_INTEREST[value.type],
        message: serviceRequestSummary(request),
        source: 'mobile',
      })
      await ServiceRequest.updateOne({ _id: request._id }, { $set: { contactSubmission: submission._id } })
      request.contactSubmission = submission._id
    } catch (err) {
      await ServiceRequest.deleteOne({ _id: request._id })
      await destroyServiceRequestPhotos(photos)
      throw err
    }

    // The same notification every lead gets, plus the structured block. Its own
    // failures are swallowed (utils/email.js): the request is already stored.
    await sendContactNotification(submission, serviceRequestEmailDetails(request))

    res.status(201).json({ success: true, request: publicServiceRequest(request, 'submitted') })
  } catch (err) {
    for (const file of files) file.buffer = null
    if (err instanceof ServiceRequestDesignError) return fail(res, err.status, err.code, err.message)
    if (err instanceof RoomPhotoError) return fail(res, err.status, err.code, err.message)
    next(err)
  }
})

/* ───────────────────────── Staff photo link ───────────────────────── */

// GET /api/service-requests/staff-photos/:requestId/:photoId?expires=&sig=
//
// The link in a lead email. Not behind `protect`: whoever holds a valid,
// unexpired signature for exactly this photo may see it, for 30 days. Anything
// else — a bad or expired signature, another photo, a missing request — is the
// same 404. Only issued when PUBLIC_API_URL is configured.
router.get('/staff-photos/:requestId/:photoId', async (req, res, next) => {
  try {
    const { requestId, photoId } = req.params
    const { expires, sig } = req.query
    if (!isObjectId(requestId) || !isObjectId(photoId)) return notFound(res)
    if (!verifyStaffPhotoLink(requestId, photoId, expires, sig)) return notFound(res)

    const request = await ServiceRequest.findById(requestId).select('photos')
    const photo = request?.photos?.id(photoId)
    if (!photo) return notFound(res)
    return streamPhoto(res, photo)
  } catch (err) {
    next(err)
  }
})

/* ───────────────────────── The owner's requests ───────────────────────── */

// GET /api/service-requests — the caller's requests, newest first.
router.get('/', protect, async (req, res, next) => {
  try {
    const requests = await ServiceRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(SERVICE_REQUEST_PAGE_SIZE)

    // One query for every status, never one per row.
    const submissionIds = requests.map((request) => request.contactSubmission).filter(Boolean)
    const submissions = submissionIds.length
      ? await ContactSubmission.find({ _id: { $in: submissionIds } }).select('status').lean()
      : []
    const statusById = new Map(submissions.map((submission) => [String(submission._id), submission.status]))

    res.json({
      success: true,
      count: requests.length,
      requests: requests.map((request) => publicServiceRequest(request, requestStatusFor(request, statusById))),
    })
  } catch (err) {
    next(err)
  }
})

const findOwnedRequest = (req, id) => ServiceRequest.findOne({ _id: id, user: req.user._id })

// GET /api/service-requests/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res)
    const request = await findOwnedRequest(req, req.params.id)
    if (!request) return notFound(res)
    res.json({ success: true, request: publicServiceRequest(request, await statusOf(request)) })
  } catch (err) {
    next(err)
  }
})

// GET /api/service-requests/:id/photos/:photoId — the image, for its owner only.
router.get('/:id/photos/:photoId', protect, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id) || !isObjectId(req.params.photoId)) return notFound(res)
    const request = await findOwnedRequest(req, req.params.id)
    const photo = request?.photos?.id(req.params.photoId)
    if (!photo) return notFound(res)
    return streamPhoto(res, photo)
  } catch (err) {
    next(err)
  }
})

async function streamPhoto(res, photo) {
  let image
  try {
    image = await openServiceRequestPhotoStream(photo)
  } catch {
    return fail(res, 502, 'PHOTO_UNAVAILABLE', 'This photo is temporarily unavailable.')
  }

  res.status(200)
  res.set({
    'Content-Type': SERVICE_REQUEST_PHOTO_CONTENT_TYPE,
    // A private image: no shared cache may keep it.
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  })
  if (image.contentLength) res.set('Content-Length', String(image.contentLength))
  image.stream.on('error', () => res.destroy())
  image.stream.pipe(res)
}

export default router
