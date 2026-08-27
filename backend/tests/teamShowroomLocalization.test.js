// Wave 12A2 — Team and Showroom dynamic localization.
//
// Reuses the Wave 12A1 foundation; these tests cover what 12A2 adds on top:
//
//   1. Legacy rows keep working. Every TeamMember and ShowroomImage in this
//      database stores role/bio/caption as plain strings today, and no
//      migration has run. If the new code cannot read them, the Team page
//      and every service showroom go blank on deploy.
//
//   2. Unchanged text is not re-translated. Both admin forms send the WHOLE
//      record on every save, so without a guard, ticking "visible" on a team
//      member would fire ten provider requests against a free daily quota to
//      reproduce text nobody edited.
//
//   3. A failed target never destroys a good translation — and, unlike the
//      donor, the update path actually has the stored value available to
//      protect, because it reads the document by _id first.
//
// No network: every provider call goes through an injected fetch.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUPPORTED_LANGUAGES,
  resolveLocalized,
  isPoisonedTranslation,
  unwrapLocalized,
} from '../utils/localizedField.js'

import {
  localizeFields,
  isUnchangedSource,
  sanitizePoisonedTranslations,
} from '../utils/autoTranslate.js'

import { LOCALIZED_TEAM_FIELDS, normalizeTeamRoleBody } from '../routes/team.js'
import { LOCALIZED_SHOWROOM_FIELDS } from '../routes/showroom.js'
import TeamMember from '../models/TeamMember.js'

/* ── no-network guard (kept from 12A1) ────────────────────────────────────
 * If a future edit forgets to inject a stub, the call lands here and fails
 * loudly rather than silently spending someone's MyMemory quota.
 */
globalThis.fetch = async (url) => {
  throw new Error(`12A2 tests must not touch the network (tried: ${url})`)
}

const targetOf = (url) => decodeURIComponent(url).split('autodetect|')[1]
const ok = (body) => ({ ok: true, json: async () => body })

const goodProvider = async (url) =>
  ok({ responseStatus: 200, responseData: { translatedText: `[${targetOf(url)}]` } })

const failingFor = (langs, body) => async (url) =>
  langs.includes(targetOf(url)) ? ok(body) : goodProvider(url)

const counting = () => {
  const state = { calls: 0 }
  state.fetch = async (url) => { state.calls += 1; return goodProvider(url) }
  return state
}

const QUOTA_WARNING =
  'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 04 HOURS'

const validationErrorForRole = async (role, { omit = false } = {}) => {
  const member = new TeamMember(omit ? { name: 'Test Agent' } : { name: 'Test Agent', role })
  try {
    await member.validate()
    return null
  } catch (error) {
    return error.errors?.role ?? error
  }
}

/* ============== Team role validation correction ================= */

test('12A2 correction: missing role is rejected', async () => {
  assert.ok(await validationErrorForRole(undefined, { omit: true }))
})

test('12A2 correction: null role is rejected', async () => {
  assert.ok(await validationErrorForRole(null))
})

test('12A2 correction: empty role is rejected', async () => {
  assert.ok(await validationErrorForRole(''))
})

test('12A2 correction: whitespace-only role is rejected', async () => {
  assert.ok(await validationErrorForRole('     '))
})

test('12A2 correction: leading and trailing role whitespace is normalized', async () => {
  const member = new TeamMember({ name: 'Test Agent', role: '   Senior Agent   ' })
  await member.validate()
  assert.equal(member.role, 'Senior Agent')

  const localized = await localizeFields(
    normalizeTeamRoleBody({ role: '   Senior Agent   ' }),
    LOCALIZED_TEAM_FIELDS,
    {},
    goodProvider
  )
  assert.equal(localized.role.en, 'Senior Agent')
})

test('12A2 correction: valid legacy string role is accepted', async () => {
  assert.equal(await validationErrorForRole('Senior Agent'), null)
})

test('12A2 correction: valid localized role is accepted', async () => {
  assert.equal(await validationErrorForRole({
    sourceLang: 'en',
    en: 'Senior Agent',
    tr: 'Kidemli Danisman',
  }), null)
})

test('12A2 correction: localized role with no usable translation is rejected', async () => {
  for (const role of [
    {},
    { sourceLang: 'en' },
    { sourceLang: 'en', en: '' },
    { sourceLang: 'en', en: '    ' },
  ]) {
    assert.ok(await validationErrorForRole(role), JSON.stringify(role))
  }
})

test('12A2 correction: poison-only localized role is rejected', async () => {
  assert.ok(await validationErrorForRole({ sourceLang: 'en', en: QUOTA_WARNING }))
})

test('12A2 correction: arbitrary Mixed object is rejected', async () => {
  assert.ok(await validationErrorForRole({ hello: 'world' }))
})

test('12A2 correction: existing valid localized role survives unchanged update', async () => {
  const stored = { sourceLang: 'en', en: 'Senior Agent', tr: 'Kidemli Danisman' }
  const spy = counting()
  const out = await localizeFields(
    { role: 'Senior Agent', visible: false },
    LOCALIZED_TEAM_FIELDS,
    { role: stored },
    spy.fetch
  )
  assert.deepEqual(out.role, stored)
  assert.equal(await validationErrorForRole(out.role), null)
  assert.equal(spy.calls, 0)
})

/* ══════════════ 1. Declared field lists ═══════════════════════════════ */

test('12A2: Team localizes role and bio, and nothing else', () => {
  assert.deepEqual(LOCALIZED_TEAM_FIELDS, ['role', 'bio'])
  // A person's name is not translated, and the rest are not prose.
  for (const scalar of ['name', 'photo', 'order', 'visible', '_id', 'createdAt']) {
    assert.ok(!LOCALIZED_TEAM_FIELDS.includes(scalar), `${scalar} must stay scalar`)
  }
})

test('12A2: Showroom localizes caption, and nothing else', () => {
  assert.deepEqual(LOCALIZED_SHOWROOM_FIELDS, ['caption'])
  // `style` looks like a word but the public route matches it EXACTLY against
  // req.query.style — translating it would break that filter.
  for (const scalar of ['serviceType', 'url', 'style', 'order', 'visible', '_id']) {
    assert.ok(!LOCALIZED_SHOWROOM_FIELDS.includes(scalar), `${scalar} must stay scalar`)
  }
})

test('12A2: later-wave donor fields were NOT smuggled in', () => {
  // The donor also localizes Team longBio and Showroom title/detailText, and
  // carries secondaryPhoto/workImages. Those are a later parity wave; 12A2 is
  // localization wiring only.
  for (const deferred of ['longBio', 'secondaryPhoto', 'workImages']) {
    assert.ok(!LOCALIZED_TEAM_FIELDS.includes(deferred), `${deferred} is deferred`)
  }
  for (const deferred of ['title', 'detailText']) {
    assert.ok(!LOCALIZED_SHOWROOM_FIELDS.includes(deferred), `${deferred} is deferred`)
  }
})

/* ══════════════ 2. Team public reads ══════════════════════════════════ */

const LEGACY_MEMBER = {
  _id: '65f000000000000000000001',
  name: 'Ahmet Yılmaz',
  role: 'Senior Architect',
  bio: 'Specialist in luxury waterfront properties.',
  photo: 'https://res.cloudinary.com/demo/a.jpg',
  order: 2,
  visible: true,
}

const LOCALIZED_MEMBER = {
  _id: '65f000000000000000000002',
  name: 'Selin Kaya',
  role: {
    sourceLang: 'en',
    en: 'Senior Agent', tr: 'Kıdemli Danışman', ar: 'وكيل أول',
    de: 'Leitende Maklerin', ru: 'Старший агент', ur: 'سینئر ایجنٹ',
  },
  bio: {
    sourceLang: 'en',
    en: 'Luxury specialist.', tr: 'Lüks uzmanı.', ar: 'متخصصة في الفخامة.',
    de: 'Luxus-Spezialistin.', ru: 'Специалист по люксу.', ur: 'لگژری ماہر۔',
  },
  photo: 'https://res.cloudinary.com/demo/s.jpg',
  order: 0,
  visible: true,
}

test('12A2: a LEGACY team member renders in every language', async (t) => {
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(LEGACY_MEMBER.role, lang), 'Senior Architect')
      assert.equal(
        resolveLocalized(LEGACY_MEMBER.bio, lang),
        'Specialist in luxury waterfront properties.'
      )
    })
  }
})

test('12A2: a LOCALIZED team member returns each language', async (t) => {
  const EXPECTED_ROLE = {
    en: 'Senior Agent', tr: 'Kıdemli Danışman', ar: 'وكيل أول',
    de: 'Leitende Maklerin', ru: 'Старший агент', ur: 'سینئر ایجنٹ',
  }
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(LOCALIZED_MEMBER.role, lang), EXPECTED_ROLE[lang])
    })
  }
})

test('12A2: team scalar fields are never touched by localization', () => {
  assert.equal(LEGACY_MEMBER.name, 'Ahmet Yılmaz')
  assert.equal(LOCALIZED_MEMBER.name, 'Selin Kaya')
  // The name is a person's name; resolving it must not mangle it either.
  assert.equal(resolveLocalized(LOCALIZED_MEMBER.name, 'tr'), 'Selin Kaya')
  assert.equal(resolveLocalized(LEGACY_MEMBER.photo, 'ar'), 'https://res.cloudinary.com/demo/a.jpg')
})

test('12A2: a partially localized role falls back to English', () => {
  const partial = { sourceLang: 'en', en: 'Senior Agent', tr: 'Kıdemli Danışman' }
  assert.equal(resolveLocalized(partial, 'tr'), 'Kıdemli Danışman')
  assert.equal(resolveLocalized(partial, 'ru'), 'Senior Agent')
  assert.equal(resolveLocalized(partial, 'ur'), 'Senior Agent')
})

test('12A2: a poisoned team translation is never displayed', () => {
  const poisoned = { sourceLang: 'en', en: 'Senior Agent', tr: QUOTA_WARNING }
  assert.equal(resolveLocalized(poisoned, 'tr'), 'Senior Agent')
})

test('12A2: a missing or empty bio resolves to an empty string', async (t) => {
  for (const bio of [undefined, null, '', '   ', {}]) {
    await t.test(JSON.stringify(bio) ?? 'undefined', () => {
      assert.equal(resolveLocalized(bio, 'tr'), '')
    })
  }
})

/* ══════════════ 3. Showroom public reads ══════════════════════════════ */

const LEGACY_IMAGE = {
  _id: '65f000000000000000000010',
  serviceType: 'interior',
  url: 'https://res.cloudinary.com/demo/video/upload/v1/tour.mp4',
  caption: 'Luxury kitchen',
  style: 'Contemporary',
  order: 1,
  visible: true,
}

const LOCALIZED_IMAGE = {
  _id: '65f000000000000000000011',
  serviceType: 'renovation',
  url: 'https://res.cloudinary.com/demo/image/upload/v1/room.jpg',
  caption: {
    sourceLang: 'tr',
    tr: 'Modern oturma odası', en: 'Modern living room', ar: 'غرفة معيشة حديثة',
    de: 'Modernes Wohnzimmer', ru: 'Современная гостиная', ur: 'جدید کمرہ',
  },
  style: 'Warm Modern',
  order: 0,
  visible: true,
}

test('12A2: a LEGACY showroom caption renders in every language', async (t) => {
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(LEGACY_IMAGE.caption, lang), 'Luxury kitchen')
    })
  }
})

test('12A2: a LOCALIZED showroom caption returns each language', async (t) => {
  const EXPECTED = {
    tr: 'Modern oturma odası', en: 'Modern living room', ar: 'غرفة معيشة حديثة',
    de: 'Modernes Wohnzimmer', ru: 'Современная гостиная', ur: 'جدید کمرہ',
  }
  for (const lang of SUPPORTED_LANGUAGES) {
    await t.test(lang, () => {
      assert.equal(resolveLocalized(LOCALIZED_IMAGE.caption, lang), EXPECTED[lang])
    })
  }
})

test('12A2: showroom machine fields survive the public sanitizer verbatim', () => {
  const cleaned = sanitizePoisonedTranslations(LOCALIZED_IMAGE)
  assert.equal(cleaned.url, LOCALIZED_IMAGE.url)
  assert.equal(cleaned.serviceType, 'renovation')
  assert.equal(cleaned.style, 'Warm Modern', 'style is a query filter value, not prose')
  assert.equal(cleaned.order, 0)
  assert.equal(cleaned.visible, true)
})

test('12A2: a poisoned showroom caption is never displayed', () => {
  const poisoned = { sourceLang: 'en', en: 'Luxury kitchen', de: QUOTA_WARNING }
  assert.equal(resolveLocalized(poisoned, 'de'), 'Luxury kitchen')
})

/* ══════════════ 4. Create ═════════════════════════════════════════════ */

test('12A2: creating a team member localizes role and bio only', async () => {
  const out = await localizeFields(
    {
      name: 'Ahmet Yılmaz',
      role: 'Senior Architect',
      bio: 'Waterfront specialist.',
      photo: 'https://res.cloudinary.com/demo/a.jpg',
      order: 2,
      visible: true,
    },
    LOCALIZED_TEAM_FIELDS,
    {},
    goodProvider
  )

  assert.equal(out.role.sourceLang, 'en')
  assert.equal(out.role.en, 'Senior Architect', 'source text stored verbatim')
  assert.equal(out.role.tr, '[tr]')
  assert.equal(out.bio.en, 'Waterfront specialist.')

  // Everything else passes through untouched.
  assert.equal(out.name, 'Ahmet Yılmaz')
  assert.equal(out.photo, 'https://res.cloudinary.com/demo/a.jpg')
  assert.equal(out.order, 2)
  assert.equal(out.visible, true)
})

test('12A2: creating a showroom image localizes caption only', async () => {
  const out = await localizeFields(
    {
      serviceType: 'interior',
      url: 'https://res.cloudinary.com/demo/x.jpg',
      caption: 'Luxury kitchen',
      style: 'Contemporary',
      order: 1,
      visible: true,
    },
    LOCALIZED_SHOWROOM_FIELDS,
    {},
    goodProvider
  )

  assert.equal(out.caption.en, 'Luxury kitchen')
  assert.equal(out.caption.ru, '[ru]')

  assert.equal(out.url, 'https://res.cloudinary.com/demo/x.jpg', 'a URL is never translated')
  assert.equal(out.serviceType, 'interior', 'a machine enum is never translated')
  assert.equal(out.style, 'Contemporary', 'a query filter value is never translated')
  assert.equal(out.order, 1)
  assert.equal(out.visible, true)
})

test('12A2: a Turkish-typed caption keeps the admin’s own words', async () => {
  const out = await localizeFields(
    { caption: 'Modern oturma odası' },
    LOCALIZED_SHOWROOM_FIELDS, {}, goodProvider
  )
  assert.equal(out.caption.sourceLang, 'tr')
  assert.equal(out.caption.tr, 'Modern oturma odası', 'never round-tripped through English')
})

test('12A2: an empty bio makes no provider request', async () => {
  const spy = counting()
  const out = await localizeFields(
    { role: 'Agent', bio: '   ' },
    LOCALIZED_TEAM_FIELDS, {}, spy.fetch
  )
  assert.equal(resolveLocalized(out.bio, 'tr'), '')
  // Only the five role targets — none for the blank bio.
  assert.equal(spy.calls, 5)
})

/* ══════════════ 5. Update — quota and preservation ════════════════════ */

test('12A2: isUnchangedSource compares against the stored source language', () => {
  const stored = { sourceLang: 'tr', tr: 'Kıdemli Danışman', en: 'Senior Agent' }
  assert.equal(isUnchangedSource('Kıdemli Danışman', stored), true)
  assert.equal(isUnchangedSource('Senior Agent', stored), false, 'not the source language')
  assert.equal(isUnchangedSource('Kıdemli Mimar', stored), false)
  assert.equal(isUnchangedSource('anything', 'a legacy string'), false)
  assert.equal(isUnchangedSource('anything', null), false)
  assert.equal(isUnchangedSource(null, stored), false)
})

test('12A2: an UNCHANGED field costs ZERO provider requests', async () => {
  /*
   * The case that motivated this: the admin ticks "visible" and saves. Both
   * forms send the whole record, so a naive `typeof value === 'string'` check
   * would re-translate role and bio — ten requests against a free daily quota
   * to reproduce text nobody touched.
   */
  const storedRole = { sourceLang: 'en', en: 'Senior Agent', tr: 'Kıdemli Danışman', de: 'Maklerin' }
  const storedBio = { sourceLang: 'en', en: 'Luxury specialist.', tr: 'Lüks uzmanı.' }
  const spy = counting()

  const out = await localizeFields(
    { role: 'Senior Agent', bio: 'Luxury specialist.', visible: false },
    LOCALIZED_TEAM_FIELDS,
    { role: storedRole, bio: storedBio },
    spy.fetch
  )

  assert.equal(spy.calls, 0, 'no provider request for unchanged text')
  assert.deepEqual(out.role, storedRole, 'stored translations reused exactly')
  assert.deepEqual(out.bio, storedBio)
  assert.equal(out.visible, false, 'the actual edit still applies')
})

test('12A2: an already-localized object sent back is passed through', async () => {
  // AdminShowroom's visibility toggle re-sends the whole image, caption
  // object included.
  const stored = LOCALIZED_IMAGE.caption
  const spy = counting()
  const out = await localizeFields(
    { ...LOCALIZED_IMAGE, visible: false },
    LOCALIZED_SHOWROOM_FIELDS,
    { caption: stored },
    spy.fetch
  )
  assert.equal(spy.calls, 0)
  assert.deepEqual(out.caption, stored)
  assert.equal(out.visible, false)
})

test('12A2: a CHANGED field is translated and carries targets forward', async () => {
  const stored = { sourceLang: 'en', en: 'Senior Agent', tr: 'Kıdemli Danışman' }
  const out = await localizeFields(
    { role: 'Lead Agent' }, LOCALIZED_TEAM_FIELDS, { role: stored }, goodProvider
  )
  assert.equal(out.role.en, 'Lead Agent')
  assert.equal(out.role.tr, '[tr]', 'a successful target is refreshed, not frozen')
})

test('12A2: THE KEY CASE — a failed target keeps the existing team translation', async () => {
  /*
   * The donor cannot do this at all: its PUT goes straight through
   * findByIdAndUpdate, so localizeText never sees the stored value, and a
   * save during a quota outage replaces every good translation with the
   * English source. routes/team.js reads the document by _id first, which is
   * what makes this test possible.
   */
  const stored = {
    sourceLang: 'en',
    en: 'Senior Agent', tr: 'Kıdemli Danışman', ar: 'وكيل أول',
    de: 'Leitende Maklerin', ru: 'Старший агент', ur: 'سینئر ایجنٹ',
  }

  const out = await localizeFields(
    { role: 'Lead Agent' },
    LOCALIZED_TEAM_FIELDS,
    { role: stored },
    failingFor(['tr', 'de'], { responseStatus: 200, responseData: { translatedText: QUOTA_WARNING } })
  )

  assert.equal(out.role.en, 'Lead Agent', 'the new source text is stored')
  assert.equal(out.role.tr, 'Kıdemli Danışman', 'existing Turkish survives')
  assert.equal(out.role.de, 'Leitende Maklerin', 'existing German survives')
  assert.equal(out.role.ar, '[ar]', 'a target that succeeded is updated')

  for (const value of Object.values(out.role)) {
    assert.equal(isPoisonedTranslation(value), false, 'nothing poisoned was stored')
    assert.notEqual(value, 'Lead Agent-as-translation')
  }
})

test('12A2: THE KEY CASE — a failed target keeps the existing showroom caption', async () => {
  const stored = { sourceLang: 'en', en: 'Luxury kitchen', tr: 'Lüks mutfak', ru: 'Роскошная кухня' }

  const out = await localizeFields(
    { caption: 'Luxury kitchen, remodelled' },
    LOCALIZED_SHOWROOM_FIELDS,
    { caption: stored },
    failingFor(['ru'], { responseStatus: 200, responseData: { translatedText: QUOTA_WARNING } })
  )

  assert.equal(out.caption.en, 'Luxury kitchen, remodelled')
  assert.equal(out.caption.ru, 'Роскошная кухня', 'existing Russian survives')
  assert.equal(out.caption.tr, '[tr]')
})

test('12A2: a total provider outage does not lose the edit or the old targets', async () => {
  const dead = async () => { throw new TypeError('fetch failed') }
  const stored = { sourceLang: 'en', en: 'Old caption', tr: 'Eski başlık' }
  const out = await localizeFields(
    { caption: 'New caption' }, LOCALIZED_SHOWROOM_FIELDS, { caption: stored }, dead
  )
  assert.equal(out.caption.en, 'New caption')
  assert.equal(out.caption.tr, 'Eski başlık')
})

test('12A2: upgrading a LEGACY string record localizes it on first save', async () => {
  // The legacy row stores a plain string, so there is no stored object to
  // carry forward — it simply translates, which is how records migrate
  // themselves without a migration script.
  const out = await localizeFields(
    { role: 'Senior Architect' },
    LOCALIZED_TEAM_FIELDS,
    { role: 'Senior Architect' },
    goodProvider
  )
  assert.equal(out.role.en, 'Senior Architect')
  assert.equal(out.role.tr, '[tr]')
})

test('12A2: a field absent from the payload is not invented', async () => {
  const out = await localizeFields({ role: 'Agent' }, LOCALIZED_TEAM_FIELDS, {}, goodProvider)
  assert.ok(!('bio' in out), 'an untouched field stays out of the update')
})

/* ══════════════ 6. Admin unwrapping ═══════════════════════════════════ */

test('12A2: the admin form shows the source language, not a translation', () => {
  const turkishSource = {
    sourceLang: 'tr', tr: 'Kıdemli Danışman', en: 'Senior Agent', de: 'Maklerin',
  }
  assert.equal(unwrapLocalized(turkishSource), 'Kıdemli Danışman')
  assert.equal(unwrapLocalized('Legacy plain role'), 'Legacy plain role')
  assert.equal(unwrapLocalized(null), '')
  assert.equal(unwrapLocalized(undefined), '')
  assert.equal(unwrapLocalized({}), '')
})

test('12A2: unwrapping then resaving unchanged text is a no-op round trip', async () => {
  // Open the edit modal, change nothing, hit save.
  const stored = { sourceLang: 'tr', tr: 'Kıdemli Danışman', en: 'Senior Agent' }
  const inInput = unwrapLocalized(stored)
  const spy = counting()

  const out = await localizeFields(
    { role: inInput }, LOCALIZED_TEAM_FIELDS, { role: stored }, spy.fetch
  )

  assert.equal(inInput, 'Kıdemli Danışman')
  assert.equal(spy.calls, 0, 'opening and saving a form must not spend quota')
  assert.deepEqual(out.role, stored)
})
