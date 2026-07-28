import mongoose from 'mongoose'

const chatConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    status: { type: String, enum: ['active', 'archived'], default: 'active' },

    messageCount: { type: Number, default: 0 },

    lastMessage: {
      text: { type: String, default: '' },
      role: { type: String, enum: ['user', 'assistant'] },
      at: { type: Date },
    },

    leadCaptured: { type: Boolean, default: false },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactSubmission', default: null },

    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

chatConversationSchema.index({ user: 1, lastActivityAt: -1 })
chatConversationSchema.index({ status: 1, lastActivityAt: -1 })

const ChatConversation = mongoose.model('ChatConversation', chatConversationSchema)
export default ChatConversation
