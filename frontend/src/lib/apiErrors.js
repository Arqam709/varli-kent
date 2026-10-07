/*
 * Which catalogue message a failed API request should show.
 *
 * Decided from the HTTP status and the shape of the response — never from the
 * backend's `message`, which is an English sentence and free to be reworded.
 * That sentence stays on the error object for the console; it is just not what
 * a visitor reading Turkish, Arabic, German, Russian or Urdu is shown.
 *
 *   byStatus     { status: key } — statuses that mean one specific thing here
 *   general      the key for everything else, so an unforeseen status degrades
 *                to a translated "that failed" rather than to raw English
 *   network      the key for a request that left the browser and got no reply
 *   validation   optional key for express-validator rejections, which carry an
 *                `errors` array instead of a message
 *
 * lib/authErrors.js and lib/settingsErrors.js hold the tables.
 */
export const apiErrorKey = (error, { byStatus = {}, general, network, validation }) => {
  const response = error?.response

  if (!response) return error?.request ? network : general

  if (validation && Array.isArray(response.data?.errors)) return validation

  return byStatus[response.status] || general
}
