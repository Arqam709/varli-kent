import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { createSocket } from '../lib/socket'

/**
 * ONE authenticated socket per running website session.
 *
 * ── Why a provider and not a socket per screen ──────────────────────────
 * AgentMessages and AgentConversationThread both want live updates, and the
 * thread is remounted (key={conversationId}) every time the agent picks a
 * different conversation. A socket owned by a screen would therefore be torn
 * down and rebuilt on every navigation — dropping events during the gap, and
 * disconnecting at exactly the moment the agent returns to the inbox and most
 * needs it to be current. Session-scoped, it survives all of that.
 *
 * ── Lifecycle ───────────────────────────────────────────────────────────
 * The socket follows authentication, and nothing else:
 *
 *   agent signs in    → token appears → connect
 *   agent signs out   → token clears  → disconnect and discard
 *   token changes     → old socket discarded, new one opened
 *
 * Because AuthContext clears `token` in logout(), disconnection needs no
 * cooperation from the logout path — it falls out of the dependency array.
 *
 * ── Why agents only ─────────────────────────────────────────────────────
 * Human customer↔agent messaging has no customer-facing surface on the
 * website; customers message from the mobile app. So a socket for a signed-in
 * customer browsing listings would be a connection nothing consumes. Admins and
 * owners are excluded for the same reason — the messaging API refuses them by
 * design (see services/propertyMessaging.js), so there is nothing to deliver.
 *
 * RT-0 registers no event listeners. This provider currently proves only that
 * an authenticated connection can be established and cleanly closed.
 */

const RealtimeContext = createContext(null)

export const RealtimeProvider = ({ children }) => {
  const { token, isAgent } = useAuth()

  const [isConnected, setIsConnected] = useState(false)

  // The live socket, kept in a ref because consumers must not re-render every
  // time its internal state changes — only `isConnected` is render-relevant.
  const socketRef = useRef(null)

  useEffect(() => {
    if (!token || !isAgent) {
      // Covers signed-out, signed-in-as-a-customer, and the moment after
      // logout. Nothing to connect, and any previous socket was already closed
      // by this effect's own cleanup.
      return undefined
    }

    const socket = createSocket(token)
    socketRef.current = socket

    const onConnect = () => {
      setIsConnected(true)
      if (import.meta.env.DEV) console.log('[realtime] connected')
    }

    const onDisconnect = (reason) => {
      setIsConnected(false)
      if (import.meta.env.DEV) console.log('[realtime] disconnected:', reason)
    }

    const onConnectError = (error) => {
      setIsConnected(false)
      // Expected and harmless when the Render free instance is asleep, or when
      // a token has expired. Never fatal: every screen still works over REST.
      if (import.meta.env.DEV) console.log('[realtime] connection error:', error.message)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      // disconnect() rather than close(): it also stops any reconnection timer,
      // so a logged-out session cannot quietly reconnect with a stale token.
      socket.disconnect()
      socketRef.current = null
      setIsConnected(false)
    }
  }, [token, isAgent])

  // socketRef.current is deliberately not a dependency — it is a ref, so a
  // change to it does not (and should not) re-render. Consumers that need the
  // socket read it at event-subscription time in RT-1.
  const value = useMemo(
    () => ({ socket: socketRef, isConnected }),
    [isConnected]
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

/**
 * Reads the realtime state.
 *
 * Returns null outside the provider rather than throwing, unlike useAuth. The
 * realtime layer is an enhancement: a component that renders fine without live
 * updates should not crash the page because it was mounted somewhere the
 * provider does not reach.
 */
export const useRealtime = () => useContext(RealtimeContext)

export default RealtimeContext
