// backend/scripts/backfillPropertyEmbeddings.js
//
// Generates descriptionEmbedding + embeddingUpdatedAt for properties, using
// the same title+description+district+address text the existing $text
// search index already weighs. Not wired into the chatbot yet — running
// this script has no effect on chatbot behavior until a later phase reads
// these fields.
//
// Usage:
//   node scripts/backfillPropertyEmbeddings.js            -> only properties missing an embedding
//   node scripts/backfillPropertyEmbeddings.js --force     -> regenerate every property's embedding

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import Property from '../models/Property.js'
import { getEmbedding } from '../utils/embeddings.js'

dotenv.config()

const force = process.argv.includes('--force')

const buildEmbeddingText = (property) =>
  [property.title, property.description, property.district, property.address].filter(Boolean).join('. ')

const run = async () => {
  await connectDB()

  const filter = force ? {} : { descriptionEmbedding: { $exists: false } }
  const properties = await Property.find(filter).select('title description district address descriptionEmbedding')

  console.log(
    `Found ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} to embed ` +
      `(${force ? '--force: regenerating all' : 'missing embeddings only'}).`
  )

  let succeeded = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < properties.length; i++) {
    const property = properties[i]
    const label = `[${i + 1}/${properties.length}] ${property.title}`
    const text = buildEmbeddingText(property)

    if (!text.trim()) {
      console.log(`${label} — skipped (no title/description/district/address text)`)
      skipped += 1
      continue
    }

    const embedding = await getEmbedding(text)

    if (!embedding) {
      console.log(`${label} — FAILED (embedding request returned nothing)`)
      failed += 1
      continue
    }

    property.descriptionEmbedding = embedding
    property.embeddingUpdatedAt = new Date()
    await property.save()

    console.log(`${label} — embedded (${embedding.length} dims)`)
    succeeded += 1
  }

  console.log('')
  console.log(`Done. Embedded: ${succeeded}, skipped: ${skipped}, failed: ${failed}.`)

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
