import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { C } from '../contexts/ThemeContext'
import { useChat } from '../contexts/ChatContext'
import { useAuth } from '../contexts/AuthContext'

const HistoryIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const BackIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)

const PlusIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

const EmptyHistoryIcon = () => (
  <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
)

// today: time ("7:15 PM") · yesterday: "Yesterday" · within 7 days: weekday
// ("Monday") · older: compact date ("Jul 10"). Deterministic, local-time
// based, no date library. Invalid/missing input returns ''.
const formatConversationTime = (dateString) => {
  if (!dateString) return ''

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((startOfToday - startOfDate) / (1000 * 60 * 60 * 24))

  if (dayDiff === 0) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  if (dayDiff === 1) {
    return 'Yesterday'
  }
  if (dayDiff > 1 && dayDiff < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const formatMessageCount = (count) => {
  const safeCount = Number.isFinite(count) ? count : 0
  return `${safeCount} ${safeCount === 1 ? 'message' : 'messages'}`
}

export default function AIChatbot() {
  const [input, setInput] = useState('')
  const location = useLocation()
  const { user, isLoggedIn } = useAuth()

  const {
    open,
    loading,
    selectedConversationId,
    conversations,
    conversationsLoading,
    conversationsError,
    transcriptLoading,
    transcriptError,
    openChat,
    closeChat,
    resetChat,
    startNewConversation,
    getMessages,
    sendMessage,
    loadConversations,
    loadConversation,
  } = useChat()

  const [activeScreen, setActiveScreen] = useState('chat')

  const pageKey = useMemo(() => {
    const path = location.pathname

    if (path.startsWith('/properties/')) return path
    if (path === '/properties') return 'properties'
    if (path === '/sale') return 'sale'
    if (path === '/rent') return 'rent'

    return 'hidden'
  }, [location.pathname])

  const userIsLoggedIn =
    typeof isLoggedIn === 'function'
      ? isLoggedIn()
      : Boolean(isLoggedIn || user)

  const chatbotAllowed =
    pageKey === 'properties' ||
    pageKey === 'sale' ||
    pageKey === 'rent' ||
    pageKey.startsWith('/properties/')

  const pageConfig = useMemo(() => {
    if (pageKey === 'sale') {
      return {
        welcome:
          'Welcome to VarliKent. Tell me what kind of property you want to buy, including district, budget, bedrooms, and must-have features.',
        quickQuestions: [
          'Show me apartments for sale',
          'I need a 3 bedroom apartment in Büyükçekmece',
          'Show me villas for sale',
          'I need a property under 8 million',
        ],
        placeholder: 'Ask about properties for sale...',
      }
    }

    if (pageKey === 'rent') {
      return {
        welcome:
          'Welcome to VarliKent. Tell me what kind of rental property you need, including district, bedrooms, budget, and must-have features.',
        quickQuestions: [
          'Show me apartments for rent',
          'Show me rentals in Beylikdüzü',
          'I need a furnished rental',
          'I need a rental with parking',
        ],
        placeholder: 'Ask about rentals...',
      }
    }

    if (pageKey.startsWith('/properties/')) {
      return {
        welcome:
          'Welcome to VarliKent. Ask me about this property, or tell me what similar property you are looking for.',
        quickQuestions: [
          'Show me similar properties',
          'I am interested in this property',
          'Show me properties in this district',
          'Show me apartments for sale',
        ],
        placeholder: 'Ask about this property...',
      }
    }

    return {
      welcome:
        'Welcome to VarliKent. Tell me your budget, district, and whether you want to buy or rent. I will help you find the right property.',
      quickQuestions: [
        'Show me properties for sale',
        'Show me apartments in Büyükçekmece',
        'Show me apartments for rent',
        'I need a villa with pool',
      ],
      placeholder: 'Ask about properties...',
    }
  }, [pageKey])

  const messages = getMessages(pageKey)

  useEffect(() => {
    if (!userIsLoggedIn || !chatbotAllowed) return

    if (messages.length === 0) {
      resetChat(pageKey, pageConfig.welcome)
    }
  }, [
    userIsLoggedIn,
    chatbotAllowed,
    pageKey,
    pageConfig.welcome,
    messages.length,
  ])

  const handleSend = async (quickText) => {
    const text = quickText || input.trim()

    if (!text || loading) return

    await sendMessage(pageKey, text)
    setInput('')
  }

  const handleOpenHistory = () => {
    setActiveScreen('history')
    loadConversations()
  }

  const handleBackToChat = () => {
    setActiveScreen('chat')
  }

  // The close button, not closeChat() itself (unchanged, still owned by
  // ChatContext) — this is the "AIChatbot-side" place to make closing
  // preserve the least-surprising behavior: reopening always lands back on
  // the Chat screen, without touching messages or selectedConversationId.
  const handleClose = () => {
    setActiveScreen('chat')
    closeChat()
  }

  const handleStartNewFromHistory = () => {
    startNewConversation(pageKey, pageConfig.welcome)
    setActiveScreen('chat')
  }

  const handleSelectConversation = async (conversation) => {
    if (transcriptLoading) return

    const result = await loadConversation(pageKey, conversation._id)

    if (result.success) {
      setActiveScreen('chat')
    }
  }

  // IMPORTANT:
  // This return must stay AFTER all hooks above.
  // Otherwise React will show "Rendered more hooks than during previous render".
  if (!userIsLoggedIn || !chatbotAllowed) {
    return null
  }

  return (
    <>
      {!open && (
        <button
          onClick={openChat}
          className="fixed bottom-6 right-4 sm:right-6 z-[9998] flex items-center gap-3 rounded-full px-4 sm:px-5 py-3.5 text-xs font-semibold uppercase tracking-widest shadow-2xl transition-all duration-300 hover:-translate-y-1"
          style={{
            backgroundColor: C.green,
            color: C.textLight,
            border: `1px solid ${C.gold}`,
          }}
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
            style={{
              backgroundColor: 'rgba(255,255,255,0.14)',
              color: C.gold,
            }}
          >
            ✦
          </span>

          <span className="hidden sm:inline">Ask VarliKent</span>
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-6 right-4 sm:right-6 z-[9998] flex h-[540px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl shadow-2xl"
          style={{
            backgroundColor: C.cardBg,
            border: `1px solid ${C.border}`,
          }}
        >
          {/* Header */}
          <div
            className="relative px-5 py-5"
            style={{
              backgroundColor: C.charcoal,
              borderBottom: `1px solid ${C.gold}`,
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  'radial-gradient(ellipse at top right, rgba(var(--vk-green-rgb), 0.35), transparent 55%)',
              }}
            />

            <div className="relative flex items-start justify-between gap-4">
              <div>
                {activeScreen === 'history' ? (
                  <h3
                    className="text-sm font-semibold tracking-[0.2em]"
                    style={{
                      color: C.textLight,
                      fontFamily: 'Cinzel, serif',
                    }}
                  >
                    Conversations
                  </h3>
                ) : (
                  <>
                    <p
                      className="mb-1 text-[10px] font-semibold uppercase tracking-[0.35em]"
                      style={{ color: C.gold }}
                    >
                      AI Advisor
                    </p>

                    <h3
                      className="text-sm font-semibold tracking-[0.2em]"
                      style={{
                        color: C.textLight,
                        fontFamily: 'Cinzel, serif',
                      }}
                    >
                      VarliKent Assistant
                    </h3>

                    <p className="mt-1 text-xs" style={{ color: C.muted }}>
                      Property Finder
                    </p>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                {activeScreen === 'chat' ? (
                  <button
                    type="button"
                    onClick={handleOpenHistory}
                    className="flex h-8 w-8 items-center justify-center rounded-full outline-none transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{
                      color: C.textLight,
                      border: `1px solid rgba(255,255,255,0.18)`,
                      outlineColor: C.gold,
                    }}
                    aria-label="Conversation history"
                  >
                    <HistoryIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleBackToChat}
                    className="flex h-8 w-8 items-center justify-center rounded-full outline-none transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{
                      color: C.textLight,
                      border: `1px solid rgba(255,255,255,0.18)`,
                      outlineColor: C.gold,
                    }}
                    aria-label="Back to chat"
                  >
                    <BackIcon />
                  </button>
                )}

                {activeScreen === 'chat' && (
                  <button
                    type="button"
                    onClick={() => startNewConversation(pageKey, pageConfig.welcome)}
                    className="hidden sm:flex h-8 items-center justify-center rounded-full px-3 text-[10px] uppercase tracking-widest outline-none transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{
                      color: C.textLight,
                      border: `1px solid rgba(255,255,255,0.18)`,
                      outlineColor: C.gold,
                    }}
                    aria-label="Start a new conversation"
                  >
                    New
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm outline-none transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{
                    color: C.textLight,
                    border: `1px solid rgba(255,255,255,0.18)`,
                    outlineColor: C.gold,
                  }}
                  aria-label="Close chat"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          {activeScreen === 'history' ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Pinned New Chat action — a sibling of the scroll container
                  below, not inside it, so it never scrolls away. */}
              <div style={{ backgroundColor: C.cardBg, borderBottom: `1px solid ${C.border}` }}>
                <button
                  type="button"
                  onClick={handleStartNewFromHistory}
                  aria-label="Start a new conversation"
                  className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-widest outline-none transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                  style={{ color: C.textLight, backgroundColor: C.deepGreen, outlineColor: C.gold }}
                >
                  <PlusIcon />
                  <span>New Chat</span>
                </button>
              </div>

              {/* Scrollable rows only */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ backgroundColor: C.softWhite }}>
                {conversationsLoading && (
                  <p className="px-4 py-8 text-center text-sm" style={{ color: C.muted }}>
                    Loading conversations...
                  </p>
                )}

                {!conversationsLoading && conversationsError && (
                  <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                    <p className="text-sm" style={{ color: C.muted }}>
                      Couldn't load conversations.
                    </p>
                    <button
                      type="button"
                      onClick={loadConversations}
                      aria-label="Retry loading conversations"
                      className="rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest outline-none transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
                      style={{ backgroundColor: C.deepGreen, color: C.textLight, outlineColor: C.gold }}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {!conversationsLoading && !conversationsError && conversations.length === 0 && (
                  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                    <span style={{ color: C.border }}>
                      <EmptyHistoryIcon />
                    </span>
                    <p className="text-sm font-semibold" style={{ color: C.textDark }}>
                      No saved conversations yet
                    </p>
                    <p className="text-xs" style={{ color: C.muted }}>
                      Start chatting and your conversations will appear here.
                    </p>
                  </div>
                )}

                {!conversationsLoading && !conversationsError && conversations.length > 0 && (
                  <div>
                    {conversations.map((conversation) => {
                      const isActive = conversation._id === selectedConversationId
                      // TODO: once ChatConversation gains a real `title` field,
                      // prefer conversation.title here, falling back to
                      // lastMessage.text — do not fabricate one in the meantime.
                      const mainText = conversation.lastMessage?.text?.trim() || 'Property conversation'
                      const metaText = `${formatMessageCount(conversation.messageCount)} · ${formatConversationTime(conversation.lastActivityAt)}`

                      return (
                        <button
                          type="button"
                          key={conversation._id}
                          onClick={() => handleSelectConversation(conversation)}
                          disabled={transcriptLoading}
                          aria-label={`Open conversation: ${mainText}, ${metaText}${isActive ? ', current conversation' : ''}`}
                          className="flex w-full items-start gap-2 px-4 py-3 text-left outline-none transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-50"
                          style={{
                            borderBottom: `1px solid ${C.border}`,
                            borderLeft: isActive ? `3px solid ${C.deepGreen}` : '3px solid transparent',
                            backgroundColor: isActive ? 'rgba(var(--vk-green-rgb), 0.10)' : 'transparent',
                            outlineColor: C.gold,
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className="min-w-0 flex-1 line-clamp-2 break-words text-sm leading-snug"
                                style={{ color: C.textDark, fontWeight: isActive ? 600 : 500 }}
                              >
                                {mainText}
                              </p>

                              {isActive && (
                                <span
                                  className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                                  style={{ backgroundColor: C.deepGreen, color: C.textLight }}
                                >
                                  Current
                                </span>
                              )}
                            </div>

                            <p className="mt-1 truncate text-[11px]" style={{ color: C.muted }}>
                              {metaText}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {transcriptLoading && (
                  <p className="px-4 py-4 text-center text-sm" style={{ color: C.muted }}>
                    Loading conversation...
                  </p>
                )}

                {transcriptError && (
                  <p className="px-4 py-4 text-center text-sm" style={{ color: '#b91c1c' }}>
                    Couldn't load this conversation.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
          {/* Messages */}
          <div
            className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
            style={{ backgroundColor: C.softWhite }}
          >
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user'

              return (
                <div
                  key={index}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm"
                    style={{
                      backgroundColor: isUser ? C.green : C.cardBg,
                      color: isUser ? C.textLight : C.textDark,
                      border: isUser ? 'none' : `1px solid ${C.border}`,
                    }}
                  >
                    <p className="whitespace-pre-line">{msg.text}</p>

                    {!isUser && msg.properties?.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {msg.properties.map((property) => {
                          // Restored (saved) properties only ever carry the
                          // lightweight populate fields — beds/baths/sqm are
                          // simply absent, not zero. Render each part only
                          // when it's actually present (`!= null` covers
                          // both undefined and null while still allowing a
                          // genuine 0, e.g. a studio with 0 bedrooms).
                          const propertyDetailParts = [
                            property.beds != null && `${property.beds} bedrooms`,
                            property.baths != null && `${property.baths} bathrooms`,
                            property.sqm != null && `${property.sqm} m²`,
                          ].filter(Boolean)

                          return (
                          <div
                            key={property._id}
                            className="overflow-hidden rounded-xl"
                            style={{
                              backgroundColor: C.softWhite,
                              border: `1px solid ${C.border}`,
                            }}
                          >
                            {(property.mainImage || property.images?.[0]) && (
                              <img
                                src={property.mainImage || property.images[0]}
                                alt={property.title}
                                className="h-28 w-full object-cover"
                              />
                            )}

                            <div className="p-3">
                              <p
                                className="text-xs font-semibold uppercase tracking-wide"
                                style={{ color: C.textDark }}
                              >
                                {property.title}
                              </p>

                              <p
                                className="mt-1 text-[11px]"
                                style={{ color: C.muted }}
                              >
                                {property.district}, Istanbul ·{' '}
                                {property.propertyType} ·{' '}
                                {property.listingType === 'Rent'
                                  ? 'For Rent'
                                  : 'For Sale'}
                              </p>

                              {propertyDetailParts.length > 0 && (
                                <p
                                  className="mt-1 text-[11px]"
                                  style={{ color: C.muted }}
                                >
                                  {propertyDetailParts.join(' · ')}
                                </p>
                              )}

                              <p
                                className="mt-2 text-xs font-semibold"
                                style={{ color: C.green }}
                              >
                                {property.priceLabel || property.price}
                              </p>

                              {property.matchReason && (
                                <p
                                  className="mt-2 text-[11px] italic leading-snug"
                                  style={{ color: C.muted }}
                                >
                                  {property.matchReason}
                                </p>
                              )}

                              <Link
                                to={`/properties/${property._id}`}
                                onClick={closeChat}
                                className="mt-3 inline-flex rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-widest"
                                style={{
                                  backgroundColor: C.green,
                                  color: C.textLight,
                                }}
                              >
                                View Property
                              </Link>
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {loading && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl px-4 py-3 text-sm"
                  style={{
                    backgroundColor: C.cardBg,
                    color: C.muted,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  Thinking...
                </div>
              </div>
            )}
          </div>

          {/* Quick questions */}
          <div
            className="px-4 py-3"
            style={{
              backgroundColor: C.cardBg,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pageConfig.quickQuestions.map((question) => (
                <button
                  key={question}
                  onClick={() => handleSend(question)}
                  disabled={loading}
                  className="whitespace-nowrap rounded-full px-3 py-2 text-[11px] transition hover:opacity-80 disabled:opacity-50"
                  style={{
                    color: C.textDark,
                    border: `1px solid ${C.border}`,
                    backgroundColor: C.softWhite,
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div
            className="flex gap-2 p-4"
            style={{
              backgroundColor: C.cardBg,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend()
              }}
              placeholder={pageConfig.placeholder}
              disabled={loading}
              className="min-w-0 flex-1 rounded-full px-4 py-3 text-sm outline-none disabled:opacity-60"
              style={{
                backgroundColor: C.softWhite,
                color: C.textDark,
                border: `1px solid ${C.border}`,
              }}
            />

            <button
              onClick={() => handleSend()}
              disabled={loading}
              className="rounded-full px-5 py-3 text-xs font-semibold uppercase tracking-widest transition hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: C.deepGreen,
                color: C.textLight,
              }}
            >
              Send
            </button>
          </div>
            </>
          )}
        </div>
      )}
    </>
  )
}