import express from 'express'
import http from 'http'
import cors from 'cors'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
import connectDB from './config/db.js'
import { ALLOWED_ORIGINS } from './config/origins.js'
import { registerRealtime } from './realtime/socket.js'
import authRoutes from './routes/auth.js'
import propertyRoutes from './routes/properties.js'
import contactRoutes from './routes/contact.js'
import userRoutes from './routes/users.js'
import uploadRoutes from './routes/upload.js'
import reviewRoutes from './routes/reviews.js'
import aboutRoutes from './routes/about.js'
import projectRoutes from './routes/projects.js'
import teamRoutes from './routes/team.js'
import partnerRoutes from './routes/partners.js'
import showroomRoutes from './routes/showroom.js'
import settingsRoutes from './routes/settings.js'
import leadRoutingRoutes from './routes/leadRouting.js'
import translateRoutes from './routes/translate.js'
import chatRoutes from './routes/chat.js'
import chatConversationRoutes from './routes/chatConversations.js'
import adminChatRoutes from './routes/adminChats.js'
import notificationRoutes from './routes/notifications.js'
import propertyAlertRoutes from './routes/propertyAlerts.js'
import pushRoutes from './routes/push.js'
import agentRoutes from './routes/agent.js'
import propertyConversationRoutes from './routes/propertyConversations.js'
import activityRoutes from './routes/activity.js'
import studioPaletteRoutes from './routes/studioPalette.js'
import activityLogger from './middleware/activityLogger.js'

dotenv.config()

const app = express()

app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL || '*',
  })
)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(activityLogger)

app.use('/api/auth', authRoutes)
app.use('/api/properties', propertyRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/users', userRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/about', aboutRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/partners', partnerRoutes)
app.use('/api/showroom', showroomRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/lead-routing', leadRoutingRoutes)
app.use('/api/translate', translateRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/chat/conversations', chatConversationRoutes)
app.use('/api/admin/chats', adminChatRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/property-alerts', propertyAlertRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/agent', agentRoutes)
app.use('/api/activity', activityRoutes)
app.use('/api/studio-palette', studioPaletteRoutes)
// Human customer↔agent messaging. Separate from /api/chat (the AI assistant)
// and from /api/agent (customers and agents share this API).
app.use('/api/property-conversations', propertyConversationRoutes)
// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Varlikent API is running' })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
})

/* ───────────────────────── Realtime ─────────────────────────
 *
 * Socket.IO attaches to the Node HTTP SERVER, not to the Express app, which is
 * why `app.listen()` below became `server.listen()`. app.listen() is itself
 * only a shorthand that creates this same http.Server internally — so nothing
 * about how Express handles requests changes. Every middleware, route, the
 * health check and the error handler above are untouched and still serve on the
 * same port. Socket.IO simply also answers upgrade requests on /socket.io.
 *
 * ── CORS is configured twice on purpose ──────────────────────────────────
 * Socket.IO does NOT read the Express cors() options set above; it performs its
 * own check during the handshake. Both now read the same allowlist from
 * config/origins.js so they cannot drift.
 *
 * RT-0 emits nothing. This block only proves an authenticated socket can exist.
 */
const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  // pingInterval / pingTimeout are left at their defaults (25s / 20s) on
  // purpose: they already sit under Render's ~100s proxy idle timeout, so the
  // built-in heartbeat is what keeps a quiet connection alive. Tuning them
  // without a measured reason is how you break that.
})

registerRealtime(io)

// How a route reaches Socket.IO later, in RT-1: `req.app.get('io')`. Chosen
// over a getIo/setIo singleton module because a route file can never import
// server.js, so there is no import cycle to create by accident.
app.set('io', io)

const PORT = process.env.PORT || 5000

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
    console.log(`[realtime] Socket.IO ready; allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
  })
})
