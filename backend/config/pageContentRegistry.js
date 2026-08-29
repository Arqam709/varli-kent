
const HOME_FIELDS = {
  heroLabel: 'text',
  heroHeading1: 'text',
  heroHeading2: 'text',
  heroHeading3: 'text',
  heroCtaPrimary: 'text',
  heroCtaSecondary: 'text',
  heroImage: 'image',

  featuredLabel: 'text',
  featuredHeading: 'text',
  featuredSubtitle: 'text',
  featuredViewAll: 'text',

  servicesLabel: 'text',
  servicesHeading: 'text',
  servicesSubheading: 'text',

  aboutLabel: 'text',
  aboutHeading: 'text',
  aboutBody1: 'text',
  aboutBody2: 'text',
  aboutCta: 'text',

  browseLabel: 'text',
  browseHeading: 'text',
  browseListings: 'text',
  browseSaleTitle: 'text',
  browseSaleDesc: 'text',
  browseSaleBtn: 'text',
  browseRentTitle: 'text',
  browseRentDesc: 'text',
  browseRentBtn: 'text',

  trustLabel: 'text',
  trustHeading: 'text',
  trustBody: 'text',
  trustImage: 'image',

  processLabel: 'text',
  processHeading: 'text',

  projectsLabel: 'text',
  projectsHeading: 'text',
  projectsSubtitle: 'text',
  projectsViewAll: 'text',

  statsLabel1: 'text',
  statsLabel2: 'text',
  statsLabel3: 'text',
  statsLabel4: 'text',

  testimonialsLabel: 'text',
  testimonialsHeading: 'text',

  partnersLabel: 'text',

  ctaHeading: 'text',
  ctaBody: 'text',
  ctaBrowse: 'text',
  ctaContact: 'text',
}

const ARCHITECTURE_FIELDS = {
  heroLabel: 'text',
  heroHeading: 'text',
  heroSubtitle: 'text',
  heroCtaPrimary: 'text',
  heroCtaSecondary: 'text',

  showroomLabel: 'text',
  showroomHeading: 'text',

  servicesLabel: 'text',
  servicesHeading: 'text',
  service1Title: 'text',
  service1Desc: 'text',
  service2Title: 'text',
  service2Desc: 'text',
  service3Title: 'text',
  service3Desc: 'text',
  service4Title: 'text',
  service4Desc: 'text',

  processLabel: 'text',
  processHeading: 'text',
  processStep1: 'text',
  processStep2: 'text',
  processStep3: 'text',
  processStep4: 'text',

  ctaHeading: 'text',
  ctaBody: 'text',
  ctaBtn: 'text',
}

const CONSTRUCTION_FIELDS = {
  heroLabel: 'text',
  heroHeading: 'text',
  heroSubtitle: 'text',
  heroCtaPrimary: 'text',
  heroCtaSecondary: 'text',

  viewerLabel: 'text',
  viewerHeading: 'text',
  viewerDesc: 'text',
  progressLabel: 'text',
  completionLabel: 'text',

  showroomLabel: 'text',
  showroomHeading: 'text',

  servicesLabel: 'text',
  servicesHeading: 'text',

  processLabel: 'text',
  processHeading: 'text',

  seismicLabel: 'text',
  seismicHeading: 'text',
  seismicBody: 'text',

  ctaHeading: 'text',
  ctaBody: 'text',
  ctaBtn: 'text',
}

const RENOVATION_FIELDS = {
  heroLabel: 'text',
  heroHeading: 'text',
  heroSubtitle: 'text',
  heroCtaPrimary: 'text',
  heroCtaSecondary: 'text',

  transformLabel: 'text',
  transformHeading: 'text',
  beforeTitle: 'text',
  afterTitle: 'text',
  beforeItem1: 'text',
  beforeItem2: 'text',
  beforeItem3: 'text',
  beforeItem4: 'text',
  afterItem1: 'text',
  afterItem2: 'text',
  afterItem3: 'text',
  afterItem4: 'text',

  studioLabel: 'text',
  studioHeading: 'text',
  studioDesc: 'text',

  paletteLabel: 'text',
  paletteHeading: 'text',

  showroomLabel: 'text',
  showroomHeading: 'text',

  servicesLabel: 'text',
  servicesHeading: 'text',
  service1Title: 'text',
  service1Desc: 'text',
  service2Title: 'text',
  service2Desc: 'text',
  service3Title: 'text',
  service3Desc: 'text',
  service4Title: 'text',
  service4Desc: 'text',

  ctaHeading: 'text',
  ctaBody: 'text',
  ctaBtn: 'text',
}

const INTERIOR_FIELDS = {
  heroLabel: 'text',
  heroHeading: 'text',
  heroSubtitle: 'text',
  heroCtaPrimary: 'text',
  heroCtaSecondary: 'text',

  stylesLabel: 'text',
  stylesHeading: 'text',
  stylesFilterHint: 'text',

  showroomLabel: 'text',
  showroomHeading: 'text',

  finishesLabel: 'text',
  finishesHeading: 'text',
  previewLabel: 'text',

  paletteHeading: 'text',

  servicesLabel: 'text',
  servicesHeading: 'text',
  service1Title: 'text',
  service1Desc: 'text',
  service2Title: 'text',
  service2Desc: 'text',
  service3Title: 'text',
  service3Desc: 'text',
  service4Title: 'text',
  service4Desc: 'text',

  ctaHeading: 'text',
  ctaBody: 'text',
  ctaBtn: 'text',
}

const TEAM_FIELDS = {
  heroLabel: 'text',
  heroHeading: 'text',
  heroSubtitle: 'text',
  emptyText: 'text',
}

const CONTACT_FIELDS = {
  heroLabel: 'text',
  heroHeading: 'text',
  heroSubtitle: 'text',
  officeLocationLabel: 'text',
  interestLabel: 'text',
  sendBtn: 'text',
  successHeading: 'text',
  successBody: 'text',
}

/*
 * Section order follows the ORDER THE SECTIONS ACTUALLY APPEAR on the current
 * page, read off the JSX rather than copied from the donor — CURRENT renders
 * Featured before Services on the homepage, where the donor renders Services
 * first. Order matters because Wave 13A2's bandFor() walks this list to decide
 * dark/light alternation when a section is hidden.
 */
export const PAGE_CONTENT_CONTRACT = {
  home: {
    fields: HOME_FIELDS,
    sections: ['services', 'about', 'browse', 'trust', 'process', 'featured', 'projects', 'stats', 'testimonials', 'partners', 'cta'],
  },
  architecture: {
    fields: ARCHITECTURE_FIELDS,
    sections: ['showroom', 'stats', 'services', 'process', 'cta'],
  },
  construction: {
    fields: CONSTRUCTION_FIELDS,
    sections: ['viewer', 'services', 'process', 'seismic', 'showroom', 'cta'],
  },
  renovation: {
    fields: RENOVATION_FIELDS,
    sections: ['transform', 'studio', 'palette', 'services', 'showroom', 'cta'],
  },
  'interior-design': {
    fields: INTERIOR_FIELDS,
    sections: ['styles', 'showroom', 'finishes', 'palette', 'services', 'cta'],
  },
  team: {
    fields: TEAM_FIELDS,
    sections: [],
  },
  contact: {
    fields: CONTACT_FIELDS,
    sections: [],
  },
}

export const PAGE_KEYS = Object.freeze(Object.keys(PAGE_CONTENT_CONTRACT))

/*
 * ── Bounds ───────────────────────────────────────────────────────────────
 * Measured, not guessed. The longest default text currently registered is the
 * construction page's `seismicBody` at 253 characters; the longest on the
 * homepage is `ctaBody` at 152. 2000 leaves roughly eight times the headroom
 * of the longest real value, which is generous for an admin rewriting a
 * paragraph and still small enough that a page's whole field set cannot become
 * a storage problem.
 *
 * MAX_URL_LENGTH matches the 2048 that StudioPalette already allows for an
 * image URL, so the two admin surfaces accept the same thing.
 *
 * Field and section COUNTS need no separate limit: an unregistered key is
 * rejected outright, so the registry itself is the bound.
 */
export const MAX_TEXT_LENGTH = 2000
export const MAX_URL_LENGTH = 2048

export const isKnownPage = (pageKey) =>
  typeof pageKey === 'string' && Object.prototype.hasOwnProperty.call(PAGE_CONTENT_CONTRACT, pageKey)

/** The registered type of a field, or undefined when the page has no such field. */
export const fieldType = (pageKey, fieldKey) => {
  if (!isKnownPage(pageKey)) return undefined
  const fields = PAGE_CONTENT_CONTRACT[pageKey].fields
  // hasOwnProperty, not `fields[key]`, so inherited Object.prototype names
  // ('constructor', 'toString') cannot masquerade as registered fields.
  if (!Object.prototype.hasOwnProperty.call(fields, fieldKey)) return undefined
  return fields[fieldKey]
}

export const isKnownSection = (pageKey, sectionKey) =>
  isKnownPage(pageKey) && PAGE_CONTENT_CONTRACT[pageKey].sections.includes(sectionKey)

/**
 * Empty, or an absolute http(s) URL.
 *
 * Mirrors the validator StudioPalette applies to its material images — same
 * rule, same two accepted protocols — rather than importing it, because that
 * one is a module-private detail of a working model and reaching into it would
 * couple two unrelated admin features together.
 *
 * Empty string is legitimate: it is how an admin clears a CMS image override
 * so the page falls back to its built-in asset.
 *
 * The protocol allowlist is what refuses `javascript:`, `data:` and `file:` —
 * a denylist would miss the next scheme someone tries.
 */
export const isValidImageUrl = (value) => {
  if (typeof value !== 'string') return false
  if (value.length > MAX_URL_LENGTH) return false
  if (value === '') return true

  // Site-relative asset paths ('/images/hero-villa.jpg.png') are what every
  // registry image default already is, and what routes/upload.js may return,
  // so they must remain storable. A leading single slash cannot carry a
  // scheme, which is exactly why it is safe to allow and why '//host' — a
  // protocol-relative URL pointing off-site — is not.
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
