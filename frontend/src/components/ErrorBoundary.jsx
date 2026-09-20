import { Component } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { C } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'

const ErrorFallback = ({ variant, sectionLabel, onRetry }) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useLanguage()
  const copy = t.errorBoundary || {}
  const portalPath = user?.role === 'agent' ? '/agent/dashboard' : user?.role === 'admin' || user?.role === 'owner' ? '/admin/dashboard' : '/'

  if (variant === 'section') {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center"
        style={{ borderColor: 'rgba(128,128,128,0.25)', color: C.muted }}
      >
        <p className="text-sm">{(copy.sectionFailed || "{section} couldn't load.").replace('{section}', sectionLabel || 'This section')}</p>
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition"
          style={{ background: C.gold, color: C.goldText }}
        >
          {copy.retry || 'Try again'}
        </button>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center"
      style={{ backgroundColor: C.charcoal, color: C.marble }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: C.gold }}>{copy.label || 'Something went wrong'}</p>
      <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-semibold sm:text-3xl">{copy.heading || 'This page hit a snag'}</h1>
      <p className="max-w-md text-sm leading-relaxed" style={{ color: C.mutedOnDark }}>
        {copy.body || 'The page could not finish loading. Reload it, or return to your starting page.'}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded-full border px-5 py-2.5 text-sm font-medium transition"
          style={{ borderColor: 'rgba(246,243,237,0.25)', color: C.marble }}
        >
          {copy.reload || 'Reload this page'}
        </button>
        <button
          type="button"
          onClick={() => { onRetry(); navigate(portalPath) }}
          className="cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold transition"
          style={{ background: C.gold, color: C.goldText }}
        >
          {portalPath === '/agent/dashboard'
            ? (copy.backToAgent || 'Back to Agent Portal')
            : portalPath === '/admin/dashboard'
              ? (copy.backToDashboard || 'Back to Dashboard')
              : (copy.backToHome || 'Back to Home')}
        </button>
      </div>
    </div>
  )
}

class Boundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary' + (this.props.sectionLabel ? ':' + this.props.sectionLabel : '') + ']', error, info)
  }

  componentDidUpdate(previousProps) {
    if (this.state.hasError && previousProps.locationKey !== this.props.locationKey) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          variant={this.props.variant || 'page'}
          sectionLabel={this.props.sectionLabel}
          onRetry={() => this.setState({ hasError: false })}
        />
      )
    }

    return this.props.children
  }
}

const ErrorBoundary = (props) => {
  const location = useLocation()
  return <Boundary {...props} locationKey={location.pathname + location.search} />
}

export default ErrorBoundary
