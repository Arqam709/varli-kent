import mongoose from 'mongoose'

const recipientSchema = new mongoose.Schema({
  email: { type: String, required: true },
  label: { type: String, default: '' },
}, { _id: false })

const leadRoutingSchema = new mongoose.Schema({
  interestType: {
    type: String,
    required: true,
    unique: true,
    // The canonical value of a contact interest. No enum since Phase 1B, so
    // admin-created interests can be routed without a code change. The only
    // write path, PUT /api/lead-routing, accepts registered interests only
    // (services/contactInterests.js). Rows are never deleted when an interest
    // is disabled.
  },
  recipients: [recipientSchema],
}, { timestamps: true })

export default mongoose.model('LeadRouting', leadRoutingSchema)
