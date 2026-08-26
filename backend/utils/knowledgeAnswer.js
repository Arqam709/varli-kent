// backend/utils/knowledgeAnswer.js
//
// Answers the `knowledge_question` intent: general Istanbul real-estate
// questions (buying as a foreigner, taxes, citizenship, what a district is
// like) as opposed to a property-listing search. Wired into
// services/chatReplyBuilder.js's buildNonPropertyReply.
//
// Topic matching is two-stage, deterministic first:
//
//   1. matchKnowledgeTopicByKeyword — flat mixed-language term arrays per
//      legal topic (the same shape locales/chatParsingVocabulary.js already
//      uses for FEATURE_TERMS), plus chatMessageParsing.js's existing
//      detectMentionedDistricts for the 15 district topics. Synchronous, no
//      network, no model — the primary, debuggable path. "How much is
//      property tax in Turkey" never costs an API call.
//
//   2. matchKnowledgeTopicSemantic — reached ONLY when stage 1 finds nothing.
//      Embeds the visitor's message with utils/embeddings.js and cosine-ranks
//      it against one canonical question per topic. Fail-soft: no API key or
//      a failed request contributes nothing and the caller falls through to
//      the "no verified answer" reply.
//
// ── Why the answer text is returned verbatim ───────────────────────────────
//
// The donor implementation matched a topic and then asked Gemini to rephrase
// the curated text conversationally, constrained to those facts. That is not
// carried over, for two reasons specific to this content:
//
//   * These answers state tax percentages, citizenship thresholds and legal
//     procedure. A paraphrasing step is one more place a figure can drift,
//     and the failure is silent — "0.1%–0.2%" reading back as "around 0.2%"
//     looks perfectly fluent. Every other kind of chatbot reply in this
//     codebase is already assembled deterministically from
//     locales/chatMessages.js; grounding facts in a curated file and then
//     handing them to a model to restate would be the one exception, in the
//     one place where being wrong costs the reader money.
//
//   * The donor prompt instructs the model to answer in the requested
//     language, which for any language outside the curated set means a live
//     machine translation of legal thresholds. CURRENT's chat pipeline is
//     en/tr/ar (utils/chatLanguage.js), exactly matching the curated set, so
//     nothing needs translating at request time.
//
// The curated text is written as prose and reads as an answer on its own.
// Gemini still decides WHICH topic a question is about — that is the
// geminiPropertyParser intent, and the semantic fallback below — it just does
// not get to restate the facts.

import { getEmbedding, cosineSimilarity } from './embeddings.js'
import { normalizeForMatching } from '../locales/chatParsingVocabulary.js'
import { detectMentionedDistricts } from '../services/chatMessageParsing.js'
import {
  getKnowledgeTopic,
  isLegalTaxCitizenshipTopic,
  STANDARD_DISCLAIMER,
  KNOWLEDGE_VERIFIED_NOTE,
} from './istanbulKnowledgeBase.js'
import { renderKnowledgeFallback } from '../services/chatReplyRenderer.js'

// ─── Stage 1a: legal / tax / citizenship keywords ──────────────────────────
// Mixed-language term arrays, carried over from the donor. Deliberately
// specific multi-word phrases where two topics could otherwise collide
// ("property tax" vs "title deed tax") rather than one ambiguous word.
const LEGAL_TOPIC_KEYWORDS = {
  buying_process: [
    'buying process', 'buy process', 'purchase process', 'how to buy', 'how do i buy',
    'how can i buy', 'steps to buy', 'process of buying', 'buying procedure', 'purchase procedure',
    'satın alma süreci', 'satin alma sureci', 'satın alma işlemi', 'satin alma islemi',
    'satın alma adımları', 'satin alma adimlari', 'nasıl satın alırım', 'nasil satin alirim',
    'alım süreci', 'alim sureci',
    'عملية الشراء', 'خطوات الشراء', 'إجراءات الشراء', 'اجراءات الشراء', 'كيف اشتري', 'كيف أشتري',
  ],
  required_documents: [
    'documents', 'document', 'paperwork', 'papers needed', 'what documents', 'required documents',
    'documents needed', 'documents required',
    'belge', 'belgeler', 'evrak', 'gerekli belgeler', 'hangi belgeler',
    'مستندات', 'وثائق', 'أوراق', 'الأوراق المطلوبة', 'المستندات المطلوبة', 'اي مستندات', 'أي مستندات',
  ],
  property_taxes: [
    'property tax', 'annual tax', 'yearly tax', 'real estate tax', 'how much is tax on property',
    'property taxes',
    'emlak vergisi', 'yıllık vergi', 'yillik vergi', 'gayrimenkul vergisi',
    'ضريبة العقار', 'ضريبة الأملاك', 'ضريبة الاملاك', 'الضريبة السنوية', 'ضريبة سنوية', 'ضريبة عقارية',
  ],
  transfer_tax: [
    'title deed tax', 'transfer tax', 'title transfer tax', 'tapu harcı', 'tapu harci', 'tapu fee',
    'tapu tax', 'deed tax', 'stamp duty',
    'رسم الطابو', 'رسوم الطابو', 'ضريبة نقل الملكية', 'رسم نقل الملكية', 'ضريبة الطابو',
  ],
  vat_exemption: [
    'vat exemption', 'vat exempt', 'value added tax', 'kdv istisnası', 'kdv istisnasi', 'kdv',
    'الإعفاء من ضريبة القيمة المضافة', 'الاعفاء من ضريبة القيمة المضافة', 'ضريبة القيمة المضافة',
    'إعفاء ضريبي', 'اعفاء ضريبي', 'إعفاء من الضريبة', 'اعفاء من الضريبة',
  ],
  citizenship_investment: [
    'citizenship', 'citizenship by investment', 'golden visa', 'get citizenship', 'turkish citizenship',
    'passport by investment', 'citizenship investment',
    'vatandaşlık', 'vatandaslik', 'yatırımla vatandaşlık', 'yatirimla vatandaslik', 'türk vatandaşlığı', 'turk vatandasligi',
    'الجنسية', 'الجنسية التركية', 'الجنسية عن طريق الاستثمار', 'جنسية بالاستثمار', 'الحصول على الجنسية',
  ],
}

/*
 * Keyed by every spelling detectMentionedDistricts can return — both the
 * diacritic and ASCII forms listed in chatMessageParsing.js's KNOWN_DISTRICTS,
 * since that function returns whichever literal spelling matched (Arabic
 * aliases already resolve to the diacritic form before they get here).
 */
const DISTRICT_TOPIC_ID = {
  Esenyurt: 'district_esenyurt',
  'Büyükçekmece': 'district_buyukcekmece',
  Buyukcekmece: 'district_buyukcekmece',
  'Beylikdüzü': 'district_beylikduzu',
  Beylikduzu: 'district_beylikduzu',
  'Başakşehir': 'district_basaksehir',
  Basaksehir: 'district_basaksehir',
  'Kadıköy': 'district_kadikoy',
  Kadikoy: 'district_kadikoy',
  'Beşiktaş': 'district_besiktas',
  Besiktas: 'district_besiktas',
  'Şişli': 'district_sisli',
  Sisli: 'district_sisli',
  'Üsküdar': 'district_uskudar',
  Uskudar: 'district_uskudar',
  'Sarıyer': 'district_sariyer',
  Sariyer: 'district_sariyer',
  'Bakırköy': 'district_bakirkoy',
  Bakirkoy: 'district_bakirkoy',
  'Kağıthane': 'district_kagithane',
  Kagithane: 'district_kagithane',
  Fatih: 'district_fatih',
  Zeytinburnu: 'district_zeytinburnu',
  'Avcılar': 'district_avcilar',
  Avcilar: 'district_avcilar',
  'Bahçelievler': 'district_bahcelievler',
  Bahcelievler: 'district_bahcelievler',
}

/*
 * Word-level tokenizer for single-word terms, so the English word "vat" does
 * not match inside "private". Multi-word terms still use a substring test on
 * the normalized text — a phrase is specific enough for that to be safe.
 */
/* ─── Stage 1b: service-offering keywords (Wave 11C) ──────────────────────
 *
 * Transplanted from the donor, same flat mixed-language shape as the legal
 * keywords above. These are merged into ONE scored pass with the legal terms
 * (see KEYWORD_TOPICS) rather than checked in a separate stage, so a service
 * question never has to fight a legal keyword for priority — the highest
 * keyword score wins, exactly as it already does between legal topics.
 *
 * The donor's fifth topic, service_overview, and its keywords ('what
 * services do you offer', 'what can you help me with', ...) are deliberately
 * NOT here. Those phrases are the VAGUE question, which CURRENT already
 * answers through website_service_question with a reply that lists all five
 * areas and asks which one to expand on. Importing them would have let this
 * feature quietly take that intent over — the exact outcome Wave 11A
 * avoided, and still worth avoiding.
 */
const SERVICE_TOPIC_KEYWORDS = {
  service_architecture: [
    'architecture', 'architecture service', 'architectural', 'architect', 'building design',
    'concept and design', 'structural engineering', 'urban planning',
    // Deliberately no bare 'mimari'/'mimarlık' single-word terms here — both
    // words also appear inside "iç mimari"/"iç mimarlık" (Turkish for
    // interior design), so a bare-word match would tie against
    // service_interior_design's phrase match. Multi-word phrases only.
    'mimarlık hizmeti', 'mimari tasarım', 'mimari proje', 'yapı tasarımı', 'kentsel planlama',
    'bina tasarımı',
    'عمارة', 'العمارة', 'الهندسة المعمارية', 'خدمة العمارة', 'التصميم المعماري', 'مهندس معماري',
  ],
  service_construction: [
    'construction', 'construction service', 'construction management', 'general contracting',
    'general contractor', 'structural works', 'mep engineering', 'build my building', 'building construction',
    'inşaat', 'inşaat hizmeti', 'inşaat yönetimi', 'yüklenicilik', 'genel yüklenicilik', 'yapısal işler',
    'بناء', 'الإنشاء', 'خدمة الإنشاء', 'إدارة البناء', 'المقاولات', 'مقاولات عامة', 'أعمال إنشائية',
  ],
  service_renovation: [
    'renovation', 'renovation service', 'renovate', 'remodel', 'remodeling', 'refurbishment',
    'renovation process', 'kitchen renovation', 'bathroom renovation',
    'tadilat', 'renovasyon', 'tadilat hizmeti', 'yenileme', 'mutfak tadilatı', 'banyo tadilatı',
    'تجديد', 'التجديد', 'خدمة التجديد', 'ترميم', 'تجديد المطبخ', 'تجديد الحمام',
  ],
  service_interior_design: [
    'interior design', 'interior designer', 'interior design service', 'interior decorating',
    'design my interior', 'furniture sourcing', 'mood board', 'design my home interior',
    'iç mimari', 'iç tasarım', 'iç mimarlık', 'iç mekan tasarımı', 'mobilya tedariki',
    'تصميم داخلي', 'التصميم الداخلي', 'مصمم داخلي', 'ديكور داخلي', 'تصميم المنزل من الداخل',
  ],
}

// One merged map, one scored pass.
const KEYWORD_TOPICS = { ...LEGAL_TOPIC_KEYWORDS, ...SERVICE_TOPIC_KEYWORDS }

/*
 * Turkish interior-design disambiguation.
 *
 * The donor's guard for this was incomplete. Its comment explains that
 * service_architecture carries no BARE 'mimari'/'mimarlık' term, because
 * those words also sit inside "iç mimari"/"iç mimarlık" (interior design) —
 * but the multi-word terms it kept have the same problem: "iç mimarlık
 * hizmeti" contains BOTH 'iç mimarlık' (interior) and 'mimarlık hizmeti'
 * (architecture). Both score 1, the tie is broken by object key order, and
 * "what does your interior design service include?" in Turkish answers
 * about architecture instead.
 *
 * No amount of phrase-list tuning fixes that cleanly, because the
 * architecture phrase is a genuine substring of the interior one. The real
 * rule is linguistic: in Turkish the leading "iç" ("interior") is what
 * disambiguates, so when an explicit interior marker is present, the
 * architecture topic cannot claim the message.
 */
const INTERIOR_MARKERS = ['iç mimari', 'iç mimarlık', 'iç tasarım', 'iç mekan', 'interior']

const hasInteriorMarker = (normalizedText) =>
  INTERIOR_MARKERS.some((marker) => normalizedText.includes(normalizeForMatching(marker)))

const tokenize = (normalizedText = '') =>
  normalizedText.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// Scores every keyword topic — legal/tax/citizenship AND service-offering —
// in a single pass and returns the highest scorer.
const matchKeywordTopic = (message = '') => {
  const normalized = normalizeForMatching(message)
  const tokens = new Set(tokenize(normalized))
  const interiorWins = hasInteriorMarker(normalized)

  let bestTopic = null
  let bestScore = 0

  for (const [topicId, terms] of Object.entries(KEYWORD_TOPICS)) {
    // See INTERIOR_MARKERS above: "iç mimarlık hizmeti" is an interior
    // design question whose text also contains an architecture phrase.
    if (topicId === 'service_architecture' && interiorWins) continue

    let score = 0

    for (const term of terms) {
      const normTerm = normalizeForMatching(term)
      const isPhrase = normTerm.includes(' ')
      const hit = isPhrase ? normalized.includes(normTerm) : tokens.has(normTerm)
      if (hit) score++
    }

    if (score > bestScore) {
      bestScore = score
      bestTopic = topicId
    }
  }

  return bestTopic
}

const matchDistrictTopic = (message = '') => {
  const districts = detectMentionedDistricts(message)
  if (districts.length === 0) return null
  return DISTRICT_TOPIC_ID[districts[0]] || null
}

/*
 * Deterministic, synchronous, no network — the primary path.
 *
 * Keyword topics are checked before districts on purpose: "what is the
 * property tax in Beşiktaş" mentions both, and the tax is the more specific
 * information need. The same ordering now also covers service topics, so
 * "does your renovation service work in Kadıköy" answers about renovation
 * rather than describing the neighbourhood.
 */
export const matchKnowledgeTopicByKeyword = (message = '') => {
  const keywordMatch = matchKeywordTopic(message)
  if (keywordMatch) return keywordMatch
  return matchDistrictTopic(message)
}

// ─── Stage 2 (optional, fail-soft): semantic fallback ──────────────────────
//
// One canonical English question per topic, used only to build an embedding to
// compare against — never shown to anyone. English is enough because the
// embedding model is multilingual and this only catches phrasings the keyword
// stage missed.
const CANONICAL_TOPIC_QUESTIONS = {
  buying_process: 'What is the process for buying property in Turkey as a foreigner?',
  required_documents: 'What documents do I need to buy property in Turkey?',
  property_taxes: 'How much is the annual property tax in Turkey?',
  transfer_tax: 'How much is the title deed transfer tax when buying property?',
  vat_exemption: 'Is there a VAT exemption for foreign property buyers in Turkey?',
  citizenship_investment: 'How does Turkish citizenship by real estate investment work?',
  district_esenyurt: 'What is Esenyurt like to live in?',
  district_buyukcekmece: 'What is Büyükçekmece like to live in?',
  district_beylikduzu: 'What is Beylikdüzü like to live in?',
  district_basaksehir: 'What is Başakşehir like to live in?',
  district_kadikoy: 'What is Kadıköy like to live in?',
  district_besiktas: 'Is Beşiktaş a good place to live?',
  district_sisli: 'What is Şişli like to live in?',
  district_uskudar: 'What is Üsküdar like to live in?',
  district_sariyer: 'What is Sarıyer like to live in?',
  district_bakirkoy: 'What is Bakırköy like to live in?',
  district_kagithane: 'What is Kağıthane like to live in?',
  district_fatih: 'What is Fatih like to live in?',
  district_zeytinburnu: 'What is Zeytinburnu like to live in?',
  district_avcilar: 'What is Avcılar like to live in?',
  district_bahcelievler: 'What is Bahçelievler like to live in?',
  // Wave 11C — transplanted from the donor. Adding them here is the whole
  // semantic wiring: buildTopicEmbeddings() indexes this object, so service
  // topics become eligible for the existing fallback with no second matcher,
  // no second embedding provider, and no new dependency. The fallback still
  // only SELECTS a topic; the answer text always comes from the curated
  // knowledge base (see assembleAnswer).
  service_architecture: 'What does your architecture service include?',
  service_construction: 'What is involved in your construction management service?',
  service_renovation: 'How does your renovation process work?',
  service_interior_design: 'Can you help design my interior?',
}

// Same order of magnitude as the property semantic search default, kept as a
// named constant rather than a magic number.
export const SEMANTIC_MATCH_THRESHOLD = 0.62

/*
 * Built once per process and held in memory — no database, no vector store.
 * Topics whose embedding request failed are simply omitted rather than
 * retried, so one bad response cannot wedge the cache.
 */
let topicEmbeddingsPromise = null

/** Test seam: forces the next semantic match to rebuild the topic cache. */
export const resetTopicEmbeddingCache = () => {
  topicEmbeddingsPromise = null
}

const buildTopicEmbeddings = async (embedFn) => {
  const entries = await Promise.all(
    Object.entries(CANONICAL_TOPIC_QUESTIONS).map(async ([topicId, question]) => {
      const embedding = await embedFn(question)
      return embedding ? { topicId, embedding } : null
    })
  )

  return entries.filter(Boolean)
}

/*
 * Fail-soft throughout: a missing API key, a failed request or a malformed
 * vector resolves to null and never throws, so the caller behaves exactly as
 * if no topic had matched. A knowledge lookup must not be able to take
 * POST /api/chat down.
 */
export const matchKnowledgeTopicSemantic = async (message = '', { embedFn = getEmbedding } = {}) => {
  try {
    const messageEmbedding = await embedFn(message)
    if (!messageEmbedding) return null

    if (!topicEmbeddingsPromise) {
      topicEmbeddingsPromise = buildTopicEmbeddings(embedFn)
    }

    const topicEmbeddings = await topicEmbeddingsPromise
    if (!topicEmbeddings || topicEmbeddings.length === 0) return null

    let best = null
    let bestScore = 0

    for (const { topicId, embedding } of topicEmbeddings) {
      const score = cosineSimilarity(messageEmbedding, embedding)
      if (score > bestScore) {
        bestScore = score
        best = topicId
      }
    }

    return bestScore >= SEMANTIC_MATCH_THRESHOLD ? best : null
  } catch (err) {
    console.log('Knowledge topic semantic match failed:', err.message)
    return null
  }
}

/** Keywords first; the semantic pass runs only on a deterministic miss. */
export const matchKnowledgeTopic = async (message = '', options = {}) => {
  const keywordMatch = matchKnowledgeTopicByKeyword(message)
  if (keywordMatch) return keywordMatch
  return matchKnowledgeTopicSemantic(message, options)
}

/*
 * Assembles the reply for a matched topic.
 *
 * Legal/tax/citizenship answers carry two extra lines: when the figures were
 * last checked, and the disclaimer. District answers get neither — a
 * description of what Kadıköy is like needs no legal hedge, and attaching one
 * to every lifestyle answer would train readers to skip it on the answers
 * where it matters.
 */
const assembleAnswer = (topicId, topic, language) => {
  const body = topic[language] || topic.en

  if (!isLegalTaxCitizenshipTopic(topicId)) return body

  const verified = KNOWLEDGE_VERIFIED_NOTE[language] || KNOWLEDGE_VERIFIED_NOTE.en
  const disclaimer = STANDARD_DISCLAIMER[language] || STANDARD_DISCLAIMER.en

  return `${body}\n\n${verified} ${disclaimer}`
}

/*
 * Public entry point. Never throws.
 *
 * No topic match — by keyword or semantically — returns the localized "no
 * verified information" reply rather than anything improvised. That is the
 * whole safety contract of this module: an unrecognised legal question
 * produces an admission, never a guess.
 */
export const buildKnowledgeAnswer = async ({
  message = '',
  language = 'en',
  matchFn = matchKnowledgeTopic,
} = {}) => {
  try {
    const topicId = await matchFn(message)
    if (!topicId) return renderKnowledgeFallback(language)

    const topic = getKnowledgeTopic(topicId)
    if (!topic) return renderKnowledgeFallback(language)

    return assembleAnswer(topicId, topic, language)
  } catch (err) {
    console.log('Knowledge answer failed:', err.message)
    return renderKnowledgeFallback(language)
  }
}
