import mongoose from 'mongoose'
import { CONTACT_SOURCES } from '../config/contactInterests.js'

const contactSubmissionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  // The canonical VALUE of a registered contact interest ('Interior Design'),
  // never an id or a translated label.
  //
  // No enum since Phase 1B: admins create interests at runtime, and a fixed
  // list here would reject them on save. Registration is enforced where
  // submissions enter — POST /api/contact checks the value against the
  // ContactInterest collection (enabled OR disabled) via
  // services/contactInterests.js. The chatbot lead flow writes only built-in
  // values. Existing rows are untouched.
  interestType: {
    type: String,
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
    // 'mobile' was added in Phase 1. Additive: every existing row keeps its
    // value, and a client that sends nothing still gets 'website'.
    enum: [...CONTACT_SOURCES],
    default: 'website',
  },
  
  createdAt: { type: Date, default: Date.now },
})

const ContactSubmission = mongoose.model('ContactSubmission', contactSubmissionSchema)
export default ContactSubmission
