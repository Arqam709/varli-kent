import { createContext, useContext, useState } from 'react'
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

export const ChatProvider = ({ children }) => {
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState({})
  const [filtersByPage, setFiltersByPage] = useState({})
  const [loading, setLoading] = useState(false)

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

    try {
      const historyForBackend = cleanHistoryForBackend(updatedMessages).slice(-10)

      console.log('Sending chat payload:', {
        message: messageText,
        pageKey: key,
        currentFilters,
        history: historyForBackend,
        shownPropertyIds,
        lastShownProperties,
      })

      const res = await api.post('/chat', {
        message: messageText,
        pageKey: key,
        history: historyForBackend,
        currentFilters,
        shownPropertyIds,
        lastShownProperties,
      })

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
    } catch (err) {
      console.log('Chat error:', err)

      const errorMessage = {
        role: 'assistant',
        text: 'Sorry, I could not connect to the property database right now. Please try again.',
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
        openChat,
        closeChat,
        toggleChat,
        getMessages,
        resetChat,
        sendMessage,
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