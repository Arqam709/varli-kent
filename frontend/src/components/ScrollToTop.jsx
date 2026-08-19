import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// React Router doesn't reset scroll position on navigation the way a
// classic multi-page site does — clicking a nav link while scrolled down
// on the current page leaves the next page scrolled to the same offset,
// which can land the visitor mid-page (or past the end) on a shorter page.
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
