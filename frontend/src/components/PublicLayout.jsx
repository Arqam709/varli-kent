import Navbar from './Navbar'
import Footer from './Footer'
import AIChatbot from './AIChatbot'
import { C } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'

const PublicLayout = ({ children, dark = false }) => {
  const { t } = useLanguage()

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: dark ? C.charcoal : C.softWhite,
        color: dark ? C.textLight : C.textDark,
        backgroundImage: dark && C.glow ? C.glow : undefined,
      }}
    >
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[100] rounded bg-white px-4 py-2 text-slate-900 shadow-lg focus:not-sr-only"
      >
        {t.accessibility?.skipToContent || 'Skip to content'}
      </a>
      <Navbar />
      <main id="main-content" tabIndex="-1" className="flex-1">{children}</main>
      <Footer dark={dark} />

      <AIChatbot />
    </div>
  )
}

export default PublicLayout
