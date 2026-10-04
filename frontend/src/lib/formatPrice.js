import { localeFor } from './locale.js'

export const formatPrice = (price, listingType, priceLabel = '', language = 'en') => {
  const label = priceLabel?.trim()

  if (price === undefined || price === null || price === '') return 'Price on request'

  const numericPrice = Number(price)
  if (!Number.isFinite(numericPrice)) return 'Price on request'

  const amount = numericPrice.toLocaleString(localeFor(language))
  const rentSuffix = listingType === 'Rent' ? '/mo' : ''

  if (label) {
    if (label === '$') {
      return `$${amount}${rentSuffix}`
    }

    if (label === '₺' || label.toUpperCase() === 'TL') {
      return `₺${amount}${rentSuffix}`
    }

    if (label === '£') {
      return '£' + amount + rentSuffix
    }

    if (label === '€') {
      return `€${amount}${rentSuffix}`
    }

    return label
  }

  return `$${amount}${rentSuffix}`
}
