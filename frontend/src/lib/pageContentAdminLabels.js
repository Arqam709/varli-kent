/*
 * ADMIN INTERFACE labels for the Page Content editor.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * The registry (pageContentRegistry.js) used to be the only source of the
 * editor's page names, section titles and field captions, and it holds them in
 * English. AdminPageContent rendered those strings directly, so the rest of
 * the Admin followed the selected language while this page stayed English.
 *
 * The captions now come from translations.js, in the same place as the page's
 * other chrome (`t.adminPages.pageContent`):
 *
 *   pages[pageKey]                     tab names
 *   sectionTitles[pageKey][sectionKey] section card titles
 *   fieldLabels[field.labelKey]        field captions (shared vocabulary)
 *
 * The registry's English strings stay as the fallback, so a language the Admin
 * switcher does not offer (de/ru/ur, reachable only through the public site's
 * shared language setting) still shows complete English rather than blanks.
 *
 * ── What this is NOT ────────────────────────────────────────────────────
 * Admin interface text only. Page keys, section keys and field keys are the
 * API contract and are never translated. A field's `default` and the stored
 * CMS values are CONTENT: they are edited in the language they were written
 * in, and nothing here reads or changes them.
 */

/** `pc` is `t.adminPages?.pageContent`. */
export const pageContentPageLabel = (pc, pageKey, page) =>
  pc?.pages?.[pageKey] || page?.label || pageKey

export const pageContentSectionTitle = (pc, pageKey, section) =>
  pc?.sectionTitles?.[pageKey]?.[section.key] || section.defaultTitle || section.key

export const pageContentFieldLabel = (pc, field) =>
  (field.labelKey && pc?.fieldLabels?.[field.labelKey]) || field.label || field.key
