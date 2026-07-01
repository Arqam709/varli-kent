import mongoose from 'mongoose'

const siteSettingsSchema = new mongoose.Schema({
  email: { type: String, default: 'info@varlikent.com' },
  phone: { type: String, default: '+90 530 123 4567' },
  whatsapp: { type: String, default: '905301234567' },
  address: { type: String, default: 'Nispetiye Cd. No:12, Levent, 34330 Beşiktaş/İstanbul, Türkiye' },
  mapsUrl: { type: String, default: 'https://maps.google.com/?q=Levent+Besiktas+Istanbul' },
  instagram: { type: String, default: '' },
  linkedin: { type: String, default: '' },
  showroomEnabled: {
    architecture: { type: Boolean, default: true },
    interior: { type: Boolean, default: true },
    construction: { type: Boolean, default: true },
    renovation: { type: Boolean, default: true },
  },
}, { timestamps: true })

export default mongoose.model('SiteSettings', siteSettingsSchema)
