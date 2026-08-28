// HTML escaping and header safety for outgoing email.
//
// Sibling to email.resend.test.js, which owns the DELIVERY decisions (when to
// refuse, what reaches the wire, what is reported back). This file owns what
// goes INTO the message: that untrusted values interpolated into the two HTML
// templates cannot become markup, and that untrusted values interpolated into
// a subject cannot become a second header.
//
// Almost everything here calls a pure template builder directly, so most tests
// need no fetch, no API key, and no mock at all. The one test that has to go
// through sendContactNotification() (subjects are built there, not in a
// template) runs against a fake global fetch. Nothing in this file can reach
// Resend, SMTP, or a real inbox.

import test, { before, mock } from 'node:test'
import assert from 'node:assert/strict'

// utils/email.js imports LeadRouting, which pulls in Mongoose. Replacing it
// before the import keeps the subject test from issuing a real query against a
// connection that was never opened — the same reason email.resend.test.js does
// this, where the cost was a ten-second driver timeout per test.
let routingDoc = null

mock.module('../models/LeadRouting.js', {
  defaultExport: { findOne: async () => routingDoc },
})

let escapeHtml
let safeHeaderText
let leadEmailHtml
let passwordResetEmailHtml
let sendContactNotification

before(async () => {
  const mod = await import('../utils/email.js')
  escapeHtml = mod.escapeHtml
  safeHeaderText = mod.safeHeaderText
  leadEmailHtml = mod.leadEmailHtml
  passwordResetEmailHtml = mod.passwordResetEmailHtml
  sendContactNotification = mod.sendContactNotification
})

// Built from char codes rather than written as escape sequences, so the bytes
// under test are unambiguous in the source.
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const NUL = String.fromCharCode(0)
const TAB = String.fromCharCode(9)

// ── 1. escapeHtml: the five characters ───────────────────────────────────

test('1a. escapes a script tag so no raw tag survives', () => {
  const out = escapeHtml('<script>alert("x")</script>')

  assert.ok(!out.includes('<script'), 'raw opening script tag survived')
  assert.ok(!out.includes('</script'), 'raw closing script tag survived')
  assert.ok(!out.includes('<'), 'a raw < survived')
  assert.ok(!out.includes('>'), 'a raw > survived')
  assert.equal(out, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
})

test('1b. escapes the ampersand', () => {
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry')
})

test('1c. escapes both quote characters', () => {
  assert.equal(escapeHtml('He said "hi"'), 'He said &quot;hi&quot;')
  assert.equal(escapeHtml("O'Brien"), 'O&#39;Brien')
  assert.equal(escapeHtml(`mix " and '`), 'mix &quot; and &#39;')
})

test('1d. escapes an onerror image payload to inert text', () => {
  const out = escapeHtml('<img src=x onerror=alert(1)>')

  assert.ok(!out.includes('<img'), 'raw img tag survived')
  assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;')
})

test('1e. leaves ordinary values byte-for-byte alone', () => {
  for (const value of ['Ahsan', 'ahsan@example.com', '+90 555 123 4567', 'Beşiktaş', '3 kere']) {
    assert.equal(escapeHtml(value), value, `mangled a safe value: ${value}`)
  }
})

test('1f. escapes each character exactly once, never double-encoding', () => {
  // If & were replaced after < became &lt;, this would read &amp;lt;.
  assert.equal(escapeHtml('<a>'), '&lt;a&gt;')
  // A user who literally types an entity gets it back as text, not as markup.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})

test('1g. absent values become empty string rather than throwing', () => {
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(''), '')
  assert.equal(escapeHtml(0), '0')
})

// ── 2. escapeHtml is an encoding, not a filter ───────────────────────────

test('2. preserves the semantic content of ordinary punctuation', () => {
  const out = escapeHtml('I want a 3 < 4 comparison & more details.')

  // The source carries entities...
  assert.equal(out, 'I want a 3 &lt; 4 comparison &amp; more details.')
  // ...but nothing was dropped: decoding returns the original exactly.
  const decoded = out
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
  assert.equal(decoded, 'I want a 3 < 4 comparison & more details.')
})

// ── 3. The lead template, with a hostile submission ──────────────────────

const HOSTILE_SUBMISSION = {
  name: '<b>Injected Name</b>',
  email: 'test@example.com"><img src=x onerror=alert(1)>',
  phone: '<script>phone</script>',
  message: 'Hello <img src=x onerror=alert(1)> & goodbye',
  interestType: 'Buying',
  createdAt: new Date('2026-01-15T10:30:00Z'),
}

test('3a. no attacker-controlled tag survives into the lead HTML', () => {
  const html = leadEmailHtml(HOSTILE_SUBMISSION)

  // The trusted template contains no tag of these three shapes, so any
  // occurrence would have come from the submission. (<body> and <br/> do not
  // match '<b>' — the closing bracket is part of the needle.)
  assert.ok(!html.includes('<script'), 'a script tag reached the lead HTML')
  assert.ok(!html.includes('<img'), 'an img tag reached the lead HTML')
  assert.ok(!html.includes('<b>'), 'a bold tag reached the lead HTML')

  // The strongest form of the claim, and the one that does not depend on
  // guessing which tags an attacker might try: hostile input must add no tag
  // at all. Every '<' in the output belongs to the trusted template, so the
  // count matches a render of the same template with the fields left empty.
  //
  // Note that asserting on the substring 'onerror=' would be WRONG here — the
  // escaped text `&lt;img src=x onerror=alert(1)&gt;` contains it as inert
  // prose, which is exactly the outcome test 3b requires.
  const benign = leadEmailHtml({
    interestType: HOSTILE_SUBMISSION.interestType,
    createdAt: HOSTILE_SUBMISSION.createdAt,
  })
  const countAngles = (s) => (s.match(/</g) || []).length
  assert.equal(
    countAngles(html),
    countAngles(benign),
    'the hostile submission introduced at least one new tag'
  )
})

test('3b. the hostile values are present, as escaped text', () => {
  const html = leadEmailHtml(HOSTILE_SUBMISSION)

  assert.ok(html.includes('&lt;b&gt;Injected Name&lt;/b&gt;'), 'name not escaped')
  assert.ok(html.includes('&lt;script&gt;phone&lt;/script&gt;'), 'phone not escaped')
  assert.ok(
    html.includes('Hello &lt;img src=x onerror=alert(1)&gt; &amp; goodbye'),
    'message not escaped'
  )
})

test('3c. the quote in the email cannot break out of the href attribute', () => {
  const html = leadEmailHtml(HOSTILE_SUBMISSION)

  // The payload aims to close href="..." and start a new tag. The escaped
  // quote keeps the whole thing inside the attribute value.
  assert.ok(
    html.includes('href="mailto:test@example.com&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'),
    'the mailto href was not attribute-safe'
  )
  assert.ok(!html.includes('.com"><'), 'the href attribute was broken out of')
})

test('3d. the trusted template structure is still intact', () => {
  const html = leadEmailHtml(HOSTILE_SUBMISSION)

  for (const fragment of [
    '<!DOCTYPE html>',
    '<div class="wrap">',
    '<div class="badge">',
    '<div class="message-box">',
    '<a class="btn btn-primary"',
    'VARLI<span>KENT</span>',
    '</html>',
  ]) {
    assert.ok(html.includes(fragment), `trusted markup missing: ${fragment}`)
  }
})

test('3e. an ordinary submission still renders its values readably', () => {
  const html = leadEmailHtml({
    name: 'Ahsan',
    email: 'ahsan@example.com',
    phone: '+90 555 123 4567',
    message: 'I would like to view the Bebek apartment.',
    interestType: 'Buying',
    createdAt: new Date('2026-01-15T10:30:00Z'),
  })

  assert.ok(html.includes('<strong>Ahsan</strong>'))
  assert.ok(html.includes('href="mailto:ahsan@example.com"'))
  assert.ok(html.includes('href="tel:+90 555 123 4567"'))
  assert.ok(html.includes('I would like to view the Bebek apartment.'))
  assert.ok(html.includes('New Lead · Buying'))
  // Nothing was entity-encoded that did not need to be.
  assert.ok(!html.includes('&amp;'), 'a safe value was needlessly encoded')
})

test('3f. missing optional values do not throw or print "undefined"', () => {
  const html = leadEmailHtml({ interestType: 'General' })

  assert.ok(!html.includes('undefined'), 'an absent field rendered as "undefined"')
  assert.ok(html.includes('<div class="message-box"></div>'))
})

test('3g. a multi-line chatbot message keeps its text content', () => {
  // services/chatLeadFlow.js builds `message` by joining lines with LF. The
  // template applies no newline-to-<br> conversion and did not before this
  // change, so the assertion is that escaping altered nothing: the newlines
  // are still there, and the visitor's own words are still legible.
  const message = ['Submitted via VarliKent AI Chatbot.', '', 'Visitor: "hi <there>"'].join(LF)
  const html = leadEmailHtml({ interestType: 'General', message })

  assert.ok(html.includes(LF), 'newlines were stripped from the message')
  assert.ok(html.includes('Visitor: &quot;hi &lt;there&gt;&quot;'))
  assert.ok(!html.includes('<there>'), 'a raw tag survived in the message')
})

// ── 4. The password-reset template ───────────────────────────────────────

const FAKE_RESET_URL = 'https://www.varlikent.com/reset-password?token=deadbeefdeadbeef'

test('4a. an ordinary reset URL reaches the href unchanged', () => {
  const html = passwordResetEmailHtml(FAKE_RESET_URL)

  assert.ok(html.includes(`href="${FAKE_RESET_URL}"`), 'the reset link was altered')
  assert.ok(html.includes('Reset Your Password'))
})

test('4b. a multi-parameter URL is encoded without changing where it points', () => {
  const url = 'https://www.varlikent.com/reset-password?token=abc123&lang=tr'
  const html = passwordResetEmailHtml(url)

  // & inside an attribute must be &amp; to be valid HTML; a client decodes it
  // back before following the link, so the destination is identical.
  assert.ok(html.includes('href="https://www.varlikent.com/reset-password?token=abc123&amp;lang=tr"'))

  const href = html.match(/href="([^"]*)"/)[1]
  assert.equal(href.replaceAll('&amp;', '&'), url, 'the decoded link is not the original URL')
})

test('4c. a URL carrying a quote cannot break out of the href', () => {
  const html = passwordResetEmailHtml('https://evil.test/"><script>alert(1)</script>')

  assert.ok(!html.includes('<script'), 'a script tag reached the reset HTML')
  assert.ok(!html.includes('/"><'), 'the href attribute was broken out of')
})

// ── 5. Subject headers ───────────────────────────────────────────────────

test('5a. safeHeaderText removes CR and LF', () => {
  const out = safeHeaderText(`Alice${CR}${LF}Bcc: attacker@example.com`)

  assert.ok(!out.includes(CR), 'a carriage return survived')
  assert.ok(!out.includes(LF), 'a line feed survived')
  assert.equal(out, 'Alice Bcc: attacker@example.com')
})

test('5b. safeHeaderText removes other control characters too', () => {
  const out = safeHeaderText(`Ali${NUL}ce${TAB}Smith`)

  assert.ok(!out.includes(NUL), 'a NUL survived')
  assert.equal(out, 'Ali ce Smith')
})

test('5c. safeHeaderText does NOT HTML-encode ordinary characters', () => {
  assert.equal(safeHeaderText('Tom & Jerry'), 'Tom & Jerry')
  assert.equal(safeHeaderText(`O'Brien "Bob" <>`), `O'Brien "Bob" <>`)
})

test('5d. safeHeaderText trims, collapses runs, and caps length', () => {
  assert.equal(safeHeaderText('   spaced    out   '), 'spaced out')
  assert.equal(safeHeaderText('x'.repeat(500)).length, 200)
  assert.equal(safeHeaderText(undefined), '')
})

test('5e. the lead subject built by sendContactNotification is header-safe', async () => {
  const realFetch = globalThis.fetch
  const realError = console.error
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ id: 'fake-id' }) }
  }
  console.error = () => {}

  process.env.RESEND_API_KEY = 'test-key-not-real'
  process.env.EMAIL_FROM = 'Varlikent <no-reply@example.test>'
  process.env.OWNER_EMAIL = 'owner@example.test'
  routingDoc = null

  try {
    const sent = await sendContactNotification({
      ...HOSTILE_SUBMISSION,
      name: `Alice${CR}${LF}Bcc: attacker@example.com`,
    })

    assert.equal(sent, true, 'the send contract changed')
    assert.equal(calls.length, 1, 'expected exactly one Resend call')

    const { subject, html } = JSON.parse(calls[0].options.body)

    assert.ok(!subject.includes(CR), 'a carriage return reached the subject')
    assert.ok(!subject.includes(LF), 'a line feed reached the subject')
    assert.ok(!subject.includes('&amp;'), 'the subject was HTML-encoded')
    assert.equal(subject, 'New Lead: Buying — Alice Bcc: attacker@example.com')

    // The same request still carries the escaped body.
    assert.ok(!html.includes('<script'), 'a script tag reached the sent HTML')
  } finally {
    globalThis.fetch = realFetch
    console.error = realError
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    delete process.env.OWNER_EMAIL
  }
})
