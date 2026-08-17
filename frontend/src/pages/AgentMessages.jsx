import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AgentLayout from '../components/AgentLayout'
import AgentConversationThread from '../components/AgentConversationThread'
import { useAuth } from '../contexts/AuthContext'
import { useRealtime } from '../contexts/RealtimeContext'
import { formatConversationTime } from '../lib/formatMessageTime'
import { applyMessageEventToConversations } from '../lib/applyMessageEventToConversations'
import {
  PROPERTY_MESSAGE_NEW_EVENT,
  getPropertyConversations,
  previewOf,
} from '../lib/propertyMessagingApi'
import { useRecoveryReconcile } from '../lib/useRecoveryReconcile'

/**
 * Agent Messages — the website half of customer↔agent property enquiries.
 *
 * ── One page, two routes ────────────────────────────────────────────────
 * /agent/messages and /agent/messages/:id both render this. On desktop the
 * list and the open thread sit side by side and the URL simply says which
 * thread; below `lg` only one pane is visible at a time, so the same URL reads
 * as "inbox" or "thread". Two panes driven by one route is considerably less
 * to maintain than two separate screens that must stay in step, and it keeps
 * every thread deep-linkable.
 *
 * These are NOT admin messages, and the API behind them is the same
 * participant API the mobile customer app uses — see lib/propertyMessagingApi.
 */

const ChatEmptyIcon = () => (
  <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
)

const AlertIcon = () => (
  <svg className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)

const initialsOf = (name) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'C'

const Avatar = ({ name, avatar }) =>
  avatar ? (
    <img src={avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#202a36] text-sm font-bold text-white">
      {initialsOf(name)}
    </div>
  )

/**
 * One inbox row.
 *
 * `counterparty` is the customer — the backend has already worked out which of
 * the two participants is "the other one" for the caller. The participant
 * serializer returns name and avatar only; there is no email or phone here
 * because the API intentionally does not expose them on this surface.
 */
const ConversationRow = ({ conversation, isSelected, onSelect }) => {
  const customer = conversation.counterparty
  const unread = conversation.unreadCount || 0

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation._id)}
      aria-current={isSelected ? 'true' : undefined}
      className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition ${
        isSelected ? 'bg-[#4b6741]/10' : 'hover:bg-slate-50'
      }`}
    >
      <Avatar name={customer?.name} avatar={customer?.avatar} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-[#202a36]">{customer?.name || 'Customer'}</p>
          <span className="shrink-0 text-[11px] text-slate-400">
            {formatConversationTime(conversation.lastActivityAt)}
          </span>
        </div>

        <p className="truncate text-xs text-slate-500">
          {conversation.property?.title || 'Listing no longer available'}
        </p>

        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-600">
            {conversation.lastMessage?.text || 'No messages yet'}
          </p>
          {unread > 0 && (
            <span
              aria-label={`${unread} unread`}
              className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#4b6741] px-1.5 text-[11px] font-bold text-white"
            >
              {unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

const AgentMessages = () => {
  const { id: selectedId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const realtime = useRealtime()

  const [conversations, setConversations] = useState([])
  const [status, setStatus] = useState('loading') // loading | success | error

  // Generation counter, the convention AdminUserChats already uses: a slower
  // superseded request can never overwrite a faster, more recent one.
  const requestRef = useRef(0)

  /**
   * In-flight guard for the unknown-conversation refetch, so a burst of events
   * for conversations this inbox has not loaded collapses into one GET rather
   * than one per message.
   */
  const unknownRefetchRef = useRef(false)

  /**
   * Counts socket events this page has processed.
   *
   * Used to detect the reconnect race the hard way round: a reconciliation GET
   * is a SNAPSHOT taken when the request left, so if a live event lands while it
   * is in flight, applying the response would revert that row's preview, its
   * position and its unread count. Comparing this counter before and after tells
   * us the snapshot is stale, and we ask again rather than apply it.
   */
  const eventSeqRef = useRef(0)

  /**
   * `selectedId` read through a ref as well as directly.
   *
   * The socket handler below must know which conversation is open WITHOUT
   * having selectedId in its dependency array — otherwise selecting a
   * conversation would tear down and rebuild the subscription on every
   * navigation, and an event landing in that gap would be missed.
   */
  const selectedIdRef = useRef(selectedId)

  // Synced in an effect, not during render: writing a ref while rendering is a
  // React rules violation that misbehaves under concurrent rendering. An effect
  // runs after commit, which is comfortably before any socket event — those
  // arrive asynchronously, never mid-render.
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const load = useCallback(() => {
    const requestId = ++requestRef.current

    getPropertyConversations()
      .then((list) => {
        if (requestId !== requestRef.current) return
        setConversations(list)
        setStatus('success')
      })
      .catch(() => {
        if (requestId !== requestRef.current) return
        setStatus('error')
      })
  }, [])

  // Loads once per visit to the section. Deliberately not polled — this phase
  // is REST-only, and a customer's reply appears when the agent refreshes.
  // `status` already starts at 'loading', so the effect itself sets no state.
  useEffect(() => {
    load()
  }, [load])

  const handleRetry = () => {
    setStatus('loading')
    load()
  }

  /*
   * Live inbox updates.
   *
   * This listener owns the CONVERSATION LIST only. AgentConversationThread
   * subscribes to the same event for the open thread's message bubbles — two
   * components, two pieces of state, one event. That is why each removes only
   * its own handler on cleanup and nothing here ever calls removeAllListeners,
   * which would silently kill the thread's subscription.
   *
   * Keyed on `isConnected` so a page that mounts before the handshake finishes
   * still subscribes once the socket comes up.
   */
  useEffect(() => {
    const socket = realtime?.socket?.current
    if (!socket) return undefined

    const handleNewMessage = (payload) => {
      if (!payload?.conversationId) return

      // Marks this page as having newer knowledge than any reconciliation
      // request already in flight.
      eventSeqRef.current += 1

      setConversations((prev) => {
        const { conversations: next, unknown } = applyMessageEventToConversations(prev, payload, {
          currentUserId: user?._id,
          // Read from a ref so switching conversations does not resubscribe.
          // A message landing in the conversation the agent is currently
          // reading must not raise a badge — the thread has already PATCHed it
          // read, so a count here would contradict what they are looking at.
          activeConversationId: selectedIdRef.current,
        })

        if (unknown) {
          /*
           * A conversation this inbox has never seen — the first-message case.
           * A thread stays hidden from the inbox until someone actually speaks,
           * so the customer's opening message is the moment the row should
           * appear.
           *
           * Refetched rather than invented: the event deliberately carries no
           * customer name, property title or image, and a placeholder row would
           * put fake text on screen. GET /property-conversations is already
           * authorized and returns the safe summary — and because it applies
           * the server's own inbox scope, a row can only appear if the agent is
           * genuinely entitled to it.
           */
          if (!unknownRefetchRef.current) {
            unknownRefetchRef.current = true
            getPropertyConversations()
              .then((list) => {
                if (requestRef.current === 0) return
                setConversations(list)
              })
              .catch(() => {})
              .finally(() => {
                unknownRefetchRef.current = false
              })
          }
          return prev
        }

        return next
      })
    }

    socket.on(PROPERTY_MESSAGE_NEW_EVENT, handleNewMessage)

    return () => {
      socket.off(PROPERTY_MESSAGE_NEW_EVENT, handleNewMessage)
    }
  }, [realtime, realtime?.isConnected, user?._id])

  /*
   * Reconcile the inbox after a reconnect.
   *
   * This repairs everything that happened while the socket was away — missed
   * previews, row ordering, unread counts, conversations whose first message
   * arrived offline, and (through the server's own inbox scope) conversations
   * this agent no longer has access to because a listing was reassigned.
   *
   * SILENT by design: `status` is left alone, so the existing rows stay visible
   * and there is no loading flash. A failure leaves the current list untouched
   * rather than blanking usable data.
   */
  const reconcileInbox = useCallback(async () => {
    // Two attempts, then accept. The retry exists for the narrow case where a
    // live event lands mid-request; looping indefinitely under a steady stream
    // of messages would be worse than applying a snapshot that is one message
    // behind, which the next event corrects anyway.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const seqBefore = eventSeqRef.current
      const requestId = ++requestRef.current

      let list
      try {
        list = await getPropertyConversations()
      } catch {
        return // Keep what is on screen.
      }

      // A newer request (or a retry / manual reload) superseded this one.
      if (requestId !== requestRef.current) return

      // A socket event arrived while this was in flight, so the response is a
      // stale snapshot. Ask again rather than reverting the live update.
      if (eventSeqRef.current !== seqBefore && attempt === 0) continue

      setConversations(list)
      setStatus('success')
      return
    }
  }, [])

  useRecoveryReconcile(realtime?.recoveryVersion ?? 0, reconcileInbox)

  // The sidebar badge re-reads itself when AgentLayout mounts, which every
  // navigation into this section already does — so nothing extra is needed
  // here to keep it in step on arrival.

  const handleSelect = (conversationId) => navigate(`/agent/messages/${conversationId}`)
  const handleBack = () => navigate('/agent/messages')

  /** The thread cleared its own unread counter; mirror that on the row. */
  const handleRead = useCallback((conversationId) => {
    setConversations((prev) =>
      prev.map((c) => (c._id === conversationId ? { ...c, unreadCount: 0 } : c))
    )
  }, [])

  /**
   * Keep the row's preview and position honest after the agent replies,
   * without re-fetching the whole inbox. Mirrors what the backend just wrote:
   * lastMessage + lastActivityAt, then the same lastActivityAt-descending
   * order the API returns.
   */
  const handleMessageSent = useCallback((conversationId, message) => {
    setConversations((prev) =>
      prev
        .map((c) =>
          c._id === conversationId
            ? {
                ...c,
                lastMessage: {
                  text: previewOf(message.text),
                  sender: message.sender,
                  at: message.createdAt,
                },
                lastActivityAt: message.createdAt,
              }
            : c
        )
        .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt))
    )
  }, [])

  const paneCls = 'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'

  return (
    <AgentLayout>
      <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
        <div className="shrink-0">
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">
            Messages
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Customer enquiries about the listings assigned to you.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[340px_1fr]">
          {/* Conversations. Hidden below `lg` while a thread is open, so the
              thread gets the full width of a phone browser. */}
          <div className={`${selectedId ? 'hidden lg:flex' : 'flex'} ${paneCls}`}>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {status === 'loading' && (
                <div className="flex justify-center py-16">
                  <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
                </div>
              )}

              {status === 'error' && (
                <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                  <AlertIcon />
                  <p className="text-sm text-slate-500">Could not load your messages.</p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="cursor-pointer rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3d5535]"
                  >
                    Retry
                  </button>
                </div>
              )}

              {status === 'success' &&
                (conversations.length === 0 ? (
                  // A quiet inbox is normal, not a failure — say so rather than
                  // leaving a blank panel that looks broken.
                  <div className="m-4 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                    <p className="font-semibold text-slate-700">No messages yet</p>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">
                      Customer inquiries about your assigned properties will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {conversations.map((conversation) => (
                      <ConversationRow
                        key={conversation._id}
                        conversation={conversation}
                        isSelected={conversation._id === selectedId}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ))}
            </div>
          </div>

          {/* Thread. `key` forces a remount per conversation so none of the
              thread's per-conversation state (messages, cursor, draft, scroll
              intent) can leak from one into the next. */}
          <div className={`${selectedId ? 'flex' : 'hidden lg:flex'} ${paneCls}`}>
            {selectedId ? (
              <AgentConversationThread
                key={selectedId}
                conversationId={selectedId}
                onBack={handleBack}
                onRead={handleRead}
                onMessageSent={handleMessageSent}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <ChatEmptyIcon />
                <p className="text-lg font-semibold text-slate-600">Select a conversation</p>
                <p className="max-w-xs text-sm text-slate-400">
                  Choose a customer from the list to read their enquiry and reply.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AgentLayout>
  )
}

export default AgentMessages
