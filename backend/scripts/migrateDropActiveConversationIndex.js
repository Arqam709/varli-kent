// backend/scripts/migrateDropActiveConversationIndex.js
//
// One-off migration: drops the old partial unique index on ChatConversation
// that enforced "one active conversation per user". Removing the index
// declaration from the Mongoose schema does NOT drop it from the live
// collection — this script does that part, safely and idempotently.
//
// Then verifies (using a synthetic, non-existent user id — never a real
// user's data) that two ChatConversation documents with status:'active'
// can now coexist for the same user, and cleans up those synthetic
// documents immediately after. No real data is touched.
//
// Usage: node scripts/migrateDropActiveConversationIndex.js

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import ChatConversation from '../models/ChatConversation.js'

dotenv.config()

const line = () => console.log('='.repeat(70))

const printIndexes = (indexes, label) => {
  console.log(label)
  indexes.forEach((idx) => {
    console.log(
      `  - name: ${idx.name} | key: ${JSON.stringify(idx.key)} | unique: ${Boolean(idx.unique)}` +
        (idx.partialFilterExpression ? ` | partialFilterExpression: ${JSON.stringify(idx.partialFilterExpression)}` : '')
    )
  })
}

const run = async () => {
  await connectDB()

  line()
  console.log('STEP 1: Indexes before migration')
  line()

  const indexesBefore = await ChatConversation.collection.indexes()
  printIndexes(indexesBefore, 'Current indexes on ChatConversation:')

  line()
  console.log('STEP 2: Identify the old partial unique active-conversation index')
  line()

  // Identified strictly by shape: key must be exactly { user: 1 } (a single
  // field) and unique must be true. This cannot match `_id_` (key {_id:1})
  // or either of the two non-unique compound indexes (different key shapes),
  // so there is no ambiguity about which index this targets.
  const targetIndex = indexesBefore.find(
    (idx) => JSON.stringify(idx.key) === JSON.stringify({ user: 1 }) && idx.unique === true
  )

  if (!targetIndex) {
    console.log('No matching index found — either it was already dropped, or it never existed under this shape.')
    console.log('Nothing to drop. Treating this as already-migrated (safe, idempotent).')
  } else {
    console.log(`Found target index: "${targetIndex.name}" (key: ${JSON.stringify(targetIndex.key)}, unique: true)`)

    if (targetIndex.name === '_id_') {
      console.log('SAFETY ABORT: refusing to drop an index named _id_. Stopping without making changes.')
      await mongoose.disconnect()
      process.exit(1)
    }

    line()
    console.log('STEP 3: Dropping the identified index')
    line()

    await ChatConversation.collection.dropIndex(targetIndex.name)
    console.log(`Dropped index "${targetIndex.name}".`)
  }

  line()
  console.log('STEP 4: Indexes after migration')
  line()

  const indexesAfter = await ChatConversation.collection.indexes()
  printIndexes(indexesAfter, 'Current indexes on ChatConversation:')

  const idIndexStillPresent = indexesAfter.some((idx) => idx.name === '_id_')
  const compoundIndexesStillPresent =
    indexesAfter.some((idx) => JSON.stringify(idx.key) === JSON.stringify({ user: 1, lastActivityAt: -1 })) &&
    indexesAfter.some((idx) => JSON.stringify(idx.key) === JSON.stringify({ status: 1, lastActivityAt: -1 }))
  const uniqueActiveIndexGone = !indexesAfter.some(
    (idx) => JSON.stringify(idx.key) === JSON.stringify({ user: 1 }) && idx.unique === true
  )

  console.log('')
  console.log(`${idIndexStillPresent ? '✓' : '✗'} _id_ index untouched`)
  console.log(`${compoundIndexesStillPresent ? '✓' : '✗'} Both non-unique compound indexes untouched`)
  console.log(`${uniqueActiveIndexGone ? '✓' : '✗'} Partial unique active-conversation index is gone`)

  line()
  console.log('STEP 5: Verify two active-status conversations can coexist for one user')
  line()
  console.log('Using a synthetic, freshly-generated user id — not a real user — for this check.')

  const syntheticUserId = new mongoose.Types.ObjectId()
  let created = []

  try {
    const convA = await ChatConversation.create({ user: syntheticUserId, status: 'active' })
    const convB = await ChatConversation.create({ user: syntheticUserId, status: 'active' })
    created = [convA._id, convB._id]

    console.log(`✓ Created conversation A (${convA._id}) with status: active`)
    console.log(`✓ Created conversation B (${convB._id}) with status: active`)
    console.log('✓ Both coexist — the old constraint no longer blocks this.')
  } catch (err) {
    console.log(`✗ Failed to create two coexisting active conversations: ${err.message}`)
  } finally {
    if (created.length > 0) {
      const result = await ChatConversation.deleteMany({ _id: { $in: created } })
      console.log(`Cleanup: deleted ${result.deletedCount} synthetic test document(s) (synthetic user id, not real data).`)
    }
  }

  console.log('')
  line()
  console.log('No real ChatConversation documents were modified or deleted by this script.')
  line()

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
