export const formatPrice = (price, listingType, priceLabel = '') => {
  const label = priceLabel?.trim()

  if (!price) return 'Price on request'

  const amount = Number(price).toLocaleString('en-US')
  const rentSuffix = listingType === 'Rent' ? '/mo' : ''

  if (label) {
    if (label === '$') {
      return `$${amount}${rentSuffix}`
    }

    if (label === '₺' || label.toUpperCase() === 'TL') {
      return `₺${amount}${rentSuffix}`
    }

    if (label === '€') {
      return `€${amount}${rentSuffix}`
    }

    return label
  }

  return `$${amount}${rentSuffix}`
}
