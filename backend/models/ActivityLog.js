import mongoose from 'mongoose'

const activityLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: { type: String, required: true },
  actorEmail: { type: String, required: true },
  actorRole: { type: String, required: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  resource: { type: String, required: true },
  action: { type: String, required: true },
  statusCode: { type: Number, required: true },
  // Optional, and absent on everything middleware/activityLogger.js writes.
  // Set by services that record an action explicitly and know who it was
  // done TO — owner removal (services/ownerRemoval.js). `details` is a short
  // human-readable note; it never holds a code, a hash or any other secret.
  targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetName: { type: String },
  details: { type: String },
}, { timestamps: true })

activityLogSchema.index({ createdAt: -1 })

export default mongoose.model('ActivityLog', activityLogSchema)
