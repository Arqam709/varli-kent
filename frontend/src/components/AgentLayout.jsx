import { useState, useEffect, useCallback } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useRealtime } from '../contexts/RealtimeContext'
import {
  HUMAN_UNREAD_EVENT,
  PROPERTY_MESSAGE_NEW_EVENT,
  getPropertyConversationUnreadCount,
} from '../lib/propertyMessagingApi'
import { useRecoveryReconcile } from '../lib/useRecoveryReconcile'

const LANGS = [{ code: 'en', label: 'EN' }, { code: 'tr', label: 'TR' }, { code: 'ar', label: 'AR' }]

const NAV_LINKS = [
  {
    to: '/agent/dashboard',
    label: 'Dashboard',
    icon: <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
  },
  {
    to: '/agent/properties',
    label: 'My Properties',
    icon: <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  },
  {
    to: '/agent/messages',
    label: 'Messages',
    // Human customer↔agent enquiries — NOT the AI assistant transcripts under
    // /admin/user-chats, and not admin contact messages.
    badge: 'humanUnread',
    icon: <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  },
  {
    to: '/agent/profile',
    label: 'Profile',
    icon: <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  },
]

export const AGENT_ROLE_LABEL = 'Agent'

const linkCls = ({ isActive }) =>
  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${isActive ? 'bg-[#4b6741] text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`

const Sidebar = ({ user, onNavigate, onLogout, humanUnread }) => (
  <div className="flex h-full flex-col" style={{ backgroundColor: '#202a36' }}>
    <div className="px-6 py-6 border-b border-slate-700">
      <Link to="/" className="block">
        <span style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold tracking-widest text-white hover:text-white/80 transition-colors">
          VARLI<span style={{ color: '#4b6741' }}>KENT</span>
        </span>
      </Link>
      <p className="mt-1 text-xs text-slate-500">Agent Portal</p>
    </div>

    <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
      {NAV_LINKS.map(l => (
        // No `end` prop: /agent/messages must stay highlighted while the agent
        // is inside /agent/messages/:id.
        <NavLink key={l.to} to={l.to} className={linkCls} onClick={onNavigate}>
          {l.icon}
          <span className="flex-1">{l.label}</span>
          {/* Gold, not the portal green: the active link's own background is
              that green, and a green-on-green badge would disappear exactly
              when the agent is looking at it. */}
          {l.badge === 'humanUnread' && humanUnread > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#d97706] px-1.5 text-[11px] font-bold text-white">
              {humanUnread > 99 ? '99+' : humanUnread}
            </span>
          )}
        </NavLink>
      ))}
    </nav>

    <div className="border-t border-slate-700 px-4 py-4">
      <div className="mb-3 flex items-center gap-3">
        {user?.avatar ? (
          <img src={user.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4b6741] text-sm font-bold text-white">
            {user?.name?.[0]?.toUpperCase() || 'A'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{user?.name}</p>
          <p className="truncate text-xs text-slate-500">{AGENT_ROLE_LABEL}</p>
        </div>
      </div>
      <button onClick={onLogout} className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-900/20 transition cursor-pointer">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        Logout
      </button>
    </div>
  </div>
)

const AgentLayout = ({ children }) => {
  const { user, logout, refreshUser, isAgent } = useAuth()
  const navigate = useNavigate()
  const realtime = useRealtime()
  const { language, setLanguage } = useLanguage()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [humanUnread, setHumanUnread] = useState(0)

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  
  // Returns the promise so useRecoveryReconcile's in-flight guard can actually
  // await it; without a return it would treat every call as instantly finished.
  const loadUnread = useCallback(
    () =>
      getPropertyConversationUnreadCount()
        .then(setHumanUnread)
        .catch(() => {}),
    []
  )

  useEffect(() => {
    if (!isAgent) return

    loadUnread()
    window.addEventListener(HUMAN_UNREAD_EVENT, loadUnread)
    return () => window.removeEventListener(HUMAN_UNREAD_EVENT, loadUnread)
  }, [isAgent, loadUnread])

  /*
   * Keep the Messages badge live.
   *
   * ── Why this re-reads the server instead of doing local arithmetic ──────
   * The badge is a TOTAL across every conversation, and the same event also
   * causes the open thread to PATCH itself read — so a local +1 would race the
   * clearing PATCH and could settle on the wrong number. Re-reading
   * /unread-count keeps ONE authoritative source (the same one this badge has
   * always used) instead of inventing a second that can drift from it.
   *
   * The cost is one small request per incoming message, which is the right
   * trade for a counter that must not lie. Sitting in AgentLayout rather than
   * in the Messages page means the badge also updates while the agent is on
   * Dashboard, Properties or Profile — the pages where a badge actually earns
   * its place.
   *
   * The listener is added only for agents, and removes only its own handler.
   */
  useEffect(() => {
    if (!isAgent) return undefined

    const socket = realtime?.socket?.current
    if (!socket) return undefined

    socket.on(PROPERTY_MESSAGE_NEW_EVENT, loadUnread)

    return () => {
      socket.off(PROPERTY_MESSAGE_NEW_EVENT, loadUnread)
    }
  }, [isAgent, realtime, realtime?.isConnected, loadUnread])

  /*
   * After a reconnect, re-read the authoritative total.
   *
   * Messages that arrived while the socket was away raised the server's counters
   * without this tab ever hearing about it. There is deliberately no local
   * arithmetic to catch up on — the server already knows the right number, so
   * this simply asks it. Nothing runs on the first connect.
   */
  useRecoveryReconcile(isAgent ? realtime?.recoveryVersion ?? 0 : 0, loadUnread)

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen bg-slate-100">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col overflow-hidden">
        <Sidebar user={user} onNavigate={closeSidebar} onLogout={handleLogout} />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="absolute inset-0 bg-black/50" onClick={closeSidebar} />
          <div className="relative w-64 h-full overflow-hidden">
            <Sidebar user={user} onNavigate={closeSidebar} onLogout={handleLogout} humanUnread={humanUnread} />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
          <button onClick={() => setSidebarOpen(true)} className="cursor-pointer text-slate-600 lg:hidden" aria-label="Open menu">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span style={{ fontFamily: 'Cinzel, serif' }} className="font-bold text-[#202a36] lg:hidden">VARLIKENT Agent</span>
          <div className="ml-auto flex items-center gap-1">
            {LANGS.map(l => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${language === l.code ? 'bg-[#202a36] text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}

export default AgentLayout
