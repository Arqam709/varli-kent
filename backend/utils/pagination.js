// Shared page/limit parsing, extracted because a third near-identical copy
// was about to be added (adminChats.js, chatConversations.js, and the new
// grouped users endpoint all need the exact same clamping rules). Status
// parsing is deliberately NOT unified here — admin and user-facing chat
// endpoints have intentionally different defaults ('active' vs 'all').

export const parsePage = (value) => {
  const parsed = parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

export const parseLimit = (value, defaultLimit = 20, maxLimit = 50) => {
  const parsed = parseInt(value, 10)
  if (!Number.isInteger(parsed)) return defaultLimit
  return Math.min(Math.max(parsed, 1), maxLimit)
}
