import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * Route guard for the two staff portals and for logged-in-only public pages.
 *
 * This is UX, not security. The real boundary is `protect` + `requireRole` on
 * the backend — someone who edits their cached user in localStorage can render
 * a portal shell and will then be refused by every endpoint it calls.
 *
 * ── Fail CLOSED ──────────────────────────────────────────────────────────
 * This used to be a chain of `if (requiredRole === 'admin' && !isAdmin)`
 * checks, which meant an unrecognised role name matched no branch and fell
 * through to `return children` — admitting every logged-in user. Harmless
 * while only 'admin' and 'owner' were ever passed, but a third role (or a
 * typo like 'Admin') would have silently opened the route to customers.
 *
 * The guard map below inverts that: a requiredRole with no entry resolves to
 * undefined, which denies. New roles must be added here deliberately.
 */
const ProtectedRoute = ({ children, requiredRole }) => {
  const { isLoggedIn, isAdmin, isOwner, isAgent, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
    </div>
  )

  // `state.from` is what LoginPage already reads to send the user back where
  // they were headed. Without it every deep link landed on the homepage after
  // signing in.
  if (!isLoggedIn) return <Navigate to="/login" replace state={{ from: location }} />

  if (requiredRole) {
    const ROLE_GUARDS = {
      admin: isAdmin,   // admin OR owner
      owner: isOwner,
      agent: isAgent,   // strictly agent — admins and owners are NOT agents
    }

    if (!ROLE_GUARDS[requiredRole]) return <Navigate to="/" replace />
  }

  return children
}

export default ProtectedRoute
