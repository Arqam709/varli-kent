# VARLIKENT Friend Bug Fixes Audit

Donor root: `C:\Users\ahsan\OneDrive\Desktop\bug_fixes\bug_fixes`

This matrix was completed before production edits. CURRENT remains the source of truth. `A` means CURRENT already contains the fix, `B` means the useful part must be adapted to newer CURRENT code, `C` means CURRENT still has the bug, and `D` means the donor change is stale, unsafe, incompatible, or an unrelated feature.

| File | Bug / donor intent | CURRENT state | Class | Action | Main risk |
|---|---|---|---:|---|---|
| backend/middleware/activityLogger.js | Log completed nested-router requests by their real API path | Finish handler still derives the path from `req.path`, which can be `/` after router unwinding | B | Adapt `originalUrl` path capture while retaining CURRENT skip rules and chat actions | Missing or mislabelled audit events |
| backend/middleware/rateLimiter.js | Limit authentication/contact abuse | No general limiter; donor trusts spoofable forwarding headers and has unbounded in-memory keys | D | Reject implementation; security hardening needs a proxy-aware bounded design | Rate-limit bypass and memory growth |
| backend/models/ActivityLog.js | Activity log schema | Byte-identical | A | No change | None |
| backend/models/ContactSubmission.js | Lead escalation metadata and fixed interests | CURRENT uses the newer configurable interest vocabulary | D | Reject schema/product expansion | Existing interest records and UI drift |
| backend/models/Property.js | Sold/let archive fields | Donor removes assigned-agent architecture and changes defaults/location semantics | D | Reject | Schema regression and private-location exposure |
| backend/models/SavedSearch.js | Anonymous saved-search alerts | No compatible verified ownership flow; CURRENT has authenticated property alerts | D | Reject subsystem | Unverified email subscriptions and duplicate alert systems |
| backend/models/SiteSettings.js | Lead email/escalation settings | Donor service does not consistently honor its own switch | D | Reject incomplete feature | Misleading settings and unsolicited mail |
| backend/models/TeamMember.js | Contact fields and strict localized work schema | CURRENT Mixed compatibility and validated rich portfolio are newer | D | Reject schema rewrite | Legacy localized data loss |
| backend/models/User.js | Inactivity deletion and notification preferences | Donor removes agent role and current auth fields; lifecycle support is incomplete | D | Reject | Destructive account semantics and role regression |
| backend/routes/activity.js | Longer activity history/export | CURRENT validates and caps requests; donor silently changes retention view and limits | D | Reject feature expansion | Unbounded/changed admin behavior |
| backend/routes/auth.js | Rate limits and account activity | CURRENT Google/password flows are stronger; donor logs sensitive reset data and weakens OAuth validation | D | Reject | Credential leakage and auth regression |
| backend/routes/contact.js | Rate limit, reply email, escalation | CURRENT allow-lists payloads; donor persists before dependent reads and can duplicate reply mail | D | Reject | Duplicate submissions/mail and validation regression |
| backend/routes/pageContent.js | Verification flags and editable section labels | CURRENT registry checks, translation fallback, sanitization, and no-op handling are stronger | A | No change | Donor would weaken validation |
| backend/routes/properties.js | Fuzzy search, status/archive, duplicate check | Donor forwards/accepts incompatible filters, removes assigned-agent handling, and exposes location fields | D | Reject | Privacy, query, and agent regressions |
| backend/routes/savedSearches.js | Create/unsubscribe anonymous alerts | Depends on rejected SavedSearch subsystem | D | Reject | Ownership and abuse risk |
| backend/routes/sitemap.js | Dynamic sitemap route | CURRENT has established SEO/canonical/static sitemap flow | D | Reject isolated route | Conflicting sitemap ownership |
| backend/routes/users.js | Owner protection, inactivity, notification prefs | Donor removes current permissions, agents, themes, and room-photo cleanup | D | Reject | Authorization and cleanup regressions |
| backend/server.js | Wire all donor subsystems | Donor drops current realtime, agent, notification, alert, and design-board routes and imports missing modules | D | Reject | Application startup and feature loss |
| backend/services/leadEscalation.js | Scheduled stale-lead escalation | Non-atomic read/send flow and incomplete setting integration | D | Reject | Duplicate mail and false UI promise |
| backend/services/savedSearchAlerts.js | Periodic new-listing mail | Advances checkpoints on failures and only processes a partial window | D | Reject | Permanently dropped notifications |
| backend/services/teamSpecialtyLookup.js | Route chatbot questions to specialists | English/Turkish substring matching conflicts with six-language deterministic knowledge | D | Reject | Chat quality and language regression |
| backend/utils/email.js | SMTP templates and escaping | CURRENT Resend transport, HTML/header escaping, and secret-safe logs are stronger | A | No change | Donor adds missing dependency and weaker operational behavior |
| backend/utils/fuzzySearch.js | Fuzzy listing search | Unbounded per-request Levenshtein scanning and incomplete Turkish normalization | D | Reject | CPU abuse and inconsistent matches |
| backend/utils/knowledgeAnswer.js | LLM service answers | CURRENT deterministic six-language answers and evidence handling are stronger | A | No change | Nondeterministic/three-language regression |
| frontend/index.html | Load fonts before CSS render | Font stylesheet is still imported from CSS | C | Move font request/preconnects into document head | Render timing only |
| frontend/src/App.jsx | Recover from render errors and split admin bundles | CURRENT has Suspense but no route-level render recovery | B | Add compatible boundary while preserving owner/admin/agent gates | Broken portal routing if copied literally |
| frontend/src/assets/assets.js | Use compressed brand/header assets | Donor swaps formats without proving visual equivalence or current use | D | Keep CURRENT assets | Branding/image regression |
| frontend/src/assets/brand_img.webp | Compressed brand asset | No verified need; matching PNG already exists | D | Do not add | Unreviewed visual change |
| frontend/src/assets/header_img.jpg | Compressed header asset | No verified need; matching PNG already exists | D | Do not add | Unreviewed visual change |
| frontend/src/components/AdminLayout.jsx | Keyboard skip link | CURRENT lacks an admin skip target | C | Add localized skip link and focusable main target | Low |
| frontend/src/components/ErrorBoundary.jsx | Prevent blank pages after render exceptions | File absent | C | Add boundary adapted for current roles, themes, language, and route reset | Stale fallback after navigation |
| frontend/src/components/Footer.jsx | Translate footer and improve dark-band readability | Several labels remain hardcoded | C | Use existing six-language keys/theme tokens | Missing-key fallbacks |
| frontend/src/components/ImageCropModal.jsx | Reliable crop math, focus, RTL, errors | CURRENT already has the stronger fix | A | No change | Donor would regress async/focus handling |
| frontend/src/components/Navbar.jsx | Label safety and mobile layout | CURRENT synchronous locale data, portal routing, and responsive layout are stronger | A | No change | Donor removes current navigation behavior |
| frontend/src/components/PropertyCard.jsx | Render video-first listings and localize labels/prices | CURRENT always renders the selected media as an image | C | Add safe image/video selection and localized price/labels | Media URL classification |
| frontend/src/components/PropertyMapView.jsx | Map approximate listings | CURRENT deliberately refuses hidden coordinates and has stronger validation/fitting | A | No change | Donor leaks approximate coordinates |
| frontend/src/components/PublicLayout.jsx | Skip link and section failure isolation | CURRENT lacks a public main skip target and render boundary | C | Add localized skip link/main target and route-reset boundary | Focus and recovery behavior |
| frontend/src/components/ShowroomCarousel.jsx | Prevent long modal copy from overflowing | CURRENT motion/accessibility is stronger but long content can still overflow narrow screens | B | Adapt min-size/scroll/wrapping only | Donor thumbnails lose keyboard access |
| frontend/src/contexts/LanguageContext.jsx | Lazy-load locale bundles | CURRENT synchronous six-language context avoids wrong-language frames/chunk failures | D | Reject | Flash of wrong language and failed locale state |
| frontend/src/index.css | Font loading and global presentation | Remove only the import moved to HTML | B | Surgical change | Duplicate font request |
| frontend/src/lib/cloudinaryUrl.js | Inject Cloudinary transforms | Donor hostname substring and path rewriting are unsafe for signed/private/video URLs | D | Reject | Broken media URLs |
| frontend/src/lib/formatPrice.js | Locale-aware separators and zero handling | CURRENT hardcodes one locale and treats zero as absent | B | Adapt six-language formatting while preserving custom labels | Display-only contract drift |
| frontend/src/lib/undoDelete.jsx | Delayed delete with toast Undo | Delete may fire while toast is paused; unload can drop the operation | D | Reject | Data/UI divergence |
| frontend/src/lib/usePageContent.js | Resolve CMS content safely | CURRENT provenance-aware resolver and stale guards are stronger | A | No change | Donor drops legitimate proper nouns |
| frontend/src/lib/useSeo.js | `noindex` option | CURRENT canonical and JSON-LD escaping are stronger; option only supports rejected unsubscribe page | A | No change | Canonical/structured-data regression |
| frontend/src/locales/ar.js | Donor UI strings | CURRENT keeps Arabic in the unified six-language catalogue | B | Port only keys required by accepted fixes | RTL/missing-key regression |
| frontend/src/locales/de.js | Donor UI strings | CURRENT keeps German in the unified catalogue | B | Port only keys required by accepted fixes | Missing-key regression |
| frontend/src/locales/en.js | Donor UI strings | CURRENT keeps English in the unified catalogue | B | Port only keys required by accepted fixes | Missing-key regression |
| frontend/src/locales/ru.js | Donor UI strings | CURRENT keeps Russian in the unified catalogue | B | Port only keys required by accepted fixes | Missing-key regression |
| frontend/src/locales/tr.js | Donor UI strings | CURRENT keeps Turkish in the unified catalogue | B | Port only keys required by accepted fixes | Missing-key regression |
| frontend/src/locales/ur.js | Donor UI strings | CURRENT keeps Urdu in the unified catalogue | B | Port only keys required by accepted fixes | RTL/missing-key regression |
| frontend/src/pages/AdminActivity.jsx | Show load failure and prevent stale replacement | CURRENT turns failures into a misleading empty/stale view | C | Add visible retry and request-generation guard | Admin-only UI |
| frontend/src/pages/AdminMessages.jsx | Translate delete/status feedback | CURRENT still has hardcoded messages | B | Use six-language keys/fallbacks only | Low |
| frontend/src/pages/AdminPageContent.jsx | Verified badges and editable section names | CURRENT registry, load generations, changed-only payloads, and contact vocabulary are stronger | A | No change | Donor would overwrite content and translations |
| frontend/src/pages/AdminProperties.jsx | Video thumbnails plus archive/duplicate UI | CURRENT agent/location/main-image/race guards are stronger; thumbnails still assume images | B | Adapt media preview only | Donor would regress agent and privacy flows |
| frontend/src/pages/AdminShowroom.jsx | Crop/upload/delete/editor improvements | CURRENT already has non-destructive crop, stale guards, bounded modal, and validated localized content | A | No change | Donor undo/bulk delete is unsafe |
| frontend/src/pages/AdminSiteSettings.jsx | Translate save feedback plus lead settings | CURRENT needs only localized feedback; lead subsystem is rejected | B | Port feedback keys only if missing | Unsupported settings |
| frontend/src/pages/AdminTeam.jsx | Rich portfolio, crop, contacts, caps | CURRENT rich editor, Mixed compatibility, uploads, crop, and bounded modal are stronger | A | No change | Donor schema/contact expansion is incompatible |
| frontend/src/pages/ArchitecturePage.jsx | Keep text legible when CMS band flips | CURRENT changes background but still hardcodes text for the default band | B | Make foreground tokens follow `bandFor` | Theme contrast |
| frontend/src/pages/ConstructionPage.jsx | Keep text legible when CMS band flips | Same remaining contrast bug; CURRENT palette/load validation is stronger | B | Adapt foreground tokens only | Theme contrast |
| frontend/src/pages/HomePage.jsx | Band-aware text, language refresh, error isolation | CURRENT has stronger exact backgrounds and hero fixes but still hardcodes some default-band text | B | Adapt targeted contrast/recovery behavior | Large high-motion page |
| frontend/src/pages/InteriorDesignPage.jsx | Band-aware text and showroom recovery | CURRENT palette validation/stale guard is stronger; contrast bug remains | B | Adapt contrast/recovery only | Theme contrast |
| frontend/src/pages/PropertiesPage.jsx | Lazy map plus search/alerts/archive filters | CURRENT filtering, URL restoration, stale/error behavior, repeated params, and privacy are stronger; the proposed lazy import cannot split because PropertyDetails imports the same map module synchronously | D | No change | Query/alert changes regress privacy and filtering; lazy import is ineffective in the current module graph |
| frontend/src/pages/PropertyDetailsPage.jsx | Render video gallery and locale-aware price | CURRENT agent, SEO, specs, stale guards, and approximate-location privacy are stronger | B | Adapt media and price display only | Privacy/agent regression if copied |
| frontend/src/pages/RenovationPage.jsx | Band-aware text and showroom recovery | CURRENT palette validation/stale guard is stronger; contrast bug remains | B | Adapt contrast/recovery only | Theme contrast |
| frontend/src/pages/SettingsPage.jsx | Chat history, notifications, anonymous settings | CURRENT ChatContext integration and authenticated route are stronger; donor notification/account systems are absent | A | No change | Donor weakens agent role and route protection |
| frontend/src/pages/SoldLetArchivePage.jsx | Add public sold/let archive | Backend contract is not present; donor request would currently return misleading data | D | Reject feature | Incorrect public results |
| frontend/src/pages/TeamPage.jsx | Rich modal, contacts, wrapping | CURRENT portfolio component, stale selection handling, Mixed localization, and crop fallback are stronger | A | Keep current; retain existing wrapping fixes | Donor drops accessibility/fallbacks |
| frontend/src/pages/UnsubscribeSavedSearchPage.jsx | Unsubscribe anonymous alert token | Depends on rejected saved-search subsystem and mutates state via GET | D | Reject | CSRF/ownership and missing contract |
| vercel.json | SPA rewrites | Equivalent CURRENT config lives at `frontend/vercel.json` | A | No root duplicate | Conflicting deployment roots |

## Schema and migration stop points

The donor changes to `Property`, `User`, `TeamMember`, `ContactSubmission`, `SiteSettings`, and the new `SavedSearch` model alter production semantics or introduce incomplete subsystems. They are recorded above and intentionally not applied. No migration or backfill is authorized or required by the accepted fixes.

## Final coverage and implementation result

All 70 donor files are represented in the matrix: 45 frontend files, 24 backend files, and 1 root/config file. The final disposition is:

- **INTEGRATED:** 27 donor files (20 class B and 7 class C). The six donor locale modules were adapted into CURRENT's unified `translations.js`, so these map to 22 CURRENT production files.
- **CURRENT ALREADY FIXED:** 15 files (class A).
- **CURRENT STRONGER:** 14 files (class D where CURRENT already has a safer or newer architecture).
- **REJECTED:** 14 files (class D where the proposed subsystem or implementation was incomplete, unsafe, or incompatible).
- **FOLLOW-UP REQUIRED:** 0 files.

The implemented fixes cover mounted-router activity paths; route render recovery; public/admin skip links; footer, property-card, admin-feedback, and error-boundary localization; image/video listing media; six-language price formatting; showroom overflow; stale/error-safe activity loading; video admin previews; CMS band-aware contrast; and property-details video galleries. The implementation preserves all request and response shapes, role checks, agent relationships, approximate-location privacy, chat separation, upload behavior, SEO behavior, themes, six languages, and Arabic/Urdu RTL.

## Validation

- Backend focused: `node --experimental-test-module-mocks --test tests/activityLogger.test.js` — 19/19 passed.
- Backend full: `npm test` — 2,300 passed, 0 failed, 6 skipped (2,306 total).
- Frontend full contracts/unit: `node --test tests/*.test.js` — 444/444 passed.
- Browser regression: `node --test tests/browser/globalLayout.test.js tests/browser/batch8ChatPropertyDetails.test.js tests/browser/batch9Properties.test.js` — 32/32 passed.
- Final global-layout browser rerun: `node --test tests/browser/globalLayout.test.js` — 7/7 passed.
- Focused ESLint for the integration surfaces — passed with no findings. A broader changed-file lint exposed 16 findings already present in the pre-integration CURRENT versions; no new lint finding was introduced.
- Frontend production build: `npm run build` — passed. Vite emitted its existing advisory about chunks larger than 500 kB.
- `git diff --check` — passed.
- Donor inventory verification — 70 files, 0 hash mismatches, 0 unreported files.

## Git safety

The repository remains on `main` at the starting commit `d36ae597c40e82e05ec2fc9c788ae7f33c92c675`. No file was staged, no commit was created, and nothing was pushed. Existing design-board/design-room-photo work and its package/server/user-route changes were left intact.
