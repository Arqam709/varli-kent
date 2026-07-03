import { useState, useEffect, useRef } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { assets } from '../assets/assets'
import api from '../lib/api'
import { useMsal } from '@azure/msal-react'
import { microsoftLoginRequest } from '../lib/msal'
import { InteractionStatus } from '@azure/msal-browser'

const LoginPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const { login, loginWithToken } = useAuth()
  const { instance, accounts, inProgress } = useMsal()
  const { t, language } = useLanguage()
  const a = t.auth

  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'
  const microsoftHandledRef = useRef(false)
  

useEffect(() => {
  const completeMicrosoftLogin = async () => {
    if (microsoftHandledRef.current) return
    if (inProgress !== InteractionStatus.None) return

    const account = instance.getActiveAccount() || accounts[0]
    if (!account) return

    microsoftHandledRef.current = true
    setLoading(true)

    try {
      instance.setActiveAccount(account)

      const tokenResponse = await instance.acquireTokenSilent({
        ...microsoftLoginRequest,
        account,
      })

      const res = await api.post('/auth/microsoft', {
        idToken: tokenResponse.idToken,
      })

      const { token, user } = res.data

      loginWithToken(user, token)

      toast.success(
        language === 'tr'
          ? 'Microsoft ile giriş yapıldı'
          : language === 'ar'
            ? 'تم تسجيل الدخول باستخدام Microsoft'
            : 'Signed in with Microsoft'
      )

      navigate(from, { replace: true })
    } catch (error) {
      console.log('Microsoft redirect completion error:', error)
      console.log('Backend response:', error.response?.data)

      toast.error(
        error.response?.data?.message ||
        error.message ||
        (
          language === 'tr'
            ? 'Microsoft ile giriş başarısız'
            : language === 'ar'
              ? 'فشل تسجيل الدخول باستخدام Microsoft'
              : 'Microsoft sign in failed'
        )
      )
    } finally {
      setLoading(false)
    }
  }

  completeMicrosoftLogin()
}, [accounts, inProgress, instance, loginWithToken, navigate, from, language])

  

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!email || !password) {
      toast.error(
        language === 'tr'
          ? 'Lütfen tüm alanları doldurun'
          : language === 'ar'
            ? 'يرجى ملء جميع الحقول'
            : 'Please fill in all fields'
      )
      return
    }

    setLoading(true)

    const result = await login(email, password)

    if (result.success) {
      toast.success(
        language === 'tr'
          ? 'Tekrar hoş geldiniz!'
          : language === 'ar'
            ? 'مرحباً بعودتك!'
            : 'Welcome back!'
      )

      navigate(from, { replace: true })
    } else {
      toast.error(result.message)
    }

    setLoading(false)
  }

  const handleGoogleLogin = useGoogleLogin({
  onSuccess: async (tokenResponse) => {
    try {
      setLoading(true)

      const res = await api.post('/auth/google', {
        accessToken: tokenResponse.access_token,
      })

      const { token, user } = res.data

      loginWithToken(user, token)

      toast.success(
        language === 'tr'
          ? 'Google ile giriş yapıldı'
          : language === 'ar'
            ? 'تم تسجيل الدخول باستخدام Google'
            : 'Signed in with Google'
      )

      navigate(from, { replace: true })
    } catch (error) {
      console.log('Google login error:', error)
      console.log('Backend response:', error.response?.data)

      toast.error(
        error.response?.data?.message ||
        error.message ||
        (
          language === 'tr'
            ? 'Google ile giriş başarısız'
            : language === 'ar'
              ? 'فشل تسجيل الدخول باستخدام Google'
              : 'Google sign in failed'
        )
      )
    } finally {
      setLoading(false)
    }
  },
  onError: () => {
    toast.error(
      language === 'tr'
        ? 'Google girişi başarısız'
        : language === 'ar'
          ? 'فشل تسجيل الدخول باستخدام Google'
          : 'Google login failed'
    )
  },
})

const handleMicrosoftLogin = async () => {
  try {
    setLoading(true)

    await instance.loginRedirect({
      ...microsoftLoginRequest,
      redirectUri: `${window.location.origin}/login`,
    })
  } catch (error) {
    console.log('Microsoft redirect start error:', error)

    toast.error(
      error.response?.data?.message ||
      error.message ||
      (
        language === 'tr'
          ? 'Microsoft ile giriş başarısız'
          : language === 'ar'
            ? 'فشل تسجيل الدخول باستخدام Microsoft'
            : 'Microsoft sign in failed'
      )
    )

    setLoading(false)
  }
}

  const oauthComingSoon = (provider) => {
    toast.info(
      language === 'tr'
        ? `${provider} girişi yakında gelecek. OAuth bilgilerini .env dosyasında ayarlayın.`
        : language === 'ar'
          ? `تسجيل الدخول عبر ${provider} قريباً. قم بإعداد بيانات OAuth في ملف .env.`
          : `${provider} login coming soon. Configure OAuth credentials in .env`
    )
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
            Istanbul Luxury Real Estate
          </h2>

          <p className="mt-4 text-slate-400 max-w-sm">
            Find and save your favourite properties. Get exclusive access to premium listings.
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
            {a.signInTitle}
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            {a.signInSubtitle}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-700" htmlFor="password">
                  {a.password}
                </label>

                <Link to="/forgot-password" className="text-xs text-[#4b6741] hover:underline">
                  {a.forgotPassword}
                </Link>
              </div>

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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#202a36] py-3 text-sm font-semibold text-white transition hover:bg-[#4b6741] disabled:opacity-60 cursor-pointer"
            >
              {loading ? `${a.signInButton}...` : a.signInButton}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-xs text-slate-400">
              {a.continueWith}
            </span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          <div className="grid gap-3">
            <div className="flex w-full justify-center overflow-hidden rounded-xl">
              <button
  type="button"
  onClick={() => handleGoogleLogin()}
  disabled={loading}
  className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
>
  <svg className="h-5 w-5" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>

  {language === 'tr'
    ? 'Google ile devam et'
    : language === 'ar'
      ? 'المتابعة باستخدام Google'
      : 'Continue with Google'}
</button>
            </div>

            

            <button
  type="button"
  onClick={handleMicrosoftLogin}
  disabled={loading}
  className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
>
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#f25022" d="M1 1h10v10H1z" />
                <path fill="#7fba00" d="M13 1h10v10H13z" />
                <path fill="#00a4ef" d="M1 13h10v10H1z" />
                <path fill="#ffb900" d="M13 13h10v10H13z" />
              </svg>
              {a.microsoft}
            </button>
          </div>

          <p className="mt-8 text-center text-sm text-slate-500">
            {a.noAccount}{' '}
            <Link to="/register" className="font-semibold text-[#4b6741] hover:underline">
              {a.signUp}
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

export default LoginPage
