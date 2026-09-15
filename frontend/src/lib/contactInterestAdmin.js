/*
 * CONTACT INTEREST MANAGEMENT — pure helpers for the admin manager.
 *
 * The manager (components/ContactInterestsManager.jsx) sits under
 * Admin → Page Content → Contact, but manages ContactInterest records through
 * /api/contact/interests — never PageContent fields.
 *
 * Kept free of React so tests can import it with plain `node --test`.
 *
 * ── What the server decides ─────────────────────────────────────────────
 * The stable id and the canonical submitted value are DERIVED ON THE SERVER
 * from the English label when an interest is created, and are immutable after
 * that. deriveContactInterestId() here only previews the result for the admin;
 * the payload builders below never send `id` or `value`, and the backend
 * refuses them if they ever are.
 */

import { CONTACT_INTEREST_LANGUAGES } from './contactInterests.js'

export const CONTACT_INTEREST_LANGUAGE_NAMES = Object.freeze({
  en: 'English',
  tr: 'Turkish',
  ar: 'Arabic',
  de: 'German',
  ru: 'Russian',
  ur: 'Urdu',
})

/** Mirrors backend/config/contactInterests.js (CONTACT_INTEREST_LIMITS). */
export const CONTACT_INTEREST_LIMITS = Object.freeze({ id: 64, label: 80, order: 9999 })

const ID_PATTERN = /^[a-z][a-z0-9_]*$/

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Trimmed, inner whitespace collapsed — the server's rule for the canonical value. */
export const normalizeContactInterestValue = (label) =>
  typeof label === 'string' ? label.trim().replace(/\s+/g, ' ') : ''

/**
 * PREVIEW of the id the server will derive. Must match
 * backend/config/contactInterests.js → deriveContactInterestId exactly;
 * tests/contactInterestAdmin.contract.test.js compares the two.
 */
export const deriveContactInterestId = (label) => {
  if (typeof label !== 'string') return ''

  const slug = label
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, CONTACT_INTEREST_LIMITS.id)
    .replace(/_+$/, '')

  return ID_PATTERN.test(slug) ? slug : ''
}

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Public order: `order`, then id. */
export const sortManagedInterests = (list) =>
  [...list].sort((a, b) => a.order - b.order || compareIds(a.id, b.id))

const cleanLabels = (labels) => {
  const clean = {}
  if (!isPlainObject(labels)) return clean
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    if (typeof labels[lang] === 'string' && labels[lang].trim() !== '') clean[lang] = labels[lang]
  }
  return clean
}

/**
 * The management list, defensively. Unlike the PUBLIC normalizer this keeps
 * disabled entries — showing them is the point — and carries `enabled`.
 */
export const normalizeManagedInterests = (payload) => {
  const list = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.interests)
      ? payload.interests
      : []

  const seen = new Set()
  const accepted = []
  for (const raw of list) {
    if (!isPlainObject(raw)) continue
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id) || seen.has(raw.id)) continue
    if (typeof raw.value !== 'string' || raw.value.trim() === '') continue
    seen.add(raw.id)
    accepted.push({
      id: raw.id,
      value: raw.value,
      labels: cleanLabels(raw.labels),
      order: Number.isFinite(raw.order) ? raw.order : CONTACT_INTEREST_LIMITS.order,
      enabled: raw.enabled !== false,
    })
  }
  return sortManagedInterests(accepted)
}

/** One slot per supported language, so every input is controlled. */
const labelSlots = (labels = {}) =>
  Object.fromEntries(CONTACT_INTEREST_LANGUAGES.map((lang) => [lang, typeof labels[lang] === 'string' ? labels[lang] : '']))

export const emptyInterestForm = (nextOrder) => ({
  labels: labelSlots(),
  enabled: true,
  order: nextOrder === undefined ? '' : String(nextOrder),
})

export const formFromInterest = (interest) => ({
  labels: labelSlots(interest.labels),
  enabled: interest.enabled !== false,
  order: String(interest.order),
})

/** The order a new interest should suggest: after the current last one. */
export const nextInterestOrder = (interests) =>
  Math.min(CONTACT_INTEREST_LIMITS.order, interests.reduce((max, interest) => Math.max(max, interest.order), 0) + 1)

/*
 * Form validation, in two layers:
 *
 *   check…()      → a language-neutral PROBLEM ({ code, … }) or null
 *   describe…()   → that problem as text, from the admin's translation
 *                   messages when given, English otherwise
 *
 * The manager passes `adminPages.contactInterests.errors` from translations.js,
 * so validation follows the Admin language. validate…() keep their original
 * English-string contract for callers and tests that want plain messages.
 */

/** English templates, used when a translation is missing. Placeholders: {language} {max} {name}. */
export const CONTACT_INTEREST_FORM_MESSAGES = Object.freeze({
  englishRequired: 'An English label is required.',
  labelTooLong: 'The {language} label must be {max} characters or fewer.',
  orderRequired: 'Order is required.',
  orderRange: 'Order must be a whole number from 0 to {max}.',
  noLatinLetter: 'The English label must start with a Latin letter (A–Z), so a stable ID can be generated from it.',
  clash: '“{name}” already uses this ID or value. Edit it instead.',
  clashDisabled: '“{name}” already uses this ID or value. Edit or re-enable it instead.',
})

const checkFields = (form, { orderRequired }) => {
  if (!normalizeContactInterestValue(form.labels.en)) return { code: 'englishRequired' }

  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    if ((form.labels[lang] ?? '').trim().length > CONTACT_INTEREST_LIMITS.label) {
      return { code: 'labelTooLong', lang, max: CONTACT_INTEREST_LIMITS.label }
    }
  }

  const order = String(form.order ?? '').trim()
  if (order === '') return orderRequired ? { code: 'orderRequired' } : null
  if (!/^\d+$/.test(order) || Number(order) > CONTACT_INTEREST_LIMITS.order) {
    return { code: 'orderRange', max: CONTACT_INTEREST_LIMITS.order }
  }
  return null
}

/** Client-side check before PATCH. The server validates again. */
export const checkExistingInterestForm = (form) => checkFields(form, { orderRequired: true })

/**
 * Client-side check before POST, including the collisions the server would
 * report as 409 — so the common mistake is explained before a round trip.
 */
export const checkNewInterestForm = (form, existing = []) => {
  const problem = checkFields(form, { orderRequired: false })
  if (problem) return problem

  const value = normalizeContactInterestValue(form.labels.en)
  const id = deriveContactInterestId(value)
  if (!id) return { code: 'noLatinLetter' }

  const clash = existing.find((interest) => interest.id === id || interest.value === value)
  if (clash) return { code: clash.enabled ? 'clash' : 'clashDisabled', interest: clash }
  return null
}

/**
 * A problem as text.
 *
 * @param {object} [options]
 * @param {object} [options.messages]       code → template, e.g. adminPages.contactInterests.errors
 * @param {object} [options.languageNames]  en/tr/… → display name in the admin language
 * @param {Function} [options.interestName] interest → the name to show for a clash
 */
export const describeInterestFormProblem = (problem, { messages = {}, languageNames = {}, interestName } = {}) => {
  if (!problem) return null

  const template = messages?.[problem.code] || CONTACT_INTEREST_FORM_MESSAGES[problem.code] || problem.code
  const name = problem.interest
    ? (interestName ? interestName(problem.interest) : problem.interest.labels?.en || problem.interest.value)
    : ''
  const language = problem.lang ? (languageNames?.[problem.lang] || CONTACT_INTEREST_LANGUAGE_NAMES[problem.lang]) : ''

  // Function replacements, so a `$` in an interest name is never read as a pattern.
  return template
    .replace('{name}', () => name)
    .replace('{language}', () => language)
    .replace('{max}', () => String(problem.max ?? ''))
}

/** English message for a PATCH form, or null. */
export const validateExistingInterestForm = (form) => describeInterestFormProblem(checkExistingInterestForm(form))

/** English message for a POST form, or null. */
export const validateNewInterestForm = (form, existing = []) =>
  describeInterestFormProblem(checkNewInterestForm(form, existing))

/** Only the six languages, trimmed; blank optional ones are omitted. */
export const buildLabelsPayload = (labels) => {
  const out = {}
  for (const lang of CONTACT_INTEREST_LANGUAGES) {
    const text = (labels[lang] ?? '').trim()
    if (text) out[lang] = text
  }
  return out
}

/** POST body. Never `id` or `value`: the server derives both. */
export const buildCreatePayload = (form) => {
  const order = String(form.order ?? '').trim()
  return {
    labels: buildLabelsPayload(form.labels),
    enabled: form.enabled !== false,
    ...(order === '' ? {} : { order: Number(order) }),
  }
}

/** PATCH body. The editable fields only — never `id` or `value`. */
export const buildUpdatePayload = (form) => ({
  labels: buildLabelsPayload(form.labels),
  enabled: form.enabled !== false,
  order: Number(String(form.order).trim()),
})

/** The server's message when it sent one, otherwise the supplied fallback. */
export const contactInterestErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

/** The three calls the manager makes, over any axios-like client. */
export const createContactInterestsClient = (http) => ({
  list: async () => normalizeManagedInterests((await http.get('/contact/interests/manage')).data),
  create: async (payload) => normalizeManagedInterests([(await http.post('/contact/interests', payload)).data?.interest])[0],
  update: async (id, payload) =>
    normalizeManagedInterests([(await http.patch(`/contact/interests/${encodeURIComponent(id)}`, payload)).data?.interest])[0],
})
