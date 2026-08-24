import test, { before, mock } from 'node:test'
import assert from 'node:assert/strict'

const USER_A = 'user-a'
const USER_B = 'user-b'
const USER_C = 'user-c'
const ADMIN = 'admin'
const PROPERTY_ID = 'property-id'

let alerts = []
let alertQueryError = null
let users = {}

const FakePropertyAlert = {
  find: (query) => ({
    select: () => ({
      lean: async () => {
        if (alertQueryError) throw alertQueryError
        return alerts.filter((alert) => alert.active === query.active)
      },
    }),
  }),
}

const FakeUser = {
  find: (query) => {
    const wanted = new Set(query._id.$in.map(String))
    const hits = [...wanted]
      .filter((id) => users[id]?.role === query.role && users[id]?.isActive === query.isActive)
      .map((id) => ({ _id: id }))
    return {
      select: () => ({
        lean: async () => hits,
      }),
    }
  },
}

let personalCalls = []
let genericCalls = []
let personalError = null
let genericError = null

mock.module('../models/PropertyAlert.js', { defaultExport: FakePropertyAlert })
mock.module('../models/User.js', { defaultExport: FakeUser })
mock.module('../services/pushNotifications.js', {
  namedExports: {
    sendPushToUsers: async (args) => {
      personalCalls.push(args)
      if (personalError) throw personalError
      return { attempted: args.userIds.length, accepted: args.userIds.length, failed: 0 }
    },
  },
})
mock.module('../services/propertyPush.js', {
  namedExports: {
    describeNewProperty: (property) =>
      `${String(property.title).replace(/\s+/g, ' ').trim()} in ${property.district}`,
    sendNewPropertyPush: async (args) => {
      genericCalls.push(args)
      if (genericError) throw genericError
      return { attempted: 1, accepted: 1, failed: 0 }
    },
  },
})

let findMatchingCustomerUserIds
let sendPropertyMatchPush
let notifyNewPropertyCreated

before(async () => {
  const mod = await import('../services/propertyCreatedPush.js')
  ;({
    findMatchingCustomerUserIds,
    sendPropertyMatchPush,
    notifyNewPropertyCreated,
  } = mod)
})

const property = (overrides = {}) => ({
  _id: PROPERTY_ID,
  title: 'Modern   Apartment',
  district: 'Kadıköy',
  listingType: 'Sale',
  propertyType: 'Apartment',
  price: 4_200_000,
  beds: 3,
  ...overrides,
})

const alert = (user, overrides = {}) => ({
  _id: `alert-${user}`,
  user,
  active: true,
  listingType: 'Sale',
  district: 'Kadıköy',
  propertyType: 'Apartment',
  minPrice: 3_000_000,
  maxPrice: 5_000_000,
  minBeds: 2,
  ...overrides,
})

test.beforeEach(() => {
  alerts = []
  alertQueryError = null
  users = {
    [USER_A]: { role: 'user', isActive: true },
    [USER_B]: { role: 'user', isActive: true },
    [USER_C]: { role: 'user', isActive: true },
    [ADMIN]: { role: 'admin', isActive: true },
  }
  personalCalls = []
  genericCalls = []
  personalError = null
  genericError = null
})

test('no matching alerts makes no personal request', async () => {
  alerts = [alert(USER_A, { district: 'Beşiktaş' })]

  const result = await findMatchingCustomerUserIds(property())
  await sendPropertyMatchPush({ property: property(), userIds: result })

  assert.deepEqual(result, [])
  assert.equal(personalCalls.length, 0)
})

test('one active matching alert resolves one active customer', async () => {
  alerts = [alert(USER_A)]

  assert.deepEqual(await findMatchingCustomerUserIds(property()), [USER_A])
})

test('inactive matching and active nonmatching alerts are ignored', async () => {
  alerts = [
    alert(USER_A, { active: false }),
    alert(USER_B, { listingType: 'Rent' }),
  ]

  assert.deepEqual(await findMatchingCustomerUserIds(property()), [])
})

test('existing matcher criteria remain ANDed, bounded, and exact', async () => {
  const mismatches = [
    { listingType: 'Rent' },
    { district: 'kadıköy' },
    { propertyType: 'Villa' },
    { price: 2_999_999 },
    { price: 5_000_001 },
    { beds: 1 },
  ]

  for (const overrides of mismatches) {
    alerts = [alert(USER_A)]
    assert.deepEqual(
      await findMatchingCustomerUserIds(property(overrides)),
      [],
      JSON.stringify(overrides)
    )
  }
})

test('multiple matching alerts for one user deduplicate to one logical recipient', async () => {
  alerts = [
    alert(USER_A),
    alert(USER_A, { _id: 'alert-a-2', minPrice: null }),
    alert(USER_A, { _id: 'alert-a-3', district: 'Beşiktaş' }),
  ]

  const result = await findMatchingCustomerUserIds(property())
  await sendPropertyMatchPush({ property: property(), userIds: result })

  assert.deepEqual(result, [USER_A])
  assert.deepEqual(personalCalls[0].userIds, [USER_A])
})

test('multiple matching users each appear once', async () => {
  alerts = [alert(USER_A), alert(USER_B), alert(USER_A, { _id: 'again' })]

  const result = await findMatchingCustomerUserIds(property())

  assert.deepEqual(result.sort(), [USER_A, USER_B])
})

test('staff and inactive customer alert owners are not eligible', async () => {
  users[USER_B].isActive = false
  alerts = [alert(USER_A), alert(USER_B), alert(ADMIN)]

  assert.deepEqual(await findMatchingCustomerUserIds(property()), [USER_A])
})

test('property_match uses the agreed title, bounded shared body, and routing-only data', async () => {
  await sendPropertyMatchPush({ property: property(), userIds: [USER_A, USER_A] })

  assert.equal(personalCalls.length, 1)
  assert.deepEqual(personalCalls[0], {
    userIds: [USER_A],
    title: 'New match for your saved alert',
    body: 'Modern Apartment in Kadıköy',
    data: { type: 'property_match', propertyId: PROPERTY_ID },
  })
  assert.deepEqual(Object.keys(personalCalls[0].data).sort(), ['propertyId', 'type'])
})

test('matching does not mutate the property or alert snapshots', async () => {
  const doc = property()
  const savedAlert = alert(USER_A)
  alerts = [savedAlert]
  const beforeProperty = JSON.stringify(doc)
  const beforeAlert = JSON.stringify(savedAlert)

  await findMatchingCustomerUserIds(doc)
  await sendPropertyMatchPush({ property: doc, userIds: [USER_A] })

  assert.equal(JSON.stringify(doc), beforeProperty)
  assert.equal(JSON.stringify(savedAlert), beforeAlert)
})

test('A: no match still sends generic with the base exclusions', async () => {
  alerts = []

  const result = await notifyNewPropertyCreated({
    property: property(),
    excludeUserIds: [ADMIN],
  })

  assert.deepEqual(result.matchingUserIds, [])
  assert.equal(personalCalls.length, 0)
  assert.deepEqual(genericCalls[0].excludeUserIds, [ADMIN])
})

test('B/C: matching user receives one personal push and is excluded once from generic', async () => {
  alerts = [alert(USER_A), alert(USER_A, { _id: 'second' }), alert(USER_A, { _id: 'third' })]

  await notifyNewPropertyCreated({ property: property(), excludeUserIds: [ADMIN] })

  assert.equal(personalCalls.length, 1)
  assert.deepEqual(personalCalls[0].userIds, [USER_A])
  assert.deepEqual(genericCalls[0].excludeUserIds, [ADMIN, USER_A])
})

test('D: several matching users are personal recipients and generic exclusions once each', async () => {
  alerts = [alert(USER_A), alert(USER_B), alert(USER_A, { _id: 'duplicate' })]

  await notifyNewPropertyCreated({ property: property() })

  assert.deepEqual(personalCalls[0].userIds.sort(), [USER_A, USER_B])
  assert.deepEqual(genericCalls[0].excludeUserIds.sort(), [USER_A, USER_B])
})

test('E: alert lookup failure skips personal but still attempts generic', async () => {
  alertQueryError = new Error('temporary alert query failure')

  await assert.doesNotReject(() => notifyNewPropertyCreated({ property: property() }))

  assert.equal(personalCalls.length, 0)
  assert.deepEqual(genericCalls[0].excludeUserIds, [])
})

test('F: personal provider failure does not escape or remove matched generic exclusions', async () => {
  alerts = [alert(USER_A)]
  personalError = new Error('personal sender unavailable')

  await assert.doesNotReject(() => notifyNewPropertyCreated({ property: property() }))

  assert.deepEqual(genericCalls[0].excludeUserIds, [USER_A])
})

test('G: generic provider failure does not escape or undo personal behavior', async () => {
  alerts = [alert(USER_A)]
  genericError = new Error('generic sender unavailable')

  await assert.doesNotReject(() => notifyNewPropertyCreated({ property: property() }))

  assert.equal(personalCalls.length, 1)
  assert.deepEqual(personalCalls[0].userIds, [USER_A])
})
