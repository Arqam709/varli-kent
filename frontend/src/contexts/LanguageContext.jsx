import { createContext, useContext, useState, useEffect } from 'react'
import translations from '../locales/translations'

const LanguageContext = createContext(null)

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => localStorage.getItem('vk_lang') || 'en')

  useEffect(() => {
    localStorage.setItem('vk_lang', language)
    document.documentElement.setAttribute('lang', language)
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
  }, [language])

  const t = translations[language] || translations.en

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
