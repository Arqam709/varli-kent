import mongoose from 'mongoose'

const siteSettingsSchema = new mongoose.Schema({
  email: { type: String, default: 'info@varlikent.com' },
  phone: { type: String, default: '+90 530 123 4567' },
  whatsapp: { type: String, default: '905301234567' },
  address: { type: String, default: 'Nispetiye Cd. No:12, Levent, 34330 Beşiktaş/İstanbul, Türkiye' },
  mapsUrl: { type: String, default: 'https://maps.google.com/?q=Levent+Besiktas+Istanbul' },
  instagram: { type: String, default: '' },
  linkedin: { type: String, default: '' },
  // Room visualization (Design My Space → Visualize in My Room). OFF until a
  // provider is integrated: with it on and no worker running, requests would
  // queue and never finish. Owner-only, through PUT /api/settings.
  designGenerationsEnabled: { type: Boolean, default: false },
  showroomEnabled: {
    architecture: { type: Boolean, default: true },
    interior: { type: Boolean, default: true },
    construction: { type: Boolean, default: true },
    renovation: { type: Boolean, default: true },
  },
}, { timestamps: true })

export default mongoose.model('SiteSettings', siteSettingsSchema)
