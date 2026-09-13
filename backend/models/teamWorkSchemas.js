import mongoose from 'mongoose'
import { localizedField } from '../utils/localizedField.js'
import { TEAM_WORK_LIMITS as limits, WORK_FILE_TYPES, validTeamUrl, validWorkText } from '../utils/teamWork.js'

const prose = max => ({ ...localizedField(), validate: value => validWorkText(value, max) })
const mediaUrl = required => ({ type: String, required, default: required ? undefined : '', validate: validTeamUrl })
const dimension = { type: Number, default: 0, min: 0, max: 4096, validate: Number.isSafeInteger }

export const workItemSchema = new mongoose.Schema({
  url: mediaUrl(true), cropUrl: mediaUrl(false), width: dimension, height: dimension,
  title: prose(limits.itemTitle), description: prose(limits.itemDescription),
})
export const workSectionSchema = new mongoose.Schema({
  label: prose(limits.label), title: prose(limits.title), description: prose(limits.description), conclusion: prose(limits.conclusion),
  items: { type: [workItemSchema], default: [], validate: value => value.length <= limits.items },
  order: { type: Number, default: 0, min: 0, max: 10000, validate: Number.isSafeInteger },
})
export const workFileSchema = new mongoose.Schema({
  url: mediaUrl(true), name: { type: String, default: '', maxlength: 200 },
  fileType: { type: String, default: '', enum: ['', ...WORK_FILE_TYPES] },
})
