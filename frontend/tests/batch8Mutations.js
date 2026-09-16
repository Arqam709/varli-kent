// Batch 8 regression mutations, applied to IN-MEMORY source only (contract
// reads and Vite loads). Production files are never written; the verifier
// script hashes them before and after to prove it.
export const applyBatch8Mutation = (mutation, path, source) => {
  if (!mutation) return source
  const p = String(path).replaceAll('\\', '/')
  let s = source

  if (p.endsWith('/components/AIChatbot.jsx')) {
    if (mutation === 'drop-trash-def') s = s.replace('const TrashIcon = () => (', 'const UnusedTrashIcon = () => (')
    if (mutation === 'rtl-ar-only') s = s.replace("const RTL_LANGUAGES = ['ar', 'ur']", "const RTL_LANGUAGES = ['ar']")
    if (mutation === 'direct-fetch') s = s.replace('await sendMessage(pageKey, text)', "await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) })")
    if (mutation === 'guest-visible') s = s.replace('if (!userIsLoggedIn || !chatbotAllowed) {', 'if (!chatbotAllowed) {')
    if (mutation === 'drop-scroll') s = s.replaceAll('vk-scroll-gold ', '')
    if (mutation === 'green-fill') s = s.replaceAll('C.accent', 'C.green')
  }

  if (p.endsWith('/contexts/ChatContext.jsx') && mutation === 'drop-shown-ids') {
    s = s.replace(/(api\.post\('\/chat', \{[\s\S]*?)\n\s*shownPropertyIds,/, '$1')
  }

  // The approximate rule is enforced twice (page branch + SinglePropertyMap's
  // own isPubliclyMappable gate), so a donor-style regression must remove both.
  if (p.endsWith('/components/PropertyMapView.jsx') && mutation === 'approx-map') {
    s = s.replace('loc?.isApproximate !== true &&', '')
  }

  if (p.endsWith('/pages/PropertyDetailsPage.jsx')) {
    // Donor-style: any coordinate on the object is enough to draw the map.
    if (mutation === 'approx-map') s = s.replace(') : isPubliclyMappable(property) ? (', ') : null}{Number.isFinite(property.location?.lat) ? (')
    if (mutation === 'agent-strings') s = s.replace('{property.agent ? (', '{property.agentName ? (')
    if (mutation === 'fixed-header') s = s.replace('<div className="pt-24 pb-8" style={{ backgroundColor: C.charcoal }}>', '<div className="bg-[#202a36] pt-24 pb-8">')
    if (mutation === 'drop-thumb-scroll') s = s.replace('vk-scroll-gold mt-3', 'mt-3')
    if (mutation === 'race') s = s.replace('if (!active) return', '')
  }

  return s
}
