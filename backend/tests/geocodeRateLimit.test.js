// Wave 15B2 correction — the Nominatim politeness limiter, under concurrency.
//
// Nominatim's usage policy is a limit on the REQUEST RATE from one client, so
// what has to be spaced is the moment each request STARTS. The original
// implementation read a shared timestamp and only wrote it after its own
// request finished, with nothing serialising the read — so two concurrent
// cache misses both saw "no wait needed" and went out together.
//
// Every test here measures real fetch start times through an injected
// fetchImpl. The interval is shrunk through the existing test-only hook, so
// the suite stays fast while still asserting real elapsed time.

import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  geocodeIstanbulPlace,
  NOMINATIM_MIN_INTERVAL_MS,
  __clearGeocodeCacheForTests,
  __setNominatimMinIntervalForTests,
} from '../services/geocodePlace.js'

// Long enough to measure without flaking on timer granularity, short enough
// that the whole file runs in well under a second.
const TEST_INTERVAL_MS = 40

// Timers are not exact; allow a small tolerance below the nominal interval so
// a 39.7ms gap does not fail a 40ms assertion.
const TOLERANCE_MS = 5

beforeEach(() => {
  __clearGeocodeCacheForTests()
  __setNominatimMinIntervalForTests(TEST_INTERVAL_MS)
})

afterEach(() => __setNominatimMinIntervalForTests(1100))

const TAKSIM = [{
  lat: '41.0370',
  lon: '28.9850',
  display_name: 'Taksim Meydanı, Beyoğlu, İstanbul, Türkiye',
}]

/*
 * Records when each request STARTS, which is the quantity the policy governs.
 * `delayMs` lets a request take a while to finish, so the tests can show that
 * a slow response does not have to delay the next start beyond the interval.
 */
const timingFetch = ({ delayMs = 0, failFirst = false, body = TAKSIM } = {}) => {
  const starts = []

  const fn = async () => {
    const index = starts.length
    starts.push(Date.now())

    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (failFirst && index === 0) throw new Error('network unreachable')

    return { ok: true, status: 200, json: async () => body }
  }

  fn.starts = starts
  fn.gaps = () => starts.slice(1).map((time, i) => time - starts[i])
  return fn
}

/* ═══════════ 1. Concurrency — the bug this file exists for ═══════════ */

test('1a. two concurrent uncached lookups do not go out together', async () => {
  const fetchImpl = timingFetch()

  // Different keys, so neither can be served from cache.
  await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('Galata Tower', { fetchImpl }),
  ])

  assert.equal(fetchImpl.starts.length, 2, 'both lookups should have reached the network')

  const [gap] = fetchImpl.gaps()
  assert.ok(
    gap >= TEST_INTERVAL_MS - TOLERANCE_MS,
    `two concurrent requests started ${gap}ms apart, under the ${TEST_INTERVAL_MS}ms minimum`
  )
})

test('1b. three concurrent lookups are serialised into valid slots', async () => {
  const fetchImpl = timingFetch()

  await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('Galata Tower', { fetchImpl }),
    geocodeIstanbulPlace('Sultanahmet', { fetchImpl }),
  ])

  assert.equal(fetchImpl.starts.length, 3)

  for (const [index, gap] of fetchImpl.gaps().entries()) {
    assert.ok(
      gap >= TEST_INTERVAL_MS - TOLERANCE_MS,
      `requests ${index + 1} and ${index + 2} started ${gap}ms apart, under the minimum`
    )
  }
})

test('1c. a mix of concurrent and sequential calls keeps every gap valid', async () => {
  const fetchImpl = timingFetch()

  await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('Galata Tower', { fetchImpl }),
  ])
  await geocodeIstanbulPlace('Sultanahmet', { fetchImpl })
  await geocodeIstanbulPlace('Beşiktaş', { fetchImpl })

  assert.equal(fetchImpl.starts.length, 4)
  for (const gap of fetchImpl.gaps()) {
    assert.ok(gap >= TEST_INTERVAL_MS - TOLERANCE_MS, `a gap of ${gap}ms is under the minimum`)
  }
})

/* ═══════════ 2. Spacing is start-to-start, not finish-to-start ═══════════ */

test('2. a slow response does not add its own duration to the next slot', async () => {
  // The policy is about request rate. Waiting for the interval AFTER a slow
  // response finishes would make a chatbot turn needlessly slow without
  // making us any politer.
  const fetchImpl = timingFetch({ delayMs: TEST_INTERVAL_MS * 3 })

  const started = Date.now()
  await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('Galata Tower', { fetchImpl }),
  ])
  const elapsed = Date.now() - started

  const [gap] = fetchImpl.gaps()
  assert.ok(gap >= TEST_INTERVAL_MS - TOLERANCE_MS, `gap ${gap}ms is under the minimum`)

  // Finish-to-start spacing would take at least delay + interval + delay.
  const finishToStartFloor = TEST_INTERVAL_MS * 3 * 2 + TEST_INTERVAL_MS
  assert.ok(
    elapsed < finishToStartFloor,
    `took ${elapsed}ms — the limiter appears to be spacing from finish, not from start`
  )
})

/* ═══════════ 3. A failure must not wedge the queue ═══════════ */

test('3a. a thrown request still lets the next one run', async () => {
  const fetchImpl = timingFetch({ failFirst: true })

  const [first, second] = await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('Galata Tower', { fetchImpl }),
  ])

  assert.equal(first.status, 'error')
  assert.equal(second.status, 'resolved', 'the second request never ran after the first failed')
  assert.equal(fetchImpl.starts.length, 2)
})

test('3b. the queue still works on the turn after a failure', async () => {
  const failing = timingFetch({ failFirst: true })
  await geocodeIstanbulPlace('Taksim Square', { fetchImpl: failing })

  const working = timingFetch()
  const result = await geocodeIstanbulPlace('Galata Tower', { fetchImpl: working })

  assert.equal(result.status, 'resolved', 'a past failure permanently wedged the limiter')
  assert.equal(working.starts.length, 1)
})

test('3c. an HTTP error does not wedge the queue either', async () => {
  const starts = []
  const fetchImpl = async () => {
    const index = starts.length
    starts.push(Date.now())
    if (index === 0) return { ok: false, status: 503, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => TAKSIM }
  }

  const [first, second] = await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('Galata Tower', { fetchImpl }),
  ])

  assert.equal(first.status, 'error')
  assert.equal(second.status, 'resolved')
  assert.ok(starts[1] - starts[0] >= TEST_INTERVAL_MS - TOLERANCE_MS)
})

/* ═══════════ 4. Cache hits need no slot ═══════════ */

test('4a. a cached place takes no network slot and no wait', async () => {
  const fetchImpl = timingFetch()

  await geocodeIstanbulPlace('Taksim Square', { fetchImpl })
  assert.equal(fetchImpl.starts.length, 1)

  // Three repeats of a cached name: no network, and no interval wait either.
  const started = Date.now()
  await Promise.all([
    geocodeIstanbulPlace('Taksim Square', { fetchImpl }),
    geocodeIstanbulPlace('taksim square', { fetchImpl }),
    geocodeIstanbulPlace('  Taksim   Square ', { fetchImpl }),
  ])
  const elapsed = Date.now() - started

  assert.equal(fetchImpl.starts.length, 1, 'a cached place made a network request')
  assert.ok(elapsed < TEST_INTERVAL_MS, `cached lookups waited ${elapsed}ms for a slot they do not need`)
})

test('4b. input rejected before the network takes no slot', async () => {
  const fetchImpl = timingFetch()

  const started = Date.now()
  await Promise.all([
    geocodeIstanbulPlace('', { fetchImpl }),
    geocodeIstanbulPlace('x', { fetchImpl }),
    geocodeIstanbulPlace('a'.repeat(500), { fetchImpl }),
  ])

  assert.equal(fetchImpl.starts.length, 0)
  assert.ok(Date.now() - started < TEST_INTERVAL_MS, 'rejected input queued for a network slot')
})

/* ═══════════ 5. The production default ═══════════ */

test('5. the shipped interval honours the one-request-per-second policy', () => {
  // The hook above shrinks this for the tests; afterEach restores it. What
  // ships must still be at least a second.
  __setNominatimMinIntervalForTests(1100)
  assert.ok(
    NOMINATIM_MIN_INTERVAL_MS >= 1000,
    `the production interval is ${NOMINATIM_MIN_INTERVAL_MS}ms, under Nominatim's 1/second policy`
  )
})
