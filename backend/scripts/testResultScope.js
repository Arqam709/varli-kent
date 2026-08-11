// backend/scripts/testResultScope.js
//
// Focused, deterministic tests for conversational previous-result refinement
// (resultScopeAction) — no Gemini, no MongoDB, no network.
//
// Covers: the per-turn parser field (enum/defaults/per-turn discipline), the
// conversation-memory merge, the chat.js scope decision (verbatim mirror), the
// _id.$in leak-prevention through the hard-filter builders, and the scope-aware
// reply wording (en/tr/ar).
//
// Usage: node scripts/testResultScope.js

import mongoose from 'mongoose'
import {
  defaultParsed,
  RESULT_SCOPE_ACTIONS,
  PER_TURN_DIALOGUE_FIELDS,
  stripPerTurnFields,
  normalizeParsed,
} from '../services/chatMessageParsing.js'
import { resolveConversationState } from '../services/chatConversationMemory.js'
import { buildHardFilterForDescriptionSearch } from '../services/chatFilters.js'
import { buildSemanticHardFilter } from '../services/propertySemanticSearch.js'
import { buildSearchResultPlan } from '../services/chatReplyPlan.js'
import { buildReply } from '../services/chatReplyBuilder.js'
import { renderSearchResultPlan } from '../services/chatReplyRenderer.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const assertEqual = (label, actual, expected) => {
  if (deepEqual(actual, expected)) { passCount++; console.log(`✓ ${label}`) }
  else { failCount++; console.log(`✗ ${label}`); console.log(`    expected: ${JSON.stringify(expected)}`); console.log(`    actual:   ${JSON.stringify(actual)}`) }
}
const assertTrue = (label, cond) => { if (cond) { passCount++; console.log(`✓ ${label}`) } else { failCount++; console.log(`✗ ${label}`) } }

const oid = () => new mongoose.Types.ObjectId().toString()
const A = oid(), B = oid(), C = oid(), X = oid(), Y = oid()

// ═══════════════════════════════════════════════════════════════════════
// A. Parser field — enum, default, per-turn discipline
// ═══════════════════════════════════════════════════════════════════════
line(); console.log('A. resultScopeAction parser field'); line()
assertEqual('defaultParsed.resultScopeAction is unclear', defaultParsed.resultScopeAction, 'unclear')
assertEqual('RESULT_SCOPE_ACTIONS', RESULT_SCOPE_ACTIONS, ['previous_results', 'new_search', 'unclear'])
assertTrue('resultScopeAction is a per-turn dialogue field', PER_TURN_DIALOGUE_FIELDS.includes('resultScopeAction'))

assertEqual('absent -> unclear', normalizeParsed({}, 'hi').resultScopeAction, 'unclear')
assertEqual('valid previous_results passes', normalizeParsed({ resultScopeAction: 'previous_results' }, 'hi').resultScopeAction, 'previous_results')
assertEqual('valid new_search passes', normalizeParsed({ resultScopeAction: 'new_search' }, 'hi').resultScopeAction, 'new_search')
assertEqual('uppercase invalid -> unclear', normalizeParsed({ resultScopeAction: 'PREVIOUS_RESULTS' }, 'hi').resultScopeAction, 'unclear')
assertEqual('garbage -> unclear', normalizeParsed({ resultScopeAction: 'other' }, 'hi').resultScopeAction, 'unclear')
assertEqual('null -> unclear', normalizeParsed({ resultScopeAction: null }, 'hi').resultScopeAction, 'unclear')
assertEqual('true -> unclear', normalizeParsed({ resultScopeAction: true }, 'hi').resultScopeAction, 'unclear')

{
  const stripped = stripPerTurnFields({ propertyType: 'Apartment', resultScopeAction: 'previous_results' })
  assertTrue('stripPerTurnFields removes resultScopeAction', !('resultScopeAction' in stripped))
  assertEqual('stripPerTurnFields keeps durable propertyType', stripped.propertyType, 'Apartment')
}

// ═══════════════════════════════════════════════════════════════════════
// B. Per-turn merge — never leaks forward; criteria preserved
// ═══════════════════════════════════════════════════════════════════════
line(); console.log('B. per-turn merge + criteria preservation'); line()
{
  // Stale 'previous_results' in round-tripped currentFilters must NOT survive.
  const staleGone = resolveConversationState({
    message: 'show villas in Beşiktaş',
    currentFilters: { resultScopeAction: 'previous_results', turn: 2 },
    parsedFromMessage: { ...defaultParsed, resultScopeAction: 'unclear', propertyType: 'Villa' },
  }).parsed
  assertEqual('B1: stale previous_results + current unclear -> unclear', staleGone.resultScopeAction, 'unclear')

  // Current-turn previous_results wins. Note: cross-turn criteria accumulation
  // is Gemini's job (it echoes the running lifestyle, proven in the prior live
  // trace) — the backend merge takes THIS turn's lifestyle as-is. So we feed the
  // accumulated list Gemini emits and assert the merge does not clear it (Step 11:
  // the new feature changes WHERE we search, not WHAT the criteria mean).
  // Message re-mentions "sea view" (as in the real proven conversation), so the
  // existing concept memory keeps both concepts rather than treating the turn as
  // a concept switch. resultScopeAction is orthogonal to that.
  const current = resolveConversationState({
    message: 'from these apartments with sea view, which are near schools',
    currentFilters: { propertyType: 'Apartment', lifestyle: ['sea view'], turn: 2 },
    parsedFromMessage: { ...defaultParsed, resultScopeAction: 'previous_results', lifestyle: ['sea view', 'near schools'] },
  }).parsed
  assertEqual('B2: current previous_results wins', current.resultScopeAction, 'previous_results')
  assertTrue('B2: sea view preserved alongside near schools', current.lifestyle.includes('sea view') && current.lifestyle.includes('near schools'))

  const absent = resolveConversationState({
    message: 'show me more',
    currentFilters: { resultScopeAction: 'previous_results', turn: 2 },
    parsedFromMessage: { ...defaultParsed },
  }).parsed
  assertEqual('B3: absent current -> unclear', absent.resultScopeAction, 'unclear')
}

// ═══════════════════════════════════════════════════════════════════════
// C. Scope decision (VERBATIM mirror of routes/chat.js) — mutually exclusive
// ═══════════════════════════════════════════════════════════════════════
line(); console.log('C. scope decision ($in / $nin / new / empty)'); line()
// --- mirror of chat.js: show-more wins first; else previous_results $in; else nothing ---
const decideScope = ({ isShowMore = false, shownPropertyIds = [], resultScopeAction = 'unclear', lastShownProperties = [] }) => {
  const filter = { status: 'Available', propertyType: 'Apartment' }
  const validShownPropertyIds = isShowMore && Array.isArray(shownPropertyIds)
    ? shownPropertyIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) : []
  const validPreviousResultIds = Array.isArray(lastShownProperties)
    ? lastShownProperties.map((p) => p && p._id).filter((id) => id && mongoose.Types.ObjectId.isValid(id)) : []
  let resultScope = null
  if (validShownPropertyIds.length > 0) filter._id = { $nin: validShownPropertyIds }
  else if (resultScopeAction === 'previous_results' && validPreviousResultIds.length > 0) { filter._id = { $in: validPreviousResultIds }; resultScope = 'previous_results' }
  return { filter, resultScope }
}

{
  const r = decideScope({ resultScopeAction: 'previous_results', lastShownProperties: [{ _id: A }, { _id: B }, { _id: C }] })
  assertEqual('C1: previous_results -> filter._id.$in = [A,B,C]', r.filter._id, { $in: [A, B, C] })
  assertEqual('C1: resultScope flag set', r.resultScope, 'previous_results')
}
{
  // show-more precedence: even with resultScopeAction previous_results, $nin wins.
  const r = decideScope({ isShowMore: true, shownPropertyIds: [X, Y], resultScopeAction: 'previous_results', lastShownProperties: [{ _id: A }] })
  assertEqual('C2: show-more -> $nin (not $in)', r.filter._id, { $nin: [X, Y] })
  assertEqual('C2: resultScope null under show-more', r.resultScope, null)
}
{
  // Empty previous set -> NO _id restriction (no $in: []), global fallback.
  const r = decideScope({ resultScopeAction: 'previous_results', lastShownProperties: [] })
  assertTrue('C3: empty previous set -> no _id restriction', !('_id' in r.filter))
  assertEqual('C3: resultScope null', r.resultScope, null)
}
{
  const r = decideScope({ resultScopeAction: 'new_search', lastShownProperties: [{ _id: A }] })
  assertTrue('C4: new_search -> no _id restriction', !('_id' in r.filter))
}
{
  const r = decideScope({ resultScopeAction: 'unclear', lastShownProperties: [{ _id: A }] })
  assertTrue('C5: unclear -> no _id restriction', !('_id' in r.filter))
}
{
  // Invalid ids are dropped; only valid ObjectIds enter the $in.
  const r = decideScope({ resultScopeAction: 'previous_results', lastShownProperties: [{ _id: A }, { _id: 'not-an-id' }, { _id: null }] })
  assertEqual('C6: invalid previous ids dropped', r.filter._id, { $in: [A] })
}

// ═══════════════════════════════════════════════════════════════════════
// D. Scope-leak prevention: filter._id.$in survives hard-filter rebuilders
// ═══════════════════════════════════════════════════════════════════════
line(); console.log('D. _id.$in survives hard-filter builders'); line()
{
  const scoped = { status: 'Available', propertyType: 'Apartment', _id: { $in: [A, B, C] } }
  assertEqual('D1: description hard filter preserves _id.$in',
    buildHardFilterForDescriptionSearch(scoped)._id, { $in: [A, B, C] })
  assertEqual('D2: semantic hard filter preserves _id.$in',
    buildSemanticHardFilter({ filter: scoped, message: 'near schools for my children' })._id, { $in: [A, B, C] })
}
// NOTE: searchWithFallback steps 2/3/4 each copy `if (filter._id) stepN._id = filter._id`
// (verified by inspection); they run against a live DB so are covered by the
// DB-backed testChatPropertySearch suite, not re-run here.

// ═══════════════════════════════════════════════════════════════════════
// E. Scope-aware reply wording (en/tr/ar) — none-match vs global
// ═══════════════════════════════════════════════════════════════════════
line(); console.log('E. scope-aware reply wording'); line()
{
  const semProp = (fullyVerified, verified = [], unverified = []) => ({
    propertyType: 'Apartment', title: 't', description: 'd', listingType: 'Sale',
    matchedViaSemantic: true, softEvidence: { fullyVerified, verifiedCriteria: verified, unverifiedCriteria: unverified },
  })
  const parsed = { lifestyle: ['sea view', 'near schools'], propertyType: 'Apartment' }
  const se = { unmatchedSoftCriteria: ['near schools'], matchedSoftCriteria: ['sea view'] }
  const props = [semProp(false, ['sea view'], ['near schools'])] // previous sea-view apt, school unverified

  // Scoped none-match summary — must reference "those" and offer to broaden.
  const scopedPlan = buildSearchResultPlan({ properties: props, parsed, matchedViaSemantic: true, descriptionSearchAttempted: true, searchEvidence: se, resultScope: 'previous_results' })
  assertEqual('E1: plan carries scope', scopedPlan.scope, 'previous_results')
  const scopedEn = renderSearchResultPlan(scopedPlan, null, 'en')
  assertTrue('E1: scoped summary references the earlier set', /showed you earlier/i.test(scopedEn))
  assertTrue('E1: scoped summary offers to broaden', /other properties/i.test(scopedEn))

  // Same result WITHOUT scope → generic global-style summary (unchanged behavior).
  const globalPlan = buildSearchResultPlan({ properties: props, parsed, matchedViaSemantic: true, descriptionSearchAttempted: true, searchEvidence: se })
  const globalEn = renderSearchResultPlan(globalPlan, null, 'en')
  assertTrue('E2: non-scoped summary does NOT say "showed you earlier"', !/showed you earlier/i.test(globalEn))
  assertTrue('E2: non-scoped summary uses the generic wording', /your other requirements/i.test(globalEn))

  // tr/ar scoped summaries are localized (non-empty and different from English).
  const scopedTr = renderSearchResultPlan(scopedPlan, null, 'tr')
  const scopedAr = renderSearchResultPlan(scopedPlan, null, 'ar')
  assertTrue('E3: tr scoped summary is a non-empty localized string', typeof scopedTr === 'string' && scopedTr.length > 0 && scopedTr !== scopedEn)
  assertTrue('E3: ar scoped summary is a non-empty localized string', typeof scopedAr === 'string' && scopedAr.length > 0 && scopedAr !== scopedEn)

  // Scoped ZERO results — distinct from a global no-result.
  const scopedZero = buildSearchResultPlan({ properties: [], parsed, descriptionSearchAttempted: true, resultScope: 'previous_results' })
  assertEqual('E4: zero-result plan carries scope', scopedZero.scope, 'previous_results')
  const scopedZeroEn = renderSearchResultPlan(scopedZero, null, 'en')
  assertTrue('E4: scoped zero references the earlier set', /showed you earlier/i.test(scopedZeroEn))
  const globalZeroEn = renderSearchResultPlan(buildSearchResultPlan({ properties: [], parsed, descriptionSearchAttempted: true }), null, 'en')
  assertTrue('E4: global zero does NOT reference the earlier set', !/showed you earlier/i.test(globalZeroEn))

  // Full buildReply integration proves chat.js → buildReply → plan → renderer plumbing.
  const integrated = buildReply({ properties: props, parsed, matchedViaSemantic: true, descriptionSearchAttempted: true, searchEvidence: se, resultScope: 'previous_results', language: 'en' })
  assertTrue('E5: buildReply threads resultScope end-to-end', /showed you earlier/i.test(integrated))
}

line(); console.log('SUMMARY'); line()
console.log(`${passCount} passed, ${failCount} failed`)
process.exit(failCount > 0 ? 1 : 0)
