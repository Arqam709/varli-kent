// Post-integration UI correction — donor-first.
//
// Six of the eight reported issues resolved to a real difference between the
// donor's working files and CURRENT. This pins each of those differences so a
// later refactor cannot quietly undo them:
//
//   hero line / size    HomePage.jsx  headline containing block + clamp()
//   scroll indicator    HomePage.jsx  cue inside the centered flow, not absolute
//   navbar readability  Navbar.jsx    route-aware navSolid
//   home section order  HomePage.jsx  services -> process -> browse
//   chat delete UI      AIChatbot.jsx Delete All + per-row trash
//
// Static source contracts in the style of adminPolish.contract.test.js: no
// React testing dependency, run with plain `node --test` from frontend/.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Source with comments stripped, so prose never satisfies a contract.
 *
 * JSX comments are stripped too. The Stage-3 block documents the OLD broken
 * clamp by quoting it, and a regression guard that greps for that string would
 * otherwise fail on the explanation of the fix rather than on the fix itself.
 */
const read = async (...p) =>
  (await readFile(join(here, '..', 'src', ...p), 'utf8'))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

/** Raw source, for the few checks that care about layout rather than logic. */
const readRaw = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')

const LANGS = ['en', 'tr', 'ar', 'de', 'ru', 'ur']

const loadTranslations = async () => {
  const raw = await readFile(join(here, '..', 'src', 'locales', 'translations.js'), 'utf8')
  const cjs = raw.replace(/^export\s+(default\s+)?/gm, 'module.exports = ')
  const mod = { exports: {} }
  new Function('module', 'exports', cjs)(mod, mod.exports)
  return mod.exports.translations || mod.exports
}

const at = (obj, path) => path.split('.').reduce((a, k) => a?.[k], obj)

/* ══════════════════ HOME SECTION ORDER ══════════════════ */

test('Home renders Services -> Vision/Handover -> Sale/Rent', async () => {
  const src = await readRaw('pages', 'HomePage.jsx')

  const services = src.indexOf('── SERVICES')
  const about = src.indexOf('── ABOUT / WHO WE ARE')
  const process = src.indexOf('── PROCESS')
  const browse = src.indexOf('── FOR SALE / RENT')
  const featured = src.indexOf('── FEATURED PROPERTIES')

  for (const [name, i] of Object.entries({ services, about, process, browse, featured })) {
    assert.ok(i > -1, `Home section marker missing: ${name}`)
  }

  // The whole point of the reorder: process (From Vision to Handover) must
  // come BEFORE browse (For Sale or Rent).
  assert.ok(services < about, 'services must precede about')
  assert.ok(about < process, 'about must precede process')
  assert.ok(process < browse, 'From Vision to Handover must precede For Sale or Rent')
  assert.ok(browse < featured, 'browse must precede featured')
})

test('SECTION_ORDER matches the rendered order, so bands stay in step', async () => {
  const src = await read('pages', 'HomePage.jsx')
  const m = src.match(/const SECTION_ORDER = \[([^\]]+)\]/)
  assert.ok(m, 'SECTION_ORDER not found')

  const order = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
  assert.ok(
    order.indexOf('process') < order.indexOf('browse'),
    'SECTION_ORDER still lists browse before process — bandFor() would disagree with the DOM'
  )
  // bandFor() falls back through this list; every rendered section must be in it.
  for (const key of ['services', 'about', 'process', 'trust', 'browse', 'featured']) {
    assert.ok(order.includes(key), `SECTION_ORDER lost ${key}`)
  }
})

/* ══════════════════ HERO ══════════════════ */

test('hero headline is not boxed into a 700px column', async () => {
  const src = await read('pages', 'HomePage.jsx')

  // The fixed 700px max-width forced long translated headings to wrap into
  // extra lines, which is what pushed the block into the decorative rule.
  assert.equal(
    /maxWidth: '700px'/.test(src),
    false,
    'hero h1 still uses the fixed 700px max-width'
  )
  assert.ok(
    src.includes("maxWidth: 'min(94vw, 960px)'"),
    'hero h1 lost the donor viewport-relative max-width'
  )
})

test('hero typography and rhythm scale with the viewport', async () => {
  const src = await read('pages', 'HomePage.jsx')

  assert.ok(
    src.includes("fontSize: 'clamp(1.7rem, 5vw, 4.2rem)'"),
    'hero h1 lost the donor clamp()'
  )
  // Stage 1 must reserve space at BOTH ends; with only paddingTop the centered
  // column could grow downward into the scroll cue.
  assert.ok(
    src.includes("paddingTop: 'clamp(3.5rem, 12vh, 9rem)'") &&
      src.includes("paddingBottom: 'clamp(3.5rem, 10vh, 7rem)'"),
    'hero stage-1 padding is not the donor clamp pair'
  )
  assert.equal(/paddingTop: '9rem'/.test(src), false, 'hero still uses the fixed 9rem padding')
})

/* ══════════════════ SCROLL INDICATOR ══════════════════ */

test('scroll cue sits in the hero flow, not at an absolute offset', async () => {
  const src = await read('pages', 'HomePage.jsx')

  const cue = src.match(/<div ref=\{scrollRef\}[^>]*>/)
  assert.ok(cue, 'scroll cue not found')

  assert.equal(
    /position: 'absolute'/.test(cue[0]),
    false,
    'scroll cue is absolutely positioned again — it will collide with the stats row'
  )
  assert.ok(cue[0].includes('vk-scroll-cue'), 'scroll cue lost its class hook')
  assert.ok(
    cue[0].includes("marginTop: 'clamp(1.5rem, 4vh, 3rem)'"),
    'scroll cue lost its in-flow gap'
  )
})

test('scroll cue is hidden on short viewports rather than allowed to collide', async () => {
  const css = await readFile(join(here, '..', 'src', 'index.css'), 'utf8')
  assert.ok(css.includes('.vk-scroll-cue'), 'index.css has no .vk-scroll-cue rule')
  assert.ok(
    /@media \(max-height: 700px\)[\s\S]{0,160}\.vk-scroll-cue[\s\S]{0,80}display: none/.test(css),
    'the short-viewport guard for the scroll cue is missing'
  )
})

/* ══════════════════ NAVBAR ══════════════════ */

test('navbar is readable from the first paint on non-hero routes', async () => {
  const src = await read('components', 'Navbar.jsx')

  assert.ok(src.includes('LIGHT_FROM_TOP_ROUTES'), 'route list missing')
  assert.ok(
    src.includes("LIGHT_FROM_TOP_ROUTES.includes(location.pathname)"),
    'the route list is not consulted'
  )
  assert.ok(src.includes('/favourites'), 'Favourites is not in the light-from-top route list')
  assert.ok(
    /const navSolid = scrolled \|\| startsLight/.test(src),
    'navSolid must be true when scrolled OR on a light-from-top route'
  )
})

test('navbar ink never keys off the theme id', async () => {
  const src = await read('components', 'Navbar.jsx')

  // Superseded requirement: the scrolled bar used to be the white --vk-nav-bg
  // with dark ink. It is now a theme-tinted DARK surface, so the ink stays
  // light throughout — pinned by the two surface tests further down. What
  // survives from the original bug is this rule: colour must never be chosen
  // by theme id, which is what rendered white text on the white nav for Forest.
  assert.equal(
    /isDarkNav \? 'rgba\(255,255,255,0\.85\)'/.test(src),
    false,
    'navbar text colour is keyed off the theme again — white-on-white returns for Forest'
  )
  assert.ok(src.includes('backdropFilter'), 'scrolled navbar lost its blur')
})

test('navbar variant is driven by navSolid, not raw scroll state', async () => {
  const src = await read('components', 'Navbar.jsx')
  assert.ok(/style=\{navSolid/.test(src), 'nav container still branches on `scrolled` alone')
})

/* ══════════════════ CHAT DELETE UI ══════════════════ */

test('the history drawer offers Delete All beside New Chat', async () => {
  const src = await read('components', 'AIChatbot.jsx')

  assert.ok(src.includes('handleRequestDeleteAll'), 'Delete All handler missing')
  assert.ok(src.includes("c.actions?.deleteAll"), 'Delete All label is not translated')
  // Never offered for an empty, loading or errored list.
  assert.ok(
    /!conversationsLoading && !conversationsError && conversations\.length > 0/.test(src),
    'Delete All is not gated on there being conversations to delete'
  )
})

test('every conversation row carries its own delete control', async () => {
  const src = await read('components', 'AIChatbot.jsx')

  assert.ok(src.includes('TrashIcon'), 'trash icon missing')
  assert.ok(
    /onClick=\{\(e\) => handleRequestDeleteOne\(e, conversation\._id\)\}/.test(src),
    'row delete is not wired to the row conversation id'
  )
})

test('the row delete never opens the conversation', async () => {
  const src = await read('components', 'AIChatbot.jsx')

  assert.ok(
    /handleRequestDeleteOne = \(e, conversationId\) => \{\s*e\.stopPropagation\(\)/.test(src),
    'row delete does not stop propagation — tapping the trash would open the chat'
  )
  // The row became a div precisely so a real <button> can live inside it.
  assert.ok(
    /<div\s+role="button"/.test(src),
    'the row is not a div with button semantics; a nested button would be invalid HTML'
  )
  assert.ok(src.includes('onKeyDown'), 'the row lost keyboard activation when it stopped being a button')
})

test('deletion goes through CURRENT ChatContext, with CURRENT signatures', async () => {
  const src = await read('components', 'AIChatbot.jsx')

  assert.ok(src.includes('deleteConversation,'), 'deleteConversation not taken from useChat()')
  assert.ok(src.includes('deleteAllConversations,'), 'deleteAllConversations not taken from useChat()')

  // CURRENT: deleteConversation(id) / deleteAllConversations(). The donor's
  // (pageKey, id, welcome) shape must not come across with the UI.
  assert.ok(
    /await deleteConversation\(pendingDelete\.conversationId\)/.test(src),
    'deleteConversation is not called with just the conversation id'
  )
  assert.ok(
    /await deleteAllConversations\(\)/.test(src),
    'deleteAllConversations is not called with CURRENT signature'
  )
  // No parallel network path.
  assert.equal(
    /fetch\(|axios\.|api\.delete/.test(src),
    false,
    'the chat panel is calling the network directly instead of using ChatContext'
  )
})

test('confirmation is required, and a second press cannot double-fire', async () => {
  const src = await read('components', 'AIChatbot.jsx')

  assert.ok(src.includes('ChatConfirmModal'), 'confirm dialog missing')
  assert.ok(src.includes('pendingDelete &&'), 'confirm dialog is not gated on a pending delete')
  // Cancel is inert: it only clears the pending intent.
  assert.ok(
    /handleCancelDelete = \(\) => \{\s*setPendingDelete\(null\)\s*\}/.test(src),
    'cancel does more than clear the pending delete'
  )
  // Guard, not just a disabled attribute.
  assert.ok(
    /if \(!pendingDelete \|\| deleting\) return/.test(src),
    'confirm has no in-flight guard — a double tap could fire two deletes'
  )
  assert.ok(src.includes('busy={deleting}'), 'the dialog does not reflect the in-flight state')
})

/* ══════════════════ TRANSLATIONS ══════════════════ */

test('every chat delete string resolves in all six languages', async () => {
  const T = await loadTranslations()

  const keys = [
    'chatbot.actions.deleteAll',
    'chatbot.actions.delete',
    'chatbot.actions.cancel',
    'chatbot.actions.deleting',
    'chatbot.history.confirmDeleteAll',
    'chatbot.history.confirmDeleteOne',
    'chatbot.aria.deleteConversation',
    'chatbot.aria.deleteAllConversations',
  ]

  for (const key of keys) {
    for (const lang of LANGS) {
      const value = at(T[lang], key)
      assert.equal(typeof value, 'string', `${lang} is missing ${key}`)
      assert.ok(value.trim().length > 0, `${lang} has an empty ${key}`)
    }
  }
})

test('the reordered Home sections keep their copy in all six languages', async () => {
  const T = await loadTranslations()

  // Representative keys from the two sections that moved, plus the section
  // above them — the ones a bad reorder would strand.
  const keys = [
    'services.label', 'services.heading',
    'process.label', 'process.heading',
    'browse.label', 'browse.heading',
    'browse.sale.title', 'browse.rent.title',
  ]

  for (const key of keys) {
    for (const lang of LANGS) {
      const value = at(T[lang], key)
      assert.equal(typeof value, 'string', `${lang} is missing ${key}`)
      assert.ok(value.trim().length > 0, `${lang} has an empty ${key}`)
    }
  }
})

test('non-English Home copy is actually translated, not copied English', async () => {
  const T = await loadTranslations()

  // Headings only: labels like "Design" legitimately coincide across languages.
  const keys = ['services.heading', 'process.heading', 'browse.heading']

  for (const key of keys) {
    const english = at(T.en, key)
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      assert.notEqual(
        at(T[lang], key),
        english,
        `${lang} ${key} is still the English string`
      )
    }
  }
})

test('Arabic and Urdu remain registered as right-to-left', async () => {
  // The reorder and the navbar change both touch layout; neither may disturb
  // the direction contract the two RTL bundles depend on.
  const src = await read('contexts', 'LanguageContext.jsx')
  assert.ok(/\bar\b/.test(src) && /\bur\b/.test(src), 'ar/ur missing from LanguageContext')
  assert.ok(/rtl/i.test(src), 'LanguageContext no longer expresses direction')
})

/* ══════════════════ STAGE-3 BRAND REVEAL ══════════════════ */

test('the Stage-3 wordmark cannot return to the oversized rule', async () => {
  const src = await read('pages', 'HomePage.jsx')

  // clamp(4rem, 16vw, 14rem) put the 9-letter wordmark at 7.197em x 224px =
  // 1612px, which is 115% of a 1366 viewport — the brand was clipped outside
  // the hero at every width below ~1660.
  assert.equal(
    /clamp\(4rem,\s*16vw,\s*14rem\)/.test(src),
    false,
    'Stage-3 VARLIKENT is oversized again — it will clip at 1600 and below'
  )
  assert.equal(
    /fontSize: 'clamp\([^']*1[0-9]vw/.test(src),
    false,
    'Stage-3 font-size slope is back in double digits of vw'
  )
})

test('the Stage-3 wordmark uses the measured-safe responsive rule', async () => {
  const src = await read('pages', 'HomePage.jsx')

  const brand = src.match(/<p style=\{\{ fontFamily: 'Cinzel, serif'[^>]*whiteSpace: 'nowrap'[^>]*\}\}>/)
  assert.ok(brand, 'Stage-3 wordmark declaration not found')

  assert.ok(
    brand[0].includes("fontSize: 'clamp(2rem, 9vw, 8rem)'"),
    'Stage-3 wordmark lost its measured clamp'
  )
  // The 9vw slope is only safe for this tracking: width = 7.197em, and
  // 7.197 x 9 = 64.8% of the viewport. Changing the tracking changes the
  // multiplier, so it is pinned alongside the size.
  assert.ok(
    brand[0].includes("letterSpacing: '0.12em'"),
    'Stage-3 tracking changed — the 9vw slope must be re-measured'
  )
})

test('nothing scales the brand reveal above its CSS size', async () => {
  const src = await read('pages', 'HomePage.jsx')

  // The rendered width is font-size x tracking ONLY if GSAP never scales past
  // 1. The reveal animates 0.96 -> 1; an overshooting ease or a scale > 1
  // would make the measured width a lower bound instead of the real one.
  const brandTween = src.match(/\.fromTo\(brandRef\.current,[\s\S]*?\)\s*,\s*0\.\d+\)/)
  assert.ok(brandTween, 'brand reveal tween not found')
  assert.ok(/scale: 0\.96/.test(brandTween[0]), 'brand reveal no longer starts under 1')
  assert.equal(
    /scale: (1\.\d|[2-9])/.test(brandTween[0]),
    false,
    'brand reveal now scales above 1 — the wordmark can exceed its measured width'
  )
  assert.equal(
    /ease: '(back|elastic)/.test(brandTween[0]),
    false,
    'an overshooting ease would push the wordmark past its measured width'
  )
})

test('the Stage-1 headline rule is untouched by the Stage-3 fix', async () => {
  const src = await read('pages', 'HomePage.jsx')
  // Stage 1 and Stage 3 are separate type systems; fixing one must not move
  // the other.
  assert.ok(src.includes("fontSize: 'clamp(1.7rem, 5vw, 4.2rem)'"), 'Stage-1 headline clamp changed')
  assert.ok(src.includes("maxWidth: 'min(94vw, 960px)'"), 'Stage-1 headline max-width changed')
})

test('the Stage-3 tagline survives the resize', async () => {
  const src = await read('pages', 'HomePage.jsx')
  assert.ok(src.includes('taglineRef'), 'Stage-3 tagline removed')
  assert.ok(
    src.includes("fontSize: 'clamp(0.58rem, 1.5vw, 0.82rem)'"),
    'Stage-3 tagline lost its responsive size'
  )
  // No nowrap: the tagline is allowed to wrap, which is what keeps its long
  // line inside the padded container on small screens.
  const tagline = src.match(/<p style=\{\{ color: C\.gold[^>]*\}\}>/)
  assert.ok(tagline, 'tagline declaration not found')
  assert.equal(
    /whiteSpace: 'nowrap'/.test(tagline[0]),
    false,
    'the tagline must stay wrappable or it will overflow on mobile'
  )
})

/* ══════════════════ SCROLLED NAVBAR SURFACE ══════════════════ */

test('the scrolled navbar is no longer a solid white slab', async () => {
  const src = await read('components', 'Navbar.jsx')

  // --vk-nav-bg is white/near-white in every theme; using it as the scrolled
  // background is exactly the plain white bar this replaces.
  assert.equal(
    /backgroundColor: C\.navBg/.test(src),
    false,
    'the scrolled navbar is painted with the white --vk-nav-bg token again'
  )
})

test('the scrolled navbar is a theme-tinted translucent surface', async () => {
  const src = await read('components', 'Navbar.jsx')

  const surface = src.match(/const solidNavStyle = \{[\s\S]*?\n {2}\}/)
  assert.ok(surface, 'solidNavStyle not found')
  const s = surface[0]

  // Derived from the theme's own rgb tokens, so Studio Palette re-tints it.
  assert.ok(/rgba\(var\(--vk-dark-rgb\)/.test(s), 'nav tint is not built from --vk-dark-rgb')
  assert.ok(/rgba\(var\(--vk-green-rgb\)/.test(s), 'nav tint lost its theme green wash')
  assert.ok(/backdropFilter/.test(s) && /blur\(/.test(s), 'nav lost its backdrop blur')
  assert.ok(/borderBottom/.test(s), 'nav lost its border')
  assert.ok(/boxShadow/.test(s), 'nav lost its shadow')

  // Translucent, not opaque, and never a hard-coded black.
  assert.ok(/backgroundColor: 'rgba\(var\(--vk-dark-rgb\), 0\.\d+\)'/.test(s), 'nav tint is not translucent')
  assert.equal(/#000|rgba\(0, ?0, ?0/.test(s), false, 'nav tint hard-codes black instead of a theme token')
})

test('navbar text stays light, because the bar is dark in both states', async () => {
  const src = await read('components', 'Navbar.jsx')

  // With a dark tinted surface the ink must not flip at the scroll threshold.
  assert.equal(
    /navSolid \? C\.textDark/.test(src),
    false,
    'nav text switches to dark ink on what is now a dark surface'
  )
  assert.equal(
    /isDarkNav/.test(src),
    false,
    'nav still branches on the theme id — that is what caused white-on-white'
  )
  assert.ok(
    src.includes("'rgba(255,255,255,0.8)'"),
    'nav links lost their light ink'
  )
})

test('the Favourites first-paint fix survives the new surface', async () => {
  const src = await read('components', 'Navbar.jsx')
  assert.ok(src.includes('LIGHT_FROM_TOP_ROUTES'), 'route list removed')
  assert.ok(src.includes('/favourites'), 'Favourites dropped from the route list')
  assert.ok(
    /const navSolid = scrolled \|\| startsLight/.test(src),
    'navSolid no longer covers the non-hero routes'
  )
  assert.ok(
    /style=\{navSolid \? solidNavStyle : \{ backgroundColor: 'transparent' \} \}|style=\{navSolid \? solidNavStyle : \{ backgroundColor: 'transparent' \}\}/.test(src),
    'the nav container no longer picks between the tinted and transparent surfaces'
  )
})

/* ══════════════════ HERO EXIT — DARK/GREEN, NOT WHITE ══════════════════ */
//
// The pinned hero used to end its timeline by fading the whole <section> to
// opacity 0. Every dark layer it owns — the villa image, both static gradient
// overlays, the animated charcoal overlay and the green fog — went transparent
// at once, and nothing behind the pin is dark: ScrollTrigger's pin spacer is
// transparent and <body> carries no background rule, so the browser default
// white showed through. The exit read as a full-screen white/cream wash right
// before the dark services section arrived.
//
// The donor never had this: it fades only brandRef and taglineRef, leaving the
// dark treatment painted until the pin releases. These contracts pin that
// shape.

/** The hero timeline body, from `tl.to(` to the end of the gsap.context call. */
const heroTimeline = async () => {
  const src = await read('pages', 'HomePage.jsx')
  const tl = src.match(/tl\s*\.to\(scrollRef\.current[\s\S]*?\n\s*\}, sectionRef\)/)
  assert.ok(tl, 'pinned hero timeline not found')
  return tl[0]
}

test('the hero timeline never fades the whole pinned section away', async () => {
  const tl = await heroTimeline()

  // The exact regression: any tween that targets sectionRef and drives opacity.
  assert.equal(
    /sectionRef\.current[^)]*opacity/.test(tl),
    false,
    'the hero timeline animates sectionRef opacity again — the whole dark stack ' +
    'goes transparent and the browser-default white body shows through'
  )
  // sectionRef may still be the ScrollTrigger trigger; it must not be a tween target.
  assert.equal(
    /\.(to|from|fromTo|set)\(\s*sectionRef\.current/.test(tl),
    false,
    'sectionRef is a tween target again — it belongs only in scrollTrigger.trigger'
  )
})

test('the hero exit fades the foreground only', async () => {
  const tl = await heroTimeline()

  const brandExit = tl.match(/\.to\(\s*brandRef\.current,\s*\{[^}]*opacity: 0[^}]*\}[^)]*\)/)
  assert.ok(brandExit, 'the Stage-3 wordmark no longer fades out at the hero exit')

  const taglineExit = tl.match(/\.to\(\s*taglineRef\.current,\s*\{[^}]*opacity: 0[^}]*\}[^)]*\)/)
  assert.ok(taglineExit, 'the Stage-3 tagline no longer fades out at the hero exit')

  // Both must land in the last stretch of the timeline, after the fog is up
  // (fog enters at 0.52), or the wordmark leaves before it has been read.
  for (const [label, tween] of [['brand', brandExit[0]], ['tagline', taglineExit[0]]]) {
    const pos = tween.match(/,\s*(0\.\d+)\)$/)
    assert.ok(pos, `${label} exit has no explicit timeline position`)
    assert.ok(
      Number(pos[1]) >= 0.8,
      `${label} exit starts at ${pos[1]}, too early to be the hero exit`
    )
  }
})

test('the dark and green layers survive the exit untouched', async () => {
  const tl = await heroTimeline()

  // The fog is the green tint and the overlay is the charcoal. Neither may be
  // faded back down once raised, or the exit loses its colour again.
  const fogTweens = tl.match(/(?:to|fromTo)\(\s*fogRef\.current[\s\S]*?,\s*0\.\d+\)/g) || []
  assert.equal(fogTweens.length, 1, 'the fog is animated more than once — check the exit')
  assert.ok(/opacity: 1/.test(fogTweens[0]), 'the fog no longer reaches full opacity')

  const overlayTweens = tl.match(/(?:to|fromTo)\(\s*overlayRef\.current[\s\S]*?,\s*0\.\d+\)/g) || []
  assert.equal(overlayTweens.length, 1, 'the overlay is animated more than once — check the exit')
  const target = overlayTweens[0].match(/opacity: (0\.\d+)/)
  assert.ok(target, 'overlay opacity target not found')
  assert.ok(
    Number(target[1]) >= 0.8,
    `the overlay only darkens to ${target[1]} — the donor holds 0.85 through the exit`
  )
})

test('nothing behind the pin needs to be light for the hero to read', async () => {
  const src = await read('pages', 'HomePage.jsx')

  // The section paints its own dark ground. If sectionRef opacity is ever
  // animated again this is what stops being visible, so it is pinned here too.
  const section = src.match(/<section ref=\{sectionRef\}[^>]*>/)
  assert.ok(section, 'hero section declaration not found')
  assert.ok(
    section[0].includes('backgroundColor: C.charcoal'),
    'the hero section lost its own charcoal ground'
  )

  // The exit hands off to the services section, which must also be dark.
  const bands = src.match(/const SECTION_BG = \{[\s\S]*?\}/)
  assert.ok(bands, 'SECTION_BG not found')
  assert.ok(
    /services: C\.charcoal/.test(bands[0]),
    'the section after the hero is no longer dark — the handoff will flash'
  )
})

test('reduced motion still lands on the dark hero, not a faded one', async () => {
  const src = await read('pages', 'HomePage.jsx')

  // With reduced motion the timeline never runs, so every layer keeps its
  // declared opacity. That is only safe while the section itself is opaque by
  // default — an inline opacity on the section would strand it half-faded.
  const section = src.match(/<section ref=\{sectionRef\}[^>]*>/)
  assert.equal(
    /opacity:/.test(section[0]),
    false,
    'the hero section declares an inline opacity — reduced motion would strand it'
  )
  assert.ok(
    /if \(prefersReducedMotion\) return/.test(src),
    'the hero timeline no longer bails out under reduced motion'
  )
})
