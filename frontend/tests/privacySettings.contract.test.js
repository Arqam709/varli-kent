import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { env } from 'node:process'
import translations from '../src/locales/translations.js'

const read = async path => {
  let source = await readFile(new URL('../src/' + path, import.meta.url), 'utf8')
  if (env.BATCH5_MUTATION === 'unprotect-settings' && path === 'App.jsx') source = source.replace('<ProtectedRoute><SettingsPage /></ProtectedRoute>', '<SettingsPage />')
  if (env.BATCH5_MUTATION === 'duplicate-storage' && path === 'pages/SettingsPage.jsx') source += "\nlocalStorage.setItem('privacy-preference', '1')"
  if (env.BATCH5_MUTATION === 'remove-rtl' && path === 'contexts/LanguageContext.jsx') source = source.replace("['ar', 'ur']", "['ar']")
  return source
}

test('Batch 5: all six languages provide every settings label actually used', async () => {
  const source = await read('pages/SettingsPage.jsx')
  const keys = [...new Set([...source.matchAll(/\bs\.(\w+)/g)].map(m => m[1]))]
  assert.ok(keys.length > 40)
  for (const language of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    const labels = translations[language].settingsPage
    for (const key of keys) assert.ok(typeof labels?.[key] === 'string' && labels[key].trim(), language + '.' + key)
  }
})

test('Batch 5: real settings route remains protected and guard remains fail closed', async () => {
  assert.match(await read('App.jsx'), /path="\/settings" element=\{<ProtectedRoute><SettingsPage \/><\/ProtectedRoute>\}/)
  const guard = await read('components/ProtectedRoute.jsx')
  assert.match(guard, /if \(!isLoggedIn\) return <Navigate to="\/login"/)
  assert.match(guard, /if \(!ROLE_GUARDS\[requiredRole\]\)/)
})

test('Batch 5: settings retains context-owned preferences and AI history APIs', async () => {
  const source = await read('pages/SettingsPage.jsx')
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/)
  for (const hook of ['useTheme()', 'useLanguage()', 'useAuth()', 'useChat()']) assert.ok(source.includes(hook))
  for (const member of ['loadConversations', 'loadConversation', 'deleteConversation', 'deleteAllConversations', 'conversationsPagination']) assert.ok(source.includes(member))
  assert.doesNotMatch(source, /api\.get\(['"`]\/chat\/conversations/)
  assert.ok(source.includes('to: portal.to'))
})

test('Batch 5: Arabic and Urdu continue to use canonical RTL state', async () => {
  const source = await read('contexts/LanguageContext.jsx')
  assert.match(source, /\['ar', 'ur'\]\.includes\(language\) \? 'rtl' : 'ltr'/)
  assert.match(source, /localStorage\.setItem\('vk_lang', language\)/)
})

test('Batch 5: no fake self-deletion or notification/consent switches are introduced', async () => {
  const settings = await read('pages/SettingsPage.jsx')
  assert.doesNotMatch(settings, /showDeleteConfirm|deleteWord|s\.permanentlyDelete|type="checkbox"|role="switch"/)
  assert.match(settings, /<Section title=\{s.accountRemovalTitle\} description=\{s.accountRemovalDesc\}>[\s\S]*?<Link to="\/contact"/)
  const privacy = await read('components/PrivacyBanner.jsx')
  assert.match(privacy, /const STORAGE_KEY = 'vk_privacy_ack'/)
  assert.doesNotMatch(privacy, /type="checkbox"|role="switch"|api\./)
})
