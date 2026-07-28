// backend/scripts/seedChatbotTestProperties.js
//
// Development-only helper to create/remove a batch of fake properties for
// manually testing the chatbot (backend/routes/chat.js) without depending on
// the small set of real listings currently in the database.
//
// Every test property's title is prefixed with TEST_TITLE_PREFIX below, and
// "clean" mode ONLY deletes properties whose title starts with that exact
// prefix — real properties are never touched.
//
// Usage:
//   node scripts/seedChatbotTestProperties.js seed   -> inserts ~30 test properties
//   node scripts/seedChatbotTestProperties.js clean  -> removes only those test properties

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../config/db.js'
import Property from '../models/Property.js'

dotenv.config()

export const TEST_TITLE_PREFIX = '[CHATBOT TEST]'

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const withPrefix = (title) => `${TEST_TITLE_PREFIX} ${title}`

const DEFAULTS = {
  status: 'Available',
  featured: false,
  agentName: 'Chatbot Test Agent',
  agentPhone: '+90 500 000 00 00',
  agentEmail: 'chatbot-test@varlikent.local',
  whatsappNumber: '+905000000000',
}

// Raw test data. Deliberately covers: both listing types, both main property
// types (Apartment/Villa), all 7 requested districts, a spread of
// beds/baths/sqm/price, mixed booleans for every feature flag, and
// descriptions written to realistically exercise the chatbot's MongoDB
// $text lifestyle search (schools, family, sea view, peaceful, investment,
// transport, parks/amenities, luxury, affordable).
const rawTestProperties = [
  {
    title: withPrefix('Beylikdüzü Family Apartment Near Schools'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 4200000,
    priceLabel: '₺4,200,000',
    district: 'Beylikdüzü',
    address: '12 Test Street, Beylikdüzü, Istanbul',
    beds: 3,
    baths: 2,
    sqm: 135,
    parking: '1 covered parking spot',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A bright 3-bedroom apartment in a family-friendly Beylikdüzü neighborhood, walking distance to primary schools and a local park. Quiet residential street, ideal for families with children.',
  },
  {
    title: withPrefix('Beylikdüzü Affordable Rental Near Metro'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 18000,
    priceLabel: '₺18,000/month',
    district: 'Beylikdüzü',
    address: '4 Test Street, Beylikdüzü, Istanbul',
    beds: 1,
    baths: 1,
    sqm: 55,
    parking: '',
    furnished: true,
    balcony: true,
    elevator: false,
    pool: false,
    garden: false,
    description:
      'Affordable rent for a cozy furnished 1-bedroom apartment, just a short walk from the Beylikdüzü metrobus stop. Great for young professionals commuting into the city.',
  },
  {
    title: withPrefix('Beylikdüzü Luxury Villa With Sea View'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 25000000,
    priceLabel: '₺25,000,000',
    district: 'Beylikdüzü',
    address: '7 Test Street, Beylikdüzü, Istanbul',
    beds: 5,
    baths: 4,
    sqm: 410,
    parking: '3-car private garage',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: true,
    garden: true,
    description:
      'A luxury villa with a private pool, landscaped garden, and an open sea view terrace. Located in a gated community close to the coastal promenade.',
  },
  {
    title: withPrefix('Beylikdüzü Peaceful Villa For Rent'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 45000,
    priceLabel: '₺45,000/month',
    district: 'Beylikdüzü',
    address: '9 Test Street, Beylikdüzü, Istanbul',
    beds: 4,
    baths: 3,
    sqm: 280,
    parking: '2 open spots',
    furnished: true,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A peaceful villa on a quiet cul-de-sac with a private garden, ideal for a family looking for space away from city noise while staying close to daily amenities.',
  },
  {
    title: withPrefix('Büyükçekmece Apartment Investment Opportunity'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 3100000,
    priceLabel: '₺3,100,000',
    district: 'Büyükçekmece',
    address: '2 Test Street, Büyükçekmece, Istanbul',
    beds: 2,
    baths: 1,
    sqm: 95,
    parking: '1 basement spot',
    furnished: false,
    balcony: false,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A well-priced 2-bedroom apartment near the Büyükçekmece metrobus line, considered a strong investment opportunity given rising rental demand in the area.',
  },
  {
    title: withPrefix('Büyükçekmece Apartment Near Parks'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 15000,
    priceLabel: '₺15,000/month',
    district: 'Büyükçekmece',
    address: '15 Test Street, Büyükçekmece, Istanbul',
    beds: 2,
    baths: 1,
    sqm: 90,
    parking: '',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A comfortable rental close to parks and daily amenities including groceries, cafes, and a weekend market, perfect for a small family or couple.',
  },
  {
    title: withPrefix('Büyükçekmece Luxury Villa Sea View'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 38000000,
    priceLabel: '$1,150,000',
    district: 'Büyükçekmece',
    address: '21 Test Street, Büyükçekmece, Istanbul',
    beds: 6,
    baths: 5,
    sqm: 520,
    parking: '4-car garage',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: true,
    garden: true,
    description:
      'An expansive luxury villa overlooking the sea, with a heated pool, mature garden, and a private cinema room. One of the standout listings in Büyükçekmece.',
  },
  {
    title: withPrefix('Büyükçekmece Family Villa For Rent'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 60000,
    priceLabel: '₺60,000/month',
    district: 'Büyükçekmece',
    address: '18 Test Street, Büyükçekmece, Istanbul',
    beds: 4,
    baths: 3,
    sqm: 300,
    parking: '2 covered spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A spacious family-friendly villa with a large private garden, close to international schools and family-oriented community facilities.',
  },
  {
    title: withPrefix('Esenyurt Affordable Apartment Near Schools'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 2400000,
    priceLabel: '₺2,400,000',
    district: 'Esenyurt',
    address: '3 Test Street, Esenyurt, Istanbul',
    beds: 2,
    baths: 1,
    sqm: 85,
    parking: '',
    furnished: false,
    balcony: false,
    elevator: false,
    pool: false,
    garden: false,
    description:
      'An affordable entry-level apartment close to several primary and secondary schools, suitable for first-time buyers or growing families.',
  },
  {
    title: withPrefix('Esenyurt Apartment Close To Transport'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 12000,
    priceLabel: '₺12,000/month',
    district: 'Esenyurt',
    address: '11 Test Street, Esenyurt, Istanbul',
    beds: 1,
    baths: 1,
    sqm: 60,
    parking: '',
    furnished: true,
    balcony: false,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A furnished 1-bedroom rental within walking distance of the Esenyurt metrobus and minibus routes, ideal for commuters and students.',
  },
  {
    title: withPrefix('Esenyurt Villa Investment Opportunity'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 14500000,
    priceLabel: '₺14,500,000',
    district: 'Esenyurt',
    address: '25 Test Street, Esenyurt, Istanbul',
    beds: 4,
    baths: 3,
    sqm: 260,
    parking: '2 open spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A well-located villa with a private garden in a fast-developing part of Esenyurt, seen by many buyers as a solid investment opportunity due to nearby infrastructure projects.',
  },
  {
    title: withPrefix('Esenyurt Peaceful Villa With Pool'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 55000,
    priceLabel: '₺55,000/month',
    district: 'Esenyurt',
    address: '30 Test Street, Esenyurt, Istanbul',
    beds: 5,
    baths: 4,
    sqm: 340,
    parking: '3 covered spots',
    furnished: true,
    balcony: true,
    elevator: false,
    pool: true,
    garden: true,
    description:
      'A peaceful furnished villa with a private pool and garden, set back from the main road for a quiet, family-friendly living experience.',
  },
  {
    title: withPrefix('Yeşilpınar Family Apartment Near Parks'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 3600000,
    priceLabel: '₺3,600,000',
    district: 'Yeşilpınar',
    address: '5 Test Street, Yeşilpınar, Istanbul',
    beds: 3,
    baths: 2,
    sqm: 120,
    parking: '1 covered spot',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A family-friendly 3-bedroom apartment steps away from a large community park, playgrounds, and daily amenities like bakeries and pharmacies.',
  },
  {
    title: withPrefix('Yeşilpınar Affordable Rent'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 10000,
    priceLabel: '₺10,000/month',
    district: 'Yeşilpınar',
    address: '8 Test Street, Yeşilpınar, Istanbul',
    beds: 1,
    baths: 1,
    sqm: 50,
    parking: '',
    furnished: false,
    balcony: false,
    elevator: false,
    pool: false,
    garden: false,
    description:
      'A simple, affordable rental option for a single tenant or student, located in a quiet residential pocket of Yeşilpınar.',
  },
  {
    title: withPrefix('Yeşilpınar Peaceful Villa With Garden'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 16800000,
    priceLabel: '₺16,800,000',
    district: 'Yeşilpınar',
    address: '14 Test Street, Yeşilpınar, Istanbul',
    beds: 4,
    baths: 3,
    sqm: 290,
    parking: '2 open spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A peaceful villa set in a low-density area with a generous private garden, popular with families wanting distance from the city center.',
  },
  {
    title: withPrefix('Yeşilpınar Luxury Villa For Rent'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 70000,
    priceLabel: '₺70,000/month',
    district: 'Yeşilpınar',
    address: '19 Test Street, Yeşilpınar, Istanbul',
    beds: 5,
    baths: 4,
    sqm: 360,
    parking: '3-car garage',
    furnished: true,
    balcony: true,
    elevator: false,
    pool: true,
    garden: true,
    description:
      'A luxury villa available for rent with a private pool, landscaped garden, and premium interior finishes throughout.',
  },
  {
    title: withPrefix('Kadıköy Apartment With Sea View'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 6500000,
    priceLabel: '€185,000',
    district: 'Kadıköy',
    address: '6 Test Street, Kadıköy, Istanbul',
    beds: 2,
    baths: 1,
    sqm: 100,
    parking: '1 basement spot',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A stylish 2-bedroom apartment with a partial sea view, close to the Kadıköy ferry terminal and metro, ideal for professionals who value transport access.',
  },
  {
    title: withPrefix('Kadıköy Family Apartment Near Schools'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 28000,
    priceLabel: '₺28,000/month',
    district: 'Kadıköy',
    address: '13 Test Street, Kadıköy, Istanbul',
    beds: 3,
    baths: 2,
    sqm: 130,
    parking: '',
    furnished: true,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A furnished family apartment in a friendly Kadıköy neighborhood, close to well-regarded schools and a lively weekend market.',
  },
  {
    title: withPrefix('Kadıköy Villa Investment Opportunity With Sea View'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 42000000,
    priceLabel: '₺42,000,000',
    district: 'Kadıköy',
    address: '22 Test Street, Kadıköy, Istanbul',
    beds: 5,
    baths: 4,
    sqm: 400,
    parking: '3 covered spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: true,
    garden: false,
    description:
      'A rare villa with a sea view and private pool in Kadıköy, considered an excellent investment opportunity given limited villa supply on the Asian side.',
  },
  {
    title: withPrefix('Kadıköy Peaceful Villa For Rent'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 65000,
    priceLabel: '₺65,000/month',
    district: 'Kadıköy',
    address: '27 Test Street, Kadıköy, Istanbul',
    beds: 4,
    baths: 3,
    sqm: 310,
    parking: '2 open spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A peaceful villa with a private garden, tucked away from busy streets yet close to daily amenities and public transport.',
  },
  {
    title: withPrefix('Beşiktaş Luxury Apartment With Sea View'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 9800000,
    priceLabel: '$295,000',
    district: 'Beşiktaş',
    address: '1 Test Street, Beşiktaş, Istanbul',
    beds: 3,
    baths: 2,
    sqm: 140,
    parking: '1 covered spot',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A luxury apartment with a striking Bosphorus sea view, close to Beşiktaş shopping streets, restaurants, and metro connections.',
  },
  {
    title: withPrefix('Beşiktaş Apartment Close To Metro'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 32000,
    priceLabel: '₺32,000/month',
    district: 'Beşiktaş',
    address: '10 Test Street, Beşiktaş, Istanbul',
    beds: 2,
    baths: 1,
    sqm: 95,
    parking: '',
    furnished: true,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A furnished rental steps from the Beşiktaş metro and ferry terminal, surrounded by parks and daily amenities.',
  },
  {
    title: withPrefix('Beşiktaş Luxury Villa Sea View'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 55000000,
    priceLabel: '₺55,000,000',
    district: 'Beşiktaş',
    address: '16 Test Street, Beşiktaş, Istanbul',
    beds: 6,
    baths: 5,
    sqm: 480,
    parking: '4-car garage',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: true,
    garden: true,
    description:
      'An exceptional luxury villa with panoramic sea views, a private pool, and a landscaped garden, located in one of the most prestigious pockets of Beşiktaş.',
  },
  {
    title: withPrefix('Beşiktaş Villa Investment Opportunity For Rent'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 80000,
    priceLabel: '₺80,000/month',
    district: 'Beşiktaş',
    address: '23 Test Street, Beşiktaş, Istanbul',
    beds: 4,
    baths: 3,
    sqm: 320,
    parking: '2 covered spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A villa with strong rental demand in Beşiktaş, seen as a solid investment opportunity for landlords targeting corporate tenants.',
  },
  {
    title: withPrefix('Sarıyer Peaceful Apartment Near Schools'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 7200000,
    priceLabel: '₺7,200,000',
    district: 'Sarıyer',
    address: '17 Test Street, Sarıyer, Istanbul',
    beds: 3,
    baths: 2,
    sqm: 125,
    parking: '1 covered spot',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A peaceful apartment surrounded by greenery, close to well-regarded schools and family-friendly parks in Sarıyer.',
  },
  {
    title: withPrefix('Sarıyer Apartment With Sea View'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 25000,
    priceLabel: '₺25,000/month',
    district: 'Sarıyer',
    address: '20 Test Street, Sarıyer, Istanbul',
    beds: 2,
    baths: 1,
    sqm: 100,
    parking: '',
    furnished: true,
    balcony: true,
    elevator: false,
    pool: false,
    garden: false,
    description:
      'A furnished rental with a partial sea view over the Bosphorus, close to daily amenities and public transport into the city center.',
  },
  {
    title: withPrefix('Sarıyer Luxury Villa With Pool And Sea View'),
    listingType: 'Sale',
    propertyType: 'Villa',
    price: 60000000,
    priceLabel: '₺60,000,000',
    district: 'Sarıyer',
    address: '24 Test Street, Sarıyer, Istanbul',
    beds: 6,
    baths: 5,
    sqm: 500,
    parking: '4-car garage',
    furnished: false,
    balcony: true,
    elevator: true,
    pool: true,
    garden: true,
    description:
      'A luxury villa with an infinity pool and sweeping sea views, set within a private garden in one of the most sought-after neighborhoods of Sarıyer.',
  },
  {
    title: withPrefix('Sarıyer Family Villa Peaceful Area'),
    listingType: 'Rent',
    propertyType: 'Villa',
    price: 90000,
    priceLabel: '₺90,000/month',
    district: 'Sarıyer',
    address: '29 Test Street, Sarıyer, Istanbul',
    beds: 5,
    baths: 4,
    sqm: 380,
    parking: '3 covered spots',
    furnished: false,
    balcony: true,
    elevator: false,
    pool: false,
    garden: true,
    description:
      'A family-friendly villa in a peaceful area of Sarıyer, with a large garden and close proximity to international schools.',
  },
  {
    title: withPrefix('Beylikdüzü Budget Studio Apartment'),
    listingType: 'Sale',
    propertyType: 'Apartment',
    price: 2100000,
    priceLabel: '₺2,100,000',
    district: 'Beylikdüzü',
    address: '31 Test Street, Beylikdüzü, Istanbul',
    beds: 1,
    baths: 1,
    sqm: 48,
    parking: '',
    furnished: false,
    balcony: false,
    elevator: false,
    pool: false,
    garden: false,
    description:
      'A compact, affordable studio apartment suitable for a single buyer or as a rental investment, close to local shops and public transport.',
  },
  {
    title: withPrefix('Esenyurt Rental Investment Opportunity'),
    listingType: 'Rent',
    propertyType: 'Apartment',
    price: 9500,
    priceLabel: '₺9,500/month',
    district: 'Esenyurt',
    address: '32 Test Street, Esenyurt, Istanbul',
    beds: 1,
    baths: 1,
    sqm: 52,
    parking: '',
    furnished: false,
    balcony: false,
    elevator: true,
    pool: false,
    garden: false,
    description:
      'A low-cost rental unit with steady tenant demand, often highlighted as an investment opportunity for landlords entering the Esenyurt market.',
  },
]

const testProperties = rawTestProperties.map((property) => ({ ...DEFAULTS, ...property }))

const seed = async () => {
  await connectDB()

  const inserted = await Property.insertMany(testProperties)
  console.log(`✓ Inserted ${inserted.length} chatbot test properties (prefixed "${TEST_TITLE_PREFIX}").`)

  await mongoose.disconnect()
  process.exit(0)
}

const clean = async () => {
  await connectDB()

  const filter = { title: { $regex: `^${escapeRegExp(TEST_TITLE_PREFIX)}` } }
  const toDelete = await Property.countDocuments(filter)
  const result = await Property.deleteMany(filter)

  console.log(`✓ Found ${toDelete} chatbot test properties, removed ${result.deletedCount}.`)

  await mongoose.disconnect()
  process.exit(0)
}

const mode = process.argv[2]

if (mode === 'seed') {
  seed().catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else if (mode === 'clean') {
  clean().catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  console.error('Usage: node scripts/seedChatbotTestProperties.js <seed|clean>')
  process.exit(1)
}
