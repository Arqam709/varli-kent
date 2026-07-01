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
    enum: ['Buying', 'Selling', 'Renting', 'Renovation', 'Interior Design', 'Architecture', 'General'],
  },
  recipients: [recipientSchema],
}, { timestamps: true })

export default mongoose.model('LeadRouting', leadRoutingSchema)
