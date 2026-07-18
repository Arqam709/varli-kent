import { createContext, useContext, useState, useRef } from 'react'
import api from '../lib/api'

const ChatContext = createContext(null)

const normalizePageKey = (pageKey) => {
  if (!pageKey) return 'properties'

  if (pageKey === '/properties') return 'properties'
  if (pageKey === '/sale') return 'sale'
  if (pageKey === '/rent') return 'rent'

  return pageKey
}

const isPropertyPage = (pageKey) => {
  const key = normalizePageKey(pageKey)

  return (
    key === 'properties' ||
    key === 'sale' ||
    key === 'rent' ||
    key?.startsWith('/properties/')
  )
}

const cleanHistoryForBackend = (messages = []) => {
  return messages.map((msg) => ({
    role: msg.role,
    text: msg.text,
  }))
}

const getLastParsedFromMessages = (messages = []) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.parsed) {
      return messages[i].parsed
    }
  }

  return {}
}

const getShownPropertyIds = (messages = []) => {
  const ids = new Set()

  messages.forEach((msg) => {
    if (Array.isArray(msg.properties)) {
      msg.properties.forEach((property) => {
        if (property?._id) ids.add(property._id)
      })
    }
  })

  return Array.from(ids)
}

const getLastShownProperties = (messages = []) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.properties) && messages[i].properties.length > 0) {
      return messages[i].properties.map((property) => ({
        _id: property._id,
        title: property.title,
      }))
    }
  }

  return []
}

// Maps one saved ChatMessage (from GET /api/chat/conversations/:id) into the
// same shape sendMessage() already produces for live messages. Saved
// messages never carry `parsed`/`exactMatch` — those are never persisted —
// so restored assistant messages simply won't have them.
const mapSavedMessage = (message) => {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      text: message.text,
      properties: message.properties || [],
      parsed: null,
      exactMatch: undefined,
    }
  }

  return {
    role: 'user',
    text: message.text,
  }
}

export const ChatProvider = ({ children }) => {
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState({})
  const [filtersByPage, setFiltersByPage] = useState({})
  const [loading, setLoading] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState(null)

  const [conversations, setConversations] = useState([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState(false)

  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState(false)

  // Bumped on every startNewConversation() call. A sendMessage() request
  // captures this value before it awaits the backend; if the value has
  // since changed by the time the response arrives, the user has reset the
  // chat in the meantime and this response is stale — its id/messages must
  // not be applied.
  const conversationGenerationRef = useRef(0)

  const openChat = () => setOpen(true)
  const closeChat = () => setOpen(false)
  const toggleChat = () => setOpen((prev) => !prev)

  const getMessages = (pageKey) => {
    const key = normalizePageKey(pageKey)
    return chats[key] || []
  }

  const resetChat = (pageKey, welcomeMessage) => {
    const key = normalizePageKey(pageKey)

    setChats((prev) => ({
      ...prev,
      [key]: [
        {
          role: 'assistant',
          text: welcomeMessage,
        },
      ],
    }))

    setFiltersByPage((prev) => ({
      ...prev,
      [key]: {},
    }))
  }

  // Deliberate "New Chat" action — clears the local session and detaches it
  // from any backend conversation. shownPropertyIds/lastShownProperties need
  // no separate clearing: both are derived from `chats[key]` on every call
  // (see getShownPropertyIds/getLastShownProperties above), so resetting the
  // messages to just the welcome message already clears them for free.
  const startNewConversation = (pageKey, welcomeMessage) => {
    conversationGenerationRef.current += 1
    setSelectedConversationId(null)
    resetChat(pageKey, welcomeMessage)
  }

  // Loads the logged-in user's own conversation list for the history screen.
  // Read-only — never touches `chats` or `selectedConversationId`.
  const loadConversations = async () => {
    setConversationsLoading(true)
    setConversationsError(false)

    try {
      const res = await api.get('/chat/conversations')
      setConversations(res.data.conversations || [])
    } catch (err) {
      console.log('Load conversations error:', err)
      setConversationsError(true)
    } finally {
      setConversationsLoading(false)
    }
  }

  // Loads one saved conversation's transcript into the given page's bucket
  // and marks it as selected, so the next sendMessage() continues it.
  // Bumps the same generation ref startNewConversation() uses — switching to
  // a different old conversation must also invalidate any send still in
  // flight for whatever was showing before.
  //
  // Returns { success: boolean } explicitly rather than relying on the
  // caller inspecting transcriptError afterward — transcriptError only
  // updates via this function's own setState calls, and a caller reading it
  // right after `await`ing this function would be reading a value from
  // before those updates were applied (setState is not synchronous), not
  // reading it wrong. Returning the outcome directly sidesteps that
  // entirely.
  const loadConversation = async (pageKey, conversationId) => {
    const key = normalizePageKey(pageKey)

    conversationGenerationRef.current += 1
    const requestGeneration = conversationGenerationRef.current

    setTranscriptLoading(true)
    setTranscriptError(false)

    try {
      const res = await api.get(`/chat/conversations/${conversationId}`)

      if (conversationGenerationRef.current !== requestGeneration) return { success: false }

      const mappedMessages = (res.data.messages || []).map(mapSavedMessage)

      setChats((prev) => ({ ...prev, [key]: mappedMessages }))
      setFiltersByPage((prev) => ({ ...prev, [key]: {} }))
      setSelectedConversationId(res.data.conversation?._id || conversationId)

      return { success: true }
    } catch (err) {
      console.log('Load conversation error:', err)

      if (conversationGenerationRef.current !== requestGeneration) return { success: false }
      setTranscriptError(true)
      return { success: false }
    } finally {
      if (conversationGenerationRef.current === requestGeneration) {
        setTranscriptLoading(false)
      }
    }
  }

  const sendMessage = async (pageKey, text) => {
    const key = normalizePageKey(pageKey)
    const messageText = text?.trim()

    if (!messageText || loading) return
    if (!isPropertyPage(key)) return

    const previousMessages = chats[key] || []

    const currentFilters =
      filtersByPage[key] && Object.keys(filtersByPage[key]).length > 0
        ? filtersByPage[key]
        : getLastParsedFromMessages(previousMessages)

    const shownPropertyIds = getShownPropertyIds(previousMessages)
    const lastShownProperties = getLastShownProperties(previousMessages)

    const userMessage = {
      role: 'user',
      text: messageText,
    }

    const updatedMessages = [...previousMessages, userMessage]

    setChats((prev) => ({
      ...prev,
      [key]: updatedMessages,
    }))

    setLoading(true)

    // Captured before the request goes out, not re-read afterward: the
    // outgoing request must reflect the conversation this message was
    // actually typed into, and the generation check below detects if the
    // user has since moved on (pressed New) before the response arrives.
    const requestGeneration = conversationGenerationRef.current
    const requestConversationId = selectedConversationId

    try {
      const historyForBackend = cleanHistoryForBackend(updatedMessages).slice(-10)

      console.log('Sending chat payload:', {
        message: messageText,
        pageKey: key,
        currentFilters,
        history: historyForBackend,
        shownPropertyIds,
        lastShownProperties,
        conversationId: requestConversationId,
      })

      const res = await api.post('/chat', {
        message: messageText,
        pageKey: key,
        history: historyForBackend,
        currentFilters,
        shownPropertyIds,
        lastShownProperties,
        conversationId: requestConversationId,
      })

      if (conversationGenerationRef.current !== requestGeneration) {
        // The user pressed "New" while this request was in flight — discard
        // this response rather than let it corrupt the conversation the
        // user has already moved on to.
        return
      }

      const assistantMessage = {
        role: 'assistant',
        text: res.data.reply || 'I checked the property database.',
        properties: res.data.properties || [],
        parsed: res.data.parsed || null,
        exactMatch: res.data.exactMatch,
      }

      setChats((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []), assistantMessage],
      }))

      if (res.data.parsed) {
        setFiltersByPage((prev) => ({
          ...prev,
          [key]: res.data.parsed,
        }))
      }

      if (res.data.conversationId) {
        setSelectedConversationId(res.data.conversationId)
      }
    } catch (err) {
      console.log('Chat error:', err)

      if (conversationGenerationRef.current !== requestGeneration) {
        return
      }

      const status = err.response?.status
      const errorText =
        status === 400 || status === 404
          ? 'Something went wrong with this conversation. Please try again or start a new chat.'
          : 'Sorry, I could not connect to the property database right now. Please try again.'

      const errorMessage = {
        role: 'assistant',
        text: errorText,
      }

      setChats((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []), errorMessage],
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ChatContext.Provider
      value={{
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
        toggleChat,
        getMessages,
        resetChat,
        startNewConversation,
        sendMessage,
        loadConversations,
        loadConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export const useChat = () => {
  const ctx = useContext(ChatContext)

  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider')
  }

  return ctx
}

export default ChatContext