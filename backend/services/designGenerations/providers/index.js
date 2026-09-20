// The provider boundary.
//
// Everything above this line — the worker, the routes, the lifecycle — knows
// only `editRoomImage(input) → { buffer, mimeType }` and `ProviderError`.
// Swapping or adding a provider means adding one adapter beside gemini.js and
// naming it in DESIGN_GENERATION_PROVIDER; nothing else changes.

import { DESIGN_GENERATION_PROVIDER } from '../../../config/designGenerations.js'
import * as gemini from './gemini.js'
import { ProviderError } from './providerError.js'

export { ProviderError }

const ADAPTERS = { [gemini.GEMINI_PROVIDER_NAME]: gemini }

const adapter = () => ADAPTERS[DESIGN_GENERATION_PROVIDER] ?? null

/** The configured provider's name, or 'none' when generation is switched off. */
export const providerName = () => (adapter() ? DESIGN_GENERATION_PROVIDER : 'none')

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
    throw new ProviderError('PROVIDER_FAILED', { detail: `no adapter for provider '${DESIGN_GENERATION_PROVIDER}'` })
  }
  return provider.editRoomImage(input)
}
