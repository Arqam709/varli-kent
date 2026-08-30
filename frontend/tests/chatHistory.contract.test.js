// Static contract for the AI chat history UI.
//
// Follows the same source-scanning approach as pageContentCoverage.test.js —
// no React testing dependency, run with plain `node --test` from frontend/.
//
// The assertion that matters most is the LAST one: no chat-history delete path
// may reference PropertyConversation / PropertyMessage. Those are the customer
// to agent threads, a different system entirely, and this wave must not be
// able to reach them.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (...p) => join(here, '..', 'src', ...p)

const read = async (...p) => {
  const raw = await readFile(src(...p), 'utf8')
  // Strip comments so prose mentioning an endpoint never satisfies a check.
  return raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

/* ═══════════════ 1. ChatContext exposes the delete API ═══════════════ */

test('1a. ChatContext defines and exports both delete functions', async () => {
  const s = await read('contexts', 'ChatContext.jsx')

  assert.match(s, /const deleteConversation = async/, 'deleteConversation not defined')
  assert.match(s, /const deleteAllConversations = async/, 'deleteAllConversations not defined')
  assert.match(s, /\n\s*deleteConversation,/, 'deleteConversation not provided on the context')
  assert.match(s, /\n\s*deleteAllConversations,/, 'deleteAllConversations not provided on the context')
})

test('1b. delete-one calls the user-scoped endpoint', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  assert.ok(
    s.includes('api.delete(`/chat/conversations/${conversationId}`)'),
    'delete-one does not call DELETE /chat/conversations/:id'
  )
})

test('1c. clear-all calls the collection endpoint', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  assert.ok(
    s.includes("api.delete('/chat/conversations')"),
    'clear-all does not call DELETE /chat/conversations'
  )
})

test('1d. deletion is not optimistic — state changes only after the await', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const deleteConversation = async'), s.indexOf('const deleteAllConversations'))

  const awaitAt = fn.indexOf('await api.delete')
  const filterAt = fn.indexOf('setConversations((prev) => prev.filter')

  assert.ok(awaitAt > -1 && filterAt > awaitAt, 'the list is mutated before the server confirms')
})

test('1e. a deleted selection is cleared so nothing references a dead id', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  assert.match(s, /if \(selectedConversationId === conversationId\)/)
  assert.match(s, /setSelectedConversationId\(null\)/)
})

/* ═══════════════ 2. Settings surfaces the history ═══════════════ */

test('2a. Settings renders an AI chat history section', async () => {
  const s = await read('pages', 'SettingsPage.jsx')

  assert.match(s, /const AiChatHistorySection = \(\) =>/, 'the section component is missing')
  assert.match(s, /<AiChatHistorySection \/>/, 'the section is never rendered')
})

test('2b. Settings reuses ChatContext rather than a second read API', async () => {
  const s = await read('pages', 'SettingsPage.jsx')

  assert.match(s, /useChat\(\)/, 'Settings does not use ChatContext')
  for (const fn of ['loadConversations', 'loadConversation', 'deleteConversation', 'deleteAllConversations']) {
    assert.ok(s.includes(fn), `Settings does not use ${fn}`)
  }
  // No hand-rolled second fetch of the same data.
  assert.ok(!/api\.get\(['"`]\/chat\/conversations/.test(s), 'Settings fetches chat history directly')
})

test('2c. Settings uses a confirmation modal, never window.confirm', async () => {
  const s = await read('pages', 'SettingsPage.jsx')

  assert.ok(!/window\.confirm|(?<![\w.])confirm\(/.test(s), 'a native confirm() is used')
  assert.match(s, /role="dialog"/, 'no dialog role on the confirmation')
  assert.match(s, /aria-modal="true"/, 'confirmation is not marked as modal')
})

test('2d. every history string is localized, none hardcoded-only', async () => {
  const s = await read('pages', 'SettingsPage.jsx')
  const section = s.slice(s.indexOf('const AiChatHistorySection'), s.indexOf('const SettingsPage'))

  for (const key of ['title', 'empty', 'loading', 'error', 'clearAll', 'deleteOne', 'confirmDeleteOne', 'confirmClearAll']) {
    assert.ok(section.includes(`h.${key}`), `history string '${key}' is not localized`)
  }
})

/* ═══════════════ 3. Admin moderation ═══════════════ */

test('3a. admin controls are gated on moderate_chats, not view_chats', async () => {
  const s = await read('pages', 'AdminUserChats.jsx')

  assert.match(s, /hasPermission\('moderate_chats'\)/, 'moderation is not permission-gated')
  assert.ok(
    !/hasPermission\('view_chats'\)[\s\S]{0,200}setPendingDelete/.test(s),
    'a delete control is gated on view_chats'
  )
})

test('3b. admin controls call the admin chat endpoints', async () => {
  const s = await read('pages', 'AdminUserChats.jsx')

  assert.ok(s.includes('api.delete(`/admin/chats/${selectedConversationId}`)'), 'no admin delete-one call')
  assert.ok(s.includes('api.delete(`/admin/chats/user/${selectedUserId}`)'), 'no admin clear-user call')
})

test('3c. admin destructive actions are confirmed', async () => {
  const s = await read('pages', 'AdminUserChats.jsx')

  assert.match(s, /const ConfirmModal = /, 'no confirmation modal')
  assert.ok(!/window\.confirm/.test(s), 'a native confirm() is used')
  assert.match(s, /confirmClearUser/, 'clear-user has no dedicated confirmation copy')
})

test('3d. moderate_chats is offered in the permission editor', async () => {
  const s = await read('pages', 'AdminUsers.jsx')

  assert.match(s, /key: 'moderate_chats'/, 'the permission cannot be granted from the UI')
  assert.match(s, /key: 'view_chats'/, 'view_chats was removed')
})

/* ═══════════════ 4. System isolation ═══════════════ */

test('4. no chat-history delete path mentions property messaging', async () => {
  // The hard boundary of this wave.
  const files = [
    ['contexts', 'ChatContext.jsx'],
    ['pages', 'SettingsPage.jsx'],
    ['pages', 'AdminUserChats.jsx'],
  ]

  for (const f of files) {
    const s = await read(...f)
    for (const banned of ['PropertyConversation', 'PropertyMessage', 'property-conversations']) {
      assert.ok(!s.includes(banned), `${f.join('/')} references ${banned}`)
    }
  }
})

/* ═══════════════ 5. Six-language coverage ═══════════════ */

test('5a. every history string exists in all six languages', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  const keys = [
    'title', 'description', 'loading', 'empty', 'error', 'open', 'deleteOne', 'clearAll',
    'messages', 'deleting', 'clearing', 'confirmDeleteOne', 'confirmClearAll', 'cannotUndo',
    'cancel', 'confirm', 'deletedOne', 'clearedAll', 'deleteFailed',
  ]

  for (const lang of LANGS) {
    const block = translations[lang]?.aiChatHistory
    assert.ok(block, `${lang} has no aiChatHistory block`)
    for (const key of keys) {
      assert.ok(
        typeof block[key] === 'string' && block[key].trim() !== '',
        `${lang}.aiChatHistory.${key} is missing`
      )
    }
  }
})

test('5b. every admin moderation string exists in all six languages', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  const keys = [
    'deleteConversation', 'clearUserHistory', 'confirmDeleteConversation',
    'confirmClearUser', 'deleting', 'deleted', 'cleared', 'deleteFailed', 'cancel', 'confirm',
  ]

  for (const lang of LANGS) {
    const block = translations[lang]?.adminPages?.userChats
    assert.ok(block, `${lang} has no adminPages.userChats block`)
    for (const key of keys) {
      assert.ok(
        typeof block[key] === 'string' && block[key].trim() !== '',
        `${lang}.adminPages.userChats.${key} is missing`
      )
    }
  }
})

test('5c. the clear-user confirmation names the user in every language', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  for (const lang of LANGS) {
    assert.ok(
      translations[lang].adminPages.userChats.confirmClearUser.includes('{name}'),
      `${lang} clear-user confirmation drops the {name} placeholder`
    )
  }
})
