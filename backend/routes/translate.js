import express from 'express'

const router = express.Router()

const cache = new Map()
const cacheKey = (text, lang) => `${lang}::${text}`

// POST /api/translate
// body: { texts: string[], targetLang: 'tr' | 'ar' | 'en' }
router.post('/', async (req, res, next) => {
  try {
    const { texts, targetLang } = req.body
    if (!Array.isArray(texts) || !targetLang) {
      return res.json({ success: true, translations: texts || [] })
    }
    if (targetLang === 'en') {
      return res.json({ success: true, translations: texts })
    }

    const translations = await Promise.all(
      texts.map(async (text) => {
        if (!text?.trim()) return text || ''
        const key = cacheKey(text, targetLang)
        if (cache.has(key)) return cache.get(key)
        try {
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`
          const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
          const data = await r.json()
          const translated = data?.responseData?.translatedText || text
          cache.set(key, translated)
          return translated
        } catch {
          return text
        }
      })
    )

    res.json({ success: true, translations })
  } catch (err) {
    next(err)
  }
})

export default router
