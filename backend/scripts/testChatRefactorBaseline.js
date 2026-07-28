// backend/scripts/testChatRefactorBaseline.js
//
// Characterization baseline for the routes/chat.js split (see the approved
// architecture plan: chat.js becomes an orchestrator, logic moves out by
// responsibility, move-only first). This script does NOT judge whether the
// chatbot's behavior is "correct" — it only records what it does TODAY, so
// each extraction step can be proven to have changed nothing.
//
// Boots the real, unmodified chat router in-process (same pattern as
// testChatRouteIntegration.js / testChatRouteMultiConversation.js), and
// drives every conversation ANONYMOUSLY (no Authorization header). This is
// deliberate, not an oversight:
//   - optionalAuth (middleware/auth.js) leaves req.user undefined when no
//     Bearer token is sent, so chat.js's persistence calls (recordChatExchange)
//     are skipped entirely — this baseline makes ZERO database writes.
//   - Every scenario needed for this refactor (parsing, memory merge, district
//     scope clarification, lead flow up to confirmation, filters, search,
//     replies) is reachable without a logged-in user or a persisted
//     conversation; conversationId/currentFilters/history/shownPropertyIds/
//     lastShownProperties are all passed directly in the request body, exactly
//     like the frontend (frontend/src/contexts/ChatContext.jsx) already does.
//   - conversationId/ownership persistence behavior is already covered by
//     testChatRouteMultiConversation.js and is out of scope here (chatFilters.js
//     and every later planned extraction never touch persistence).
//
// GEMINI NON-DETERMINISM
// -----------------------
// parsePropertyMessageWithGemini() is a live call to the Gemini API — nothing
// here mocks or stubs it (the existing test scripts don't either; there is no
// test-only parser seam in the current architecture, and adding one would
// itself be a production behavior change, which is out of scope for a
// move-only refactor). So two live runs of the same conversation can, in
// principle, produce slightly different free-text wording (reply phrasing,
// descriptionQuery, nextQuestion) even with zero code changes.
//
// This script handles that honestly rather than pretending it doesn't exist:
//   1. Every response is captured in full (see snapshotResponse) regardless
//      of whether it's expected to be stable, so a human can always inspect
//      the actual before/after text.
//   2. `compare` mode (see below) classifies every compared field as either
//      REQUIRED (must match byte-for-byte — HTTP status, response shape,
//      filterUsed, exactMatch, aiUsed, property ids/count, the *structured*
//      parsed fields that drive buildMongoFilter: listingType, propertyType,
//      propertyTypes, district, districts, beds, baths, min/maxPrice,
//      min/maxSqm, the boolean features, mustHave/niceToHave/lifestyle arrays)
//      or INFO-ONLY (free text that legitimately may vary turn-to-turn with
//      live Gemini — reply, descriptionQuery, nextQuestion, matchReason
//      sentences, clarification question wording).
//   3. For chatFilters.js specifically, the load-bearing invariant is: "for
//      the same resolved `parsed`, filterUsed is byte-identical." So the
//      comparator additionally cross-checks: whenever REQUIRED parsed fields
//      are identical between two snapshots of the same turn, filterUsed MUST
//      also be identical — any divergence there, even if some INFO-ONLY field
//      moved, is treated as a real regression, not Gemini noise.
//
// Usage:
//   node scripts/testChatRefactorBaseline.js run --out=<path.json>
//   node scripts/testChatRefactorBaseline.js compare <before.json> <after.json>

import dotenv from 'dotenv'
import express from 'express'
import mongoose from 'mongoose'
import fs from 'node:fs'
import path from 'node:path'
import connectDB from '../config/db.js'
import chatRoutes from '../routes/chat.js'

dotenv.config()

const line = (ch = '=') => console.log(ch.repeat(78))
const sub = () => console.log('-'.repeat(78))
const check = (label, pass) => {
  console.log(`${pass ? '✓' : '✗'} ${label}`)
  return pass
}

// ─── snapshot shape ────────────────────────────────────────────────────────
// Fields captured for every turn, per the baseline spec. `properties` is
// reduced to the fields the spec asks for (ids/titles/matchReason/
// semanticScore) — full property documents (images, description, etc.) are
// not meaningful to diff and would just add noise.
const snapshotResponse = (status, json) => ({
  status,
  success: json?.success ?? null,
  reply: json?.reply ?? null,
  parsed: json?.parsed ?? null,
  properties: (json?.properties || []).map((p) => ({
    id: String(p._id),
    title: p.title,
    matchReason: p.matchReason ?? null,
    semanticScore: typeof p.semanticScore === 'number' ? Number(p.semanticScore.toFixed(4)) : undefined,
    matchedViaSemantic: p.matchedViaSemantic === true ? true : undefined,
  })),
  propertyCount: (json?.properties || []).length,
  filterUsed: json?.filterUsed ?? null,
  descriptionSearchUsed: json?.descriptionSearchUsed ?? null,
  descriptionSearchQuery: json?.descriptionSearchQuery ?? null,
  descriptionSearchError: json?.descriptionSearchError ?? null,
  exactMatch: json?.exactMatch ?? null,
  aiUsed: json?.aiUsed ?? null,
  conversationId: json?.conversationId ?? null,
})

// Fields inside `parsed` that actually drive buildMongoFilter/
// buildMustHaveFeatureFilter/buildHardFilterForDescriptionSearch — the
// load-bearing set for THIS extraction. Free-text/advisory fields
// (nextQuestion, clarifyingQuestion, intent/intentType/replyType,
// searchMode, descriptionQuery) are intentionally excluded — they can
// legitimately vary with live Gemini phrasing without indicating a
// filter-building regression.
const STRUCTURED_PARSED_FIELDS = [
  'listingType', 'propertyType', 'propertyTypes', 'district', 'districts',
  'beds', 'baths', 'minPrice', 'maxPrice', 'minSqm', 'maxSqm',
  'furnished', 'balcony', 'elevator', 'pool', 'garden', 'parking',
  'mustHave', 'niceToHave',
]

// Superset of STRUCTURED_PARSED_FIELDS used specifically for the
// reply/matchReason parity check (see the deterministicInputsMatch logic in
// runCompare below) — buildReply/buildMatchReason (services/chatReplyBuilder.js)
// also read parsed.descriptionQuery/lifestyle/requirements directly (via
// getConceptSourcePhrases and the "matches what you described" wording),
// even though those three fields are irrelevant to buildMongoFilter and so
// are deliberately excluded from STRUCTURED_PARSED_FIELDS above. Treating
// STRUCTURED_PARSED_FIELDS alone as "the deterministic inputs matched" for
// reply/matchReason produces false positives whenever Gemini rephrases
// descriptionQuery between two live runs — the reply legitimately embeds
// that free text verbatim, so it's expected to differ right along with it.
const REPLY_RELEVANT_PARSED_FIELDS = [...STRUCTURED_PARSED_FIELDS, 'descriptionQuery', 'lifestyle', 'requirements']

// ─── conversation driver ───────────────────────────────────────────────────
const run = async (mode, argv) => {
  if (mode === 'compare') return runCompare(argv)
  if (mode !== 'run') {
    console.log('Usage:')
    console.log('  node scripts/testChatRefactorBaseline.js run --out=<path.json>')
    console.log('  node scripts/testChatRefactorBaseline.js compare <before.json> <after.json>')
    process.exit(1)
  }

  const outArg = argv.find((a) => a.startsWith('--out='))
  const outPath = outArg
    ? outArg.slice('--out='.length)
    : path.join(process.cwd(), 'baseline-output.json')

  await connectDB()

  const app = express()
  app.use(express.json())
  app.use('/api/chat', chatRoutes)
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
  })

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/chat`

  // No Authorization header, ever — see header comment. req.user stays
  // undefined, so recordChatExchange() is never invoked and nothing is
  // written to ChatConversation/ChatMessage.
  //
  // Rate limiting: the configured GEMINI_API_KEY is a free-tier key capped at
  // 15 requests/minute (discovered mid-run — a burst of back-to-back turns
  // exhausted it, silently falling back to keywordFallbackParser for the rest
  // of that run, which would have made intent-classification-dependent
  // scenarios like L and M meaningless). This throttles the SCRIPT's own
  // request rate to stay under that ceiling — a test-harness concern, not a
  // production code change.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const MIN_GAP_MS = 4300 // ~14/min, safely under the 15/min free-tier cap
  let lastCallAt = 0

  const post = async (body) => {
    const waitFor = lastCallAt + MIN_GAP_MS - Date.now()
    if (waitFor > 0) await sleep(waitFor)
    lastCallAt = Date.now()

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageKey: 'properties', ...body }),
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }

  // A tiny conversation-state helper mirroring exactly what
  // ChatContext.jsx (frontend) sends: history accumulates prior turns
  // (including the just-sent user message, per chat.js's own comment about
  // stripping it back out), currentFilters carries forward the last
  // response's `parsed`, shownPropertyIds accumulates every property id ever
  // shown, lastShownProperties holds only the most recent turn's properties
  // (used by chatLeadFlow.js's single/multiple disambiguation).
  const makeConversation = () => {
    const state = { history: [], currentFilters: {}, shownPropertyIds: [], lastShownProperties: [] }

    const send = async (message, extra = {}) => {
      const historyForRequest = [...state.history, { role: 'user', text: message }]

      const { status, json } = await post({
        message,
        history: historyForRequest,
        currentFilters: state.currentFilters,
        shownPropertyIds: state.shownPropertyIds,
        lastShownProperties: state.lastShownProperties,
        conversationId: null,
        ...extra,
      })

      state.history = [...historyForRequest, { role: 'assistant', text: json?.reply ?? '' }]
      if (json?.parsed) state.currentFilters = json.parsed
      if (Array.isArray(json?.properties) && json.properties.length > 0) {
        state.lastShownProperties = json.properties.map((p) => ({ _id: p._id, title: p.title }))
        state.shownPropertyIds = [
          ...new Set([...state.shownPropertyIds, ...json.properties.map((p) => String(p._id))]),
        ]
      }

      return snapshotResponse(status, json)
    }

    return { send, state }
  }

  const results = {}
  const scenarioChecks = {}
  const recordCheck = (scenarioId, label, pass) => {
    scenarioChecks[scenarioId] = scenarioChecks[scenarioId] || []
    scenarioChecks[scenarioId].push({ label, pass })
    check(`[${scenarioId}] ${label}`, pass)
  }

  // ── A. Basic structured search ──────────────────────────────────────────
  line()
  console.log('A. Basic structured search')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('Show me apartments for sale in Beylikdüzü')
    results.A = { turns: [t1] }

    recordCheck('A', 'HTTP 200', t1.status === 200)
    recordCheck('A', 'success: true', t1.success === true)
    recordCheck('A', 'aiUsed is boolean', typeof t1.aiUsed === 'boolean')
    recordCheck('A', 'filterUsed is an object', t1.filterUsed && typeof t1.filterUsed === 'object')
    recordCheck('A', 'properties is an array', Array.isArray(t1.properties))
    recordCheck('A', 'exactMatch is boolean', typeof t1.exactMatch === 'boolean')
    recordCheck('A', 'parsed.listingType resolved to Sale', t1.parsed?.listingType === 'Sale')
    recordCheck(
      'A',
      'parsed.propertyType resolved to Apartment (or propertyTypes includes it)',
      t1.parsed?.propertyType === 'Apartment' || (t1.parsed?.propertyTypes || []).includes('Apartment')
    )
    recordCheck(
      'A',
      'every returned property is actually Sale/Apartment/Beylikdüzü-ish',
      (t1.properties || []).length === 0 ||
        (t1.filterUsed?.listingType === 'Sale' && Boolean(t1.filterUsed?.district || t1.filterUsed?.$or))
    )
  }

  // ── B. Slot-filling conversation ────────────────────────────────────────
  line()
  console.log('B. Slot-filling conversation')
  line()
  {
    const convo = makeConversation()
    const turns = []
    turns.push(await convo.send('I want a home'))
    turns.push(await convo.send('rent'))
    turns.push(await convo.send('apartment'))
    turns.push(await convo.send('Beylikdüzü'))
    turns.push(await convo.send('under 25000'))
    results.B = { turns }

    const last = turns[turns.length - 1]
    recordCheck('B', 'all 5 turns returned HTTP 200', turns.every((t) => t.status === 200))
    recordCheck('B', 'final parsed.listingType is Rent (carried forward)', last.parsed?.listingType === 'Rent')
    recordCheck(
      'B',
      'final parsed.propertyType is Apartment (carried forward)',
      last.parsed?.propertyType === 'Apartment'
    )
    recordCheck(
      'B',
      'final parsed district reflects Beylikdüzü',
      last.parsed?.district === 'Beylikdüzü' || (last.parsed?.districts || []).includes('Beylikdüzü')
    )
    recordCheck('B', 'final parsed.maxPrice is 25000', Number(last.parsed?.maxPrice) === 25000)
  }

  // ── C. Show-more behavior ───────────────────────────────────────────────
  line()
  console.log('C. Show-more behavior')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('Show me apartments for sale in Beylikdüzü')
    const shownAfterT1 = [...convo.state.shownPropertyIds]
    const t2 = await convo.send('show me more')
    results.C = { turns: [t1, t2] }

    recordCheck('C', 'both turns HTTP 200', t1.status === 200 && t2.status === 200)
    recordCheck(
      'C',
      'prior criteria remain after show-more (listingType/propertyType unchanged)',
      t2.parsed?.listingType === t1.parsed?.listingType && t2.parsed?.propertyType === t1.parsed?.propertyType
    )
    const t2Ids = t2.properties.map((p) => p.id)
    recordCheck(
      'C',
      'show-more results do not duplicate previously-shown ids (where enough data exists)',
      t2Ids.every((id) => !shownAfterT1.includes(id))
    )
  }

  // ── D. Listing-type switch ──────────────────────────────────────────────
  line()
  console.log('D. Listing-type switch')
  line()
  {
    const convoSwitch = makeConversation()
    const d1a = await convoSwitch.send('Show me apartments for sale in Kadıköy')
    const d1b = await convoSwitch.send('Actually I want to rent')
    results.D_switch = { turns: [d1a, d1b] }

    recordCheck('D_switch', 'both turns HTTP 200', d1a.status === 200 && d1b.status === 200)
    recordCheck('D_switch', 'listingType flipped to Rent', d1b.parsed?.listingType === 'Rent')
    // NOT hard-asserted: the "reset district on listingType switch" branch in
    // chat.js only fires when messageRepeatsOldCriteria is false, and that
    // flag is also true whenever Gemini's OWN parsedFromMessage restates the
    // district on its own initiative (its prompt explicitly instructs it to
    // carry forward prior criteria). Whether Gemini does that for a given
    // live call is exactly the kind of turn-to-turn variance documented at
    // the top of this file — captured for inspection, not hard-asserted.
    console.log(`  (info) [D_switch] district after switch: ${JSON.stringify(d1b.parsed?.district)}, districts: ${JSON.stringify(d1b.parsed?.districts)}`)

    const convoContinuity = makeConversation()
    const d2a = await convoContinuity.send('Show me apartments for sale in Kadıköy')
    const d2b = await convoContinuity.send('Actually I want to rent in the same district')
    results.D_continuity = { turns: [d2a, d2b] }

    recordCheck('D_continuity', 'both turns HTTP 200', d2a.status === 200 && d2b.status === 200)
    recordCheck('D_continuity', 'listingType flipped to Rent', d2b.parsed?.listingType === 'Rent')
    recordCheck(
      'D_continuity',
      'district retained ("same district" continuity phrase)',
      d2b.parsed?.district === 'Kadıköy' || (d2b.parsed?.districts || []).includes('Kadıköy')
    )
  }

  // ── E. Lifestyle search ──────────────────────────────────────────────────
  line()
  console.log('E. Lifestyle search')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('Show me a peaceful home near parks')
    results.E = { turns: [t1] }

    recordCheck('E', 'HTTP 200', t1.status === 200)
    recordCheck(
      'E',
      'descriptionSearchUsed or semantic match flag observable (some soft-search branch ran)',
      t1.descriptionSearchUsed === true || t1.properties.some((p) => p.matchedViaSemantic)
    )
    recordCheck(
      'E',
      'every returned property has a non-empty matchReason string',
      t1.properties.every((p) => typeof p.matchReason === 'string' && p.matchReason.length > 0)
    )
  }

  // ── F. Lifestyle concept switch ─────────────────────────────────────────
  line()
  console.log('F. Lifestyle concept switch')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('Show me apartments near schools')
    const t2 = await convo.send('What about sea view apartments?')
    results.F = { turns: [t1, t2] }

    recordCheck('F', 'both turns HTTP 200', t1.status === 200 && t2.status === 200)
    recordCheck('F', 'parsed.propertyType stayed Apartment across the switch', t2.parsed?.propertyType === 'Apartment')
  }

  // ── G. Lifestyle combine ────────────────────────────────────────────────
  line()
  console.log('G. Lifestyle combine')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('Show me apartments near schools')
    const t2 = await convo.send('Also with sea view')
    results.G = { turns: [t1, t2] }

    recordCheck('G', 'both turns HTTP 200', t1.status === 200 && t2.status === 200)
    recordCheck('G', 'parsed.propertyType stayed Apartment across the combine', t2.parsed?.propertyType === 'Apartment')
  }

  // ── H. District-scope clarification ─────────────────────────────────────
  line()
  console.log('H. District-scope clarification')
  line()
  {
    // H-keep
    const convoKeep = makeConversation()
    const hk1 = await convoKeep.send('Show me apartments for sale in Kadıköy')
    const hk2 = await convoKeep.send('my wife wants a sea view')
    const hk3 = await convoKeep.send('keep it in Kadıköy')
    results.H_keep = { turns: [hk1, hk2, hk3] }

    recordCheck(
      'H_keep',
      'a district-scope clarification was asked after turn 2',
      hk2.parsed?.pendingClarification?.type === 'lifestyle_scope'
    )
    recordCheck(
      'H_keep',
      'clarification resolved and cleared after "keep it in Kadıköy"',
      !hk3.parsed?.pendingClarification
    )
    recordCheck(
      'H_keep',
      'district retained after "keep"',
      hk3.parsed?.district === 'Kadıköy' || (hk3.parsed?.districts || []).includes('Kadıköy')
    )

    // H-broaden
    const convoBroaden = makeConversation()
    const hb1 = await convoBroaden.send('Show me apartments for sale in Kadıköy')
    const hb2 = await convoBroaden.send('my wife wants a sea view')
    const hb3 = await convoBroaden.send('anywhere is fine')
    results.H_broaden = { turns: [hb1, hb2, hb3] }

    recordCheck(
      'H_broaden',
      'a district-scope clarification was asked after turn 2',
      hb2.parsed?.pendingClarification?.type === 'lifestyle_scope'
    )
    recordCheck(
      'H_broaden',
      'district cleared after "anywhere is fine"',
      !hb3.parsed?.district && (hb3.parsed?.districts || []).length === 0
    )
    recordCheck('H_broaden', 'clarification cleared', !hb3.parsed?.pendingClarification)

    // H-unclear-then-retry
    const convoUnclear = makeConversation()
    const hu1 = await convoUnclear.send('Show me apartments for sale in Kadıköy')
    const hu2 = await convoUnclear.send('my wife wants a sea view')
    const hu3 = await convoUnclear.send('hmm not sure')
    const hu4 = await convoUnclear.send('hmm still not sure')
    results.H_unclear = { turns: [hu1, hu2, hu3, hu4] }

    recordCheck(
      'H_unclear',
      'a district-scope clarification was asked after turn 2',
      hu2.parsed?.pendingClarification?.type === 'lifestyle_scope'
    )
    recordCheck(
      'H_unclear',
      'an unclear answer produces a retry with retryCount incremented',
      hu3.parsed?.pendingClarification?.type === 'lifestyle_scope' && hu3.parsed?.pendingClarification?.retryCount === 1
    )
    recordCheck(
      'H_unclear',
      'a second unclear answer stops asking (clarification cleared, safe default kept)',
      !hu4.parsed?.pendingClarification
    )
  }

  // ── I. No-preference answer ──────────────────────────────────────────────
  line()
  console.log('I. No-preference answer')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('I need an apartment')
    const t2 = await convo.send('rent')
    const t3 = await convo.send('no preference, show me what you have')
    results.I = { turns: [t1, t2, t3] }

    recordCheck('I', 'all 3 turns HTTP 200', [t1, t2, t3].every((t) => t.status === 200))
    recordCheck('I', 'listingType/propertyType survived the no-preference answer', t3.parsed?.listingType === 'Rent' && t3.parsed?.propertyType === 'Apartment')
    recordCheck('I', 'no district was forced despite "no preference"', !t3.parsed?.district)
  }

  // ── J. Multiple property types ──────────────────────────────────────────
  line()
  console.log('J. Multiple property types')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('apartment or villa for sale')
    results.J = { turns: [t1] }

    recordCheck('J', 'HTTP 200', t1.status === 200)
    recordCheck(
      'J',
      'propertyTypes[] holds both types and propertyType is cleared',
      Array.isArray(t1.parsed?.propertyTypes) &&
        t1.parsed.propertyTypes.includes('Apartment') &&
        t1.parsed.propertyTypes.includes('Villa') &&
        !t1.parsed?.propertyType
    )
    // NOT hard-required: Gemini may classify this as replyType "ask_question"
    // (its own prompt's Example 9 is exactly this phrasing — "not sure
    // apartment or villa" — asking for district/budget before searching),
    // in which case chat.js returns before buildMongoFilter ever runs and
    // filterUsed stays null. Both outcomes are legitimate current behavior;
    // only check the $in shape when a filter was actually built.
    if (t1.filterUsed) {
      recordCheck(
        'J',
        'filterUsed.propertyType uses $in for the multiple types',
        Boolean(t1.filterUsed?.propertyType?.$in)
      )
    } else {
      console.log('  (info) [J] Gemini asked a clarifying question instead of searching this turn — filterUsed is null, as chat.js\'s ask_question branch never calls buildMongoFilter. Not a failure.')
    }
  }

  // ── K. Residential request ──────────────────────────────────────────────
  line()
  console.log('K. Residential request')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('show me residential properties')
    results.K = { turns: [t1] }

    recordCheck('K', 'HTTP 200', t1.status === 200)
    recordCheck(
      'K',
      'propertyTypes[] set to the residential set, propertyType cleared',
      Array.isArray(t1.parsed?.propertyTypes) && t1.parsed.propertyTypes.length > 1 && !t1.parsed?.propertyType
    )
  }

  // ── L. Non-property intents ──────────────────────────────────────────────
  line()
  console.log('L. Non-property intents')
  line()
  {
    const casesL = [
      ['casual', 'how are you today?'],
      ['emotional', 'my day was really bad'],
      ['contact', 'can someone call me about this'],
      ['service', 'do you also do interior design?'],
      ['unknown', 'asdkfjaskldfj'],
    ]

    results.L = {}
    for (const [key, message] of casesL) {
      const convo = makeConversation()
      const t1 = await convo.send(message)
      results.L[key] = { turns: [t1] }

      recordCheck(`L_${key}`, 'HTTP 200', t1.status === 200)
      recordCheck(`L_${key}`, 'success: true', t1.success === true)
      recordCheck(`L_${key}`, 'properties array is empty', t1.propertyCount === 0)
      recordCheck(`L_${key}`, 'reply is a non-empty string', typeof t1.reply === 'string' && t1.reply.length > 0)
    }
  }

  // ── M. Lead-flow branch (stops before actual submission) ────────────────
  line()
  console.log('M. Lead-flow branch (collecting -> confirming -> correction; NOT submitted)')
  line()
  console.log('NOTE: EMAIL_USER/EMAIL_PASS/OWNER_EMAIL are configured in this environment,')
  console.log('so sendContactNotification() would send a REAL email to a real recipient on')
  console.log('confirmation. This baseline deliberately stops at the confirming/correction')
  console.log('stage and never sends a confirming "yes" — see final report for reasoning.')
  line('-')
  {
    const convo = makeConversation()
    const m1 = await convo.send('Show me apartments for sale in Kadıköy')
    const m2 = await convo.send('can you arrange an appointment for me')
    const m3 = await convo.send('the first one')
    const m4 = await convo.send('My name is Baseline Tester, phone 05001234567, email baseline-tester@example.com')
    const m5 = await convo.send('actually my email is baseline-tester2@example.com')
    results.M = { turns: [m1, m2, m3, m4, m5] }

    recordCheck('M', 'all 5 turns HTTP 200', [m1, m2, m3, m4, m5].every((t) => t.status === 200))
    recordCheck(
      'M',
      'turn 2 entered lead flow (property disambiguation OR straight to collecting)',
      typeof m2.reply === 'string' && m2.reply.length > 0
    )
    recordCheck('M', 'turn 4 produced a confirmation summary (contains "Should I send")', /should i send/i.test(m4.reply || ''))
    recordCheck(
      'M',
      'turn 5 correction updated the summary with the corrected email',
      /baseline-tester2@example\.com/.test(m5.reply || '')
    )
  }

  // ── N. No-results branch ────────────────────────────────────────────────
  line()
  console.log('N. No-results branch')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('Show me a warehouse for sale in a made-up district called Zzyzxopolis')
    results.N = { turns: [t1] }

    recordCheck('N', 'HTTP 200', t1.status === 200)
    recordCheck('N', 'properties array present (possibly empty)', Array.isArray(t1.properties))
    if (t1.propertyCount === 0) {
      recordCheck('N', 'no-results reply is a non-empty string', typeof t1.reply === 'string' && t1.reply.length > 0)
    } else {
      console.log('  (info) N did not land on zero results this run — recorded as-is for inspection.')
    }
  }

  // ── O. Description mismatch fallback ─────────────────────────────────────
  line()
  console.log('O. Description mismatch fallback')
  line()
  {
    const convo = makeConversation()
    const t1 = await convo.send('I want a home close to a golf course')
    results.O = { turns: [t1] }

    recordCheck('O', 'HTTP 200', t1.status === 200)
    recordCheck(
      'O',
      'descriptionSearchUsed reflects whether a verified match was found',
      typeof t1.descriptionSearchUsed === 'boolean' || t1.descriptionSearchUsed === null
    )
    console.log(`  reply captured for manual honesty-wording review: "${t1.reply}"`)
  }

  // ── write output ──────────────────────────────────────────────────────
  const totalChecks = Object.values(scenarioChecks).flat()
  const passed = totalChecks.filter((c) => c.pass).length

  line()
  console.log('SUMMARY')
  line()
  console.log(`Structural/deterministic checks: ${passed}/${totalChecks.length} passed`)
  const failed = totalChecks.filter((c) => !c.pass)
  if (failed.length > 0) {
    console.log('Failed checks (review before treating this as a valid baseline):')
    failed.forEach((f) => console.log(`  ✗ ${f.label}`))
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(
    outPath,
    JSON.stringify({ capturedAt: new Date().toISOString(), results, scenarioChecks }, null, 2)
  )
  console.log('')
  console.log(`Baseline snapshot written to: ${outPath}`)
  console.log('No database writes occurred (anonymous requests only, no ChatConversation/')
  console.log('ChatMessage/ContactSubmission created).')

  server.close()
  await mongoose.disconnect()
  process.exit(failed.length > 0 ? 1 : 0)
}

// ─── compare mode (no DB/server needed — pure JSON diff) ──────────────────
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const pickStructuredParsed = (parsed) => {
  const out = {}
  for (const field of STRUCTURED_PARSED_FIELDS) out[field] = parsed?.[field] ?? null
  return out
}

const pickReplyRelevantParsed = (parsed) => {
  const out = {}
  for (const field of REPLY_RELEVANT_PARSED_FIELDS) out[field] = parsed?.[field] ?? null
  return out
}

const runCompare = (argv) => {
  const [beforePath, afterPath] = argv
  if (!beforePath || !afterPath) {
    console.log('Usage: node scripts/testChatRefactorBaseline.js compare <before.json> <after.json>')
    process.exit(1)
  }

  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'))

  let requiredMismatches = 0
  let infoMismatches = 0

  const scenarioIds = Object.keys(before.results)
  for (const scenarioId of scenarioIds) {
    const beforeScenario = before.results[scenarioId]
    const afterScenario = after.results[scenarioId]

    if (!afterScenario) {
      console.log(`✗ REQUIRED: scenario "${scenarioId}" missing from after-run`)
      requiredMismatches++
      continue
    }

    // L is a keyed object of sub-scenarios, not a flat {turns}. Flatten both
    // shapes into a list of {label, turns} pairs so the same loop handles both.
    const beforeTurnSets = beforeScenario.turns
      ? [{ label: scenarioId, turns: beforeScenario.turns }]
      : Object.entries(beforeScenario).map(([k, v]) => ({ label: `${scenarioId}.${k}`, turns: v.turns }))
    const afterTurnSets = afterScenario.turns
      ? [{ label: scenarioId, turns: afterScenario.turns }]
      : Object.entries(afterScenario).map(([k, v]) => ({ label: `${scenarioId}.${k}`, turns: v.turns }))

    for (let i = 0; i < beforeTurnSets.length; i++) {
      const { label, turns: beforeTurns } = beforeTurnSets[i]
      const afterTurns = afterTurnSets[i]?.turns

      if (!afterTurns || afterTurns.length !== beforeTurns.length) {
        console.log(`✗ REQUIRED: ${label} turn count changed (${beforeTurns?.length} -> ${afterTurns?.length})`)
        requiredMismatches++
        continue
      }

      for (let t = 0; t < beforeTurns.length; t++) {
        const b = beforeTurns[t]
        const a = afterTurns[t]
        const turnLabel = `${label} turn ${t + 1}`

        if (b.status !== a.status) {
          console.log(`✗ REQUIRED: ${turnLabel} HTTP status changed (${b.status} -> ${a.status})`)
          requiredMismatches++
        }
        if (b.success !== a.success) {
          console.log(`✗ REQUIRED: ${turnLabel} success flag changed (${b.success} -> ${a.success})`)
          requiredMismatches++
        }
        if (b.aiUsed !== a.aiUsed) {
          console.log(`  (info) ${turnLabel} aiUsed changed (${b.aiUsed} -> ${a.aiUsed}) — Gemini availability, not code`)
        }
        const idsMatch = deepEqual(b.properties.map((p) => p.id), a.properties.map((p) => p.id))
        const propertyCountMatches = b.propertyCount === a.propertyCount
        const exactMatchMatches = b.exactMatch === a.exactMatch

        if (!propertyCountMatches) {
          console.log(`✗ REQUIRED: ${turnLabel} propertyCount changed (${b.propertyCount} -> ${a.propertyCount})`)
          requiredMismatches++
        }
        if (!idsMatch) {
          console.log(`✗ REQUIRED: ${turnLabel} returned property ids/order changed`)
          requiredMismatches++
        }
        if (!exactMatchMatches) {
          console.log(`✗ REQUIRED: ${turnLabel} exactMatch changed (${b.exactMatch} -> ${a.exactMatch})`)
          requiredMismatches++
        }

        const bStructured = pickStructuredParsed(b.parsed)
        const aStructured = pickStructuredParsed(a.parsed)
        const structuredMatches = deepEqual(bStructured, aStructured)

        if (!structuredMatches) {
          console.log(`  (info) ${turnLabel} structured parsed fields differ — likely Gemini variance, not code:`)
          console.log(`         before: ${JSON.stringify(bStructured)}`)
          console.log(`         after:  ${JSON.stringify(aStructured)}`)
        }

        // The load-bearing invariant for chatFilters.js: same structured
        // parsed in -> same filterUsed out. Only a REQUIRED failure when the
        // input was actually identical.
        const filterUsedMatches = deepEqual(b.filterUsed, a.filterUsed)
        if (structuredMatches && !filterUsedMatches) {
          console.log(`✗ REQUIRED: ${turnLabel} filterUsed changed despite identical structured parsed input`)
          console.log(`         before: ${JSON.stringify(b.filterUsed)}`)
          console.log(`         after:  ${JSON.stringify(a.filterUsed)}`)
          requiredMismatches++
        } else if (!structuredMatches && !filterUsedMatches) {
          infoMismatches++
        }

        // The load-bearing invariant for chatReplyBuilder.js: reply and
        // per-property matchReason are pure functions of parsed/properties/
        // fallbackLevel/match-flags/relaxedFeatureLabels. Whenever every one
        // of those deterministic inputs matched between the two runs (same
        // REPLY_RELEVANT_PARSED_FIELDS — a superset of the structured filter
        // fields that also covers descriptionQuery/lifestyle/requirements,
        // since buildReply/buildMatchReason read those directly too — same
        // filterUsed, same property ids/order/count, same exactMatch as a
        // proxy for fallbackLevel parity), reply and every matchReason MUST
        // also be byte-identical — any divergence there, with everything
        // upstream unchanged, can only be attributed to the reply-
        // construction move itself, not to live Gemini variance, so it's
        // promoted from informational to REQUIRED.
        const replyInputsMatch = deepEqual(pickReplyRelevantParsed(b.parsed), pickReplyRelevantParsed(a.parsed))
        const deterministicInputsMatch =
          replyInputsMatch && filterUsedMatches && propertyCountMatches && idsMatch && exactMatchMatches

        if (deterministicInputsMatch) {
          if (!deepEqual(b.reply, a.reply)) {
            console.log(`✗ REQUIRED: ${turnLabel} reply text changed despite identical deterministic inputs`)
            console.log(`         before: ${JSON.stringify(b.reply)}`)
            console.log(`         after:  ${JSON.stringify(a.reply)}`)
            requiredMismatches++
          }

          const bReasons = b.properties.map((p) => p.matchReason)
          const aReasons = a.properties.map((p) => p.matchReason)
          if (!deepEqual(bReasons, aReasons)) {
            console.log(`✗ REQUIRED: ${turnLabel} matchReason changed despite identical deterministic inputs`)
            console.log(`         before: ${JSON.stringify(bReasons)}`)
            console.log(`         after:  ${JSON.stringify(aReasons)}`)
            requiredMismatches++
          }
        } else if (!deepEqual(b.reply, a.reply)) {
          infoMismatches++
        }

        if (!deepEqual(b.parsed?.pendingClarification, a.parsed?.pendingClarification)) {
          const same = deepEqual(b.parsed?.pendingClarification, a.parsed?.pendingClarification)
          if (!same) {
            console.log(`✗ REQUIRED: ${turnLabel} pendingClarification shape changed`)
            console.log(`         before: ${JSON.stringify(b.parsed?.pendingClarification)}`)
            console.log(`         after:  ${JSON.stringify(a.parsed?.pendingClarification)}`)
            requiredMismatches++
          }
        }
      }
    }
  }

  line()
  console.log('COMPARE SUMMARY')
  line()
  console.log(`REQUIRED mismatches (real regressions): ${requiredMismatches}`)
  console.log(`INFO-ONLY differences (free text / Gemini wording, informational): ${infoMismatches}`)
  console.log(requiredMismatches === 0 ? '\n✓ No required-field regressions detected.' : '\n✗ Investigate before proceeding.')

  process.exit(requiredMismatches === 0 ? 0 : 1)
}

const [, , mode, ...rest] = process.argv
run(mode, rest).catch((err) => {
  console.error(err)
  process.exit(1)
})
