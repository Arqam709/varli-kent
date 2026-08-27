import mongoose from 'mongoose'
import {
  isLocalizedObject,
  isUsableText,
  localizedField,
  resolveLocalized,
} from '../utils/localizedField.js'

const normalizeTeamRole = (value) =>
  typeof value === 'string' ? value.trim() : value

const isValidTeamRole = (value) => {
  if (typeof value === 'string') return isUsableText(value)
  return isLocalizedObject(value) && isUsableText(resolveLocalized(value))
}

/*
 * Wave 12A2 — dynamic content localization, reusing the Wave 12A1 foundation.
 *
 * `role` and `bio` are translated once at admin save time (routes/team.js)
 * and stored as { sourceLang, en, tr, ar, de, ru, ur }. TeamPage reads
 * value[language] with no translation request of its own.
 *
 * localizedField() is Mixed rather than a strict sub-schema, for the reason
 * documented in utils/localizedField.js: every TeamMember row in this
 * database stores these as plain strings today, and Mongoose cannot cast a
 * string to a subdocument — pointing a sub-schema at them would empty the
 * Team page out. Both shapes hydrate; resolveLocalized() gives them one
 * meaning, so no migration is required for correctness.
 *
 * Deliberately NOT localized:
 *   `name`   a person's name is not translated
 *   `photo`  a URL
 *   `order`  a number
 *   `visible` a boolean
 *
 * `role` keeps its old required + trim contract. Mixed needs an explicit
 * validator so an empty, arbitrary, or poison-only object is not accepted
 * merely because it is present. The route trims before translation, while
 * the schema setter preserves trimming for direct model writes.
 */
const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  role: {
    ...localizedField(),
    required: true,
    set: normalizeTeamRole,
    validate: {
      validator: isValidTeamRole,
      message: 'Role must contain usable text',
    },
  },
  bio: localizedField(),
  photo: { type: String, default: '' },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('TeamMember', teamMemberSchema)
