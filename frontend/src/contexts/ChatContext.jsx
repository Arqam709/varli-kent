import { createContext, useContext, useState, useRef } from 'react'
import api from '../lib/api'
import { useLanguage } from './LanguageContext'

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
  const { language } = useLanguage()

  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState({})
  const [filtersByPage, setFiltersByPage] = useState({})
  const [loading, setLoading] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState(null)

  const [conversations, setConversations] = useState([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState(false)
  const [conversationsPagination, setConversationsPagination] = useState(null)
  const [conversationsLoadingMore, setConversationsLoadingMore] = useState(false)

  /*
   * Which page bucket in `chats` currently holds a SAVED conversation's
   * transcript, set by loadConversation().
   *
   * Without this, deleting the open conversation can remove it from the
   * server and from the history list while its messages stay rendered in the
   * widget — a transcript for something that no longer exists. Knowing the
   * key lets deletion clear exactly that bucket and nothing else, so an
   * unrelated chat the user has open on another page is left alone.
   */
  const selectedConversationKeyRef = useRef(null)

  // Guards against out-of-order history responses: a slow page-1 request
  // must not overwrite a page-2 list that already arrived.
  const conversationsRequestRef = useRef(0)

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
          isWelcome: true,
        },
      ],
    }))

    setFiltersByPage((prev) => ({
      ...prev,
      [key]: {},
    }))
  }

  // Keeps the welcome message following the currently selected website
  // language. Deliberately narrow: only replaces the text of an untouched
  // welcome message, and only for the one page bucket it's called with.
  // Never touches filtersByPage, selectedConversationId, or
  // conversationGenerationRef — a real conversation (anything beyond the
  // single isWelcome message) is left completely alone.
  const syncWelcomeLanguage = (pageKey, welcomeMessage) => {
    const key = normalizePageKey(pageKey)

    setChats((prev) => {
      const current = prev[key] || []

      if (current.length !== 1 || current[0]?.isWelcome !== true) {
        return prev
      }

      if (current[0].text === welcomeMessage) {
        return prev
      }

      return {
        ...prev,
        [key]: [
          {
            role: 'assistant',
            text: welcomeMessage,
            isWelcome: true,
          },
        ],
      }
    })
  }

  // Deliberate "New Chat" action — clears the local session and detaches it
  // from any backend conversation. shownPropertyIds/lastShownProperties need
  // no separate clearing: both are derived from `chats[key]` on every call
  // (see getShownPropertyIds/getLastShownProperties above), so resetting the
  // messages to just the welcome message already clears them for free.
  const startNewConversation = (pageKey, welcomeMessage) => {
    conversationGenerationRef.current += 1
    setSelectedConversationId(null)
    selectedConversationKeyRef.current = null
    resetChat(pageKey, welcomeMessage)
  }

  /*
   * Loads the user's own conversation list for the history screen.
   *
   * The endpoint is paginated and this wave deliberately added no
   * conversation cap, so a long-standing user WILL have more history than
   * one server page. `append` walks the pages; the default call shape
   * loadConversations() still means "reload page 1", so existing callers
   * are unaffected.
   *
   * Read-only with respect to `chats` and `selectedConversationId`.
   */
  const loadConversations = async ({ page = 1, append = false } = {}) => {
    const requestGeneration = ++conversationsRequestRef.current

    if (append) setConversationsLoadingMore(true)
    else setConversationsLoading(true)
    setConversationsError(false)

    try {
      const res = await api.get('/chat/conversations', { params: { page } })

      // A newer request has since been issued; this response is stale.
      if (conversationsRequestRef.current !== requestGeneration) return { success: false }

      const incoming = res.data.conversations || []

      setConversations((prev) => {
        if (!append) return incoming

        // Appending by id, because a conversation whose lastActivityAt
        // changed between two page fetches can legitimately appear on both.
        const seen = new Set(prev.map((c) => c._id))
        return [...prev, ...incoming.filter((c) => !seen.has(c._id))]
      })

      setConversationsPagination(res.data.pagination || null)

      return { success: true }
    } catch (err) {
      console.log('Load conversations error:', err)

      if (conversationsRequestRef.current !== requestGeneration) return { success: false }

      // Only a failed FIRST page raises the page-level error state.
      //
      // Settings renders its list behind `!conversationsError`, so setting it
      // here on an append would hide every row already on screen and replace
      // them with a whole-history error — the opposite of preserving them.
      // Keeping the array intact is not enough if the UI stops showing it.
      //
      // An append failure is reported through the returned { success: false },
      // which handleLoadMore() already turns into a toast, leaving the loaded
      // pages visible and Load More retryable.
      if (!append) setConversationsError(true)

      return { success: false }
    } finally {
      if (conversationsRequestRef.current === requestGeneration) {
        if (append) setConversationsLoadingMore(false)
        else setConversationsLoading(false)
      }
    }
  }

  /*
   * Drops whatever saved transcript is currently loaded.
   *
   * Bumping the generation is what stops an in-flight transcript GET or send
   * from resurrecting a conversation that has just been deleted. The bucket
   * is emptied rather than seeded with a welcome message because the widget
   * re-seeds an empty bucket itself, in the correct language for that page.
   */
  const clearSelectedTranscript = () => {
    const key = selectedConversationKeyRef.current

    conversationGenerationRef.current += 1
    setSelectedConversationId(null)
    selectedConversationKeyRef.current = null

    if (!key) return

    setChats((prev) => ({ ...prev, [key]: [] }))
    setFiltersByPage((prev) => ({ ...prev, [key]: {} }))
  }

  /*
   * Deletes ONE of the user's own saved chatbot conversations.
   *
   * Deliberately NOT optimistic: the row leaves local state only after the
   * server confirms, so a failed request keeps the conversation visible and
   * openable rather than vanishing from a list it still exists in.
   *
   * If the deleted conversation was the one currently loaded, the selection is
   * dropped so nothing holds a reference to an id the server no longer knows —
   * the next message then starts a fresh conversation instead of trying to
   * continue a deleted one.
   *
   * Returns { success } for the same reason loadConversation does: a caller
   * cannot read the state this sets until after the next render.
   */
  const deleteConversation = async (conversationId) => {
    try {
      await api.delete(`/chat/conversations/${conversationId}`)

      setConversations((prev) => prev.filter((c) => c._id !== conversationId))

      setConversationsPagination((prev) =>
        prev ? { ...prev, totalCount: Math.max((prev.totalCount ?? 1) - 1, 0) } : prev
      )

      // Only when the deleted conversation is the one on screen. Deleting a
      // different row from the history list must not wipe the chat the user
      // is currently reading.
      if (selectedConversationId === conversationId) clearSelectedTranscript()

      return { success: true }
    } catch (err) {
      console.log('Delete conversation error:', err)
      return { success: false }
    }
  }

  /*
   * Clears the user's entire saved chatbot history.
   *
   * Only the SAVED history goes; the widget stays usable and a new
   * conversation can be started immediately. `chats` (the in-memory
   * transcripts per page) is left alone on purpose — wiping what the user is
   * currently looking at is not what "clear history" asked for.
   */
  const deleteAllConversations = async () => {
    try {
      const res = await api.delete('/chat/conversations')

      setConversations([])
      setConversationsPagination(null)

      // Every saved conversation is gone, so a loaded saved transcript is now
      // orphaned. An UNSAVED session (no selected id) is not affected — it was
      // never part of the history that was cleared.
      if (selectedConversationId) clearSelectedTranscript()

      return { success: true, deletedCount: res.data?.deletedCount ?? 0 }
    } catch (err) {
      console.log('Clear conversations error:', err)
      return { success: false }
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
      selectedConversationKeyRef.current = key

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
        language,
      })

      const res = await api.post('/chat', {
        message: messageText,
        pageKey: key,
        history: historyForBackend,
        currentFilters,
        shownPropertyIds,
        lastShownProperties,
        conversationId: requestConversationId,
        language,
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
        conversationsPagination,
        conversationsLoadingMore,
        transcriptLoading,
        transcriptError,
        openChat,
        closeChat,
        toggleChat,
        getMessages,
        resetChat,
        syncWelcomeLanguage,
        startNewConversation,
        sendMessage,
        loadConversations,
        loadConversation,
        deleteConversation,
        deleteAllConversations,
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