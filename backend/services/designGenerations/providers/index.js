// The provider boundary.
//
// Everything above this line — the worker, the routes, the lifecycle — knows
// only `editRoomImage(input) → { buffer, mimeType }` and `ProviderError`.
// Swapping or adding a provider means adding one adapter beside gemini.js and
// naming it in DESIGN_GENERATION_PROVIDER; nothing else changes.
//
// An adapter is two functions: `isConfigured()`, so the worker can stay idle
// rather than claim work it could never finish, and `editRoomImage()`, which
// either returns image bytes or throws a ProviderError. Everything specific to
// one provider — its credentials, its wire format, its size limits, how it
// wants the source image prepared — stays inside that adapter.

import { designGenerationProvider } from '../../../config/designGenerations.js'
import * as cloudflare from './cloudflare.js'
import * as gemini from './gemini.js'
import { ProviderError } from './providerError.js'

export { ProviderError }

const ADAPTERS = {
  [gemini.GEMINI_PROVIDER_NAME]: gemini,
  [cloudflare.CLOUDFLARE_PROVIDER_NAME]: cloudflare,
}

const adapter = () => ADAPTERS[designGenerationProvider()] ?? null

/** The configured provider's name, or 'none' when generation is switched off. */
export const providerName = () => (adapter() ? designGenerationProvider() : 'none')

/**
 * Whether a real generation could run right now: an adapter exists and its
 * credentials are present. The worker stays idle when this is false rather
 * than claiming jobs it cannot finish.
 */
export const isProviderConfigured = () => Boolean(adapter()?.isConfigured())

/**
 * Generates one redesigned room image.
 * @throws {ProviderError}
 */
export async function editRoomImage(input) {
  const provider = adapter()
  if (!provider) {
    throw new ProviderError('PROVIDER_FAILED', { detail: `no adapter for provider '${designGenerationProvider()}'` })
  }
  return provider.editRoomImage(input)
}
