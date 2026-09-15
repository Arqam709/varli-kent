import ContactInterest from '../models/ContactInterest.js'
import {
  DEFAULT_CONTACT_INTERESTS,
  DEFAULT_CONTACT_INTEREST_VALUES,
  cleanContactInterestLabels,
  compareContactInterests,
  selectPublicContactInterests,
} from '../config/contactInterests.js'

/*
 * Contact interests at runtime: MongoDB, seeded with the built-in defaults.
 *
 * The routes (contact, contact interests, lead routing) all read through here,
 * so "which interests exist" is answered in exactly one place.
 */

export const isDuplicateKeyError = (err) => err?.code === 11000 || err?.cause?.code === 11000

/**
 * Inserts any built-in default that is missing — and does nothing else.
 *
 * Runs in server.js after MongoDB connects and BEFORE the HTTP server starts
 * listening, so the first request already sees the defaults.
 *
 * Idempotent and non-destructive by construction:
 *   - one upsert per default, matched by its stable `id`
 *   - every field is written with $setOnInsert, so an EXISTING record — whatever
 *     an admin has done to its labels, order or enabled state — is never
 *     touched. There is no $set anywhere in this function.
 *   - `timestamps: false`, so a restart does not even bump `updatedAt`
 *
 * Two instances booting at once can race on the unique index; the loser gets a
 * duplicate-key error for a record that now exists, which is the goal, so it is
 * logged and skipped. Any other error propagates to the caller.
 *
 * @returns {{ inserted: number, total: number }}
 */
export const ensureDefaultContactInterests = async ({ logger = console } = {}) => {
  // Builds the unique indexes on id and value before anything is written, so
  // uniqueness is enforced by the database from the very first insert.
  await ContactInterest.init()

  let inserted = 0

  for (const interest of DEFAULT_CONTACT_INTERESTS) {
    const now = new Date()
    try {
      const result = await ContactInterest.updateOne(
        { id: interest.id },
        {
          $setOnInsert: {
            id: interest.id,
            value: interest.value,
            labels: { ...interest.labels },
            order: interest.order,
            enabled: interest.enabled,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, timestamps: false }
      )
      inserted += result?.upsertedCount ?? 0
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err
      logger.warn(`[contact-interests] default '${interest.id}' not inserted: its id or value already exists`)
    }
  }

  return { inserted, total: DEFAULT_CONTACT_INTERESTS.length }
}

/** What an authorized admin sees for one interest. No `_id`, no `__v`. */
export const toManagedContactInterest = (doc) => ({
  id: doc.id,
  value: doc.value,
  labels: cleanContactInterestLabels(doc.labels),
  order: doc.order,
  enabled: doc.enabled !== false,
  createdAt: doc.createdAt ?? null,
  updatedAt: doc.updatedAt ?? null,
})

/** GET /api/contact/interests: enabled only, sorted, four public fields. */
export const listPublicContactInterests = async () =>
  selectPublicContactInterests(await ContactInterest.find({ enabled: true }).lean())

/** Every interest, enabled or not, for the admin manager. */
export const listManagedContactInterests = async () =>
  (await ContactInterest.find({}).lean()).map(toManagedContactInterest).sort(compareContactInterests)

/**
 * Every interest a submission may name and a routing row may configure:
 * all database records, enabled OR disabled, plus any built-in default that is
 * not (yet) in the database.
 */
export const listRoutableContactInterests = async () => {
  const interests = await listManagedContactInterests()
  const known = new Set(interests.map((interest) => interest.value))

  for (const interest of DEFAULT_CONTACT_INTERESTS) {
    if (!known.has(interest.value)) interests.push(toManagedContactInterest(interest))
  }

  return interests.sort(compareContactInterests)
}

/**
 * May POST /api/contact store this interestType?
 *
 * Yes for any registered canonical value, including DISABLED ones: an older app
 * or an old link may still offer it, and turning that into a 400 would lose the
 * enquiry. The built-in values short-circuit without a query, since they can
 * never be deleted — so they stay accepted even if bootstrap has not run.
 *
 * Exact, case-sensitive match on `value`. A stable id or a translated label is
 * not a value and is refused.
 */
export const isRegisteredContactInterestValue = async (value) => {
  if (typeof value !== 'string' || value === '') return false
  if (DEFAULT_CONTACT_INTEREST_VALUES.includes(value)) return true
  return Boolean(await ContactInterest.exists({ value }))
}
