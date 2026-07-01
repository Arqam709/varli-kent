import React, { createContext, useContext, useState, useEffect } from 'react'
import { propertiesData, defaultMessages } from '../assets/assets'

const AdminAuthContext = createContext(null) //we create the context here

export const AdminAuthProvider = ({ children }) => {
  const [isManagerLoggedIn, setIsManagerLoggedIn] = useState(false)
  const [managerEmail, setManagerEmail] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [properties, setProperties] = useState([])
  const [messages, setMessages] = useState([])

  //it check the local storage for saved data
  useEffect(() => {
    try {
      const storedAuth = localStorage.getItem('adminAuth')
      const storedProperties = localStorage.getItem('adminProperties')
      const storedMessages = localStorage.getItem('adminMessages')
      /*
      Loading admin login
if (storedAuth) {
  const { isLoggedIn, email } = JSON.parse(storedAuth)
  setIsManagerLoggedIn(isLoggedIn)
  setManagerEmail(email)
}

If admin login data exists, it converts it from string to object.

Because localStorage stores data as string.

So this:

JSON.parse(storedAuth)

changes this string:

'{"isLoggedIn":true,"email":"manager@estate.com"}'

back into this object:

{
  isLoggedIn: true,
  email: 'manager@estate.com'
}

Then it updates the state:

setIsManagerLoggedIn(isLoggedIn)
setManagerEmail(email)

So even if you refresh the page, the admin can stay logged in.
      */
      if (storedAuth) {
        const { isLoggedIn, email } = JSON.parse(storedAuth)
        setIsManagerLoggedIn(isLoggedIn)
        setManagerEmail(email)
      }

      setProperties(storedProperties ? JSON.parse(storedProperties) : propertiesData)
      setMessages(storedMessages ? JSON.parse(storedMessages) : defaultMessages)
    } catch (error) {
      console.error('Error loading admin state:', error)
      setProperties(propertiesData)
      setMessages(defaultMessages)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveProperties = (nextProperties) => {
    setProperties(nextProperties)
    localStorage.setItem('adminProperties', JSON.stringify(nextProperties))
  }

  const saveMessages = (nextMessages) => {
    setMessages(nextMessages)
    localStorage.setItem('adminMessages', JSON.stringify(nextMessages))
  }

  const loginManager = (email, password) => {
    const MANAGER_EMAIL = 'manager@estate.com'
    const MANAGER_PASSWORD = 'manager123'

    if (email === MANAGER_EMAIL && password === MANAGER_PASSWORD) {
      setIsManagerLoggedIn(true)
      setManagerEmail(email)
      localStorage.setItem(
        'adminAuth',
        JSON.stringify({ isLoggedIn: true, email, timestamp: new Date().toISOString() })
      )
      return { success: true, message: 'Login successful' }
    }

    return { success: false, message: 'Invalid email or password' }
  }

  const logoutManager = () => {
    setIsManagerLoggedIn(false)
    setManagerEmail('')
    localStorage.removeItem('adminAuth')
  }

  const addProperty = (property) => {
    const nextProperties = [property, ...properties] //put the new property 
    saveProperties(nextProperties)
  }

  const updateProperty = (updatedProperty) => {
    const nextProperties = properties.map((property) =>
      //Keep old property data, but overwrite changed fields with updatedProperty.
      property.id === updatedProperty.id ? { ...property, ...updatedProperty } : property
    )
    saveProperties(nextProperties)
  }

  const deleteProperty = (id) => {
    const nextProperties = properties.filter((property) => property.id !== id)
    saveProperties(nextProperties)
  }

  const addLead = (lead) => {
    const nextMessages = [lead, ...messages]
    saveMessages(nextMessages)
  }

  const markMessageReplied = (id) => {
    const nextMessages = messages.map((message) =>
      message.id === id ? { ...message, status: 'Replied' } : message
    )
    saveMessages(nextMessages)
  }

  const value = {
    isManagerLoggedIn,
    managerEmail,
    isLoading,
    loginManager,
    logoutManager,
    properties,
    messages,
    addProperty,
    updateProperty,
    deleteProperty,
    addLead,
    markMessageReplied,
  }

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext)
  if (!context) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider')
  }
  return context
}

