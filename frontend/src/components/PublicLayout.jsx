import Navbar from './Navbar'
import Footer from './Footer'
import AIChatbot from './AIChatbot'
import { C } from '../contexts/ThemeContext'

const PublicLayout = ({ children, dark = false }) => {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: dark ? C.charcoal : C.softWhite,
        color: dark ? C.textLight : C.textDark,
        backgroundImage: dark && C.glow ? C.glow : undefined,
      }}
    >
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer dark={dark} />

      <AIChatbot />
    </div>
  )
}

export default PublicLayout
