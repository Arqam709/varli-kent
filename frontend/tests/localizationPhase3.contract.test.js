// Localization Phase 3 — canonical backend enum values are LABELLED in the
// interface, never translated in data.
//
//   value (API, database, filters)   'Apartment'   — always
//   label (what a person reads)      'Daire' in Turkish
//
// The enum lists are read from the backend models' own source, so a value
// added to the schema without a label fails here. The browser half lives in
// tests/browser/enumLocalization.test.js. Run with `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import translations from '../src/locales/translations.js'
import {
  PROPERTY_TYPES, LISTING_TYPES, PROPERTY_STATUSES, CONTACT_STATUSES,
  enumLabel, propertyTypeLabel, listingTypeLabel, propertyStatusLabel, contactStatusLabel,
} from '../src/lib/enumLabels.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const SRC = join(here, '..', 'src')
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const read = async (...p) =>
  (await readFile(join(SRC, ...p), 'utf8'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

// `field: { ... enum: [ ... ] ... }` from a Mongoose model source file.
const schemaEnum = async (model, field) => {
  const source = await readFile(join(ROOT, 'backend', 'models', model), 'utf8')
  const at = source.search(new RegExp(`\\n\\s*${field}:\\s*\\{`))
  assert.ok(at !== -1, `${model} defines ${field}`)
  const match = source.slice(at).match(/enum:\s*\[([^\]]*)\]/)
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

// ── 1–3. Every schema value has a label in all six languages ──────────────
const GROUPS = [
  ['propertyType', 'Property.js', 'propertyType', PROPERTY_TYPES],
  ['listingType', 'Property.js', 'listingType', LISTING_TYPES],
  ['propertyStatus', 'Property.js', 'status', PROPERTY_STATUSES],
  ['contactStatus', 'ContactSubmission.js', 'status', CONTACT_STATUSES],
]

for (const [group, model, field, helperList] of GROUPS) {
  test(`${group}: the frontend list matches ${model} ${field} exactly`, async () => {
    assert.deepEqual(helperList, await schemaEnum(model, field))
  })

  test(`${group}: every schema value has a label in all six languages`, async () => {
    const values = await schemaEnum(model, field)
    for (const lang of LANGS) {
      const block = translations[lang].enums?.[group]
      assert.ok(block, `${lang}.enums.${group}`)
      assert.deepEqual(Object.keys(block).sort(), [...values].sort(), `${lang}: keys are exactly the canonical values`)
      for (const value of values) assert.ok(typeof block[value] === 'string' && block[value].trim(), `${lang}.enums.${group}.${value}`)
    }
  })
}

test('English labels read exactly as the interface showed before', () => {
  for (const value of PROPERTY_TYPES) assert.equal(propertyTypeLabel(value, 'en'), value)
  for (const value of PROPERTY_STATUSES) assert.equal(propertyStatusLabel(value, 'en'), value)
  for (const value of CONTACT_STATUSES) assert.equal(contactStatusLabel(value, 'en'), value)
  assert.equal(listingTypeLabel('Sale', 'en'), 'For Sale')
  assert.equal(listingTypeLabel('Rent', 'en'), 'For Rent')
})

test('Turkish uses the site\'s established terminology', () => {
  assert.deepEqual(translations.tr.enums.propertyType, {
    Apartment: 'Daire', Villa: 'Villa', Penthouse: 'Çatı Katı', Duplex: 'Dubleks', Studio: 'Stüdyo Daire', Office: 'Ofis',
    Commercial: 'Ticari Mülk', Land: 'Arsa', Shop: 'Dükkan', Warehouse: 'Depo', Hotel: 'Otel', Farm: 'Çiftlik',
  })
  assert.deepEqual(translations.tr.enums.listingType, { Sale: 'Satılık', Rent: 'Kiralık' })
  assert.deepEqual(translations.tr.enums.propertyStatus, { Available: 'Mevcut', Sold: 'Satıldı', Rented: 'Kiralandı', Pending: 'Beklemede' })
  assert.deepEqual(translations.tr.enums.contactStatus, { New: 'Yeni', Replied: 'Yanıtlandı', Archived: 'Arşivlendi' })
})

test('reused labels stay identical to the wording the site already shows', () => {
  for (const lang of LANGS) {
    const t = translations[lang]
    assert.equal(t.enums.listingType.Sale, t.propertyCard.forSale, lang)
    assert.equal(t.enums.listingType.Rent, t.propertyCard.forRent, lang)
    assert.equal(t.enums.propertyStatus.Available, t.adminPages.properties.available, lang)
    assert.equal(t.enums.propertyStatus.Sold, t.adminPages.properties.sold, lang)
    assert.equal(t.enums.contactStatus.Replied, t.adminPages.messages.replied, lang)
  }
})

// ── 4. Unknown values fall back safely ─────────────────────────────────────
test('4. an unknown value renders as itself and never throws', () => {
  for (const lang of [...LANGS, 'xx', undefined]) {
    assert.equal(propertyTypeLabel('SomethingNew', lang), 'SomethingNew')
    assert.equal(propertyStatusLabel('Archived', lang), 'Archived')
    assert.equal(enumLabel('notAGroup', 'Apartment', lang), 'Apartment')
  }
  assert.equal(propertyTypeLabel(undefined, 'tr'), '')
  assert.equal(propertyTypeLabel(null, 'tr'), '')
  assert.equal(propertyTypeLabel('', 'tr'), '')
  assert.equal(propertyTypeLabel(42, 'tr'), '42')
  // An unsupported language uses English, not the raw value.
  assert.equal(listingTypeLabel('Sale', 'xx'), 'For Sale')
})

test('the helper never mutates what it is given', () => {
  const property = Object.freeze({ propertyType: 'Apartment', listingType: 'Sale', status: 'Available' })
  propertyTypeLabel(property.propertyType, 'tr')
  listingTypeLabel(property.listingType, 'tr')
  propertyStatusLabel(property.status, 'tr')
  assert.deepEqual(property, { propertyType: 'Apartment', listingType: 'Sale', status: 'Available' })
})

// ── 5–14. Components display labels, and keep canonical values ─────────────
test('5/6. PropertyCard shows the label; its listing logic still compares canonical values', async () => {
  const source = await read('components', 'PropertyCard.jsx')
  assert.match(source, /\{propertyTypeLabel\(property\.propertyType, language\)\}/)
  assert.match(source, /property\.listingType === 'Rent'/)
  assert.doesNotMatch(source, />\{property\.propertyType\}</)
})

test('7/8. PropertiesPage: option VALUES are canonical, option TEXT is the label', async () => {
  const source = await read('pages', 'PropertiesPage.jsx')
  assert.match(source, /PROPERTY_TYPES\.map\(type => <option key=\{type\} value=\{type\}>\{propertyTypeLabel\(type, language\)\}<\/option>\)/)
  assert.match(source, /import \{ PROPERTY_TYPES, propertyTypeLabel \} from '\.\.\/lib\/enumLabels'/)
  assert.doesNotMatch(source, /const PROPERTY_TYPES\s*=/, 'no second copy of the list')
})

test('9–11. PropertyDetailsPage labels propertyType, listingType and status', async () => {
  const source = await read('pages', 'PropertyDetailsPage.jsx')
  assert.match(source, /propertyTypeLabel\(property\.propertyType, language\)/)
  assert.match(source, /listingTypeLabel\(property\.listingType, language\)/)
  assert.match(source, /propertyStatusLabel\(property\.status, language\)/)
  // Comparisons on the raw values are untouched.
  assert.match(source, /property\.listingType === 'Rent'/)
})

test('12. AIChatbot labels the card type and nothing about the request changes', async () => {
  const source = await read('components', 'AIChatbot.jsx')
  assert.match(source, /\{propertyTypeLabel\(property\.propertyType, language\)\}/)
  assert.doesNotMatch(source, /\{property\.propertyType\}/)
})

test('13. AgentPropertyCard labels type and status; the colour still keys off the value', async () => {
  const source = await read('components', 'AgentPropertyCard.jsx')
  assert.match(source, /\{propertyStatusLabel\(property\.status, language\)\}/)
  assert.match(source, /\{propertyTypeLabel\(property\.propertyType, language\)\}/)
  assert.match(source, /STATUS_STYLES\[property\.status\]/)
})

test('14. AdminMessages interpolates the localized contact status, and still sends the canonical one', async () => {
  const source = await read('pages', 'AdminMessages.jsx')
  assert.match(source, /\.replace\('\{status\}', contactStatusLabel\(status, language\)\)/)
  assert.match(source, /\{contactStatusLabel\(msg\.status, language\)\}/)
  assert.match(source, /api\.patch\(`\/contact\/\$\{id\}\/status`, \{ status \}\)/)
  assert.match(source, /updateStatus\(msg\._id, 'Replied'\)/)
})

// ── 16. Labels live in ONE place ───────────────────────────────────────────
test('16. no source file outside the catalogue hard-codes the enum translations', async () => {
  const labels = new Set()
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    for (const group of Object.values(translations[lang].enums)) {
      for (const [value, label] of Object.entries(group)) {
        // Labels identical to the value (e.g. "Villa") or very short words are
        // not distinctive enough to search for.
        if (label !== value && label.length >= 4) labels.add(label)
      }
    }
  }

  const offenders = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'locales') await walk(full)
      } else if (/\.(jsx?|mjs)$/.test(entry.name)) {
        // Comments stripped: prose explaining the mechanism may quote a label.
        const source = (await readFile(full, 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/^[ \t]*\/\/.*$/gm, ' ')
        for (const label of labels) {
          if (source.includes(`'${label}'`) || source.includes(`"${label}"`) || source.includes(`>${label}<`)) {
            offenders.push(`${full.slice(SRC.length)}: ${label}`)
          }
        }
      }
    }
  }
  await walk(SRC)
  assert.deepEqual(offenders, [])
})

// A map keyed by the canonical value whose entries are WORDS is a label map.
// One whose entries are CSS classes (AgentPropertyCard's STATUS_STYLES) is not.
const labelEntry = (key) => new RegExp(`\\b${key}:\\s*['"](?!bg-|text-)[^'"]+['"]`)

test('16. the label-map check catches a label map and ignores a colour map', () => {
  assert.match("Available: 'Mevcut',", labelEntry('Available'))
  assert.match('Apartment: "Daire",', labelEntry('Apartment'))
  assert.doesNotMatch("Available: 'bg-green-100 text-green-700',", labelEntry('Available'))
})

test('16. no component keeps its own value→label map for these enums', async () => {
  const files = ['components/PropertyCard.jsx', 'pages/PropertiesPage.jsx', 'pages/PropertyDetailsPage.jsx',
    'components/AIChatbot.jsx', 'components/AgentPropertyCard.jsx', 'pages/AdminMessages.jsx']
  for (const file of files) {
    const source = await read(...file.split('/'))
    for (const key of ['Apartment', 'Available', 'Replied']) {
      assert.doesNotMatch(source, labelEntry(key), `${file} maps ${key} itself`)
    }
  }
})
