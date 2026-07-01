import mongoose from 'mongoose'

const phaseSchema = new mongoose.Schema({
  label: { type: String, required: true },
  pct: { type: Number, default: 0, min: 0, max: 100 },
  order: { type: Number, default: 0 },
})

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    location: { type: String, default: '' },
    completion: { type: String, default: '' },
    status: { type: String, enum: ['active', 'completed', 'upcoming'], default: 'active' },
    visible: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    phases: [phaseSchema],
  },
  { timestamps: true }
)

export default mongoose.model('Project', projectSchema)
