import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { MsalProvider } from '@azure/msal-react'

import App from './App.jsx'
import './index.css'

import { AuthProvider } from './contexts/AuthContext.jsx'
import { FavouritesProvider } from './contexts/FavouritesContext.jsx'
import { LanguageProvider } from './contexts/LanguageContext.jsx'
import { ChatProvider } from './contexts/ChatContext.jsx'
import LoadingScreen from './components/LoadingScreen.jsx'

import { msalInstance } from './lib/msal.js'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

if (!googleClientId) {
  console.error('Missing VITE_GOOGLE_CLIENT_ID in frontend .env')
}

function Root() {
  const [ready, setReady] = useState(false)

  return (
    <>
      {!ready && <LoadingScreen onComplete={() => setReady(true)} />}

      <div style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.4s ease' }}>
        <App />
      </div>
    </>
  )
}

msalInstance.initialize().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <GoogleOAuthProvider clientId={googleClientId}>
          <LanguageProvider>
            <AuthProvider>
              <FavouritesProvider>
                <ChatProvider>
                  <Root />
                </ChatProvider>
              </FavouritesProvider>
            </AuthProvider>
          </LanguageProvider>
        </GoogleOAuthProvider>
      </MsalProvider>
    </React.StrictMode>
  )
})
