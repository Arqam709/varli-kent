import { useEffect } from 'react'

const DEFAULT_TITLE = 'VarliKent — Architecture, Construction & Real Estate Istanbul'
const DEFAULT_DESC = "Varlikent is Istanbul's premier luxury real estate agency. Browse exclusive properties for sale and rent across Beşiktaş, Sarıyer, Bebek, Nişantaşı and more."
const DEFAULT_IMAGE = 'https://varlikent.com/og-image.jpg'
const SITE_URL = 'https://varlikent.com'

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

const useSeo = ({ title, description, image, path, type = 'website' } = {}) => {
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

    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [title, description, image, path, type])
}

export default useSeo
