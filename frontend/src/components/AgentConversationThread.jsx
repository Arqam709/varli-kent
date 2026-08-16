import { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../contexts/AuthContext'
import { useRealtime } from '../contexts/RealtimeContext'
import { formatPrice } from '../lib/formatPrice'
import { formatMessageTime, formatDayDivider } from '../lib/formatMessageTime'
import {
  MAX_MESSAGE_LENGTH,
  PROPERTY_MESSAGE_NEW_EVENT,
  getPropertyConversation,
  getPropertyMessages,
  sendPropertyMessage,
  markPropertyConversationRead,
  notifyHumanUnreadChanged,
  isUnavailable,
  readableError,
} from '../lib/propertyMessagingApi'

/**
 * One customer↔agent thread, from the agent's side.
 *
 * The counterparty here is the CUSTOMER — the agent already knows who they
 * are, so their own name appears nowhere in this header.
 *
 * Mount this with `key={conversationId}` so switching threads remounts rather
 * than trying to reconcile ten pieces of per-thread state.
 */

const BackIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)

const SendIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
)

const AlertIcon = () => (
  <svg className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)

const Spinner = () => (
  <div className="flex flex-1 items-center justify-center py-12">
    <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
  </div>
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
    <img src={avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#202a36] text-sm font-bold text-white">
      {initialsOf(name)}
    </div>
  )

/**
 * The listing this enquiry is about.
 *
 * `property` is null when the listing has been hard-deleted — the backend
 * serializer tolerates that on purpose so old threads stay readable, and so
 * must this.
 */
const PropertyContextCard = ({ property }) => {
  if (!property) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-500">Listing no longer available</p>
        <p className="mt-0.5 text-xs text-slate-400">
          This property has been removed, but the conversation history is kept.
        </p>
      </div>
    )
  }

  const image = property.mainImage || ''

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {image && (
        <img src={image} alt="" className="h-14 w-16 shrink-0 rounded-lg object-cover" loading="lazy" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#202a36]">{property.title}</p>
        <p className="truncate text-xs text-slate-500">
          {[property.district, property.listingType === 'Rent' ? 'For Rent' : 'For Sale']
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p style={{ fontFamily: 'Cinzel, serif' }} className="mt-0.5 text-sm font-bold text-[#d97706]">
          {formatPrice(property.price, property.listingType, property.priceLabel)}
        </p>
      </div>
      {/* The public listing page — the agent sees exactly what the customer
          is looking at while asking about it. */}
      <Link
        to={`/properties/${property._id}`}
        className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        View Property
      </Link>
    </div>
  )
}

const MessageBubble = ({ message, isMine }) => (
  <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
    <div
      className={`max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[70%] ${
        isMine ? 'bg-[#4b6741] text-white' : 'bg-slate-100 text-slate-800'
      }`}
    >
      <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
      <p className={`mt-1 text-[11px] ${isMine ? 'text-right text-white/70' : 'text-slate-400'}`}>
        {formatMessageTime(message.createdAt)}
      </p>
    </div>
  </div>
)

/** Chronological messages, with a divider wherever the calendar day changes. */
const buildThreadItems = (messages) => {
  const items = []
  let lastDayKey = null

  messages.forEach((message) => {
    const dayKey = new Date(message.createdAt).toDateString()
    if (dayKey !== lastDayKey) {
      items.push({ type: 'divider', key: `day-${message._id}`, label: formatDayDivider(message.createdAt) })
      lastDayKey = dayKey
    }
    items.push({ type: 'message', key: message._id, message })
  })

  return items
}

const UnavailableState = ({ onBack }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <AlertIcon />
    <p className="text-lg font-semibold text-slate-700">This conversation is no longer available</p>
    <p className="max-w-sm text-sm text-slate-500">
      It may have been reassigned to another agent, or it was never yours to open.
    </p>
    {onBack && (
      <button
        type="button"
        onClick={onBack}
        className="mt-2 cursor-pointer rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3d5535]"
      >
        Back to messages
      </button>
    )}
  </div>
)

const AgentConversationThread = ({ conversationId, onBack, onRead, onMessageSent }) => {
  const { user } = useAuth()
  const realtime = useRealtime()
  const currentUserId = user?._id ? String(user._id) : null

  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error | unavailable

  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  const scrollRef = useRef(null)
  const textareaRef = useRef(null)

  // Scroll intents, resolved once in the layout effect below. Refs rather than
  // state because they must not themselves trigger a render.
  const scrollToBottomRef = useRef(true)
  const restoreHeightRef = useRef(null)

  // One mark-read per opened thread. Without this, a parent re-render that
  // hands down a fresh `onRead` identity would fire the PATCH again.
  const markedReadRef = useRef(false)

  // Generation counter, as used in AdminUserChats: a superseded request can
  // never overwrite a more recent one.
  const requestRef = useRef(0)

  const load = useCallback(() => {
    const requestId = ++requestRef.current

    // Header and first page in parallel — neither depends on the other, and
    // the thread is useless without both.
    Promise.all([getPropertyConversation(conversationId), getPropertyMessages(conversationId)])
      .then(([detail, page]) => {
        if (requestId !== requestRef.current) return
        setConversation(detail)
        setMessages(page.messages)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
        scrollToBottomRef.current = true
        setStatus('ready')
      })
      .catch((err) => {
        if (requestId !== requestRef.current) return
        // 404 is the backend's single answer to "no such thread", "not yours"
        // and "not yours any more" — deliberately indistinguishable, so this
        // renders one honest state for all three.
        setStatus(isUnavailable(err) ? 'unavailable' : 'error')
      })
  }, [conversationId])

  // `status` already starts at 'loading', and this component is mounted with
  // key={conversationId}, so the effect itself never has to set state.
  useEffect(() => {
    load()
  }, [load])

  const handleRetry = () => {
    setStatus('loading')
    load()
  }

  /*
   * Mark read once the agent has actually been shown the thread.
   *
   * Which side is cleared is decided by the backend from req.user; no
   * participant id is sent. A failure is swallowed on purpose — an unread
   * badge that lingers is a far smaller problem than a thread that refuses to
   * open because a counter write failed.
   */
  useEffect(() => {
    if (status !== 'ready' || !conversation) return
    if (!conversation.unreadCount || markedReadRef.current) return

    markedReadRef.current = true

    markPropertyConversationRead(conversationId)
      .then(() => {
        setConversation((prev) => (prev ? { ...prev, unreadCount: 0 } : prev))
        onRead?.(conversationId)
        notifyHumanUnreadChanged()
      })
      .catch(() => {})
  }, [status, conversationId, conversation, onRead])

  /*
   * Live messages for THIS thread.
   *
   * The socket is a notification channel only — nothing is ever sent through
   * it. Sending still goes through POST /:id/messages exactly as before, and
   * this component works completely without a socket: if the connection is
   * down, the thread behaves the way it did before RT-1 and the agent sees new
   * messages on their next refresh.
   *
   * ── Why the socket is read inside the effect ────────────────────────────
   * RealtimeProvider stores the socket in a REF, which by design does not
   * trigger a render when it changes. `isConnected` is the state that does, so
   * it drives this effect: when the socket finishes connecting the effect
   * re-runs and subscribes. That matters because a thread can easily mount
   * before the handshake completes — reading socketRef.current once during the
   * first render would silently subscribe to nothing.
   *
   * The socket instance is captured in a local const so cleanup calls .off() on
   * exactly the object and handler it called .on() with, even if the ref has
   * since been repointed or nulled by a logout.
   *
   * Gated on status === 'ready' so an event cannot append to a message list
   * that the initial fetch is about to replace wholesale.
   */
  useEffect(() => {
    const socket = realtime?.socket?.current
    if (!socket || status !== 'ready') return undefined

    const handleNewMessage = (payload) => {
      // Defensive: one event serves every conversation this agent is part of,
      // so a mismatched or malformed payload is expected traffic, not an error.
      if (!payload || payload.conversationId !== conversationId) return

      const incoming = payload.message
      if (!incoming?._id) return

      /*
       * Decide the scroll intent BEFORE the list changes.
       *
       * Only follow the conversation down if the agent is already reading at
       * the bottom. Someone scrolled up through history must not be yanked to
       * the end because a message arrived — that is the classic chat bug. This
       * reuses the existing one-shot scrollToBottomRef mechanism rather than
       * introducing a second way to scroll.
       */
      const el = scrollRef.current
      const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120
      if (nearBottom) scrollToBottomRef.current = true

      setMessages((prev) =>
        // Dedupe by server id. The sender receives BOTH the REST response and
        // this event, and either can arrive first — comparing on `_id` makes
        // the order irrelevant and needs no optimistic-message reconciliation.
        // Same idiom the older-messages pagination above already uses.
        prev.some((m) => String(m._id) === String(incoming._id)) ? prev : [...prev, incoming]
      )

      /*
       * The agent is looking at this exact thread, so they have now genuinely
       * read it — but the server incremented agentUnreadCount when it stored
       * the message. Clear it through the EXISTING REST route.
       *
       * Only for the OTHER participant's messages: the agent also receives
       * their own sends back on this event (that is what keeps a second tab in
       * step), and marking read because of your own message would be a pointless
       * write. The endpoint is idempotent ($set to 0, never a decrement), so
       * a burst of messages costs a few harmless repeat calls rather than
       * needing new read-state machinery.
       *
       * This clears only the AGENT'S OWN counter. Nothing is emitted to the
       * customer — RT-1 has no read receipts.
       */
      if (currentUserId && String(incoming.sender) !== currentUserId) {
        markPropertyConversationRead(conversationId).catch(() => {})
      }
    }

    socket.on(PROPERTY_MESSAGE_NEW_EVENT, handleNewMessage)

    return () => {
      // Same instance, same function reference — so switching conversations
      // cannot leave a previous thread's handler behind and run one event twice.
      socket.off(PROPERTY_MESSAGE_NEW_EVENT, handleNewMessage)
    }
  }, [realtime, realtime?.isConnected, conversationId, currentUserId, status])

  /*
   * The ONLY place scrolling happens.
   *
   * Binding "scroll to bottom" to every content change is the classic bug that
   * yanks a reader back down the moment older messages arrive, so each intent
   * is set explicitly by whoever caused it and consumed exactly once here.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return

    if (restoreHeightRef.current !== null) {
      // Older messages were prepended: keep the message under the reader's eye
      // where it was, by absorbing exactly the height that appeared above it.
      el.scrollTop += el.scrollHeight - restoreHeightRef.current
      restoreHeightRef.current = null
      return
    }

    if (scrollToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      scrollToBottomRef.current = false
    }
  }, [messages])

  // Grow the composer with the draft, up to a ceiling, then let it scroll.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  const handleLoadOlder = () => {
    if (loadingOlder || !nextCursor) return
    setLoadingOlder(true)

    getPropertyMessages(conversationId, { before: nextCursor })
      .then((page) => {
        restoreHeightRef.current = scrollRef.current?.scrollHeight ?? null

        setMessages((prev) => {
          // A cursor page cannot normally overlap, but a re-render racing a
          // double click could re-request the same page — ids make that cheap
          // to make harmless rather than relying on it never happening.
          const seen = new Set(prev.map((m) => String(m._id)))
          const older = page.messages.filter((m) => !seen.has(String(m._id)))
          return [...older, ...prev]
        })

        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
      })
      .catch((err) => {
        if (isUnavailable(err)) {
          setStatus('unavailable')
          return
        }
        toast.error(readableError(err, 'Could not load older messages.'))
      })
      .finally(() => setLoadingOlder(false))
  }

  const handleSend = () => {
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    setSendError('')

    sendPropertyMessage(conversationId, text)
      .then((message) => {
        if (!message) return
        scrollToBottomRef.current = true
        setMessages((prev) => [...prev, message])
        // Cleared only on success, so a failed send leaves the draft intact.
        setDraft('')
        onMessageSent?.(conversationId, message)
      })
      .catch((err) => {
        if (isUnavailable(err)) {
          setStatus('unavailable')
          return
        }
        const message = readableError(err, 'Your message could not be sent. Please try again.')
        setSendError(message)
        toast.error(message)
      })
      .finally(() => setSending(false))
  }

  const handleKeyDown = (event) => {
    // Enter sends, Shift+Enter breaks the line — the convention for a
    // single-purpose message box on desktop.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const items = useMemo(() => buildThreadItems(messages), [messages])

  if (status === 'loading') return <Spinner />
  if (status === 'unavailable') return <UnavailableState onBack={onBack} />

  if (status === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <AlertIcon />
        <p className="text-sm text-slate-500">Could not load this conversation.</p>
        <button
          type="button"
          onClick={handleRetry}
          className="cursor-pointer rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3d5535]"
        >
          Retry
        </button>
      </div>
    )
  }

  const customer = conversation?.counterparty
  const property = conversation?.property
  const isClosed = conversation?.status === 'closed'
  const canSend = Boolean(draft.trim()) && !sending

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-slate-100 p-4">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-700 lg:hidden"
        >
          <BackIcon />
          Back to messages
        </button>

        <div className="flex items-center gap-3">
          <Avatar name={customer?.name} avatar={customer?.avatar} />
          <div className="min-w-0">
            <p style={{ fontFamily: 'Cinzel, serif' }} className="truncate font-bold text-[#202a36]">
              {customer?.name || 'Customer'}
            </p>
            <p className="truncate text-xs text-slate-500">
              {property?.title ? `Inquiry about ${property.title}` : 'Property inquiry'}
            </p>
          </div>
        </div>

        <PropertyContextCard property={property} />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="cursor-pointer rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No messages in this conversation yet.</p>
        ) : (
          items.map((item) =>
            item.type === 'divider' ? (
              <div key={item.key} className="flex justify-center py-1">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-400">
                  {item.label}
                </span>
              </div>
            ) : (
              <MessageBubble
                key={item.key}
                message={item.message}
                // Identity, never name or role text — two people can share a
                // name, and the sender id is the only thing that cannot lie.
                isMine={Boolean(currentUserId) && String(item.message.sender) === currentUserId}
              />
            )
          )
        )}
      </div>

      {isClosed ? (
        <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-4 text-center">
          <p className="text-sm text-slate-500">This conversation is currently closed.</p>
        </div>
      ) : (
        <div className="shrink-0 border-t border-slate-100 p-3">
          {sendError && <p className="mb-2 px-1 text-xs text-red-600">{sendError}</p>}
          <div className="flex items-end gap-2">
            <label htmlFor="agent-message-input" className="sr-only">
              Write a message
            </label>
            <textarea
              id="agent-message-input"
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              // Mirrors the backend limit so the browser refuses what the
              // server would reject. The server still validates.
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Write a message..."
              className="max-h-36 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#4b6741] text-white transition hover:bg-[#3d5535] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <SendIcon />
            </button>
          </div>
          {draft.length > MAX_MESSAGE_LENGTH - 200 && (
            <p className="mt-1 px-1 text-right text-[11px] text-slate-400">
              {draft.length} / {MAX_MESSAGE_LENGTH}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default AgentConversationThread
