import { PublicClientApplication } from '@azure/msal-browser'

const microsoftClientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID

if (!microsoftClientId) {
  console.error('Missing VITE_MICROSOFT_CLIENT_ID in frontend .env')
}

const productionOrigin = 'https://www.varlikent.com'

const appOrigin =
  window.location.hostname === 'localhost'
    ? window.location.origin
    : productionOrigin

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: microsoftClientId,
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: `${appOrigin}/blank.html`,
    postLogoutRedirectUri: appOrigin,
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