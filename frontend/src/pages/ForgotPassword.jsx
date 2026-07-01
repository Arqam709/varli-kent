import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { assets } from '../assets/assets'
import { useLanguage } from '../contexts/LanguageContext'

const RESEND_COOLDOWN = 60

const ForgotPassword = () => {
  const { t } = useLanguage()
  const p = t.forgotPasswordPage

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const sendLink = async () => {
    if (!email.trim()) {
      setError(p.emailRequired)
      return
    }

    setLoading(true)
    setError('')

    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
      setCooldown(RESEND_COOLDOWN)
    } catch (err) {
      setError(err.response?.data?.message || p.genericError)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = e => {
    e.preventDefault()
    sendLink()
  }

  const handleResend = async () => {
    if (cooldown > 0 || loading) return

    setLoading(true)
    setError('')

    try {
      await api.post('/auth/forgot-password', { email })
      setCooldown(RESEND_COOLDOWN)
    } catch {
      setError(p.resendError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div
        className="hidden lg:block relative overflow-hidden"
        style={{ backgroundColor: '#202a36' }}
      >
        <img
          src={assets.header_img}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />

        <div className="relative z-10 flex flex-col h-full items-center justify-center p-12 text-center text-white">
          <span
            style={{ fontFamily: 'Cinzel, serif' }}
            className="text-3xl font-bold tracking-widest"
          >
            VARLI<span style={{ color: '#4b6741' }}> KENT</span>
          </span>

          <h2
            style={{ fontFamily: 'Cinzel, serif' }}
            className="mt-8 text-4xl font-semibold"
          >
            {p.heroTitle}
          </h2>

          <p className="mt-4 text-slate-400 max-w-sm">
            {p.heroSubtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden block mb-8 text-center">
            <span
              style={{ fontFamily: 'Cinzel, serif' }}
              className="text-2xl font-bold text-[#202a36]"
            >
              VARLI<span style={{ color: '#4b6741' }}> KENT</span>
            </span>
          </Link>

          <div className="mb-6">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              {p.backToSignIn}
            </Link>
          </div>

          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>

              <h1
                style={{ fontFamily: 'Cinzel, serif' }}
                className="text-2xl font-semibold text-[#202a36]"
              >
                {p.checkInboxTitle}
              </h1>

              <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                {p.sentMessageStart}{' '}
                <strong>{email}</strong>.{' '}
                {p.sentMessageEnd}
              </p>

              <p className="mt-2 text-xs text-slate-400">
                {p.spamNote}
              </p>

              {error && (
                <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="mt-6 w-full rounded-full border border-slate-200 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition disabled:opacity-50 cursor-pointer"
              >
                {loading
                  ? p.sending
                  : cooldown > 0
                    ? p.resendCooldown.replace('{seconds}', cooldown)
                    : p.resendLink}
              </button>

              <Link
                to="/login"
                className="mt-3 inline-block w-full rounded-full bg-[#202a36] py-3 text-sm font-semibold text-white hover:bg-[#4b6741] transition cursor-pointer"
              >
                {p.backToSignIn}
              </Link>
            </div>
          ) : (
            <>
              <h1
                style={{ fontFamily: 'Cinzel, serif' }}
                className="text-2xl font-semibold text-[#202a36]"
              >
                {p.title}
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                {p.subtitle}
              </p>

              {error && (
                <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div>
                  <label
                    className="block mb-1.5 text-sm font-medium text-slate-700"
                    htmlFor="email"
                  >
                    {p.emailLabel}
                  </label>

                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                    placeholder={p.emailPlaceholder}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-[#202a36] py-3 text-sm font-semibold text-white transition hover:bg-[#4b6741] disabled:opacity-60 cursor-pointer"
                >
                  {loading ? p.sending : p.sendResetLink}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-slate-500">
                {p.remembered}{' '}
                <Link
                  to="/login"
                  className="font-semibold text-[#4b6741] hover:underline"
                >
                  {p.signIn}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword
