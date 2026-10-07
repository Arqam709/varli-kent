import { apiErrorKey } from './apiErrors.js'

/*
 * Which `auth` catalogue message a failed sign-in or sign-up should show.
 * The rule itself — status and response shape, never the backend's English
 * sentence — is lib/apiErrors.js; this file is the table for the auth routes.
 *
 *   flow        which request failed: 'login' | 'register' | 'google' | 'microsoft'
 *   error       the axios error (or, for Microsoft, an MSAL error)
 *   returns     a key of translations[lang].auth
 */

// Statuses that mean one specific thing for a flow. Anything not listed gets
// that flow's general message.
const BY_STATUS = {
  login: { 401: 'invalidCredentials' },
  // The only non-validation 400 the register route sends is a taken address.
  register: { 400: 'emailInUse' },
  // 403 is the backend refusing this particular account (deactivated,
  // unverified, or not allowed to use this provider).
  google: { 403: 'accountUnavailable' },
  microsoft: { 403: 'accountUnavailable' },
}

const GENERAL = {
  login: 'signInFailed',
  register: 'registrationFailed',
  google: 'googleSignInFailed',
  microsoft: 'microsoftSignInFailed',
}

export const authErrorKey = (flow, error) =>
  apiErrorKey(error, {
    byStatus: BY_STATUS[flow],
    general: GENERAL[flow],
    network: 'networkError',
    validation: 'checkDetails',
  })
