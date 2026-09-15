import { useEffect, useState } from 'react'
import api from './api'
import { FALLBACK_CONTACT_INTERESTS, normalizeContactInterests } from './contactInterests.js'

/**
 * The contact interest options, from the backend's shared contract.
 *
 * Renders the bundled fallback IMMEDIATELY, then swaps in the server's list
 * when GET /api/contact/interests answers. The form therefore never waits on
 * the network for nine small options, and an unreachable endpoint looks exactly
 * like "nothing changed" rather than an empty select.
 *
 * A response that normalizes to nothing is ignored for the same reason: an
 * empty or malformed payload must never replace a working list.
 */
export default function useContactInterests() {
  const [interests, setInterests] = useState(FALLBACK_CONTACT_INTERESTS)

  useEffect(() => {
    let cancelled = false

    api.get('/contact/interests')
      .then((res) => {
        if (cancelled) return
        const next = normalizeContactInterests(res?.data)
        if (next.length > 0) setInterests(next)
      })
      .catch(() => {
        // Keep the bundled list. The form still submits values the backend
        // accepts, because the fallback is a verified copy of its contract.
      })

    return () => { cancelled = true }
  }, [])

  return interests
}
