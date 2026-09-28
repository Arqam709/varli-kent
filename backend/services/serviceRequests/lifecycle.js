import ServiceRequest from '../../models/ServiceRequest.js'
import { destroyServiceRequestPhotos } from './storage.js'

/**
 * Removes a deleted account's service requests and their private images.
 *
 * Called from the owner's "delete user" route next to the Design My Space
 * cleanup. The LEAD each request created — the ordinary ContactSubmission — is
 * left alone, exactly like a lead sent from the website contact form: it is the
 * company's record of an enquiry, not the customer's account data.
 *
 * Images are destroyed best-effort; a request whose images could not all be
 * removed is still deleted, and the failure is reported to the caller's log.
 */
export async function deleteAllServiceRequestsForUser(userId) {
  const requests = await ServiceRequest.find({ user: userId }).select('photos')
  let assetsRemoved = true
  for (const request of requests) {
    if (!(await destroyServiceRequestPhotos(request.photos ?? []))) assetsRemoved = false
  }
  await ServiceRequest.deleteMany({ user: userId })
  if (!assetsRemoved) {
    console.error('[service-requests] some request images could not be removed from storage', {
      user: String(userId),
    })
  }
  return { deleted: requests.length, assetsRemoved }
}
