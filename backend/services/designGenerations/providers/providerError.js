// What a provider adapter is allowed to tell the rest of the system.
//
// A provider's own message, response body and stack never leave the adapter:
// they can echo the request (which includes a photograph of someone's home)
// and they are not stable enough to branch on. An adapter translates every
// outcome into one of the generation error codes the app already knows, plus
// whether trying again could plausibly help.

import { DESIGN_GENERATION_ERROR_CODES } from '../../../config/designGenerations.js'

export class ProviderError extends Error {
  /**
   * @param {string} code one of DESIGN_GENERATION_ERROR_CODES
   * @param {{ retryable?: boolean, detail?: string }} options `detail` is for
   *   server logs only and must never contain image data or prompt text.
   */
  constructor(code, { retryable = false, detail = '' } = {}) {
    if (!DESIGN_GENERATION_ERROR_CODES.includes(code)) {
      throw new Error(`Unknown generation error code: ${code}`)
    }
    super(detail || code)
    this.name = 'ProviderError'
    this.code = code
    this.retryable = retryable
  }
}
