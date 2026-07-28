// backend/utils/embeddings.js
//
// Gemini text embeddings + vector similarity — pure, single-purpose helpers.
// Not wired into the chatbot yet (Phase 1 only). Mirrors the same
// fail-soft pattern as geminiPropertyParser.js: missing API key or a failed
// request returns null instead of throwing, so callers can fall back.

import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'gemini-embedding-001'

export const getEmbedding = async (text = '') => {
  const trimmed = text.trim()
  if (!trimmed) return null

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.log('Gemini API key missing. Check backend .env file.')
    return null
  }

  try {
    const ai = new GoogleGenAI({ apiKey })

    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [trimmed],
    })

    return response?.embeddings?.[0]?.values || null
  } catch (err) {
    console.log('Embedding request failed:', err.message)
    return null
  }
}

// Cosine similarity between two equal-length vectors, in [-1, 1] (in
// practice [0, 1] for Gemini's embedding space). Returns 0 for invalid or
// mismatched input rather than throwing.
export const cosineSimilarity = (vecA = [], vecB = []) => {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
