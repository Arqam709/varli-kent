import { createContext, useContext, useState, useEffect } from 'react'
import api from '../lib/api'

const DEFAULT = {
  email: 'info@varlikent.com',
  phone: '+90 530 123 4567',
  whatsapp: '905301234567',
  address: 'Nispetiye Cd. No:12, Levent, 34330 Beşiktaş/İstanbul, Türkiye',
  mapsUrl: 'https://maps.google.com/?q=Levent+Besiktas+Istanbul',
  instagram: '',
  linkedin: '',
  showroomEnabled: { architecture: true, interior: true, construction: true, renovation: true },
}

const SiteSettingsContext = createContext(DEFAULT)

export const SiteSettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(DEFAULT)

  useEffect(() => {
    api.get('/settings')
      .then(r => { if (r.data.settings) setSettings(r.data.settings) })
      .catch(() => {})
  }, [])

  return (
    <SiteSettingsContext.Provider value={{ settings, setSettings }}>
      {children}
    </SiteSettingsContext.Provider>
  )
}

export const useSiteSettings = () => useContext(SiteSettingsContext)
