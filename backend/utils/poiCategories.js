// backend/utils/poiCategories.js
//
// Canonical registry of "point of interest" categories for chatbot proximity
// search ("near BIM", "near a metro station", "near a hospital") — free,
// deterministic, no AI, matched the same word-by-word way
// utils/lifestyleConcepts.js's extractConceptIdsFromText already matches its
// own concept vocabulary (read that file first if this comment is unclear).
// This is a NEW sibling registry, not a modification of lifestyleConcepts.js
// — proximity-to-a-named-place-type is a different question than "does this
// listing's own text mention a lifestyle concept", so it gets its own
// vocabulary and its own resolver rather than being folded into the existing
// one.
//
// `overpassFilters` is an array of Overpass QL tag-filter fragments (e.g.
// '["amenity"="hospital"]') — an array (not a single string) because some
// categories need more than one OSM tagging convention unioned together
// (e.g. a transit station can be tagged public_transport=station,
// railway=station, or station=subway depending on how the mapper tagged
// it). services/poiSearch.js is the only consumer that turns these into an
// actual Overpass query.
//
// Word matching here mirrors lifestyleConcepts.js exactly for single-word
// keywords (normalize each whitespace-split token, exact match against the
// keyword list). A few keywords in this registry are genuinely multi-word
// phrases ("shopping center", "alışveriş merkezi", "green space", "yeşil
// alan") which a pure word-by-word matcher can never match (no single token
// equals the whole phrase) — those are matched against adjacent normalized-
// token N-GRAMS (bigrams for 2-word phrases, generalized for longer ones) by
// exact equality, anchoring phrase matching to real word boundaries exactly
// like single-word matching already is (see resolvePoiCategory below — this
// replaced an earlier plain-substring-on-the-whole-message approach, which
// could false-positive, e.g. "shopping center" as a substring of "shopping
// centered").
// A handful of keyword lists below list BOTH a bare Turkish noun (e.g.
// "hastane") AND its dative-case form (e.g. "hastaneye") side by side. This
// is a small, explicit, bounded alternate-spelling list — NOT general
// Turkish morphological analysis — added specifically because "near X" is
// almost always phrased in Turkish as "X'e/'a yakın" (dative case + "yakın"
// = "near"), so "hastaneye yakın" ("near a hospital") is arguably the single
// most natural way a real visitor phrases exactly the request this registry
// exists to catch. This mirrors the exact same tradeoff lifestyleConcepts.js
// documents for Arabic's fused "ال" (definite article) prefix — explicit
// alternate spellings for the common case, not real stemming (a Turkish
// locative/ablative/plural form beyond these listed dative forms still
// won't match, same accepted limitation as that sibling module).
//
// Wave 15B (CURRENT): the donor registry carries Arabic for two categories
// only (restaurant, cafe), so an Arabic nearby question resolved no category
// at all. Arabic keywords for the commonly-asked categories were added using
// the SAME strings utils/lifestyleConcepts.js already uses for these concepts
// — reused, not newly invented. Categories a visitor is unlikely to ask for
// in Arabic keep the donor vocabulary unchanged.
//
// `group` is a plain documentation/maintainability label (e.g. 'food',
// 'shopping', 'finance', ...) — POI_CATEGORIES stays a single flat array on
// purpose; neither resolvePoiCategory nor fetchPoisForCategory benefit from
// nesting into a grouped object, so `group` is metadata only, never branched
// on structurally.
//
// NOTE (Wave 15B, CURRENT): the donor's comments below refer to a "near X"
// PROPERTY-search feature in its chatPropertySearch.js with its own
// POI_PROXIMITY_THRESHOLD_KM. CURRENT has no such feature — "find apartments
// near schools" is handled by utils/lifestyleConcepts.js instead, which this
// registry does not touch. The radii below are therefore read only by
// services/areaInfoAnswer.js.
//
// `defaultRadiusKm` is a per-category "how far would a person reasonably
// expect to travel for this kind of place" default — additive, for a
// DIFFERENT feature (a future area-info/"what's near this property"
// question-answering capability, stage 2) to use. It is deliberately NOT
// read by chatPropertySearch.js's existing "near X" property-search feature
// — that feature keeps its own separate, fixed POI_PROXIMITY_THRESHOLD_KM
// (4km) constant untouched, zero behavior change here.
export const AREA_INFO_DEFAULT_RADIUS_KM = 4

export const POI_CATEGORIES = [
  {
    id: 'supermarket',
    group: 'shopping',
    keywords: ['bim', 'bım', 'bime', 'a101', 'şok', 'sok', 'migros', 'carrefoursa', 'market', 'markete', 'süpermarket', 'süpermarkete', 'grocery', 'supermarket', 'grocery store', 'سوبر ماركت', 'بقالة', 'سوق'],
    overpassFilters: ['["shop"="supermarket"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'transit_station',
    group: 'transit',
    keywords: ['metro', 'metroya', 'metrobus', 'metrobüs', 'metrobüse', 'subway', 'station', 'istasyon', 'istasyona', 'tram', 'tramvay', 'tramvaya', 'مترو', 'المترو', 'محطة', 'المحطة', 'مواصلات'],
    overpassFilters: ['["public_transport"="station"]', '["railway"="station"]', '["station"="subway"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'hospital',
    group: 'health',
    keywords: ['hospital', 'hastane', 'hastaneye', 'clinic', 'klinik', 'kliniğe', 'مستشفى', 'المستشفى', 'مستشفيات', 'عيادة'],
    overpassFilters: ['["amenity"="hospital"]', '["amenity"="clinic"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'place_of_worship',
    group: 'worship',
    keywords: ['mosque', 'cami', 'camiye', 'church', 'kilise', 'kiliseye', 'مسجد', 'المسجد', 'جامع', 'كنيسة'],
    overpassFilters: ['["amenity"="place_of_worship"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'park',
    group: 'leisure',
    keywords: ['park', 'parka', 'green space', 'yeşil alan', 'حديقة', 'الحديقة', 'حدائق'],
    overpassFilters: ['["leisure"="park"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'mall',
    group: 'shopping',
    keywords: ['mall', 'avm', 'avmye', 'shopping center', 'shopping centre', 'alışveriş merkezi', 'مول', 'مركز تسوق'],
    overpassFilters: ['["shop"="mall"]'],
    defaultRadiusKm: 6,
  },
  {
    id: 'pharmacy',
    group: 'health',
    keywords: ['pharmacy', 'eczane', 'eczaneye', 'صيدلية', 'الصيدلية'],
    overpassFilters: ['["amenity"="pharmacy"]'],
    defaultRadiusKm: 1.5,
  },

  // ─── food ─────────────────────────────────────────────────────────────
  {
    id: 'restaurant',
    group: 'food',
    keywords: ['restaurant', 'restaurants', 'restoran', 'restorana', 'مطعم'],
    overpassFilters: ['["amenity"="restaurant"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'cafe',
    group: 'food',
    keywords: ['cafe', 'coffee shop', 'kafe', 'kafeye', 'kahve', 'kahveye', 'مقهى'],
    overpassFilters: ['["amenity"="cafe"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'fast_food',
    group: 'food',
    keywords: ['fastfood', 'fast food', 'hamburger', 'hamburgere'],
    overpassFilters: ['["amenity"="fast_food"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'bar',
    group: 'food',
    keywords: ['bar', 'bara'],
    overpassFilters: ['["amenity"="bar"]'],
    defaultRadiusKm: 2.5,
  },
  {
    id: 'pub',
    group: 'food',
    keywords: ['pub', 'puba'],
    overpassFilters: ['["amenity"="pub"]'],
    defaultRadiusKm: 2.5,
  },
  {
    id: 'bakery',
    group: 'food',
    keywords: ['bakery', 'fırın', 'firin', 'fırına', 'firina'],
    overpassFilters: ['["shop"="bakery"]'],
    defaultRadiusKm: 1.5,
  },
  {
    id: 'patisserie',
    group: 'food',
    keywords: ['patisserie', 'pastane', 'pastaneye', 'pastry shop'],
    overpassFilters: ['["shop"="pastry"]'],
    defaultRadiusKm: 1.5,
  },

  // ─── shopping ─────────────────────────────────────────────────────────
  {
    id: 'convenience_store',
    group: 'shopping',
    keywords: ['convenience store', 'bakkal', 'bakkala'],
    overpassFilters: ['["shop"="convenience"]'],
    defaultRadiusKm: 1.5,
  },
  {
    id: 'clothing_store',
    group: 'shopping',
    keywords: ['clothing store', 'clothes shop', 'giyim mağazası', 'giyim mağazasına'],
    overpassFilters: ['["shop"="clothes"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'shoe_store',
    group: 'shopping',
    keywords: ['shoe store', 'ayakkabıcı', 'ayakkabıcıya'],
    overpassFilters: ['["shop"="shoes"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'electronics_store',
    group: 'shopping',
    keywords: ['electronics store', 'elektronik mağazası', 'teknoloji mağazası'],
    overpassFilters: ['["shop"="electronics"]'],
    defaultRadiusKm: 4,
  },
  {
    id: 'furniture_store',
    group: 'shopping',
    keywords: ['furniture store', 'mobilyacı', 'mobilyacıya', 'mobilya mağazası'],
    overpassFilters: ['["shop"="furniture"]'],
    defaultRadiusKm: 5,
  },
  {
    id: 'bookstore',
    group: 'shopping',
    keywords: ['bookstore', 'book shop', 'kitapçı', 'kitapçıya', 'kitabevi'],
    overpassFilters: ['["shop"="books"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'greengrocer',
    group: 'shopping',
    keywords: ['greengrocer', 'manav', 'manava'],
    overpassFilters: ['["shop"="greengrocer"]'],
    defaultRadiusKm: 1.5,
  },
  {
    id: 'butcher',
    group: 'shopping',
    keywords: ['butcher', 'kasap', 'kasaba'],
    overpassFilters: ['["shop"="butcher"]'],
    defaultRadiusKm: 1.5,
  },
  {
    id: 'marketplace',
    group: 'shopping',
    keywords: ['marketplace', 'pazar', 'pazara', 'semt pazarı'],
    overpassFilters: ['["amenity"="marketplace"]'],
    defaultRadiusKm: 2.5,
  },

  // ─── finance ──────────────────────────────────────────────────────────
  {
    id: 'bank',
    group: 'finance',
    keywords: ['bank', 'banka', 'bankaya', 'بنك', 'البنك', 'مصرف'],
    overpassFilters: ['["amenity"="bank"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'atm',
    group: 'finance',
    keywords: ['atm', 'atme', 'cash machine'],
    overpassFilters: ['["amenity"="atm"]'],
    defaultRadiusKm: 1.5,
  },

  // ─── health (additional) ─────────────────────────────────────────────
  {
    id: 'doctors',
    group: 'health',
    keywords: ['doctor', 'doctors', 'doktor', 'doktora'],
    overpassFilters: ['["amenity"="doctors"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'dentist',
    group: 'health',
    keywords: ['dentist', 'dentists', 'dişçi', 'dişçiye', 'diş hekimi'],
    overpassFilters: ['["amenity"="dentist"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'veterinary',
    group: 'health',
    keywords: ['veterinary', 'vet', 'veteriner', 'veterinere'],
    overpassFilters: ['["amenity"="veterinary"]'],
    defaultRadiusKm: 3,
  },

  // ─── education ────────────────────────────────────────────────────────
  {
    id: 'school',
    group: 'education',
    keywords: ['school', 'schools', 'okul', 'okula', 'مدرسة', 'مدارس', 'المدرسة', 'المدارس'],
    overpassFilters: ['["amenity"="school"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'kindergarten',
    group: 'education',
    keywords: ['kindergarten', 'nursery', 'anaokulu', 'anaokuluna', 'kreş', 'kreşe', 'روضة', 'حضانة'],
    overpassFilters: ['["amenity"="kindergarten"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'university',
    group: 'education',
    keywords: ['university', 'universities', 'üniversite', 'üniversiteye', 'جامعة', 'الجامعة'],
    overpassFilters: ['["amenity"="university"]'],
    defaultRadiusKm: 6,
  },
  {
    id: 'college',
    group: 'education',
    keywords: ['college', 'yüksekokul', 'yüksekokula'],
    overpassFilters: ['["amenity"="college"]'],
    defaultRadiusKm: 5,
  },
  {
    id: 'library',
    group: 'education',
    keywords: ['library', 'libraries', 'kütüphane', 'kütüphaneye'],
    overpassFilters: ['["amenity"="library"]'],
    defaultRadiusKm: 3,
  },

  // ─── leisure (additional) ────────────────────────────────────────────
  {
    id: 'playground',
    group: 'leisure',
    keywords: ['playground', 'oyun parkı', 'çocuk parkı'],
    overpassFilters: ['["leisure"="playground"]'],
    defaultRadiusKm: 1.5,
  },
  {
    id: 'fitness_centre',
    group: 'leisure',
    keywords: ['fitness centre', 'fitness center', 'gym', 'spor salonu', 'spor salonuna', 'نادي رياضي', 'صالة رياضية'],
    overpassFilters: ['["leisure"="fitness_centre"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'sports_centre',
    group: 'leisure',
    keywords: ['sports centre', 'sports center', 'spor merkezi', 'spor merkezine'],
    overpassFilters: ['["leisure"="sports_centre"]'],
    defaultRadiusKm: 4,
  },
  {
    id: 'swimming_pool',
    group: 'leisure',
    keywords: ['swimming pool', 'yüzme havuzu', 'havuza'],
    overpassFilters: ['["leisure"="swimming_pool"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'cinema',
    group: 'leisure',
    keywords: ['cinema', 'movie theater', 'sinema', 'sinemaya'],
    overpassFilters: ['["amenity"="cinema"]'],
    defaultRadiusKm: 5,
  },
  {
    id: 'theatre',
    group: 'leisure',
    keywords: ['theatre', 'theater', 'tiyatro', 'tiyatroya'],
    overpassFilters: ['["amenity"="theatre"]'],
    defaultRadiusKm: 5,
  },
  {
    id: 'museum',
    group: 'leisure',
    keywords: ['museum', 'museums', 'müze', 'müzeye'],
    overpassFilters: ['["tourism"="museum"]'],
    defaultRadiusKm: 6,
  },

  // ─── nature ──────────────────────────────────────────────────────────
  {
    id: 'beach',
    group: 'nature',
    keywords: ['beach', 'beaches', 'plaj', 'plaja', 'sahil', 'sahile', 'شاطئ', 'الشاطئ'],
    overpassFilters: ['["natural"="beach"]'],
    defaultRadiusKm: 8,
  },

  // ─── services ────────────────────────────────────────────────────────
  {
    id: 'post_office',
    group: 'services',
    keywords: ['post office', 'postane', 'postaneye', 'ptt'],
    overpassFilters: ['["amenity"="post_office"]'],
    defaultRadiusKm: 3,
  },
  {
    id: 'hairdresser',
    group: 'services',
    keywords: ['hairdresser', 'hair salon', 'kuaför', 'kuaföre'],
    overpassFilters: ['["shop"="hairdresser"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'beauty_salon',
    group: 'services',
    keywords: ['beauty salon', 'güzellik salonu', 'güzellik salonuna'],
    overpassFilters: ['["shop"="beauty"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'car_repair',
    group: 'services',
    keywords: ['car repair', 'auto repair', 'car mechanic', 'oto tamirci', 'oto tamirciye', 'araç tamiri', 'araç servisi', 'lastikçi', 'lastikçiye'],
    overpassFilters: ['["shop"="car_repair"]'],
    defaultRadiusKm: 4,
  },
  {
    id: 'laundry',
    group: 'services',
    keywords: ['laundry', 'laundromat', 'çamaşırhane', 'çamaşırhaneye'],
    overpassFilters: ['["shop"="laundry"]'],
    defaultRadiusKm: 2,
  },
  {
    id: 'fuel_station',
    group: 'services',
    keywords: ['fuel station', 'gas station', 'petrol station', 'benzinlik', 'benzinliğe', 'akaryakıt istasyonu'],
    overpassFilters: ['["amenity"="fuel"]'],
    defaultRadiusKm: 3,
  },

  // ─── transit (additional) ───────────────────────────────────────────
  {
    id: 'bus_stop',
    group: 'transit',
    keywords: ['bus stop', 'otobüs durağı', 'otobüs durağına', 'موقف باص', 'محطة باص'],
    overpassFilters: ['["highway"="bus_stop"]'],
    defaultRadiusKm: 1,
  },
  {
    id: 'bus_station',
    group: 'transit',
    keywords: ['bus station', 'otogar', 'otogara'],
    overpassFilters: ['["amenity"="bus_station"]'],
    defaultRadiusKm: 4,
  },
  {
    id: 'ferry_terminal',
    group: 'transit',
    keywords: ['ferry terminal', 'ferry', 'vapur iskelesi', 'iskele', 'iskeleye'],
    overpassFilters: ['["amenity"="ferry_terminal"]'],
    defaultRadiusKm: 5,
  },
  {
    id: 'airport',
    group: 'transit',
    keywords: ['airport', 'airports', 'havalimanı', 'havalimanına', 'havaalanı', 'havaalanına'],
    overpassFilters: ['["aeroway"="aerodrome"]'],
    defaultRadiusKm: 8,
  },
]

export const CANONICAL_POI_CATEGORY_IDS = POI_CATEGORIES.map((category) => category.id)

export const isValidPoiCategoryId = (id) => CANONICAL_POI_CATEGORY_IDS.includes(id)

// getCategoryRadiusKm(categoryId) -> the category's own defaultRadiusKm, or
// AREA_INFO_DEFAULT_RADIUS_KM if the category is unknown/unset. Additive
// helper for a future (stage 2) area-info feature — not consulted by
// chatPropertySearch.js's existing "near X" property-search feature, which
// keeps its own separate fixed POI_PROXIMITY_THRESHOLD_KM constant.
export const getCategoryRadiusKm = (categoryId) => {
  const category = POI_CATEGORIES.find((entry) => entry.id === categoryId)
  return category?.defaultRadiusKm ?? AREA_INFO_DEFAULT_RADIUS_KM
}

// Supermarket brand-name regex map — only consulted once the generic
// "supermarket" category has already matched via the word list above, and
// only ever tested against the SAME single token that matched a keyword
// (never against the whole free-text message), so a stray token like "book"
// or "sock" elsewhere in the sentence can never accidentally get tagged as
// a brand. This mirrors the exact patterns requested: bim -> b[ıi]m,
// a101 -> a[\s-]?101, şok/sok -> ş?ok.
const SUPERMARKET_BRANDS = [
  { id: 'bim', regex: /b[ıi]m/i },
  { id: 'a101', regex: /a[\s-]?101/i },
  { id: 'sok', regex: /ş?ok/i },
]

const resolveSupermarketBrand = (token = '') => {
  const brand = SUPERMARKET_BRANDS.find((entry) => entry.regex.test(token))
  return brand ? brand.id : null
}

// Same İ-fold-before-lowercase + Unicode letter/number strip as
// lifestyleConcepts.js's normalizeWord — kept as an independent copy per
// this codebase's established convention of small helpers not being shared
// cross-module (see chatPropertySearch.js's own note on this exact point).
const normalizeWord = (word = '') => word.replace(/İ/g, 'i').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Same rule and same length guard as utils/lifestyleConcepts.js's toSingular
// — the >4 floor keeps short words ("bus", "gas") from being truncated.
const toSingular = (word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

// buildNgrams(tokens, n) -> array of space-joined n-length windows over
// tokens, e.g. buildNgrams(['a','b','c'], 2) -> ['a b', 'b c']. Used to
// word-boundary-anchor multi-word phrase keyword matching below (see module
// comment) instead of the previous plain substring-on-the-whole-message
// approach.
const buildNgrams = (tokens, n) => {
  const ngrams = []
  for (let i = 0; i + n <= tokens.length; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '))
  }
  return ngrams
}

// resolvePoiCategory(text) -> { categoryId, brand } | null
//
// brand is only ever populated for the 'supermarket' category, and only
// when the visitor named a specific chain (e.g. "near BIM") — a bare
// "near a market"/"near a grocery store" query resolves brand: null, which
// callers (services/poiSearch.js) treat as "any supermarket", exactly the
// fallback behavior asked for.
export const resolvePoiCategory = (text = '') => {
  const tokens = text
    .replace(/İ/g, 'i')
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)

  // Precompute every n-gram window size actually needed by any phrase
  // keyword in the registry (almost always just bigrams, but generalized
  // for any longer phrase keyword too), keyed by word count.
  const ngramsByLength = new Map()
  const ngramsFor = (n) => {
    if (!ngramsByLength.has(n)) ngramsByLength.set(n, new Set(buildNgrams(tokens, n)))
    return ngramsByLength.get(n)
  }

  for (const category of POI_CATEGORIES) {
    const wordKeywords = category.keywords.filter((keyword) => !keyword.includes(' '))
    const phraseKeywords = category.keywords.filter((keyword) => keyword.includes(' '))

    // Singular/plural tolerance, so "hospitals" matches a list that only
    // spells "hospital". The donor's registry lists a plural for some
    // categories ('schools', 'restaurants') and not others ('hospitals',
    // 'parks'), which made the feature work or not depending on which noun
    // the visitor happened to pluralise. This is the SAME rule and the same
    // 4-character guard utils/lifestyleConcepts.js already applies to its own
    // vocabulary — a CURRENT convention reused, not a new one.
    const matchedToken = tokens.find(
      (token) => wordKeywords.includes(token) || wordKeywords.includes(toSingular(token))
    )

    const matchedPhrase = phraseKeywords.some((keyword) => {
      const keywordTokens = keyword.split(' ').filter(Boolean)
      const keywordNgrams = ngramsFor(keywordTokens.length)
      return keywordNgrams.has(keyword)
    })

    if (matchedToken || matchedPhrase) {
      const brand = category.id === 'supermarket' && matchedToken ? resolveSupermarketBrand(matchedToken) : null
      return { categoryId: category.id, brand }
    }
  }

  return null
}
