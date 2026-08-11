import mongoose from 'mongoose'

// A saved description of the kind of property a user is waiting for.
//
// Deliberately SEPARATE from User.notificationsLastSeenAt. That field records
// what the user has already seen; this records what they care about. Merging
// them would conflate "read state" with "interest", and neither could then
// change without disturbing the other.
//
// Every criterion is optional and they combine with AND: a property matches
// only if it satisfies each filter the alert actually sets. An alert with no
// criteria would match everything — i.e. duplicate the All New feed — so the
// route rejects that rather than storing it.
const propertyAlertSchema = new mongoose.Schema({
  // Ownership. Always written from req.user._id, never from request input.
  // Indexed because every read is scoped by it.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // The enums below are copied from Property so both sides speak the same
  // vocabulary. A second naming system would make matching impossible.
  listingType: { type: String, enum: ['Sale', 'Rent'] },

  // Free string, exactly like Property.district. Matching is an exact,
  // case-sensitive comparison — the same rule the properties filter uses —
  // and the mobile picker is populated from GET /api/properties/areas, so
  // the stored value always comes from real inventory rather than a
  // hardcoded list that could drift.
  district: { type: String, trim: true },

  propertyType: {
    type: String,
    enum: ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm'],
  },

  // Prices are stored in TRY throughout Property, so a plain numeric range is
  // directly comparable.
  minPrice: { type: Number, min: 0 },
  maxPrice: { type: Number, min: 0 },

  // A MINIMUM, unlike the properties filter's exact `beds`. "3+ bedrooms" is
  // what someone waiting for a listing actually means.
  minBeds: { type: Number, min: 0 },

  // Present so a later push-notification flow can skip paused alerts without
  // a schema change. Matching already honours it; there is deliberately no
  // toggle in the V1 UI, where users simply edit or delete.
  active: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now },
})

const PropertyAlert = mongoose.model('PropertyAlert', propertyAlertSchema)
export default PropertyAlert
