// backend/services/propertyEmbeddingService.js
//
// Shared property-embedding logic — the single source of truth for what
// text gets embedded and when re-embedding is warranted. Reused by the
// property create/update routes and the manual backfill script, so all
// three stay consistent with each other and with every property already
// embedded.

import { getEmbedding } from '../utils/embeddings.js'
import { unwrapLocalized } from '../utils/localizedField.js'

// Only these fields feed the embedding text (see buildPropertyEmbeddingText
// below). Changes to any other property field (price, images, status,
// beds, featured, ...) must never trigger re-embedding — it would cost an
// API call for zero effect on the resulting vector.
export const EMBEDDING_SOURCE_FIELDS = ['title', 'description', 'district', 'address']

/*
 * One field's text, as a plain string.
 *
 * `description` is localized — a { sourceLang, en, tr, ... } object, or a plain
 * string on a property written before that change. unwrapLocalized collapses
 * either shape to the admin's own source-language words, so the embedding is
 * built from real text instead of "[object Object]".
 *
 * The SOURCE language, not English specifically: the embedding model is
 * multilingual, and the admin's own sentence is the one piece of text here
 * that is certainly not a machine translation.
 */
const fieldText = (property, field) =>
  field === 'description' ? unwrapLocalized(property.description) : property[field]

// Exact convention already used by scripts/backfillPropertyEmbeddings.js —
// preserved unchanged so newly-generated embeddings stay comparable (same
// vector space) with everything already backfilled under this convention.
export const buildPropertyEmbeddingText = (property = {}) =>
  EMBEDDING_SOURCE_FIELDS.map((field) => fieldText(property, field)).filter(Boolean).join('. ')

// True only if applying `updates` would actually change at least one of the
// four embedding-relevant fields on `oldProperty`. A field absent from
// `updates` is treated as unchanged — a PUT payload only needs to include
// the fields it's actually changing.
//
// Compares RESOLVED text, not raw values, because description's two sides are
// routinely different shapes: the stored value may be a legacy string while the
// incoming one is always a localized object. Comparing those raw would report a
// change on every single save and re-embed for nothing.
export const embeddingSourceFieldsChanged = (oldProperty = {}, updates = {}) =>
  EMBEDDING_SOURCE_FIELDS.some(
    (field) => field in updates && fieldText(updates, field) !== fieldText(oldProperty, field)
  )

// Generates { descriptionEmbedding, embeddingUpdatedAt } for a
// property-like object, or null if there's no text to embed or the
// embedding request fails. getEmbedding already fails soft (returns null,
// never throws) — this does too. Callers must treat a null result as
// "proceed without an embedding," never as an error.
export const generatePropertyEmbedding = async (property = {}) => {
  const text = buildPropertyEmbeddingText(property)
  if (!text.trim()) return null

  const embedding = await getEmbedding(text)
  if (!embedding) return null

  return { descriptionEmbedding: embedding, embeddingUpdatedAt: new Date() }
}
