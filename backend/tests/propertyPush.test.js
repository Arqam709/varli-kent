// Generic "New property added" notifications.
//
// The REAL propertyPush service runs here; only the Phase-8A sender and the two
// models it queries are faked, so nothing can leave the process. What is under
// test is recipient selection and notification content — the two things this
// service exists to decide.

import test, { before, mock } from 'node:test'
import assert from 'node:assert/strict'

const CUSTOMER_A = 'customer-a'
const CUSTOMER_B = 'customer-b'
const ADMIN = 'admin-id'
const AGENT = 'agent-id'
const PROPERTY = 'property-id'

// ── Faked device registry ────────────────────────────────────────────────
let devices = []

const FakePushDevice = {
  // Mirrors the real `distinct`: unique values, filtered.
  distinct: async (field, query) => {
    const matching = devices.filter((d) => (query?.active === undefined ? true : d.active === query.active))
    return [...new Set(matching.map((d) => d[field]))]
  },
}

// ── Faked user roles ─────────────────────────────────────────────────────
let roles = {}

const FakeUser = {
  find: (query) => {
    const ids = query._id.$in.map(String)
    const wanted = query.role.$in
    const hits = ids
      .filter((id) => wanted.includes(roles[id]))
      .map((id) => ({ _id: id }))
    return { select: async () => hits }
  },
}

// ── Faked Phase-8A sender ────────────────────────────────────────────────
let sends = []
let nextResult = { attempted: 0, accepted: 0, failed: 0 }
let nextThrow = null

mock.module('../models/PushDevice.js', { defaultExport: FakePushDevice })
mock.module('../models/User.js', { defaultExport: FakeUser })
mock.module('../services/pushNotifications.js', {
  namedExports: {
    sendPushToUsers: async (args) => {
      sends.push(args)
      if (nextThrow) throw nextThrow
      return { ...nextResult, attempted: args.userIds.length }
    },
  },
})

let sendNewPropertyPush
let findGenericPushRecipients
let describeNewProperty

before(async () => {
  const mod = await import('../services/propertyPush.js')
  sendNewPropertyPush = mod.sendNewPropertyPush
  findGenericPushRecipients = mod.findGenericPushRecipients
  describeNewProperty = mod.describeNewProperty
})

const property = (overrides = {}) => ({
  _id: PROPERTY,
  title: 'Modern Apartment',
  district: 'Kadıköy',
  beds: 3,
  propertyType: 'Apartment',
  price: 4_200_000,
  ...overrides,
})

test.beforeEach(() => {
  devices = [
    { user: CUSTOMER_A, active: true },
    { user: CUSTOMER_B, active: true },
  ]
  roles = { [CUSTOMER_A]: 'user', [CUSTOMER_B]: 'user', [ADMIN]: 'admin', [AGENT]: 'agent' }
  sends = []
  nextResult = { attempted: 0, accepted: 2, failed: 0 }
  nextThrow = null
})

/* ═══════════════ Recipients ═══════════════ */

test('1. users with an ACTIVE device are selected', async () => {
  await sendNewPropertyPush({ property: property() })

  assert.equal(sends.length, 1)
  assert.deepEqual(sends[0].userIds.sort(), [CUSTOMER_A, CUSTOMER_B])
})

test('2. an INACTIVE device is excluded', async () => {
  devices = [
    { user: CUSTOMER_A, active: true },
    { user: CUSTOMER_B, active: false },
  ]

  await sendNewPropertyPush({ property: property() })

  assert.deepEqual(sends[0].userIds, [CUSTOMER_A])
})

test('3. one user with SEVERAL devices is passed exactly once', async () => {
  // Device fan-out belongs to sendPushToUsers. Deduplicating at the USER level
  // here is what stops one person being notified twice on the same phone.
  devices = [
    { user: CUSTOMER_A, active: true },
    { user: CUSTOMER_A, active: true },
    { user: CUSTOMER_A, active: true },
  ]

  await sendNewPropertyPush({ property: property() })

  assert.deepEqual(sends[0].userIds, [CUSTOMER_A])
})

test('4. excludeUserIds removes a user — the 8C.2 seam', async () => {
  await sendNewPropertyPush({ property: property(), excludeUserIds: [CUSTOMER_A] })

  assert.deepEqual(sends[0].userIds, [CUSTOMER_B])
})

test('5. an excluded saved-alert user gets NO generic notification', async () => {
  // 8C.2 will notify matching users with "New match for your saved alert" and
  // pass them here, so nobody hears about the same listing twice.
  await sendNewPropertyPush({
    property: property(),
    excludeUserIds: [CUSTOMER_A, CUSTOMER_B],
  })

  assert.equal(sends.length, 0, 'with nobody left, no request is made at all')
})

test('5b. staff accounts are excluded — these are customer notifications', async () => {
  devices = [
    { user: CUSTOMER_A, active: true },
    { user: ADMIN, active: true },
    { user: AGENT, active: true },
  ]

  await sendNewPropertyPush({ property: property() })

  assert.deepEqual(sends[0].userIds, [CUSTOMER_A])
})

test('5c. findGenericPushRecipients is usable on its own', async () => {
  const ids = await findGenericPushRecipients({ excludeUserIds: [CUSTOMER_B] })
  assert.deepEqual(ids, [CUSTOMER_A])
})

/* ═══════════════ Content ═══════════════ */

test('6. the payload carries type=new_property and the id, and nothing else', async () => {
  await sendNewPropertyPush({ property: property() })

  assert.deepEqual(sends[0].data, { type: 'new_property', propertyId: PROPERTY })

  const serialised = JSON.stringify(sends[0].data)
  assert.equal(serialised.includes('Kadıköy'), false, 'no district in the payload')
  assert.equal(serialised.includes('4200000'), false, 'no price in the payload')
  assert.equal(serialised.includes('Modern'), false, 'no title in the payload')
})

test('6b. a non-string id is stringified', async () => {
  await sendNewPropertyPush({ property: property({ _id: { toString: () => PROPERTY } }) })

  assert.equal(typeof sends[0].data.propertyId, 'string')
  assert.equal(sends[0].data.propertyId, PROPERTY)
})

test('7. the title is generic and distinct from the future saved-alert one', async () => {
  await sendNewPropertyPush({ property: property() })

  assert.equal(sends[0].title, 'New property added')
  assert.equal(sends[0].title.toLowerCase().includes('alert'), false)
  assert.equal(sends[0].title.toLowerCase().includes('match'), false)
})

test('7b. the body reads as a listing line', async () => {
  await sendNewPropertyPush({ property: property() })
  assert.equal(sends[0].body, 'Modern Apartment in Kadıköy')
})

test('7c. the district is not repeated when the title already says it', async () => {
  assert.equal(
    describeNewProperty({ title: 'Modern Apartment in Kadıköy', district: 'Kadıköy' }),
    'Modern Apartment in Kadıköy'
  )
})

test('8. the body is bounded', async () => {
  await sendNewPropertyPush({
    property: property({ title: 'A'.repeat(500), district: 'Kadıköy' }),
  })

  assert.ok(sends[0].body.length <= 120, `body was ${sends[0].body.length}`)
  assert.ok(sends[0].body.endsWith('…'), 'truncation is visible')
})

test('8b. whitespace is collapsed', () => {
  assert.equal(
    describeNewProperty({ title: '  Modern\n\nApartment  ', district: 'Kadıköy' }),
    'Modern Apartment in Kadıköy'
  )
})

test('8c. a missing title or district still yields something sane', () => {
  assert.equal(describeNewProperty({ title: '', district: 'Kadıköy' }), 'Kadıköy')
  assert.equal(describeNewProperty({ title: 'Villa', district: '' }), 'Villa')
  assert.equal(describeNewProperty({}), '')
})

test('9. the Property document is never mutated', async () => {
  const doc = property({ title: '  Spaced   Title  ' })
  const before = JSON.stringify(doc)

  await sendNewPropertyPush({ property: doc })

  assert.equal(JSON.stringify(doc), before)
})

/* ═══════════════ Failure containment ═══════════════ */

test('10. a provider failure is contained, not thrown', async () => {
  nextThrow = new Error('exp.host unreachable')

  await assert.doesNotReject(() => sendNewPropertyPush({ property: property() }))

  const result = await sendNewPropertyPush({ property: property() })
  assert.deepEqual(result, { attempted: 0, accepted: 0, failed: 0 })
})

test('11. zero eligible users performs NO send at all', async () => {
  devices = []

  const result = await sendNewPropertyPush({ property: property() })

  assert.equal(sends.length, 0, 'no pointless HTTPS round trip')
  assert.deepEqual(result, { attempted: 0, accepted: 0, failed: 0 })
})

test('11b. a property with no id notifies nobody', async () => {
  const result = await sendNewPropertyPush({ property: { title: 'Orphan' } })

  assert.equal(sends.length, 0)
  assert.deepEqual(result, { attempted: 0, accepted: 0, failed: 0 })
})

test('12. each recipient id appears exactly once in the call', async () => {
  devices = [
    { user: CUSTOMER_A, active: true },
    { user: CUSTOMER_B, active: true },
    { user: CUSTOMER_A, active: true },
    { user: CUSTOMER_B, active: true },
  ]

  await sendNewPropertyPush({ property: property() })

  const ids = sends[0].userIds
  assert.equal(ids.length, new Set(ids).size, 'no duplicates reach the sender')
})
