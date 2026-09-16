// Batch 8 — AI chatbot + property details static contracts.
// Run from frontend: node --test tests/batch8ChatPropertyDetails.contract.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { env } from 'node:process'
import translations from '../src/locales/translations.js'
import { applyBatch8Mutation } from './batch8Mutations.js'

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const readRaw = async (path) =>
  applyBatch8Mutation(env.BATCH8_MUTATION, '/src/' + path, await readFile(new URL('../src/' + path, import.meta.url), 'utf8'))

// Comments stripped so prose can never satisfy a contract.
const read = async (path) =>
  (await readRaw(path))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

test('Batch 8: every JSX component in the chatbot and property page is defined or imported', async () => {
  // The delete UI once shipped rendering <TrashIcon /> and <ChatConfirmModal />
  // with no definition: name-only contracts and ESLint's core no-undef both
  // passed while opening History threw a ReferenceError at runtime.
  for (const path of ['components/AIChatbot.jsx', 'pages/PropertyDetailsPage.jsx']) {
    const s = await read(path)
    const declared = new Set()
    for (const [, clause] of s.matchAll(/import\s+([\s\S]+?)\s+from\s+['"]/g)) {
      for (const [name] of clause.matchAll(/\b[A-Z]\w*\b/g)) declared.add(name)
    }
    for (const [, name] of s.matchAll(/(?:const|let|function|class)\s+([A-Z]\w*)\b/g)) declared.add(name)
    const used = new Set([...s.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]))
    assert.ok(used.size > 0)
    for (const name of used) assert.ok(declared.has(name), `${path} renders <${name}> without defining or importing it`)
  }
})

test('Batch 8: chat delete dialog reflects in-flight state accessibly', async () => {
  const s = await read('components/AIChatbot.jsx')
  const modal = s.slice(s.indexOf('const ChatConfirmModal'), s.indexOf('const EmptyHistoryIcon'))
  assert.match(modal, /busy = false/)
  assert.equal((modal.match(/disabled=\{busy\}/g) || []).length, 2, 'both dialog buttons must lock while deleting')
  assert.match(modal, /role="alertdialog"/)
  assert.match(modal, /aria-modal="true"/)
  assert.match(s, /busy=\{deleting\}/)
})

test('Batch 8: chatbot sends only through ChatContext and stays separate from agent messaging', async () => {
  const s = await read('components/AIChatbot.jsx')
  assert.match(s, /useChat\(\)/)
  assert.match(s, /await sendMessage\(pageKey, text\)/)
  assert.equal(/\bfetch\(|axios|\bapi\.|from '\.\.\/lib\/api'/.test(s), false, 'the widget talks to the network directly')
  for (const banned of ['PropertyConversation', 'PropertyMessage', 'propertyMessagingApi', 'socket', 'useRealtime']) {
    assert.equal(s.includes(banned), false, `AIChatbot references ${banned}`)
  }
})

test('Batch 8: chatbot remains logged-in only', async () => {
  const s = await read('components/AIChatbot.jsx')
  assert.match(s, /if \(!userIsLoggedIn \|\| !chatbotAllowed\) \{\s*return null/)
  assert.equal((s.match(/if \(!userIsLoggedIn \|\| !chatbotAllowed\) return/g) || []).length, 2, 'welcome effects must not seed chats for guests')
})

test('Batch 8: Show More context reaches the backend', async () => {
  const s = await read('contexts/ChatContext.jsx')
  const start = s.indexOf("api.post('/chat', {")
  assert.ok(start > -1)
  const payload = s.slice(start, s.indexOf('})', start))
  for (const key of ['message: messageText', 'pageKey: key', 'history: historyForBackend', 'currentFilters', 'shownPropertyIds', 'lastShownProperties', 'conversationId: requestConversationId', 'language']) {
    assert.ok(payload.includes(key), `POST /chat payload lost ${key}`)
  }
  assert.match(s, /const shownPropertyIds = getShownPropertyIds\(previousMessages\)/)
  assert.match(s, /if \(conversationGenerationRef\.current !== requestGeneration\)/)
})

test('Batch 8: chatbot direction and date locale cover all six languages', async () => {
  const s = await read('components/AIChatbot.jsx')
  const language = await read('contexts/LanguageContext.jsx')
  assert.match(s, /const RTL_LANGUAGES = \['ar', 'ur'\]/)
  assert.match(language, /\['ar', 'ur'\]\.includes\(language\) \? 'rtl' : 'ltr'/)
  assert.match(s, /const isRTL = RTL_LANGUAGES\.includes\(language\)/)
  const map = s.match(/const LOCALE_MAP = \{([^}]*)\}/)
  assert.ok(map)
  for (const lang of LANGS) assert.match(map[1], new RegExp(`\\b${lang}: '`), `LOCALE_MAP lacks ${lang}`)
})

test('Batch 8: every chatbot string the widget reads exists in all six languages', async () => {
  const s = await read('components/AIChatbot.jsx')
  const keys = new Set([...s.matchAll(/\bc\.(\w+)(?:\?\.(\w+))?/g)].filter((m) => m[1] !== 'pages').map((m) => (m[2] ? `${m[1]}.${m[2]}` : m[1])))
  assert.ok(keys.size > 30)
  for (const lang of LANGS) {
    const c = translations[lang].chatbot
    for (const key of keys) {
      const value = key.split('.').reduce((a, k) => a?.[k], c)
      assert.ok(typeof value === 'string' && value.trim(), `${lang}.chatbot.${key} missing`)
    }
    for (const page of ['default', 'sale', 'rent', 'architecture', 'construction', 'renovation', 'interiorDesign', 'contact']) {
      assert.ok(typeof c.pages?.[page]?.welcome === 'string' && Array.isArray(c.pages[page].quickQuestions), `${lang}.chatbot.pages.${page}`)
    }
  }
})

test('Batch 8: theme-aware fills and styled scrollbars', async () => {
  const chat = await read('components/AIChatbot.jsx')
  assert.equal(/\bC\.green\b/.test(chat), false, 'pale --vk-green is used under light text again')
  assert.ok((chat.match(/C\.accent/g) || []).length >= 4)
  for (const cls of [
    'className="vk-scroll-gold flex-1 overflow-y-auto overflow-x-hidden"',
    'className="vk-scroll-gold flex-1 space-y-4 overflow-y-auto px-4 py-5"',
    'className="vk-scroll-gold flex gap-2 overflow-x-auto pb-1"',
  ]) assert.ok(chat.includes(cls), `chat scroll container lost vk-scroll-gold: ${cls}`)

  const details = await read('pages/PropertyDetailsPage.jsx')
  assert.ok(details.includes('<div className="min-h-screen pb-16" style={{ backgroundColor: C.softWhite }}>'))
  assert.ok(details.includes('<div className="pt-24 pb-8" style={{ backgroundColor: C.charcoal }}>'))
  assert.equal(details.includes('bg-[#202a36] pt-24'), false)
  assert.equal(details.includes('text-white md:text-4xl'), false)
  assert.ok(details.includes('vk-scroll-gold mt-3 flex gap-3 overflow-x-auto pb-2'))
})

test('Batch 8: approximate location can never reach the map', async () => {
  const s = await read('pages/PropertyDetailsPage.jsx')
  const approxAt = s.indexOf('{isApproximateLocation(property) ? (')
  const mapAt = s.indexOf(') : isPubliclyMappable(property) ? (')
  const singleAt = s.indexOf('<SinglePropertyMap')
  assert.ok(approxAt > -1 && mapAt > approxAt && singleAt > mapAt, 'approximate branch must win before the map branch')
  assert.equal((s.match(/<SinglePropertyMap/g) || []).length, 1)
  assert.equal(/location\?\.lat\s*&&/.test(s), false, 'donor lat-truthy map gate returned')
  for (const banned of ['minLat', 'maxLat', 'minLng', 'maxLng', 'hasVideo', 'GeoCoordinates', 'latitude', 'https://schema.org']) {
    assert.equal(s.includes(banned), false, `PropertyDetailsPage contains ${banned}`)
  }
  assert.match(s, /buildPropertyJsonLd\(seoProperty, id\)/)
  const map = await read('components/PropertyMapView.jsx')
  assert.match(map, /loc\?\.isApproximate !== true &&/)
})

test('Batch 8: Property.agent, favourites, tour and stale responses stay on CURRENT architecture', async () => {
  const s = await read('pages/PropertyDetailsPage.jsx')
  const agentAt = s.indexOf('{property.agent ? (')
  assert.ok(agentAt > -1 && agentAt < s.indexOf(') : property.agentName ? ('), 'assigned Property.agent must win over legacy agentName')
  assert.match(s, /property\.agent\.name/)
  assert.match(s, /const \{ isFavourite, toggleFavourite \} = useFavourites\(\)/)
  assert.equal(/api\.\w+\([`'"]\/users\/favourites/.test(s), false, 'page bypasses FavouritesContext')
  assert.match(s, /const safeTourUrl = /)
  assert.match(s, /url\.protocol !== 'https:'/)
  assert.match(s, /if \(!active\) return/)
})
