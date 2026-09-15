/*
 * CONTACT INTERESTS — the website half of the shared contract.
 *
 * The vocabulary is owned by the backend — admin-managed ContactInterest
 * records since Phase 1B — and served at GET /api/contact/interests. The
 * mobile app reads the same
 * endpoint, so both clients now offer the same options instead of two
 * different hand-maintained subsets.
 *
 * This module is pure — no React, no network — so tests can import it with
 * plain `node --test`. The fetching lives in useContactInterests.js.
 *
 * ── Each entry owns its labels ──────────────────────────────────────────
 * The old form paired a value array with six translated label arrays BY INDEX,
 * and a single missed array silently attached a label to the wrong value. Here
 * an entry is one object — { id, value, labels, order } — so that failure has
 * nowhere to happen.
 */

export const CONTACT_INTEREST_LANGUAGES = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

/*
 * The bundled fallback, used before the request returns and whenever it fails.
 *
 * SAME shape as the API response, and a snapshot of the backend's nine
 * BUILT-IN defaults (backend/config/contactInterests.js):
 * tests/contactInterestRouting.contract.test.js asserts it deep-equals
 * getDefaultPublicContactInterests().
 *
 * Since Phase 1B the live list is managed by admins in MongoDB. This copy is
 * only the baseline: an interest created later reaches the form through the
 * API, never through this file, so a visitor whose request fails sees the
 * built-in nine. Do not add admin-created interests here.
 */
export const FALLBACK_CONTACT_INTERESTS = Object.freeze([
  { id: 'buying', value: 'Buying', order: 1, labels: { en: 'Buying', tr: 'Satın Alma', ar: 'الشراء', de: 'Kauf', ru: 'Покупка', ur: 'خریداری' } },
  { id: 'renting', value: 'Renting', order: 2, labels: { en: 'Renting', tr: 'Kiralama', ar: 'الإيجار', de: 'Miete', ru: 'Аренда', ur: 'کرایہ' } },
  { id: 'selling', value: 'Selling', order: 3, labels: { en: 'Selling', tr: 'Satış', ar: 'البيع', de: 'Verkauf', ru: 'Продажа', ur: 'فروخت' } },
  { id: 'renovation', value: 'Renovation', order: 4, labels: { en: 'Renovation', tr: 'Tadilat', ar: 'التجديد', de: 'Renovierung', ru: 'Ремонт', ur: 'تزئینِ نو' } },
  { id: 'interior_design', value: 'Interior Design', order: 5, labels: { en: 'Interior Design', tr: 'İç Mimarlık', ar: 'التصميم الداخلي', de: 'Innenarchitektur', ru: 'Дизайн интерьера', ur: 'داخلی ڈیزائن' } },
  { id: 'architecture', value: 'Architecture', order: 6, labels: { en: 'Architecture', tr: 'Mimarlık', ar: 'العمارة', de: 'Architektur', ru: 'Архитектура', ur: 'فنِ تعمیر' } },
  { id: 'construction', value: 'Construction', order: 7, labels: { en: 'Construction', tr: 'İnşaat', ar: 'الإنشاءات', de: 'Bau', ru: 'Строительство', ur: 'تعمیرات' } },
  { id: 'general', value: 'General', order: 8, labels: { en: 'General Enquiry', tr: 'Genel Talep', ar: 'استفسار عام', de: 'Allgemeine Anfrage', ru: 'Общий вопрос', ur: 'عام استفسار' } },
  { id: 'troubleshoot', value: 'Troubleshoot', order: 9, labels: { en: 'Troubleshoot', tr: 'Sorun Giderme', ar: 'استكشاف الأخطاء', de: 'Problembehebung', ru: 'Решение проблемы', ur: 'مسئلہ حل کرنا' } },
])

const ID_PATTERN = /^[a-z][a-z0-9_]*$/

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isText = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * Turns an API payload into a clean, ordered list — defensively.
 *
 * Accepts the response body (`{ success, interests }`) or a bare array. Anything
 * it cannot trust is DROPPED rather than guessed at: a missing or malformed id,
 * a blank value, labels with no English, an explicitly disabled entry, or a
 * duplicate id or value. Unknown extra fields are ignored and not copied, so a
 * future backend can add fields without breaking this client.
 *
 * Entries without a numeric `order` sort last, keeping their relative position.
 *
 * @returns {Array<{id: string, value: string, labels: Object, order: number}>}
 *   possibly empty — callers keep their fallback when it is.
 */
export const normalizeContactInterests = (payload) => {
  const list = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.interests)
      ? payload.interests
      : null

  if (!list) return []

  const seenIds = new Set()
  const seenValues = new Set()
  const accepted = []

  list.forEach((raw, index) => {
    if (!isPlainObject(raw) || raw.enabled === false) return

    const { id, value, labels, order } = raw
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return
    if (!isText(value) || value !== value.trim()) return
    if (!isPlainObject(labels) || !isText(labels.en)) return
    if (seenIds.has(id) || seenValues.has(value)) return

    seenIds.add(id)
    seenValues.add(value)

    const cleanLabels = {}
    for (const lang of CONTACT_INTEREST_LANGUAGES) {
      if (isText(labels[lang])) cleanLabels[lang] = labels[lang]
    }

    accepted.push({
      id,
      value,
      labels: cleanLabels,
      order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
      index,
    })
  })

  return accepted
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ id, value, labels, order }) => ({ id, value, labels, order }))
}

/**
 * The text to SHOW for an option: the current language, then English, then the
 * value itself. Display only — never submit this.
 */
export const contactInterestLabel = (interest, language) => {
  const labels = isPlainObject(interest?.labels) ? interest.labels : {}
  if (isText(labels[language])) return labels[language]
  if (isText(labels.en)) return labels.en
  return typeof interest?.value === 'string' ? interest.value : ''
}

/** Finds an entry by stable id or by legacy value. */
export const findContactInterest = (interests, key) =>
  typeof key === 'string' && Array.isArray(interests)
    ? interests.find((interest) => interest.id === key || interest.value === key)
    : undefined
