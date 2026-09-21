// Which adapter the generation worker gets, and how it is chosen.
//
// The registry is what keeps the rest of the system provider-agnostic: the
// worker asks for `editRoomImage` and never learns which service answered.
// These tests pin that DESIGN_GENERATION_PROVIDER — and nothing else — decides.

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import * as providers from '../services/designGenerations/providers/index.js'
import * as cloudflare from '../services/designGenerations/providers/cloudflare.js'
import * as gemini from '../services/designGenerations/providers/gemini.js'
import { designGenerationProvider } from '../config/designGenerations.js'

const GEMINI_KEY = 'gemini-key-not-real'
const CF_ACCOUNT = 'abc123def456abc123def456abc12345'
const CF_TOKEN = 'cf-token-not-real-0000'

const clearCredentials = () => {
  delete process.env.GEMINI_API_KEY
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.CLOUDFLARE_API_TOKEN
}

beforeEach(() => {
  delete process.env.DESIGN_GENERATION_PROVIDER
  clearCredentials()
})

/* ── The default ───────────────────────────────────────────────────────── */

test('gemini is the default, so an unset variable changes nothing', () => {
  assert.equal(designGenerationProvider(), 'gemini')
  assert.equal(providers.providerName(), 'gemini')
})

/* ── Choosing a provider ───────────────────────────────────────────────── */

test('DESIGN_GENERATION_PROVIDER=gemini selects the Gemini adapter', () => {
  process.env.DESIGN_GENERATION_PROVIDER = 'gemini'
  assert.equal(providers.providerName(), 'gemini')

  // Readiness follows Gemini's credential, not Cloudflare's.
  process.env.CLOUDFLARE_ACCOUNT_ID = CF_ACCOUNT
  process.env.CLOUDFLARE_API_TOKEN = CF_TOKEN
  assert.equal(providers.isProviderConfigured(), false, 'Cloudflare credentials configured Gemini')

  process.env.GEMINI_API_KEY = GEMINI_KEY
  assert.equal(providers.isProviderConfigured(), true)
  assert.equal(gemini.isConfigured(), true)
})

test('DESIGN_GENERATION_PROVIDER=cloudflare selects the Cloudflare adapter', () => {
  process.env.DESIGN_GENERATION_PROVIDER = 'cloudflare'
  assert.equal(providers.providerName(), 'cloudflare')

  // Readiness follows Cloudflare's credentials, not Gemini's.
  process.env.GEMINI_API_KEY = GEMINI_KEY
  assert.equal(providers.isProviderConfigured(), false, 'a Gemini key configured Cloudflare')

  process.env.CLOUDFLARE_ACCOUNT_ID = CF_ACCOUNT
  process.env.CLOUDFLARE_API_TOKEN = CF_TOKEN
  assert.equal(providers.isProviderConfigured(), true)
  assert.equal(cloudflare.isConfigured(), true)
})

test('the name is matched case-insensitively', () => {
  process.env.DESIGN_GENERATION_PROVIDER = 'CloudFlare'
  assert.equal(providers.providerName(), 'cloudflare')
})

test('the selection is read per call, so it is never a stale import-time value', () => {
  process.env.DESIGN_GENERATION_PROVIDER = 'gemini'
  assert.equal(providers.providerName(), 'gemini')

  process.env.DESIGN_GENERATION_PROVIDER = 'cloudflare'
  assert.equal(providers.providerName(), 'cloudflare', 'the provider was captured at import time')
})

/* ── Switching off, and mistakes ───────────────────────────────────────── */

test("'none' and an unknown name leave no adapter, and the worker stays idle", async () => {
  for (const name of ['none', 'stability', '']) {
    process.env.DESIGN_GENERATION_PROVIDER = name
    // '' falls back to the default; the others must not resolve to an adapter.
    if (name === '') {
      assert.equal(providers.providerName(), 'gemini')
      continue
    }

    assert.equal(providers.providerName(), 'none')
    assert.equal(providers.isProviderConfigured(), false)

    await assert.rejects(
      providers.editRoomImage({ imageBuffer: Buffer.from([1]), prompt: 'x' }),
      (error) => {
        assert.ok(error instanceof providers.ProviderError)
        assert.equal(error.code, 'PROVIDER_FAILED')
        assert.equal(error.retryable, false)
        return true
      }
    )
  }
})

/* ── Both adapters honour one contract ─────────────────────────────────── */

test('every registered adapter exposes the same two functions', () => {
  for (const adapter of [gemini, cloudflare]) {
    assert.equal(typeof adapter.isConfigured, 'function')
    assert.equal(typeof adapter.editRoomImage, 'function')
    // The registry keys off this name.
    assert.equal(typeof (adapter.GEMINI_PROVIDER_NAME ?? adapter.CLOUDFLARE_PROVIDER_NAME), 'string')
  }
})

test('an unconfigured provider reports so rather than throwing', () => {
  for (const name of ['gemini', 'cloudflare']) {
    process.env.DESIGN_GENERATION_PROVIDER = name
    assert.equal(providers.isProviderConfigured(), false)
  }
})
