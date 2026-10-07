// Localization Phase 2 — hard-coded English removed from the public site.
//
// Static source contracts plus catalogue checks; the runtime half (pages
// actually rendering Turkish, titles following a language change) lives in
// tests/browser/publicLocalization.test.js. Run with `node --test` from
// frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import translations from '../src/locales/translations.js'

const here = dirname(fileURLToPath(import.meta.url))
const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']
const get = (lang, path) => path.split('.').reduce((node, key) => (node == null ? node : node[key]), translations[lang])
const isText = (value) => typeof value === 'string' && value.trim() !== ''

// Comments stripped, so prose describing an old string never counts.
const read = async (rel) =>
  (await readFile(join(here, '..', 'src', rel), 'utf8'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

// ── The known hard-coded English is gone ───────────────────────────────────
const REMOVED = {
  'pages/PropertyDetailsPage.jsx': [
    'Property not found', 'Back to Listings', '>Home<', '>Properties<', 'About This Property',
    'Listed by', '>Agent<', 'Email Agent', 'Call Agent', 'Send a Message', 'Similar Properties',
    "'Saved'", "'Save'", "'Price'", "'Sending...'", "'Send Message'", 'Your name', 'Email address',
    'Your message...', "'Property Type'", "'Listing Type'", "'District'", "'Status'",
    'Message sent! We will contact you soon.', 'Failed to send message.',
    'A premium property in Istanbul managed by the Varlikent team.', '${property.district}, Istanbul` :',
    // The generated meta description is a translated template now.
    'View property details on Varlikent.', "'For Rent' : 'For Sale'", ' bed, ${property.baths} bath',
    "label: 'Bedrooms'", "label: 'Bathrooms'", "label: 'Area'",
    '{property.district}, Istanbul\n',
    "Hi, I'm interested in", 'subject=Inquiry:', "'Property Details'", '— video ${i + 1}',
  ],
  'pages/HomePage.jsx': [
    'Real Estate &nbsp;', 'Luxury Istanbul villa', 'VarliKent luxury property Istanbul', "'Get Started'",
    'aria-label="Featured Properties"', 'aria-label="Previous"', 'aria-label="Next"', 'aria-label="Services"',
    'aria-label="About VarliKent"', 'aria-label="How We Work"', 'aria-label="Why VarliKent"',
    'aria-label="Buy or Rent"', 'aria-label="Selected Projects"', 'aria-label="Statistics"',
    'aria-label="Client Testimonials"', 'aria-label="Partner Companies"', 'aria-label="Call to Action"',
    "title: 'Luxury Real Estate in Istanbul'", 'full-service property company —',
  ],
  'components/Navbar.jsx': [
    'aria-label="Main navigation"', 'aria-label="VarliKent home"', 'aria-label="More languages"',
    'aria-label="Open navigation menu"', 'aria-label="Navigation menu"', 'aria-label="Close menu"',
    'aria-label={`Switch to',
  ],
  'pages/ContactPage.jsx': [
    'View on Maps', 'Office Hours', 'Monday – Friday', '>Saturday<', '>Sunday<', '>Closed<',
    'Your message is saved securely', 'Message sent! Our team will reach out soon.', 'Failed to send message.',
    "|| 'Full Name'", "|| 'Message'", 'placeholder="you@example.com"', "title: 'Contact Us",
    'Get in touch with the Varlikent team',
  ],
  'pages/ResetPassword.jsx': [
    'Invalid Link', 'missing or malformed', 'Request New Link', 'Choose a New Password',
    'Pick something strong', 'Back to Sign In', 'Set New Password', 'Enter your new password below',
    '>New Password<', '>Confirm Password<', "'Saving...'", "'Reset Password'",
    "'Password must be at least 6 characters'", "'Passwords do not match'", "'Reset failed.",
    'err.response?.data?.message',
  ],
  'pages/LoginPage.jsx': [
    'Istanbul Luxury Real Estate', 'Find and save your favourite properties',
    'placeholder="you@example.com"', 'response?.data?.message', 'toast.error(result.message)', 'error.message ||',
  ],
  'pages/RegisterPage.jsx': ['placeholder="you@example.com"', 'response?.data?.message', 'toast.error(result.message)'],
  'pages/SettingsPage.jsx': ['alt="Avatar"'],
  'lib/formatPrice.js': ["'Price on request'", "'/mo'"],
  'components/three/ConstructionClipViewer.jsx': [
    'View Construction Model', 'Click to load', 'Drag to rotate', "label: 'Foundation'",
    'Excavation, footings', "label: 'Final'", 'Complete building ready',
  ],
  'pages/InteriorDesignPage.jsx': [
    "label: 'Contemporary'", "label: 'Warm Modern'", "label: 'Coastal'", "label: 'Classic'",
    'Marble · Glass · Steel', 'Oak · Linen · Terracotta', "title: 'Interior Design Studio",
    'interior design studio creates bespoke',
  ],
  'pages/TeamPage.jsx': ['Architecture · Construction · Real Estate', "title: 'Our Team", 'Meet the Varlikent team'],
  'contexts/FavouritesContext.jsx': ['Please log in to save favourites.'],
  'pages/AboutPage.jsx': ["title: 'About Varlikent", 'Learn about Varlikent'],
  'pages/ArchitecturePage.jsx': [
    "title: 'Architecture Studio", 'architecture studio designs bespoke',
    "label: 'Projects'", "label: 'Years'", "label: 'Awards'", "label: 'Satisfaction'",
  ],
  'pages/ForgotPassword.jsx': ['response?.data?.message ||'],
  'pages/ConstructionPage.jsx': [
    "title: 'Construction Services", 'Varlikent manages high-end construction',
    'DEFAULT_SERVICES', 'DEFAULT_PROCESS', 'DEFAULT_SEISMIC', 'DEFAULT_PHASES',
    'General Contracting', 'Site Survey', 'Reinforced Concrete Frames', 'Foundation & Groundwork',
    'Bosphorus Residences', 'Q3 2026', "|| 'Our Work'", "|| 'Construction Showcase'",
  ],
  'pages/RenovationPage.jsx': ["title: 'Renovation Services", 'Varlikent renovates luxury homes', 'aria-label="Before and after reveal slider"'],
  'pages/PrivacyPolicyPage.jsx': ["title: 'Privacy Policy", 'How Varlikent collects', '>Legal<'],
  'pages/PropertiesPage.jsx': ["title: 'Properties for Sale", 'Browse luxury apartments'],
}

for (const [file, strings] of Object.entries(REMOVED)) {
  test(`${file} no longer hard-codes its English UI text`, async () => {
    const source = await read(file)
    for (const text of strings) assert.ok(!source.includes(text), `still contains: ${text}`)
  })
}

// ── 1. Property details reads its labels from translations ────────────────
test('1. PropertyDetailsPage uses translation lookups for every static label', async () => {
  const source = await read('pages/PropertyDetailsPage.jsx')
  for (const key of ['notFound', 'backToListings', 'aboutTitle', 'defaultDescription', 'save', 'saved', 'price',
    'propertyTypeLabel', 'listingTypeLabel', 'districtLabel', 'statusLabel', 'listedBy', 'emailAgent',
    'callAgent', 'similarTitle', 'messageSent', 'messageFailed', 'whatsappMessage', 'emailSubject', 'askingPrice']) {
    assert.match(source, new RegExp(`\\bpd\\.${key}\\b`), `pd.${key}`)
  }
  for (const reused of ['t.nav.home', 't.nav.properties', 't.propertyCard.forSale', 't.propertyCard.forRent',
    't.propertyCard.istanbul', 't.settingsPage.roleAgent', 't.contactPage.formHeading', 't.contactPage.namePlaceholder',
    't.forgotPasswordPage.emailLabel', 't.contactPage.messagePlaceholder', 't.contactPage.sending', 't.contactPage.sendBtn']) {
    assert.ok(source.includes(reused), reused)
  }
  // Phase 2 translated these labels; Phase 3 localized the enum VALUES beside
  // them through the shared helper (see localizationPhase3.contract.test.js).
  assert.match(source, /\[pd\.propertyTypeLabel, propertyTypeLabel\(property\.propertyType, language\)\]/)
  assert.match(source, /\[pd\.statusLabel, propertyStatusLabel\(property\.status, language\)\]/)
})

// ── 2. Homepage ────────────────────────────────────────────────────────────
test('2. HomePage CTA uses cta.label, with no English fallback', async () => {
  const source = await read('pages/HomePage.jsx')
  assert.match(source, /\{t\.cta\.label\}/)
  assert.ok(!source.includes('Get Started'))
})

test('2. the hero tagline is built from the translated service names, in their original order', async () => {
  const source = await read('pages/HomePage.jsx')
  assert.match(source, /\['realestate', 'architecture', 'construction', 'renovation', 'interior'\]\s*\.map\(key => t\.services\?\.items\?\.\[key\]\?\.label\)/)

  const compose = (lang) => ['realestate', 'architecture', 'construction', 'renovation', 'interior']
    .map((key) => translations[lang].services.items[key].label).join(' · ')
  assert.equal(compose('en'), 'Real Estate · Architecture · Construction · Renovation · Interior Design', 'English reads exactly as before')
  assert.equal(compose('tr'), 'Gayrimenkul · Mimarlık · İnşaat · Renovasyon · İç Tasarım')
})

test('2. homepage section labels and image alt text come from translations', async () => {
  const source = await read('pages/HomePage.jsx')
  for (const lookup of ['t.hero?.imageAlt', 't.trust?.imageAlt', 't.services?.explore', 't.featured?.heading',
    't.common?.previous', 't.common?.next', 't.nav?.services', 't.process?.label', 't.trust?.label', 't.projects?.heading',
    't.accessibility?.aboutSection', 't.accessibility?.browseSection', 't.accessibility?.statsSection',
    't.accessibility?.testimonialsSection', 't.accessibility?.partnersSection', 't.accessibility?.ctaSection']) {
    assert.ok(source.includes(lookup), lookup)
  }
  assert.doesNotMatch(source, /aria-label="[A-Z]/, 'no literal English aria-label')
})

// ── 3. Navbar ──────────────────────────────────────────────────────────────
test('3. Navbar Settings (desktop and mobile) and Language use translations', async () => {
  const source = await read('components/Navbar.jsx')
  assert.equal((source.match(/\{t\.nav\.settings\}/g) || []).length, 2, 'both the dropdown and the drawer')
  assert.match(source, /\{t\.nav\.language\}/)
  assert.doesNotMatch(source, />\s*Settings\s*</)
  assert.doesNotMatch(source, />\s*Language\s*</)
  assert.doesNotMatch(source, /aria-label="[A-Z]/)
})

// ── 4. Contact ─────────────────────────────────────────────────────────────
test('4. contact labels and office hours resolve in Turkish', () => {
  const tr = translations.tr.contactPage
  assert.equal(tr.officeHours, 'Çalışma Saatleri')
  assert.equal(tr.weekdays, 'Pazartesi – Cuma')
  assert.equal(tr.saturday, 'Cumartesi')
  assert.equal(tr.sunday, 'Pazar')
  assert.equal(tr.closed, 'Kapalı')
  assert.equal(tr.nameLabel, 'Ad Soyad')
  assert.equal(tr.messageLabel, 'Mesaj')
})

test('4. ContactPage reads those keys and keeps its submission unchanged', async () => {
  const source = await read('pages/ContactPage.jsx')
  for (const key of ['viewOnMaps', 'officeHours', 'weekdays', 'saturday', 'sunday', 'closed', 'responseNotice', 'messageSent', 'messageFailed', 'nameLabel', 'messageLabel', 'emailPlaceholder']) {
    assert.match(source, new RegExp(`\\bc\\.${key}\\b`), `c.${key}`)
  }
  assert.match(source, /await api\.post\('\/contact', form\)/, 'submission untouched')
})

// ── 5. Reset password ──────────────────────────────────────────────────────
test('5. ResetPassword is wired to resetPasswordPage', async () => {
  const source = await read('pages/ResetPassword.jsx')
  assert.match(source, /const r = t\.resetPasswordPage/)
  for (const key of Object.keys(translations.en.resetPasswordPage)) {
    assert.match(source, new RegExp(`\\br\\.${key}\\b`), `r.${key} is used`)
  }
  // Token handling and the API call are unchanged.
  assert.match(source, /const token = searchParams\.get\('token'\)/)
  assert.match(source, /await api\.post\('\/auth\/reset-password', \{ token, password \}\)/)
})

// ── 6. Login brand panel ───────────────────────────────────────────────────
test('6. the login brand panel is translated', async () => {
  const source = await read('pages/LoginPage.jsx')
  assert.ok(source.includes('{t.forgotPasswordPage.heroTitle}'))
  assert.ok(source.includes('{a.brandSubtitle}'))
})

// ── 7. Map view ────────────────────────────────────────────────────────────
test('7. PropertyMapView reads its text from the translations it is given', async () => {
  const map = await read('components/PropertyMapView.jsx')
  const properties = await read('pages/PropertiesPage.jsx')
  assert.match(properties, /<PropertyMapView properties=\{properties\} labels=\{t\.propertiesPage \|\| \{\}\} \/>/)
  for (const key of ['noMappedProperties', 'noMappedPropertiesHint', 'viewDetails']) {
    assert.match(map, new RegExp(`labels\\.${key}`))
    for (const lang of LANGS) assert.ok(isText(get(lang, `propertiesPage.${key}`)), `${lang}.propertiesPage.${key}`)
  }
})

// ── 8. Construction viewer ─────────────────────────────────────────────────
test('8. construction viewer stages are localized, keyed by a stable id', async () => {
  const source = await read('components/three/ConstructionClipViewer.jsx')
  const ids = [...source.matchAll(/\{ pct: \d+,\s+id: '(\w+)' \}/g)].map((m) => m[1])
  assert.deepEqual(ids, ['foundation', 'structure', 'walls', 'roof', 'final'])
  assert.match(source, /viewer\.phases\?\.\[phase\.id\]/)
  assert.match(source, /key=\{phase\.id\}/)
  assert.ok(source.includes('{viewer.controlsHint}'))
  assert.ok(source.includes('title={viewer.viewModel} hint={viewer.clickToLoad}'))
  for (const lang of LANGS) {
    for (const id of ids) {
      assert.ok(isText(get(lang, `constructionPage.viewer.phases.${id}.label`)), `${lang} ${id}.label`)
      assert.ok(isText(get(lang, `constructionPage.viewer.phases.${id}.desc`)), `${lang} ${id}.desc`)
    }
  }
})

// ── 9. Interior styles ─────────────────────────────────────────────────────
test('9. interior style cards are localized', async () => {
  const source = await read('pages/InteriorDesignPage.jsx')
  const ids = [...source.matchAll(/\{ id: '(\w+)', bg: '#[0-9a-f]{6}' \}/g)].map((m) => m[1])
  assert.deepEqual(ids, ['contemporary', 'warm', 'coastal', 'classic'])
  assert.match(source, /p\.styles\?\.\[style\.id\]\?\.label/)
  assert.match(source, /p\.styles\?\.\[style\.id\]\?\.materials/)
  assert.match(source, /p\.styles\?\.\[selectedStyle\]\?\.label/)
  for (const lang of LANGS) {
    for (const id of ids) {
      assert.ok(isText(get(lang, `interiorPage.styles.${id}.label`)), `${lang} ${id}`)
      assert.ok(isText(get(lang, `interiorPage.styles.${id}.materials`)), `${lang} ${id} materials`)
    }
  }
  assert.equal(translations.tr.interiorPage.styles.contemporary.materials, 'Mermer · Cam · Çelik')
})

// ── 10 / 11. Team and favourites ───────────────────────────────────────────
test('10. the team tagline is built from translated service names', async () => {
  const source = await read('pages/TeamPage.jsx')
  assert.match(source, /\['architecture', 'construction', 'realestate'\]\.map\(key => t\.services\?\.items\?\.\[key\]\?\.label\)/)
  const tr = ['architecture', 'construction', 'realestate'].map((k) => translations.tr.services.items[k].label).join(' · ')
  assert.equal(tr, 'Mimarlık · İnşaat · Gayrimenkul')
})

test('11. the favourites login prompt is localized', async () => {
  const source = await read('contexts/FavouritesContext.jsx')
  assert.match(source, /alert\(t\.favouritesPage\.loginRequired\)/)
  assert.match(source, /const \{ t \} = useLanguage\(\)/)
})

// ── 12. Page titles follow the active language ─────────────────────────────
const SEO_PAGES = {
  'pages/HomePage.jsx': 'home',
  'pages/PropertiesPage.jsx': 'properties',
  'pages/AboutPage.jsx': 'about',
  'pages/TeamPage.jsx': 'team',
  'pages/ContactPage.jsx': 'contact',
  'pages/PrivacyPolicyPage.jsx': 'privacy',
  'pages/ArchitecturePage.jsx': 'architecture',
  'pages/ConstructionPage.jsx': 'construction',
  'pages/RenovationPage.jsx': 'renovation',
  'pages/InteriorDesignPage.jsx': 'interior',
}

for (const [file, key] of Object.entries(SEO_PAGES)) {
  test(`12. ${file} titles itself with t.seo.${key}, read after the language is known`, async () => {
    const source = await read(file)
    assert.match(source, new RegExp(`useSeo\\(\\{\\s*title: t\\.seo\\.${key},`))
    const languageAt = source.search(/useLanguage\(\)/)
    const seoAt = source.indexOf('useSeo({')
    assert.ok(languageAt !== -1 && languageAt < seoAt, 'useLanguage() comes before useSeo()')
  })
}

test('12. property details titles itself from seo.propertyTitle / seo.propertyDetails', async () => {
  const source = await read('pages/PropertyDetailsPage.jsx')
  assert.match(source, /t\.seo\.propertyTitle\.replace\('\{district\}', \(\) => property\.district\)\.replace\('\{title\}', \(\) => property\.title\)/)
  assert.match(source, /: t\.seo\.propertyDetails,/)
})

test('12. every seo title exists in all six languages and is distinct within each', () => {
  const keys = Object.keys(translations.en.seo)
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(translations[lang].seo).sort(), [...keys].sort(), lang)
    const values = keys.filter((k) => k !== 'propertyTitle').map((k) => translations[lang].seo[k])
    assert.equal(new Set(values).size, values.length, `${lang} titles are distinct`)
    assert.match(translations[lang].seo.propertyTitle, /\{title\}/)
    assert.match(translations[lang].seo.propertyTitle, /\{district\}/)
  }
})

// ── 13 / 14. New keys: all six languages, and Turkish is really Turkish ────
const NEW_KEYS = [
  'propertyDetails.notFound', 'propertyDetails.backToListings', 'propertyDetails.aboutTitle', 'propertyDetails.defaultDescription',
  'propertyDetails.save', 'propertyDetails.saved', 'propertyDetails.price', 'propertyDetails.propertyTypeLabel',
  'propertyDetails.listingTypeLabel', 'propertyDetails.districtLabel', 'propertyDetails.statusLabel', 'propertyDetails.listedBy',
  'propertyDetails.emailAgent', 'propertyDetails.callAgent', 'propertyDetails.similarTitle', 'propertyDetails.messageSent',
  'propertyDetails.messageFailed', 'propertyDetails.whatsappMessage', 'propertyDetails.emailSubject',
  'hero.imageAlt', 'services.explore', 'trust.imageAlt',
  'accessibility.aboutSection', 'accessibility.browseSection', 'accessibility.statsSection', 'accessibility.testimonialsSection',
  'accessibility.partnersSection', 'accessibility.ctaSection', 'accessibility.mainNavigation', 'accessibility.homeLink',
  'accessibility.moreLanguages', 'accessibility.openMenu', 'accessibility.navigationMenu', 'accessibility.closeMenu',
  'nav.settings', 'nav.language', 'accessibility.switchLanguage', 'propertyDetails.videoLabel',
  'contactPage.viewOnMaps', 'contactPage.officeHours', 'contactPage.weekdays', 'contactPage.saturday', 'contactPage.sunday',
  'contactPage.closed', 'contactPage.responseNotice', 'contactPage.messageSent', 'contactPage.messageFailed', 'contactPage.emailPlaceholder',
  'auth.brandSubtitle', 'favouritesPage.loginRequired',
  'constructionPage.viewer.viewModel', 'constructionPage.viewer.clickToLoad', 'constructionPage.viewer.controlsHint',
  ...['home', 'properties', 'propertyDetails', 'propertyTitle', 'about', 'team', 'contact', 'privacy', 'architecture', 'construction', 'renovation', 'interior'].map((k) => `seo.${k}`),
]

for (const path of NEW_KEYS) {
  test(`13/14. ${path}: present in all six languages, and Turkish is not English`, () => {
    for (const lang of LANGS) assert.ok(isText(get(lang, path)), `${lang}.${path}`)
    assert.notEqual(get('tr', path), get('en', path), `tr.${path} is still English`)
  })
}

test('13. placeholders survive in every language', () => {
  for (const lang of LANGS) {
    assert.match(get(lang, 'propertyDetails.whatsappMessage'), /\{title\}/, lang)
    assert.match(get(lang, 'propertyDetails.emailSubject'), /\{title\}/, lang)
    assert.match(get(lang, 'propertyDetails.videoLabel'), /\{title\}.*\{number\}|\{number\}.*\{title\}/, lang)
    assert.match(get(lang, 'accessibility.switchLanguage'), /\{language\}/, lang)
  }
})

test('14. every reused key the touched pages now read exists in all six languages', () => {
  const reused = [
    'nav.home', 'nav.properties', 'propertyCard.forSale', 'propertyCard.forRent', 'propertyCard.istanbul',
    'settingsPage.roleAgent', 'contactPage.formHeading', 'contactPage.namePlaceholder', 'forgotPasswordPage.emailLabel',
    'contactPage.messagePlaceholder', 'contactPage.sending', 'contactPage.sendBtn', 'propertyDetails.askingPrice',
    'featured.heading', 'common.previous', 'common.next', 'nav.services', 'process.label', 'trust.label',
    'projects.heading', 'forgotPasswordPage.heroTitle', 'cta.label',
    ...['realestate', 'architecture', 'construction', 'renovation', 'interior'].map((k) => `services.items.${k}.label`),
  ]
  for (const path of reused) for (const lang of LANGS) assert.ok(isText(get(lang, path)), `${lang}.${path}`)
})
