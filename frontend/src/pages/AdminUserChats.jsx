import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../lib/api'
import AdminLayout from '../components/AdminLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatPrice } from '../lib/formatPrice'

const EVENT_LABELS = {
  properties_shown: 'Properties shown',
  no_results: 'No results',
  clarification_requested: 'Clarification requested',
  lead_flow_started: 'Lead flow started',
  lead_captured: 'Lead captured',
}

const getInitials = (name) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'U'

const formatRelativeTime = (dateString) => {
  const date = new Date(dateString)
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString()
}

const formatDateSeparatorLabel = (dateString) => {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

const humanizePageKey = (pageKey) => {
  if (!pageKey) return null
  if (pageKey === 'properties') return 'Properties'
  if (pageKey === 'sale') return 'Sale'
  if (pageKey === 'rent') return 'Rent'
  if (pageKey.startsWith('/properties/')) return 'Property Details'
  return pageKey
}

const getLastPageContext = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const label = humanizePageKey(messages[i].pageKey)
    if (label) return label
  }
  return null
}

// Groups chronological messages into a flat render list with a date
// separator inserted whenever the calendar day changes.
const buildTranscriptItems = (messages) => {
  const items = []
  let lastDateKey = null

  messages.forEach((message) => {
    const dateKey = new Date(message.createdAt).toDateString()
    if (dateKey !== lastDateKey) {
      items.push({ type: 'separator', key: `sep-${message._id}`, label: formatDateSeparatorLabel(message.createdAt) })
      lastDateKey = dateKey
    }
    items.push({ type: 'message', key: message._id, message })
  })

  return items
}

// "1 conversation" / "4 conversations" — the same grammar pattern already
// used for message counts elsewhere in this admin surface.
const formatConversationCount = (count, labels) => {
  const safeCount = Number.isFinite(count) ? count : 0
  const noun = safeCount === 1 ? labels.conversation || 'conversation' : labels.conversations || 'conversations'
  return `${safeCount} ${noun}`
}

// The backend returns the literal English string 'Deleted user' as a data
// fallback when a conversation's user no longer exists (see
// routes/adminChats.js) — it isn't a translation key, so this bridges that
// one known sentinel value into the i18n system rather than displaying raw
// backend text verbatim in a non-English UI.
const getUserDisplayName = (user, labels) =>
  user?.name === 'Deleted user' ? labels.deletedUser || 'Deleted user' : user?.name || '—'

const SearchIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
)

const BackIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)

const ChatIcon = ({ className = 'h-16 w-16' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
)

const UsersEmptyIcon = () => (
  <svg className="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
)

const AlertIcon = () => (
  <svg className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)

const ImagePlaceholderIcon = () => (
  <svg className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

const Avatar = ({ name, avatar, className = 'h-10 w-10 text-sm' }) => {
  const [imageFailed, setImageFailed] = useState(false)

  // Reset the failure flag whenever the avatar prop itself changes — this
  // component instance is reused across different users/conversations
  // (React doesn't remount it just because props change), so without this
  // a broken avatar for one user would permanently hide a valid avatar for
  // the next one shown in the same slot.
  useEffect(() => {
    setImageFailed(false)
  }, [avatar])

  return avatar && !imageFailed ? (
    <img
      src={avatar}
      alt={name}
      onError={() => setImageFailed(true)}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  ) : (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-[#202a36] font-bold text-white ${className}`}>
      {getInitials(name)}
    </div>
  )
}

const StatusBadge = ({ status, labels }) => (
  <span
    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
      status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-700'
    }`}
  >
    {status === 'active' ? labels.active : labels.archived}
  </span>
)

const LeadBadge = ({ label }) => (
  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{label}</span>
)

const EventBadge = ({ event }) => {
  const label = EVENT_LABELS[event]
  if (!label) return null
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        event === 'lead_captured' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {label}
    </span>
  )
}

const PropertyMiniCard = ({ property }) => (
  <div className="flex w-64 items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 pr-3">
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
      {property.mainImage ? (
        <img src={property.mainImage} alt={property.title} className="h-full w-full object-cover" />
      ) : (
        <ImagePlaceholderIcon />
      )}
    </div>
    <div className="min-w-0">
      <p className="truncate text-xs font-semibold text-[#202a36]">{property.title}</p>
      <p className="truncate text-[11px] text-slate-500">
        {[property.district, property.propertyType, property.listingType].filter(Boolean).join(' · ')}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-[#4b6741]">
          {formatPrice(property.price, property.listingType, property.priceLabel)}
        </span>
        {property.status && <span className="text-[10px] text-slate-400">{property.status}</span>}
      </div>
    </div>
  </div>
)

const MessageBubble = ({ message, labels }) => {
  const isUser = message.role === 'user'

  return (
    <div className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
      <span className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {isUser ? labels.user : labels.aiAssistant}
      </span>
      <div
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? 'bg-slate-100 text-slate-700' : 'bg-[#4b6741]/10 text-[#202a36]'
        }`}
      >
        {message.text}
      </div>
      <div className={`mt-1 flex items-center gap-2 ${isUser ? '' : 'flex-row-reverse'}`}>
        <span className="text-[11px] text-slate-400">
          {new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
        <EventBadge event={message.event} />
      </div>
      {!isUser && message.properties?.length > 0 && (
        <div className="mt-2 flex max-w-full flex-wrap gap-2 justify-end">
          {message.properties.map((property) => (
            <PropertyMiniCard key={property._id} property={property} />
          ))}
        </div>
      )}
    </div>
  )
}

const Spinner = () => (
  <div className="flex justify-center py-10">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
  </div>
)

const UserRow = ({ entry, isSelected, onClick, labels }) => {
  const name = getUserDisplayName(entry.user, labels)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${name}, ${formatConversationCount(entry.conversationCount, labels)}`}
      className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition cursor-pointer ${
        isSelected ? 'bg-[#4b6741]/10' : 'hover:bg-slate-50'
      }`}
    >
      <Avatar name={name} avatar={entry.user?.avatar} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-[#202a36]">{name}</p>
          <span className="shrink-0 text-[11px] text-slate-400">{formatRelativeTime(entry.lastActivityAt)}</span>
        </div>
        {entry.user?.email && <p className="truncate text-xs text-slate-500">{entry.user.email}</p>}
        {entry.latestMessage?.text && (
          <p className="mt-1 truncate text-xs text-slate-600">{entry.latestMessage.text}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">{formatConversationCount(entry.conversationCount, labels)}</span>
          {entry.hasLead && <LeadBadge label={labels.lead || 'Lead'} />}
        </div>
      </div>
    </button>
  )
}

const ConversationRow = ({ conversation, isSelected, onClick, labels }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full flex-col items-start gap-1 px-4 py-3.5 text-left transition cursor-pointer ${
      isSelected ? 'bg-[#4b6741]/10' : 'hover:bg-slate-50'
    }`}
  >
    <div className="flex w-full items-center justify-between gap-2">
      {/* No real title field exists yet — lastMessage.text is the temporary
          row label, per the same convention already used in the chatbot's
          own history screen. Do not fabricate one. */}
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#202a36]">
        {conversation.lastMessage?.text?.trim() || 'Property conversation'}
      </p>
      <span className="shrink-0 text-[11px] text-slate-400">{formatRelativeTime(conversation.lastActivityAt)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-slate-400">
        {conversation.messageCount} {labels.messages || 'messages'}
      </span>
      <StatusBadge status={conversation.status} labels={labels} />
      {conversation.leadCaptured && <LeadBadge label={labels.lead || 'Lead'} />}
    </div>
  </button>
)

const AdminUserChats = () => {
  const { hasPermission } = useAuth()
  const { t } = useLanguage()
  const p = t.adminPages?.userChats || {}

  // Level 1 — users
  const [users, setUsers] = useState([])
  const [usersPagination, setUsersPagination] = useState(null)
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState(false)
  const [userPage, setUserPage] = useState(1)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [leadsOnly, setLeadsOnly] = useState(false)

  const [selectedUserId, setSelectedUserId] = useState(null)

  // Level 2 — the selected user's conversations
  const [conversations, setConversations] = useState([])
  const [conversationsPagination, setConversationsPagination] = useState(null)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState(false)
  const [conversationPage, setConversationPage] = useState(1)

  const [selectedConversationId, setSelectedConversationId] = useState(null)

  // Level 3 — transcript
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState(false)

  // Which screen is visible below the `lg` breakpoint, where only one pane
  // shows at a time. Irrelevant at `lg` and above, where panes are governed
  // purely by selection state (see the className logic in the JSX below).
  const [mobileView, setMobileView] = useState('users')

  const canAccess = hasPermission('view_chats')

  // Generation refs — one per level — so a slower, superseded request can
  // never overwrite a faster, more recent one (e.g. clicking Alex then
  // immediately Zille; selecting Conversation A then immediately B).
  const usersRequestRef = useRef(0)
  const conversationsRequestRef = useRef(0)
  const transcriptRequestRef = useRef(0)

  // Debounce the raw search input before it drives a request.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [search])

  // Changing any top-level filter/search resets both pagination levels.
  // Selection clearing (if the selected user/conversation no longer
  // matches) happens inside the response handlers below, once the fresh
  // data is actually known — not eagerly here.
  useEffect(() => {
    setUserPage(1)
    setConversationPage(1)
  }, [status, leadsOnly, debouncedSearch])

  const loadUsers = useCallback(() => {
    const requestId = ++usersRequestRef.current
    setUsersLoading(true)
    setUsersError(false)

    api
      .get('/admin/chats/users', {
        params: {
          page: userPage,
          limit: 20,
          status,
          leadCaptured: leadsOnly ? true : undefined,
          search: debouncedSearch || undefined,
        },
      })
      .then((res) => {
        if (requestId !== usersRequestRef.current) return
        const newUsers = res.data.users || []
        setUsers(newUsers)
        setUsersPagination(res.data.pagination || null)
        setSelectedUserId((prevId) =>
          prevId && !newUsers.some((entry) => entry.user._id === prevId) ? null : prevId
        )
      })
      .catch(() => {
        if (requestId !== usersRequestRef.current) return
        setUsersError(true)
      })
      .finally(() => {
        if (requestId !== usersRequestRef.current) return
        setUsersLoading(false)
      })
  }, [userPage, status, leadsOnly, debouncedSearch])

  useEffect(() => {
    if (!canAccess) return
    loadUsers()
  }, [canAccess, loadUsers])

  const loadConversationsForUser = useCallback(
    (userId) => {
      const requestId = ++conversationsRequestRef.current
      setConversationsLoading(true)
      setConversationsError(false)

      api
        .get('/admin/chats', {
          params: {
            user: userId,
            page: conversationPage,
            limit: 20,
            status,
            leadCaptured: leadsOnly ? true : undefined,
          },
        })
        .then((res) => {
          if (requestId !== conversationsRequestRef.current) return
          const newConversations = res.data.conversations || []
          setConversations(newConversations)
          setConversationsPagination(res.data.pagination || null)
          setSelectedConversationId((prevId) =>
            prevId && !newConversations.some((c) => c._id === prevId) ? null : prevId
          )
        })
        .catch(() => {
          if (requestId !== conversationsRequestRef.current) return
          setConversationsError(true)
        })
        .finally(() => {
          if (requestId !== conversationsRequestRef.current) return
          setConversationsLoading(false)
        })
    },
    [conversationPage, status, leadsOnly]
  )

  useEffect(() => {
    if (!selectedUserId) {
      setConversations([])
      setConversationsPagination(null)
      setConversationsError(false)
      return
    }
    loadConversationsForUser(selectedUserId)
  }, [selectedUserId, loadConversationsForUser])

  const loadTranscript = useCallback((conversationId) => {
    const requestId = ++transcriptRequestRef.current
    setTranscriptLoading(true)
    setTranscriptError(false)

    api
      .get(`/admin/chats/${conversationId}`)
      .then((res) => {
        if (requestId !== transcriptRequestRef.current) return
        setSelectedConversation(res.data.conversation || null)
        setMessages(res.data.messages || [])
      })
      .catch(() => {
        if (requestId !== transcriptRequestRef.current) return
        setTranscriptError(true)
      })
      .finally(() => {
        if (requestId !== transcriptRequestRef.current) return
        setTranscriptLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedConversationId) {
      setSelectedConversation(null)
      setMessages([])
      setTranscriptError(false)
      return
    }
    loadTranscript(selectedConversationId)
  }, [selectedConversationId, loadTranscript])

  const handleSelectUser = (userId) => {
    if (userId === selectedUserId) {
      setMobileView('conversations')
      return
    }
    setSelectedUserId(userId)
    setConversationPage(1)
    setSelectedConversationId(null)
    setMobileView('conversations')
  }

  const handleSelectConversation = (conversationId) => {
    setSelectedConversationId(conversationId)
    setMobileView('transcript')
  }

  if (!canAccess) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p className="mt-4 text-lg font-semibold text-slate-700">{p.noAccessTitle || 'No access'}</p>
          <p className="mt-2 text-sm text-slate-500">
            {p.noAccessDescription || 'You need the "view_chats" permission to see saved conversations.'}
          </p>
        </div>
      </AdminLayout>
    )
  }

  const statusLabels = { active: p.active || 'Active', archived: p.archived || 'Archived' }
  const bubbleLabels = { user: p.user || 'User', aiAssistant: p.aiAssistant || 'AI Assistant' }
  const rowLabels = { ...statusLabels, ...bubbleLabels, lead: p.lead, messages: p.messages, conversation: p.conversation, conversations: p.conversations, deletedUser: p.deletedUser }
  const userTotalPages = usersPagination?.totalPages || 1
  const conversationTotalPages = conversationsPagination?.totalPages || 1
  const transcriptItems = buildTranscriptItems(messages)
  const lastPageContext = getLastPageContext(messages)
  const selectedUserEntry = users.find((entry) => entry.user._id === selectedUserId)

  return (
    <AdminLayout>
      <div className="flex h-full flex-col space-y-6 overflow-hidden">
        <div className="shrink-0">
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">
            {p.title || 'User Chats'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {p.subtitle || 'Review conversations between logged-in users and the AI assistant.'}
          </p>
        </div>

        <div className="grid flex-1 min-h-0 auto-rows-fr gap-6 lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_320px_1fr]">
          {/* Level 1 — Users */}
          <div
            className={`${mobileView === 'users' ? 'flex' : 'hidden'} lg:flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden`}
          >
            <div className="shrink-0 space-y-3 border-b border-slate-100 p-4">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                  placeholder={p.searchPlaceholder || 'Search by name or email...'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {['active', 'archived'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition cursor-pointer ${
                      status === s ? 'bg-[#202a36] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {statusLabels[s]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLeadsOnly((prev) => !prev)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition cursor-pointer ${
                    leadsOnly ? 'bg-[#4b6741] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {p.leadsOnly || 'Leads only'}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {usersLoading ? (
                <Spinner />
              ) : usersError ? (
                <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                  <AlertIcon />
                  <p className="text-sm text-slate-500">{p.couldNotLoadList || "Couldn't load users."}</p>
                  <button
                    type="button"
                    onClick={loadUsers}
                    className="rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer"
                  >
                    {p.retry || 'Retry'}
                  </button>
                </div>
              ) : users.length === 0 ? (
                <div className="m-4 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                  {p.noUsers || 'No users match your filters.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {users.map((entry) => (
                    <UserRow
                      key={entry.user._id}
                      entry={entry}
                      isSelected={entry.user._id === selectedUserId}
                      onClick={() => handleSelectUser(entry.user._id)}
                      labels={rowLabels}
                    />
                  ))}
                </div>
              )}
            </div>

            {usersPagination && users.length > 0 && (
              <div className="shrink-0 flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setUserPage((prev) => Math.max(prev - 1, 1))}
                  disabled={userPage <= 1}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  {p.previous || 'Previous'}
                </button>
                <span className="text-xs text-slate-500">
                  {userPage} {p.pageOf || 'of'} {userTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setUserPage((prev) => Math.min(prev + 1, userTotalPages))}
                  disabled={userPage >= userTotalPages}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  {p.next || 'Next'}
                </button>
              </div>
            )}
          </div>

          {/* Level 2 — the selected user's conversations */}
          <div
            className={`${mobileView === 'conversations' ? 'flex' : 'hidden'} ${
              selectedUserId && !selectedConversationId ? 'lg:flex' : 'lg:hidden'
            } ${selectedUserId ? 'xl:flex' : 'xl:hidden'} lg:col-start-2 min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden`}
          >
            {!selectedUserId ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-slate-400">
                <p className="text-sm">{p.selectUser || 'Select a user'}</p>
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-slate-100 p-4">
                  <button
                    type="button"
                    onClick={() => setMobileView('users')}
                    className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition cursor-pointer lg:hidden"
                  >
                    <BackIcon />
                    {p.backToUsers || 'Back to users'}
                  </button>
                  <div className="flex items-center gap-2">
                    <Avatar
                      name={getUserDisplayName(selectedUserEntry?.user, rowLabels)}
                      avatar={selectedUserEntry?.user?.avatar}
                      className="h-9 w-9 text-xs"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#202a36]">
                        {getUserDisplayName(selectedUserEntry?.user, rowLabels)}
                      </p>
                      {selectedUserEntry?.user?.email && (
                        <p className="truncate text-xs text-slate-500">{selectedUserEntry.user.email}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  {conversationsLoading ? (
                    <Spinner />
                  ) : conversationsError ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                      <AlertIcon />
                      <p className="text-sm text-slate-500">
                        {p.couldNotLoadUserConversations || "Couldn't load this user's conversations."}
                      </p>
                      <button
                        type="button"
                        onClick={() => loadConversationsForUser(selectedUserId)}
                        className="rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer"
                      >
                        {p.retry || 'Retry'}
                      </button>
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="m-4 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                      {p.noUserConversations || 'This user has no conversations matching your filters.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {conversations.map((conversation) => (
                        <ConversationRow
                          key={conversation._id}
                          conversation={conversation}
                          isSelected={conversation._id === selectedConversationId}
                          onClick={() => handleSelectConversation(conversation._id)}
                          labels={rowLabels}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {conversationsPagination && conversations.length > 0 && (
                  <div className="shrink-0 flex items-center justify-between border-t border-slate-100 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setConversationPage((prev) => Math.max(prev - 1, 1))}
                      disabled={conversationPage <= 1}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                    >
                      {p.previous || 'Previous'}
                    </button>
                    <span className="text-xs text-slate-500">
                      {conversationPage} {p.pageOf || 'of'} {conversationTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConversationPage((prev) => Math.min(prev + 1, conversationTotalPages))}
                      disabled={conversationPage >= conversationTotalPages}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                    >
                      {p.next || 'Next'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Level 3 — Transcript */}
          <div
            className={`${mobileView === 'transcript' ? 'flex' : 'hidden'} ${
              selectedConversationId ? 'lg:flex' : 'lg:hidden'
            } xl:flex lg:col-start-2 xl:col-start-3 min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden`}
          >
            {!selectedConversationId ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-slate-400">
                <ChatIcon />
                <p className="text-lg font-semibold text-slate-600">
                  {selectedUserId ? p.selectConversation || 'Select a conversation' : p.selectUser || 'Select a user'}
                </p>
                <p className="max-w-xs text-sm text-slate-400">
                  {selectedUserId
                    ? p.selectConversationDescription || 'Choose a conversation from the left to view its full transcript.'
                    : p.selectUserDescription || 'Choose a user from the list to see their conversations.'}
                </p>
              </div>
            ) : transcriptLoading ? (
              <Spinner />
            ) : transcriptError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertIcon />
                <p className="text-sm text-slate-500">{p.couldNotLoadConversation || "Couldn't load this conversation."}</p>
                <button
                  type="button"
                  onClick={() => loadTranscript(selectedConversationId)}
                  className="rounded-full bg-[#4b6741] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d5535] transition cursor-pointer"
                >
                  {p.retry || 'Retry'}
                </button>
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-slate-100 p-4">
                  <button
                    type="button"
                    onClick={() => setMobileView('conversations')}
                    className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition cursor-pointer lg:hidden"
                  >
                    <BackIcon />
                    {p.backToConversations || 'Back to conversations'}
                  </button>

                  <div className="flex items-start gap-3">
                    <Avatar
                      name={getUserDisplayName(selectedConversation?.user, rowLabels)}
                      avatar={selectedConversation?.user?.avatar}
                      className="h-11 w-11 text-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[#202a36]">
                        {getUserDisplayName(selectedConversation?.user, rowLabels)}
                      </p>
                      <p className="truncate text-sm text-slate-500">{selectedConversation?.user?.email}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={selectedConversation?.status} labels={statusLabels} />
                        {selectedConversation?.leadCaptured && <LeadBadge label={p.lead || 'Lead'} />}
                        <span className="text-[11px] text-slate-400">
                          {selectedConversation?.messageCount} {p.messages || 'messages'}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                        <span>
                          {p.created || 'Created'}: {selectedConversation?.createdAt && new Date(selectedConversation.createdAt).toLocaleDateString()}
                        </span>
                        <span>
                          {p.lastActivity || 'Last activity'}: {selectedConversation?.lastActivityAt && new Date(selectedConversation.lastActivityAt).toLocaleDateString()}
                        </span>
                        {lastPageContext && (
                          <span>
                            {p.lastPageContext || 'Last page context'}: {lastPageContext}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedConversation?.lead && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-700">{p.lead || 'Lead'}</p>
                      <p className="mt-1">{selectedConversation.lead.name} — {selectedConversation.lead.email} — {selectedConversation.lead.phone}</p>
                      {selectedConversation.lead.interestType && <p className="mt-0.5 text-slate-500">{selectedConversation.lead.interestType}</p>}
                      {selectedConversation.lead.status && <p className="mt-0.5 text-slate-500">{selectedConversation.lead.status}</p>}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
                  {transcriptItems.map((item) =>
                    item.type === 'separator' ? (
                      <div key={item.key} className="flex items-center justify-center">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-400">{item.label}</span>
                      </div>
                    ) : (
                      <MessageBubble key={item.key} message={item.message} labels={bubbleLabels} />
                    )
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminUserChats
