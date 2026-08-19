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
}, { timestamps: true })

activityLogSchema.index({ createdAt: -1 })

export default mongoose.model('ActivityLog', activityLogSchema)
