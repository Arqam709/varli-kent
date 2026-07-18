// backend/scripts/testAdminChatsApi.js
//
// Temporary manual verification script for routes/adminChats.js. Boots the
// real, unmodified admin chats router in an isolated in-process Express
// server on an ephemeral port, signs real JWTs for existing accounts (no
// user documents are modified), and drives every case from the approved
// test matrix over real HTTP. Not part of the app.
//
// Usage: node scripts/testAdminChatsApi.js

import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import adminChatRoutes from '../routes/adminChats.js'

dotenv.config()

const line = () => console.log('='.repeat(70))
const check = (label, pass) => console.log(`${pass ? '✓' : '✗'} ${label}`)

const run = async () => {
  await connectDB()

  const owner = await User.findOne({ role: 'owner' })
  const plainUser = await User.findOne({ role: 'user' })

  if (!owner) {
    console.log('No owner-role user exists — cannot run this test.')
    await mongoose.disconnect()
    process.exit(0)
  }

  console.log(`Owner account:     ${owner.name} <${owner.email}> (permissions: ${JSON.stringify(owner.permissions)})`)
  if (plainUser) {
    console.log(`Plain user account: ${plainUser.name} <${plainUser.email}> (role: user)`)
  }
  console.log('No user documents are modified by this script.')

  const ownerToken = jwt.sign({ id: owner._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })
  const plainUserToken = plainUser
    ? jwt.sign({ id: plainUser._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })
    : null

  const app = express()
  app.use(express.json())
  app.use('/api/admin/chats', adminChatRoutes)
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
  })

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/chats`

  const call = async (path, token) => {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }

  // ── A. Basic list ──────────────────────────────────────────────────────
  line()
  console.log('A. GET /api/admin/chats (owner token)')
  line()

  const listRes = await call('?status=all', ownerToken)
  console.log(`status: ${listRes.status}`)
  console.log(`conversations returned: ${listRes.json?.conversations?.length}`)
  console.log(`pagination: ${JSON.stringify(listRes.json?.pagination)}`)

  check('Returns 200', listRes.status === 200)
  check('Returns at least one conversation', (listRes.json?.conversations?.length || 0) > 0)
  check(
    'User is populated (name/email present)',
    Boolean(listRes.json?.conversations?.[0]?.user?.name && listRes.json?.conversations?.[0]?.user?.email)
  )
  check(
    'No transcript included in list rows',
    listRes.json?.conversations?.every((c) => c.messages === undefined && c._doc === undefined)
  )
  check(
    'Pagination totalCount matches DB count for this filter',
    listRes.json?.pagination?.totalCount === (await ChatConversation.countDocuments({}))
  )

  const sampleConversationId = listRes.json?.conversations?.[0]?._id

  // ── B. Filtering ────────────────────────────────────────────────────────
  line()
  console.log('B. Filtering')
  line()

  const activeOnly = await call('?status=active', ownerToken)
  const archivedOnly = await call('?status=archived', ownerToken)
  check(
    'status=active only returns active conversations',
    activeOnly.json?.conversations?.every((c) => c.status === 'active')
  )
  check(
    'status=archived only returns archived conversations',
    archivedOnly.json?.conversations?.every((c) => c.status === 'archived')
  )
  console.log(`  active: ${activeOnly.json?.conversations?.length}, archived: ${archivedOnly.json?.conversations?.length}, all: ${listRes.json?.conversations?.length}`)

  const invalidStatus = await call('?status=bogus', ownerToken)
  check(
    'invalid status falls back to active',
    invalidStatus.json?.conversations?.every((c) => c.status === 'active')
  )

  const leadTrue = await call('?status=all&leadCaptured=true', ownerToken)
  const leadFalse = await call('?status=all&leadCaptured=false', ownerToken)
  check('leadCaptured=true only returns leadCaptured:true rows', leadTrue.json?.conversations?.every((c) => c.leadCaptured === true))
  check('leadCaptured=false only returns leadCaptured:false rows', leadFalse.json?.conversations?.every((c) => c.leadCaptured === false))
  console.log(`  leadCaptured=true: ${leadTrue.json?.conversations?.length}, leadCaptured=false: ${leadFalse.json?.conversations?.length}`)

  const searchByName = await call(`?status=all&search=${encodeURIComponent(owner.name)}`, ownerToken)
  const searchByEmail = await call(`?status=all&search=${encodeURIComponent(owner.email)}`, ownerToken)
  check('search by name finds the matching user\'s conversations', (searchByName.json?.conversations?.length || 0) > 0)
  check('search by email finds the matching user\'s conversations', (searchByEmail.json?.conversations?.length || 0) > 0)

  const searchNoMatch = await call('?status=all&search=zzzznobodyhasthisnamezzzz', ownerToken)
  check('search with no matches returns an empty list, not an error', searchNoMatch.status === 200 && searchNoMatch.json?.conversations?.length === 0)

  const futureFrom = await call('?status=all&from=2999-01-01', ownerToken)
  check('a future from-date excludes everything', (futureFrom.json?.conversations?.length || 0) === 0)

  const invalidDate = await call('?status=all&from=not-a-date', ownerToken)
  check('an invalid date bound is ignored, not an error', invalidDate.status === 200)

  // ── C. Pagination ──────────────────────────────────────────────────────
  line()
  console.log('C. Pagination')
  line()

  const defaults = await call('', ownerToken)
  check('default page is 1', defaults.json?.pagination?.page === 1)
  check('default limit is 20', defaults.json?.pagination?.limit === 20)

  const invalidPage = await call('?page=-5', ownerToken)
  check('invalid page falls back to 1', invalidPage.json?.pagination?.page === 1)

  const overLimit = await call('?limit=500', ownerToken)
  check('limit above 50 clamps to 50', overLimit.json?.pagination?.limit === 50)

  const zeroLimit = await call('?limit=0', ownerToken)
  check('limit of 0 clamps to 1', zeroLimit.json?.pagination?.limit === 1)

  // ── D. Detail endpoint ──────────────────────────────────────────────────
  line()
  console.log('D. GET /api/admin/chats/:id')
  line()

  const detail = await call(`/${sampleConversationId}`, ownerToken)
  console.log(`status: ${detail.status}`)
  console.log(`messages: ${detail.json?.messages?.length}`)

  check('Returns 200 for a real conversation id', detail.status === 200)
  check('Returned conversation _id matches the requested id', detail.json?.conversation?._id === sampleConversationId)
  check('User is populated on the conversation', Boolean(detail.json?.conversation?.user?.email))
  check(
    'lead is present as a key (null or populated object)',
    'lead' in (detail.json?.conversation || {})
  )

  const messages = detail.json?.messages || []
  const chronological = messages.every((m, i) => i === 0 || new Date(m.createdAt) >= new Date(messages[i - 1].createdAt))
  check('Messages are in chronological order', chronological)

  const userMessagesHaveEmptyProperties = messages.filter((m) => m.role === 'user').every((m) => Array.isArray(m.properties) && m.properties.length === 0)
  check('User messages return properties: []', userMessagesHaveEmptyProperties)

  const assistantWithProps = messages.find((m) => m.role === 'assistant' && m.event === 'properties_shown')
  check(
    'Assistant properties_shown message has populated, lightweight property fields',
    Boolean(
      assistantWithProps &&
        assistantWithProps.properties.length > 0 &&
        'title' in assistantWithProps.properties[0] &&
        'district' in assistantWithProps.properties[0] &&
        !('description' in assistantWithProps.properties[0])
    )
  )

  const noRawPropertyIds = messages.every((m) => !('propertyIds' in m))
  check('Raw propertyIds key is not exposed on normalized messages', noRawPropertyIds)

  // ── E. Error cases ──────────────────────────────────────────────────────
  line()
  console.log('E. Error cases')
  line()

  const malformed = await call('/not-a-valid-object-id', ownerToken)
  check('Malformed id returns 400', malformed.status === 400 && malformed.json?.message === 'Invalid conversation id')

  const missingId = new mongoose.Types.ObjectId().toString()
  const missing = await call(`/${missingId}`, ownerToken)
  check('Valid but missing id returns 404', missing.status === 404 && missing.json?.message === 'Conversation not found')

  const noToken = await call('', null)
  check('No token returns 401', noToken.status === 401)

  const badToken = await call('', 'this-is-not-a-real-jwt')
  check('Malformed token returns 401', badToken.status === 401)

  if (plainUserToken) {
    const asPlainUser = await call('', plainUserToken)
    check('A user-role account (not owner/admin) is rejected with 403', asPlainUser.status === 403)
  } else {
    console.log('  (skipped: no user-role account exists to test this)')
  }

  console.log('  (skipped: no admin-role account exists in this database yet, so the')
  console.log('   admin-without-view_chats 403 path cannot be exercised without creating')
  console.log('   or modifying a real user account, which this script does not do.)')

  const ownerAccessCheck = await call('', ownerToken)
  check(
    "Owner can access without 'view_chats' explicitly in their permissions array",
    ownerAccessCheck.status === 200 && !owner.permissions.includes('view_chats')
  )

  server.close()
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
