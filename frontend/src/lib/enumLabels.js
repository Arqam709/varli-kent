/**
 * Display labels for canonical backend enum values.
 *
 * The backend stores and filters on fixed English values — 'Apartment',
 * 'Sale', 'Available'. Those never change and are never translated: they are
 * what the API sends, what filters send back, and what the database holds.
 * This module only answers "what should a person reading in THIS language see
 * for that value?", from the `enums` section of the translations catalogue.
 *
 *   value sent to the API     'Apartment'   (always)
 *   label shown in Turkish    'Daire'
 *
 * Any value without a label — e.g. one added to the backend before the
 * frontend learns about it — renders as itself rather than as nothing.
 */
import translations from '../locales/translations.js'

// Mirrors backend/models/Property.js (listingType, propertyType, status) and
// backend/models/ContactSubmission.js (status). Tests hold these in sync.
export const PROPERTY_TYPES = ['Apartment', 'Villa', 'Penthouse', 'Duplex', 'Studio', 'Office', 'Commercial', 'Land', 'Shop', 'Warehouse', 'Hotel', 'Farm']
export const LISTING_TYPES = ['Sale', 'Rent']
export const PROPERTY_STATUSES = ['Available', 'Sold', 'Rented', 'Pending']
export const CONTACT_STATUSES = ['New', 'Replied', 'Archived']

/**
 * The label for `value` in `group` ('propertyType', 'listingType',
 * 'propertyStatus', 'contactStatus'), in `language`.
 *
 * Falls back to English, then to the value itself; never throws.
 */
export const enumLabel = (group, value, language) => {
  if (value === null || value === undefined || value === '') return ''
  const key = String(value)
  const pick = (lang) => {
    const label = translations[lang]?.enums?.[group]?.[key]
    return typeof label === 'string' && label.trim() !== '' ? label : null
  }
  return pick(language) ?? pick('en') ?? key
}

export const propertyTypeLabel = (value, language) => enumLabel('propertyType', value, language)
export const listingTypeLabel = (value, language) => enumLabel('listingType', value, language)
export const propertyStatusLabel = (value, language) => enumLabel('propertyStatus', value, language)
export const contactStatusLabel = (value, language) => enumLabel('contactStatus', value, language)
