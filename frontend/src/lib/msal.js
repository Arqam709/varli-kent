import { PublicClientApplication } from '@azure/msal-browser'

const microsoftClientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID

if (!microsoftClientId) {
  console.error('Missing VITE_MICROSOFT_CLIENT_ID in frontend .env')
}

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: microsoftClientId,
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: `${window.location.origin}/login`,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
})

export const microsoftLoginRequest = {
  scopes: ['openid', 'profile', 'email'],
}