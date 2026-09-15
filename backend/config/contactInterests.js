export const CONTACT_INTEREST_LANGUAGES = Object.freeze(['en', 'tr', 'ar', 'de', 'ru', 'ur'])

/** Lowercase letter first, then lowercase letters, digits and underscores. */
export const CONTACT_INTEREST_ID_PATTERN = /^[a-z][a-z0-9_]*$/

export const CONTACT_INTEREST_LIMITS = Object.freeze({
  id: 64,
  value: 80,
  label: 80,
  order: 9999,
})

const entry = ({ id, value, labels, order, enabled = true }) =>
  Object.freeze({ id, value, labels: Object.freeze({ ...labels }), order, enabled })

export const DEFAULT_CONTACT_INTERESTS = Object.freeze([
  entry({
    id: 'buying',
    value: 'Buying',
    order: 1,
    labels: { en: 'Buying', tr: 'Satın Alma', ar: 'الشراء', de: 'Kauf', ru: 'Покупка', ur: 'خریداری' },
  }),
  entry({
    id: 'renting',
    value: 'Renting',
    order: 2,
    labels: { en: 'Renting', tr: 'Kiralama', ar: 'الإيجار', de: 'Miete', ru: 'Аренда', ur: 'کرایہ' },
  }),
  entry({
    id: 'selling',
    value: 'Selling',
    order: 3,
    labels: { en: 'Selling', tr: 'Satış', ar: 'البيع', de: 'Verkauf', ru: 'Продажа', ur: 'فروخت' },
  }),
  entry({
    id: 'renovation',
    value: 'Renovation',
    order: 4,
    labels: { en: 'Renovation', tr: 'Tadilat', ar: 'التجديد', de: 'Renovierung', ru: 'Ремонт', ur: 'تزئینِ نو' },
  }),
  entry({
    id: 'interior_design',
    value: 'Interior Design',
    order: 5,
    labels: {
      en: 'Interior Design',
      tr: 'İç Mimarlık',
      ar: 'التصميم الداخلي',
      de: 'Innenarchitektur',
      ru: 'Дизайн интерьера',
      ur: 'داخلی ڈیزائن',
    },
  }),
  entry({
    id: 'architecture',
    value: 'Architecture',
    order: 6,
    labels: { en: 'Architecture', tr: 'Mimarlık', ar: 'العمارة', de: 'Architektur', ru: 'Архитектура', ur: 'فنِ تعمیر' },
  }),
  // Construction = commissioning a NEW build. Distinct from Troubleshoot, and
  // routed to its own LeadRouting recipients. Shown on both clients from
  // Phase 1 (owner decision).
  entry({
    id: 'construction',
    value: 'Construction',
    order: 7,
    labels: { en: 'Construction', tr: 'İnşaat', ar: 'الإنشاءات', de: 'Bau', ru: 'Строительство', ur: 'تعمیرات' },
  }),
  entry({
    id: 'general',
    value: 'General',
    order: 8,
    labels: {
      en: 'General Enquiry',
      tr: 'Genel Talep',
      ar: 'استفسار عام',
      de: 'Allgemeine Anfrage',
      ru: 'Общий вопрос',
      ur: 'عام استفسار',
    },
  }),
  // Troubleshoot = a problem with something ALREADY built, for the technical
  // team. Never an alias of Construction.
  entry({
    id: 'troubleshoot',
    value: 'Troubleshoot',
    order: 9,
    labels: {
      en: 'Troubleshoot',
      tr: 'Sorun Giderme',
      ar: 'استكشاف الأخطاء',
      de: 'Problembehebung',
      ru: 'Решение проблемы',
      ur: 'مسئلہ حل کرنا',
    },
  }),
])

/**
 * The built-in values. Always accepted by POST /api/contact, with or without a
 * database record — see the header. Every OTHER accepted value comes from the
 * ContactInterest collection.
 */
export const DEFAULT_CONTACT_INTEREST_VALUES = Object.freeze(
  DEFAULT_CONTACT_INTERESTS.map((interest) => interest.value)
)

/**
 * Where a submission came from.
 *
 *   website       the website form, and the default for any client that sends
 *                 nothing — which includes every mobile build released before
 *                 Phase 1.
 *   mobile        the React Native Contact screen.
 *   ai_assistant  the chatbot lead flow, which writes ContactSubmission
 *                 directly on the server.
 */
export const CONTACT_SOURCES = Object.freeze(['website', 'ai_assistant', 'mobile'])

/**
 * The sources a PUBLIC client may declare about itself. `ai_assistant` is
 * excluded on purpose: only the server-side chatbot flow may set it, so a
 * browser cannot make its submission look like a chatbot lead.
 */
export const CLIENT_CONTACT_SOURCES = Object.freeze(['website', 'mobile'])

/* ══════════════ Pure rules ══════════════ */

/** Plain code-unit comparison, so tie-breaks never depend on a locale. */
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** By `order`, then by id — the one ordering every list uses. */
export const compareContactInterests = (a, b) => a.order - b.order || compareIds(a.id, b.id)

/** Only the six supported languages, and only non-blank strings. */
export const cleanContactInterestLabels = (labels) => {
  const clean = {}
  if (!labels || typeof labels !== 'object') return clean
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    const label = labels[lang]
    if (typeof label === 'string' && label.trim() !== '') clean[lang] = label
  }
  return clean
}

/**
 * The public projection of a list of entries: enabled only, sorted, and reduced
 * to the four fields clients need. Accepts database documents as well as the
 * frozen defaults, and returns fresh objects either way — so `_id`, `__v`,
 * timestamps and `enabled` never reach a visitor.
 */
export const selectPublicContactInterests = (entries) =>
  entries
    .filter((interest) => interest && interest.enabled === true)
    .slice()
    .sort(compareContactInterests)
    .map(({ id, value, labels, order }) => ({ id, value, labels: cleanContactInterestLabels(labels), order }))

/** The defaults, as GET /api/contact/interests would serve them. */
export const getDefaultPublicContactInterests = () => selectPublicContactInterests(DEFAULT_CONTACT_INTERESTS)

/** A canonical value from an English label: trimmed, inner whitespace collapsed. */
export const normalizeContactInterestValue = (label) =>
  typeof label === 'string' ? label.trim().replace(/\s+/g, ' ') : ''

/**
 * The stable id for an English label — `Investment Consultation` →
 * `investment_consultation`. Accents are folded (`İç Mimarlık` → `ic_mimarlik`),
 * every other run of non-alphanumerics becomes one underscore.
 *
 * Returns '' when no valid id can be produced (nothing Latin in the label, or it
 * starts with a digit). The caller reports that; it never invents a suffix.
 *
 * Every built-in id is exactly what this derives from its value, so admin-created
 * ids follow the same convention.
 */
export const deriveContactInterestId = (label) => {
  if (typeof label !== 'string') return ''

  const slug = label
    // Turkish dotless/dotted i do not decompose under NFKD.
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, CONTACT_INTEREST_LIMITS.id)
    .replace(/_+$/, '')

  return CONTACT_INTEREST_ID_PATTERN.test(slug) ? slug : ''
}
