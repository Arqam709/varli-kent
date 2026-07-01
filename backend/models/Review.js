import mongoose from 'mongoose'

const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: '' },
    text: { type: String, required: true },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    avatar: { type: String, default: '' },
    visible: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export default mongoose.model('Review', reviewSchema)
