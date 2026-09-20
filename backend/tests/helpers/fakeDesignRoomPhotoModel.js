// An in-memory stand-in for models/DesignRoomPhoto.js.
//
// It honours exactly the filters the production code sends, so a query that
// forgot `user: req.user._id` or `status: 'ready'` WOULD match the wrong record
// here and fail the tests. Unsupported operators throw instead of silently
// matching everything.

// Deep copy that stores ObjectIds as their hex string, the way they compare in MongoDB.
const clone = (value) => {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value)
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}
const same = (a, b) => (a instanceof Date || b instanceof Date)
  ? a?.getTime?.() === b?.getTime?.()
  : String(a) === String(b)

const read = (doc, path) => path.split('.').reduce((node, key) => node?.[key], doc)

// Only a plain object is an operator expression; ObjectIds and Dates are values.
const isOperatorObject = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

const matchesCondition = (value, condition) => {
  if (condition === null) return value === null || value === undefined
  if (!isOperatorObject(condition)) return same(value, condition)

  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case '$in': return operand.some((item) => same(value, item))
      case '$lt': return value != null && value < operand
      case '$lte': return value != null && value <= operand
      case '$gte': return value != null && value >= operand
      default: throw new Error(`fake DesignRoomPhoto does not support ${operator}`)
    }
  })
}

const matches = (doc, filter = {}) => Object.entries(filter).every(([path, condition]) => matchesCondition(read(doc, path), condition))

const applyUpdate = (doc, update) => {
  const keys = Object.keys(update)
  if (keys.length !== 1 || keys[0] !== '$set') throw new Error('fake DesignRoomPhoto only supports $set updates')
  for (const [key, value] of Object.entries(update.$set)) {
    if (['user', 'asset', 'width', 'height', 'bytes', 'consentVersion'].includes(key)) {
      throw new Error(`fake DesignRoomPhoto: ${key} is immutable`)
    }
    doc[key] = value instanceof Date ? new Date(value) : clone(value)
  }
  doc.updatedAt = new Date()
}

const query = (produce) => {
  let sort = null
  let limit = null
  const run = () => Promise.resolve().then(() => {
    let results = produce()
    if (sort) {
      const [[key, direction]] = Object.entries(sort)
      results = results.sort((a, b) => (read(a, key) - read(b, key)) * direction)
    }
    if (limit != null) results = results.slice(0, limit)
    return results.map(clone)
  })
  const chain = {
    sort: (value) => { sort = value; return chain },
    limit: (value) => { limit = value; return chain },
    then: (resolve, reject) => run().then(resolve, reject),
  }
  return chain
}

export const createFakeDesignRoomPhotoModel = () => {
  const docs = new Map()
  const calls = []
  const failures = { create: null, findOneAndUpdate: null, updateMany: null }

  const takeFailure = (method) => {
    const failure = failures[method]
    if (failure) {
      failures[method] = null
      throw failure
    }
  }

  const all = () => [...docs.values()]

  const model = {
    docs,
    calls,
    failures,

    /** Inserts a stored document directly, for arranging a test. */
    seed(doc) {
      const now = new Date()
      const stored = { purgedAt: null, deletedAt: null, createdAt: now, updatedAt: now, ...clone(doc) }
      stored._id = String(stored._id)
      docs.set(stored._id, stored)
      return clone(stored)
    },

    async create(data) {
      calls.push({ method: 'create', data: clone(data) })
      takeFailure('create')
      const now = new Date()
      const stored = { deletedAt: null, purgedAt: null, ...clone(data), createdAt: now, updatedAt: now }
      stored._id = String(stored._id)
      if (all().some((doc) => doc.asset.publicId === stored.asset.publicId)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      }
      docs.set(stored._id, stored)
      return clone(stored)
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
      takeFailure('findOneAndUpdate')
      const doc = all().find((item) => matches(item, filter))
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
      takeFailure('updateMany')
      const targets = all().filter((item) => matches(item, filter))
      for (const doc of targets) applyUpdate(doc, update)
      return { matchedCount: targets.length, modifiedCount: targets.length }
    },
  }

  return model
}
