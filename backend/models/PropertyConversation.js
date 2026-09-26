import mongoose from 'mongoose'


/**
 * One participant's PRIVATE view of a shared conversation.
 *
 * Keyed by user rather than by side, so a reassignment never hands one
 * agent's clear or hidden-message state to the next agent.
 *
 * Never serialized as such: it only changes which messages GET /:id/messages
 * returns to this user, and which preview their inbox row shows.
 */
const participantViewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // "Delete conversation": messages with _id <= this are no longer part of
    // this user's history. An ObjectId cutoff rather than a timestamp, for the
    // same reason pagination cursors on _id — ids are unique and monotonic, so
    // a message written in the same millisecond cannot land on the wrong side.
    clearedThrough: { type: mongoose.Schema.Types.ObjectId, default: null },

    // This user's inbox preview, when their visible history ends somewhere
    // other than the shared lastMessage (they hid the newest message). Valid
    // ONLY while lastMessage.message still equals previewThrough: the next
    // message sent by anyone moves lastMessage on, and that new message is
    // visible to everyone, so the override simply stops applying.
    // A valid override with preview: null means "nothing visible to this user".
    previewThrough: { type: mongoose.Schema.Types.ObjectId, default: null },
    preview: {
      type: new mongoose.Schema(
        {
          text: { type: String, default: '' },
          sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { _id: false }
)

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
      // The message this preview describes. Lets a participant's private
      // preview (participantViews) tell whether it is still current. Not
      // serialized; older rows lack it until their next message.
      message: { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    // Users who removed this conversation from their inbox ("Delete
    // conversation", or hiding their last visible message). EVERY new message
    // resets this to [], which is what brings the row back on new activity.
    // A plain array so the inbox excludes it in the query itself.
    hiddenFromInbox: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: undefined },

    participantViews: { type: [participantViewSchema], default: undefined },

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
