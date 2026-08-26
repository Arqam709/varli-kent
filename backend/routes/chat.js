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
  renderSlotQuestion,
  buildReply,
  buildMatchReason,
} from '../services/chatReplyBuilder.js'
import { getRelaxedFeatureIds } from '../services/chatReplyPlan.js'
import { createOrRetryPendingQuestion } from '../services/chatPendingQuestion.js'
import { decideTurnAction, decideFollowUp, detectMixedListingTypes } from '../services/chatPolicyEngine.js'
import { normalizeChatLanguage } from '../utils/chatLanguage.js'
import { renderNonPropertyPageReply } from '../services/chatReplyRenderer.js'

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

    // Phase 1 (language plumbing only): validate and normalize, never trust
    // the raw client value. Nothing downstream reads this yet — no reply
    // text, Gemini prompt, or persistence changes in this phase.
    const language = normalizeChatLanguage(req.body.language)

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

    /* Wave 11C — service pages.
     *
     * A visitor reading /architecture or /renovation is exactly the visitor
     * most likely to ask what that service includes, and until now the
     * chatbot answered them with "I can only help with properties on this
     * page". These pageKeys are the ones AIChatbot.jsx sends (note
     * interior_design, underscore — the route is /interior-design but the
     * key is not the path).
     *
     * `contact` is included because the donor includes it and the same
     * reasoning applies: the contact page is where lead intent is highest.
     *
     * Kept as a separate list from isPropertyPage rather than folded into
     * it: nothing downstream should start treating /renovation as a place
     * that forces a listingType the way /sale and /rent do.
     */
    const SERVICE_PAGE_KEYS = ['architecture', 'construction', 'renovation', 'interior_design', 'contact']
    const isServicePage = SERVICE_PAGE_KEYS.includes(pageKey)

    if (!isPropertyPage && !isServicePage) {
      const nonPropertyPageReply = renderNonPropertyPageReply(language)
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
        language,
      })
    }

    // ChatContext usually sends history including current message.
    // We remove the current message before passing history to Gemini.
    const historyWithoutCurrentMessage = Array.isArray(history)
      ? history.slice(0, -1)
      : []

    // 1. Parse only the latest user message. `language` is passed only as a
    // weak interpretive hint inside the prompt (Phase 4) — it never changes
    // canonical output and is not used by anything downstream of parsing.
    let parsedFromMessage = await parsePropertyMessageWithGemini(
      message,
      historyWithoutCurrentMessage,
      language
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
  language,
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
    language,
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
      language,
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
        language,
      })
    }

    if ('pendingLead' in leadResult) {
      // An in-progress lead was just abandoned (fresh search detected) —
      // clear it explicitly so it can't silently resurface on a later turn.
      parsed.pendingLead = leadResult.pendingLead
    }

    const nonPropertyReply = await buildNonPropertyReply(parsed, language, message)

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
    language,
  })
}

    console.log('Message:', message)
    console.log('Parsed from current message:', parsedFromMessage)
    console.log('Old filters from frontend:', currentFilters)
    console.log('Final merged parsed:', parsed)

    // 6. Single authoritative ask-vs-search decision (Phase 4). Replaces the
    // old independent Gemini ask_question branch and buildMissingInfoQuestion
    // branch — those decided routing in isolation; chatPolicyEngine.js is now
    // the only place that decides. Gemini's own replyType/nextQuestion are no
    // longer read for routing here — they are suggestions the engine may
    // disregard (see decideTurnAction's doc comment).
    const isShowMore = isShowMoreRequest(message)

    const turnAction = decideTurnAction({ parsed, pageKey, isShowMore })
    console.log('Policy decision (pre-search):', turnAction.reason)

    if (turnAction.type === 'ask') {
      const questionText = renderSlotQuestion(turnAction.slots, language)

      parsed.pendingQuestion = createOrRetryPendingQuestion(parsed.pendingQuestion, turnAction.slots, parsed.turn)

      let responseConversationId = null

      if (req.user) {
        const persistenceResult = await recordChatExchange({
          userId: req.user._id,
          conversationId,
          pageKey,
          userMessageText: message,
          assistantReplyText: questionText,
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
        reply: questionText,
        properties: [],
        parsed,
        conversationId: responseConversationId,
        filterUsed: null,
        exactMatch: null,
        aiUsed,
        language,
      })
    }

    // 7. Build MongoDB filter and search. turnAction.scope is a presentation
    // hint only — the filter naturally omits listingType/propertyType/
    // district/budget whenever their value is null (deferred/declined
    // transitions already clear the value), so no filter logic changes here.
    const filter = buildMongoFilter(parsed)

    // mustHave is strict: enforce it as a real hard filter now, and carry it
    // through every fallback relaxation step below (niceToHave stays soft —
    // it is only used as a text-search signal, not a hard requirement, for now).
    const mustHaveFilter = buildMustHaveFeatureFilter(parsed.mustHave)
    Object.assign(filter, mustHaveFilter)

    // Feature toggles requested directly (not via mustHave) that fallback is
    // allowed to drop — used only to tell the visitor honestly if that
    // happens. Ids, not labels: language-independent, resolved to a
    // localized word only at render time inside buildReply.
    const relaxedFeatureIds = getRelaxedFeatureIds(parsed, mustHaveFilter)

    // Only exclude previously shown properties on a plain "show me more"
    // continuation. If this message itself introduces new/changed criteria,
    // treat it as a fresh search and let previously shown properties reappear.
    // (isShowMore was already computed above, for the policy engine.)
    const isFreshSearch = !isShowMore && messageHasNewCriteria(parsedFromMessage)

    const validShownPropertyIds = isShowMore && Array.isArray(shownPropertyIds)
  ? shownPropertyIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
  : []

    // Valid _id list from the MOST RECENT shown set (lastShownProperties), for
    // previous-result refinement. shownPropertyIds (all turns) stays reserved
    // for show-more exclusion.
    const validPreviousResultIds = Array.isArray(lastShownProperties)
      ? lastShownProperties.map((p) => p && p._id).filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      : []

    // Scope decision — MUTUALLY EXCLUSIVE, show-more first (both write filter._id,
    // so only one branch may run). resultScopeAction is deterministic backend
    // execution of Gemini's per-turn meaning; no message-word matching here.
    //   scope 'previous_results' → the search is locked inside the shown set.
    // filter._id is preserved by every downstream path (semantic/description
    // hard filters + searchWithFallback steps), so the scope can never leak.
    let resultScope = null
    if (validShownPropertyIds.length > 0) {
      filter._id = { $nin: validShownPropertyIds }
    } else if (parsed.resultScopeAction === 'previous_results' && validPreviousResultIds.length > 0) {
      filter._id = { $in: validPreviousResultIds }
      resultScope = 'previous_results'
    }
    // No previous IDs (fresh conversation, reload, lost client state) → no _id
    // restriction: fall back to a normal global search rather than $in: [].

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
  searchEvidence,
} = await runPropertySearch({ parsed, filter, mustHaveFilter, message })

console.log('Search evidence:', searchEvidence)

// Attach a short, deterministic "why this matches you" reason to each
// property — computed from real property fields + the parsed filters that
// were actually used, never from Gemini.
properties = properties.map((property) => {
  const plain = typeof property.toObject === 'function' ? property.toObject() : property

  return {
    ...plain,
    matchReason: buildMatchReason(plain, parsed, matchedViaDescription, matchedViaSemantic, language),
  }
})

// Phase 4: post-search follow-up decision — the second and only other call
// into the policy engine. suppressFollowUp carries forward from the
// pre-search decision (e.g. a noPreference turn) rather than being
// re-derived, so there is exactly one suppression source, not two.
const mixedListingTypes = detectMixedListingTypes(properties)

const followUpDecision = decideFollowUp(
  { parsed, suppressFollowUp: turnAction.suppressFollowUp === true },
  {
    count: properties.length,
    // searchEvidence.mode is chatPropertySearch.js's machine-readable verdict;
    // 'fallback' = a soft/open-ended requirement was requested but nothing was
    // verified. The policy uses only this abstract outcome, never the message.
    mode: searchEvidence.mode,
    fallbackLevel,
    matchedViaSemantic,
    matchedViaDescription,
    descriptionSearchAttempted,
    mixedListingTypes,
  }
)
console.log('Policy decision (post-search):', followUpDecision.reason)

// When the policy resolved this turn as an unverified soft-requirement
// outcome, it deliberately does NOT continue the hard-slot sequence. Any
// pending slot question left over from an earlier turn is now irrelevant and
// must not survive to trigger a stale retry later. Tied strictly to the
// current search result (softOutcome), never to message vocabulary. Narrow
// and safe: only fallback outcomes set softOutcome, and they always carry
// offerSlot null, so this never clobbers a legitimate in-progress question.
if (followUpDecision.softOutcome) {
  parsed.pendingQuestion = null
}

const reply = buildReply({
  properties,
  fallbackLevel,
  parsed,
  matchedViaDescription,
  matchedViaSemantic,
  descriptionSearchAttempted,
  relaxedFeatureIds,
  resultScope,
  followUp: followUpDecision,
  mixedListingTypes,
  searchEvidence,
  language,
})

if (followUpDecision.offerSlot) {
  parsed.pendingQuestion = createOrRetryPendingQuestion(
    parsed.pendingQuestion,
    [followUpDecision.offerSlot],
    parsed.turn
  )
}

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
  language,
})
  } catch (err) {
    next(err)
  }
})

export default router
