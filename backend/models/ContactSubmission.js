import mongoose from 'mongoose'

const contactSubmissionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  // 'Construction' and 'Troubleshoot' are deliberately separate, not synonyms:
  // Construction is a visitor commissioning a new build; Troubleshoot is a
  // visitor reporting a problem with existing work and asking for technical
  // support. They route to different LeadRouting recipients, so collapsing
  // them would send support requests to the sales/build inbox.
  interestType: {
    type: String,
    enum: ['Buying', 'Selling', 'Renting', 'Renovation', 'Interior Design', 'Architecture', 'Construction', 'General', 'Troubleshoot'],
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
