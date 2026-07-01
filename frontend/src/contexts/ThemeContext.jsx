import { createContext, useContext, useState, useEffect } from 'react'
import api from '../lib/api'

/* ── Theme definitions ──────────────────────────────────────── */
export const THEMES = [
  {
    id: 'default',
    label: 'VarliKent Signature',
    description: 'Dark charcoal & forest green — the original',
    preview: { dark: '#1E1E1C', light: '#F6F3ED', accent: '#C9A35A' },
  },
  {
    id: 'classic',
    label: 'Heritage Navy',
    description: 'Deep navy & cream with gold accents',
    preview: { dark: '#101B2D', light: '#F6F0E6', accent: '#C9A35A' },
  },
  {
    id: 'dark',
    label: 'Dark Luxury',
    description: 'Obsidian backgrounds with warm gold',
    preview: { dark: '#0E1110', light: '#202622', accent: '#D1A85B' },
  },
  {
    id: 'light',
    label: 'Light Luxury',
    description: 'Warm ivory & forest green — refined and airy',
    preview: { dark: '#314B35', light: '#FBF8F1', accent: '#C4A15A' },
  },
  {
    id: 'forest',
    label: 'Forest Green',
    description: 'Rich forest greens with cream & gold',
    preview: { dark: '#263D2C', light: '#EEF3EA', accent: '#C9A35A' },
  },
]

const THEME_IDS = THEMES.map(t => t.id)

/* ── Static C object — CSS variable references ──────────────── */
export const C = {
  charcoal:  'var(--vk-section-dark)',
  darkGrey:  'var(--vk-section-dark-alt)',
  gold:      'var(--vk-gold)',
  goldHover: 'var(--vk-gold-hover)',
  green:     'var(--vk-green)',
  deepGreen: 'var(--vk-green-deep)',
  marble:    'var(--vk-section-light)',
  softWhite: 'var(--vk-section-light-alt)',
  muted:     'var(--vk-text-muted)',
  navBg:     'var(--vk-nav-bg)',
  accent:    'var(--vk-green-brand)',
  textDark:  'var(--vk-text)',
  textLight: 'var(--vk-text-on-dark)',
  cardBg:    'var(--vk-card-bg)',
  border:    'var(--vk-border)',
}

const ThemeContext = createContext(null)

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('vk_theme')
    return THEME_IDS.includes(saved) ? saved : 'default'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = async (newTheme) => {
    if (!THEME_IDS.includes(newTheme)) return
    setThemeState(newTheme)
    localStorage.setItem('vk_theme', newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    const token = localStorage.getItem('varlikent_token')
    if (token) {
      try {
        await api.put('/users/me/theme', { theme: newTheme })
      } catch {}
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/* Legacy compat — returns static C (hook form kept for imports that still use it) */
export const useThemePalette = () => C

export default ThemeContext
