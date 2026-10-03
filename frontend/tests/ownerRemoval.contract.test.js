// Owner removal UI — static source contracts.
//
// The behaviour is covered in a real browser by
// tests/browser/ownerRemoval.test.js. These checks cover what a browser test
// cannot see: that nothing identifying the protected owners is written into
// the frontend, that the wording comes from the translation system in all six
// languages, and that the flow never describes itself as deleting an account.
//
// No React testing dependency; run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import translations from '../src/locales/translations.js'

const here = dirname(fileURLToPath(import.meta.url))

const readRaw = (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')

// Comments stripped, so prose describing a rule never counts as code.
const read = async (...p) =>
  (await readRaw(...p))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const removalText = (lang) => translations[lang].adminPages.users.ownerRemoval

// ── 22. Nothing identifying is hard-coded ────────────────────────────────
for (const file of [['components', 'OwnerRemovalModal.jsx'], ['pages', 'AdminUsers.jsx']]) {
  const label = file.join('/')

  test(`22. ${label} hard-codes no protected id, email or configuration name`, async () => {
    const source = await readRaw(...file)

    assert.doesNotMatch(source, /\b[0-9a-f]{24}\b/i, 'no MongoDB ObjectId literal')
    assert.doesNotMatch(source, /PROTECTED_OWNER/, 'no server configuration name')
    assert.doesNotMatch(source, /gmail\.com|varlikent\.com/i, 'no real email domain')
    assert.doesNotMatch(source, /zille|deniz/i, 'no protected owner named in source')

    // The only email-shaped literal allowed is the create-account placeholder.
    const emails = (source.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).filter((value) => value !== 'admin@example.com')
    assert.deepEqual(emails, [])
  })
}

test('22. protection is read only from the server-provided isProtected flag', async () => {
  const page = await read('pages', 'AdminUsers.jsx')
  const modal = await read('components', 'OwnerRemovalModal.jsx')

  assert.match(page, /canConfirm=\{currentUser\?\.isProtected === true\}/, 'the code step is gated on the signed-in user\'s flag')
  assert.match(page, /const canRequestOwnerRemoval = isOwner && isAnotherOwner && !u\.isProtected/)
  assert.doesNotMatch(page, /PROTECTED|protectedOwners|protectedIds|protectedEmails/)

  // The modal is told whether confirming is allowed; it derives it from nothing.
  assert.doesNotMatch(modal, /isProtected|\.role\b|\.email\b|useAuth/)
  assert.doesNotMatch(modal, /localStorage|sessionStorage/)
})

test('the code step cannot render for someone who may not confirm', async () => {
  const modal = await read('components', 'OwnerRemovalModal.jsx')

  assert.match(modal, /\{canConfirm && showsCodeEntry && \(/, 'the code form is gated on canConfirm')
  assert.match(modal, /phase: action\.canConfirm \? PHASE\.otp : PHASE\.waiting/, 'an ordinary owner lands on the waiting phase')
  assert.match(modal, /if \(busy \|\| !canConfirm \|\| code\.length !== 6\) return/, 'confirm refuses without canConfirm')
  assert.match(modal, /if \(busy \|\| !canConfirm\) return/, 'resend refuses without canConfirm')
})

test('"I already have a code" is protected-owner only, sends nothing, and reuses the otp phase', async () => {
  const modal = await read('components', 'OwnerRemovalModal.jsx')

  // Rendered only when the page says the signed-in user may confirm.
  assert.match(modal, /\{canConfirm && \(\s*<button\s+type="button"\s+onClick=\{enterExistingCode\}/)

  // The handler only changes the phase — no API call of any kind.
  const handler = modal.match(/const enterExistingCode = \(\) => \{([\s\S]*?)\n {2}\}/)
  assert.ok(handler, 'enterExistingCode exists')
  assert.match(handler[1], /if \(busy \|\| !canConfirm\) return/)
  assert.doesNotMatch(handler[1], /api\.|fetch\(|async|await/)

  // It lands on the existing otp phase rather than a second code screen.
  const reducerCase = modal.match(/case 'enter_existing_code':([\s\S]*?)case /)
  assert.ok(reducerCase)
  assert.match(reducerCase[1], /phase: PHASE\.otp/)
  assert.equal((modal.match(/<form\b/g) || []).length, 1, 'still exactly one code form')
})

test('the modal talks to exactly the two owner-removal routes', async () => {
  const modal = await read('components', 'OwnerRemovalModal.jsx')
  const calls = modal.match(/api\.(get|post|put|patch|delete)\([^)]*\)/g) || []

  assert.deepEqual(calls.sort(), ['api.post(confirmUrl, { code })', 'api.post(requestUrl)', 'api.post(requestUrl)'])
  assert.match(modal, /const requestUrl = `\/users\/\$\{target\._id\}\/request-owner-removal`/)
  assert.match(modal, /const confirmUrl = `\/users\/\$\{target\._id\}\/confirm-owner-removal`/)
})

test('owner removal never goes through the role, permission or delete calls', async () => {
  const page = await read('pages', 'AdminUsers.jsx')

  // The Remove Owner button only opens the dialog.
  assert.match(page, /\{canRequestOwnerRemoval && \(\s*<button\s+type="button"\s+onClick=\{\(\) => setRemovalTarget\(u\)\}/)
  // The owner role is still not assignable from this page.
  assert.match(page, /if \(isOwner\) return \['admin', 'agent', 'user'\]/)
  assert.doesNotMatch(page, /<option[^>]*value="owner"[^>]*>\s*\{/, 'no owner option in a role selector')
})

test('the modal picks its wording from status codes and data fields, not server text', async () => {
  const modal = await read('components', 'OwnerRemovalModal.jsx')

  assert.doesNotMatch(modal, /response\?\.data\?\.message|data\.message|err\.message|\.data\.message/, 'the server message is never displayed')
  for (const status of [400, 401, 403, 404, 409, 410, 423, 429, 502, 503]) {
    assert.match(modal, new RegExp(`status === ${status}\\b`), `handles ${status}`)
  }
  assert.match(modal, /data\.retryAfterSeconds/)
  assert.match(modal, /data\.attemptsRemaining/)
  assert.match(modal, /res\.data\?\.delivery === 'partial'/)
  // No client-side cooldown timer competing with the server's.
  assert.doesNotMatch(modal, /setInterval|setTimeout/)
})

test('the modal has no hard-coded user-facing English', async () => {
  const modal = await read('components', 'OwnerRemovalModal.jsx')

  // Text between JSX tags must come from the translation object.
  const literalText = (modal.match(/>\s*([A-Za-z][A-Za-z ,.'!?-]{3,})\s*</g) || [])
  assert.deepEqual(literalText, [])
  assert.doesNotMatch(modal, /\|\|\s*'[A-Z][a-z]/, 'no inline English fallback strings')
  assert.doesNotMatch(modal, /(placeholder|aria-label|title)="[A-Za-z]/, 'no English attribute text')
})

// ── Translations ─────────────────────────────────────────────────────────
const REQUIRED = [
  'button', 'title', 'body', 'notDeleted', 'needsApproval', 'sendCode', 'alreadyHaveCode', 'sending',
  'sentTitle', 'sent', 'sentPartial', 'waiting', 'close',
  'otpTitle', 'otpIntro', 'otpPartial', 'codeLabel', 'expiresAt', 'confirm', 'confirming',
  'resend', 'resending', 'resent', 'done',
  'errorWrongCode', 'errorWrongCodeAttempts', 'errorInvalidCode', 'errorExpired', 'errorLocked',
  'errorWait', 'errorTooMany', 'errorEmailFailed', 'errorNotConfigured', 'errorNotAllowed',
  'errorNotFound', 'errorNotOwner', 'errorNoPending', 'errorStale', 'errorRequestFailed', 'errorConfirmFailed',
]

const PLACEHOLDERS = {
  body: ['{name}'],
  notDeleted: ['{name}'],
  otpIntro: ['{name}'],
  done: ['{name}'],
  expiresAt: ['{time}'],
  errorWait: ['{seconds}'],
  errorWrongCodeAttempts: ['{count}'],
}

for (const lang of LANGS) {
  test(`translations: ${lang} has every owner-removal string, non-empty`, () => {
    const text = removalText(lang)
    assert.ok(text, `${lang} has adminPages.users.ownerRemoval`)
    assert.deepEqual(Object.keys(text).sort(), [...REQUIRED].sort())

    for (const key of REQUIRED) {
      assert.equal(typeof text[key], 'string', `${lang}.${key}`)
      assert.ok(text[key].trim().length > 0, `${lang}.${key} is not empty`)
    }
  })

  test(`translations: ${lang} keeps every placeholder, and adds none`, () => {
    const text = removalText(lang)
    for (const key of REQUIRED) {
      const found = (text[key].match(/\{[a-zA-Z]+\}/g) || []).sort()
      assert.deepEqual(found, [...(PLACEHOLDERS[key] || [])].sort(), `${lang}.${key}`)
    }
  })

  if (lang !== 'en') {
    test(`translations: ${lang} is actually translated`, () => {
      const text = removalText(lang)
      const english = removalText('en')
      const same = REQUIRED.filter((key) => text[key] === english[key])
      assert.deepEqual(same, [], `${lang} strings identical to English`)
    })
  }
}

test('every key the modal reads exists in the translations, and every translation is used', async () => {
  const modal = await read('components', 'OwnerRemovalModal.jsx')
  const page = await read('pages', 'AdminUsers.jsx')

  const usedInModal = [...new Set([...modal.matchAll(/\bo\.([a-zA-Z]+)/g)].map((match) => match[1]))]
  for (const key of usedInModal) assert.ok(REQUIRED.includes(key), `modal reads o.${key}, which is not translated`)

  assert.match(page, /p\.ownerRemoval\?\.button/)
  const used = new Set([...usedInModal, 'button'])
  assert.deepEqual(REQUIRED.filter((key) => !used.has(key)), [], 'no unused owner-removal translation')
})

test('the English wording never says the account is deleted', () => {
  const text = removalText('en')

  assert.match(text.notDeleted, /will not be deleted/i)
  assert.match(text.notDeleted, /regular user/i)
  assert.match(text.needsApproval, /protected owner/i)

  // "deleted" may appear only where the text is saying it will NOT happen.
  for (const key of REQUIRED) {
    if (key === 'notDeleted') continue
    assert.doesNotMatch(text[key], /delet|erase|permanent/i, `en.${key} must not sound like account deletion`)
  }
  assert.doesNotMatch(text.button, /delete/i)
  assert.doesNotMatch(text.confirm, /delete/i)
})

test('partial delivery wording is neutral: it names no person and no address', () => {
  for (const lang of LANGS) {
    for (const key of ['sentPartial', 'otpPartial']) {
      assert.doesNotMatch(removalText(lang)[key], /@|zille|deniz/i, `${lang}.${key}`)
    }
  }
})
