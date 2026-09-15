import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { CONTACT_INTEREST_LANGUAGES, contactInterestLabel } from '../lib/contactInterests.js'
import {
  CONTACT_INTEREST_LANGUAGE_NAMES,
  CONTACT_INTEREST_LIMITS,
  buildCreatePayload,
  buildUpdatePayload,
  checkExistingInterestForm,
  checkNewInterestForm,
  contactInterestErrorMessage,
  createContactInterestsClient,
  deriveContactInterestId,
  describeInterestFormProblem,
  emptyInterestForm,
  formFromInterest,
  nextInterestOrder,
  normalizeContactInterestValue,
  sortManagedInterests,
} from '../lib/contactInterestAdmin.js'

/*
 * CONTACT INTERESTS — shown under Admin → Page Content → Contact.
 *
 * Visually part of the Contact page editor; technically separate from it.
 * These are ContactInterest records served by /api/contact/interests, NOT
 * PageContent fields: nothing here reads or writes /api/page-content, and the
 * page editor's "Save Changes" bar never includes them. Every action in this
 * card saves on its own.
 *
 * No delete: an interest is retired by disabling it, because older app builds
 * may still submit it and its lead routing must survive.
 *
 * ── Language ────────────────────────────────────────────────────────────
 * Interface text follows the Admin language through
 * `t.adminPages.contactInterests` (English literals are only the fallback).
 * Each interest is NAMED in the Admin language too — its own label for that
 * language, then English, then its value — while the canonical value and the
 * id stay visible, untranslated, as its technical identity. Nothing about the
 * language changes what is sent: payloads carry the six stored label keys.
 */

const GREEN = '#4b6741'
const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 transition focus:outline-none focus:ring-2 focus:ring-[#4b6741]/40 focus:border-[#4b6741] bg-white'
const labelCls = 'block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1.5'
const secondaryBtn = 'rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 cursor-pointer'

const RTL_LANGUAGES = new Set(['ar', 'ur'])
const NEW_INTEREST = '__new__'

const client = createContactInterestsClient(api)

/** Fills `{name}` in a translated template. A function replacement, so `$` in a name is literal. */
const withName = (template, name) => template.replace('{name}', () => name)

function InterestFields({ form, onChange, idPrefix, ci }) {
  const setLabel = (lang, text) => onChange({ ...form, labels: { ...form.labels, [lang]: text } })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CONTACT_INTEREST_LANGUAGES.map((lang) => {
        const inputId = `${idPrefix}-label-${lang}`
        return (
          <div key={lang}>
            <label htmlFor={inputId} className={labelCls}>
              {ci.languageLabels?.[lang] || `${CONTACT_INTEREST_LANGUAGE_NAMES[lang]} label`}
              {lang === 'en' ? <span aria-hidden="true" className="text-red-500"> *</span> : null}
            </label>
            {/* The input's direction follows the language being TYPED, not the Admin language. */}
            <input
              id={inputId}
              className={inputCls}
              value={form.labels[lang]}
              onChange={(e) => setLabel(lang, e.target.value)}
              dir={RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr'}
              maxLength={CONTACT_INTEREST_LIMITS.label}
              aria-required={lang === 'en'}
              placeholder={lang === 'en' ? '' : (ci.optionalLabel || 'Optional — English is shown if empty')}
            />
          </div>
        )
      })}

      <div>
        <label htmlFor={`${idPrefix}-order`} className={labelCls}>{ci.order || 'Order'}</label>
        <input
          id={`${idPrefix}-order`}
          type="number"
          min="0"
          max={CONTACT_INTEREST_LIMITS.order}
          step="1"
          inputMode="numeric"
          className={inputCls}
          value={form.order}
          onChange={(e) => onChange({ ...form, order: e.target.value })}
        />
        <p className="mt-1 text-xs text-slate-400">{ci.orderHint || 'Lower numbers appear first.'}</p>
      </div>

      <div className="flex items-center">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#4b6741]"
            checked={form.enabled}
            onChange={(e) => onChange({ ...form, enabled: e.target.checked })}
          />
          {ci.offered || 'Offered on the Contact form'}
        </label>
      </div>
    </div>
  )
}

function InterestEditor({ title, identity, form, onChange, onSubmit, onCancel, saving, error, submitLabel, idPrefix, ci }) {
  return (
    <form
      noValidate
      aria-label={title}
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="space-y-5 border-t border-slate-100 px-5 py-5"
      style={{ background: 'linear-gradient(180deg, #FAFAF7, #F7F6F2)' }}
    >
      {identity}
      <InterestFields form={form} onChange={onChange} idPrefix={idPrefix} ci={ci} />

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className={secondaryBtn}>
          {ci.cancel || 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full px-6 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60 cursor-pointer"
          style={{ backgroundColor: GREEN }}
        >
          {saving ? (ci.saving || 'Saving…') : submitLabel}
        </button>
      </div>
    </form>
  )
}

function Identity({ id, value, note, ci }) {
  return (
    <div data-testid="contact-interest-identity" className="grid gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-2">
      <div>
        <p className={labelCls}>{ci.stableId || 'Stable ID'}</p>
        <p dir="ltr" className="break-all font-mono text-sm text-slate-700">{id || '—'}</p>
      </div>
      <div>
        <p className={labelCls}>{ci.submittedValue || 'Submitted value'}</p>
        <p dir="ltr" className="break-words text-sm text-slate-700">{value || '—'}</p>
      </div>
      <p className="text-xs text-slate-500 sm:col-span-2">{note}</p>
    </div>
  )
}

export default function ContactInterestsManager() {
  const { t, language } = useLanguage()
  const ci = t.adminPages?.contactInterests || {}

  const [interests, setInterests] = useState([])
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState(() => emptyInterestForm())
  /** A language-neutral validation problem, or a server message string. */
  const [formError, setFormError] = useState(null)
  /** The row (or NEW_INTEREST) with a request in flight. */
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let active = true
    client.list().then(
      (list) => {
        if (!active) return
        setInterests(list)
        setStatus('ready')
      },
      (err) => {
        if (!active) return
        setLoadError(contactInterestErrorMessage(err, ''))
        setStatus('error')
      }
    )
    return () => { active = false }
  }, [])

  const retry = () => {
    setStatus('loading')
    setLoadError('')
    client.list().then(
      (list) => {
        setInterests(list)
        setStatus('ready')
      },
      (err) => {
        setLoadError(contactInterestErrorMessage(err, ''))
        setStatus('error')
      }
    )
  }

  /** The interest's name in the Admin language: that label, then English, then the value. */
  const nameOf = (interest) => contactInterestLabel(interest, language)

  // Stored as a problem rather than text, so an open error re-renders in the
  // new language if the admin switches language while it is showing.
  const formErrorText = typeof formError === 'string'
    ? formError
    : describeInterestFormProblem(formError, {
      messages: ci.errors,
      languageNames: ci.languageNames,
      interestName: nameOf,
    })

  const saveFailed = ci.saveFailed || 'Could not save the interest. Nothing was changed.'

  const replaceInterest = (updated) =>
    setInterests((prev) => sortManagedInterests(prev.map((interest) => (interest.id === updated.id ? updated : interest))))

  const closeEditor = () => {
    setEditingId(null)
    setEditForm(null)
    setFormError(null)
  }

  const openEditor = (interest) => {
    setAdding(false)
    setActionError('')
    setFormError(null)
    setEditingId(interest.id)
    setEditForm(formFromInterest(interest))
  }

  const saveEdit = async () => {
    const problem = checkExistingInterestForm(editForm)
    if (problem) {
      setFormError(problem)
      return
    }

    setBusyId(editingId)
    setFormError(null)
    try {
      const updated = await client.update(editingId, buildUpdatePayload(editForm))
      replaceInterest(updated)
      closeEditor()
      toast.success(ci.saved || 'Contact interest saved')
    } catch (err) {
      setFormError(contactInterestErrorMessage(err, saveFailed))
    } finally {
      setBusyId(null)
    }
  }

  const toggleEnabled = async (interest) => {
    setBusyId(interest.id)
    setActionError('')
    try {
      const updated = await client.update(interest.id, { enabled: !interest.enabled })
      replaceInterest(updated)
      // Keep an open editor in step, so saving it later cannot undo the toggle.
      if (editingId === interest.id) setEditForm((form) => (form ? { ...form, enabled: updated.enabled } : form))
      toast.success(updated.enabled ? (ci.enabledToast || 'Interest enabled') : (ci.disabledToast || 'Interest disabled'))
    } catch (err) {
      setActionError(contactInterestErrorMessage(err, saveFailed))
    } finally {
      setBusyId(null)
    }
  }

  const openAdd = () => {
    closeEditor()
    setActionError('')
    setAddForm(emptyInterestForm(nextInterestOrder(interests)))
    setAdding(true)
  }

  const saveNew = async () => {
    const problem = checkNewInterestForm(addForm, interests)
    if (problem) {
      setFormError(problem)
      return
    }

    setBusyId(NEW_INTEREST)
    setFormError(null)
    try {
      const created = await client.create(buildCreatePayload(addForm))
      setInterests((prev) => sortManagedInterests([...prev.filter((interest) => interest.id !== created.id), created]))
      setAdding(false)
      toast.success(ci.created || 'Contact interest added')
    } catch (err) {
      setFormError(contactInterestErrorMessage(err, saveFailed))
    } finally {
      setBusyId(null)
    }
  }

  const previewValue = normalizeContactInterestValue(addForm.labels.en)
  const previewId = deriveContactInterestId(previewValue)

  return (
    <section aria-labelledby="contact-interests-heading" data-testid="contact-interests-manager" className="space-y-4">
      <div className="border-t border-slate-200 pt-8">
        <h2 id="contact-interests-heading" style={{ fontFamily: 'Cinzel, serif' }} className="text-xl font-bold text-[#202a36]">
          {ci.title || 'Contact Interests'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {ci.subtitle || 'The options visitors choose from on the Contact form, on the website and in the mobile app. Separate from the page text above: each change here saves on its own and applies straight away.'}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {ci.noDelete || 'Interests cannot be deleted. Disable one to stop offering it — older app versions can still send it, and its lead routing is kept.'}
        </p>
      </div>

      {actionError ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{actionError}</div>
      ) : null}

      {status === 'loading' && (
        <div role="status" className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
          {ci.loading || 'Loading contact interests…'}
        </div>
      )}

      {status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <span>
            {ci.loadFailed || 'Could not load contact interests.'}
            {loadError ? ` ${loadError}` : ''}
          </span>
          <button type="button" onClick={retry} className={secondaryBtn}>{ci.retry || 'Retry'}</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {interests.map((interest) => {
              const name = nameOf(interest)
              const busy = busyId === interest.id
              const editing = editingId === interest.id

              return (
                <li key={interest.id} data-testid="contact-interest-row" data-interest-id={interest.id}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: interest.enabled ? GREEN : '#CBD5E1' }} />
                    <div className="min-w-0 flex-1">
                      <p
                        data-testid="contact-interest-name"
                        className={`truncate text-sm font-semibold ${interest.enabled ? 'text-[#202a36]' : 'text-slate-400'}`}
                      >
                        {name}
                      </p>
                      {/* Technical identity: never translated. */}
                      <p data-testid="contact-interest-identity-line" dir="ltr" className="truncate text-xs text-slate-400">
                        {interest.value} · <span className="font-mono">{interest.id}</span>
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">{ci.order || 'Order'} {interest.order}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${interest.enabled ? 'bg-[#4b6741]/10 text-[#4b6741]' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {interest.enabled ? (ci.enabled || 'Enabled') : (ci.disabled || 'Disabled')}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleEnabled(interest)}
                      disabled={busy}
                      aria-label={withName(interest.enabled ? (ci.disableNamed || 'Disable {name}') : (ci.enableNamed || 'Enable {name}'), name)}
                      className={secondaryBtn}
                    >
                      {interest.enabled ? (ci.disable || 'Disable') : (ci.enable || 'Enable')}
                    </button>
                    <button
                      type="button"
                      onClick={() => (editing ? closeEditor() : openEditor(interest))}
                      disabled={busy}
                      aria-expanded={editing}
                      aria-label={withName(editing ? (ci.closeNamed || 'Close {name}') : (ci.editNamed || 'Edit {name}'), name)}
                      className={secondaryBtn}
                    >
                      {editing ? (ci.close || 'Close') : (ci.edit || 'Edit')}
                    </button>
                  </div>

                  {editing && editForm && (
                    <InterestEditor
                      title={withName(ci.editNamed || 'Edit {name}', name)}
                      idPrefix={`interest-${interest.id}`}
                      identity={(
                        <Identity
                          id={interest.id}
                          value={interest.value}
                          note={ci.immutable || 'The internal ID and submitted value cannot be changed after creation.'}
                          ci={ci}
                        />
                      )}
                      form={editForm}
                      onChange={setEditForm}
                      onSubmit={saveEdit}
                      onCancel={closeEditor}
                      saving={busy}
                      error={formErrorText}
                      submitLabel={ci.save || 'Save Interest'}
                      ci={ci}
                    />
                  )}
                </li>
              )
            })}
            {interests.length === 0 && (
              <li className="px-6 py-6 text-sm italic text-slate-400">{ci.empty || 'No contact interests yet.'}</li>
            )}
          </ul>

          {adding ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <p className="px-5 pt-4 text-sm font-semibold text-[#202a36]">{ci.newInterest || 'New interest'}</p>
              <InterestEditor
                title={ci.newInterest || 'New interest'}
                idPrefix="interest-new"
                identity={(
                  <Identity
                    id={previewId}
                    value={previewValue}
                    note={ci.generated || 'Generated from the English label. Both are fixed once the interest is created.'}
                    ci={ci}
                  />
                )}
                form={addForm}
                onChange={setAddForm}
                onSubmit={saveNew}
                onCancel={() => { setAdding(false); setFormError(null) }}
                saving={busyId === NEW_INTEREST}
                error={formErrorText}
                submitLabel={ci.create || 'Create Interest'}
                ci={ci}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-full border border-dashed px-5 py-2.5 text-sm font-semibold transition hover:bg-[#4b6741]/5 cursor-pointer"
              style={{ borderColor: GREEN, color: GREEN }}
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {ci.add || 'Add New Interest'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
