// backend/utils/chatLanguage.js
//
// Phase 1 of chatbot multilingual support: language plumbing only. This
// module does not translate anything — it only validates and normalizes the
// `language` field the frontend sends with every chat request, so the value
// is safe to pass through the rest of the request flow in later phases.

export const SUPPORTED_CHAT_LANGUAGES = ['en', 'tr', 'ar']

export const DEFAULT_CHAT_LANGUAGE = 'en'

// Any non-string, unrecognized, or missing value safely falls back to the
// default rather than being trusted or rejected — the chatbot must never
// error out over a language field, only ignore bad input. Trimmed and
// lowercased first so ' TR ' / 'AR' from a misbehaving client still resolve
// to the correct supported value instead of falling back needlessly.
export const normalizeChatLanguage = (value) => {
  if (typeof value !== 'string') return DEFAULT_CHAT_LANGUAGE

  const normalized = value.trim().toLowerCase()

  return SUPPORTED_CHAT_LANGUAGES.includes(normalized) ? normalized : DEFAULT_CHAT_LANGUAGE
}
