// Removes legacy "echo" translations from a CMS page record.
//
// ── The data problem ──────────────────────────────────────────────────────
// An older CMS save path stored the English text in EVERY language slot of a
// field — { en: 'We Design, Build', tr: 'We Design, Build', de: … }. The
// current path never does this (utils/autoTranslate.js rejects echoes), but it
// also never repairs one: a re-save with unchanged English is skipped entirely.
//
// The frontend shows a field's slot for the visitor's language whenever that
// slot has text (src/lib/pageContentResolve.js), so an echoed slot hides the
// translated default the page would otherwise show. Removing the echo — not
// replacing it — is what lets that default through.
//
// ── What counts as a removable echo (deliberately narrow) ─────────────────
// A slot is removed only when ALL of these hold:
//
//   1. the field is a registered TEXT field of the page (backend contract)
//   2. the page registry has a default text for it
//   3. the field's source language is English
//   4. its English value equals that default (surrounding whitespace aside)
//      — i.e. nobody ever edited it, so the page's translated default says
//      the same thing in the visitor's language
//   5. the slot's value equals the field's own English value (surrounding
//      whitespace aside)
//
// Anything else is reported and left exactly as it is: an admin-edited field
// (English differs from the default), an unregistered key, a field with no
// default, a non-English source, or a slot that differs from English — even if
// it "looks" English. No translation is generated and no value is guessed.
// English is never touched.

export const TARGET_LANGUAGES = ['tr', 'ar', 'de', 'ru', 'ur']

const trimmed = (value) => (typeof value === 'string' ? value.trim() : null)

/**
 * Classifies every field of a page record and lists the slots to remove.
 *
 * @param {object} record              the PageContent document ({ fields })
 * @param {(key: string) => string|null} fieldTypeOf   backend contract lookup
 * @param {Record<string, string>} defaults            registry default texts
 */
export const planEchoCleanup = (record, fieldTypeOf, defaults) => {
  const plan = {
    removals: [],          // { key, lang, value }
    cleanableFields: [],   // keys with at least one removal
    untouchedDefaults: [], // keys that qualify (with or without echoes left)
    adminEdited: [],       // { key, values: { en, tr, ar, de, ru, ur } }
    unregistered: [],      // stored keys the page contract does not define
    noDefault: [],         // registered text keys without a registry default
    nonEnglishSource: [],  // { key, sourceLang }
    keptSlots: [],         // { key, lang, reason } — slots of qualifying fields left alone
    images: 0,
    countsByLanguage: Object.fromEntries(TARGET_LANGUAGES.map((l) => [l, 0])),
  }

  for (const [key, field] of Object.entries(record?.fields || {})) {
    if (field && typeof field === 'object' && field.type === 'image') { plan.images += 1; continue }
    if (fieldTypeOf(key) !== 'text') { plan.unregistered.push(key); continue }
    if (!field || typeof field !== 'object' || Array.isArray(field)) { plan.unregistered.push(key); continue }

    const fallback = defaults[key]
    if (typeof fallback !== 'string') { plan.noDefault.push(key); continue }

    if (field.sourceLang !== 'en') { plan.nonEnglishSource.push({ key, sourceLang: field.sourceLang ?? null }); continue }

    const english = trimmed(field.en)
    if (english === null || english !== fallback.trim()) {
      plan.adminEdited.push({
        key,
        defaultEnglish: fallback,
        values: Object.fromEntries(['en', ...TARGET_LANGUAGES].map((l) => [l, field[l] ?? null])),
      })
      continue
    }

    plan.untouchedDefaults.push(key)
    let removedHere = 0
    for (const lang of TARGET_LANGUAGES) {
      const slot = field[lang]
      if (slot === undefined || slot === null) continue
      if (typeof slot === 'string' && slot.trim() === english) {
        plan.removals.push({ key, lang, value: slot })
        plan.countsByLanguage[lang] += 1
        removedHere += 1
      } else {
        plan.keptSlots.push({ key, lang, reason: 'differs from English — treated as a real translation' })
      }
    }
    if (removedHere > 0) plan.cleanableFields.push(key)
  }

  return plan
}

/**
 * Every way `plan` differs from an approved expectation:
 *   { removals, fields, preserved: [keys], untouchedKeys: [keys] }
 * `preserved` must be reported as admin-edited; `untouchedKeys` must have no
 * planned removal. An empty array means the plan is exactly what was approved.
 */
export const planMismatches = (plan, expect = {}) => {
  const problems = []
  if (expect.removals !== undefined && plan.removals.length !== expect.removals) {
    problems.push(`expected ${expect.removals} slots, found ${plan.removals.length}`)
  }
  if (expect.fields !== undefined && plan.cleanableFields.length !== expect.fields) {
    problems.push(`expected ${expect.fields} fields, found ${plan.cleanableFields.length}`)
  }
  const edited = new Set(plan.adminEdited.map((f) => f.key))
  for (const key of expect.preserved || []) {
    if (!edited.has(key)) problems.push(`${key} is no longer classified as admin-edited`)
  }
  const touched = new Set(plan.removals.map((r) => r.key))
  for (const key of expect.untouchedKeys || []) {
    if (touched.has(key)) problems.push(`${key} would be modified`)
  }
  return problems
}

/**
 * Report, and — only when `write` is true — back up and then remove the
 * planned slots in ONE conditional update.
 *
 * The update's filter pins every removed slot to the exact value that was
 * planned, so if anything changed between reading and writing, nothing is
 * changed at all. Without `write` it performs no write of any kind.
 *
 * @param {object} deps
 * @param {{findOne: Function, updateOne: Function}} deps.collection  raw driver collection
 * @param {string} deps.pageKey
 * @param {(key: string) => string|null} deps.fieldTypeOf
 * @param {Record<string, string>} deps.defaults
 * @param {boolean} [deps.write=false]
 * @param {(record: object) => Promise<string>} deps.backup  must resolve to the backup path, or throw
 */
export const runEchoCleanup = async ({ collection, pageKey, fieldTypeOf, defaults, write = false, backup, expect = null }) => {
  const record = await collection.findOne({ pageKey })
  if (!record) return { found: false, wrote: false }

  const plan = planEchoCleanup(record, fieldTypeOf, defaults)
  const result = { found: true, recordId: String(record._id), plan, wrote: false, backupPath: null }

  if (!write || plan.removals.length === 0) return result

  // The approved plan, restated by the operator. Any difference means the
  // record is not what was reviewed — stop before the backup and the write.
  if (expect) {
    const mismatches = planMismatches(plan, expect)
    if (mismatches.length) {
      throw new Error(`The plan no longer matches what was approved — nothing was changed: ${mismatches.join('; ')}`)
    }
  }

  // No backup, no write. A failed or unconfirmed backup stops the run here.
  if (typeof backup !== 'function') throw new Error('A backup function is required before writing')
  const backupPath = await backup(record)
  if (!backupPath) throw new Error('Backup did not report a file — nothing was changed')
  result.backupPath = backupPath

  const filter = { _id: record._id }
  const unset = {}
  for (const { key, lang, value } of plan.removals) {
    filter[`fields.${key}.${lang}`] = value
    unset[`fields.${key}.${lang}`] = ''
  }

  const outcome = await collection.updateOne(filter, { $unset: unset })
  if (outcome.matchedCount !== 1) {
    throw new Error('The record changed after it was read — nothing was modified. Re-run the report.')
  }
  result.wrote = true
  result.modifiedCount = outcome.modifiedCount

  // Verify: the same rules must now find nothing to remove.
  const after = await collection.findOne({ _id: record._id })
  result.remainingAfterWrite = planEchoCleanup(after, fieldTypeOf, defaults).removals.length
  return result
}
