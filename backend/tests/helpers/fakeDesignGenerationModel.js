// An in-memory stand-in for models/DesignGeneration.js.
//
// It honours exactly the filters, operators and query chains the production
// code sends, so a query that dropped `user: req.user._id`, or an update that
// skipped a status guard, WOULD match the wrong record here and fail the
// tests. Anything unsupported throws rather than silently matching.
//
// What it cannot prove is ATOMICITY: single-document concurrency is covered by
// designGenerations.mongo.test.js against a real MongoDB.

const clone = (value) => {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value)
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

const same = (a, b) => (a instanceof Date || b instanceof Date)
  ? a?.getTime?.() === b?.getTime?.()
  : String(a) === String(b)

const read = (doc, path) => path.split('.').reduce((node, key) => node?.[key], doc)

const isOperatorObject = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

const matchesCondition = (value, condition) => {
  if (condition === null) return value === null || value === undefined
  if (!isOperatorObject(condition)) return same(value, condition)

  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case '$in': return operand.some((item) => same(value, item))
      case '$nin': return !operand.some((item) => same(value, item))
      case '$lt': return value != null && value < operand
      case '$lte': return value != null && value <= operand
      case '$gt': return value != null && value > operand
      case '$gte': return value != null && value >= operand
      case '$ne': return !same(value, operand)
      case '$exists': return (value !== undefined && value !== null) === operand
      default: throw new Error(`fake DesignGeneration does not support ${operator}`)
    }
  })
}

const matches = (doc, filter = {}) => Object.entries(filter).every(([path, condition]) => {
  if (path === '$or') return condition.some((clause) => matches(doc, clause))
  if (path.startsWith('$')) throw new Error(`fake DesignGeneration does not support ${path}`)
  return matchesCondition(read(doc, path), condition)
})

const IMMUTABLE = ['user', 'board', 'boardSnapshot', 'roomPhoto', 'promptVersion', 'idempotencyKey']

const applyUpdate = (doc, update) => {
  for (const [operator, fields] of Object.entries(update)) {
    for (const [key, value] of Object.entries(fields)) {
      if (IMMUTABLE.includes(key)) throw new Error(`fake DesignGeneration: ${key} is immutable`)
      if (operator === '$set') doc[key] = clone(value)
      else if (operator === '$inc') doc[key] = (doc[key] ?? 0) + value
      else if (operator === '$max') doc[key] = doc[key] != null && doc[key] > value ? doc[key] : clone(value)
      else throw new Error(`fake DesignGeneration does not support ${operator}`)
    }
  }
  doc.updatedAt = new Date()
}

const sortDocs = (docs, sort) => {
  if (!sort) return docs
  const entries = Object.entries(sort)
  return [...docs].sort((a, b) => {
    for (const [key, direction] of entries) {
      const left = read(a, key)
      const right = read(b, key)
      if (left === right) continue
      return (left > right ? 1 : -1) * direction
    }
    return 0
  })
}

const query = (produce) => {
  let sort = null
  let skip = 0
  let limit = null
  const run = () => Promise.resolve().then(() => {
    let results = sortDocs(produce(), sort).slice(skip)
    if (limit != null) results = results.slice(0, limit)
    return results.map(clone)
  })
  const chain = {
    sort: (value) => { sort = value; return chain },
    skip: (value) => { skip = value; return chain },
    limit: (value) => { limit = value; return chain },
    then: (resolve, reject) => run().then(resolve, reject),
  }
  return chain
}

export const createFakeDesignGenerationModel = () => {
  const docs = new Map()
  const calls = []
  let counter = 0

  const all = () => [...docs.values()]

  const model = {
    docs,
    calls,

    /** Inserts a stored document directly, for arranging a test. */
    seed(doc) {
      const now = new Date()
      const stored = {
        attempts: 0, leaseUntil: null, result: null, error: {},
        startedAt: null, completedAt: null, deletedAt: null, purgedAt: null,
        createdAt: now, updatedAt: now,
        ...clone(doc),
      }
      stored._id = String(stored._id ?? (++counter).toString(16).padStart(24, 'a'))
      docs.set(stored._id, stored)
      return clone(stored)
    },

    async create(data) {
      calls.push({ method: 'create', data: clone(data) })
      const stored = clone(data)
      stored._id = String(stored._id ?? (++counter).toString(16).padStart(24, 'a'))
      if (all().some((doc) => same(doc.user, stored.user) && doc.idempotencyKey === stored.idempotencyKey)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      }
      const now = new Date()
      docs.set(stored._id, {
        attempts: 0, leaseUntil: null, result: null, error: {},
        startedAt: null, completedAt: null, deletedAt: null, purgedAt: null,
        createdAt: now, updatedAt: now,
        ...stored,
      })
      return clone(docs.get(stored._id))
    },

    async findOne(filter) {
      calls.push({ method: 'findOne', filter: clone(filter) })
      const doc = all().find((item) => matches(item, filter))
      return doc ? clone(doc) : null
    },

    find(filter) {
      calls.push({ method: 'find', filter: clone(filter) })
      return query(() => all().filter((item) => matches(item, filter)))
    },

    async countDocuments(filter) {
      calls.push({ method: 'countDocuments', filter: clone(filter) })
      return all().filter((item) => matches(item, filter)).length
    },

    async findOneAndUpdate(filter, update, options = {}) {
      calls.push({ method: 'findOneAndUpdate', filter: clone(filter), update: clone(update), options })
      const candidates = sortDocs(all().filter((item) => matches(item, filter)), options.sort)
      const doc = candidates[0]
      if (!doc) return null
      applyUpdate(doc, update)
      return clone(doc)
    },

    async updateOne(filter, update) {
      calls.push({ method: 'updateOne', filter: clone(filter), update: clone(update) })
      const doc = all().find((item) => matches(item, filter))
      if (doc) applyUpdate(doc, update)
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 }
    },

    async updateMany(filter, update) {
      calls.push({ method: 'updateMany', filter: clone(filter), update: clone(update) })
      const targets = all().filter((item) => matches(item, filter))
      for (const doc of targets) applyUpdate(doc, update)
      return { matchedCount: targets.length, modifiedCount: targets.length }
    },
  }

  return model
}
