import { useEffect, useId, useRef, useState } from 'react'
import { DISPLAY_STATUSES, summarizePageTranslations } from '../lib/pageContentTranslationStatus'
import { languageList } from '../lib/pageContentSaveReport'

/*
 * Translation status for the Page Content editor.
 *
 *   FieldTranslationStatus   under one text field: a row of six small chips
 *                            (one per language), and a disclosure that opens
 *                            what visitors of each language currently see
 *   PageTranslationSummary   one line above the page: how its translations
 *                            are doing, and whether any need a look
 *
 * Nothing here edits text or saves. The one action is "Retry translation", and
 * it lives inside the opened preview, beside the language it concerns — never
 * on a chip. This component only asks for it (onRetry); the request, and every
 * decision about what may be retried, belong to the editor and the backend.
 *
 * Most languages of most fields are fine, so the default look is quiet:
 * outlined chips in the form's own greys. Only a language that needs attention
 * is filled amber and marked — and it always says so in words as well.
 */

const STATUS_LABEL = {
  source: 'statusSource', current: 'statusCurrent', manual: 'statusManual', builtin: 'statusBuiltin',
  existing: 'statusExisting', stale: 'statusStale', outdated: 'statusOutdated', missing: 'statusMissing',
}
const STATUS_EXPLANATION = {
  source: 'explainSource', current: 'explainCurrent', manual: 'explainManual', builtin: 'explainBuiltin',
  existing: 'explainExisting', stale: 'explainStale', outdated: 'explainOutdated', missing: 'explainMissing',
}
const ORIGIN_LABEL = { stored: 'originStored', builtin: 'originBuiltin', source: 'originSource' }
const FAILURE_LABEL = { failed: 'failureFailed', quota: 'failureQuota', tooLong: 'failureTooLong', echo: 'failureEcho' }

const RTL_LANGUAGES = ['ar', 'ur']
const languageName = (lang, language) => languageList([lang], language)

// The mark that accompanies an attention state. Decorative: the state is
// always written out beside it.
const AttentionMark = () => (
  <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold leading-none text-white">!</span>
)

function StatusChip({ row, language, pc }) {
  const tone = row.attention
    ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-slate-200 bg-white text-slate-500'

  return (
    <li
      data-testid="translation-chip"
      data-lang={row.lang}
      data-status={row.status}
      title={languageName(row.lang, language)}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 ${tone}`}
    >
      {row.attention && <AttentionMark />}
      <span className={`font-semibold ${row.attention ? '' : 'text-slate-700'}`}>{row.lang.toUpperCase()}</span>
      <span>{pc[STATUS_LABEL[row.status]]}</span>
    </li>
  )
}

/*
 * The action for one language. Always words, never an icon alone; its
 * accessible name carries the language, because six of these can be on screen.
 * While its request is in flight it says so and cannot be pressed again.
 */
function RetryAction({ row, language, pc, busy, locked, dirty, onRetry }) {
  if (row.retry === 'protected') {
    return <p data-testid="translation-retry-note" className="mt-2 text-xs text-slate-500">{pc.retryProtected}</p>
  }
  if (row.retry !== 'allowed' || !onRetry) return null

  // A retry translates the text that is SAVED. With an edit pending, that is
  // not the text on screen — so the edit is saved first.
  if (dirty && !busy) {
    return <p data-testid="translation-retry-note" className="mt-2 text-xs text-slate-500">{pc.retrySaveFirst}</p>
  }

  return (
    <button
      type="button"
      data-testid="translation-retry"
      data-lang={row.lang}
      onClick={() => onRetry(row.lang)}
      disabled={busy || locked}
      aria-busy={busy || undefined}
      aria-label={busy ? undefined : pc.retryLanguage.replace('{language}', () => languageName(row.lang, language))}
      className="mt-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b6741]/50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-white motion-reduce:transition-none cursor-pointer"
    >
      {busy ? pc.retrying : pc.retryAction}
    </button>
  )
}

function PreviewRow({ row, language, pc, busy, locked, dirty, onRetry }) {
  /*
   * A successful retry removes the button that was just pressed. Keyboard
   * focus would fall back to the top of the document, so when a retry of this
   * row finishes and focus is nowhere, it is put on the row itself.
   */
  const rowRef = useRef(null)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy && (!document.activeElement || document.activeElement === document.body)) {
      rowRef.current?.focus({ preventScroll: true })
    }
    wasBusy.current = busy
  }, [busy])

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      data-testid="translation-preview-row"
      data-lang={row.lang}
      data-status={row.status}
      className="rounded py-3 first:pt-0 last:pb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b6741]/50"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold text-slate-800">{languageName(row.lang, language)}</span>
        <span className={`inline-flex items-center gap-1 ${row.attention ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>
          {row.attention && <AttentionMark />}
          {pc[STATUS_LABEL[row.status]]}
        </span>
      </p>

      {/* What a visitor of this language reads — in that language's own direction. */}
      {row.text ? (
        <p
          lang={row.lang}
          dir={RTL_LANGUAGES.includes(row.lang) ? 'rtl' : 'ltr'}
          className="mt-1.5 whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
        >
          {row.text}
        </p>
      ) : (
        <p className="mt-1.5 text-sm italic text-slate-400">{pc.noTextShown}</p>
      )}

      <p className="mt-1.5 text-xs text-slate-500">
        {row.status !== 'source' && (
          <><span className="font-medium text-slate-600">{pc.visitorsSee}: {pc[ORIGIN_LABEL[row.origin]]}.</span>{' '}</>
        )}
        {pc[STATUS_EXPLANATION[row.status]]}
      </p>
      {row.failure && (
        <p className="mt-1 text-xs font-medium text-amber-800">{pc[FAILURE_LABEL[row.failure]]}</p>
      )}
      <RetryAction row={row} language={language} pc={pc} busy={busy} locked={locked} dirty={dirty} onRetry={onRetry} />
    </li>
  )
}

/*
 *   onRetry(lang)   asks for one language to be translated again
 *   retrying        the languages of this field whose retry is in flight
 *   locked          no retry can start right now (a save is in progress)
 *   dirty           the field has an edit that is not saved yet
 */
export function FieldTranslationStatus({ rows, caption, language, pc, onRetry, retrying = [], locked = false, dirty = false }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const source = rows.find((row) => row.status === 'source')

  return (
    <div data-testid="translation-status" className="mt-2">
      {/* The list is laid out by this row (`contents`), so the chips and the
          disclosure wrap together instead of the control taking a line of its own. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ul aria-label={pc.translationsOf.replace('{field}', () => caption)} className="contents">
          {rows.map((row) => <StatusChip key={row.lang} row={row} language={language} pc={pc} />)}
        </ul>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="ms-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-slate-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b6741]/50 cursor-pointer"
        >
          {open ? pc.translationsHide : pc.translationsShow}
          <svg aria-hidden="true" className={`h-3 w-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div id={panelId} data-testid="translation-preview" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          {source && (
            <p className="mb-3 text-xs font-medium text-slate-600">
              {pc.sourceLanguage.replace('{language}', () => languageName(source.lang, language))}
            </p>
          )}
          <ul className="divide-y divide-slate-200">
            {rows.map((row) => (
              <PreviewRow
                key={row.lang}
                row={row}
                language={language}
                pc={pc}
                busy={retrying.includes(row.lang)}
                locked={locked}
                dirty={dirty}
                onRetry={onRetry}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function PageTranslationSummary({ rowsByField, pc }) {
  const { counts, attention } = summarizePageTranslations(rowsByField)
  const shown = DISPLAY_STATUSES.filter((status) => counts[status] > 0)
  const needsAttention = attention > 0

  return (
    <div
      data-testid="translation-summary"
      data-attention={needsAttention ? 'true' : 'false'}
      role="status"
      className={`rounded-xl border px-5 py-3 text-sm ${needsAttention ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600'}`}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {needsAttention && <AttentionMark />}
        <span className="font-semibold">{pc.summaryTitle}</span>
        <span data-testid="translation-summary-message">
          {needsAttention ? pc.summaryAttention.replace('{count}', () => attention) : pc.summaryCalm}
        </span>
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {shown.map((status) => (
          <li key={status} data-testid="translation-summary-count" data-status={status}>
            <span className="font-semibold tabular-nums">{counts[status]}</span> {pc[STATUS_LABEL[status]]}
          </li>
        ))}
      </ul>
    </div>
  )
}
