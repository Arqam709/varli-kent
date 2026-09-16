import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import translations from '../src/locales/translations.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const admin = read('../src/pages/AdminProperties.jsx')
const page = read('../src/pages/PropertiesPage.jsx')
const map = read('../src/components/PropertyMapView.jsx')
const route = read('../../backend/routes/properties.js')
const language = read('../src/contexts/LanguageContext.jsx')
const model = read('../../backend/models/Property.js')
const multi = ['heating', 'parking', 'buildingAge', 'floorLocation', 'kitchenType', 'usageStatus', 'titleDeedStatus', 'nearbyTransport']

const body = (source, name) => {
  const start = source.indexOf(`const ${name} = `)
  assert.notEqual(start, -1, `${name} exists`)
  const open = source.indexOf('{', source.indexOf('=>', start))
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1)
  }
  throw Error('Unclosed function')
}
const details = new Function(admin.slice(admin.indexOf('const emptyForm'), admin.indexOf('const AdminProperties =')) + '; return {detailsFromProperty, buildDetailsPayload, locationStateFromApi, agentIdOf}')()

test('Batch 9: optional fields preserve unknown, false, zero, currency and untouched transport', () => {
  const stored = { floor: 0, totalFloors: 0, netSqm: 0, openAreaSqm: 0, coefficient: 0, sauna: false, hasVirtualTour: false, priceLabel: '€', nearbyTransport: ['Metro'], virtualTourUrl: 'https://kuula.co/test' }
  const state = details.detailsFromProperty(stored)
  const result = details.buildDetailsPayload(state, false)
  for (const key of ['floor', 'totalFloors', 'netSqm', 'openAreaSqm', 'coefficient']) assert.equal(result[key], 0)
  assert.equal(result.sauna, false); assert.equal(result.hasVirtualTour, false); assert.equal(result.currency, 'EUR')
  for (const key of ['jacuzzi', 'steamRoom', 'nearbyTransport']) assert.equal(Object.hasOwn(result, key), false)
  assert.deepEqual(details.buildDetailsPayload({ ...state, nearbyTransport: [] }, true).nearbyTransport, [])
  assert.equal(details.locationStateFromApi({ lat: 0, lng: 0, isApproximate: true }).value.lat, 0)
  assert.equal(details.agentIdOf({ _id: 'agent-id' }), 'agent-id')
})

const queryGuard = source => {
  const builder = source.slice(source.indexOf('const queryString = useMemo'), source.indexOf('/** Distinct filters'))
  assert.doesNotMatch(builder, /minLat|maxLat|minLng|maxLng|hasVideo|searchParams\.entries|\.\.\.searchParams/)
  for (const key of multi) {
    assert.match(source, new RegExp(`searchParams\\.getAll\\('` + key + `'\\)`))
    assert.match(builder, new RegExp(`appendAll\\('` + key + `'`))
  }
  assert.ok(source.indexOf('const FilterSection =') < source.indexOf('const PropertiesPage ='))
  assert.doesNotMatch(source, /\[showAdvanced,\s*setShowAdvanced\]/)
  assert.match(source, /hidden=\{!open\}/)
}
const agentGuard = source => {
  assert.match(body(source, 'openAdd'), /loadAgents\(\)/)
  assert.match(body(source, 'openEdit'), /loadAgents\(\)/)
  assert.match(body(source, 'handleSubmit'), /agent: form\.agent \|\| null/)
  assert.match(body(source, 'loadAgents'), /requestId !== agentsRequest\.current/)
  assert.doesNotMatch(body(source, 'loadAgents').split('catch')[1], /setAgents\(\[\]\)/)
}
const locationGuard = source => {
  const publicLocation = new Function('readRadius', 'isUsableLat', 'isUsableLng', 'raw', body(source, 'publicLocation'))(v => v || 5, Number.isFinite, Number.isFinite, { lat: 41.123456, lng: 29.123456, isApproximate: true, approxRadiusKm: 3 })
  assert.deepEqual(publicLocation, { isApproximate: true, approxRadiusKm: 3 })
}
const mapGuard = source => {
  const eligible = new Function('isValidLat', 'isValidLng', 'property', body(source, 'isPubliclyMappable'))(Number.isFinite, Number.isFinite, { location: { isApproximate: true, lat: 41, lng: 29 } })
  assert.equal(eligible, false)
}
const localeGuard = (data, context) => {
  for (const lang of ['en', 'tr', 'ar', 'de', 'ru', 'ur']) {
    assert.ok(data[lang])
    for (const key of ['noListings', 'loadError', 'propertyAdded', 'propertyUpdated', 'propertyDeleted', 'deleteFailed', 'confirmDelete', 'filesUploaded']) assert.ok(data[lang].adminPages.properties[key])
    for (const key of ['loadError', 'retry']) assert.ok(data[lang].propertiesPage[key])
  }
  assert.match(context, /\['ar', 'ur'\]\.includes\(language\) \? 'rtl' : 'ltr'/)
}

test('Batch 9: safe query, agents, exact/private split, six languages and scoped scroll containers', () => {
  queryGuard(page); agentGuard(admin); locationGuard(route); mapGuard(map); localeGuard(translations, language)
  assert.match(model, /agent:\s*\{[\s\S]*?ref: 'User'/)
  assert.match(admin, /mainImage: mainImage \|\| images\[0\] \|\| ''/)
  assert.match(admin, /disabled=\{saving \|\| uploading\}/)
  assert.match(admin, /<AdminPropertyAssistant[\s\S]*onApplyParsedFields=\{applyParsedFields\}/)
  for (const source of [admin, page]) {
    const containers = [...source.matchAll(/className="([^"]*vk-scroll-gold[^"]*)"/g)].map(match => match[1])
    assert.equal(containers.length, source === admin ? 1 : 2)
    for (const classes of containers) assert.match(classes, /overflow-y-auto/)
  }
  assert.match(read('../src/components/PropertyCard.jsx'), /useFavourites/)
})

const mutations = [
  ['bbox query', () => queryGuard(page.replace("setIf('district', district)", "setIf('district', district); setIf('minLat', 0)"))],
  ['fake video', () => queryGuard(page.replace("setIf('district', district)", "setIf('district', district); setIf('hasVideo', 'true')"))],
  ['raw URL forwarding', () => queryGuard(page.replace('const params = new URLSearchParams()', 'const params = new URLSearchParams([...searchParams])'))],
  ['single-value URL restoration', () => queryGuard(page.replaceAll("getAll('heating')", "get('heating')"))],
  ['global advanced toggle', () => queryGuard(page + '\nconst [showAdvanced, setShowAdvanced] = useState(false)')],
  ['flat agent strings', () => agentGuard(admin.replace('agent: form.agent || null', 'agentName: form.agent'))],
  ['one-time agent loading', () => agentGuard(admin.replaceAll('    loadAgents()', '    // removed load on open'))],
  ['stale agent response', () => agentGuard(admin.replaceAll('requestId !== agentsRequest.current', 'false'))],
  ['approximate public coordinate leak', () => locationGuard(route.replace('if (approximate) return { isApproximate: true, approxRadiusKm: radiusKm }', 'if (approximate) return { lat, lng, isApproximate: true, approxRadiusKm: radiusKm }'))],
  ['mapping hidden exact pin', () => mapGuard(map.replace("loc?.isApproximate !== true &&", 'true &&'))],
  ['reduced language set', () => { const copy = { ...translations }; delete copy.ur; localeGuard(copy, language) }],
  ['removing Urdu RTL', () => localeGuard(translations, language.replace("['ar', 'ur']", "['ar']"))],
]
for (const [name, mutation] of mutations) test(`Batch 9 in-memory mutation caught: ${name}`, () => assert.throws(mutation))
