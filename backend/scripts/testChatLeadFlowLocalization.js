// backend/scripts/testChatLeadFlowLocalization.js
//
// Phase 3 (backend deterministic reply localization) — focused, fully
// deterministic tests for utils/leadCapture.js's visitor-facing lead-flow
// text in en/tr/ar. No DB connection, no Gemini call, no network — every
// function tested here is pure.
//
// Also proves the internal/canonical boundary this phase deliberately
// preserves: buildInterestType() and buildLeadMessage() take no language
// parameter and their output never changes with language — see the file
// header in utils/leadCapture.js for why (persisted ContactSubmission
// field + internal staff notification, not visitor-facing).
//
// Usage: node scripts/testChatLeadFlowLocalization.js

import {
  getMissingLeadFields,
  buildMissingFieldsQuestion,
  buildConfirmationSummary,
  buildPropertyDisambiguationQuestion,
  buildInterestType,
  buildLeadMessage,
  isValidEmail,
  isValidPhone,
} from '../utils/leadCapture.js'

const line = () => console.log('='.repeat(78))
let passCount = 0
let failCount = 0

const assertEqual = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (pass) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
    console.log(`    expected: ${JSON.stringify(expected)}`)
    console.log(`    actual:   ${JSON.stringify(actual)}`)
  }
}

const assertTrue = (label, condition) => {
  if (condition) {
    passCount++
    console.log(`✓ ${label}`)
  } else {
    failCount++
    console.log(`✗ ${label}`)
  }
}

line()
console.log('getMissingLeadFields — canonical ids, not English phrases')
line()

assertEqual('all three missing -> canonical ids in order', getMissingLeadFields({}), ['name', 'phone', 'email'])
assertEqual('only phone/email missing', getMissingLeadFields({ name: 'Arqam' }), ['phone', 'email'])
assertEqual('nothing missing when all valid', getMissingLeadFields({ name: 'Arqam', phone: '+905551234567', email: 'a@b.com' }), [])
assertEqual('invalid phone still counts as missing', getMissingLeadFields({ name: 'Arqam', phone: '123', email: 'a@b.com' }), ['phone'])
assertEqual('invalid email still counts as missing', getMissingLeadFields({ name: 'Arqam', phone: '+905551234567', email: 'not-an-email' }), ['email'])

line()
console.log('buildMissingFieldsQuestion — en/tr/ar')
line()

assertEqual(
  'en: single missing field, no property title',
  buildMissingFieldsQuestion(['phone'], null, 'en'),
  'Great, I can have our team reach out to you. Could you also share your phone number?'
)
assertEqual(
  'en: single missing field, with property title',
  buildMissingFieldsQuestion(['email'], 'Sea View Villa', 'en'),
  'Sure, I can help arrange an appointment for this property. Could you also share your email?'
)
assertEqual(
  'en: multiple missing fields join naturally with the time invite',
  buildMissingFieldsQuestion(['name', 'phone'], null, 'en'),
  'Great, I can have our team reach out to you. Please send your name, phone number, and preferred appointment time in one message.'
)

assertTrue('tr: single missing field mentions telefon numarası', buildMissingFieldsQuestion(['phone'], null, 'tr').includes('telefon numarası'))
assertTrue('tr: with property title uses the property-specific intro', buildMissingFieldsQuestion(['email'], 'Deniz Manzaralı Villa', 'tr').includes('bu mülk için'))
assertTrue('ar: single missing field mentions رقم هاتفك', buildMissingFieldsQuestion(['phone'], null, 'ar').includes('رقم هاتفك'))
assertTrue('ar: with property title uses the property-specific intro', buildMissingFieldsQuestion(['email'], 'فيلا بإطلالة بحرية', 'ar').includes('لهذا العقار'))

assertEqual('null for zero missing fields (en)', buildMissingFieldsQuestion([], null, 'en'), null)
assertEqual('null for zero missing fields (tr)', buildMissingFieldsQuestion([], null, 'tr'), null)

line()
console.log('buildConfirmationSummary — en/tr/ar, labels localized, values untouched')
line()

const pendingLead = { name: 'Arqam Waqar', phone: '+905551234567', email: 'arqam@example.com', propertyTitle: null, preferredTime: null }
const parsedSale = { listingType: 'Sale', propertyType: 'Apartment', district: 'Beylikdüzü' }

const summaryEn = buildConfirmationSummary(pendingLead, parsedSale, 'en')
assertTrue('en summary contains the raw name value untouched', summaryEn.includes('Arqam Waqar'))
assertTrue('en summary contains the raw phone value untouched', summaryEn.includes('+905551234567'))
assertTrue('en summary labels "Interest:" and shows "Buying"', summaryEn.includes('Interest: Buying'))
assertTrue('en summary asks to send to the team', summaryEn.includes('Should I send this to our team?'))

const summaryTr = buildConfirmationSummary(pendingLead, parsedSale, 'tr')
assertTrue('tr summary contains the raw name value untouched (PII is never translated)', summaryTr.includes('Arqam Waqar'))
assertTrue('tr summary uses localized "İlgi Alanı" label', summaryTr.includes('İlgi Alanı'))
assertTrue('tr summary shows the LOCALIZED interest display ("Satın Alma"), not the raw canonical "Buying"', summaryTr.includes('Satın Alma') && !summaryTr.includes('Buying'))

const summaryAr = buildConfirmationSummary(pendingLead, parsedSale, 'ar')
assertTrue('ar summary contains the raw name value untouched', summaryAr.includes('Arqam Waqar'))
assertTrue('ar summary uses localized "الاهتمام" label', summaryAr.includes('الاهتمام'))
assertTrue('ar summary shows the LOCALIZED interest display ("الشراء"), not the raw canonical "Buying"', summaryAr.includes('الشراء') && !summaryAr.includes('Buying'))

line()
console.log('buildPropertyDisambiguationQuestion — en/tr/ar')
line()

const candidates = [{ _id: '1', title: 'A' }, { _id: '2', title: 'B' }]
assertEqual(
  'en: two candidates',
  buildPropertyDisambiguationQuestion(candidates, 'en'),
  'Which property would you like to schedule the appointment for — the first or second one?'
)
assertTrue('tr: two candidates mentions birinci and ikinci', (() => {
  const q = buildPropertyDisambiguationQuestion(candidates, 'tr')
  return q.includes('birinci') && q.includes('ikinci')
})())
assertTrue('ar: two candidates mentions الأول and الثاني', (() => {
  const q = buildPropertyDisambiguationQuestion(candidates, 'ar')
  return q.includes('الأول') && q.includes('الثاني')
})())

line()
console.log('language fallback to English')
line()

assertEqual(
  'buildMissingFieldsQuestion with unsupported language falls back to English content',
  buildMissingFieldsQuestion(['phone'], null, 'de'),
  buildMissingFieldsQuestion(['phone'], null, 'en')
)
assertEqual(
  'buildConfirmationSummary with unsupported language falls back to English content',
  buildConfirmationSummary(pendingLead, parsedSale, 'fr'),
  buildConfirmationSummary(pendingLead, parsedSale, 'en')
)

line()
console.log('buildInterestType() and buildLeadMessage() — internal/canonical, unaffected by language')
line()

assertEqual('buildInterestType: Sale -> "Buying" (canonical, no language param exists)', buildInterestType({ listingType: 'Sale' }), 'Buying')
assertEqual('buildInterestType: Rent -> "Renting"', buildInterestType({ listingType: 'Rent' }), 'Renting')
assertEqual('buildInterestType: neither -> "General"', buildInterestType({}), 'General')
assertEqual(
  'buildInterestType ignores any extra argument (no language parameter exists to accept one)',
  buildInterestType({ listingType: 'Sale' }, 'ar'),
  buildInterestType({ listingType: 'Sale' })
)

const leadMessage = buildLeadMessage({ pendingLead, parsed: parsedSale, message: 'I want to buy an apartment in Beylikdüzü' })
assertTrue('buildLeadMessage stays in English regardless of what language the chat happened in', leadMessage.includes('Submitted via VarliKent AI Chatbot.'))
assertTrue('buildLeadMessage includes the visitor\'s own words verbatim', leadMessage.includes('I want to buy an apartment in Beylikdüzü'))
assertTrue('buildLeadMessage has no language parameter (single destructured object arg)', buildLeadMessage.length === 1)

line()
console.log('isValidEmail / isValidPhone — unchanged, language-independent')
line()

assertEqual('isValidEmail: valid', isValidEmail('a@b.com'), true)
assertEqual('isValidEmail: invalid', isValidEmail('not-an-email'), false)
assertEqual('isValidPhone: valid', isValidPhone('+905551234567'), true)
assertEqual('isValidPhone: invalid (too short)', isValidPhone('123'), false)

line()
console.log('purity — no mutation of inputs')
line()

assertTrue('getMissingLeadFields does not mutate pendingLead', (() => {
  const lead = { name: 'Arqam' }
  const before = JSON.stringify(lead)
  getMissingLeadFields(lead)
  return JSON.stringify(lead) === before
})())

assertTrue('buildConfirmationSummary does not mutate pendingLead or parsed', (() => {
  const lead = { ...pendingLead }
  const parsed = { ...parsedSale }
  const beforeLead = JSON.stringify(lead)
  const beforeParsed = JSON.stringify(parsed)
  buildConfirmationSummary(lead, parsed, 'ar')
  return JSON.stringify(lead) === beforeLead && JSON.stringify(parsed) === beforeParsed
})())

assertTrue('buildPropertyDisambiguationQuestion does not mutate the candidates array', (() => {
  const before = JSON.stringify(candidates)
  buildPropertyDisambiguationQuestion(candidates, 'tr')
  return JSON.stringify(candidates) === before
})())

line()
console.log('SUMMARY')
line()
console.log(`${passCount} passed, ${failCount} failed`)

process.exit(failCount > 0 ? 1 : 0)
