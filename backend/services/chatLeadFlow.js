// backend/services/chatLeadFlow.js
//
// Lead conversation state machine:
//   clarifying_property (only if multiple properties were just shown)
//     -> collecting -> confirming -> submitted
// Orchestrates the pure helpers in utils/leadCapture.js, resolves property
// context, and performs the actual save (ONLY after the visitor confirms)
// through the existing ContactSubmission model + email notification — the
// exact same path the Contact page already uses. routes/chat.js only calls
// handleLeadFlow() and reacts to the result; it does not contain any of
// this logic itself.

import mongoose from 'mongoose'
import Property from '../models/Property.js'
import ContactSubmission from '../models/ContactSubmission.js'
import { sendContactNotification } from '../utils/email.js'
import {
  detectLeadIntent,
  detectConfirmationIntent,
  detectCancellationIntent,
  extractEmail,
  extractPhone,
  extractNameFromPhrase,
  extractBareName,
  extractPreferredTime,
  getMissingLeadFields,
  buildMissingFieldsQuestion,
  buildConfirmationSummary,
  buildLeadMessage,
  buildInterestType,
  resolveOrdinalIndex,
  buildPropertyDisambiguationQuestion,
} from '../utils/leadCapture.js'

// Same field list buildMongoFilter/messageHasNewCriteria in chat.js watch —
// duplicated narrowly here rather than imported, so this service doesn't
// reach into the route file's internals for what's otherwise a five-line
// check.
const CRITERIA_CHECK_FIELDS = [
  'listingType', 'propertyType', 'district', 'beds', 'baths',
  'minPrice', 'maxPrice', 'minSqm', 'maxSqm',
  'furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking', 'descriptionQuery',
]

const messageIntroducesSearchCriteria = (parsedFromMessage = {}) => {
  const hasScalarCriteria = CRITERIA_CHECK_FIELDS.some((field) => {
    const value = parsedFromMessage[field]
    return value !== null && value !== undefined && value !== ''
  })

  const hasArrayCriteria = ['districts', 'lifestyle', 'mustHave', 'niceToHave', 'requirements'].some(
    (field) => Array.isArray(parsedFromMessage[field]) && parsedFromMessage[field].length > 0
  )

  return hasScalarCriteria || hasArrayCriteria
}

const resolvePropertyFromPage = async (pageKey) => {
  if (typeof pageKey !== 'string' || !pageKey.startsWith('/properties/')) return null

  const propertyId = pageKey.replace('/properties/', '')
  if (!mongoose.Types.ObjectId.isValid(propertyId)) return null

  const propertyDoc = await Property.findById(propertyId).select('title')
  if (!propertyDoc) return null

  return { propertyId: String(propertyDoc._id), propertyTitle: propertyDoc.title }
}

const submitLead = async (pendingLead, parsed) => {
  try {
    const submission = await ContactSubmission.create({
      name: pendingLead.name,
      email: pendingLead.email,
      phone: pendingLead.phone,
      interestType: buildInterestType(parsed),
      message: buildLeadMessage({ pendingLead, parsed, message: pendingLead.originalMessage }),
      source: 'ai_assistant',
    })

    await sendContactNotification(submission)

    return {
      handled: true,
      reply: `Thank you, ${pendingLead.name}! I've passed your details to our team and they will reach out to you at ${pendingLead.phone} soon.`,
      pendingLead: { ...pendingLead, status: 'submitted' },
    }
  } catch (err) {
    console.log('Chatbot lead submission failed:', err.message)

    return {
      handled: true,
      reply:
        "I collected your details but couldn't save them just now — please try the contact form or WhatsApp instead, and our team will assist you.",
      pendingLead: { ...pendingLead, status: 'confirming' },
    }
  }
}

// Extracts whatever contact details are present in `message`, merges them
// into `base`, and decides whether to ask for what's still missing or
// advance to the confirmation summary. Shared by the fresh-entry path and
// the post-disambiguation path (both land here once a property, if any, is
// resolved).
const continueCollecting = ({ base, message, parsed, hasNewLeadIntent }) => {
  const pendingLead = { ...base, status: 'collecting' }

  const newEmail = extractEmail(message)
  const newPhone = extractPhone(message)
  const newName = extractNameFromPhrase(message)
  const newTime = extractPreferredTime(message)

  if (newEmail) pendingLead.email = newEmail
  if (newPhone) pendingLead.phone = newPhone
  if (newName) pendingLead.name = newName
  if (newTime) pendingLead.preferredTime = newTime

  // Bare-word name fallback ("arqam" alone, or "arqam 5013... arqam@...")
  // only applies while a name is still missing and this message didn't
  // itself express fresh lead intent — so a leftover phrase like "this
  // available" (or, after disambiguation, "the first one") can't be
  // misread as a name.
  if (!pendingLead.name && !hasNewLeadIntent) {
    const bareName = extractBareName(message)
    if (bareName) pendingLead.name = bareName
  }

  const missingFields = getMissingLeadFields(pendingLead)

  if (missingFields.length > 0) {
    return { handled: true, reply: buildMissingFieldsQuestion(missingFields, pendingLead.propertyTitle), pendingLead }
  }

  pendingLead.status = 'confirming'

  return { handled: true, reply: buildConfirmationSummary(pendingLead, parsed), pendingLead }
}

// req.body.currentFilters/pageKey/message/lastShownProperties and the
// already-computed parsed/parsedFromMessage from chat.js are the only
// inputs needed. Returns { handled: false } (nothing to do — fall through
// to search), { handled: false, pendingLead: null } (an in-progress lead
// was just abandoned — chat.js should clear it before continuing), or
// { handled: true, reply, pendingLead } (lead flow produced the reply).
export const handleLeadFlow = async ({
  message,
  parsed,
  parsedFromMessage,
  currentFilters,
  pageKey,
  lastShownProperties = [],
}) => {
  const PENDING_STATUSES = ['collecting', 'confirming', 'clarifying_property']

  const existingPendingLead =
    currentFilters?.pendingLead && PENDING_STATUSES.includes(currentFilters.pendingLead.status)
      ? currentFilters.pendingLead
      : null

  const hasNewLeadIntent = detectLeadIntent(message, parsedFromMessage)

  const looksLikeFreshSearch =
    !hasNewLeadIntent &&
    messageIntroducesSearchCriteria(parsedFromMessage) &&
    !extractEmail(message) &&
    !extractPhone(message)

  const shouldEnterLeadFlow = hasNewLeadIntent || (existingPendingLead && !looksLikeFreshSearch)

  if (!shouldEnterLeadFlow) {
    return existingPendingLead ? { handled: false, pendingLead: null } : { handled: false }
  }

  // ─── Clarifying which property (only reached if multiple were shown) ───
  if (existingPendingLead?.status === 'clarifying_property') {
    const candidates = existingPendingLead.candidateProperties || []
    const index = resolveOrdinalIndex(message)

    if (index >= 0 && index < candidates.length) {
      const chosen = candidates[index]
      return continueCollecting({
        base: {
          name: null,
          phone: null,
          email: null,
          preferredTime: null,
          propertyId: chosen._id,
          propertyTitle: chosen.title,
          originalMessage: existingPendingLead.originalMessage,
        },
        message,
        parsed,
        hasNewLeadIntent,
      })
    }

    return {
      handled: true,
      reply: buildPropertyDisambiguationQuestion(candidates),
      pendingLead: existingPendingLead,
    }
  }

  // ─── Confirming: awaiting yes / no / a correction ─────────────────────
  if (existingPendingLead?.status === 'confirming') {
    if (detectCancellationIntent(message)) {
      return {
        handled: true,
        reply: "No problem — I won't send these details. Let me know if you change your mind.",
        pendingLead: null,
      }
    }

    if (detectConfirmationIntent(message)) {
      return submitLead(existingPendingLead, parsed)
    }

    // Not a clear yes/no — check for a correction. Name corrections require
    // an explicit trigger phrase here (not the bare-word fallback), since a
    // stray short reply during confirmation is more likely a typo/unclear
    // answer than a deliberate name correction.
    const updated = { ...existingPendingLead }
    let changed = false

    const correctedEmail = extractEmail(message)
    const correctedPhone = extractPhone(message)
    const correctedName = extractNameFromPhrase(message)
    const correctedTime = extractPreferredTime(message)

    if (correctedEmail && correctedEmail !== updated.email) { updated.email = correctedEmail; changed = true }
    if (correctedPhone && correctedPhone !== updated.phone) { updated.phone = correctedPhone; changed = true }
    if (correctedName && correctedName !== updated.name) { updated.name = correctedName; changed = true }
    if (correctedTime && correctedTime !== updated.preferredTime) { updated.preferredTime = correctedTime; changed = true }

    if (changed) {
      return { handled: true, reply: buildConfirmationSummary(updated, parsed), pendingLead: updated }
    }

    return {
      handled: true,
      reply: `Sorry, I didn't quite catch that. ${buildConfirmationSummary(existingPendingLead, parsed)}`,
      pendingLead: existingPendingLead,
    }
  }

  // ─── Collecting: resolve property context, then gather missing fields ──
  if (existingPendingLead?.propertyId) {
    return continueCollecting({
      base: { ...existingPendingLead },
      message,
      parsed,
      hasNewLeadIntent,
    })
  }

  const resolvedProperty = await resolvePropertyFromPage(pageKey)

  if (!resolvedProperty && !existingPendingLead) {
    if (lastShownProperties.length === 1) {
      const only = lastShownProperties[0]
      return continueCollecting({
        base: {
          name: null, phone: null, email: null, preferredTime: null,
          propertyId: only._id, propertyTitle: only.title,
          originalMessage: message,
        },
        message,
        parsed,
        hasNewLeadIntent,
      })
    }

    if (lastShownProperties.length > 1) {
      return {
        handled: true,
        reply: buildPropertyDisambiguationQuestion(lastShownProperties),
        pendingLead: {
          name: null, phone: null, email: null, preferredTime: null,
          propertyId: null, propertyTitle: null,
          originalMessage: message,
          status: 'clarifying_property',
          candidateProperties: lastShownProperties,
        },
      }
    }
  }

  return continueCollecting({
    base: {
      name: existingPendingLead?.name || null,
      phone: existingPendingLead?.phone || null,
      email: existingPendingLead?.email || null,
      preferredTime: existingPendingLead?.preferredTime || null,
      propertyId: resolvedProperty?.propertyId || null,
      propertyTitle: resolvedProperty?.propertyTitle || null,
      originalMessage: existingPendingLead?.originalMessage || message,
    },
    message,
    parsed,
    hasNewLeadIntent,
  })
}
