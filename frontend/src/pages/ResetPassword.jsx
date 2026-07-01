import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { assets } from '../assets/assets'

const ResetPassword = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, password })
      navigate('/login', { state: { resetSuccess: true } })
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-8">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
          </div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-xl font-semibold text-[#202a36]">Invalid Link</h1>
          <p className="mt-2 text-sm text-slate-500">This reset link is missing or malformed. Please request a new one.</p>
          <Link to="/forgot-password" className="mt-6 inline-block rounded-full bg-[#202a36] px-8 py-3 text-sm font-semibold text-white hover:bg-[#4b6741] transition">
            Request New Link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative overflow-hidden" style={{ backgroundColor: '#202a36' }}>
        <img src={assets.header_img} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative z-10 flex flex-col h-full items-center justify-center p-12 text-center text-white">
          <span style={{ fontFamily: 'Cinzel, serif' }} className="text-3xl font-bold tracking-widest">
            VARLI<span style={{ color: '#4b6741' }}> KENT</span>
          </span>
          <h2 style={{ fontFamily: 'Cinzel, serif' }} className="mt-8 text-4xl font-semibold">Choose a New Password</h2>
          <p className="mt-4 text-slate-400 max-w-sm">Pick something strong and memorable.</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden block mb-8 text-center">
            <span style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">VARLI<span style={{ color: '#4b6741' }}> KENT</span></span>
          </Link>

          <div className="mb-6">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back to Sign In
            </Link>
          </div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-semibold text-[#202a36]">Set New Password</h1>
          <p className="mt-2 text-sm text-slate-500">Enter your new password below. Minimum 6 characters.</p>

          {error && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="block mb-1.5 text-sm font-medium text-slate-700" htmlFor="password">New Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                placeholder="••••••••"
                required
              />
            </div>
            <div>
              <label className="block mb-1.5 text-sm font-medium text-slate-700" htmlFor="confirm">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#202a36] py-3 text-sm font-semibold text-white transition hover:bg-[#4b6741] disabled:opacity-60 cursor-pointer"
            >
              {loading ? 'Saving...' : 'Reset Password'}
            </button>
          </form>

          <p className="mt-8 text-center">
            <Link to="/login" className="text-xs text-slate-400 hover:text-slate-600">← Back to Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default ResetPassword
