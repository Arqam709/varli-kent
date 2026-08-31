import mongoose from 'mongoose'
import { localizedField } from '../utils/localizedField.js'

/*
 * Wave 12A2 — dynamic content localization, reusing the Wave 12A1 foundation.
 *
 * Wave 14B adds `title` and `detailText` alongside it. All three are
 * admin-authored prose shown to visitors, so all three are translated once
 * at admin save time (routes/showroom.js) and read back per language by
 * ShowroomCarousel and its lightbox.
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
  // The short line under a card in the carousel.
  caption: localizedField(),

  // ── Wave 14B: rich showroom ────────────────────────────────────────
  // Both optional, both without a content default, so a record created
  // before this wave stays valid and simply renders without them. No
  // migration. `title` heads the lightbox detail panel; `detailText` is the
  // longer description beside the expanded media.
  title: localizedField(),
  detailText: localizedField(),

  style: { type: String, default: '' },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('ShowroomImage', showroomImageSchema)
