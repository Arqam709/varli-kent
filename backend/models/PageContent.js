import mongoose from 'mongoose'


const pageContentSchema = new mongoose.Schema(
  {
    // The registry key ('home', 'interior-design', …). Unique because one
    // page is one document — every write is an upsert onto the same row.
    pageKey: { type: String, required: true, unique: true, trim: true },
    fields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    sections: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
)

export default mongoose.model('PageContent', pageContentSchema)
