import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildPropertyJsonLd } from '../src/lib/propertyJsonLd.js'
import { JSONLD_ID, serializeJsonLd, setJsonLd } from '../src/lib/useSeo.js'

const fullProperty = {
  _id: 'property-123',
  title: 'Bosphorus Apartment',
  description: 'A public listing description.',
  listingType: 'Sale',
  propertyType: 'Apartment',
  status: 'Available',
  price: 1250000,
  currency: 'EUR',
  mainImage: 'https://cdn.example.com/main.jpg',
  images: [
    '',
    'https://cdn.example.com/main.jpg',
    'data:image/png;base64,private',
    'https://cdn.example.com/second.jpg',
  ],
  beds: 0,
  baths: 2,
  sqm: 145,
  address: 'Publicly displayed address',
  district: 'Besiktas',
  location: {
    lat: 41.123456789,
    lng: 29.987654321,
    isApproximate: true,
    approxRadiusKm: 5,
  },
  exactLocation: { latitude: 41.123456789, longitude: 29.987654321 },
  privateAddress: 'PRIVATE ADDRESS SENTINEL',
  adminLocation: { secret: 'ADMIN LOCATION SENTINEL' },
}

test('builds the donor Residence/Offer structure with CURRENT fields', () => {
  const result = buildPropertyJsonLd(fullProperty, fullProperty._id)

  assert.equal(result['@context'], 'https://schema.org')
  assert.equal(result['@type'], 'Apartment')
  assert.equal(result.url, 'https://www.varlikent.com/properties/property-123')
  assert.equal(result.name, fullProperty.title)
  assert.equal(result.description, fullProperty.description)
  assert.deepEqual(result.image, [
    'https://cdn.example.com/main.jpg',
    'https://cdn.example.com/second.jpg',
  ])
  assert.equal(result.numberOfRooms, 0)
  assert.equal(result.numberOfBathroomsTotal, 2)
  assert.deepEqual(result.floorSize, {
    '@type': 'QuantitativeValue',
    value: 145,
    unitCode: 'MTK',
  })
  assert.deepEqual(result.address, {
    '@type': 'PostalAddress',
    streetAddress: 'Publicly displayed address',
    addressLocality: 'Besiktas',
    addressRegion: 'Istanbul',
    addressCountry: 'TR',
  })
  assert.equal(result.offers.price, 1250000)
  assert.equal(result.offers.priceCurrency, 'EUR')
  assert.equal(result.offers.availability, 'https://schema.org/InStock')
  assert.equal(result.offers.businessFunction, 'http://purl.org/goodrelations/v1#Sell')
})

test('never serializes private or approximate coordinates and admin-only fields', () => {
  const serialized = JSON.stringify(buildPropertyJsonLd(fullProperty, fullProperty._id))

  for (const forbidden of [
    '41.123456789',
    '29.987654321',
    'exactLocation',
    'privateAddress',
    'PRIVATE ADDRESS SENTINEL',
    'adminLocation',
    'ADMIN LOCATION SENTINEL',
    'latitude',
    'longitude',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
  assert.equal(serialized.includes('GeoCoordinates'), false)
})

test('omits unsupported, empty, and non-finite fields', () => {
  for (const price of [undefined, null, '100', Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = buildPropertyJsonLd({
      _id: 'minimal',
      title: 'Minimal',
      listingType: 'Rent',
      price,
      currency: '',
      images: ['', 'relative.jpg'],
      district: '',
      address: '',
      description: '',
      beds: Number.NaN,
      baths: Number.POSITIVE_INFINITY,
      sqm: 0,
    }, 'minimal')

    assert.equal('offers' in result, false)
    assert.equal('image' in result, false)
    assert.equal('description' in result, false)
    assert.equal('address' in result, false)
    assert.equal('numberOfRooms' in result, false)
    assert.equal('numberOfBathroomsTotal' in result, false)
    assert.equal('floorSize' in result, false)
    assert.equal(JSON.stringify(result).includes('null'), false)
  }
})

test('preserves valid numeric zero values', () => {
  const result = buildPropertyJsonLd({
    _id: 'zero',
    title: 'Studio',
    listingType: 'Rent',
    price: 0,
    currency: 'TL',
    beds: 0,
    baths: 0,
  }, 'zero')

  assert.equal(result.numberOfRooms, 0)
  assert.equal(result.numberOfBathroomsTotal, 0)
  assert.equal(result.offers.price, 0)
  assert.equal(result.offers.priceCurrency, 'TRY')
  assert.equal(result.offers.businessFunction, 'http://purl.org/goodrelations/v1#LeaseOut')
})

test('requires a property id and rejects stale route/property identity', () => {
  assert.equal(buildPropertyJsonLd({ title: 'No id' }), null)
  assert.equal(buildPropertyJsonLd({ _id: 'a', title: 'A' }, 'b'), null)
  assert.equal(buildPropertyJsonLd(null, 'a'), null)
})

const fakeDocument = () => {
  const byId = new Map()
  const children = []
  return {
    head: {
      appendChild(element) {
        children.push(element)
        byId.set(element.id, element)
      },
    },
    createElement() {
      return {
        id: '',
        type: '',
        textContent: '',
        remove() {
          byId.delete(this.id)
          const index = children.indexOf(this)
          if (index !== -1) children.splice(index, 1)
        },
      }
    },
    getElementById(id) {
      return byId.get(id) || null
    },
    children,
  }
}

test('escapes hostile text and adds, updates, and removes one JSON-LD script', () => {
  const hostile = '</script><script>alert("x")</script>'
  const serialized = serializeJsonLd({ name: hostile })
  assert.equal(serialized.includes('</script>'), false)
  assert.equal(JSON.parse(serialized).name, hostile)

  const document = fakeDocument()
  setJsonLd({ name: 'A' }, document)
  const first = document.getElementById(JSONLD_ID)
  assert.equal(document.children.length, 1)
  assert.equal(first.type, 'application/ld+json')

  setJsonLd({ name: hostile }, document)
  assert.equal(document.children.length, 1)
  assert.equal(document.getElementById(JSONLD_ID), first)
  assert.equal(first.textContent.includes('</script>'), false)
  assert.equal(JSON.parse(first.textContent).name, hostile)

  setJsonLd(null, document)
  assert.equal(document.children.length, 0)
  assert.equal(document.getElementById(JSONLD_ID), null)
})

test('robots protects reviewed private routes without blocking public properties', async () => {
  const robots = await readFile(new URL('../public/robots.txt', import.meta.url), 'utf8')
  assert.match(robots, /^User-agent: \*$/m)
  assert.match(robots, /^Sitemap: https:\/\/www\.varlikent\.com\/sitemap\.xml$/m)

  for (const route of ['/admin', '/agent', '/login', '/register', '/settings', '/forgot-password', '/reset-password', '/favourites']) {
    assert.match(robots, new RegExp('^Disallow: ' + route.replace('/', '\\/') + '$', 'm'))
  }
  for (const route of ['/properties', '/architecture', '/construction', '/renovation', '/interior-design']) {
    assert.doesNotMatch(robots, new RegExp('^Disallow: ' + route.replace('/', '\\/') + '$', 'm'))
  }
  const directives = robots.match(/^Disallow: .+$/gm) || []
  assert.equal(new Set(directives).size, directives.length)
})

test('sitemap contains unique public www URLs and valid stable lastmod dates', async () => {
  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8')
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(match => match[1])

  assert.ok(locations.length > 0)
  assert.equal(new Set(locations).size, locations.length)
  assert.ok(locations.every(location => location.startsWith('https://www.varlikent.com/')))
  assert.equal(lastmods.length, locations.length)
  assert.ok(lastmods.every(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))
  assert.ok(lastmods.every(value => value <= '2026-08-26'))
  assert.doesNotMatch(sitemap, /localhost|onrender\.com|vercel\.app/i)
  assert.doesNotMatch(sitemap, /\/(admin|agent|settings|messages|login|register|forgot-password|reset-password|favourites)(?:<|\/)/i)
})

