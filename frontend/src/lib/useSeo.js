import { useEffect } from 'react'

const DEFAULT_TITLE = 'VarliKent — Architecture, Construction & Real Estate Istanbul'
const DEFAULT_DESC = "Varlikent is Istanbul's premier luxury real estate agency. Browse exclusive properties for sale and rent across Beşiktaş, Sarıyer, Bebek, Nişantaşı and more."
const DEFAULT_IMAGE = 'https://www.varlikent.com/og-image.jpg'
export const SITE_URL = 'https://www.varlikent.com'

const setMeta = (name, content, attr = 'name') => {
  let el = document.querySelector(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

const setCanonical = (path) => {
  let el = document.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', `${SITE_URL}${path}`)
}

/*
 * JSON-LD structured data. Transplanted from the donor.
 *
 * A single element, addressed by a fixed id, so navigating between two
 * property pages REPLACES the block rather than appending a second one — and
 * a page that passes no jsonLd removes it, so structured data for property A
 * cannot survive onto property B or onto a 404.
 *
 * ── Injection ─────────────────────────────────────────────────────────────
 * `textContent` (the donor's choice, kept) is already safe: assigning it
 * creates a text node, and the HTML parser is not re-run over a script
 * element's contents, so an admin-entered "</script>" in a property title
 * cannot close the tag and open a new one.
 *
 * The `<` escaping added below is belt-and-braces for the case that safety
 * argument stops holding — if this object is ever written through innerHTML
 * or serialised into server-rendered markup, textContent's protection is
 * gone and the escape is what still prevents a breakout. < is a valid
 * JSON escape, so consumers parse an identical object either way.
 */
export const JSONLD_ID = 'vk-page-jsonld'

export const serializeJsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c')

export const setJsonLd = (data, targetDocument = document) => {
  let el = targetDocument.getElementById(JSONLD_ID)

  if (!data) {
    if (el) el.remove()
    return
  }

  if (!el) {
    el = targetDocument.createElement('script')
    el.type = 'application/ld+json'
    el.id = JSONLD_ID
    targetDocument.head.appendChild(el)
  }

  el.textContent = serializeJsonLd(data)
}

const useSeo = ({ title, description, image, path, type = 'website', jsonLd } = {}) => {
  useEffect(() => {
    const t = title ? `${title} | VarliKent` : DEFAULT_TITLE
    const d = description || DEFAULT_DESC
    const img = image || DEFAULT_IMAGE

    document.title = t

    setMeta('description', d)
    setMeta('robots', 'index, follow')

    setMeta('og:title', t, 'property')
    setMeta('og:description', d, 'property')
    setMeta('og:image', img, 'property')
    setMeta('og:type', type, 'property')
    if (path) setMeta('og:url', `${SITE_URL}${path}`, 'property')

    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:title', t)
    setMeta('twitter:description', d)
    setMeta('twitter:image', img)

    if (path) setCanonical(path)

    setJsonLd(jsonLd)

    return () => {
      document.title = DEFAULT_TITLE
      // Removed on unmount as well as on a null jsonLd, so leaving a property
      // page never leaves that property's structured data behind on the next
      // page the visitor opens.
      setJsonLd(null)
    }
  }, [title, description, image, path, type, jsonLd])
}

export default useSeo
