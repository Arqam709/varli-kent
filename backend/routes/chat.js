//chat.js
import express from 'express'
import { parsePropertyMessageWithGemini } from '../utils/geminiPropertyParser.js'
import { handleLeadFlow } from '../services/chatLeadFlow.js'
import { recordChatExchange } from '../services/chatPersistence.js'
import { optionalAuth } from '../middleware/auth.js'
import ChatConversation from '../models/ChatConversation.js'
import mongoose from 'mongoose'
import {
  buildMustHaveFeatureFilter,
  buildMongoFilter,
} from '../services/chatFilters.js'
import {
  normalizeParsed,
  keywordFallbackParser,
  applyRawTextPropertyTypeSignals,
} from '../services/chatMessageParsing.js'
import {
  buildNonPropertyReply,
  shouldSkipGeminiAskQuestion,
  buildMissingInfoQuestion,
  buildReply,
  getRelaxedFeatureLabels,
  buildMatchReason,
} from '../services/chatReplyBuilder.js'

import { runPropertySearch } from '../services/chatPropertySearch.js'
import {
  isShowMoreRequest,
  messageHasNewCriteria,
  resolveConversationState,
} from '../services/chatConversationMemory.js'
import { handleDistrictScopeClarification } from '../services/chatDistrictScope.js'

const router = express.Router()

// ─── Main route ───────────────────────────────────────────────────────────────
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const {
      message,
      pageKey,
      history = [],
      currentFilters = {},
      shownPropertyIds = [],
      lastShownProperties = [],
      conversationId = null,
    } = req.body

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      })
    }

    // Fast ownership check, before any Gemini/search work runs. Anonymous
    // requests never reach here with persistence in play (every call site
    // below is already gated on req.user), so a client-supplied
    // conversationId is only ever validated — never trusted or used — when
    // req.user exists.
    if (req.user && conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ success: false, message: 'Invalid conversation id' })
      }

      const ownsConversation = await ChatConversation.exists({ _id: conversationId, user: req.user._id })

      if (!ownsConversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' })
      }
    }

    const isPropertyPage =
      !pageKey ||
      pageKey === 'properties' ||
      pageKey === 'sale' ||
      pageKey === 'rent' ||
      pageKey.startsWith('/properties/')

    if (!isPropertyPage) {
      const nonPropertyPageReply = 'For now, I can help with property searches. Service pages will be supported soon.'
      let responseConversationId = null

      if (req.user) {
        const persistenceResult = await recordChatExchange({
          userId: req.user._id,
          conversationId,
          pageKey,
          userMessageText: message,
          assistantReplyText: nonPropertyPageReply,
          propertyIds: [],
          event: null,
          history,
          parsed: null,
          lead: null,
        })
        responseConversationId = persistenceResult.conversationId || conversationId || null
      }

      return res.json({
        success: true,
        reply: nonPropertyPageReply,
        properties: [],
        parsed: currentFilters,
        conversationId: responseConversationId,
      })
    }

    // ChatContext usually sends history including current message.
    // We remove the current message before passing history to Gemini.
    const historyWithoutCurrentMessage = Array.isArray(history)
      ? history.slice(0, -1)
      : []

    // 1. Parse only the latest user message
    let parsedFromMessage = await parsePropertyMessageWithGemini(
      message,
      historyWithoutCurrentMessage
    )

    const aiUsed = Boolean(parsedFromMessage)

    // 2. If Gemini fails, use keyword fallback
    if (!parsedFromMessage) {
      parsedFromMessage = keywordFallbackParser(message)
    }

    // 3. Normalize and extract simple budget numbers
    parsedFromMessage = normalizeParsed(parsedFromMessage, message)

    // 3b. Override with deterministically-detected multiple/uncertain
    // property types or a "show residential properties" request — neither
    // Gemini nor keywordFallbackParser can express these in a single
    // propertyType field, so this always wins over whatever they guessed.
    applyRawTextPropertyTypeSignals(parsedFromMessage, message)

    // 4. Merge previous search memory with the latest message, resolve
    // fresh-search/continuation/concept-switch state — all conversation-
    // memory decisions now live in chatConversationMemory.js.
    let { parsed, newLifestyleConceptsInMessage } = resolveConversationState({
      message,
      currentFilters,
      parsedFromMessage,
    })

// ─── District scope clarification (Phase D, slice 1) ──────────────────
// Resolve a pending clarification from a prior turn, or ask a new one if
// this message just introduced a lifestyle concept while an old,
// unconfirmed district is still active. Decision logic now lives in
// services/chatDistrictScope.js — chat.js only reacts to the result.
const districtScopeResult = handleDistrictScopeClarification({
  message,
  currentFilters,
  parsedFromMessage,
  parsed,
  newLifestyleConceptsInMessage,
})

parsed = districtScopeResult.parsed

if (districtScopeResult.handled) {
  let responseConversationId = null

  if (req.user) {
    const persistenceResult = await recordChatExchange({
      userId: req.user._id,
      conversationId,
      pageKey,
      userMessageText: message,
      assistantReplyText: districtScopeResult.reply,
      propertyIds: [],
      event: districtScopeResult.event,
      history,
      parsed,
      lead: null,
    })
    responseConversationId = persistenceResult.conversationId || conversationId || null
  }

  return res.json({
    success: true,
    reply: districtScopeResult.reply,
    properties: [],
    parsed: {
      ...parsed,
      pendingClarification: districtScopeResult.pendingClarification,
    },
    filterUsed: null,
    exactMatch: null,
    aiUsed,
    conversationId: responseConversationId,
  })
}

    // 5. Page context wins
    if (pageKey === 'sale') parsed.listingType = 'Sale'
    if (pageKey === 'rent') parsed.listingType = 'Rent'

    // 5b. Lead capture — fully delegated to services/chatLeadFlow.js so this
    // route doesn't keep growing with lead-flow logic. It owns its own
    // state machine (collecting/confirming/submitted), confirmation,
    // corrections, and the actual save — chat.js just reacts to the result.
    const leadResult = await handleLeadFlow({
      message,
      parsed,
      parsedFromMessage,
      currentFilters,
      pageKey,
      lastShownProperties,
    })

    if (leadResult.handled) {
      const hadPendingLeadBefore = ['collecting', 'confirming', 'clarifying_property'].includes(
        currentFilters?.pendingLead?.status
      )
      const leadJustCaptured = leadResult.pendingLead?.status === 'submitted'
      const leadFlowEvent = leadJustCaptured
        ? 'lead_captured'
        : !hadPendingLeadBefore && leadResult.pendingLead
        ? 'lead_flow_started'
        : null

      let responseConversationId = null

      if (req.user) {
        const persistenceResult = await recordChatExchange({
          userId: req.user._id,
          conversationId,
          pageKey,
          userMessageText: message,
          assistantReplyText: leadResult.reply,
          propertyIds: [],
          event: leadFlowEvent,
          history,
          parsed,
          // ContactSubmission id isn't returned by chatLeadFlow.js yet, so the
          // lead reference can't be linked here even on 'lead_captured' — a
          // known follow-up, not something to fix as part of this wiring.
          lead: null,
        })
        responseConversationId = persistenceResult.conversationId || conversationId || null
      }

      return res.json({
        success: true,
        reply: leadResult.reply,
        properties: [],
        parsed: { ...parsed, pendingLead: leadResult.pendingLead ?? null },
        filterUsed: null,
        exactMatch: null,
        aiUsed,
        conversationId: responseConversationId,
      })
    }

    if ('pendingLead' in leadResult) {
      // An in-progress lead was just abandoned (fresh search detected) —
      // clear it explicitly so it can't silently resurface on a later turn.
      parsed.pendingLead = leadResult.pendingLead
    }

    const nonPropertyReply = buildNonPropertyReply(parsed)

if (nonPropertyReply) {
  let responseConversationId = null

  if (req.user) {
    const persistenceResult = await recordChatExchange({
      userId: req.user._id,
      conversationId,
      pageKey,
      userMessageText: message,
      assistantReplyText: nonPropertyReply,
      propertyIds: [],
      event: null,
      history,
      parsed,
      lead: null,
    })
    responseConversationId = persistenceResult.conversationId || conversationId || null
  }

  return res.json({
    success: true,
    reply: nonPropertyReply,
    properties: [],
    parsed,
    filterUsed: null,
    exactMatch: null,
    aiUsed,
    conversationId: responseConversationId,
  })
}

if (parsed.replyType === 'ask_question' && parsed.nextQuestion && !shouldSkipGeminiAskQuestion(parsed)) {
  let responseConversationId = null

  if (req.user) {
    const persistenceResult = await recordChatExchange({
      userId: req.user._id,
      conversationId,
      pageKey,
      userMessageText: message,
      assistantReplyText: parsed.nextQuestion,
      propertyIds: [],
      event: 'clarification_requested',
      history,
      parsed,
      lead: null,
    })
    responseConversationId = persistenceResult.conversationId || conversationId || null
  }

  return res.json({
    success: true,
    reply: parsed.nextQuestion,
    properties: [],
    parsed,
    filterUsed: null,
    exactMatch: null,
    aiUsed,
    conversationId: responseConversationId,
  })
}

    console.log('Message:', message)
    console.log('Parsed from current message:', parsedFromMessage)
    console.log('Old filters from frontend:', currentFilters)
    console.log('Final merged parsed:', parsed)

    // 6. Ask only if important info is still missing after merging memory
    const missingQuestion = buildMissingInfoQuestion(parsed, message)

    if (missingQuestion) {
      let responseConversationId = null

      if (req.user) {
        const persistenceResult = await recordChatExchange({
          userId: req.user._id,
          conversationId,
          pageKey,
          userMessageText: message,
          assistantReplyText: missingQuestion,
          propertyIds: [],
          event: 'clarification_requested',
          history,
          parsed,
          lead: null,
        })
        responseConversationId = persistenceResult.conversationId || conversationId || null
      }

      return res.json({
        success: true,
        reply: missingQuestion,
        properties: [],
        parsed,
        conversationId: responseConversationId,
        filterUsed: null,
        exactMatch: null,
        aiUsed,
      })
    }

    // 7. Build MongoDB filter and search
    const filter = buildMongoFilter(parsed)

    // mustHave is strict: enforce it as a real hard filter now, and carry it
    // through every fallback relaxation step below (niceToHave stays soft —
    // it is only used as a text-search signal, not a hard requirement, for now).
    const mustHaveFilter = buildMustHaveFeatureFilter(parsed.mustHave)
    Object.assign(filter, mustHaveFilter)

    // Feature toggles requested directly (not via mustHave) that fallback is
    // allowed to drop — used only to tell the visitor honestly if that happens.
    const relaxedFeatureLabels = getRelaxedFeatureLabels(parsed, mustHaveFilter)

    // Only exclude previously shown properties on a plain "show me more"
    // continuation. If this message itself introduces new/changed criteria,
    // treat it as a fresh search and let previously shown properties reappear.
    const isShowMore = isShowMoreRequest(message)
    const isFreshSearch = !isShowMore && messageHasNewCriteria(parsedFromMessage)

    const validShownPropertyIds = isShowMore && Array.isArray(shownPropertyIds)
  ? shownPropertyIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
  : []

if (validShownPropertyIds.length > 0) {
  filter._id = { $nin: validShownPropertyIds }
}

    console.log('Filter:', JSON.stringify(filter, null, 2))

let {
  properties,
  fallbackLevel,
  matchedViaDescription,
  matchedViaSemantic,
  descriptionSearchAttempted,
  descriptionSearchUsed,
  descriptionSearchQuery,
  descriptionSearchError,
} = await runPropertySearch({ parsed, filter, mustHaveFilter, message })

// Attach a short, deterministic "why this matches you" reason to each
// property — computed from real property fields + the parsed filters that
// were actually used, never from Gemini.
properties = properties.map((property) => {
  const plain = typeof property.toObject === 'function' ? property.toObject() : property

  return {
    ...plain,
    matchReason: buildMatchReason(plain, parsed, matchedViaDescription, matchedViaSemantic),
  }
})

const reply = buildReply({
  properties,
  fallbackLevel,
  parsed,
  matchedViaDescription,
  matchedViaSemantic,
  descriptionSearchAttempted,
  relaxedFeatureLabels,
})

let responseConversationId = null

if (req.user) {
  const persistenceResult = await recordChatExchange({
    userId: req.user._id,
    conversationId,
    pageKey,
    userMessageText: message,
    assistantReplyText: reply,
    propertyIds: properties.map((property) => property._id),
    event: properties.length > 0 ? 'properties_shown' : 'no_results',
    history,
    parsed,
    lead: null,
  })
  responseConversationId = persistenceResult.conversationId || conversationId || null
}

    return res.json({
  success: true,
  reply,
  properties,
  parsed,
  filterUsed: filter,
  descriptionSearchUsed,
  descriptionSearchQuery,
  descriptionSearchError,
  exactMatch: fallbackLevel === 0,
  aiUsed,
  conversationId: responseConversationId,
})
  } catch (err) {
    next(err)
  }
})

export default router
