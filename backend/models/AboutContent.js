import mongoose from 'mongoose'
import { localizedField } from '../utils/localizedField.js'

const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: localizedField(),
  avatar: { type: String, default: '' },
  order: { type: Number, default: 0 },
})

const contentBlockSchema = new mongoose.Schema({
  heading: localizedField(),
  // Each paragraph is independently localized, so paragraphs stays an array
  // of localized values rather than one localized blob.
  paragraphs: [mongoose.Schema.Types.Mixed],
  image: { type: String, default: '' },
  imagePosition: { type: String, default: 'right' },
  order: { type: Number, default: 0 },
})

const statSchema = new mongoose.Schema({
  value: { type: String, default: '' },
  label: localizedField(),
  order: { type: Number, default: 0 },
})

const aboutContentSchema = new mongoose.Schema(
  {
    heroLabel: localizedField('Our Story'),
    heroHeading: localizedField('About Varlikent'),
    heroSubtext: localizedField("Istanbul's premier luxury real estate agency, connecting discerning buyers and renters with exceptional properties."),
    missionLabel: localizedField('Our Mission'),
    missionHeading: localizedField('A refined approach to luxury real estate.'),
    missionParagraph1: localizedField("We bring together market insight, local expertise, and exceptional service to help buyers and sellers make confident, premium decisions across Istanbul's most desirable neighborhoods."),
    missionParagraph2: localizedField("Founded with a passion for Istanbul's unique architectural heritage and its exciting modern developments, Varlikent has been a trusted partner for international investors, expatriates, and local families seeking their ideal property."),
    missionImage: { type: String, default: '' },
    teamLabel: localizedField('Our Team'),
    teamHeading: localizedField('Meet Our Experts'),
    stats: [statSchema],
    team: [teamMemberSchema],
    contentBlocks: [contentBlockSchema],
  },
  { timestamps: true }
)

export default mongoose.model('AboutContent', aboutContentSchema)
