// An in-memory stand-in for models/ContactInterest.js.
//
// Not a test file (tests/*.test.js does not match this directory). It is shared
// by the suites that mock the model, so they all agree on what the database
// does:
//
//   - `id` and `value` are unique, and a violation throws the same shape as a
//     MongoDB duplicate-key error (code 11000)
//   - `lean()` and plain awaiting both work where the service and routes use them
//   - every stored document is cloned on the way in and out, so a caller can
//     never mutate "the database" by accident
//
// Only the query operators the production code actually uses are supported;
// anything else throws, so a new query cannot silently match everything.

const clone = (value) => structuredClone(value)

const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([key, condition]) => {
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      if (Object.keys(condition).length === 1 && '$ne' in condition) return doc[key] !== condition.$ne
      throw new Error(`fake ContactInterest does not support the filter ${JSON.stringify({ [key]: condition })}`)
    }
    return doc[key] === condition
  })

const duplicateKeyError = (field) =>
  Object.assign(new Error(`E11000 duplicate key error collection: contactinterests index: ${field}_1 dup key`), {
    code: 11000,
  })

/** A thenable that also offers `.lean()`, like a Mongoose query. */
const query = (produce) => {
  const run = () => Promise.resolve().then(produce)
  return {
    lean: () => run(),
    then: (resolve, reject) => run().then(resolve, reject),
  }
}

export const createFakeContactInterestModel = () => {
  const docs = new Map()
  const calls = []
  let nextObjectId = 1
  /** Set to an Error to make the next create/updateOne throw it once. */
  const failures = { create: null, updateOne: null }

  const all = () => [...docs.values()]

  const insert = (data) => {
    if (docs.has(data.id)) throw duplicateKeyError('id')
    if (all().some((doc) => doc.value === data.value)) throw duplicateKeyError('value')

    const now = new Date()
    const stored = {
      _id: `oid${nextObjectId++}`,
      __v: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ...clone(data),
    }
    docs.set(stored.id, stored)
    return stored
  }

  const model = {
    docs,
    calls,
    failures,

    /** Replaces the whole collection. */
    seed(list) {
      docs.clear()
      for (const item of list) insert(item)
    },

    async init() {
      calls.push({ method: 'init' })
    },

    find(filter) {
      calls.push({ method: 'find', filter })
      return query(() => all().filter((doc) => matches(doc, filter)).map(clone))
    },

    findOne(filter) {
      calls.push({ method: 'findOne', filter })
      return query(() => {
        const found = all().find((doc) => matches(doc, filter))
        return found ? clone(found) : null
      })
    },

    async exists(filter) {
      calls.push({ method: 'exists', filter })
      const found = all().find((doc) => matches(doc, filter))
      return found ? { _id: found._id } : null
    },

    async countDocuments(filter) {
      calls.push({ method: 'countDocuments', filter })
      return all().filter((doc) => matches(doc, filter)).length
    },

    async create(data) {
      calls.push({ method: 'create', data: clone(data) })
      if (failures.create) {
        const error = failures.create
        failures.create = null
        throw error
      }
      const stored = insert(data)
      return { ...clone(stored), toObject: () => clone(stored) }
    },

    async updateOne(filter, update, options = {}) {
      calls.push({ method: 'updateOne', filter: clone(filter), update: clone(update), options: clone(options) })
      if (failures.updateOne) {
        const error = failures.updateOne
        failures.updateOne = null
        throw error
      }

      const operators = Object.keys(update)
      const unsupported = operators.find((op) => op !== '$setOnInsert')
      if (unsupported) throw new Error(`fake ContactInterest.updateOne does not support ${unsupported}`)

      const existing = all().find((doc) => matches(doc, filter))
      if (existing) return { acknowledged: true, matchedCount: 1, modifiedCount: 0, upsertedCount: 0 }
      if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }

      insert({ ...filter, ...update.$setOnInsert })
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    },

    findOneAndUpdate(filter, update, options = {}) {
      calls.push({ method: 'findOneAndUpdate', filter: clone(filter), update: clone(update), options: clone(options) })
      return query(() => {
        const existing = all().find((doc) => matches(doc, filter))
        if (!existing) return null

        const operators = Object.keys(update)
        if (operators.some((op) => op !== '$set')) {
          throw new Error(`fake ContactInterest.findOneAndUpdate supports only $set, got ${operators.join(', ')}`)
        }

        const changes = clone(update.$set)
        // Mirrors Mongoose: immutable paths are stripped from updates.
        delete changes.id
        delete changes.value
        if (changes.labels !== undefined && !(typeof changes.labels?.en === 'string' && changes.labels.en.trim())) {
          throw Object.assign(new Error('ContactInterest validation failed: labels.en: An English label is required'), {
            name: 'ValidationError',
          })
        }

        Object.assign(existing, changes, { updatedAt: new Date() })
        return options.returnDocument === 'after' ? clone(existing) : null
      })
    },
  }

  return model
}
