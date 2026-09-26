// backend/scripts/backfillPropertyDescriptions.js
//
// Converts legacy plain-string Property.description values into the localized
// { sourceLang, en, tr, ar, de, ru, ur } shape that routes/properties.js now
// writes at save time — the same write-time pattern Team bios, Showroom
// captions and About prose already use.
//
// This is an IMPROVEMENT, not a prerequisite. Nothing is broken before it runs:
//
//   - the field is `Mixed` (utils/localizedField.js's localizedField), so a
//     plain string reads back untouched rather than failing to cast;
//   - every reader resolves both shapes — unwrapLocalized / localizedSearchText
//     on the server, localizedText / editableText on the client;
//   - the $text index in models/Property.js covers BOTH `description` and
//     `description.en`, so keyword search keeps finding un-migrated properties.
//
// What running it buys is the actual feature: a visitor reading in Turkish or
// Arabic sees the description in their own language instead of the one language
// it was typed in.
//
// The raw MongoDB driver is used for the read/write pass rather than the
// Mongoose model, for two reasons: the query needs `$type: 'string'`, which is
// a storage-level question the model cannot express, and a document loaded
// through the model and re-saved would drag every other field's validation into
// a migration that should touch exactly one field.
//
// Translation cost: one MyMemory call per target language per property (five
// per property, plus one detection call for text with no Turkish diacritics or
// Arabic script). MyMemory's free tier is rate limited, so a large catalogue is
// worth running in off-hours. A property whose translation fails is reported and
// LEFT AS A STRING — it stays readable, and re-running the script retries only
// those, since a migrated property no longer matches `$type: 'string'`.
//
// Safe to re-run. Safe to interrupt: each property is written independently, so
// stopping halfway leaves a mix of both shapes, which is exactly the state
// everything already handles.
//
// Usage:
//   node scripts/backfillPropertyDescriptions.js             -> migrate, then sync indexes
//   node scripts/backfillPropertyDescriptions.js --dry-run   -> report only, write nothing
//   node scripts/backfillPropertyDescriptions.js --indexes-only

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import Property from '../models/Property.js'
import { localizeText } from '../utils/autoTranslate.js'
import { SUPPORTED_LANGUAGES } from '../utils/localizedField.js'

dotenv.config()

const dryRun = process.argv.includes('--dry-run')
const indexesOnly = process.argv.includes('--indexes-only')

/*
 * Rebuilds the collection's text index to the definition in models/Property.js.
 *
 * MongoDB allows exactly one text index per collection, and this wave changed
 * which paths it covers (`description` alone -> `description` plus
 * `description.en`). syncIndexes drops indexes the schema no longer declares and
 * creates the ones it does, which is the whole of the required migration.
 *
 * Deliberately non-fatal. A failure here costs keyword-search quality until it
 * is rerun; it cannot lose data, and it must not undo a completed description
 * migration by exiting non-zero.
 */
const syncTextIndex = async () => {
  console.log('')
  console.log('Syncing indexes to the current schema (replaces the old description-only text index)...')
  try {
    await Property.syncIndexes()
    console.log('Indexes synced.')
    return true
  } catch (err) {
    console.log(`Index sync FAILED — no data was harmed, but rerun this with --indexes-only: ${err.message}`)
    return false
  }
}

const run = async () => {
  await connectDB()

  if (indexesOnly) {
    await syncTextIndex()
    await mongoose.disconnect()
    process.exit(0)
  }

  const collection = mongoose.connection.db.collection('properties')

  const legacy = await collection
    .find({ description: { $type: 'string' } })
    .project({ description: 1, title: 1 })
    .toArray()

  console.log(
    `Found ${legacy.length} propert${legacy.length === 1 ? 'y' : 'ies'} with a plain-string description.` +
      (dryRun ? ' (--dry-run: nothing will be written.)' : '')
  )

  let migrated = 0
  let blanked = 0
  let failed = 0

  for (let i = 0; i < legacy.length; i += 1) {
    const doc = legacy[i]
    const label = `[${i + 1}/${legacy.length}] ${doc.title || doc._id}`
    const text = (doc.description || '').trim()

    // A property whose description is an empty or whitespace-only string has no
    // text to translate. It becomes the blank localized shape so it stops
    // matching this script's query on the next run, and costs no API call.
    if (!text) {
      if (!dryRun) await collection.updateOne({ _id: doc._id }, { $set: { description: {} } })
      console.log(`${label} — empty, reset to the blank localized shape`)
      blanked += 1
      continue
    }

    if (dryRun) {
      console.log(`${label} — would migrate (${text.length} chars)`)
      migrated += 1
      continue
    }

    try {
      const localized = await localizeText(text)

      /*
       * Guard against writing a shape that lost the text.
       *
       * localizeText stores the admin's own words under their detected source
       * language and leaves a target ABSENT when the provider had nothing real
       * to offer — absence is correct, and readers fall back through it. What
       * would not be correct is replacing a readable string with an object that
       * has no usable copy at all, so that case is reported as a failure and the
       * original string is left exactly where it is.
       */
      const hasText = SUPPORTED_LANGUAGES.some(
        (lang) => typeof localized[lang] === 'string' && localized[lang].trim() !== ''
      )
      if (!hasText) {
        console.log(`${label} — FAILED: localization produced no usable text, left as a string`)
        failed += 1
        continue
      }

      await collection.updateOne({ _id: doc._id }, { $set: { description: localized } })

      const filled = SUPPORTED_LANGUAGES.filter((lang) => localized[lang]).length
      console.log(`${label} — migrated (source ${localized.sourceLang}, ${filled}/${SUPPORTED_LANGUAGES.length} languages)`)
      migrated += 1
    } catch (err) {
      // Left as a string on purpose: the next run retries exactly these.
      console.log(`${label} — FAILED: ${err.message}`)
      failed += 1
    }
  }

  console.log('')
  console.log(
    `Done. ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated}, blanked: ${blanked}, failed: ${failed}.`
  )
  if (failed > 0) console.log('Rerun the script to retry the failures — migrated properties are skipped automatically.')

  if (dryRun) {
    console.log('')
    console.log('--dry-run: indexes were not touched either. Rerun without the flag to migrate and sync indexes.')
  } else {
    await syncTextIndex()
  }

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
