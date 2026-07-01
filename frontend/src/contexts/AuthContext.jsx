import { createContext, useContext, useState, useEffect } from 'react'
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

  const isLoggedIn = !!user
  const isOwner = user?.role === 'owner'
  const isAdmin = user?.role === 'admin' || user?.role === 'owner'
  const hasPermission = (perm) => user?.role === 'owner' || user?.permissions?.includes(perm)

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isLoggedIn,
        isOwner,
        isAdmin,
        login,
        loginWithToken,
        microsoftLogin,
        register,
        logout,
        updateUser,
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
