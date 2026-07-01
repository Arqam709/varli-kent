import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { C } from '../contexts/ThemeContext'
import { useChat } from '../contexts/ChatContext'
import { useAuth } from '../contexts/AuthContext'

export default function AIChatbot() {
  const [input, setInput] = useState('')
  const location = useLocation()
  const { user, isLoggedIn } = useAuth()

  const {
    open,
    loading,
    openChat,
    closeChat,
    resetChat,
    getMessages,
    sendMessage,
  } = useChat()

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
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => resetChat(pageKey, pageConfig.welcome)}
                  className="hidden sm:flex h-8 items-center justify-center rounded-full px-3 text-[10px] uppercase tracking-widest transition hover:opacity-80"
                  style={{
                    color: C.textLight,
                    border: `1px solid rgba(255,255,255,0.18)`,
                  }}
                >
                  New
                </button>

                <button
                  onClick={closeChat}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm transition hover:opacity-80"
                  style={{
                    color: C.textLight,
                    border: `1px solid rgba(255,255,255,0.18)`,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

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
                        {msg.properties.map((property) => (
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

                              <p
                                className="mt-1 text-[11px]"
                                style={{ color: C.muted }}
                              >
                                {property.beds} bedrooms · {property.baths}{' '}
                                bathrooms · {property.sqm} m²
                              </p>

                              <p
                                className="mt-2 text-xs font-semibold"
                                style={{ color: C.green }}
                              >
                                {property.priceLabel || property.price}
                              </p>

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
                        ))}
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
                  Searching properties...
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
        </div>
      )}
    </>
  )
}