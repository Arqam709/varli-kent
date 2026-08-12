import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../lib/api'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = localStorage.getItem('varlikent_token')
        const storedUser = localStorage.getItem('varlikent_user')

        if (storedToken && storedUser) {
          setToken(storedToken)
          setUser(JSON.parse(storedUser))

          try {
            const res = await api.get('/auth/me')
            setUser(res.data.user || res.data)
            localStorage.setItem('varlikent_user', JSON.stringify(res.data.user || res.data))
          } catch {
            localStorage.removeItem('varlikent_token')
            localStorage.removeItem('varlikent_user')
            setToken(null)
            setUser(null)
          }
        }
      } catch {
        localStorage.removeItem('varlikent_token')
        localStorage.removeItem('varlikent_user')
        setToken(null)
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }

    restoreSession()
  }, [])

  const loginWithToken = (newUser, newToken) => {
    localStorage.setItem('varlikent_token', newToken)
    localStorage.setItem('varlikent_user', JSON.stringify(newUser))

    setToken(newToken)
    setUser(newUser)
  }

  const login = async (email, password) => {
    try {
      const res = await api.post('/auth/login', { email, password })
      const { token: newToken, user: newUser } = res.data

      loginWithToken(newUser, newToken)

      return { success: true, message: 'Login successful' }
    } catch (err) {
      const message = err.response?.data?.message || 'Login failed'
      return { success: false, message }
    }
  }

  const microsoftLogin = async (idToken) => {
    try {
      const res = await api.post('/auth/microsoft', { idToken })
      const { token: newToken, user: newUser } = res.data

      loginWithToken(newUser, newToken)

      return { success: true, message: 'Microsoft login successful' }
    } catch (err) {
      const message = err.response?.data?.message || 'Microsoft login failed'
      return { success: false, message }
    }
  }

  const register = async (name, email, password) => {
    try {
      const res = await api.post('/auth/register', { name, email, password })
      const { token: newToken, user: newUser } = res.data

      loginWithToken(newUser, newToken)

      return { success: true, message: 'Registration successful' }
    } catch (err) {
      const message = err.response?.data?.message || 'Registration failed'
      return { success: false, message }
    }
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // ignore errors on logout
    }

    localStorage.removeItem('varlikent_token')
    localStorage.removeItem('varlikent_user')
    setToken(null)
    setUser(null)
  }

  const updateUser = (userData) => {
    const updated = { ...user, ...userData }
    setUser(updated)
    localStorage.setItem('varlikent_user', JSON.stringify(updated))
  }

  /**
   * Re-reads the signed-in user from the server and refreshes the cached copy.
   *
   * Needed because fields can be changed by someone else while a session is
   * open — an administrator setting an agent's professional title, for
   * instance. Reuses the existing /auth/me rather than adding an endpoint.
   *
   * A failure is swallowed on purpose: the cached user stays as-is and the
   * page keeps working. Only session restoration (above) treats a 401 as
   * grounds for clearing the session.
   *
   * useCallback keeps the identity stable so callers can safely list it in a
   * useEffect dependency array.
   */
  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/auth/me')
      const fresh = res.data.user || res.data
      setUser(fresh)
      localStorage.setItem('varlikent_user', JSON.stringify(fresh))
      return fresh
    } catch {
      return null
    }
  }, [])

  const isLoggedIn = !!user
  const isOwner = user?.role === 'owner'
  const isAdmin = user?.role === 'admin' || user?.role === 'owner'
  // Deliberately NOT folded into isAdmin. An agent is staff, but not an
  // administrator — they get their own portal and none of /admin/*.
  const isAgent = user?.role === 'agent'
  const hasPermission = (perm) => user?.role === 'owner' || user?.permissions?.includes(perm)

  /**
   * Which staff portal (if any) this account's account menu should offer.
   *
   * Derived in ONE place because three separate call sites need the answer —
   * the desktop Navbar dropdown, the mobile Navbar drawer, and the Settings
   * quick links — and they were previously each hand-rolling their own role
   * check. `null` means "no staff portal", which is the normal-user case.
   *
   * Roles are mutually exclusive (the User schema enum allows exactly one), so
   * the order of these branches is a formality rather than a precedence rule.
   */
  const portal = isAdmin
    ? { to: '/admin/dashboard', label: 'Dashboard' }
    : isAgent
      ? { to: '/agent/dashboard', label: 'Agent Dashboard' }
      : null

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isLoggedIn,
        isOwner,
        isAdmin,
        isAgent,
        portal,
        login,
        loginWithToken,
        microsoftLogin,
        register,
        logout,
        updateUser,
        refreshUser,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export default AuthContext
