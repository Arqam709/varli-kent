import { useEffect } from 'react'
import translations from '../locales/translations.js'

// Last resort only: the same wording index.html ships with, used when a caller
// passes no language (or one the catalogue does not have).
const DEFAULT_TITLE = 'VarliKent — Architecture, Construction & Real Estate Istanbul'
const DEFAULT_DESC = "Varlikent is Istanbul's premier luxury real estate agency. Browse exclusive properties for sale and rent across Beşiktaş, Sarıyer, Bebek, Nişantaşı and more."
const DEFAULT_IMAGE = 'https://www.varlikent.com/og-image.jpg'
export const SITE_URL = 'https://www.varlikent.com'

/*
 * The site-wide title and description in a language — what a page gets for
 * whichever of the two it does not supply, and what the tab title returns to
 * when a page with its own metadata is left.
 *
 * Read from the catalogue by language code rather than through useLanguage(),
 * so this module stays importable by the Node tests that exercise setJsonLd.
 */
export const siteMeta = (language) => ({
  title: translations[language]?.seo?.siteTitle || DEFAULT_TITLE,
  description: translations[language]?.seoDescriptions?.site || DEFAULT_DESC,
})

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

/*
 * `noindex` is for the signed-in and account screens (login, register,
 * settings, favourites, password reset). They still get a translated tab title
 * and description, but tell crawlers to stay out — the same routes robots.txt
 * already disallows.
 */
const useSeo = ({ title, description, image, path, type = 'website', jsonLd, language, noindex = false } = {}) => {
  useEffect(() => {
    const site = siteMeta(language)
    const t = title ? `${title} | VarliKent` : site.title
    const d = description || site.description
    const img = image || DEFAULT_IMAGE

    document.title = t

    setMeta('description', d)
    setMeta('robots', noindex ? 'noindex, nofollow' : 'index, follow')

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
      document.title = site.title
      // Removed on unmount as well as on a null jsonLd, so leaving a property
      // page never leaves that property's structured data behind on the next
      // page the visitor opens.
      setJsonLd(null)
    }
  }, [title, description, image, path, type, jsonLd, language, noindex])
}

export default useSeo
