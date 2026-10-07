import { apiErrorKey } from './apiErrors.js'

/*
 * Which `settingsPage` catalogue message a failed profile or password save
 * should show — the Settings table for lib/apiErrors.js.
 *
 *   action      'profile' | 'password'
 *   error       the axios error
 *   returns     a key of translations[lang].settingsPage
 *
 * Two statuses are only unambiguous because of what SettingsPage checks before
 * it sends anything, so those checks and this table have to stay in step:
 *
 *   profile 400    The route answers 400 for an empty request or a taken
 *                  address. The form never sends an empty name, so what is
 *                  left is the address.
 *   password 400   The route answers 400 for missing fields, a short or
 *                  mismatched new password, or an account that has no password
 *                  to change (one created through Google or Microsoft). The
 *                  form rejects the first three itself, so what is left is the
 *                  last.
 *
 * profile 403 is the server declining to change this account's address here.
 * What the server allows is not this file's business — only the wording.
 */
const RULES = {
  profile: {
    byStatus: { 400: 'toastEmailInUse', 403: 'toastEmailLocked' },
    general: 'toastProfileFailed',
  },
  password: {
    byStatus: { 400: 'toastPasswordNotSet', 401: 'toastCurrentPasswordIncorrect' },
    general: 'toastPasswordFailed',
  },
}

export const settingsErrorKey = (action, error) =>
  apiErrorKey(error, { ...RULES[action], network: 'toastNetworkError' })
