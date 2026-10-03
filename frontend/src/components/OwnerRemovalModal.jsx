import { useEffect, useReducer, useRef } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'

/*
  Owner removal — the two halves of the flow, in one dialog.

    REQUEST   any owner asks for another (non-protected) owner to be removed.
              The server emails a 6-digit code to the protected owners.
    APPROVE   a protected owner types that code. The server demotes the
              target to a regular user; the account is never deleted.

  Which half a person gets is decided by `canConfirm`, which the page passes
  from the signed-in user's server-provided `isProtected` flag. An ordinary
  owner never sees a code field: after their request the dialog ends on
  "waiting for approval". Nothing here knows who the protected owners are —
  no ids, no emails — and the code itself only ever arrives by email.

  Every rule (who may ask, who may confirm, expiry, attempts, cooldowns) is
  enforced by the API. This component only reports what the API answered, and
  picks its wording from the HTTP status and the response's data fields, never
  from the server's message text.

  The page mounts this with key={target._id} and unmounts it on close, so a
  code or an error can never carry over to a different account.
*/

// One explicit phase instead of a handful of booleans.
//
//   confirm_request ──send──▶ requesting ──ok──▶ waiting_for_approval   (ordinary owner)
//                                         └─ok──▶ otp                    (protected owner)
//   confirm_request ──"I already have a code"──▶ otp                     (protected owner, no request)
//   otp ──resend──▶ resending ──▶ otp
//   otp ──submit──▶ confirming ──ok──▶ (closed by the page)  /  ──error──▶ otp
const PHASE = {
  confirmRequest: 'confirm_request',
  requesting: 'requesting',
  waiting: 'waiting_for_approval',
  otp: 'otp',
  resending: 'resending',
  confirming: 'confirming',
}

const BUSY_PHASES = [PHASE.requesting, PHASE.resending, PHASE.confirming]

const initialState = {
  phase: PHASE.confirmRequest,
  code: '',
  error: '',
  notice: '',
  delivery: 'full',
  expiresAt: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'request_started':
      return { ...state, phase: PHASE.requesting, error: '' }
    case 'request_failed':
      return { ...state, phase: PHASE.confirmRequest, error: action.error }
    case 'request_sent':
      return {
        ...state,
        phase: action.canConfirm ? PHASE.otp : PHASE.waiting,
        error: '',
        notice: '',
        code: '',
        delivery: action.delivery,
        expiresAt: action.expiresAt,
      }
    case 'enter_existing_code':
      // A protected owner who already received a code — typically from a
      // request another owner made — goes straight to the code step. Nothing
      // is sent: whether a request is pending is the server's to say, and a
      // missing one comes back as the normal 404 on confirm.
      return { ...state, phase: PHASE.otp, code: '', error: '', notice: '', delivery: 'full', expiresAt: null }
    case 'resend_started':
      return { ...state, phase: PHASE.resending, error: '', notice: '' }
    case 'resend_failed':
      return { ...state, phase: PHASE.otp, error: action.error }
    case 'resent':
      // A new code replaces the old one on the server, so whatever was typed
      // is now a wrong code — clear it.
      return {
        ...state,
        phase: PHASE.otp,
        code: '',
        error: '',
        notice: action.notice,
        delivery: action.delivery,
        expiresAt: action.expiresAt,
      }
    case 'code_changed':
      return { ...state, code: action.code, error: '' }
    case 'confirm_started':
      return { ...state, phase: PHASE.confirming, error: '', notice: '' }
    case 'confirm_failed':
      return { ...state, phase: PHASE.otp, error: action.error, code: action.keepCode ? state.code : '' }
    default:
      return state
  }
}

const fill = (template, values) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template || '')

const positiveInt = (value) => (Number.isInteger(value) && value > 0 ? value : null)

// Wording for a refused REQUEST (also used for a refused resend).
const requestErrorText = (err, o) => {
  const status = err?.response?.status
  const data = err?.response?.data || {}

  if (status === 429) {
    const seconds = positiveInt(data.retryAfterSeconds)
    return seconds ? fill(o.errorWait, { seconds }) : o.errorTooMany
  }
  if (status === 502) return o.errorEmailFailed
  if (status === 503) return o.errorNotConfigured
  if (status === 400) return o.errorNotOwner
  if (status === 404) return o.errorNotFound
  if (status === 401 || status === 403) return o.errorNotAllowed
  return o.errorRequestFailed
}

// Wording for a refused CONFIRMATION.
const confirmErrorText = (err, o) => {
  const status = err?.response?.status
  const data = err?.response?.data || {}

  if (status === 401) {
    const count = positiveInt(data.attemptsRemaining)
    return count ? fill(o.errorWrongCodeAttempts, { count }) : o.errorWrongCode
  }
  if (status === 400) return o.errorInvalidCode
  if (status === 410) return o.errorExpired
  if (status === 423) return o.errorLocked
  if (status === 404) return o.errorNoPending
  if (status === 409) return o.errorStale
  if (status === 403) return o.errorNotAllowed
  if (status === 503) return o.errorNotConfigured
  return o.errorConfirmFailed
}

const formatTime = (value, language) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  try {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
}

const OwnerRemovalModal = ({ target, canConfirm, onClose, onRemoved, onStale }) => {
  const { t, language } = useLanguage()
  const o = t.adminPages?.users?.ownerRemoval || {}
  const c = t.adminPages?.common || {}

  const [state, dispatch] = useReducer(reducer, initialState)
  const { phase, code, error, notice, delivery, expiresAt } = state
  const busy = BUSY_PHASES.includes(phase)

  const cancelRef = useRef(null)
  const codeRef = useRef(null)
  // Set on unmount so a response that arrives after the dialog was closed
  // does not dispatch into a component that is gone.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Focus the SAFE control on each step: Cancel while asking for confirmation
  // (so a stray Enter cannot send the request), the code field once a code is
  // expected.
  const showsCodeEntry = phase === PHASE.otp || phase === PHASE.resending || phase === PHASE.confirming
  useEffect(() => {
    if (phase === PHASE.confirmRequest) cancelRef.current?.focus()
    if (phase === PHASE.otp) codeRef.current?.focus()
  }, [phase])

  const close = () => { if (!busy) onClose() }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const requestUrl = `/users/${target._id}/request-owner-removal`
  const confirmUrl = `/users/${target._id}/confirm-owner-removal`

  const sendRequest = async () => {
    if (busy) return
    dispatch({ type: 'request_started' })
    try {
      const res = await api.post(requestUrl)
      if (!alive.current) return
      dispatch({
        type: 'request_sent',
        // The ONLY thing that opens the code step.
        canConfirm,
        delivery: res.data?.delivery === 'partial' ? 'partial' : 'full',
        expiresAt: res.data?.expiresAt || null,
      })
    } catch (err) {
      if (!alive.current) return
      dispatch({ type: 'request_failed', error: requestErrorText(err, o) })
    }
  }

  const enterExistingCode = () => {
    if (busy || !canConfirm) return
    dispatch({ type: 'enter_existing_code' })
  }

  const resend = async () => {
    if (busy || !canConfirm) return
    dispatch({ type: 'resend_started' })
    try {
      const res = await api.post(requestUrl)
      if (!alive.current) return
      dispatch({
        type: 'resent',
        notice: o.resent,
        delivery: res.data?.delivery === 'partial' ? 'partial' : 'full',
        expiresAt: res.data?.expiresAt || null,
      })
    } catch (err) {
      if (!alive.current) return
      // The server decides when another code may be sent; a 429 here carries
      // how long to wait and there is no client-side timer second-guessing it.
      dispatch({ type: 'resend_failed', error: requestErrorText(err, o) })
    }
  }

  const confirm = async (event) => {
    event.preventDefault()
    if (busy || !canConfirm || code.length !== 6) return
    dispatch({ type: 'confirm_started' })
    try {
      await api.post(confirmUrl, { code })
      if (!alive.current) return
      toast.success(fill(o.done, { name: target.name }))
      onRemoved()
    } catch (err) {
      if (!alive.current) return
      const status = err?.response?.status
      // The account changed underneath this dialog (already removed, or no
      // longer an owner): what the page is showing is out of date.
      if (status === 409) onStale?.()
      dispatch({
        type: 'confirm_failed',
        error: confirmErrorText(err, o),
        // A wrong code is cleared so the next attempt starts clean; a network
        // blip keeps what was typed.
        keepCode: !status,
      })
    }
  }

  const titleId = 'owner-removal-title'
  const codeId = 'owner-removal-code'
  const errorId = 'owner-removal-error'
  const expiryTime = formatTime(expiresAt, language)

  const title =
    phase === PHASE.waiting ? o.sentTitle
      : showsCodeEntry ? o.otpTitle
        : o.title

  const secondaryBtn = 'flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
  const dangerBtn = 'flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-phase={phase}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-bold text-red-700">{title}</h2>
            <p className="truncate text-sm text-slate-500">{target.name}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label={o.close}
            className="shrink-0 text-slate-400 hover:text-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {/* ── A. Requesting ─────────────────────────────────────────── */}
          {(phase === PHASE.confirmRequest || phase === PHASE.requesting) && (
            <div>
              <p className="text-sm leading-relaxed text-slate-700">{fill(o.body, { name: target.name })}</p>
              <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
                {fill(o.notDeleted, { name: target.name })}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{o.needsApproval}</p>

              {error && (
                <p id={errorId} role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}

              <div className="mt-5 flex gap-3">
                <button ref={cancelRef} type="button" onClick={close} disabled={busy} className={secondaryBtn}>{c.cancel}</button>
                <button type="button" onClick={sendRequest} disabled={busy} aria-describedby={error ? errorId : undefined} className={dangerBtn}>
                  {phase === PHASE.requesting ? o.sending : o.sendCode}
                </button>
              </div>

              {/*
                Protected owners only — the code may already be in their inbox
                from someone else's request. Secondary on purpose: it sends
                nothing and changes nothing until a code is confirmed.
              */}
              {canConfirm && (
                <button
                  type="button"
                  onClick={enterExistingCode}
                  disabled={busy}
                  className="mt-4 w-full text-center text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {o.alreadyHaveCode}
                </button>
              )}
            </div>
          )}

          {/* ── Ordinary owner: the request is made, and that is all ──── */}
          {phase === PHASE.waiting && (
            <div>
              <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm leading-relaxed text-green-800">
                {delivery === 'partial' ? o.sentPartial : o.sent}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{o.waiting}</p>
              <div className="mt-5 flex">
                <button type="button" onClick={close} className={secondaryBtn}>{o.close}</button>
              </div>
            </div>
          )}

          {/* ── B. Approving — protected owners only ──────────────────── */}
          {canConfirm && showsCodeEntry && (
            <form onSubmit={confirm} noValidate>
              <p className="text-sm leading-relaxed text-slate-700">{fill(o.otpIntro, { name: target.name })}</p>

              {delivery === 'partial' && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{o.otpPartial}</p>
              )}
              {notice && (
                <p role="status" className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>
              )}

              <label htmlFor={codeId} className="mt-4 block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">{o.codeLabel}</label>
              <input
                ref={codeRef}
                id={codeId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                dir="ltr"
                value={code}
                // No maxLength attribute on purpose: the browser would cut a
                // pasted "123 456" down to six CHARACTERS before this handler
                // could drop the space, leaving five digits. The handler is
                // what limits the value — digits only, six at most.
                onChange={e => dispatch({ type: 'code_changed', code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                disabled={busy}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                placeholder="••••••"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4b6741] disabled:opacity-60"
              />
              {expiryTime && (
                <p className="mt-1.5 text-xs text-slate-400">{fill(o.expiresAt, { time: expiryTime })}</p>
              )}

              {error && (
                <p id={errorId} role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}

              <div className="mt-5 flex gap-3">
                <button type="button" onClick={close} disabled={busy} className={secondaryBtn}>{c.cancel}</button>
                <button type="submit" disabled={busy || code.length !== 6} className={dangerBtn}>
                  {phase === PHASE.confirming ? o.confirming : o.confirm}
                </button>
              </div>

              <button
                type="button"
                onClick={resend}
                disabled={busy}
                className="mt-4 w-full text-center text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {phase === PHASE.resending ? o.resending : o.resend}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default OwnerRemovalModal
