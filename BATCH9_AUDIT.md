# Batch 9 audit decisions (before production edits)

Starting state: clean `main...origin/main`; HEAD `89ce180`; staged files 0.
Both donor pages and both CURRENT pages read completely. No AGENTS.md found.

| Feature | Donor | CURRENT at audit start | Class | Action |
|---|---|---|---|---|
| Admin tabs, counts, cards, featured, status, CRUD permissions | Present | Equivalent, semantic tabs | A | Preserve |
| Admin empty category | Message | Empty grid | C | Add localized message |
| Admin upload/save/delete feedback | Translation lookups with fallbacks | Hardcoded feedback | B | Adapt with complete six-language keys |
| Scoped gold scrollbar | Admin overlay, desktop sidebar, mobile drawer | Scroll containers present; class absent | B | Add existing class only |
| Admin field concepts and grouping | Basic + detailed specs | All useful concepts; stronger groups/tri-state preservation | A | Preserve |
| Agent | Flat name/email/contact | Real User relationship; refresh per open; stale protection | D | Reject donor architecture |
| Location | Public coordinates reused; truthiness bug at latitude 0 | Protected admin read and omission-on-unknown | D | Preserve CURRENT privacy |
| AI assistant | Direct form updates | Validated selected fields, permission gates | D | Preserve CURRENT |
| Images | Upload/preview/remove; first image overwrites main image | Same overwrite bug | A | No donor integration; fix proven round-trip bug |
| Modal usability | Top aligned scrolling; backdrop closes | Top aligned scrolling, Escape; safer backdrop | A | Preserve |
| Public filter concepts | 40 useful query fields + hasVideo | All 40 useful fields already present | A | Preserve |
| Multi-select heating/parking/building age | Repeated request params, incomplete restoration | Union vocabularies and getAll initialization | A | Preserve |
| Sections | Independent sections (nested FilterPanel remounts them) | Module-level FilterSection; mounted hidden bodies | A | Preserve |
| Basic/default open/order | Four basics, rooms/gross open, media last | Four basics, 23 sections, virtual tour last | A | Preserve |
| Date filter | Render-time ISO values | Validated relative-day values | D | Reject donor implementation |
| No amenity filters | Any/Yes/No even where backend only handles true | Honest yes-only and tri-state split | D | Reject unsupported semantics |
| Video filter | URL regex heuristic | Absent | D | Reject |
| Map | Same properties passed into donor map | Public-safe projection and fail-closed map | A | Preserve safe CURRENT |
| Apply | Redundant desktop request; mobile stays open | Desktop immediate; mobile closes | D | Preserve CURRENT |
| Search/sort/pagination/bulk actions | Absent from both donor pages | No missing donor feature | A | Do not invent |
| Themes/RTL/favourites | Partial localization and styling | Existing theme system, six languages, shared FavouritesContext | A | Preserve |

## Proven CURRENT correctness issues authorized by the safety audit

- Save always writes `mainImage: images[0]`, even when stored mainImage differs or is standalone.
- Upload completion can append files to another editor session; partial successful uploads are discarded on a later failure; Save remains enabled during uploads.
- Admin-location responses are unguarded across editor sessions/retries.
- Public filter requests can resolve out of order; failure masquerades as an empty search. Admin list errors are unhandled.
- Public state is initialized from URL only on mount, so navigation to another query on the same route does not restore controls.

These are positive correctness fixes, not donor-only feature counts. Backend production changes and dependencies: 0.

## Filter matrix

Every row uses the same CURRENT query key(s) as the donor. All are supported by the existing route except hasVideo, which is rejected.

| Donor UI | Donor query / CURRENT query | CURRENT UI | Backend / safe action |
|---|---|---|---|
| Type | listingType | Sale/Rent/all | Existing named key; preserve |
| District | district | District counts | Existing named key; preserve |
| Property Type | propertyType | 12 types | Existing named key; preserve |
| Price | minPrice,maxPrice | Range | Existing numeric handling; preserve |
| Rooms | rooms | Select | Existing key; preserve |
| Gross area | minSqm,maxSqm | Range | Existing numeric handling; preserve |
| Net area | minNetSqm,maxNetSqm | Range | Validated range; preserve |
| Open area | minOpenArea,maxOpenArea | Range | Validated range; preserve |
| Building age | buildingAge | Repeated multi-select | Allow-listed union/legacy support; preserve |
| Coefficient | minCoefficient,maxCoefficient | Range | Validated range; preserve |
| Floor | floor,totalFloors,floorLocation | Numbers + multi-select | Numbers + allow-listed enum; preserve |
| Heating | heating | Repeated multi-select | Allow-listed union; preserve |
| Bathrooms | baths | Select (no misleading 5+ label) | Exact numeric match; preserve |
| Kitchen | kitchenType | Repeated multi-select | Allow-listed enum; preserve |
| Balcony/lift/furnished | balcony,elevator,furnished | Yes-only checkboxes | Backend narrows true only; reject donor No option |
| Parking | parking | Repeated multi-select | Allow-listed union; preserve |
| Usage | usageStatus | Repeated multi-select | Allow-listed enum; preserve |
| Site/credit/exchange | withinSite,eligibleForCredit,exchange | Any/Yes/No | Validated tri-state; preserve |
| Title deed | titleDeedStatus | Repeated multi-select | Allow-listed enum; preserve |
| Wellness | pool,garden,sauna,jacuzzi,steamRoom,turkishBath,basement | Yes-only classic + tri-state optional | Supported booleans; preserve |
| Transport | nearbyTransport | Repeated multi-select | Allow-listed enum; preserve |
| Date | listedSince | Stable day count | Validated parser; reject raw date construction |
| Virtual tour | hasVirtualTour | Any/Yes/No | Supported tri-state; preserve |
| Video | hasVideo | Absent | Unsupported heuristic; reject |

No bbox parameters or hidden-coordinate proximity behavior will be added.
