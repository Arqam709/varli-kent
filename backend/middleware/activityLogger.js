import ActivityLog from '../models/ActivityLog.js'

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

// Paths whose admin actions aren't meaningful to log (self-service account
// endpoints, public-facing writes, and anything read-only).
const SKIP_PREFIXES = ['/api/users/me/', '/api/users/favourites', '/api/auth/', '/api/chat', '/api/upload', '/api/property-conversations', '/api/notifications', '/api/property-alerts', '/api/agent']

const ACTION_BY_METHOD = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' }

// Friendlier verbs for a handful of well-known non-CRUD endpoints.
const SPECIAL_ACTIONS = {
  'users/role': 'changed the role of',
  'users/permissions': 'updated permissions for',
  'users/password': 'changed the password for',
  'users/request-owner-removal': 'requested removal of an owner',
  'users/confirm-owner-removal': 'removed an owner',
  'contact/status': 'updated the status of a lead',
  'chats': 'deleted a chatbot conversation',
  'chats/user': "cleared a user's chatbot history",
}

function describe(method, path) {
  const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean)

  // Everything mounted under /api/admin/* would otherwise report the resource
  // 'admin', which tells a reader of the activity feed nothing. The segment
  // after it is the real subject ('chats', 'property-assistant').
  if (segments[0] === 'admin' && segments[1]) segments.shift()

  const resource = segments[0] || 'unknown'
  const rest = segments.slice(1).filter(s => !OBJECT_ID_RE.test(s))
  const specialKey = [resource, ...rest].join('/')
  const action = SPECIAL_ACTIONS[specialKey] || ACTION_BY_METHOD[method] || 'modified'
  return { resource, action }
}

// Registered early, before any routers. It doesn't act on the request
// itself — it just watches for the response to finish, and by then any
// route-level `protect` middleware further down the chain has already
// populated req.user, so this catches every mutating admin/owner action
// across the whole API from a single place.
export default function activityLogger(req, res, next) {
  res.on('finish', () => {
    try {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return
      if (!req.path.startsWith('/api/')) return
      if (SKIP_PREFIXES.some(p => req.path.startsWith(p))) return
      if (res.statusCode >= 400) return
      const user = req.user
      if (!user || (user.role !== 'admin' && user.role !== 'owner')) return

      const { resource, action } = describe(req.method, req.path)
      ActivityLog.create({
        actorId: user._id,
        actorName: user.name,
        actorEmail: user.email,
        actorRole: user.role,
        method: req.method,
        path: req.path,
        resource,
        action,
        statusCode: res.statusCode,
      }).catch(err => console.error('Activity log write failed:', err.message))
    } catch (err) {
      console.error('Activity logger error:', err.message)
    }
  })
  next()
}
