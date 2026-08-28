import LeadRouting from '../models/LeadRouting.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))

/** Maps every C0 control character (and DEL) to a space, by code point. */
const stripControlChars = (value) =>
  Array.from(String(value ?? ''), (char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : char
  }).join('')


export const safeHeaderText = (value) =>
  stripControlChars(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)

const safeErrorDetail = async (response) => {
  try {
    const body = await response.json()
    const name = typeof body?.name === 'string' ? body.name : ''
    const message = typeof body?.message === 'string' ? body.message.slice(0, 200) : ''
    return [name, message].filter(Boolean).join(': ') || '(no detail)'
  } catch {
    return '(unparseable error body)'
  }
}

/**
 * Hands one finished email to Resend over HTTPS.
 *
 * The single delivery path for the whole backend. Callers build their own
 * subject and HTML and know nothing about the provider, which is what makes
 * swapping providers a change to this function alone.
 *
 * ── What is never logged ─────────────────────────────────────────────────
 * Not the API key, not the HTML, not the request body, and not the recipient.
 * The reset email's HTML embeds the raw reset token; anything that printed the
 * body would hand a log reader the ability to take over an account, which is
 * precisely the property that storing only the token's SHA-256 hash exists to
 * protect. Recipients stay out for the same reason the HTTP response omits
 * them: this endpoint must not become a way to learn who has an account.
 *
 * @param {{to: string|string[], subject: string, html: string}} message
 * @returns {Promise<boolean>} true only when Resend accepted the message.
 */
const sendEmailViaResend = async ({ to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  // Named separately so a misconfigured deploy says which variable is missing.
  // Under the old SMTP code this case returned false with no log line at all,
  // which is exactly the kind of silence that makes an outage hard to explain.
  if (!apiKey) {
    console.error('[email] RESEND_API_KEY is not configured — no email sent')
    return false
  }
  if (!from) {
    console.error('[email] EMAIL_FROM is not configured — no email sent')
    return false
  }

  // Resend accepts a string or an array; always sending an array keeps one
  // shape for the single-recipient reset email and the multi-recipient lead
  // notification. The API caps recipients at 50.
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean)

  if (recipients.length === 0) {
    console.error('[email] no recipients resolved — no email sent')
    return false
  }

  let response

  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Resend rejects direct API calls that do not identify themselves.
        'User-Agent': 'varlikent-backend/1.0',
      },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    })
  } catch (err) {
    // The request never completed: DNS, TLS, socket. Distinct from Resend
    // answering with a rejection, and worth telling apart in the logs.
    console.error('[email] Resend request failed to complete:', err.message)
    return false
  }

  if (!response.ok) {
    console.error(
      `[email] Resend rejected the message: status=${response.status} ${await safeErrorDetail(response)}`
    )
    return false
  }

  return true
}

/**
 * Builds the lead-notification email body.
 *
 * ── Every interpolation below is escaped ─────────────────────────────────
 * `submission` is a ContactSubmission, and both paths that produce one carry
 * visitor-supplied text: POST /api/contact (name/email/phone/message straight
 * off the public form) and services/chatLeadFlow.js's submitLead(), whose
 * `message` embeds the visitor's own chat words verbatim. express-validator
 * checks that those fields are PRESENT and that `email` parses; neither it nor
 * the Mongoose schema constrains their CONTENT, so `<img src=x onerror=...>`
 * in any of them reached this template intact.
 *
 * `interestType` is the one field a schema enum genuinely pins down, and it is
 * escaped anyway: "every dynamic value in this template is escaped" is an
 * invariant a reader can check at a glance, where "all but one are" is a
 * question. The cost is nothing; a value with no special characters escapes to
 * itself.
 *
 * `createdAt` is likewise escaped after formatting even though
 * `new Date(...).toLocaleString()` cannot emit markup — an unparseable value
 * yields the literal "Invalid Date" — so the invariant holds without an
 * exception to explain.
 *
 * Exported for tests only; nothing else imports it. Making a pure template
 * builder addressable changes no runtime behaviour.
 */
export const leadEmailHtml = (submission) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { margin:0; padding:0; background:#f4f4f4; font-family: Georgia, serif; }
  .wrap { max-width:600px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 16px rgba(0,0,0,0.08); }
  .header { background:#1E1E1C; padding:28px 36px; }
  .logo { font-size:18px; letter-spacing:0.2em; color:#fff; font-weight:bold; }
  .logo span { color:#4b6741; }
  .badge { display:inline-block; margin-top:8px; background:#4b6741; color:#fff; font-size:11px; padding:4px 12px; border-radius:20px; letter-spacing:0.1em; text-transform:uppercase; }
  .body { padding:32px 36px; }
  .section-label { font-size:10px; text-transform:uppercase; letter-spacing:0.2em; color:#888; margin-bottom:4px; }
  .value { font-size:15px; color:#1E1E1C; margin-bottom:20px; }
  .message-box { background:#f9f9f7; border-left:3px solid #4b6741; padding:16px 20px; border-radius:0 8px 8px 0; font-size:14px; color:#333; line-height:1.7; margin-top:4px; margin-bottom:24px; }
  .actions { margin-top:28px; border-top:1px solid #eee; padding-top:24px; display:flex; gap:12px; flex-wrap:wrap; }
  .btn { display:inline-block; padding:10px 20px; border-radius:6px; font-size:13px; text-decoration:none; font-weight:bold; }
  .btn-primary { background:#1E1E1C; color:#fff; }
  .btn-secondary { background:#fff; color:#1E1E1C; border:1px solid #ddd; }
  .footer { background:#f9f9f7; padding:16px 36px; font-size:11px; color:#aaa; border-top:1px solid #eee; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">VARLI<span>KENT</span></div>
    <div class="badge">New Lead · ${escapeHtml(submission.interestType)}</div>
  </div>
  <div class="body">
    <div class="section-label">From</div>
    <div class="value"><strong>${escapeHtml(submission.name)}</strong></div>

    <div class="section-label">Contact</div>
    <div class="value">
      📧 <a href="mailto:${escapeHtml(submission.email)}" style="color:#4b6741;">${escapeHtml(submission.email)}</a><br/>
      📞 <a href="tel:${escapeHtml(submission.phone)}" style="color:#4b6741;">${escapeHtml(submission.phone)}</a>
    </div>

    <div class="section-label">Interested In</div>
    <div class="value">${escapeHtml(submission.interestType)}</div>

    <div class="section-label">Message</div>
    <div class="message-box">${escapeHtml(submission.message)}</div>

    <div class="actions">
      <a class="btn btn-primary" href="mailto:${escapeHtml(submission.email)}?subject=Re: Your Varlikent Inquiry">Reply by Email</a>
      <a class="btn btn-secondary" href="tel:${escapeHtml(submission.phone)}">Call ${escapeHtml(submission.phone)}</a>
    </div>
  </div>
  <div class="footer">
    Received ${escapeHtml(new Date(submission.createdAt || Date.now()).toLocaleString())} · Varlikent Admin System
  </div>
</div>
</body>
</html>
`

/**
 * Builds the password-reset email body.
 *
 * `resetUrl` is assembled in routes/auth.js as
 * `${FRONTEND_URL}/reset-password?token=${rawToken}`, where rawToken is 32
 * random bytes rendered as hex — so in practice it contains no character this
 * escapes. It is escaped regardless, because the safety of the one
 * interpolation in this template should not rest on a claim about a value
 * built in another file: FRONTEND_URL is operator-supplied, and the day the
 * link grows a second query parameter its `&` must become `&amp;` to be valid
 * HTML anyway.
 *
 * ── The link keeps working ───────────────────────────────────────────────
 * HTML escaping inside a quoted href is an ENCODING, not a rewrite. A client
 * decodes the entity before following the link, so `?token=abc&x=1` written as
 * `?token=abc&amp;x=1` is fetched as `?token=abc&x=1`. The URL the user lands
 * on is unchanged, which is what the reset flow depends on.
 *
 * Exported for tests only. The token itself never appears in a log here or in
 * sendEmailViaResend(), and that stays true.
 */
export const passwordResetEmailHtml = (resetUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { margin:0; padding:0; background:#f4f4f4; font-family: Georgia, serif; }
  .wrap { max-width:600px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 16px rgba(0,0,0,0.08); }
  .header { background:#1E1E1C; padding:28px 36px; }
  .logo { font-size:18px; letter-spacing:0.2em; color:#fff; font-weight:bold; }
  .logo span { color:#4b6741; }
  .body { padding:40px 36px; }
  h2 { font-size:22px; color:#1E1E1C; margin:0 0 12px; }
  p { font-size:14px; color:#555; line-height:1.7; margin:0 0 20px; }
  .btn { display:inline-block; background:#4b6741; color:#fff; padding:14px 32px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:bold; letter-spacing:0.03em; }
  .notice { font-size:12px; color:#aaa; margin-top:28px; }
  .footer { background:#f9f9f7; padding:16px 36px; font-size:11px; color:#aaa; border-top:1px solid #eee; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">VARLI<span>KENT</span></div>
  </div>
  <div class="body">
    <h2>Reset Your Password</h2>
    <p>We received a request to reset the password for your Varlikent account. Click the button below to choose a new password.</p>
    <a href="${escapeHtml(resetUrl)}" class="btn">Reset Password</a>
    <p class="notice">This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email — your password will not be changed.</p>
  </div>
  <div class="footer">
    Varlikent · Istanbul Luxury Real Estate
  </div>
</div>
</body>
</html>
`

/**
 * Notifies the sales recipients about a new lead.
 *
 * Routing is unchanged: OWNER_EMAIL plus whatever LeadRouting holds for this
 * interest type, de-duplicated through a Set. Only the delivery call differs.
 */
export const sendContactNotification = async (submission) => {
  try {
    const recipientSet = new Set()
    if (process.env.OWNER_EMAIL) recipientSet.add(process.env.OWNER_EMAIL)

    try {
      const routing = await LeadRouting.findOne({ interestType: submission.interestType })
      if (routing?.recipients?.length) {
        routing.recipients.forEach(r => r.email && recipientSet.add(r.email))
      }
    } catch (_) { /* routing lookup failure should not block submission */ }

    const toList = [...recipientSet]
    if (toList.length === 0) return false

    return await sendEmailViaResend({
      to: toList,
      // A subject is a header, not HTML — see safeHeaderText(). `name` is
      // visitor-supplied and is the reason this is not a plain interpolation;
      // `interestType` gets the same treatment so the rule reads uniformly.
      // Deliberately NOT escapeHtml(): a lead from "Tom & Jerry" must arrive
      // reading "Tom & Jerry", not "Tom &amp; Jerry".
      subject: `New Lead: ${safeHeaderText(submission.interestType)} — ${safeHeaderText(submission.name)}`,
      html: leadEmailHtml(submission),
    })
  } catch (err) {
    console.error('[email] Failed to prepare contact notification:', err.message)
    return false
  }
}

/**
 * Emails a password-reset link.
 *
 * Signature and return contract are unchanged, so routes/auth.js needed no
 * edit: it still awaits a boolean and still logs only that boolean.
 *
 * `resetUrl` embeds the raw reset token. It is passed straight into the
 * template and is never logged here or anywhere below it.
 */
export const sendPasswordResetEmail = async (toEmail, resetUrl) =>
  sendEmailViaResend({
    to: toEmail,
    subject: 'Reset your Varlikent password',
    html: passwordResetEmailHtml(resetUrl),
  })
