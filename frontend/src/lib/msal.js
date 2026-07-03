import { PublicClientApplication } from '@azure/msal-browser'

const microsoftClientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID

if (!microsoftClientId) {
  console.error('Missing VITE_MICROSOFT_CLIENT_ID in frontend .env')
}

const authOrigin =
  window.location.hostname === 'localhost'
    ? window.location.origin
    : 'https://www.varlikent.com'

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: microsoftClientId,
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: `${authOrigin}/blank.html`,
    postLogoutRedirectUri: authOrigin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
  system: {
    windowHashTimeout: 60000,
    iframeHashTimeout: 60000,
    loadFrameTimeout: 60000,
  },
})

export const microsoftLoginRequest = {
  scopes: ['openid', 'profile', 'email'],
}