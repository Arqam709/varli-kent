// backend/services/chatReplyRenderer.js
//
// Phase 3 (backend deterministic reply localization). The only place
// per-language prose composition happens: dictionary lookup + fallback,
// {placeholder} interpolation, pluralization, list-joining grammar, and the
// two reply-plan renderers (search-result summary, per-property match
// reason). This module makes NO policy/search/evidence decisions — it only
// renders what chatReplyPlan.js (or a caller) already decided.
//
// The English branch of every renderer here reproduces the previous
// English-only chatReplyBuilder.js logic byte-for-byte (same joins, same
// idiosyncrasies — e.g. property-type lists use a plain " and " join while
// feature lists use the Oxford-comma-style joiner, because that is what the
// original code actually did). This is deliberate: dozens of existing tests
// assert exact English strings with no language argument, and preserving
// them is the migration contract for this phase. Turkish/Arabic branches are
// new, natural-meaning renderings of the same evidence — not mechanical
// translations of the English sentence structure — and are flagged in the
// Phase 3 report as needing native-speaker review before shipping.

import { CHAT_MESSAGES, SUPPORTED_MESSAGE_LANGUAGES, DEFAULT_MESSAGE_LANGUAGE } from '../locales/chatMessages.js'
import { PROPERTY_TYPE_LABELS, GENERIC_PROPERTY_LABEL, LISTING_TYPE_LABELS } from '../locales/propertyTypeLabels.js'
import { CONCEPT_LABELS, GENERIC_DESCRIPTION_TOPIC } from '../locales/conceptLabels.js'

const warn = (message, details) => {
  console.warn(`[chatLocalization] ${message}`, details || '')
}

export const safeLanguage = (language) =>
  SUPPORTED_MESSAGE_LANGUAGES.includes(language) ? language : DEFAULT_MESSAGE_LANGUAGE

const getPath = (obj, pathArr) => pathArr.reduce((acc, key) => (acc == null ? acc : acc[key]), obj)

// Centralized lookup strategy (per the Phase 3 spec):
//   requested language -> requested key -> fallback to English key ->
//   safe generic fallback if still unavailable. Never throws. Logs once per
//   miss so a missing key is observable in dev/server logs without ever
//   reaching the visitor.
export const tMessage = (path, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const lang = safeLanguage(language)
  const pathArr = Array.isArray(path) ? path : String(path).split('.')

  let value = getPath(CHAT_MESSAGES[lang], pathArr)

  if (value === undefined) {
    if (lang !== DEFAULT_MESSAGE_LANGUAGE) {
      warn('missing key, falling back to en', { path: pathArr.join('.'), language: lang })
    }
    value = getPath(CHAT_MESSAGES[DEFAULT_MESSAGE_LANGUAGE], pathArr)
  }

  if (value === undefined) {
    warn('missing key in en fallback too — returning empty string', { path: pathArr.join('.') })
    return ''
  }

  return value
}

export const format = (template, params = {}) =>
  String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))

const PLURAL_LOCALE = { en: 'en', tr: 'tr', ar: 'ar' }

// Intl.PluralRules-backed pluralization. `forms` may supply any subset of
// {zero, one, two, few, many, other} — missing categories fall back down
// the chain to whatever IS defined, ending at `other`, so a form map that
// only defines {one, other} (English, and most of this phase's Turkish/
// Arabic property-type nouns — see propertyTypeLabels.js's header comment)
// never breaks, it just doesn't distinguish the categories it didn't author.
export const pluralize = (language, count, forms = {}) => {
  const lang = safeLanguage(language)
  let category = 'other'

  try {
    category = new Intl.PluralRules(PLURAL_LOCALE[lang] || 'en').select(count)
  } catch {
    category = count === 1 ? 'one' : 'other'
  }

  return forms[category] ?? forms.other ?? forms.many ?? forms.few ?? forms.two ?? forms.one ?? ''
}

// Natural per-language list joining. Arabic's "and" (و) attaches directly to
// the following word with no space (andWordGlued: true in chatMessages.js's
// grammar block); "or" (أو) does not — it is only ever glued for the AND
// conjunction, matching real Arabic orthography.
export const joinList = (items, language = DEFAULT_MESSAGE_LANGUAGE, conjunction = 'and') => {
  const list = Array.isArray(items) ? items.filter((item) => item !== null && item !== undefined && item !== '') : []

  if (list.length === 0) return ''
  if (list.length === 1) return String(list[0])

  const lang = safeLanguage(language)
  const grammar = CHAT_MESSAGES[lang]?.grammar || CHAT_MESSAGES.en.grammar
  const word = conjunction === 'or' ? grammar.orWord : grammar.andWord
  const glued = conjunction === 'and' && grammar.andWordGlued

  if (list.length === 2) {
    return glued ? `${list[0]} ${word}${list[1]}` : `${list[0]} ${word} ${list[1]}`
  }

  const head = list.slice(0, -1).join(grammar.listSeparator)
  const last = list[list.length - 1]

  if (glued) return `${head}${grammar.listSeparator}${word}${last}`
  if (grammar.dropCommaBeforeConjunction) return `${head} ${word} ${last}`
  return `${head}${grammar.listSeparator}${word} ${last}`
}

// ─── Property/listing/concept label accessors ──────────────────────────────
export const featureLabel = (featureId, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['featureLabel', featureId], language)

export const propertyTypeLabelForms = (propertyType, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const entry = PROPERTY_TYPE_LABELS[propertyType]
  if (!entry) {
    warn('missing propertyType label', { propertyType })
    return null
  }
  return entry[safeLanguage(language)] || entry.en
}

export const genericPropertyLabelForms = (language = DEFAULT_MESSAGE_LANGUAGE) =>
  GENERIC_PROPERTY_LABEL[safeLanguage(language)] || GENERIC_PROPERTY_LABEL.en

export const listingTypeLabel = (listingType, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const entry = LISTING_TYPE_LABELS[listingType]
  if (!entry) return null
  return entry[safeLanguage(language)] || entry.en
}

export const conceptMatchedLabel = (conceptId, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const entry = CONCEPT_LABELS[conceptId]?.matched
  if (!entry) {
    warn('missing concept matched label', { conceptId })
    return null
  }
  return entry[safeLanguage(language)] || entry.en
}

export const conceptUnverifiedLabel = (conceptId, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const entry = CONCEPT_LABELS[conceptId]?.unverified
  if (!entry) return null
  return entry[safeLanguage(language)] || entry.en
}

export const conceptTopicPhrase = (conceptId, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const entry = CONCEPT_LABELS[conceptId]?.topic
  if (!entry) return null
  return entry[safeLanguage(language)] || entry.en
}

// ─── Presentation-only: localizing "what was searched for" ─────────────────
// descriptionQuery (Gemini's/the fallback parser's internal, English-only
// free-text search phrase) must never reach visitor-facing prose. These
// helpers build a natural, localized explanation entirely from the closed,
// already-localized concept-id vocabulary above — never from descriptionQuery
// itself, never via translation, never via another AI call.
//
// requestedTopicsPhrase/genericDescriptionTopic describe what was REQUESTED
// (a neutral naming of the visitor's ask). They must never be used in place
// of conceptMatchedLabel/conceptUnverifiedLabel, which remain the sole
// source of truth for what was actually CONFIRMED by evidence — mixing the
// two would let a merely-requested concept read as a verified claim.
export const genericDescriptionTopic = (language = DEFAULT_MESSAGE_LANGUAGE) => {
  const lang = safeLanguage(language)
  return GENERIC_DESCRIPTION_TOPIC[lang] || GENERIC_DESCRIPTION_TOPIC.en
}

// Joins recognized concept ids into a natural noun phrase (e.g. "family-
// friendly suitability and school proximity"); falls back to the shared
// generic phrase when no concept id was recognized in the request.
export const requestedTopicsPhrase = (requestedConceptIds = [], language = DEFAULT_MESSAGE_LANGUAGE) => {
  const topics = requestedConceptIds.map((id) => conceptTopicPhrase(id, language)).filter(Boolean)
  return topics.length > 0 ? joinList(topics, language, 'and') : genericDescriptionTopic(language)
}

// Match-reason "why this matches" clause fragment for the two generic-claim
// cases (semanticGenericClaim/descriptionGenericClaim in chatReplyPlan.js) —
// both only ever fire when NO concept id was confirmed, so this is always
// built from the shared generic phrase, never a specific concept, and never
// implies a specific detail was verified.
const GENERIC_CLAIM_CLAUSE_BUILDERS = {
  en: (topic) => `reflects ${topic}`,
  tr: (topic) => `${topic} ile uyumlu`,
  ar: (topic) => `يتماشى مع ${topic}`,
}

export const genericMatchReasonClause = (language = DEFAULT_MESSAGE_LANGUAGE) => {
  const lang = safeLanguage(language)
  const build = GENERIC_CLAIM_CLAUSE_BUILDERS[lang] || GENERIC_CLAIM_CLAUSE_BUILDERS.en
  return build(genericDescriptionTopic(language))
}

// ─── Fixed-reply renderers ───────────────────────────────────────────────────
export const renderNonPropertyPageReply = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['nonPropertyPage'], language)

export const renderNonPropertyReply = (kind, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['nonProperty', kind], language)

export const renderSlotQuestionText = (slot, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['slotQuestion', slot], language)

export const renderGenericSlotQuestion = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['slotQuestion', 'generic'], language)

export const renderSlotFragment = (slot, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['slotFragment', slot], language)

export const renderMultiSlotQuestion = (fragments, language = DEFAULT_MESSAGE_LANGUAGE) =>
  format(tMessage(['multiSlotQuestionTemplate'], language), { fragments })

export const renderRefinementOfferText = (slot, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['refinementOffer', slot], language)

export const renderRefinementReofferText = (slot, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['refinementReoffer', slot], language)

export const renderMixedListingNotice = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['mixedListingNotice'], language)

export const renderNoResultsPlain = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['noResults', 'plain'], language)

// ─── English search-result renderer (byte-identical to the pre-Phase-3
// chatReplyBuilder.js buildReplyText — same joins, same idiosyncrasies) ────
const PROPERTY_TYPE_PLURAL_OVERRIDES_EN = { Duplex: 'Duplexes' }
const pluralizePropertyTypeEn = (type) => (PROPERTY_TYPE_PLURAL_OVERRIDES_EN[type] || `${type}s`).toLowerCase()

const renderSearchResultPlanEn = (plan, nextQuestion) => {
  if (plan.type === 'no_results') {
    // Unverified open-ended requirement, nothing to show: honest, terminal —
    // no "yet", no "try adding a district/budget/type" (narrowing a hard
    // filter cannot add the missing description evidence), no appended
    // question (the policy already declined to ask one).
    if (plan.softOutcome === 'unverified_no_results') {
      return tMessage(['softUnverified', 'noResults'], 'en')
    }
    if (plan.descriptionSearchAttempted) {
      return nextQuestion
        ? `I couldn't find a strong match from the property descriptions yet. ${nextQuestion}`
        : "I couldn't find a strong match from the property descriptions yet. Try adding a district, budget, or property type."
    }
    return "I couldn't find any available properties right now. Try adjusting your district, budget, or property type."
  }

  if (plan.type === 'soft_match') {
    const { count, verifiedCount, noneVerified, mixedVerified, matchedViaSemantic, requestedConceptIds, descriptionQuery, listingType, propertyType, propertyTypes } = plan
    const propertyText = count === 1 ? '1 property' : `${count} properties`

    let reply
    if (matchedViaSemantic) {
      reply = `I found ${propertyText} that may match your request by meaning.`
    } else if (noneVerified) {
      const topics = requestedConceptIds.map((id) => conceptTopicPhrase(id, 'en')).filter(Boolean)
      const topic = topics.length === 0 ? genericDescriptionTopic('en') : joinList(topics, 'en', 'or')
      reply = `I could not verify ${topic} from the available listing descriptions. Here ${count === 1 ? 'is' : 'are'} ${propertyText} that match${count === 1 ? 'es' : ''} your other requirements.`
    } else if (mixedVerified) {
      const verifiedText = verifiedCount === 1 ? '1 listing' : `${verifiedCount} listings`
      const remainderCount = count - verifiedCount
      const remainderText = remainderCount === 1 ? '1 broader alternative' : `${remainderCount} broader alternatives`
      reply = `I found ${verifiedText} with description-matched details, plus ${remainderText} that match your structured requirements.`
    } else {
      reply = `I found ${propertyText} that may match your request based on the property descriptions.`
    }

    if (descriptionQuery && !noneVerified) reply += ` I looked for properties with ${requestedTopicsPhrase(requestedConceptIds, 'en')} in mind.`
    if (listingType) reply += ` I also filtered it for ${listingType.toLowerCase()} properties.`

    const isMulti = propertyTypes.length > 1
    const semanticPropertyTypesPhrase = isMulti
      ? propertyTypes.map(pluralizePropertyTypeEn).join(' and ')
      : propertyType ? propertyType.toLowerCase() : null

    if (semanticPropertyTypesPhrase) {
      reply += isMulti
        ? ` I also matched the property types: ${semanticPropertyTypesPhrase}.`
        : ` I also matched the property type: ${semanticPropertyTypesPhrase}.`
    }

    if (nextQuestion) reply += ` ${nextQuestion}`
    return reply
  }

  const { count, fallbackLevel, listingType, propertyType, propertyTypes, maxPrice, districts, descriptionSearchAttempted, requestedConceptIds, relaxedFeatureIds } = plan
  const isMulti = propertyTypes.length > 1
  const propertyLabel = !isMulti && propertyType ? propertyType.toLowerCase() : 'property'
  const n = count === 1 ? `1 ${propertyLabel}` : `${count} ${propertyLabel === 'property' ? 'properties' : `${propertyLabel}s`}`

  const parts = []
  const propertyTypesPhrase = isMulti
    ? propertyTypes.map(pluralizePropertyTypeEn).join(' and ')
    : propertyType ? propertyType.toLowerCase() : null
  if (propertyTypesPhrase) parts.push(propertyTypesPhrase)
  if (listingType) parts.push(`for ${listingType.toLowerCase()}`)
  if (maxPrice) parts.push(`up to ₺${Number(maxPrice).toLocaleString('tr-TR')}`)
  if (districts.length > 0) parts.push(`in ${districts.join(' or ')}`)
  const description = parts.length ? ` — ${parts.join(' ')}` : ''

  const listingWord = listingType === 'Rent' ? 'rentals' : listingType === 'Sale' ? 'properties for sale' : 'properties'

  const relaxedFeatureLabelsEn = relaxedFeatureIds.map((id) => featureLabel(id, 'en'))
  // Unverified open-ended requirement WITH structured alternatives: an honest,
  // centralized notice that supersedes the generic description-mismatch line —
  // it states the specific requirement was not confirmed and frames these as
  // broader alternatives, never implying any listing satisfies the requirement.
  const softBroaderNotice = plan.softOutcome === 'unverified_with_alternatives'
    ? tMessage(['softUnverified', 'withAlternatives'], 'en')
    : ''
  const descriptionMismatchNotice = descriptionSearchAttempted
    ? `I couldn't find a strong match for ${requestedTopicsPhrase(requestedConceptIds, 'en')}, so here ${count === 1 ? 'is' : 'are'} some general ${listingWord} instead.`
    : ''
  const relaxedFeaturesNotice = fallbackLevel > 0 && relaxedFeatureLabelsEn.length > 0
    ? `I could not find ${listingWord} with ${joinList(relaxedFeatureLabelsEn, 'en', 'and')}, so these are alternatives without all requested features.`
    : ''
  const leadNotice = softBroaderNotice || descriptionMismatchNotice || relaxedFeaturesNotice

  const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1)
  const composeFallbackSentence = (base, defaultLead) => (leadNotice ? `${leadNotice} ${capitalize(base)}` : `${defaultLead}${base}`)

  if (fallbackLevel === 0) {
    if (leadNotice) {
      const sentence = composeFallbackSentence(`here ${count === 1 ? 'is' : 'are'} ${n}${description}`, '')
      return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
    }
    return nextQuestion ? `I found ${n}${description}. ${nextQuestion}` : `I found ${n}${description}.`
  }

  if (fallbackLevel === 1) {
    const sentence = composeFallbackSentence(`here ${count === 1 ? 'is' : 'are'} ${n} in the same area that may interest you`, "I couldn't find an exact match with all details, but ")
    return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
  }

  if (fallbackLevel === 2) {
    const sentence = composeFallbackSentence(`here ${count === 1 ? 'is' : 'are'} ${n} of that type from other areas`, 'Nothing matched in that district, but ')
    return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
  }

  const sentence = composeFallbackSentence(`here ${count === 1 ? 'is' : 'are'} ${n} to give you a starting point`, "I couldn't find a close match, but ")
  return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
}

// ─── Turkish / Arabic search-result renderers — equivalent meaning, natural
// per-language composition (not a mechanical mirror of the English clause
// structure). NEW for Phase 3 — needs native-speaker review; see report. ───
const renderSearchResultPlanTr = (plan, nextQuestion) => {
  if (plan.type === 'no_results') {
    if (plan.softOutcome === 'unverified_no_results') {
      return tMessage(['softUnverified', 'noResults'], 'tr')
    }
    if (plan.descriptionSearchAttempted) {
      const base = tMessage(['noResults', 'descriptionAttempted'], 'tr')
      return nextQuestion ? `${base} ${nextQuestion}` : `${base} ${tMessage(['noResults', 'descriptionAttemptedSuffix'], 'tr')}`
    }
    return tMessage(['noResults', 'plain'], 'tr')
  }

  if (plan.type === 'soft_match') {
    const { count, verifiedCount, noneVerified, mixedVerified, matchedViaSemantic, requestedConceptIds, descriptionQuery, listingType, propertyType, propertyTypes } = plan
    const propertyText = `${count} ${pluralize('tr', count, genericPropertyLabelForms('tr'))}`

    let reply
    if (matchedViaSemantic) {
      reply = `Anlamca isteğinizle eşleşebilecek ${propertyText} buldum.`
    } else if (noneVerified) {
      const topics = requestedConceptIds.map((id) => conceptTopicPhrase(id, 'tr')).filter(Boolean)
      const topic = topics.length === 0 ? genericDescriptionTopic('tr') : joinList(topics, 'tr', 'or')
      reply = `${topic} mevcut ilan açıklamalarından doğrulayamadım. Yine de diğer isteklerinizle eşleşen ${propertyText} buluyorum.`
    } else if (mixedVerified) {
      reply = `Açıklamayla eşleşen ${verifiedCount} ilan, artı yapısal isteklerinizle eşleşen ${count - verifiedCount} alternatif buldum.`
    } else {
      reply = `Mülk açıklamalarına göre isteğinizle eşleşebilecek ${propertyText} buldum.`
    }

    if (descriptionQuery && !noneVerified) reply += ` Aradığım özellikler arasında ${requestedTopicsPhrase(requestedConceptIds, 'tr')} vardı.`
    if (listingType) reply += ` Ayrıca ${listingTypeLabel(listingType, 'tr')} mülklere göre filtreledim.`

    const isMulti = propertyTypes.length > 1
    const typesPhrase = isMulti
      ? joinList(propertyTypes.map((t) => propertyTypeLabelForms(t, 'tr')?.other).filter(Boolean), 'tr', 'and')
      : propertyType ? propertyTypeLabelForms(propertyType, 'tr')?.one : null

    if (typesPhrase) reply += ` Ayrıca şu mülk türünü de eşleştirdim: ${typesPhrase}.`
    if (nextQuestion) reply += ` ${nextQuestion}`
    return reply
  }

  const { count, fallbackLevel, listingType, propertyType, propertyTypes, maxPrice, districts, descriptionSearchAttempted, requestedConceptIds, relaxedFeatureIds } = plan
  const isMulti = propertyTypes.length > 1
  const label = isMulti
    ? joinList(propertyTypes.map((t) => propertyTypeLabelForms(t, 'tr')?.other).filter(Boolean), 'tr', 'and')
    : propertyType
    ? pluralize('tr', count, propertyTypeLabelForms(propertyType, 'tr'))
    : pluralize('tr', count, genericPropertyLabelForms('tr'))
  const n = `${count} ${label}`

  const parts = []
  if (listingType) parts.push(listingTypeLabel(listingType, 'tr'))
  if (maxPrice) parts.push(`₺${Number(maxPrice).toLocaleString('tr-TR')}'a kadar`)
  if (districts.length > 0) parts.push(`${districts.join(' veya ')} bölgesinde`)
  const description = parts.length ? ` (${parts.join(', ')})` : ''

  const relaxedLabelsTr = relaxedFeatureIds.map((id) => featureLabel(id, 'tr'))
  const softBroaderNoticeTr = plan.softOutcome === 'unverified_with_alternatives'
    ? tMessage(['softUnverified', 'withAlternatives'], 'tr')
    : ''
  const descMismatch = descriptionSearchAttempted
    ? `${requestedTopicsPhrase(requestedConceptIds, 'tr')} ile güçlü bir eşleşme bulamadım, bu yüzden bunun yerine genel bazı seçenekler gösteriyorum.`
    : ''
  const relaxedNotice = fallbackLevel > 0 && relaxedLabelsTr.length > 0
    ? `${joinList(relaxedLabelsTr, 'tr', 'and')} özelliklerine sahip seçenek bulamadım, bu yüzden bunlar istenen tüm özellikleri içermeyen alternatifler.`
    : ''
  const leadNotice = softBroaderNoticeTr || descMismatch || relaxedNotice
  const compose = (base) => (leadNotice ? `${leadNotice} ${base}` : base)

  let sentence
  if (fallbackLevel === 0) {
    sentence = compose(`İşte ${n}${description}`)
  } else if (fallbackLevel === 1) {
    sentence = compose(`İşte aynı bölgeden ilginizi çekebilecek ${n}${description}`)
  } else if (fallbackLevel === 2) {
    sentence = compose(`Bu bölgede eşleşme bulamadım, ama işte diğer bölgelerden bu türde ${n}${description}`)
  } else {
    sentence = compose(`Yakın bir eşleşme bulamadım, ama işte başlangıç noktası olması için ${n}${description}`)
  }

  return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
}

const renderSearchResultPlanAr = (plan, nextQuestion) => {
  if (plan.type === 'no_results') {
    if (plan.softOutcome === 'unverified_no_results') {
      return tMessage(['softUnverified', 'noResults'], 'ar')
    }
    if (plan.descriptionSearchAttempted) {
      const base = tMessage(['noResults', 'descriptionAttempted'], 'ar')
      return nextQuestion ? `${base} ${nextQuestion}` : `${base} ${tMessage(['noResults', 'descriptionAttemptedSuffix'], 'ar')}`
    }
    return tMessage(['noResults', 'plain'], 'ar')
  }

  if (plan.type === 'soft_match') {
    const { count, verifiedCount, noneVerified, mixedVerified, matchedViaSemantic, requestedConceptIds, descriptionQuery, listingType, propertyType, propertyTypes } = plan
    const propertyText = `${count} ${pluralize('ar', count, genericPropertyLabelForms('ar'))}`

    let reply
    if (matchedViaSemantic) {
      reply = `وجدت ${propertyText} قد تتطابق مع طلبك من حيث المعنى.`
    } else if (noneVerified) {
      const topics = requestedConceptIds.map((id) => conceptTopicPhrase(id, 'ar')).filter(Boolean)
      const topic = topics.length === 0 ? genericDescriptionTopic('ar') : joinList(topics, 'ar', 'or')
      reply = `تعذّر التأكد من ${topic} من أوصاف الإعلانات المتاحة. مع ذلك، وجدت ${propertyText} تطابق متطلباتك الأخرى.`
    } else if (mixedVerified) {
      reply = `وجدت ${verifiedCount} إعلاناً مطابقاً للوصف، بالإضافة إلى ${count - verifiedCount} بديل يطابق متطلباتك الأساسية.`
    } else {
      reply = `وجدت ${propertyText} قد تتطابق مع طلبك بناءً على أوصاف العقارات.`
    }

    if (descriptionQuery && !noneVerified) reply += ` بحثت عن عقارات تراعي ${requestedTopicsPhrase(requestedConceptIds, 'ar')}.`
    if (listingType) reply += ` كما قمت بتصفيتها لتكون ${listingTypeLabel(listingType, 'ar')}.`

    const isMulti = propertyTypes.length > 1
    const typesPhrase = isMulti
      ? joinList(propertyTypes.map((t) => propertyTypeLabelForms(t, 'ar')?.other).filter(Boolean), 'ar', 'and')
      : propertyType ? propertyTypeLabelForms(propertyType, 'ar')?.one : null

    if (typesPhrase) reply += ` كما طابقت نوع العقار: ${typesPhrase}.`
    if (nextQuestion) reply += ` ${nextQuestion}`
    return reply
  }

  const { count, fallbackLevel, listingType, propertyType, propertyTypes, maxPrice, districts, descriptionSearchAttempted, requestedConceptIds, relaxedFeatureIds } = plan
  const isMulti = propertyTypes.length > 1
  const label = isMulti
    ? joinList(propertyTypes.map((t) => propertyTypeLabelForms(t, 'ar')?.other).filter(Boolean), 'ar', 'and')
    : propertyType
    ? pluralize('ar', count, propertyTypeLabelForms(propertyType, 'ar'))
    : pluralize('ar', count, genericPropertyLabelForms('ar'))
  const n = `${count} ${label}`

  const parts = []
  if (listingType) parts.push(listingTypeLabel(listingType, 'ar'))
  if (maxPrice) parts.push(`حتى ₺${Number(maxPrice).toLocaleString('en-US')}`)
  if (districts.length > 0) parts.push(`في ${districts.join(' أو ')}`)
  const description = parts.length ? ` (${parts.join('، ')})` : ''

  const relaxedLabelsAr = relaxedFeatureIds.map((id) => featureLabel(id, 'ar'))
  const softBroaderNoticeAr = plan.softOutcome === 'unverified_with_alternatives'
    ? tMessage(['softUnverified', 'withAlternatives'], 'ar')
    : ''
  const descMismatch = descriptionSearchAttempted
    ? `لم أجد تطابقاً قوياً مع ${requestedTopicsPhrase(requestedConceptIds, 'ar')}، لذا إليك بعض الخيارات العامة بدلاً من ذلك.`
    : ''
  const relaxedNotice = fallbackLevel > 0 && relaxedLabelsAr.length > 0
    ? `لم أجد خيارات تحتوي على ${joinList(relaxedLabelsAr, 'ar', 'and')}، لذا هذه بدائل بدون جميع الميزات المطلوبة.`
    : ''
  const leadNotice = softBroaderNoticeAr || descMismatch || relaxedNotice
  const compose = (base) => (leadNotice ? `${leadNotice} ${base}` : base)

  let sentence
  if (fallbackLevel === 0) {
    sentence = compose(`إليك ${n}${description}`)
  } else if (fallbackLevel === 1) {
    sentence = compose(`إليك ${n}${description} من نفس المنطقة قد تهمك`)
  } else if (fallbackLevel === 2) {
    sentence = compose(`لم أجد تطابقاً في هذه المنطقة، لكن إليك ${n}${description} من هذا النوع من مناطق أخرى`)
  } else {
    sentence = compose(`لم أجد تطابقاً قريباً، لكن إليك ${n}${description} كنقطة انطلاق`)
  }

  return nextQuestion ? `${sentence}. ${nextQuestion}` : `${sentence}.`
}

export const renderSearchResultPlan = (plan, nextQuestion, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const lang = safeLanguage(language)

  if (lang === 'tr') return renderSearchResultPlanTr(plan, nextQuestion)
  if (lang === 'ar') return renderSearchResultPlanAr(plan, nextQuestion)
  return renderSearchResultPlanEn(plan, nextQuestion)
}

// ─── Match-reason renderer ───────────────────────────────────────────────────
const renderMatchReasonPlanEn = (plan) => {
  const {
    propertyType, listingType, propertyTypeMatches, listingTypeMatches, districtMatches,
    propertyTypeInRequestedSet, bedsMatches, bathsMatches, budgetMatches, beds, baths,
    matchedFeatureIds, matchedConceptIds, unverifiedConceptId, semanticGenericClaim, descriptionGenericClaim,
    requestedDistricts, propertyDistrict,
  } = plan

  const article = /^[aeiou]/i.test(propertyType || '') ? 'an' : 'a'
  const primaryParts = []
  if (propertyTypeMatches) primaryParts.push(`${article} ${propertyType.toLowerCase()}`)
  if (listingTypeMatches) primaryParts.push(`for ${listingType.toLowerCase()}`)
  if (districtMatches) primaryParts.push(`in ${propertyDistrict}`)

  const extraParts = []
  if (propertyTypeInRequestedSet) extraParts.push('is one of the property types you mentioned')
  if (bedsMatches) extraParts.push(`has your requested ${beds} bedrooms`)
  if (bathsMatches) extraParts.push(`has your requested ${baths} bathrooms`)
  if (budgetMatches) extraParts.push('fits your budget')
  if (matchedFeatureIds.length > 0) extraParts.push(`has ${matchedFeatureIds.map((id) => featureLabel(id, 'en')).join(', ')}`)

  let unverifiedSoftNote = null

  if (matchedConceptIds.length > 0) {
    extraParts.push(...matchedConceptIds.map((id) => conceptMatchedLabel(id, 'en')).filter(Boolean))
  } else if (semanticGenericClaim) {
    extraParts.push(genericMatchReasonClause('en'))
  } else if (descriptionGenericClaim) {
    extraParts.push(genericMatchReasonClause('en'))
  } else if (unverifiedConceptId) {
    unverifiedSoftNote = conceptUnverifiedLabel(unverifiedConceptId, 'en') || 'That part of your description could not be confirmed from the listing details.'
  }

  const clauses = []
  if (primaryParts.length > 0) clauses.push(`it is ${primaryParts.join(' ')}`)
  clauses.push(...extraParts)

  let reason
  if (clauses.length === 0) {
    reason = 'This is one of our available listings that may interest you.'
  } else {
    const body = primaryParts.length > 0 ? clauses.join(', and ') : `it ${clauses.join(', and ')}`
    reason = `This matches because ${body}.`
  }

  if (unverifiedSoftNote) reason += ` ${unverifiedSoftNote}`

  if (requestedDistricts.length > 0 && !districtMatches) {
    reason += ` It is from ${propertyDistrict || 'another area'} instead of ${requestedDistricts.join(' or ')}, since there was no exact match in your requested district.`
  }

  return reason
}

const renderMatchReasonPlanTr = (plan) => {
  const {
    propertyType, listingType, propertyTypeMatches, listingTypeMatches, districtMatches,
    propertyTypeInRequestedSet, bedsMatches, bathsMatches, budgetMatches, beds, baths,
    matchedFeatureIds, matchedConceptIds, unverifiedConceptId, semanticGenericClaim, descriptionGenericClaim,
    requestedDistricts, propertyDistrict,
  } = plan

  const primaryParts = []
  if (propertyTypeMatches) primaryParts.push(propertyTypeLabelForms(propertyType, 'tr')?.one)
  if (listingTypeMatches) primaryParts.push(listingTypeLabel(listingType, 'tr'))
  if (districtMatches) primaryParts.push(`${propertyDistrict} bölgesinde`)

  const extraParts = []
  if (propertyTypeInRequestedSet) extraParts.push('belirttiğiniz mülk türlerinden biri')
  if (bedsMatches) extraParts.push(`istediğiniz ${beds} yatak odasına sahip`)
  if (bathsMatches) extraParts.push(`istediğiniz ${baths} banyoya sahip`)
  if (budgetMatches) extraParts.push('bütçenize uygun')
  if (matchedFeatureIds.length > 0) extraParts.push(`${joinList(matchedFeatureIds.map((id) => featureLabel(id, 'tr')), 'tr', 'and')} özelliğine sahip`)

  let unverifiedSoftNote = null

  if (matchedConceptIds.length > 0) {
    extraParts.push(...matchedConceptIds.map((id) => conceptMatchedLabel(id, 'tr')).filter(Boolean))
  } else if (semanticGenericClaim) {
    extraParts.push(genericMatchReasonClause('tr'))
  } else if (descriptionGenericClaim) {
    extraParts.push(genericMatchReasonClause('tr'))
  } else if (unverifiedConceptId) {
    unverifiedSoftNote = conceptUnverifiedLabel(unverifiedConceptId, 'tr') || 'Açıklamanızın bu kısmı ilan detaylarından doğrulanamadı.'
  }

  const allParts = [...primaryParts, ...extraParts].filter(Boolean)

  let reason
  if (allParts.length === 0) {
    reason = 'Bu, ilginizi çekebilecek mevcut ilanlarımızdan biri.'
  } else {
    reason = `Bu eşleşiyor çünkü ${joinList(allParts, 'tr', 'and')}.`
  }

  if (unverifiedSoftNote) reason += ` ${unverifiedSoftNote}`

  if (requestedDistricts.length > 0 && !districtMatches) {
    reason += ` İstediğiniz bölgede tam bir eşleşme olmadığından, bu ilan ${requestedDistricts.join(' veya ')} yerine ${propertyDistrict || 'başka bir bölgeden'}.`
  }

  return reason
}

const renderMatchReasonPlanAr = (plan) => {
  const {
    propertyType, listingType, propertyTypeMatches, listingTypeMatches, districtMatches,
    propertyTypeInRequestedSet, bedsMatches, bathsMatches, budgetMatches, beds, baths,
    matchedFeatureIds, matchedConceptIds, unverifiedConceptId, semanticGenericClaim, descriptionGenericClaim,
    requestedDistricts, propertyDistrict,
  } = plan

  const primaryParts = []
  if (propertyTypeMatches) primaryParts.push(propertyTypeLabelForms(propertyType, 'ar')?.one)
  if (listingTypeMatches) primaryParts.push(listingTypeLabel(listingType, 'ar'))
  if (districtMatches) primaryParts.push(`في ${propertyDistrict}`)

  const extraParts = []
  if (propertyTypeInRequestedSet) extraParts.push('من ضمن أنواع العقارات التي ذكرتها')
  if (bedsMatches) extraParts.push(`يضم ${beds} غرف نوم كما طلبت`)
  if (bathsMatches) extraParts.push(`يضم ${baths} حمامات كما طلبت`)
  if (budgetMatches) extraParts.push('يناسب ميزانيتك')
  if (matchedFeatureIds.length > 0) extraParts.push(`يضم ${joinList(matchedFeatureIds.map((id) => featureLabel(id, 'ar')), 'ar', 'and')}`)

  let unverifiedSoftNote = null

  if (matchedConceptIds.length > 0) {
    extraParts.push(...matchedConceptIds.map((id) => conceptMatchedLabel(id, 'ar')).filter(Boolean))
  } else if (semanticGenericClaim) {
    extraParts.push(genericMatchReasonClause('ar'))
  } else if (descriptionGenericClaim) {
    extraParts.push(genericMatchReasonClause('ar'))
  } else if (unverifiedConceptId) {
    unverifiedSoftNote = conceptUnverifiedLabel(unverifiedConceptId, 'ar') || 'تعذّر التأكد من هذا الجزء من الوصف بناءً على تفاصيل الإعلان.'
  }

  const allParts = [...primaryParts, ...extraParts].filter(Boolean)

  let reason
  if (allParts.length === 0) {
    reason = 'هذا أحد إعلاناتنا المتاحة التي قد تهمك.'
  } else {
    reason = `يطابق هذا لأنه ${joinList(allParts, 'ar', 'and')}.`
  }

  if (unverifiedSoftNote) reason += ` ${unverifiedSoftNote}`

  if (requestedDistricts.length > 0 && !districtMatches) {
    reason += ` هذا العقار من ${propertyDistrict || 'منطقة أخرى'} بدلاً من ${requestedDistricts.join(' أو ')}، لعدم وجود تطابق تام في المنطقة المطلوبة.`
  }

  return reason
}

export const renderMatchReasonPlan = (plan, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const lang = safeLanguage(language)

  if (lang === 'tr') return renderMatchReasonPlanTr(plan)
  if (lang === 'ar') return renderMatchReasonPlanAr(plan)
  return renderMatchReasonPlanEn(plan)
}

// ─── District-scope renderers ───────────────────────────────────────────────
export const renderDistrictScopeQuestion = ({ district, concepts, typeLabel }, language = DEFAULT_MESSAGE_LANGUAGE) =>
  format(tMessage(['districtScope', 'questionTemplate'], language), { district, concepts, typeLabel })

export const renderDistrictScopeRetryQuestion = (district, language = DEFAULT_MESSAGE_LANGUAGE) =>
  format(tMessage(['districtScope', 'retryTemplate'], language), { district })

export const districtScopeConceptFallback = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['districtScope', 'conceptFallback'], language)

// ─── Lead-flow renderers ─────────────────────────────────────────────────────
export const renderLeadThankYou = (name, phone, language = DEFAULT_MESSAGE_LANGUAGE) =>
  format(tMessage(['leadFlow', 'thankYouTemplate'], language), { name, phone })

export const renderLeadSaveFailure = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['leadFlow', 'saveFailure'], language)

export const renderLeadCancellation = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['leadFlow', 'cancellation'], language)

export const renderLeadCorrectionPrefix = (language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['leadFlow', 'correctionRetryPrefix'], language)

export const leadFieldName = (fieldId, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['leadFlow', 'fieldName', fieldId], language)

export const leadOrdinalWord = (index, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['leadFlow', 'ordinal', String(index + 1)], language)

export const leadInterestTypeDisplay = (interestType, language = DEFAULT_MESSAGE_LANGUAGE) => tMessage(['leadFlow', 'interestTypeDisplay', interestType], language)

export const renderMissingFieldsQuestion = (missingFieldIds, propertyTitle, language = DEFAULT_MESSAGE_LANGUAGE) => {
  if (!missingFieldIds || missingFieldIds.length === 0) return null

  const intro = propertyTitle
    ? tMessage(['leadFlow', 'missingFieldsIntroWithProperty'], language)
    : tMessage(['leadFlow', 'missingFieldsIntroGeneric'], language)

  if (missingFieldIds.length === 1) {
    return format(tMessage(['leadFlow', 'missingFieldsSingleTemplate'], language), {
      intro,
      field: leadFieldName(missingFieldIds[0], language),
    })
  }

  const fieldsWithTimeInvite = [...missingFieldIds, 'preferredTime']
  const fieldNames = fieldsWithTimeInvite.map((id) => leadFieldName(id, language))

  return format(tMessage(['leadFlow', 'missingFieldsMultiTemplate'], language), {
    intro,
    fields: joinList(fieldNames, language, 'and'),
  })
}

export const renderConfirmationSummary = (pendingLead, interestType, searchContextText, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const label = (key) => tMessage(['leadFlow', 'confirmationLabel', key], language)

  const lines = [
    tMessage(['leadFlow', 'confirmationIntro'], language),
    `${label('name')}: ${pendingLead.name}`,
    `${label('phone')}: ${pendingLead.phone}`,
    `${label('email')}: ${pendingLead.email}`,
    `${label('interest')}: ${leadInterestTypeDisplay(interestType, language)}`,
  ]

  if (pendingLead.propertyTitle) {
    lines.push(`${label('property')}: ${pendingLead.propertyTitle}`)
  } else if (searchContextText) {
    lines.push(`${label('searchContext')}: ${searchContextText}`)
  }

  if (pendingLead.preferredTime) {
    lines.push(`${label('preferredTime')}: ${pendingLead.preferredTime}`)
  }

  lines.push('', tMessage(['leadFlow', 'confirmationOutro'], language))

  return lines.join('\n')
}

export const renderPropertyDisambiguationQuestion = (candidateCount, language = DEFAULT_MESSAGE_LANGUAGE) => {
  const labels = Array.from({ length: candidateCount }, (_, index) => leadOrdinalWord(index, language) || `#${index + 1}`)
  return format(tMessage(['leadFlow', 'disambiguationTemplate'], language), { list: joinList(labels, language, 'or') })
}
