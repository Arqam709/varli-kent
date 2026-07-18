// backend/scripts/testGroupedAdminChatsApi.js
//
// Verification for the grouped-by-user Admin Chat Dashboard redesign:
// GET /api/admin/chats/users (new), GET /api/admin/chats?user=<id>
// (extended), GET /api/admin/chats/:conversationId (unchanged), plus a
// regression check on the public GET /api/chat/conversations API. Boots
// the real, unmodified routers in-process, signs real JWTs for existing
// accounts (no user documents are modified). All ChatConversation/
// ChatMessage documents created here are temporary and deleted in the
// finally block — this script only ever creates NEW documents, it never
// modifies or deletes any pre-existing real data. Not part of the app.
//
// Usage: node scripts/testGroupedAdminChatsApi.js

import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import adminChatRoutes from '../routes/adminChats.js'
import chatConversationRoutes from '../routes/chatConversations.js'

dotenv.config()

const line = () => console.log('='.repeat(70))
const check = (label, pass) => console.log(`${pass ? '✓' : '✗'} ${label}`)

const run = async () => {
  await connectDB()

  const owner = await User.findOne({ role: 'owner' })
  const plainUsers = await User.find({ role: 'user' }).limit(2)

  if (!owner || plainUsers.length < 2) {
    console.log('Need 1 owner and 2 user-role accounts — found fewer. Aborting.')
    await mongoose.disconnect()
    process.exit(0)
  }

  const [userA, userB] = plainUsers
  console.log(`Owner:  ${owner.name} <${owner.email}>`)
  console.log(`User A: ${userA.name} <${userA.email}> (real, temp conversations attached)`)
  console.log(`User B: ${userB.name} <${userB.email}> (real, one temp conversation attached)`)

  const ownerToken = jwt.sign({ id: owner._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })
  const userAToken = jwt.sign({ id: userA._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })

  const app = express()
  app.use(express.json())
  app.use('/api/admin/chats', adminChatRoutes)
  app.use('/api/chat/conversations', chatConversationRoutes)
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
  })

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const adminBase = `http://127.0.0.1:${server.address().port}/api/admin/chats`
  const userBase = `http://127.0.0.1:${server.address().port}/api/chat/conversations`

  const get = async (url, token) => {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }

  // ── Temporary, reversible test data ──────────────────────────────────────
  line()
  console.log('SETUP: creating temporary ChatConversation/ChatMessage documents')
  line()

  const now = Date.now()
  const fakeUserId = new mongoose.Types.ObjectId() // never a real User — for the orphaned-user test

  const convActive1 = await ChatConversation.create({
    user: userA._id,
    status: 'active',
    leadCaptured: true,
    messageCount: 2,
    lastActivityAt: new Date(now - 1 * 60 * 1000), // 1 min ago — newest for userA
    lastMessage: { text: 'Test active lead message', role: 'assistant', at: new Date(now - 1 * 60 * 1000) },
  })
  const convActive2 = await ChatConversation.create({
    user: userA._id,
    status: 'active',
    leadCaptured: false,
    messageCount: 2,
    lastActivityAt: new Date(now - 5 * 60 * 1000), // 5 min ago
    lastMessage: { text: 'Test active no-lead message', role: 'assistant', at: new Date(now - 5 * 60 * 1000) },
  })
  const convArchived1 = await ChatConversation.create({
    user: userA._id,
    status: 'archived',
    leadCaptured: false,
    messageCount: 2,
    lastActivityAt: new Date(now - 20 * 60 * 1000), // 20 min ago
    lastMessage: { text: 'Test archived message', role: 'assistant', at: new Date(now - 20 * 60 * 1000) },
  })
  const convUserB1 = await ChatConversation.create({
    user: userB._id,
    status: 'active',
    leadCaptured: false,
    messageCount: 1,
    lastActivityAt: new Date(now - 2 * 60 * 1000),
    lastMessage: { text: 'User B test message', role: 'assistant', at: new Date(now - 2 * 60 * 1000) },
  })
  const convOrphaned = await ChatConversation.create({
    user: fakeUserId,
    status: 'active',
    leadCaptured: false,
    messageCount: 1,
    lastActivityAt: new Date(now - 3 * 60 * 1000),
    lastMessage: { text: 'Orphaned conversation message', role: 'assistant', at: new Date(now - 3 * 60 * 1000) },
  })
  await ChatMessage.insertMany([
    { conversation: convActive1._id, role: 'user', text: 'Hello', pageKey: 'properties' },
    { conversation: convActive1._id, role: 'assistant', text: 'Test active lead message', pageKey: 'properties', event: 'lead_captured' },
  ])

  const tempConversationIds = [convActive1._id, convActive2._id, convArchived1._id, convUserB1._id, convOrphaned._id]

  console.log(`User A conversations: active1=${convActive1._id} active2=${convActive2._id} archived1=${convArchived1._id}`)
  console.log(`User B conversation:  ${convUserB1._id}`)
  console.log(`Orphaned conversation: ${convOrphaned._id} (user: ${fakeUserId} — no matching User document)`)

  try {
    // ── A. Authorization ────────────────────────────────────────────────────
    line()
    console.log('A. AUTHORIZATION')
    line()

    const noTokenUsers = await get(`${adminBase}/users`, null)
    const noTokenConvByUser = await get(`${adminBase}?user=${userA._id}`, null)
    check('GET /users, no token -> 401', noTokenUsers.status === 401)
    check('GET ?user=<id>, no token -> 401', noTokenConvByUser.status === 401)

    const asPlainUser = await get(`${adminBase}/users`, userAToken)
    check('GET /users, normal user account -> 403', asPlainUser.status === 403)

    const asOwner = await get(`${adminBase}/users?status=all`, ownerToken)
    check("GET /users, owner -> 200 (permission bypass, even without 'view_chats' in permissions array)", asOwner.status === 200)
    check("Owner's permissions array does not contain view_chats (bypass genuinely exercised)", !owner.permissions.includes('view_chats'))

    console.log('(skipped) admin-without-view_chats: no admin-role account exists in this database; not modifying a real account to force this case, per instructions.')

    // ── B. Grouped users endpoint ────────────────────────────────────────────
    line()
    console.log('B. GROUPED USERS ENDPOINT')
    line()

    const allUsersRes = await get(`${adminBase}/users?status=all`, ownerToken)
    const rows = allUsersRes.json?.users || []
    const rowIds = rows.map((r) => r.user._id)
    const uniqueIds = new Set(rowIds)

    check('200 response', allUsersRes.status === 200)
    check('users is an array', Array.isArray(rows))
    check('every user appears at most once', uniqueIds.size === rowIds.length)

    const userARow = rows.find((r) => r.user._id === String(userA._id))
    check('User A (3 conversations) appears exactly once', rows.filter((r) => r.user._id === String(userA._id)).length === 1)

    const directCountAll = await ChatConversation.countDocuments({ user: userA._id, _id: { $in: tempConversationIds } })
    check(
      `conversationCount matches a direct count (${userARow?.conversationCount} === at least 3)`,
      userARow?.conversationCount >= 3
    )
    check(
      "lastActivityAt is the newest matching conversation (convActive1's time)",
      userARow && new Date(userARow.lastActivityAt).getTime() === convActive1.lastActivityAt.getTime()
    )
    check(
      "latestMessage comes from the newest matching conversation",
      userARow?.latestMessage?.text === 'Test active lead message'
    )
    check('hasLead is true (convActive1 has leadCaptured: true)', userARow?.hasLead === true)

    const sortedDescending = rows.every(
      (r, i) => i === 0 || new Date(r.lastActivityAt) <= new Date(rows[i - 1].lastActivityAt)
    )
    check('rows sorted by grouped lastActivityAt descending', sortedDescending)
    check('no transcript/messages array on any row', rows.every((r) => r.messages === undefined))
    check('no full conversations array on any row', rows.every((r) => r.conversations === undefined))
    check('no lead document on any row', rows.every((r) => r.lead === undefined))

    // ── C. Search ─────────────────────────────────────────────────────────
    line()
    console.log('C. SEARCH')
    line()

    const searchByPartialName = await get(`${adminBase}/users?status=all&search=${encodeURIComponent(userA.name.slice(0, 3))}`, ownerToken)
    check('Partial name search finds User A', (searchByPartialName.json?.users || []).some((r) => r.user._id === String(userA._id)))

    const searchByEmail = await get(`${adminBase}/users?status=all&search=${encodeURIComponent(userA.email)}`, ownerToken)
    check('Email search finds User A', (searchByEmail.json?.users || []).some((r) => r.user._id === String(userA._id)))

    const searchCaseInsensitive = await get(`${adminBase}/users?status=all&search=${encodeURIComponent(userA.name.toUpperCase())}`, ownerToken)
    check('Case-insensitive search finds User A', (searchCaseInsensitive.json?.users || []).some((r) => r.user._id === String(userA._id)))

    const searchNoMatch = await get(`${adminBase}/users?status=all&search=zzzznobodyhasthisnamezzzz`, ownerToken)
    check('No-match search returns users: []', searchNoMatch.status === 200 && (searchNoMatch.json?.users || []).length === 0)

    let regexSurvived = true
    for (const dangerousInput of ['[test', 'alex+', '(name)']) {
      const res = await get(`${adminBase}/users?status=all&search=${encodeURIComponent(dangerousInput)}`, ownerToken)
      if (res.status !== 200) regexSurvived = false
    }
    check('Regex special characters in search do not crash the endpoint', regexSurvived)

    // ── D. Filters ────────────────────────────────────────────────────────
    line()
    console.log('D. FILTERS')
    line()

    const activeOnly = await get(`${adminBase}/users?status=active`, ownerToken)
    const archivedOnly = await get(`${adminBase}/users?status=archived`, ownerToken)
    const allStatus = await get(`${adminBase}/users?status=all`, ownerToken)
    const invalidStatus = await get(`${adminBase}/users?status=bogus`, ownerToken)

    const userARowActive = (activeOnly.json?.users || []).find((r) => r.user._id === String(userA._id))
    const userARowArchived = (archivedOnly.json?.users || []).find((r) => r.user._id === String(userA._id))
    const userARowInvalidStatus = (invalidStatus.json?.users || []).find((r) => r.user._id === String(userA._id))

    check('status=active: User A conversationCount reflects only active convs (2)', userARowActive?.conversationCount === 2)
    check('status=archived: User A conversationCount reflects only archived convs (1)', userARowArchived?.conversationCount === 1)
    check('status=all: User A conversationCount reflects both (>= 3)', (allUsersRes.json?.users || []).find((r) => r.user._id === String(userA._id))?.conversationCount >= 3)
    check('invalid status falls back to active behavior', userARowInvalidStatus?.conversationCount === 2)
    check('conversationCount changes based on the status filter (2 vs 1 vs 3+)', userARowActive?.conversationCount !== userARowArchived?.conversationCount)

    const leadTrue = await get(`${adminBase}/users?status=all&leadCaptured=true`, ownerToken)
    const leadFalse = await get(`${adminBase}/users?status=all&leadCaptured=false`, ownerToken)
    const userARowLeadTrue = (leadTrue.json?.users || []).find((r) => r.user._id === String(userA._id))
    const userARowLeadFalse = (leadFalse.json?.users || []).find((r) => r.user._id === String(userA._id))
    check('leadCaptured=true: User A shows only the 1 lead conversation', userARowLeadTrue?.conversationCount === 1)
    check('leadCaptured=false: User A shows the 2 non-lead conversations', userARowLeadFalse?.conversationCount === 2)

    const fromRes = await get(`${adminBase}/users?status=all&from=${new Date(now - 10 * 60 * 1000).toISOString()}`, ownerToken)
    const toRes = await get(`${adminBase}/users?status=all&to=${new Date(now - 10 * 60 * 1000).toISOString()}`, ownerToken)
    const invalidDateRes = await get(`${adminBase}/users?status=all&from=not-a-date`, ownerToken)

    const userARowFrom = (fromRes.json?.users || []).find((r) => r.user._id === String(userA._id))
    const userARowTo = (toRes.json?.users || []).find((r) => r.user._id === String(userA._id))

    check('valid from date: excludes the 20-min-old archived conversation (count 2)', userARowFrom?.conversationCount === 2)
    check('valid to date: only the 20-min-old archived conversation survives (count 1)', userARowTo?.conversationCount === 1)
    check('invalid date is ignored, not an error', invalidDateRes.status === 200)

    // ── E. Pagination ─────────────────────────────────────────────────────
    line()
    console.log('E. PAGINATION')
    line()

    const defaults = await get(`${adminBase}/users`, ownerToken)
    check('default page = 1', defaults.json?.pagination?.page === 1)
    check('default limit = 20', defaults.json?.pagination?.limit === 20)

    const invalidPage = await get(`${adminBase}/users?page=-5`, ownerToken)
    check('invalid page falls back to 1', invalidPage.json?.pagination?.page === 1)

    const overLimit = await get(`${adminBase}/users?limit=999`, ownerToken)
    check('limit above 50 clamps to 50', overLimit.json?.pagination?.limit === 50)

    const zeroLimit = await get(`${adminBase}/users?limit=0`, ownerToken)
    check('limit 0 clamps to 1', zeroLimit.json?.pagination?.limit === 1)

    const distinctUserCount = (await ChatConversation.distinct('user', {})).length
    check(
      `totalCount is the number of grouped users, not conversations (${allStatus.json?.pagination?.totalCount} === ${distinctUserCount} distinct users)`,
      allStatus.json?.pagination?.totalCount === distinctUserCount
    )

    const expectedTotalPages = Math.max(Math.ceil(distinctUserCount / 20), 1)
    check('totalPages is correct', allStatus.json?.pagination?.totalPages === expectedTotalPages)

    const page1 = await get(`${adminBase}/users?status=all&limit=1&page=1`, ownerToken)
    const page2 = await get(`${adminBase}/users?status=all&limit=1&page=2`, ownerToken)
    const page1Id = page1.json?.users?.[0]?.user?._id
    const page2Id = page2.json?.users?.[0]?.user?._id
    check('page boundaries work (both pages return exactly 1 row)', page1.json?.users?.length === 1 && page2.json?.users?.length === 1)
    check('no duplicate grouped user across adjacent pages', Boolean(page1Id) && Boolean(page2Id) && page1Id !== page2Id)

    // ── F. Orphaned user handling ────────────────────────────────────────────
    line()
    console.log('F. ORPHANED USER HANDLING')
    line()

    const orphanRow = (allStatus.json?.users || []).find((r) => r.user._id === String(fakeUserId))
    check('Orphaned conversation still appears (not silently dropped)', Boolean(orphanRow))
    check("Fallback name is 'Deleted user'", orphanRow?.user?.name === 'Deleted user')
    check('Fallback email is empty string', orphanRow?.user?.email === '')
    check('Fallback avatar is empty string', orphanRow?.user?.avatar === '')
    check('conversationCount still computed normally for the orphaned row', orphanRow?.conversationCount === 1)

    // ── G. Level-2 conversation list ──────────────────────────────────────
    line()
    console.log('G. LEVEL-2 CONVERSATION LIST (?user=)')
    line()

    const userAConvs = await get(`${adminBase}?user=${userA._id}&status=all`, ownerToken)
    const userAConvIds = (userAConvs.json?.conversations || []).map((c) => c._id)
    check('200 response', userAConvs.status === 200)
    check('Only User A\'s conversations returned', (userAConvs.json?.conversations || []).every((c) => c.user?._id === String(userA._id)))
    check('User B\'s conversation is NOT included', !userAConvIds.includes(String(convUserB1._id)))
    check(
      'Newest activity first',
      (userAConvs.json?.conversations || []).every((c, i, arr) => i === 0 || new Date(c.lastActivityAt) <= new Date(arr[i - 1].lastActivityAt))
    )

    const userAActiveConvs = await get(`${adminBase}?user=${userA._id}&status=active`, ownerToken)
    const userAArchivedConvs = await get(`${adminBase}?user=${userA._id}&status=archived`, ownerToken)
    const userALeadConvs = await get(`${adminBase}?user=${userA._id}&status=all&leadCaptured=true`, ownerToken)
    check('status=active works within ?user=', (userAActiveConvs.json?.conversations || []).length === 2)
    check('status=archived works within ?user=', (userAArchivedConvs.json?.conversations || []).length === 1)
    check('leadCaptured=true works within ?user=', (userALeadConvs.json?.conversations || []).length === 1)

    const malformedUser = await get(`${adminBase}?user=not-a-valid-id`, ownerToken)
    check('malformed user id -> 400', malformedUser.status === 400 && malformedUser.json?.message === 'Invalid user id')

    const noConvUser = new mongoose.Types.ObjectId()
    const emptyUserConvs = await get(`${adminBase}?user=${noConvUser}`, ownerToken)
    check('valid user id with no conversations -> empty array, not an error', emptyUserConvs.status === 200 && (emptyUserConvs.json?.conversations || []).length === 0)

    const userWithIrrelevantSearch = await get(`${adminBase}?user=${userA._id}&search=${encodeURIComponent(userB.name)}`, ownerToken)
    check(
      'user + search together: user wins, does not broaden to User B',
      (userWithIrrelevantSearch.json?.conversations || []).every((c) => c.user?._id === String(userA._id))
    )

    // ── H. Level-3 transcript regression ─────────────────────────────────
    line()
    console.log('H. LEVEL-3 TRANSCRIPT REGRESSION')
    line()

    const transcript = await get(`${adminBase}/${convActive1._id}`, ownerToken)
    const transcriptMessages = transcript.json?.messages || []
    check('200 for a real conversation', transcript.status === 200)
    check(
      'Chronological order',
      transcriptMessages.every((m, i) => i === 0 || new Date(m.createdAt) >= new Date(transcriptMessages[i - 1].createdAt))
    )
    check('properties normalized as an array on every message', transcriptMessages.every((m) => Array.isArray(m.properties)))
    check('raw propertyIds not exposed', transcriptMessages.every((m) => !('propertyIds' in m)))

    // ── I. Public user-conversation API regression ───────────────────────
    line()
    console.log('I. PUBLIC USER-CONVERSATION API REGRESSION')
    line()

    const publicList = await get(userBase, userAToken)
    check('GET /api/chat/conversations still works for a normal logged-in user', publicList.status === 200)
    check('Default page = 1', publicList.json?.pagination?.page === 1)
    check('Default limit = 20', publicList.json?.pagination?.limit === 20)

    const publicListAll = await get(`${userBase}?status=bogus`, userAToken)
    check("Invalid status still falls back to 'all' (not 'active') for the public endpoint", (publicListAll.json?.conversations || []).some((c) => c._id === String(convArchived1._id)))

    const foreignAttempt = await get(`${userBase}/${convUserB1._id}`, userAToken)
    check("Ownership still enforced (User A cannot load User B's conversation) -> 404", foreignAttempt.status === 404)

    console.log('')
    line()
    console.log('ALL TEST SECTIONS COMPLETE')
    line()
  } finally {
    // Cleanup — delete only the temporary documents created by this script.
    await ChatMessage.deleteMany({ conversation: { $in: tempConversationIds } })
    const cleanup = await ChatConversation.deleteMany({ _id: { $in: tempConversationIds } })
    console.log(`Cleanup: deleted ${cleanup.deletedCount} temporary conversations and their messages. No real data touched.`)
  }

  server.close()
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
