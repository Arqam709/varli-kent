import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import connectDB from './config/db.js'
import authRoutes from './routes/auth.js'
import propertyRoutes from './routes/properties.js'
import contactRoutes from './routes/contact.js'
import userRoutes from './routes/users.js'
import uploadRoutes from './routes/upload.js'
import reviewRoutes from './routes/reviews.js'
import aboutRoutes from './routes/about.js'
import projectRoutes from './routes/projects.js'
import teamRoutes from './routes/team.js'
import showroomRoutes from './routes/showroom.js'
import settingsRoutes from './routes/settings.js'
import leadRoutingRoutes from './routes/leadRouting.js'
import translateRoutes from './routes/translate.js'
import chatRoutes from './routes/chat.js'
import chatConversationRoutes from './routes/chatConversations.js'
import adminChatRoutes from './routes/adminChats.js'

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

app.use('/api/auth', authRoutes)
app.use('/api/properties', propertyRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/users', userRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/about', aboutRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/showroom', showroomRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/lead-routing', leadRoutingRoutes)
app.use('/api/translate', translateRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/chat/conversations', chatConversationRoutes)
app.use('/api/admin/chats', adminChatRoutes)
// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Varlikent API is running' })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' })
})

const PORT = process.env.PORT || 5000

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
  })
})
