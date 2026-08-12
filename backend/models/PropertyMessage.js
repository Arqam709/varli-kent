import mongoose from 'mongoose'

/**
 * A single plain-text message inside a PropertyConversation.
 *
 * Separate documents rather than an array on the conversation: an embedded
 * array would hit Mongo's 16MB ceiling, make pagination impossible (you would
 * fetch every message to show thirty), and rewrite the whole document on every
 * send. ChatMessage already made the same call for the AI transcripts.
 */

/**
 * Long enough for a genuinely detailed question about a listing — several
 * paragraphs — and short enough that a full 50-message page stays around
 * 100KB worst case. It also bounds the denormalized preview on the
 * conversation. Enforced in the route as well as here, because schema
 * `maxlength` only runs on save()/runValidators.
 */
export const MAX_MESSAGE_LENGTH = 2000

/** How much of a message is copied into the inbox preview. */
export const MESSAGE_PREVIEW_LENGTH = 140

const propertyMessageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PropertyConversation',
      required: true,
    },

    // ALWAYS req.user._id. No route reads a sender from the request body, so
    // there is no field a client could forge.
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Plain text. Never HTML: nothing renders this with dangerouslySetInnerHTML
    // on the website, and React Native <Text> cannot execute markup at all.
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_MESSAGE_LENGTH,
    },
  },
  { timestamps: true }
)

/**
 * The pagination index.
 *
 * Cursoring on `_id` rather than `createdAt` is a deliberate choice with
 * evidence behind it: services/chatPersistence.js has to nudge its timestamps
 * 1ms apart in two places precisely because messages written in the same
 * millisecond sorted unpredictably. A createdAt cursor inherits that tie
 * problem and can skip or repeat a message at a page boundary. ObjectIds are
 * unique and monotonic, so they cannot tie.
 *
 * This single compound index serves both the filter and the sort.
 */
propertyMessageSchema.index({ conversation: 1, _id: -1 })

const PropertyMessage = mongoose.model('PropertyMessage', propertyMessageSchema)
export default PropertyMessage
