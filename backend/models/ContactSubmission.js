import mongoose from 'mongoose'

const contactSubmissionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  interestType: {
    type: String,
    enum: ['Buying', 'Selling', 'Renting', 'Renovation', 'Interior Design', 'Architecture', 'General'],
    required: true,
  },
  message: { type: String, required: true },
  status: {
    type: String,
    enum: ['New', 'Replied', 'Archived'],
    default: 'New',
  },
  source: {
    type: String,
    enum: ['website', 'ai_assistant'],
    default: 'website',
  },
  createdAt: { type: Date, default: Date.now },
})

const ContactSubmission = mongoose.model('ContactSubmission', contactSubmissionSchema)
export default ContactSubmission
