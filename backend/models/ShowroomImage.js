import mongoose from 'mongoose'

const showroomImageSchema = new mongoose.Schema({
  serviceType: { type: String, required: true, enum: ['architecture', 'interior', 'construction', 'renovation'] },
  url: { type: String, required: true },
  caption: { type: String, default: '' },
  style: { type: String, default: '' },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('ShowroomImage', showroomImageSchema)
