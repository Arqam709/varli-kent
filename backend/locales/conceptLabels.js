// backend/locales/conceptLabels.js
//
// Phase 3: visible labels for the stable lifestyle-concept IDs defined in
// utils/lifestyleConcepts.js (school, sea_view, metro_transport, family,
// peaceful_safe, park_green, investment, luxury). The IDs themselves are
// never translated and never appear here as anything but object keys — all
// evidence logic (extractConceptIdsFromText, evaluateSoftMatchForProperty,
// searchEvidence) continues to operate on IDs only, exactly as before.
// This module is pure display: id -> { matched, unverified, topic } per
// language.
//
// Three label kinds, migrated verbatim (in meaning) from the English-only
// maps that used to live in chatReplyBuilder.js:
//   matched     — "this property ... " clause when the concept WAS verified
//   unverified  — full sentence used when a requested concept could NOT be
//                 confirmed from a specific property's own listing text
//   topic       — short noun phrase for the summary reply's "I could not
//                 verify X" opener

export const CONCEPT_LABELS = {
  school: {
    matched: { en: 'is near schools', tr: 'okullara yakın', ar: 'قريب من المدارس' },
    unverified: {
      en: 'Proximity to schools could not be confirmed from the listing description.',
      tr: 'Okullara yakınlığı ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من القرب من المدارس بناءً على وصف الإعلان.',
    },
    topic: { en: 'school proximity', tr: 'okullara yakınlık', ar: 'القرب من المدارس' },
  },
  sea_view: {
    matched: { en: 'has a sea view', tr: 'deniz manzaralı', ar: 'يتمتع بإطلالة بحرية' },
    unverified: {
      en: 'A sea view could not be confirmed from the listing description.',
      tr: 'Deniz manzarası ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من الإطلالة البحرية بناءً على وصف الإعلان.',
    },
    topic: { en: 'a sea view', tr: 'deniz manzarası', ar: 'الإطلالة البحرية' },
  },
  metro_transport: {
    matched: {
      en: 'is close to metro and transport links',
      tr: 'metro ve toplu taşımaya yakın',
      ar: 'قريب من المترو ووسائل النقل',
    },
    unverified: {
      en: 'Proximity to metro or transport links could not be confirmed from the listing description.',
      tr: 'Metro veya toplu taşımaya yakınlığı ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من القرب من المترو أو وسائل النقل بناءً على وصف الإعلان.',
    },
    topic: { en: 'transport proximity', tr: 'ulaşıma yakınlık', ar: 'القرب من وسائل النقل' },
  },
  family: {
    matched: { en: 'is family-friendly', tr: 'aileler için uygun', ar: 'مناسب للعائلات' },
    unverified: {
      en: 'Family-friendly suitability could not be confirmed from the listing description.',
      tr: 'Aileler için uygunluğu ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من ملاءمته للعائلات بناءً على وصف الإعلان.',
    },
    topic: { en: 'family-friendly suitability', tr: 'aileler için uygunluk', ar: 'الملاءمة للعائلات' },
  },
  peaceful_safe: {
    matched: { en: 'is in a peaceful, safe area', tr: 'sakin ve güvenli bir bölgede', ar: 'في منطقة هادئة وآمنة' },
    unverified: {
      en: 'A peaceful, safe setting could not be confirmed from the listing description.',
      tr: 'Sakin ve güvenli bir ortam olduğu ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من هدوء وأمان المنطقة بناءً على وصف الإعلان.',
    },
    topic: { en: 'a peaceful, safe setting', tr: 'sakin ve güvenli bir ortam', ar: 'الهدوء والأمان' },
  },
  park_green: {
    matched: {
      en: 'is near a park or green space',
      tr: 'parka veya yeşil alana yakın',
      ar: 'قريب من حديقة أو مساحة خضراء',
    },
    unverified: {
      en: 'Proximity to a park or green space could not be confirmed from the listing description.',
      tr: 'Parka veya yeşil alana yakınlığı ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من القرب من حديقة أو مساحة خضراء بناءً على وصف الإعلان.',
    },
    topic: {
      en: 'proximity to a park or green space',
      tr: 'parka veya yeşil alana yakınlık',
      ar: 'القرب من حديقة أو مساحة خضراء',
    },
  },
  investment: {
    matched: {
      en: 'looks like a good investment opportunity',
      tr: 'iyi bir yatırım fırsatı gibi görünüyor',
      ar: 'يبدو فرصة استثمارية جيدة',
    },
    unverified: {
      en: 'Investment potential could not be confirmed from the listing description.',
      tr: 'Yatırım potansiyeli ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من العائد الاستثماري بناءً على وصف الإعلان.',
    },
    topic: { en: 'investment potential', tr: 'yatırım potansiyeli', ar: 'العائد الاستثماري' },
  },
  luxury: {
    matched: { en: 'has a luxury feel', tr: 'lüks bir hisse sahip', ar: 'ذو طابع فاخر' },
    unverified: {
      en: 'A luxury feel could not be confirmed from the listing description.',
      tr: 'Lüks bir his verdiği ilan açıklamasından doğrulanamadı.',
      ar: 'تعذّر التأكد من الطابع الفاخر بناءً على وصف الإعلان.',
    },
    topic: { en: 'a luxury feel', tr: 'lüks bir his', ar: 'الطابع الفاخر' },
  },
}

// Single shared generic fallback phrase for when requestedConceptIds is
// empty — i.e. the visitor's soft/lifestyle request didn't map to any of the
// closed concept ids above (e.g. "modern kitchen with rooftop terrace").
// Never a claim of verification, just a neutral, natural naming of "what was
// asked for." Used directly as a noun phrase (chatReplyRenderer.js's
// requestedTopicsPhrase/genericDescriptionTopic) in place of the internal,
// English-only descriptionQuery — never descriptionQuery itself.
export const GENERIC_DESCRIPTION_TOPIC = {
  en: 'the preferences you described',
  tr: 'belirttiğiniz tercihler',
  ar: 'التفضيلات التي وصفتها',
}

const FALLBACK_LANGUAGE = 'en'

export const conceptMatchedLabel = (conceptId, language = FALLBACK_LANGUAGE) => {
  const entry = CONCEPT_LABELS[conceptId]?.matched
  return entry?.[language] || entry?.en || null
}

export const conceptUnverifiedLabel = (conceptId, language = FALLBACK_LANGUAGE) => {
  const entry = CONCEPT_LABELS[conceptId]?.unverified
  return entry?.[language] || entry?.en || null
}

export const conceptTopicPhrase = (conceptId, language = FALLBACK_LANGUAGE) => {
  const entry = CONCEPT_LABELS[conceptId]?.topic
  return entry?.[language] || entry?.en || null
}
