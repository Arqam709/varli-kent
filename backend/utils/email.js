import nodemailer from 'nodemailer'
import LeadRouting from '../models/LeadRouting.js'

const makeTransporter = () => {
  const port = Number(process.env.EMAIL_PORT) || 587
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  })
}

const leadEmailHtml = (submission) => `
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
    <div class="badge">New Lead · ${submission.interestType}</div>
  </div>
  <div class="body">
    <div class="section-label">From</div>
    <div class="value"><strong>${submission.name}</strong></div>

    <div class="section-label">Contact</div>
    <div class="value">
      📧 <a href="mailto:${submission.email}" style="color:#4b6741;">${submission.email}</a><br/>
      📞 <a href="tel:${submission.phone}" style="color:#4b6741;">${submission.phone}</a>
    </div>

    <div class="section-label">Interested In</div>
    <div class="value">${submission.interestType}</div>

    <div class="section-label">Message</div>
    <div class="message-box">${submission.message}</div>

    <div class="actions">
      <a class="btn btn-primary" href="mailto:${submission.email}?subject=Re: Your Varlikent Inquiry">Reply by Email</a>
      <a class="btn btn-secondary" href="tel:${submission.phone}">Call ${submission.phone}</a>
    </div>
  </div>
  <div class="footer">
    Received ${new Date(submission.createdAt || Date.now()).toLocaleString()} · Varlikent Admin System
  </div>
</div>
</body>
</html>
`

const passwordResetEmailHtml = (resetUrl) => `
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
    <a href="${resetUrl}" class="btn">Reset Password</a>
    <p class="notice">This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email — your password will not be changed.</p>
  </div>
  <div class="footer">
    Varlikent · Istanbul Luxury Real Estate
  </div>
</div>
</body>
</html>
`

export const sendContactNotification = async (submission) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false

  try {
    const transporter = makeTransporter()

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

    await transporter.sendMail({
      from: `"Varlikent Leads" <${process.env.EMAIL_USER}>`,
      to: toList.join(', '),
      subject: `New Lead: ${submission.interestType} — ${submission.name}`,
      html: leadEmailHtml(submission),
    })

    return true
  } catch (err) {
    console.error('Failed to send contact notification email:', err.message)
    return false
  }
}

export const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false

  try {
    const transporter = makeTransporter()
    await transporter.sendMail({
      from: `"Varlikent" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Reset your Varlikent password',
      html: passwordResetEmailHtml(resetUrl),
    })
    return true
  } catch (err) {
    console.error('Failed to send password reset email:', err.message, err.response || '')
    return false
  }
}
