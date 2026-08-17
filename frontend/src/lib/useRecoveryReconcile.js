import { useEffect, useRef } from 'react'

/**
 * Runs `reconcile` once per reconnection, and never on the first connect.
 *
 * ── Why this is centralised ─────────────────────────────────────────────
 * Three places need to reconcile after a reconnect (the inbox, the open thread,
 * the sidebar badge) and each would otherwise hand-roll the same three details:
 * skip version 0, do not stack concurrent runs, and do not lose a signal that
 * arrived mid-run. Getting any of them wrong is invisible until a flaky network
 * produces a burst of duplicate requests.
 *
 * ── Reconnect storms ────────────────────────────────────────────────────
 * A bad connection produces connect/disconnect/connect/disconnect/connect in
 * seconds, so this can be called several times in a row. Rather than firing a
 * request per signal, an in-flight run absorbs later ones into a single pending
 * re-run — so N rapid reconnections cost at most two reconciliations, and the
 * last one always reflects the final state. No timers and no debounce: this is
 * driven purely by completion, so it cannot fire after the user has moved on.
 *
 * `reconcile` must be a stable useCallback and should swallow its own errors —
 * a failed reconciliation must leave the existing UI intact, never blank it.
 */
export const useRecoveryReconcile = (recoveryVersion, reconcile) => {
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    // 0 means "first connect": every screen has just loaded through REST, so
    // there is nothing to catch up on and reconciling would only duplicate work.
    if (!recoveryVersion) return undefined

    let cancelled = false

    const run = async () => {
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }

      inFlightRef.current = true
      try {
        await reconcile()
      } catch {
        // Deliberately ignored. Reconciliation is best-effort; the existing
        // state stays on screen and the next reconnect or refresh tries again.
      } finally {
        inFlightRef.current = false

        if (pendingRef.current && !cancelled) {
          pendingRef.current = false
          run()
        }
      }
    }

    run()

    return () => {
      // Stops a queued re-run from firing after unmount or logout.
      cancelled = true
      pendingRef.current = false
    }
  }, [recoveryVersion, reconcile])
}

export default useRecoveryReconcile
