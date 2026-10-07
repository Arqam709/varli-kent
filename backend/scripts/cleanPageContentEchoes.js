// Repairs legacy echoed translations in a CMS page record (Localization 4B.1).
//
//   node scripts/cleanPageContentEchoes.js                 report only (default)
//   node scripts/cleanPageContentEchoes.js --page=home     another page key
//   node scripts/cleanPageContentEchoes.js --write         back up, then remove
//
// Without --write NOTHING is written: the record is read with the raw driver
// (no Mongoose model, so no hooks, defaults or index builds) and a report is
// printed. With --write the exact record is first exported to a new,
// timestamped file under backend/backups/pagecontent/ (never overwritten; the
// folder is git-ignored). If that backup cannot be written and read back, the
// run stops before touching MongoDB.
//
// The rules for what may be removed are in services/pageContentEchoCleanup.js.
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fieldType } from '../config/pageContentRegistry.js'
import { runEchoCleanup, TARGET_LANGUAGES } from '../services/pageContentEchoCleanup.js'

dotenv.config({ quiet: true })

const here = dirname(fileURLToPath(import.meta.url))
const write = process.argv.includes('--write')
const pageKey = (process.argv.find((a) => a.startsWith('--page=')) || '--page=home').slice('--page='.length)

// The approved plan, restated on the command line. Required with --write:
//   --expect-removals=200 --expect-fields=40
//   --expect-preserved=heroLabel,heroCtaPrimary --expect-untouched=key1,key2,…
// Any difference from the freshly recomputed plan stops the run before the
// backup and the write.
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])
const expect = arg('expect-removals') === undefined ? null : {
  removals: Number(arg('expect-removals')),
  ...(arg('expect-fields') !== undefined ? { fields: Number(arg('expect-fields')) } : {}),
  preserved: list(arg('expect-preserved')),
  untouchedKeys: list(arg('expect-untouched')),
}
if (write && !expect) {
  console.error('STOPPED: --write requires --expect-removals=<n> (and ideally --expect-fields/--expect-preserved/--expect-untouched) matching the approved report.')
  process.exit(1)
}

// The default texts are defined once, in the frontend registry (the backend
// contract only records field types). Imported straight from source so the
// two can never disagree about what "untouched" means.
const loadDefaults = async (key) => {
  const registryPath = join(here, '..', '..', 'frontend', 'src', 'lib', 'pageContentRegistry.js')
  const { PAGE_CONTENT_REGISTRY } = await import(pathToFileURL(registryPath).href)
  const page = PAGE_CONTENT_REGISTRY[key]
  if (!page) throw new Error(`No registry entry for page '${key}'`)
  const fields = [...(page.hero?.fields || []), ...(page.sections || []).flatMap((s) => s.fields || [])]
  return Object.fromEntries(fields.filter((f) => f.type === 'text' && typeof f.default === 'string').map((f) => [f.key, f.default]))
}

const makeBackup = (EJSON) => async (record) => {
  const dir = join(here, '..', 'backups', 'pagecontent')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `pagecontent-${record.pageKey}-${record._id}-${stamp}.json`)
  const body = EJSON.stringify(record, null, 2, { relaxed: false })
  // 'wx': fail rather than overwrite if a file with this name already exists.
  writeFileSync(file, body, { flag: 'wx' })
  const readBack = EJSON.parse(readFileSync(file, 'utf8'), { relaxed: false })
  if (String(readBack._id) !== String(record._id) || JSON.stringify(Object.keys(readBack.fields || {})) !== JSON.stringify(Object.keys(record.fields || {}))) {
    throw new Error(`Backup at ${file} did not read back identically — nothing was changed`)
  }
  return file
}

const show = (value) => (value === null || value === undefined ? '(absent)' : JSON.stringify(value))

const run = async () => {
  const defaults = await loadDefaults(pageKey)
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false })
  const collection = mongoose.connection.db.collection('pagecontents')
  const { EJSON } = mongoose.mongo.BSON

  console.log(`Mode: ${write ? 'WRITE (backup first)' : 'REPORT ONLY — no database writes'}`)
  console.log(`Database: ${mongoose.connection.db.databaseName}   page: ${pageKey}`)

  const result = await runEchoCleanup({
    collection,
    pageKey,
    fieldTypeOf: (key) => fieldType(pageKey, key),
    defaults,
    write,
    backup: makeBackup(EJSON),
    expect,
  })
  await mongoose.disconnect()

  if (!result.found) { console.log(`No PageContent record for '${pageKey}'. Nothing to do.`); return }
  const { plan } = result

  console.log(`Record _id: ${result.recordId}`)
  console.log(`Registry defaults known for this page: ${Object.keys(defaults).length}`)
  console.log('')
  console.log(`Untouched-default fields (English === registry default): ${plan.untouchedDefaults.length}`)
  console.log(`  of which have echoed slots to remove:                    ${plan.cleanableFields.length}`)
  console.log(`Echoed slots to remove: ${plan.removals.length}`)
  console.log(`  per language: ${TARGET_LANGUAGES.map((l) => `${l}=${plan.countsByLanguage[l]}`).join('  ')}`)
  console.log('')
  console.log('Fields proposed for cleanup (English kept; listed slots removed):')
  for (const key of plan.cleanableFields) {
    const langs = plan.removals.filter((r) => r.key === key).map((r) => r.lang)
    const english = plan.removals.find((r) => r.key === key).value
    console.log(`  ${key.padEnd(20)} [${langs.join(',')}]  ${JSON.stringify(english.trim()).slice(0, 70)}`)
  }
  console.log('')
  console.log(`Admin-edited fields — PRESERVED, not modified (${plan.adminEdited.length}):`)
  for (const { key, defaultEnglish, values } of plan.adminEdited) {
    console.log(`  ${key}   (registry default: ${JSON.stringify(defaultEnglish)})`)
    for (const lang of ['en', ...TARGET_LANGUAGES]) console.log(`      ${lang}: ${show(values[lang])}`)
  }
  console.log('')
  console.log(`Left alone — keys not in this page's contract: ${plan.unregistered.length}`)
  if (plan.unregistered.length) console.log(`  ${plan.unregistered.join(', ')}`)
  console.log(`Left alone — registered text keys with no registry default: ${plan.noDefault.length}${plan.noDefault.length ? ' → ' + plan.noDefault.join(', ') : ''}`)
  console.log(`Left alone — non-English source language: ${plan.nonEnglishSource.length}${plan.nonEnglishSource.length ? ' → ' + plan.nonEnglishSource.map((f) => `${f.key}(${f.sourceLang})`).join(', ') : ''}`)
  console.log(`Left alone — slots of qualifying fields that differ from English: ${plan.keptSlots.length}`)
  for (const s of plan.keptSlots) console.log(`  ${s.key}.${s.lang}: ${s.reason}`)
  console.log(`Image fields (never touched): ${plan.images}`)

  if (write) {
    console.log('')
    if (result.wrote) {
      console.log(`Backup: ${result.backupPath}`)
      console.log(`Removed ${plan.removals.length} slot(s); modified ${result.modifiedCount} document(s).`)
      console.log(`Verification — echoed slots remaining: ${result.remainingAfterWrite}`)
    } else {
      console.log('Nothing to remove — no backup made, no write performed.')
    }
  } else {
    console.log('')
    console.log('Report only. Re-run with --write to back up the record and remove the slots listed above.')
  }
}

run().catch(async (err) => {
  console.error(`STOPPED: ${err.message}`)
  try { await mongoose.disconnect() } catch { /* already closed */ }
  process.exit(1)
})
