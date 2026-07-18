// backend/scripts/testAdminChatsRegression.js
//
// Regression check: confirms the unmodified admin chat APIs still work
// correctly after the conversationId redesign, and specifically that they
// correctly display multiple simultaneously-active conversations for the
// same user (previously impossible under the single-active constraint).
// Does not modify routes/adminChats.js — only calls it, read-only. Not
// part of the app.
//
// Usage: node scripts/testAdminChatsRegression.js

import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import ChatMessage from '../models/ChatMessage.js'
import adminChatRoutes from '../routes/adminChats.js'

dotenv.config()

const line = () => console.log('='.repeat(70))
const check = (label, pass) => console.log(`${pass ? '✓' : '✗'} ${label}`)

const run = async () => {
  await connectDB()

  const owner = await User.findOne({ role: 'owner' })

  if (!owner) {
    console.log('No owner-role user exists — cannot run this test.')
    await mongoose.disconnect()
    process.exit(0)
  }

  console.log(`Owner: ${owner.name} <${owner.email}>`)

  const ownerToken = jwt.sign({ id: owner._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })

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

  const call = async (path) => {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }

  line()
  console.log('SETUP: create two fresh ACTIVE conversations for the owner (simulating the new multi-conversation reality)')
  line()

  const convX = await ChatConversation.create({
    user: owner._id,
    status: 'active',
    messageCount: 2,
    lastMessage: { text: 'Conversation X — regression check', role: 'assistant', at: new Date() },
  })
  const convY = await ChatConversation.create({
    user: owner._id,
    status: 'active',
    messageCount: 2,
    lastMessage: { text: 'Conversation Y — regression check', role: 'assistant', at: new Date() },
  })
  await ChatMessage.insertMany([
    { conversation: convX._id, role: 'user', text: 'Regression test message X' },
    { conversation: convX._id, role: 'assistant', text: 'Regression test reply X' },
  ])

  console.log(`Created Conversation X: ${convX._id}`)
  console.log(`Created Conversation Y: ${convY._id}`)

  line()
  console.log('TEST: GET /api/admin/chats?status=active shows BOTH as separate rows for the same user')
  line()

  const listRes = await call('?status=active')
  const ownerRows = (listRes.json?.conversations || []).filter((c) => c.user?._id === String(owner._id))
  const hasX = ownerRows.some((c) => c._id === String(convX._id))
  const hasY = ownerRows.some((c) => c._id === String(convY._id))

  console.log(`status: ${listRes.status}, active rows for this owner: ${ownerRows.length}`)
  check('200 response', listRes.status === 200)
  check('Conversation X appears in the active list', hasX)
  check('Conversation Y appears in the active list', hasY)
  check('Both are separate, simultaneously-active rows for one user', hasX && hasY)

  line()
  console.log('TEST: GET /api/admin/chats/:id — detail endpoint still loads messages correctly')
  line()

  const detailRes = await call(`/${convX._id}`)
  console.log(`status: ${detailRes.status}, messages: ${detailRes.json?.messages?.length}`)

  check('200 response', detailRes.status === 200)
  check('Correct conversation returned', detailRes.json?.conversation?._id === String(convX._id))
  check('User populated', Boolean(detailRes.json?.conversation?.user?.email))
  check('Messages loaded (2)', detailRes.json?.messages?.length === 2)

  // Cleanup: archive (not delete) the synthetic conversations this script created.
  await ChatConversation.updateMany({ _id: { $in: [convX._id, convY._id] } }, { $set: { status: 'archived' } })

  console.log('')
  line()
  console.log('Done. Both regression-test conversations archived, not deleted.')
  line()

  server.close()
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
