import mongoose from 'mongoose'

/**
 * One human conversation: a customer and the agent responsible for a listing.
 *
 * ── Deliberately NOT ChatConversation ────────────────────────────────────
 * ChatConversation is the Gemini assistant's transcript: one participant plus a
 * bot, no property, and roles of 'user' | 'assistant'. It is also readable by
 * any admin holding `view_chats`, because those conversations are with the
 * company's own software. A private customer↔agent thread is a different
 * entity with different access rules, so it gets its own collection. Adding
 * human threads to ChatConversation would have silently exposed them in the
 * Admin User Chats dashboard, which queries that collection unfiltered.
 */
const propertyConversationSchema = new mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Nullable on purpose. When a listing's agent is unassigned, the agent is
    // cleared here too — leaving the old agent's id would keep them matching
    // the participant check and reading the thread after they stopped being
    // responsible for it.
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // 'closed' means "no new messages accepted" — history stays readable. Set
    // when the property loses its agent; cleared when the customer explicitly
    // reopens the thread against a newly assigned one.
    status: { type: String, enum: ['open', 'closed'], default: 'open' },

    // Denormalized so the inbox is one indexed find with no joins. Mirrors the
    // shape ChatConversation already uses for the same reason.
    lastMessage: {
      text: { type: String, default: '' },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },

    // Set at creation so a conversation with no messages still sorts sensibly.
    lastActivityAt: { type: Date, default: Date.now },

    // Exact per-side counters, kept O(1) for the inbox and the badge by being
    // $inc-ed on send and zeroed on read. The timestamps beside them are the
    // ground truth those counters can be rebuilt from, and are what a future
    // read-receipt feature would use — storing a readAt on every message would
    // cost a bulk write on every thread open and still not give a cheap count.
    customerUnreadCount: { type: Number, default: 0, min: 0 },
    agentUnreadCount: { type: Number, default: 0, min: 0 },

    customerLastReadAt: { type: Date, default: null },
    agentLastReadAt: { type: Date, default: null },
  },
  { timestamps: true }
)

// ONE conversation per customer per property — deliberately not including
// `agent` in the key. Keying on the agent too would let a reassignment produce
// a second thread for the same customer and listing, which is the exact
// duplicate this is meant to prevent.
//
// This is also the race guard: two simultaneous "Message Agent" taps both miss
// the find, both attempt an insert, and the database rejects the loser with
// E11000 rather than creating a duplicate.
propertyConversationSchema.index({ customer: 1, property: 1 }, { unique: true })

// The two inbox queries.
propertyConversationSchema.index({ customer: 1, lastActivityAt: -1 })
propertyConversationSchema.index({ agent: 1, lastActivityAt: -1 })

// Reassignment updates every conversation for one property. The unique index
// above starts with `customer`, so it cannot serve a property-only lookup.
propertyConversationSchema.index({ property: 1 })

const PropertyConversation = mongoose.model('PropertyConversation', propertyConversationSchema)
export default PropertyConversation
