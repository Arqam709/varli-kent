import { createContext, useContext, useState, useEffect, useRef } from 'react'
import api from '../lib/api'
import { useAuth } from './AuthContext'

/* ── Theme definitions ──────────────────────────────────────── */
export const THEMES = [
  {
    id: 'default',
    label: 'VarliKent Signature',
    description: 'Dark charcoal & forest green — the original',
    preview: { dark: '#1E1E1C', light: '#F6F3ED', accent: '#C9A35A' },
  },
  {
    id: 'forest',
    label: 'Bosphorus Pine',
    description: 'Layered deep-forest greens & aged brass, alternating with warm ivory and parchment',
    preview: { dark: '#0E1912', light: '#F6F1E7', accent: '#B08D57' },
  },
  {
    id: 'earth',
    label: 'Espresso & Terracotta',
    description: 'Layered espresso-brown depths & terracotta, alternating with warm cream and parchment',
    preview: { dark: '#2A1D15', light: '#F6EFE4', accent: '#C1652E' },
  },
  {
    id: 'navy',
    label: 'Bosphorus Midnight',
    description: 'Layered navy depths & vintage gold, alternating with cool cloud-white and pearl mist',
    preview: { dark: '#0B1421', light: '#FAFBFC', accent: '#C3A46B' },
  },
  {
    id: 'gold-white',
    label: 'Ivory & Antique Brass',
    description: 'Layered aubergine-espresso darks & antique brass, alternating with porcelain ivory and champagne',
    preview: { dark: '#211214', light: '#FBF7EF', accent: '#B8863B' },
  },
  {
    id: 'sand-travertine',
    label: 'Sand & Travertine',
    description: 'Sun-bleached beige, oat-milk and travertine stone, warmed by soft rose-copper accents — a boutique Bodrum villa in daylight.',
    preview: { dark: '#2B2420', light: '#F7F1E6', accent: '#B76E54' },
  },
  {
    id: 'rosewood-blush',
    label: 'Blush & Rosewood',
    description: 'A dusty-rose and antique rose-gold palette inspired by boutique-hotel marble lobbies — soft, muted, and unmistakably premium.',
    preview: { dark: '#1E1418', light: '#F7ECE8', accent: '#B08968' },
  },
  {
    id: 'blush-ivory',
    label: 'Blush & Ivory',
    description: 'Soft baby pink against crisp ivory white, finished with warm rose-gold accents — light, airy, and unmistakably feminine luxury.',
    preview: { dark: '#2B1E22', light: '#FFFBFC', accent: '#B76E79' },
  },
]

const THEME_IDS = THEMES.map(t => t.id)
const LEGACY_THEME_MAP = { classic: 'navy', dark: 'gold-white', light: 'default' }

export const normalizeThemeId = (value) => {
  const normalized = LEGACY_THEME_MAP[value] ?? value
  return THEME_IDS.includes(normalized) ? normalized : 'default'
}

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
  mutedOnDark: 'var(--vk-text-muted-on-dark, rgba(246,243,237,0.6))',
  faintOnDark: 'var(--vk-text-faint-on-dark, rgba(246,243,237,0.45))',
  navBg:     'var(--vk-nav-bg)',
  accent:    'var(--vk-green-brand)',
  textDark:  'var(--vk-text)',
  textLight: 'var(--vk-text-on-dark)',
  cardBg:    'var(--vk-card-bg)',
  border:    'var(--vk-border)',
  goldText:  'var(--vk-gold-text, #000000)',
}

const ThemeContext = createContext(null)

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('vk_theme')
    const normalized = normalizeThemeId(saved)
    if (saved !== normalized) localStorage.setItem('vk_theme', normalized)
    return normalized
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const { user } = useAuth()
  const appliedForUserRef = useRef(null)
  useEffect(() => {
    if (!user?._id) {
      appliedForUserRef.current = null
      return
    }
    if (appliedForUserRef.current === user._id) return
    appliedForUserRef.current = user._id

    const serverTheme = normalizeThemeId(user.themePreference)
    if (serverTheme !== theme) setThemeState(serverTheme)
    localStorage.setItem('vk_theme', serverTheme)
    document.documentElement.setAttribute('data-theme', serverTheme)
  }, [user, theme])

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
