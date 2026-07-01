import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const ProtectedRoute = ({ children, requiredRole }) => {
  const { isLoggedIn, isAdmin, isOwner, isLoading } = useAuth()

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
    </div>
  )

  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (requiredRole === 'admin' && !isAdmin) return <Navigate to="/" replace />
  if (requiredRole === 'owner' && !isOwner) return <Navigate to="/" replace />

  return children
}

export default ProtectedRoute
