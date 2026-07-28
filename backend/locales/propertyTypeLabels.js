// backend/locales/propertyTypeLabels.js
//
// Phase 3 (backend deterministic reply localization): display labels for the
// canonical listingType/propertyType enums. The enums themselves — 'Sale',
// 'Rent', 'Apartment', 'Villa', ... — are never touched here or anywhere
// downstream; this module only maps an existing enum value to a visible
// word in en/tr/ar. Database values, MongoDB filters, and Property documents
// are completely unaware this module exists.
//
// Each noun label carries { one, two, other } — not the full six-category
// CLDR plural set. This is a deliberate simplification (see the Phase 3
// report's pluralization section): "few"/"many"/"zero" add real Arabic
// grammatical nuance but are rarely load-bearing for a short property-count
// sentence, and forcing all twelve property types through all six categories
// would be a lot of hand-authored Arabic with little payback. `pluralize()`
// in chatReplyRenderer.js falls back to `other` for any missing category, so
// this is safe to extend later without breaking anything.
//
// Turkish nouns intentionally repeat the same string for `one` and `other`:
// Turkish drops the plural suffix after a numeral ("3 daire", never "3
// daireler"), so making one === other is the correct grammar, not a missing
// translation.

export const PROPERTY_TYPE_LABELS = {
  Apartment: {
    en: { one: 'apartment', other: 'apartments' },
    tr: { one: 'daire', other: 'daire' },
    ar: { one: 'شقة', two: 'شقتان', other: 'شقق' },
  },
  Villa: {
    en: { one: 'villa', other: 'villas' },
    tr: { one: 'villa', other: 'villa' },
    ar: { one: 'فيلا', two: 'فيلتان', other: 'فلل' },
  },
  Penthouse: {
    en: { one: 'penthouse', other: 'penthouses' },
    tr: { one: 'çatı katı', other: 'çatı katı' },
    ar: { one: 'بنتهاوس', two: 'بنتهاوسان', other: 'بنتهاوسات' },
  },
  Duplex: {
    en: { one: 'duplex', other: 'duplexes' },
    tr: { one: 'dubleks', other: 'dubleks' },
    ar: { one: 'دوبلكس', two: 'دوبلكسان', other: 'دوبلكسات' },
  },
  Studio: {
    en: { one: 'studio', other: 'studios' },
    tr: { one: 'stüdyo daire', other: 'stüdyo daire' },
    ar: { one: 'استوديو', two: 'استوديوهان', other: 'استوديوهات' },
  },
  Office: {
    en: { one: 'office', other: 'offices' },
    tr: { one: 'ofis', other: 'ofis' },
    ar: { one: 'مكتب', two: 'مكتبان', other: 'مكاتب' },
  },
  Commercial: {
    en: { one: 'commercial property', other: 'commercial properties' },
    tr: { one: 'ticari mülk', other: 'ticari mülk' },
    ar: { one: 'عقار تجاري', two: 'عقاران تجاريان', other: 'عقارات تجارية' },
  },
  Land: {
    en: { one: 'land plot', other: 'land plots' },
    tr: { one: 'arsa', other: 'arsa' },
    ar: { one: 'قطعة أرض', two: 'قطعتا أرض', other: 'قطع أراضٍ' },
  },
  Shop: {
    en: { one: 'shop', other: 'shops' },
    tr: { one: 'dükkan', other: 'dükkan' },
    ar: { one: 'محل', two: 'محلان', other: 'محلات' },
  },
  Warehouse: {
    en: { one: 'warehouse', other: 'warehouses' },
    tr: { one: 'depo', other: 'depo' },
    ar: { one: 'مستودع', two: 'مستودعان', other: 'مستودعات' },
  },
  Hotel: {
    en: { one: 'hotel', other: 'hotels' },
    tr: { one: 'otel', other: 'otel' },
    ar: { one: 'فندق', two: 'فندقان', other: 'فنادق' },
  },
  Farm: {
    en: { one: 'farm', other: 'farms' },
    tr: { one: 'çiftlik', other: 'çiftlik' },
    ar: { one: 'مزرعة', two: 'مزرعتان', other: 'مزارع' },
  },
}

// Used whenever propertyType is null/multiple and the sentence needs a
// generic noun ("3 properties" rather than "3 apartments").
export const GENERIC_PROPERTY_LABEL = {
  en: { one: 'property', other: 'properties' },
  tr: { one: 'mülk', other: 'mülk' },
  ar: { one: 'عقار', two: 'عقاران', other: 'عقارات' },
}

// Adjectival form only ("apartment FOR SALE" / "satılık daire" / "شقة
// للبيع") — deliberately not split into separate "bare word" / "plural noun"
// forms the way the English-only code used to build (`for ${x.toLowerCase()}`,
// `rentals` vs `properties for sale`, etc). Turkish and Arabic real-estate
// copy always uses one adjectival phrase regardless of sentence position, so
// the renderer composes whole per-language sentences around this single
// form rather than trying to force three English phrasing variants through
// every language.
export const LISTING_TYPE_LABELS = {
  Sale: { en: 'for sale', tr: 'satılık', ar: 'للبيع' },
  Rent: { en: 'for rent', tr: 'kiralık', ar: 'للإيجار' },
}

export const propertyTypeLabel = (propertyType, language = 'en') => {
  const entry = PROPERTY_TYPE_LABELS[propertyType]
  return entry?.[language] || entry?.en || null
}

export const genericPropertyLabel = (language = 'en') =>
  GENERIC_PROPERTY_LABEL[language] || GENERIC_PROPERTY_LABEL.en

export const listingTypeLabel = (listingType, language = 'en') => {
  const entry = LISTING_TYPE_LABELS[listingType]
  return entry?.[language] || entry?.en || null
}
