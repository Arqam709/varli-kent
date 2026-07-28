// backend/scripts/testChatRouteMultiConversation.js
//
// Real end-to-end HTTP verification of the redesigned chat.js contract:
// explicit conversationId in/out, multiple independent conversations per
// user, ownership enforcement, anonymous fallback. Boots the real,
// unmodified chat router in-process, signs real JWTs for existing accounts
// (no user documents are modified). Not part of the app.
//
// Usage: node scripts/testChatRouteMultiConversation.js

import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import User from '../models/User.js'
import ChatConversation from '../models/ChatConversation.js'
import chatRoutes from '../routes/chat.js'

dotenv.config()

const line = () => console.log('='.repeat(70))
const check = (label, pass) => console.log(`${pass ? '✓' : '✗'} ${label}`)

const run = async () => {
  await connectDB()

  const users = await User.find().limit(2)

  if (users.length < 2) {
    console.log('Need at least 2 User documents — found fewer. Aborting.')
    await mongoose.disconnect()
    process.exit(0)
  }

  const [userA, userB] = users
  console.log(`User A: ${userA.name} <${userA.email}>`)
  console.log(`User B: ${userB.name} <${userB.email}>`)

  const tokenA = jwt.sign({ id: userA._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' })

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

  const send = async (body, token) => {
    const started = Date.now()
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ pageKey: 'properties', ...body }),
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json, ms: Date.now() - started }
  }

  // ── A: casual, conversationId null ──────────────────────────────────────
  line()
  console.log('TEST A: casual message, conversationId: null')
  line()

  const resA = await send({ message: 'hello', conversationId: null, history: [] }, tokenA)
  console.log(`status: ${resA.status}, reply: "${resA.json?.reply}", conversationId: ${resA.json?.conversationId}`)
  check('200 response', resA.status === 200)
  check('conversationId is null (nothing meaningful yet)', resA.json?.conversationId === null)

  // ── B: meaningful search, conversationId null ───────────────────────────
  line()
  console.log('TEST B: meaningful search, conversationId: null')
  line()

  const historyAfterA = [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: resA.json?.reply },
  ]
  const messageB = 'Show me apartments for sale in Beylikduzu'

  const resB = await send(
    { message: messageB, conversationId: null, history: [...historyAfterA, { role: 'user', text: messageB }] },
    tokenA
  )
  console.log(`status: ${resB.status}, conversationId: ${resB.json?.conversationId}`)
  check('200 response', resB.status === 200)
  check('A new conversationId was returned', Boolean(resB.json?.conversationId))

  const conversationIdA = resB.json?.conversationId

  // ── C: follow-up using the returned id ──────────────────────────────────
  line()
  console.log('TEST C: follow-up using the returned conversationId (Conversation A)')
  line()

  const resC = await send({ message: 'thanks!', conversationId: conversationIdA, history: [] }, tokenA)
  console.log(`status: ${resC.status}, conversationId: ${resC.json?.conversationId}`)
  check('200 response', resC.status === 200)
  check('Same conversationId returned', resC.json?.conversationId === conversationIdA)

  const conversationAAfterC = await ChatConversation.findById(conversationIdA)
  check('Conversation A messageCount grew (>= 6)', conversationAAfterC.messageCount >= 6)

  // ── D: start another chat, conversationId null again ────────────────────
  line()
  console.log('TEST D: start ANOTHER chat, conversationId: null again (Conversation B)')
  line()

  const messageD = 'Show me villas with a sea view'
  const resD = await send({ message: messageD, conversationId: null, history: [{ role: 'user', text: messageD }] }, tokenA)
  console.log(`status: ${resD.status}, conversationId: ${resD.json?.conversationId}`)

  const conversationIdB = resD.json?.conversationId

  check('200 response', resD.status === 200)
  check('A different new conversationId was returned', Boolean(conversationIdB) && conversationIdB !== conversationIdA)

  const [convA, convB] = await Promise.all([
    ChatConversation.findById(conversationIdA),
    ChatConversation.findById(conversationIdB),
  ])
  check('Both conversations belong to user A', String(convA.user) === String(userA._id) && String(convB.user) === String(userA._id))
  check('Both conversations have status: active', convA.status === 'active' && convB.status === 'active')

  // ── E: another message to Conversation A only ───────────────────────────
  line()
  console.log('TEST E: another message to Conversation A only')
  line()

  const bMessageCountBeforeE = (await ChatConversation.findById(conversationIdB)).messageCount

  const resE = await send({ message: 'any with parking?', conversationId: conversationIdA, history: [] }, tokenA)
  const convAAfterE = await ChatConversation.findById(conversationIdA)
  const convBAfterE = await ChatConversation.findById(conversationIdB)

  check('200 response', resE.status === 200)
  check('Same conversationId (A) returned', resE.json?.conversationId === conversationIdA)
  check('Conversation A messageCount grew', convAAfterE.messageCount > conversationAAfterC.messageCount)
  check('Conversation B untouched', convBAfterE.messageCount === bMessageCountBeforeE)

  // ── F: another message to Conversation B only ───────────────────────────
  line()
  console.log('TEST F: another message to Conversation B only')
  line()

  const aMessageCountBeforeF = convAAfterE.messageCount

  const resF = await send({ message: 'what about apartments too?', conversationId: conversationIdB, history: [] }, tokenA)
  const convAAfterF = await ChatConversation.findById(conversationIdA)
  const convBAfterF = await ChatConversation.findById(conversationIdB)

  check('200 response', resF.status === 200)
  check('Same conversationId (B) returned', resF.json?.conversationId === conversationIdB)
  check('Conversation B messageCount grew', convBAfterF.messageCount > convBAfterE.messageCount)
  check('Conversation A untouched', convAAfterF.messageCount === aMessageCountBeforeF)

  // ── G: malformed conversationId ──────────────────────────────────────────
  line()
  console.log('TEST G: malformed conversationId')
  line()

  const resG = await send({ message: 'hello again', conversationId: 'not-a-valid-object-id' }, tokenA)
  console.log(`status: ${resG.status}, message: "${resG.json?.message}", response time: ${resG.ms}ms`)

  check('HTTP 400', resG.status === 400)
  check("message: 'Invalid conversation id'", resG.json?.message === 'Invalid conversation id')
  check('Responded fast (< 500ms — no Gemini/search pipeline ran)', resG.ms < 500)
  console.log(
    'Structural guarantee: in routes/chat.js the ObjectId/ownership check runs immediately after the ' +
      "'message is required' check, before parsePropertyMessageWithGemini() or any search code is ever reached."
  )

  // ── H: another user's conversationId ─────────────────────────────────────
  line()
  console.log("TEST H: user A sends userB's real conversationId")
  line()

  const foreignConversation = await ChatConversation.create({ user: userB._id, status: 'active' })
  const foreignCountBefore = foreignConversation.messageCount

  const resH = await send({ message: 'trying to hijack', conversationId: String(foreignConversation._id) }, tokenA)
  console.log(`status: ${resH.status}, message: "${resH.json?.message}"`)

  const foreignAfter = await ChatConversation.findById(foreignConversation._id)
  const convAAfterH = await ChatConversation.findById(conversationIdA)

  check('HTTP 404', resH.status === 404)
  check("message: 'Conversation not found'", resH.json?.message === 'Conversation not found')
  check("Foreign conversation's messageCount unchanged", foreignAfter.messageCount === foreignCountBefore)
  check("User A's own Conversation A unchanged", convAAfterH.messageCount === convAAfterF.messageCount)

  // ── I: anonymous request ─────────────────────────────────────────────────
  line()
  console.log('TEST I: anonymous request (no Authorization header)')
  line()

  const resI = await send({ message: 'hello, anonymous here', conversationId: null }, null)
  console.log(`status: ${resI.status}, reply: "${resI.json?.reply}", conversationId: ${resI.json?.conversationId}`)

  check('200 response — chatbot still responds', resI.status === 200)
  check('conversationId is null', resI.json?.conversationId === null)
  check('success: true', resI.json?.success === true)

  // Cleanup: archive (not delete) every conversation this script created.
  await ChatConversation.updateMany(
    { _id: { $in: [conversationIdA, conversationIdB, foreignConversation._id] } },
    { $set: { status: 'archived' } }
  )

  console.log('')
  line()
  console.log('Done. All conversations created by this script were archived, not deleted.')
  console.log(`Conversation A: ${conversationIdA}`)
  console.log(`Conversation B: ${conversationIdB}`)
  console.log(`Foreign conversation (user B): ${foreignConversation._id}`)
  line()

  server.close()
  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
