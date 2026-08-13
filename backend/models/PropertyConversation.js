import mongoose from 'mongoose'


const propertyConversationSchema = new mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    status: { type: String, enum: ['open', 'closed'], default: 'open' },

    lastMessage: {
      text: { type: String, default: '' },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },

    // Set at creation so a conversation with no messages still sorts sensibly.
    lastActivityAt: { type: Date, default: Date.now },

    customerUnreadCount: { type: Number, default: 0, min: 0 },
    agentUnreadCount: { type: Number, default: 0, min: 0 },

    customerLastReadAt: { type: Date, default: null },
    agentLastReadAt: { type: Date, default: null },
  },
  { timestamps: true }
)

propertyConversationSchema.index({ customer: 1, property: 1 }, { unique: true })


propertyConversationSchema.index({ customer: 1, lastActivityAt: -1 })
propertyConversationSchema.index({ agent: 1, lastActivityAt: -1 })

propertyConversationSchema.index({ property: 1 })

const PropertyConversation = mongoose.model('PropertyConversation', propertyConversationSchema)
export default PropertyConversation
