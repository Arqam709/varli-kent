// Contact interest bootstrap: putting the nine built-in defaults into MongoDB.
//
// The property that matters most is NEGATIVE: restarting the server must never
// restore a default over something an admin changed. So besides "the nine are
// inserted", these tests edit records between runs and prove the edits survive,
// and they inspect the exact update sent to the database to prove it can only
// ever insert.
//
// MongoDB is replaced by the shared in-memory stand-in, which enforces the
// unique indexes on id and value.
//
// Requires --experimental-test-module-mocks (set in the npm test script).

import test, { beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createFakeContactInterestModel } from './helpers/fakeContactInterestModel.js'
import { DEFAULT_CONTACT_INTERESTS } from '../config/contactInterests.js'

const interests = createFakeContactInterestModel()
mock.module('../models/ContactInterest.js', { defaultExport: interests })

const { ensureDefaultContactInterests } = await import('../services/contactInterests.js')

const here = dirname(fileURLToPath(import.meta.url))

const warnings = []
const logger = { warn: (message) => warnings.push(message) }

const run = () => ensureDefaultContactInterests({ logger })

/** The stored records as plain data, without timestamps or Mongo bookkeeping. */
const records = () =>
  [...interests.docs.values()]
    .map(({ id, value, labels, order, enabled }) => ({ id, value, labels, order, enabled }))
    .sort((a, b) => a.order - b.order)

beforeEach(() => {
  interests.docs.clear()
  interests.calls.length = 0
  interests.failures.updateOne = null
  warnings.length = 0
})

/* ══════════════ Inserting ══════════════ */

test('an empty collection receives exactly the nine defaults', async () => {
  const result = await run()

  assert.deepEqual(result, { inserted: 9, total: 9 })
  assert.deepEqual(
    records(),
    DEFAULT_CONTACT_INTERESTS.map(({ id, value, labels, order, enabled }) => ({
      id, value, labels: { ...labels }, order, enabled,
    }))
  )
})

test('indexes are built before anything is written', async () => {
  await run()
  assert.equal(interests.calls[0].method, 'init', 'the unique indexes must exist before the first insert')
})

test('each insert records its own createdAt and updatedAt', async () => {
  await run()
  for (const doc of interests.docs.values()) {
    assert.ok(doc.createdAt instanceof Date)
    assert.ok(doc.updatedAt instanceof Date)
  }
})

/* ══════════════ Idempotent ══════════════ */

test('running it again inserts nothing and changes nothing', async () => {
  await run()
  const before = structuredClone([...interests.docs.values()])

  const second = await run()
  const third = await run()

  assert.deepEqual(second, { inserted: 0, total: 9 })
  assert.deepEqual(third, { inserted: 0, total: 9 })
  assert.deepEqual(structuredClone([...interests.docs.values()]), before, 'a rerun modified a record, timestamps included')
  assert.equal(interests.docs.size, 9)
})

/* ══════════════ Never overwrites admin work ══════════════ */

test('a restart keeps an admin’s edited label, order and enabled state', async () => {
  await run()

  // What an admin might have done through the manager.
  Object.assign(interests.docs.get('buying'), {
    labels: { en: 'Buy a Home', tr: 'Ev Satın Alma' },
    order: 42,
  })
  interests.docs.get('construction').enabled = false
  interests.docs.get('general').labels = { en: 'Something Else' }

  const result = await run()

  assert.equal(result.inserted, 0)
  assert.deepEqual(interests.docs.get('buying').labels, { en: 'Buy a Home', tr: 'Ev Satın Alma' })
  assert.equal(interests.docs.get('buying').order, 42)
  assert.equal(interests.docs.get('construction').enabled, false, 'a disabled default was re-enabled')
  assert.deepEqual(interests.docs.get('general').labels, { en: 'Something Else' },
    'a removed translation was restored')
})

test('an admin-created interest is left alone and never duplicated', async () => {
  await run()
  interests.seed([
    ...[...interests.docs.values()].map((doc) => structuredClone(doc)),
    { id: 'investment_consultation', value: 'Investment Consultation', labels: { en: 'Investment Consultation' }, order: 10, enabled: true },
  ])

  await run()

  assert.equal(interests.docs.size, 10)
  assert.deepEqual(interests.docs.get('investment_consultation').labels, { en: 'Investment Consultation' })
})

test('a partially seeded collection only receives the missing defaults', async () => {
  interests.seed([
    { id: 'buying', value: 'Buying', labels: { en: 'Purchase' }, order: 3, enabled: false },
    { id: 'troubleshoot', value: 'Troubleshoot', labels: { en: 'Support' }, order: 1, enabled: true },
  ])

  const result = await run()

  assert.deepEqual(result, { inserted: 7, total: 9 })
  assert.equal(interests.docs.size, 9)
  assert.deepEqual(interests.docs.get('buying').labels, { en: 'Purchase' })
  assert.equal(interests.docs.get('buying').enabled, false)
  assert.deepEqual(interests.docs.get('troubleshoot').labels, { en: 'Support' })
})

test('the only write is an upsert by id using $setOnInsert — never $set', async () => {
  await run()

  const updates = interests.calls.filter((call) => call.method === 'updateOne')
  assert.equal(updates.length, 9)

  for (const call of updates) {
    assert.deepEqual(Object.keys(call.filter), ['id'], 'defaults must be matched by stable id')
    assert.deepEqual(Object.keys(call.update), ['$setOnInsert'], 'bootstrap must not be able to modify an existing record')
    assert.equal(call.options.upsert, true)
    assert.equal(call.options.timestamps, false, 'a rerun must not even bump updatedAt')
  }

  for (const method of ['create', 'findOneAndUpdate']) {
    assert.equal(interests.calls.some((call) => call.method === method), false, `bootstrap called ${method}`)
  }
})

/* ══════════════ Concurrency and failure ══════════════ */

test('losing a race to another instance is logged and skipped, not fatal', async () => {
  interests.failures.updateOne = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })

  const result = await run()

  assert.deepEqual(result, { inserted: 8, total: 9 })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /buying/)
})

test('any other database error propagates to the caller', async () => {
  interests.failures.updateOne = new Error('connection lost')
  await assert.rejects(run(), /connection lost/)
})

/* ══════════════ Where it runs ══════════════ */

test('server.js runs bootstrap after connecting and before listening', async () => {
  const server = await readFile(join(here, '..', 'server.js'), 'utf8')

  const connect = server.indexOf('connectDB().then(async () => {')
  const bootstrap = server.indexOf('await ensureDefaultContactInterests()')
  const listen = server.indexOf('server.listen(PORT')

  assert.ok(connect >= 0, 'connectDB().then(async …) not found')
  assert.ok(bootstrap > connect, 'bootstrap must run after MongoDB connects')
  assert.ok(listen > bootstrap, 'the server must not accept requests before bootstrap finishes')
})

test('server.js mounts the interest API ahead of the contact router', async () => {
  const server = await readFile(join(here, '..', 'server.js'), 'utf8')

  const interestsMount = server.indexOf("app.use('/api/contact/interests', contactInterestRoutes)")
  const contactMount = server.indexOf("app.use('/api/contact', contactRoutes)")

  assert.ok(interestsMount >= 0 && contactMount >= 0)
  assert.ok(interestsMount < contactMount)
})
