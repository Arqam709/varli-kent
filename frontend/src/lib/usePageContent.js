import { useState, useEffect, useCallback, useMemo } from 'react'
import api from './api'
import { useLanguage } from '../contexts/LanguageContext'
import { resolveCmsField, isSectionVisibleIn, computeBands } from './pageContentResolve.js'

// Re-exported so a caller needs one import, and so the pure resolvers stay
// testable on their own (see frontend/tests/pageContent.test.js).
export { resolveCmsField, isSectionVisibleIn, computeBands }


export function usePageContent(pageKey, sectionOrder = [], defaultBands = {}) {
  const { language } = useLanguage()
  // null while in flight, so `loading` is derived rather than a second state
  // that could disagree with it.
  const [fields, setFields] = useState(null)
  const [sections, setSections] = useState({})

  useEffect(() => {
    let cancelled = false

    api.get(`/page-content/${pageKey}`)
      .then((res) => {
        if (cancelled) return
        setFields(res.data.fields || {})
        setSections(res.data.sections || {})
      })
      .catch(() => {
        // A failed fetch must look exactly like "nothing saved yet": empty
        // maps, so every get() returns the caller's fallback and the page
        // renders its built-in copy. The CMS being unreachable is never a
        // reason for a visitor to see a broken page.
        if (cancelled) return
        setFields({})
        setSections({})
      })

    return () => { cancelled = true }
  }, [pageKey])

  const get = useCallback(
    (key, fallback) => resolveCmsField(fields?.[key], language, fallback),
    [fields, language]
  )

  const isSectionVisible = useCallback((key) => isSectionVisibleIn(sections, key), [sections])

  const bandMap = useMemo(
    () => computeBands(sectionOrder, defaultBands, sections),
    // sectionOrder/defaultBands are module-level constants at every intended
    // call site, so they are stable by construction.
    [sectionOrder, defaultBands, sections]
  )

  const bandFor = useCallback(
    (key) => bandMap[key] || defaultBands[key] || 'dark',
    [bandMap, defaultBands]
  )

  return { get, isSectionVisible, bandFor, loading: fields === null, fields, sections }
}

export default usePageContent
