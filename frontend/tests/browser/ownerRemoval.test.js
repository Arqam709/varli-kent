// Owner removal UI — the real AdminUsers page in a real browser, with every
// API call answered by this file. No backend runs, no database is read and no
// email can be sent: requests to anything other than the fixture server are
// aborted.
//
// Same harness as adminUsersChats.test.js. Run from frontend/ with:
//   node --test tests/browser/ownerRemoval.test.js

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import translations from '../../src/locales/translations.js'

let server
let browser
let base

const FIXTURE = '/__owner-removal.html'

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LanguageProvider} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx'; import {ThemeProvider} from '/src/contexts/ThemeContext.jsx';
import ProtectedRoute from '/src/components/ProtectedRoute.jsx'; import AdminUsers from '/src/pages/AdminUsers.jsx'; import {ToastContainer} from 'react-toastify'; import '/src/index.css';
const e=React.createElement;
createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:['/admin/users']},e(LanguageProvider,null,e(AuthProvider,null,e(ThemeProvider,null,e(React.Fragment,null,e(ToastContainer),e(Routes,null,e(Route,{path:'/admin/*',element:e(ProtectedRoute,{requiredRole:'owner'},e(AdminUsers))}),e(Route,{path:'*',element:e('p',null,'Access redirected')}))))))));
</script></body></html>`

before(async () => {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'owner-removal-fixture',
      enforce: 'pre',
      async load(id) {
        if (id.replaceAll('\\', '/').endsWith('/src/index.css')) {
          return (await readFile(id, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source ".";')
        }
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith(FIXTURE) || req.url.includes('html-proxy')) return next()
          try {
            res.setHeader('Content-Type', 'text/html')
            res.end(await vite.transformIndexHtml(FIXTURE, html))
          } catch (error) {
            next(error)
          }
        })
      },
    }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
  await server?.close()
})

const record = (id, name, role = 'user', extra = {}) => ({
  _id: id,
  name,
  email: `${id}@example.test`,
  role,
  permissions: [],
  isActive: true,
  isProtected: false,
  createdAt: '2026-01-01',
  ...extra,
})

// Text the mocked server puts in every `message`. The UI must build its
// wording from status codes and data fields, so this must never be shown.
const SERVER_TEXT = 'RAW-SERVER-MESSAGE-DO-NOT-DISPLAY'
const EXPIRES_AT = '2030-01-01T10:10:00.000Z'

const ok = (extra = {}) => ({ status: 200, json: { success: true, message: SERVER_TEXT, delivery: 'full', expiresAt: EXPIRES_AT, ...extra } })
const refuse = (status, extra = {}) => ({ status, json: { success: false, message: SERVER_TEXT, ...extra } })

/**
 * Opens the page as an owner. `isProtected` is the only thing that differs
 * between the two kinds of owner — exactly as it is in production, where the
 * flag comes from the server.
 */
async function setup(t, { isProtected = false, language = 'en', viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(15000)
  t.after(() => page.close())
  page.on('pageerror', (error) => console.error('Fixture page error:', error.message))

  const actor = record('actor', 'Fixture Operator', 'owner', { isProtected })
  const state = {
    calls: [],
    requestReply: ok(),
    confirmReply: ok(),
    requestDelayMs: 0,
    users: [
      record('zed', 'Zed Protected', 'owner', { isProtected: true }),
      actor,
      record('olivia', 'Olivia Owner', 'owner', { permissions: [] }),
      record('second', 'Second Owner', 'owner'),
      record('admin', 'Target Admin', 'admin', { permissions: ['view_chats'] }),
      record('agent', 'Target Agent', 'agent'),
      record('buyer', 'Buyer Alice'),
    ],
  }

  await page.addInitScript(({ actor, language }) => {
    localStorage.setItem('varlikent_token', 'fixture-token')
    localStorage.setItem('varlikent_user', JSON.stringify(actor))
    localStorage.setItem('vk_lang', language)
    localStorage.setItem('vk_lang_explicit', '1')
  }, { actor, language })

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.includes('/api/')) return url.origin === base ? route.continue() : route.abort()

    const path = url.pathname.split('/api')[1]
    const method = request.method()
    const data = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    state.calls.push({ path, method, data, hasBody: request.postData() !== null })

    if (path === '/auth/me') return route.fulfill({ json: { user: actor } })
    if (path === '/users' && method === 'GET') return route.fulfill({ json: { users: state.users } })

    const removal = path.match(/^\/users\/([^/]+)\/(request|confirm)-owner-removal$/)
    if (removal && method === 'POST') {
      const [, id, kind] = removal
      if (kind === 'request') {
        if (state.requestDelayMs) await new Promise((resolve) => setTimeout(resolve, state.requestDelayMs))
        return route.fulfill(state.requestReply)
      }
      const reply = state.confirmReply
      if (reply.status === 200) {
        // What the real API does on success: demote, keep the account.
        const target = state.users.find((user) => user._id === id)
        target.role = 'user'
        target.permissions = []
        return route.fulfill({ status: 200, json: { ...reply.json, user: target } })
      }
      return route.fulfill(reply)
    }

    return route.fulfill({ json: { success: true } })
  })

  await page.goto(base + FIXTURE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await expect(page.getByText('Olivia Owner', { exact: true })).toBeVisible({ timeout: 45000 })

  return { page, state, o: translations[language].adminPages.users.ownerRemoval, c: translations[language].adminPages.common }
}

const card = (page, name) => page.locator('div.rounded-2xl.border').filter({ hasText: name }).last()
const removeButton = (page, name, o) => card(page, name).getByRole('button', { name: o.button, exact: true })
const removalCalls = (state, kind) => state.calls.filter((call) => call.path.endsWith(`/${kind}-owner-removal`))
const listLoads = (state) => state.calls.filter((call) => call.path === '/users' && call.method === 'GET').length
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)

async function openRequest(page, o, name = 'Olivia Owner') {
  await removeButton(page, name, o).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('data-phase', 'confirm_request')
  return dialog
}

/** A protected owner who has requested a code and is looking at the code field. */
async function openCodeStep(t, options = {}) {
  const ctx = await setup(t, { isProtected: true, ...options })
  const dialog = await openRequest(ctx.page, ctx.o)
  await dialog.getByRole('button', { name: ctx.o.sendCode, exact: true }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  return { ...ctx, dialog, input: dialog.getByLabel(ctx.o.codeLabel, { exact: true }) }
}

// ── 1–4. Who gets a Remove Owner button ──────────────────────────────────
for (const isProtected of [false, true]) {
  const who = isProtected ? 'a protected owner' : 'an ordinary owner'

  test(`1-4. as ${who}: the button appears only on other, non-protected owners`, async (t) => {
    const { page, o } = await setup(t, { isProtected })

    // 3. another ordinary owner
    await expect(removeButton(page, 'Olivia Owner', o)).toBeVisible()
    await expect(removeButton(page, 'Second Owner', o)).toBeVisible()
    // 1. a protected owner
    await expect(card(page, 'Zed Protected')).toBeVisible()
    await expect(removeButton(page, 'Zed Protected', o)).toHaveCount(0)
    // 2. the signed-in owner's own card
    await expect(card(page, 'Fixture Operator')).toBeVisible()
    await expect(removeButton(page, 'Fixture Operator', o)).toHaveCount(0)
    // 4. non-owners
    for (const name of ['Target Admin', 'Target Agent', 'Buyer Alice']) {
      await expect(card(page, name)).toBeVisible()
      await expect(removeButton(page, name, o)).toHaveCount(0)
    }

    assert.equal(await page.getByRole('button', { name: o.button, exact: true }).count(), 2)
  })
}

test('the Protected badge is still shown, and owners still get no role dropdown', async (t) => {
  const { page } = await setup(t)
  const p = translations.en.adminPages.users

  await expect(card(page, 'Zed Protected').getByText(p.protected, { exact: true })).toBeVisible()
  await expect(card(page, 'Olivia Owner').getByText(p.protected, { exact: true })).toHaveCount(0)

  for (const name of ['Zed Protected', 'Olivia Owner', 'Second Owner', 'Fixture Operator']) {
    await expect(card(page, name).getByRole('combobox')).toHaveCount(0)
  }
  await expect(card(page, 'Target Admin').getByRole('combobox')).toHaveCount(1)
})

// ── 5–7. The request step ────────────────────────────────────────────────
test('5/6. Remove Owner opens a confirmation and sends nothing by itself', async (t) => {
  const { page, state, o, c } = await setup(t)
  const dialog = await openRequest(page, o)

  await expect(dialog).toContainText(o.title)
  await expect(dialog).toContainText(fill(o.body, { name: 'Olivia Owner' }))
  await expect(dialog).toContainText(fill(o.notDeleted, { name: 'Olivia Owner' }))
  await expect(dialog).toContainText(o.needsApproval)
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  assert.equal(removalCalls(state, 'request').length, 0, 'opening the dialog calls nothing')

  // Cancel, Escape and the X all leave without a request.
  await dialog.getByRole('button', { name: c.cancel, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await openRequest(page, o)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const again = await openRequest(page, o)
  await again.getByRole('button', { name: o.close, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  assert.equal(removalCalls(state, 'request').length, 0)
  assert.equal(removalCalls(state, 'confirm').length, 0)
})

test('6. pressing Enter when the confirmation opens does not send the request', async (t) => {
  const { page, state, o, c } = await setup(t)
  const dialog = await openRequest(page, o)

  await expect(dialog.getByRole('button', { name: c.cancel, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(removalCalls(state, 'request').length, 0)
})

test('7. confirming calls request-owner-removal for that owner, once, with no body', async (t) => {
  const { page, state, o } = await setup(t)
  state.requestDelayMs = 400
  const dialog = await openRequest(page, o)
  const send = dialog.getByRole('button', { name: o.sendCode, exact: true })

  await send.click()
  // While in flight the button is disabled and relabelled; extra clicks do nothing.
  const sending = dialog.getByRole('button', { name: o.sending, exact: true })
  await expect(sending).toBeDisabled()
  await sending.click({ force: true }).catch(() => {})
  await expect(dialog.getByRole('button', { name: translations.en.adminPages.common.cancel, exact: true })).toBeDisabled()

  await expect(dialog).toHaveAttribute('data-phase', 'waiting_for_approval')

  const calls = removalCalls(state, 'request')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/users/olivia/request-owner-removal')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].hasBody, false)
})

// ── 8. Ordinary owner ────────────────────────────────────────────────────
test('8. an ordinary owner gets a waiting state and never a code field', async (t) => {
  const { page, state, o } = await setup(t, { isProtected: false })
  const dialog = await openRequest(page, o)
  await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()

  await expect(dialog).toHaveAttribute('data-phase', 'waiting_for_approval')
  await expect(dialog).toContainText(o.sentTitle)
  await expect(dialog).toContainText(o.sent)
  await expect(dialog).toContainText(o.waiting)

  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: o.confirm, exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toHaveCount(0)
  await expect(dialog).not.toContainText(SERVER_TEXT)

  await dialog.getByRole('button', { name: o.close, exact: true }).last().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  assert.equal(removalCalls(state, 'confirm').length, 0)
  // Nothing changed yet, so the target is still listed as an owner.
  await expect(removeButton(page, 'Olivia Owner', o)).toBeVisible()
})

// ── 9–12. Protected owner ────────────────────────────────────────────────
test('9. a protected owner is taken to the code step after a successful request', async (t) => {
  const { dialog, input, state, o } = await openCodeStep(t)

  await expect(dialog).toContainText(o.otpTitle)
  await expect(dialog).toContainText(fill(o.otpIntro, { name: 'Olivia Owner' }))
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  await expect(dialog).toContainText(o.expiresAt.split('{time}')[0].trim())
  await expect(dialog.getByRole('button', { name: o.confirm, exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toBeVisible()
  await expect(dialog).not.toContainText(SERVER_TEXT)

  assert.equal(removalCalls(state, 'request').length, 1)
  assert.equal(removalCalls(state, 'confirm').length, 0)
})

test('10. the code field accepts six digits and nothing else', async (t) => {
  const { dialog, input, o } = await openCodeStep(t)
  const confirm = dialog.getByRole('button', { name: o.confirm, exact: true })

  await input.pressSequentially('ab1-2 c3')
  await expect(input).toHaveValue('123')
  await expect(confirm).toBeDisabled()

  await input.pressSequentially('4x5')
  await expect(input).toHaveValue('12345')
  await expect(confirm).toBeDisabled()

  await input.pressSequentially('6789')
  await expect(input).toHaveValue('123456')
  await expect(confirm).toBeEnabled()

  await input.fill('98 76-54 32 10')
  await expect(input).toHaveValue('987654')

  assert.equal(await input.getAttribute('inputmode'), 'numeric')
  assert.equal(await input.getAttribute('autocomplete'), 'one-time-code')
})

test('10. Enter with an incomplete code does not submit', async (t) => {
  const { input, state } = await openCodeStep(t)

  await input.fill('12345')
  await input.press('Enter')
  await new Promise((resolve) => setTimeout(resolve, 300))

  assert.equal(removalCalls(state, 'confirm').length, 0)
})

test('11/12. confirming sends the code, then closes and refreshes the list', async (t) => {
  const { page, dialog, input, state, o } = await openCodeStep(t)
  const loadsBefore = listLoads(state)

  await input.fill('482731')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(fill(o.done, { name: 'Olivia Owner' }))).toBeVisible()

  const calls = removalCalls(state, 'confirm')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/users/olivia/confirm-owner-removal')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].data, { code: '482731' })

  // The list was fetched again, and the former owner is now a regular user:
  // still listed (not deleted), no longer removable.
  await expect.poll(() => listLoads(state)).toBe(loadsBefore + 1)
  await expect(card(page, 'Olivia Owner')).toBeVisible()
  await expect(removeButton(page, 'Olivia Owner', o)).toHaveCount(0)
  await expect(card(page, 'Olivia Owner').locator('span.capitalize')).toHaveText('user')
  await expect(removeButton(page, 'Second Owner', o)).toBeVisible()
})

test('11. Enter in the code field submits a complete code', async (t) => {
  const { page, input, state } = await openCodeStep(t)

  await input.fill('111222')
  await input.press('Enter')

  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.deepEqual(removalCalls(state, 'confirm').map((call) => call.data), [{ code: '111222' }])
})

// ── 13–15. Confirmation errors ───────────────────────────────────────────
test('13. a wrong code shows the attempts remaining and clears the field', async (t) => {
  const { dialog, input, state, o } = await openCodeStep(t)
  state.confirmReply = refuse(401, { attemptsRemaining: 3 })

  await input.fill('000000')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(fill(o.errorWrongCodeAttempts, { count: 3 }))
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  await expect(input).toHaveValue('')
  await expect(dialog).not.toContainText(SERVER_TEXT)

  // Typing again clears the old error.
  await input.fill('1')
  await expect(dialog.getByRole('alert')).toHaveCount(0)

  // Without a count the plain message is used.
  state.confirmReply = refuse(401)
  await input.fill('000001')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText(o.errorWrongCode)
})

for (const [number, status, key, extra] of [
  [14, 410, 'errorExpired', {}],
  [15, 423, 'errorLocked', { attemptsRemaining: 0 }],
  ['—', 404, 'errorNoPending', {}],
  ['—', 400, 'errorInvalidCode', {}],
  ['—', 403, 'errorNotAllowed', {}],
  ['—', 500, 'errorConfirmFailed', {}],
]) {
  test(`${number}. confirm ${status} shows its own message and keeps the dialog usable`, async (t) => {
    const { dialog, input, state, o } = await openCodeStep(t)
    state.confirmReply = refuse(status, extra)

    await input.fill('123456')
    await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

    await expect(dialog.getByRole('alert')).toHaveText(o[key])
    await expect(dialog).not.toContainText(SERVER_TEXT)
    await expect(dialog).toHaveAttribute('data-phase', 'otp')
    await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toBeEnabled()
  })
}

test('confirm 409 (stale request) says so and refreshes the list behind the dialog', async (t) => {
  const { dialog, input, state, o } = await openCodeStep(t)
  const loadsBefore = listLoads(state)
  state.confirmReply = refuse(409)

  await input.fill('123456')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(o.errorStale)
  await expect.poll(() => listLoads(state)).toBe(loadsBefore + 1)
})

// ── 16–18. Request errors ────────────────────────────────────────────────
test('16. request 429 shows how long to wait, from retryAfterSeconds', async (t) => {
  const { page, state, o } = await setup(t)
  state.requestReply = refuse(429, { retryAfterSeconds: 42 })
  const dialog = await openRequest(page, o)

  await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(fill(o.errorWait, { seconds: 42 }))
  await expect(dialog.getByRole('alert')).toContainText('42')
  await expect(dialog).toHaveAttribute('data-phase', 'confirm_request')
  await expect(dialog).not.toContainText(SERVER_TEXT)

  // No client-side timer: the button is usable again and the server decides.
  await expect(dialog.getByRole('button', { name: o.sendCode, exact: true })).toBeEnabled()

  state.requestReply = refuse(429)
  await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText(o.errorTooMany)
})

for (const [number, status, key] of [
  [17, 502, 'errorEmailFailed'],
  [18, 503, 'errorNotConfigured'],
  ['—', 403, 'errorNotAllowed'],
  ['—', 404, 'errorNotFound'],
  ['—', 400, 'errorNotOwner'],
  ['—', 500, 'errorRequestFailed'],
]) {
  for (const isProtected of [false, true]) {
    test(`${number}. request ${status} as ${isProtected ? 'a protected' : 'an ordinary'} owner shows its own message and opens no further step`, async (t) => {
      const { page, state, o } = await setup(t, { isProtected })
      state.requestReply = refuse(status)
      const dialog = await openRequest(page, o)

      await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()

      await expect(dialog.getByRole('alert')).toHaveText(o[key])
      await expect(dialog).not.toContainText(SERVER_TEXT)
      await expect(dialog).toHaveAttribute('data-phase', 'confirm_request')
      await expect(dialog.getByRole('textbox')).toHaveCount(0)

      // A retry that succeeds carries on normally and drops the error.
      state.requestReply = ok()
      await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()
      await expect(dialog).toHaveAttribute('data-phase', isProtected ? 'otp' : 'waiting_for_approval')
      await expect(dialog.getByRole('alert')).toHaveCount(0)
    })
  }
}

// ── 19. Partial delivery ─────────────────────────────────────────────────
test('19. partial delivery is a success for an ordinary owner, in neutral wording', async (t) => {
  const { page, state, o } = await setup(t)
  state.requestReply = ok({ delivery: 'partial' })
  const dialog = await openRequest(page, o)

  await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()

  await expect(dialog).toHaveAttribute('data-phase', 'waiting_for_approval')
  await expect(dialog).toContainText(o.sentPartial)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog).not.toContainText('@')
})

test('19. partial delivery still lets a protected owner enter the code and finish', async (t) => {
  const ctx = await setup(t, { isProtected: true })
  ctx.state.requestReply = ok({ delivery: 'partial' })
  const dialog = await openRequest(ctx.page, ctx.o)
  await dialog.getByRole('button', { name: ctx.o.sendCode, exact: true }).click()

  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  await expect(dialog).toContainText(ctx.o.otpPartial)
  await expect(dialog).not.toContainText('@')

  await dialog.getByLabel(ctx.o.codeLabel, { exact: true }).fill('654321')
  await dialog.getByRole('button', { name: ctx.o.confirm, exact: true }).click()

  await expect(ctx.page.getByRole('dialog')).toHaveCount(0)
  assert.deepEqual(removalCalls(ctx.state, 'confirm').map((call) => call.data), [{ code: '654321' }])
})

// ── 20. Resend ───────────────────────────────────────────────────────────
test('20. Resend calls the request route again, clears the field and says the old code is dead', async (t) => {
  const { dialog, input, state, o } = await openCodeStep(t)
  state.confirmReply = refuse(401, { attemptsRemaining: 4 })

  await input.fill('111111')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await input.fill('2222')

  state.requestDelayMs = 300
  await dialog.getByRole('button', { name: o.resend, exact: true }).click()
  await expect(dialog.getByRole('button', { name: o.resending, exact: true })).toBeDisabled()
  await expect(input).toBeDisabled()

  await expect(dialog.getByRole('status')).toHaveText(o.resent)
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  await expect(input).toHaveValue('')
  await expect(dialog.getByRole('alert')).toHaveCount(0)

  const calls = removalCalls(state, 'request')
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.path === '/users/olivia/request-owner-removal' && call.method === 'POST'))
})

test('20. a resend refused by the cooldown shows the server\'s wait and keeps the code step', async (t) => {
  const { dialog, input, state, o } = await openCodeStep(t)
  state.requestReply = refuse(429, { retryAfterSeconds: 17 })

  await input.fill('123456')
  await dialog.getByRole('button', { name: o.resend, exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(fill(o.errorWait, { seconds: 17 }))
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  await expect(input).toHaveValue('123456', { timeout: 2000 })
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toBeEnabled()

  // The existing code can still be confirmed.
  state.confirmReply = ok()
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('20. an ordinary owner has no resend action anywhere', async (t) => {
  const { page, o } = await setup(t)
  const dialog = await openRequest(page, o)
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toHaveCount(0)

  await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'waiting_for_approval')
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toHaveCount(0)
})

// ── 21. Reset ────────────────────────────────────────────────────────────
test('21. closing the dialog discards the target, the typed code and the error', async (t) => {
  const { page, dialog, input, state, o, c } = await openCodeStep(t)
  state.confirmReply = refuse(401, { attemptsRemaining: 2 })

  await input.fill('555555')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await input.fill('777')

  await dialog.getByRole('button', { name: c.cancel, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // A different owner: back at the first step, nothing carried over.
  const next = await openRequest(page, o, 'Second Owner')
  await expect(next).toContainText('Second Owner')
  await expect(next).not.toContainText('Olivia Owner')
  await expect(next.getByRole('alert')).toHaveCount(0)
  await expect(next.getByRole('textbox')).toHaveCount(0)

  state.confirmReply = ok()
  await next.getByRole('button', { name: o.sendCode, exact: true }).click()
  await expect(next).toHaveAttribute('data-phase', 'otp')
  await expect(next.getByLabel(o.codeLabel, { exact: true })).toHaveValue('')
  await expect(next.getByRole('alert')).toHaveCount(0)
  assert.equal(removalCalls(state, 'request').at(-1).path, '/users/second/request-owner-removal')

  // Reopening the SAME owner also starts from the first step.
  await next.getByRole('button', { name: c.cancel, exact: true }).click()
  const reopened = await openRequest(page, o, 'Second Owner')
  await expect(reopened.getByRole('textbox')).toHaveCount(0)
})

// ── "I already have a code" ──────────────────────────────────────────────
/** A protected owner who skips the request and goes straight to the code. */
async function openWithExistingCode(t, options = {}) {
  const ctx = await setup(t, { isProtected: true, ...options })
  const dialog = await openRequest(ctx.page, ctx.o)
  await dialog.getByRole('button', { name: ctx.o.alreadyHaveCode, exact: true }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  return { ...ctx, dialog, input: dialog.getByLabel(ctx.o.codeLabel, { exact: true }) }
}

test('A1. a protected owner sees "I already have a code" as a secondary action', async (t) => {
  const { page, o } = await setup(t, { isProtected: true })
  const dialog = await openRequest(page, o)
  const already = dialog.getByRole('button', { name: o.alreadyHaveCode, exact: true })
  const send = dialog.getByRole('button', { name: o.sendCode, exact: true })

  await expect(already).toBeVisible()
  await expect(already).toBeEnabled()
  // Below the main buttons, and not styled like the destructive action.
  const [alreadyBox, sendBox] = [await already.boundingBox(), await send.boundingBox()]
  assert.ok(alreadyBox.y > sendBox.y, 'sits under the primary row')
  assert.notEqual(await already.evaluate((el) => getComputedStyle(el).backgroundColor), await send.evaluate((el) => getComputedStyle(el).backgroundColor))
  // Focus still starts on Cancel, so Enter cannot pick it by accident.
  await expect(dialog.getByRole('button', { name: translations.en.adminPages.common.cancel, exact: true })).toBeFocused()
})

test('A2. an ordinary owner never sees "I already have a code"', async (t) => {
  const { page, o } = await setup(t, { isProtected: false })
  const dialog = await openRequest(page, o)

  await expect(dialog.getByRole('button', { name: o.alreadyHaveCode, exact: true })).toHaveCount(0)
  await expect(dialog.getByText(o.alreadyHaveCode, { exact: true })).toHaveCount(0)

  await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'waiting_for_approval')
  await expect(dialog.getByText(o.alreadyHaveCode, { exact: true })).toHaveCount(0)
})

test('A3/A4. it goes straight to the code field without calling the request route', async (t) => {
  const { dialog, input, state, o } = await openWithExistingCode(t)

  assert.equal(removalCalls(state, 'request').length, 0, 'no request was made')
  assert.equal(removalCalls(state, 'confirm').length, 0)

  await expect(dialog).toContainText(o.otpTitle)
  await expect(dialog).toContainText(fill(o.otpIntro, { name: 'Olivia Owner' }))
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('status')).toHaveCount(0)
  // No request was made here, so there is no expiry or delivery to report.
  await expect(dialog).not.toContainText(o.expiresAt.split('{time}')[0].trim())
  await expect(dialog).not.toContainText(o.otpPartial)
  await expect(dialog.getByRole('button', { name: o.confirm, exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toBeVisible()
})

test('A5. confirming an existing code sends { code } and completes the removal', async (t) => {
  const { page, dialog, input, state, o } = await openWithExistingCode(t)
  const loadsBefore = listLoads(state)

  await input.fill('302948')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(fill(o.done, { name: 'Olivia Owner' }))).toBeVisible()

  const calls = removalCalls(state, 'confirm')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/users/olivia/confirm-owner-removal')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].data, { code: '302948' })
  assert.equal(removalCalls(state, 'request').length, 0, 'still no request was ever made')

  await expect.poll(() => listLoads(state)).toBe(loadsBefore + 1)
  await expect(removeButton(page, 'Olivia Owner', o)).toHaveCount(0)
  await expect(card(page, 'Olivia Owner').locator('span.capitalize')).toHaveText('user')
})

test('A6. with no pending request the normal 404 message is shown, and Resend is offered', async (t) => {
  const { dialog, input, state, o } = await openWithExistingCode(t)
  state.confirmReply = refuse(404)

  await input.fill('123456')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(o.errorNoPending)
  await expect(dialog).not.toContainText(SERVER_TEXT)
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
  await expect(dialog.getByRole('button', { name: o.resend, exact: true })).toBeEnabled()
})

for (const [status, key, extra] of [
  [401, 'errorWrongCodeAttempts', { attemptsRemaining: 2 }],
  [410, 'errorExpired', {}],
  [423, 'errorLocked', { attemptsRemaining: 0 }],
  [409, 'errorStale', {}],
]) {
  test(`A7. an existing code answered with ${status} uses the normal confirm handling`, async (t) => {
    const { dialog, input, state, o } = await openWithExistingCode(t)
    state.confirmReply = refuse(status, extra)

    await input.fill('123456')
    await dialog.getByRole('button', { name: o.confirm, exact: true }).click()

    await expect(dialog.getByRole('alert')).toHaveText(key === 'errorWrongCodeAttempts' ? fill(o[key], { count: 2 }) : o[key])
    await expect(dialog).toHaveAttribute('data-phase', 'otp')
    await expect(input).toHaveValue('')
    assert.equal(removalCalls(state, 'request').length, 0)
  })
}

test('A8. Resend from this code step calls the request route, and the new code can be confirmed', async (t) => {
  const { dialog, input, state, o } = await openWithExistingCode(t)
  state.confirmReply = refuse(410)
  await input.fill('111111')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText(o.errorExpired)

  state.requestReply = ok({ delivery: 'partial' })
  await dialog.getByRole('button', { name: o.resend, exact: true }).click()

  await expect(dialog.getByRole('status')).toHaveText(o.resent)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog).toContainText(o.otpPartial)
  await expect(input).toHaveValue('')

  const requests = removalCalls(state, 'request')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/users/olivia/request-owner-removal')
  assert.equal(requests[0].method, 'POST')

  state.confirmReply = ok()
  await input.fill('222333')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.deepEqual(removalCalls(state, 'confirm').at(-1).data, { code: '222333' })
})

test('A8. Resend here still obeys the server cooldown', async (t) => {
  const { dialog, state, o } = await openWithExistingCode(t)
  state.requestReply = refuse(429, { retryAfterSeconds: 33 })

  await dialog.getByRole('button', { name: o.resend, exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(fill(o.errorWait, { seconds: 33 }))
  await expect(dialog).toHaveAttribute('data-phase', 'otp')
})

test('A9. closing and reopening after "I already have a code" starts from the first step', async (t) => {
  const { page, dialog, input, state, o, c } = await openWithExistingCode(t)
  state.confirmReply = refuse(401, { attemptsRemaining: 4 })
  await input.fill('999999')
  await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await input.fill('12')

  await dialog.getByRole('button', { name: c.cancel, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  for (const name of ['Olivia Owner', 'Second Owner']) {
    const reopened = await openRequest(page, o, name)
    await expect(reopened).toContainText(name)
    await expect(reopened.getByRole('textbox')).toHaveCount(0)
    await expect(reopened.getByRole('alert')).toHaveCount(0)
    await expect(reopened.getByRole('button', { name: o.alreadyHaveCode, exact: true })).toBeVisible()

    await reopened.getByRole('button', { name: o.alreadyHaveCode, exact: true }).click()
    await expect(reopened.getByLabel(o.codeLabel, { exact: true })).toHaveValue('')
    await expect(reopened.getByRole('alert')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }

  assert.equal(removalCalls(state, 'request').length, 0)
})

for (const language of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
  test(`A10. "I already have a code" is localized: ${language}`, async (t) => {
    const { page, o } = await setup(t, { isProtected: true, language, viewport: { width: 390, height: 760 } })
    const dialog = await openRequest(page, o)
    const already = dialog.getByRole('button', { name: o.alreadyHaveCode, exact: true })

    await expect(already).toBeVisible()
    await already.click()
    await expect(dialog).toHaveAttribute('data-phase', 'otp')
    await expect(dialog).toContainText(o.otpTitle)
  })
}

// ── Every language, RTL and mobile width ─────────────────────────────────
for (const language of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
  test(`the whole flow is localized, fits a phone and never shows server text: ${language}`, async (t) => {
    const { page, state, o, c } = await setup(t, { isProtected: true, language, viewport: { width: 390, height: 760 } })
    const rtl = ['ar', 'ur'].includes(language)
    await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr')

    await removeButton(page, 'Olivia Owner', o).click()
    const dialog = page.getByRole('dialog')

    await expect(dialog).toContainText(o.title)
    await expect(dialog).toContainText(fill(o.body, { name: 'Olivia Owner' }))
    await expect(dialog).toContainText(fill(o.notDeleted, { name: 'Olivia Owner' }))
    await expect(dialog).toContainText(o.needsApproval)
    await expect(dialog.getByRole('button', { name: c.cancel, exact: true })).toBeVisible()

    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'the dialog fits a 390px viewport')

    await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()
    await expect(dialog).toContainText(o.otpTitle)
    await expect(dialog).toContainText(fill(o.otpIntro, { name: 'Olivia Owner' }))

    const input = dialog.getByLabel(o.codeLabel, { exact: true })
    // Digits read left-to-right in every language.
    await expect(input).toHaveAttribute('dir', 'ltr')

    state.confirmReply = refuse(401, { attemptsRemaining: 4 })
    await input.fill('123456')
    await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(fill(o.errorWrongCodeAttempts, { count: 4 }))
    await expect(dialog).not.toContainText(SERVER_TEXT)

    state.confirmReply = ok()
    await input.fill('123456')
    await dialog.getByRole('button', { name: o.confirm, exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText(fill(o.done, { name: 'Olivia Owner' }))).toBeVisible()
  })
}

test('the ordinary-owner path is localized too', async (t) => {
  for (const language of ['tr', 'ar']) {
    const { page, o } = await setup(t, { language })
    const dialog = await openRequest(page, o)
    await dialog.getByRole('button', { name: o.sendCode, exact: true }).click()
    await expect(dialog).toContainText(o.sent)
    await expect(dialog).toContainText(o.waiting)
  }
})
