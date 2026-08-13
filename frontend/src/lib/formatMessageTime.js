/**
 * Timestamp formatting for human property messages.
 *
 * Hand-rolled on Intl rather than adding a date library: the website has no
 * date dependency today and these are the only two shapes the messaging
 * surfaces need. AdminUserChats.jsx has near-identical local helpers, but they
 * are for a different surface with different rules (relative "3d" ages), so
 * they are deliberately not merged here.
 */

const DAY_MS = 86400000

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const toDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const timeOf = (date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Whole calendar days between `date` and today. 0 = today, 1 = yesterday. */
const daysAgo = (date) => Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY_MS)

/**
 * Inside a message bubble: "10:43" for today, "12 Aug, 10:43" for anything
 * older. The date is only spelled out when it is genuinely ambiguous.
 */
export const formatMessageTime = (value) => {
  const date = toDate(value)
  if (!date) return ''

  if (daysAgo(date) === 0) return timeOf(date)

  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${timeOf(date)}`
}

/**
 * On an inbox row, where the timestamp shares a line with the customer name —
 * so it stays as short as it can while remaining unambiguous.
 */
export const formatConversationTime = (value) => {
  const date = toDate(value)
  if (!date) return ''

  const days = daysAgo(date)
  if (days === 0) return timeOf(date)
  if (days === 1) return 'Yesterday'
  if (days < 365) return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The separator that marks a change of calendar day inside a thread. */
export const formatDayDivider = (value) => {
  const date = toDate(value)
  if (!date) return ''

  const days = daysAgo(date)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}
