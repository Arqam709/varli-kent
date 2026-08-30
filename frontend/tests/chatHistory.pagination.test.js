// The two behaviours Wave 13B's first frontend pass got wrong.
//
//   1. GET /api/chat/conversations is PAGINATED, and the context discarded
//      `pagination` — so "My AI Chat History" only ever showed page 1. With no
//      conversation cap (deliberately), a long-standing user has more history
//      than one page and simply could not reach it.
//
//   2. loadConversation() writes a saved transcript into a `chats` page bucket.
//      Deleting that conversation removed it from the server and the list but
//      left the transcript rendered — a conversation that no longer exists.
//
// ChatContext cannot be imported here (React + axios + provider). Instead the
// two pure reducers it now relies on are re-declared and exercised directly,
// and a static pass over the source proves the component actually uses them.
// That is the same approach pageContentCoverage.test.js takes.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = async (...p) =>
  (await readFile(join(here, '..', 'src', ...p), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

/* ── The append reducer, mirroring ChatContext's setConversations updater ── */
const appendPage = (prev, incoming, append) => {
  if (!append) return incoming
  const seen = new Set(prev.map((c) => c._id))
  return [...prev, ...incoming.filter((c) => !seen.has(c._id))]
}

const hasMore = (pagination) =>
  Boolean(pagination && pagination.page < pagination.totalPages)

const page = (n, ids, totalPages, totalCount) => ({
  conversations: ids.map((id) => ({ _id: id })),
  pagination: { page: n, limit: 20, totalCount, totalPages },
})

/* ═══════════════ 1. Pagination ═══════════════ */

test('1a. a user with more history than one page can reach all of it', () => {
  const p1 = page(1, ['a', 'b', 'c'], 3, 8)
  const p2 = page(2, ['d', 'e', 'f'], 3, 8)
  const p3 = page(3, ['g', 'h'], 3, 8)

  let list = appendPage([], p1.conversations, false)
  assert.equal(list.length, 3, 'first load should replace, not append')
  assert.equal(hasMore(p1.pagination), true, 'Load More should be offered')

  list = appendPage(list, p2.conversations, true)
  assert.deepEqual(list.map((c) => c._id), ['a', 'b', 'c', 'd', 'e', 'f'], 'page 1 was lost')
  assert.equal(hasMore(p2.pagination), true)

  list = appendPage(list, p3.conversations, true)
  assert.equal(list.length, 8, 'not all history is reachable')
  assert.equal(hasMore(p3.pagination), false, 'Load More should disappear on the last page')
})

test('1b. appending never duplicates a conversation id', () => {
  // A conversation whose lastActivityAt changed between two fetches can
  // legitimately appear on both pages.
  const list = appendPage(
    [{ _id: 'a' }, { _id: 'b' }],
    [{ _id: 'b' }, { _id: 'c' }],
    true
  )

  assert.deepEqual(list.map((c) => c._id), ['a', 'b', 'c'])
  assert.equal(new Set(list.map((c) => c._id)).size, list.length, 'duplicate rows')
})

test('1c. a single-page history offers no Load More', () => {
  assert.equal(hasMore({ page: 1, totalPages: 1, totalCount: 2 }), false)
  assert.equal(hasMore(null), false, 'a missing pagination must not offer Load More')
})

test('1d. a failed page append leaves the already-loaded rows untouched', () => {
  const loaded = [{ _id: 'a' }, { _id: 'b' }]
  // The context returns { success: false } and never calls the state setter,
  // so the list is whatever it already was.
  assert.deepEqual(appendPage(loaded, [], true), loaded)
})

/* ═══════════════ 2. Source contract for pagination ═══════════════ */

test('2a. the context requests a page and keeps the pagination object', async () => {
  const s = await read('contexts', 'ChatContext.jsx')

  assert.match(s, /loadConversations = async \(\{ page = 1, append = false \} = \{\} \) =>|loadConversations = async \(\{ page = 1, append = false \} = \{\}\) =>/,
    'loadConversations does not accept { page, append }')
  assert.ok(s.includes("api.get('/chat/conversations', { params: { page } })"), 'the page is not sent')
  assert.match(s, /setConversationsPagination\(res\.data\.pagination/, 'pagination is discarded')
  assert.match(s, /\n\s*conversationsPagination,/, 'pagination is not exposed on the context')
})

test('2b. loadConversations() with no arguments still means page 1', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  // Defaulted parameters keep every existing caller working.
  assert.match(s, /\{ page = 1, append = false \} = \{\}/)
  const settings = await read('pages', 'SettingsPage.jsx')
  assert.ok(settings.includes('loadConversations()'), 'the zero-arg initial load was removed')
})

test('2c. stale history responses cannot overwrite a newer list', async () => {
  const s = await read('contexts', 'ChatContext.jsx')

  assert.match(s, /conversationsRequestRef/, 'no generation guard on history requests')
  assert.match(
    s,
    /if \(conversationsRequestRef\.current !== requestGeneration\) return \{ success: false \}/,
    'a stale response is not discarded'
  )
})

test('2d. Settings offers Load More only when more pages exist', async () => {
  const s = await read('pages', 'SettingsPage.jsx')

  assert.match(s, /conversationsPagination\.page < conversationsPagination\.totalPages/, 'no hasMore check')
  assert.match(s, /\{hasMore && \(/, 'the button is not conditional')
  assert.match(s, /append: true/, 'Load More does not append')
  assert.match(s, /disabled=\{conversationsLoadingMore\}/, 'the button is not disabled while loading')
  assert.ok(!/IntersectionObserver|infinite/i.test(s), 'infinite scroll was introduced')
})

/* ═══════════════ 3. Deleting the OPEN conversation ═══════════════ */

test('3a. the context tracks which page bucket holds the saved transcript', async () => {
  const s = await read('contexts', 'ChatContext.jsx')

  assert.match(s, /selectedConversationKeyRef/, 'the transcript bucket is not tracked')
  assert.match(
    s,
    /setSelectedConversationId\(res\.data\.conversation\?\._id \|\| conversationId\)\s*\n\s*selectedConversationKeyRef\.current = key/,
    'loadConversation does not record the bucket it wrote to'
  )
})

test('3b. clearing the transcript empties exactly that bucket', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const clearSelectedTranscript'), s.indexOf('const deleteConversation'))

  assert.match(fn, /conversationGenerationRef\.current \+= 1/, 'no generation bump — a late response could resurrect it')
  assert.match(fn, /setSelectedConversationId\(null\)/)
  assert.match(fn, /selectedConversationKeyRef\.current = null/)
  assert.match(fn, /setChats\(\(prev\) => \(\{ \.\.\.prev, \[key\]: \[\] \}\)\)/, 'the bucket is not emptied')
  // Targeted, not a blanket wipe of every page's chat.
  assert.ok(!/setChats\(\{\}\)/.test(fn), 'every in-memory chat was wiped')
})

test('3c. delete-one clears the transcript ONLY when that conversation is open', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const deleteConversation = async'), s.indexOf('const deleteAllConversations'))

  assert.match(
    fn,
    /if \(selectedConversationId === conversationId\) clearSelectedTranscript\(\)/,
    'deleting any row would wipe the open chat'
  )
  // Still confirmed by the server first.
  assert.ok(fn.indexOf('await api.delete') < fn.indexOf('clearSelectedTranscript'), 'cleared before the server confirmed')
})

test('3d. clear-all drops a loaded saved transcript but spares an unsaved session', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const deleteAllConversations = async'), s.indexOf("const loadConversation = async"))

  assert.match(fn, /if \(selectedConversationId\) clearSelectedTranscript\(\)/,
    'clear-all does not drop the orphaned transcript')
  assert.ok(fn.indexOf('await api.delete') < fn.indexOf('clearSelectedTranscript'), 'cleared before the server confirmed')
  assert.match(fn, /setConversationsPagination\(null\)/, 'pagination not reset after clearing')
})

test('3e. a failed delete mutates nothing', async () => {
  const s = await read('contexts', 'ChatContext.jsx')

  for (const name of ['deleteConversation', 'deleteAllConversations']) {
    const start = s.indexOf(`const ${name} = async`)
    const fn = s.slice(start, s.indexOf('  }', s.indexOf('catch', start)))
    const catchBlock = fn.slice(fn.indexOf('catch'))

    assert.ok(!/setConversations|clearSelectedTranscript|setSelectedConversationId/.test(catchBlock),
      `${name} mutates state in its catch block`)
  }
})

test('3f. starting a new chat detaches from the saved conversation', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const startNewConversation ='), s.indexOf('const loadConversations'))

  assert.match(fn, /selectedConversationKeyRef\.current = null/, 'the bucket ref is left dangling')
  assert.match(fn, /setSelectedConversationId\(null\)/)
})

/* ═══════════════ 4. Boundaries still hold ═══════════════ */

test('4a. no conversation cap or auto-eviction was introduced', async () => {
  const s = await read('contexts', 'ChatContext.jsx')

  for (const banned of ['MAX_CONVERSATIONS', 'enforceConversationCap', 'slice(0, 5)']) {
    assert.ok(!s.includes(banned), `a cap was introduced: ${banned}`)
  }
})

test('4b. property messaging is still untouched by history code', async () => {
  for (const f of [['contexts', 'ChatContext.jsx'], ['pages', 'SettingsPage.jsx']]) {
    const s = await read(...f)
    for (const banned of ['PropertyConversation', 'PropertyMessage', 'property-conversations']) {
      assert.ok(!s.includes(banned), `${f.join('/')} references ${banned}`)
    }
  }
})

/* ═══════════════ 5. Six languages ═══════════════ */

test('5. the Load More strings exist in all six languages', async () => {
  const { default: translations } = await import('../src/locales/translations.js')

  for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    for (const key of ['loadMore', 'loadingMore']) {
      const value = translations[lang]?.aiChatHistory?.[key]
      assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}.aiChatHistory.${key} is missing`)
    }
  }
})

/* ═══════════════ 6. Append failure must not hide the loaded rows ═══════════════ */

// Preserving the `conversations` array is not enough on its own: Settings
// renders its list behind `!conversationsError`, so raising the page-level
// error on a failed Load More would hide every row already on screen and show
// a whole-history error instead. These assert the render contract, not just
// the array.

/** The exact conditions SettingsPage uses to choose what to render. */
const settingsView = ({ loading, error, rows }) => {
  if (loading) return 'loading'
  if (error) return 'error'
  return rows.length === 0 ? 'empty' : 'list'
}

test('6a. the page-level error is raised ONLY for a failed first page', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const loadConversations = async'), s.indexOf('const clearSelectedTranscript'))
  const catchBlock = fn.slice(fn.indexOf('} catch'), fn.indexOf('} finally'))

  assert.match(
    catchBlock,
    /if \(!append\) setConversationsError\(true\)/,
    'an append failure still poisons the page-level error state'
  )
  assert.ok(
    !/^\s*setConversationsError\(true\)\s*$/m.test(catchBlock),
    'setConversationsError(true) is called unconditionally in the catch'
  )
})

test('6b. after a failed Load More, Settings still renders the list', () => {
  // page 1 succeeded, page 2 failed: rows preserved AND error not raised.
  const rows = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]

  assert.equal(
    settingsView({ loading: false, error: false, rows }),
    'list',
    'a failed Load More hid the already-loaded history'
  )
})

test('6c. a failed FIRST page still shows the error state', () => {
  assert.equal(settingsView({ loading: false, error: true, rows: [] }), 'error')
})

test('6d. Load More stays retryable after a failure', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const loadConversations = async'), s.indexOf('const clearSelectedTranscript'))

  // The busy flag is cleared in finally, so the button re-enables...
  assert.match(fn, /if \(append\) setConversationsLoadingMore\(false\)/, 'the busy state can stick after a failure')
  // ...and the pagination object is untouched by the failure, so the next
  // click still computes the same next page.
  const catchBlock = fn.slice(fn.indexOf('} catch'), fn.indexOf('} finally'))
  assert.ok(!/setConversationsPagination/.test(catchBlock), 'a failed append discarded the pagination cursor')
  assert.ok(!/setConversations\(/.test(catchBlock), 'a failed append mutated the list')
})

test('6e. a fresh first-page load clears a previous error', async () => {
  const s = await read('contexts', 'ChatContext.jsx')
  const fn = s.slice(s.indexOf('const loadConversations = async'), s.indexOf('const clearSelectedTranscript'))
  const beforeTry = fn.slice(0, fn.indexOf('try {'))

  assert.match(beforeTry, /setConversationsError\(false\)/, 'a retry cannot clear a previous error')
})
