import mongoose from 'mongoose'
import { localizedField } from '../utils/localizedField.js'

/*
 * Wave 12A2 — dynamic content localization, reusing the Wave 12A1 foundation.
 *
 * `caption` is the only user-facing prose on this model, so it is the only
 * field that becomes localized. It is translated once at admin save time
 * (routes/showroom.js) and read back per language by ShowroomCarousel.
 *
 * Mixed, not a strict sub-schema — see utils/localizedField.js. Existing rows
 * store `caption` as a plain string and must keep rendering without a
 * migration.
 *
 * Deliberately NOT localized:
 *   `serviceType`  a machine enum the public route filters on
 *   `url`          a media URL
 *   `style`        a category filter value, matched exactly against
 *                  req.query.style — translating it would break that filter
 *   `order`        a number
 *   `visible`      a boolean
 */
const showroomImageSchema = new mongoose.Schema({
  serviceType: { type: String, required: true, enum: ['architecture', 'interior', 'construction', 'renovation'] },
  url: { type: String, required: true },
  caption: localizedField(),
  style: { type: String, default: '' },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('ShowroomImage', showroomImageSchema)
