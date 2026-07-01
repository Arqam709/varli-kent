import mongoose from 'mongoose'

const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  bio: { type: String, default: '' },
  photo: { type: String, default: '' },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('TeamMember', teamMemberSchema)
