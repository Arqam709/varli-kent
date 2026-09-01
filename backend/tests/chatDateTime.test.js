// Wave 15A, Part A — deterministic Istanbul date/time.
//
// The property under test is that the answer comes from a real timezone
// conversion of a real instant, never from a model and never from the
// server's own wall clock. Every assertion uses an injected reference date,
// so nothing here races the actual current minute.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatIstanbulDateTime,
  formatIstanbulDateTimeForPrompt,
  formatUtcOffsetLabel,
  getIstanbulOffsetMinutes,
  getIstanbulParts,
  getIstanbulNow,
  istanbulMonthName,
  istanbulWeekdayName,
} from '../utils/istanbulTime.js'

import { isLiteralDateTimeQuestion, buildDateTimeAnswer } from '../services/chatDateTimeQuestion.js'

// 31 Aug 2026 19:30 UTC = 22:30 Istanbul, a Monday.
const REFERENCE = new Date('2026-08-31T19:30:00Z')

/* ═══════════ 1. Timezone correctness ═══════════ */

test('1a. converts a UTC instant to the Istanbul wall clock', () => {
  const parts = getIstanbulParts(REFERENCE)

  assert.deepEqual(parts, { year: 2026, month: 8, day: 31, hour: 22, minute: 30, second: 0 })
})

test('1b. the offset is measured from the tz database, not asserted', () => {
  assert.equal(getIstanbulOffsetMinutes(REFERENCE), 180)
  assert.equal(formatUtcOffsetLabel(REFERENCE), 'UTC+3')

  // Measured the same way in January — if Turkey ever reinstates DST, this
  // reports the real offset instead of a hard-coded claim.
  const winter = new Date('2026-01-15T12:00:00Z')
  const winterOffset = getIstanbulOffsetMinutes(winter)
  assert.equal(formatUtcOffsetLabel(winter), `UTC+${winterOffset / 60}`)
})

test('1c. the server timezone cannot influence the result', () => {
  // The whole failure this feature exists to prevent: Render does not run in
  // Istanbul, so a naive getHours() would answer with the wrong clock. The
  // reference instant is 19:30 UTC; if this were reading the host's local
  // hours the answer would only be 22 by coincidence.
  const naiveLocalHour = REFERENCE.getHours()
  const istanbulHour = getIstanbulParts(REFERENCE).hour

  assert.equal(istanbulHour, 22)
  if (naiveLocalHour !== 22) {
    assert.notEqual(istanbulHour, naiveLocalHour, 'the Istanbul hour tracked the server clock')
  }
})

test('1d. rolls the date over correctly at Istanbul midnight', () => {
  // 21:00 UTC on 31 August is already 00:00 on 1 September in Istanbul.
  const parts = getIstanbulParts(new Date('2026-08-31T21:00:00Z'))

  assert.deepEqual(parts, { year: 2026, month: 9, day: 1, hour: 0, minute: 0, second: 0 })
  assert.match(formatIstanbulDateTime(new Date('2026-08-31T21:00:00Z'), 'en'), /Tuesday, 1 September 2026, 00:00/)
})

test('1e. getIstanbulNow returns the current instant, not a fixed value', () => {
  const now = getIstanbulNow()

  assert.ok(now instanceof Date)
  assert.ok(Math.abs(Date.now() - now.getTime()) < 5000)
})

/* ═══════════ 2. Localized rendering ═══════════ */

test('2a. names come from Intl per language, digits stay Latin', () => {
  assert.equal(istanbulWeekdayName(REFERENCE, 'en'), 'Monday')
  assert.equal(istanbulWeekdayName(REFERENCE, 'tr'), 'Pazartesi')
  assert.equal(istanbulMonthName(REFERENCE, 'tr'), 'Ağustos')

  const arabic = formatIstanbulDateTime(REFERENCE, 'ar')
  assert.match(arabic, /أغسطس/, 'the Arabic month name is missing')
  assert.match(arabic, /31/, 'Arabic rendering switched to non-Latin digits mid-sentence')
})

test('2b. each supported language gets its own sentence', () => {
  assert.equal(formatIstanbulDateTime(REFERENCE, 'en'), 'Monday, 31 August 2026, 22:30 (Istanbul time, UTC+3)')
  assert.equal(formatIstanbulDateTime(REFERENCE, 'tr'), 'Pazartesi, 31 Ağustos 2026, saat 22:30 (Türkiye saati, UTC+3)')
  assert.match(formatIstanbulDateTime(REFERENCE, 'ar'), /^الاثنين، 31 أغسطس 2026، الساعة 22:30 \(بتوقيت إسطنبول، UTC\+3\)$/)
})

test('2c. an unsupported language falls back to English rather than failing', () => {
  // normalizeChatLanguage already collapses these upstream; this is defence
  // in depth, and must not throw.
  assert.equal(formatIstanbulDateTime(REFERENCE, 'de'), formatIstanbulDateTime(REFERENCE, 'en'))
  assert.equal(formatIstanbulDateTime(REFERENCE, undefined), formatIstanbulDateTime(REFERENCE, 'en'))
})

test('2d. the prompt anchor is machine-readable and language-independent', () => {
  const anchor = formatIstanbulDateTimeForPrompt(REFERENCE)

  assert.equal(anchor, '2026-08-31 22:30 (Monday, Europe/Istanbul, UTC+3)')
  assert.match(anchor, /Europe\/Istanbul/, 'the anchor does not name the IANA zone')
})

/* ═══════════ 3. Intent detection ═══════════ */

test('3a. recognises literal clock and date questions in all three languages', () => {
  const questions = [
    'What time is it?',
    'what time is it in Istanbul?',
    "What's the time",
    'What is the time right now',
    'current time',
    'tell me the time',
    "What is today's date?",
    "what's todays date",
    'What is the date today',
    'What day is it?',
    'saat kaç',
    'İstanbul’da saat kaç?',
    'bugün günlerden ne',
    'bugün ayın kaçı',
    'bugünün tarihi ne',
    'كم الساعة الآن',
    'ما هو التاريخ اليوم',
    'ما تاريخ اليوم',
  ]

  for (const question of questions) {
    assert.ok(isLiteralDateTimeQuestion(question), `not recognised: "${question}"`)
  }
})

test('3b. does not fire for scheduling or unrelated uses of the same words', () => {
  const notClockQuestions = [
    // Real search / lead intent that must reach the normal pipeline.
    'call me tomorrow',
    'are you available this weekend',
    'what time frame are we looking at',
    'what is the time difference with London',
    'what time zone is Istanbul in',
    'is there time for a viewing',
    'what time management tools do you use',
    // Turkish: "saat kaçta" is one agglutinated word — a scheduling question,
    // and \b would not have caught this because ç is not an ASCII word char.
    'saat kaçta buluşalım',
    // Ordinary property searches.
    'find apartments in Kadıköy',
    'show me villas under 500000',
    '',
    '   ',
  ]

  for (const message of notClockQuestions) {
    assert.ok(!isLiteralDateTimeQuestion(message), `wrongly recognised: "${message}"`)
  }
})

test('3c. non-string input is handled rather than thrown on', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(isLiteralDateTimeQuestion(bad), false, `threw or matched on ${JSON.stringify(bad)}`)
  }
})

/* ═══════════ 4. The answer ═══════════ */

test('4a. the answer embeds the real converted instant, per language', () => {
  assert.equal(
    buildDateTimeAnswer('en', REFERENCE),
    "It's currently Monday, 31 August 2026, 22:30 (Istanbul time, UTC+3) in Istanbul."
  )
  assert.match(buildDateTimeAnswer('tr', REFERENCE), /^İstanbul'da şu anda Pazartesi, 31 Ağustos 2026, saat 22:30/)
  assert.match(buildDateTimeAnswer('ar', REFERENCE), /^الوقت الآن في إسطنبول الاثنين، 31 أغسطس 2026/)
})

test('4b. the answer is a fixed template, never model prose', () => {
  const answer = buildDateTimeAnswer('en', REFERENCE)

  // No unresolved placeholder survived the format() call.
  assert.ok(!answer.includes('{'), `an unreplaced placeholder is visible: ${answer}`)
  assert.ok(!answer.includes('}'), `an unreplaced placeholder is visible: ${answer}`)
})
