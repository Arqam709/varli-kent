import translations from '../locales/translations.js'
import { localeFor } from './locale.js'

// The wording around a price, from the `price` section of the catalogue. Read
// here rather than passed in so every caller gets it from the one `language`
// argument it already supplies — the same arrangement as lib/enumLabels.js.
const priceText = (language, key) =>
  translations[language]?.price?.[key] ?? translations.en.price[key]

export const formatPrice = (price, listingType, priceLabel = '', language = 'en') => {
  const label = priceLabel?.trim()

  if (price === undefined || price === null || price === '') return priceText(language, 'onRequest')

  const numericPrice = Number(price)
  if (!Number.isFinite(numericPrice)) return priceText(language, 'onRequest')

  const amount = numericPrice.toLocaleString(localeFor(language))
  // `listingType` is the canonical backend value; only the wording is localized.
  // The suffix is a template because not every language puts it after a slash.
  const withPeriod = (text) =>
    listingType === 'Rent' ? priceText(language, 'perMonth').replace('{price}', () => text) : text

  if (label) {
    if (label === '$') {
      return withPeriod(`$${amount}`)
    }

    if (label === '₺' || label.toUpperCase() === 'TL') {
      return withPeriod(`₺${amount}`)
    }

    if (label === '£') {
      return withPeriod(`£${amount}`)
    }

    if (label === '€') {
      return withPeriod(`€${amount}`)
    }

    return label
  }

  return withPeriod(`$${amount}`)
}
