import mongoose from 'mongoose'

const partnerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  logo: { type: String, required: true },
  link: { type: String, default: '' },
  circular: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('Partner', partnerSchema)
