import mongoose from 'mongoose'

const chatMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },

    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true },

    propertyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],

    pageKey: { type: String, default: null },

    event: {
      type: String,
      enum: [
        'property_search',
        'properties_shown',
        'clarification_requested',
        'lead_flow_started',
        'lead_captured',
        'no_results',
        'error',
      ],
      default: null,
    },
  },
  { timestamps: true }
)

chatMessageSchema.index({ conversation: 1, createdAt: 1 })

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema)
export default ChatMessage
