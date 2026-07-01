import mongoose from 'mongoose'

const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, default: '' },
  avatar: { type: String, default: '' },
  order: { type: Number, default: 0 },
})

const contentBlockSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  paragraphs: [{ type: String }],
  image: { type: String, default: '' },
  imagePosition: { type: String, default: 'right' },
  order: { type: Number, default: 0 },
})

const statSchema = new mongoose.Schema({
  value: { type: String, default: '' },
  label: { type: String, default: '' },
  order: { type: Number, default: 0 },
})

const aboutContentSchema = new mongoose.Schema(
  {
    heroLabel: { type: String, default: 'Our Story' },
    heroHeading: { type: String, default: 'About Varlikent' },
    heroSubtext: { type: String, default: "Istanbul's premier luxury real estate agency, connecting discerning buyers and renters with exceptional properties." },
    missionLabel: { type: String, default: 'Our Mission' },
    missionHeading: { type: String, default: 'A refined approach to luxury real estate.' },
    missionParagraph1: { type: String, default: "We bring together market insight, local expertise, and exceptional service to help buyers and sellers make confident, premium decisions across Istanbul's most desirable neighborhoods." },
    missionParagraph2: { type: String, default: "Founded with a passion for Istanbul's unique architectural heritage and its exciting modern developments, Varlikent has been a trusted partner for international investors, expatriates, and local families seeking their ideal property." },
    missionImage: { type: String, default: '' },
    teamLabel: { type: String, default: 'Our Team' },
    teamHeading: { type: String, default: 'Meet Our Experts' },
    stats: [statSchema],
    team: [teamMemberSchema],
    contentBlocks: [contentBlockSchema],
  },
  { timestamps: true }
)

export default mongoose.model('AboutContent', aboutContentSchema)
