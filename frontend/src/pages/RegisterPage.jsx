import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { assets } from '../assets/assets'
import { authErrorKey } from '../lib/authErrors'
import useSeo from '../lib/useSeo'

const RegisterPage = () => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  const { register } = useAuth()
  const { t, language } = useLanguage()
  const a = t.auth
  useSeo({ title: a.createTitle, language, noindex: true })

  const navigate = useNavigate()

  const sideTitle =
    a.joinTitle

  const sideText =
    a.joinText

  const passwordPlaceholder =
    a.passwordMinPlaceholder

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (password !== confirm) {
      toast.error(
        a.passwordsDoNotMatch
      )
      return
    }

    if (password.length < 6) {
      toast.error(
        a.passwordTooShort
      )
      return
    }

    setLoading(true)

    const result = await register(name, email, password)

    if (result.success) {
      toast.success(
        a.accountCreated
      )

      navigate('/')
    } else {
      console.log('Registration error:', result.message)
      toast.error(a[authErrorKey('register', result.error)])
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative overflow-hidden" style={{ backgroundColor: '#202a36' }}>
        <img
          src={assets.header_img}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />

        <div className="relative z-10 flex flex-col h-full items-center justify-center p-12 text-center text-white">
          <span style={{ fontFamily: 'Cinzel, serif' }} className="text-3xl font-bold tracking-widest">
            VARLI<span style={{ color: '#4b6741' }}> KENT</span>
          </span>

          <h2 style={{ fontFamily: 'Cinzel, serif' }} className="mt-8 text-4xl font-semibold">
            {sideTitle}
          </h2>

          <p className="mt-4 text-slate-400 max-w-sm">
            {sideText}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden block mb-8 text-center">
            <span style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">
              VARLI<span style={{ color: '#4b6741' }}> KENT</span>
            </span>
          </Link>

          <div className="mb-6">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {a.backToHome}
            </Link>
          </div>

          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-semibold text-[#202a36]">
            {a.createTitle}
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            {a.createSubtitle}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="block mb-1.5 text-sm font-medium text-slate-700" htmlFor="name">
                {a.fullName}
              </label>

              <input
                id="name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                placeholder={a.fullNamePlaceholder}
                required
              />
            </div>

            <div>
              <label className="block mb-1.5 text-sm font-medium text-slate-700" htmlFor="email">
                {a.email}
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                placeholder={t.contactPage.emailPlaceholder}
                required
              />
            </div>

            <div>
              <label className="block mb-1.5 text-sm font-medium text-slate-700" htmlFor="password">
                {a.password}
              </label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                placeholder={passwordPlaceholder}
                required
              />
            </div>

            <div>
              <label className="block mb-1.5 text-sm font-medium text-slate-700" htmlFor="confirm">
                {a.confirmPassword}
              </label>

              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b6741]"
                placeholder={a.repeatPassword}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#202a36] py-3 text-sm font-semibold text-white transition hover:bg-[#4b6741] disabled:opacity-60 cursor-pointer"
            >
              {loading ? `${a.createButton}...` : a.createButton}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            {a.alreadyAccount}{' '}
            <Link to="/login" className="font-semibold text-[#4b6741] hover:underline">
              {a.signInTitle}
            </Link>
          </p>

          <p className="mt-4 text-center">
            <Link to="/" className="text-xs text-slate-400 hover:text-slate-600">
              ← {a.backToHome}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default RegisterPage
