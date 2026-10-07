/*
 * Which `auth` catalogue message a failed sign-in or sign-up should show.
 *
 * Decided from the HTTP status and the shape of the response — never from the
 * backend's `message`, which is an English sentence and free to be reworded.
 * That sentence is still on the error object for the console; it is just not
 * what a visitor reading Turkish, Arabic, German, Russian or Urdu is shown.
 *
 *   flow        which request failed: 'login' | 'register' | 'google' | 'microsoft'
 *   error       the axios error (or, for Microsoft, an MSAL error)
 *   returns     a key of translations[lang].auth
 */

// Statuses that mean one specific thing for a flow. Anything not listed gets
// that flow's general message, so a new backend status degrades to "sign in
// failed" in the visitor's language rather than to raw English.
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

export const authErrorKey = (flow, error) => {
  const response = error?.response

  // The request left the browser and nothing came back.
  if (!response) return error?.request ? 'networkError' : GENERAL[flow]

  // express-validator rejections carry an `errors` array instead of a message.
  if (Array.isArray(response.data?.errors)) return 'checkDetails'

  return BY_STATUS[flow]?.[response.status] || GENERAL[flow]
}
