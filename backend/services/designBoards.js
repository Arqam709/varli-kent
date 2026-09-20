import {
  CLIENT_ID_PATTERN,
  DESIGN_BOARD_LIMITS,
  DESIGN_LIGHTING_IDS,
  DESIGN_ROOM_IDS,
  DESIGN_STYLE_IDS,
  HEX_COLOR_PATTERN,
} from '../config/designBoardVocabulary.js'

const BOARD_KEYS = ['room', 'style', 'wall', 'floor', 'materials', 'lighting']

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
)

const isHttpUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const text = (value, field) => {
  if (typeof value !== 'string') return { error: `${field} must be a string` }
  const trimmed = value.trim()
  if (!trimmed) return { error: `${field} must not be empty` }
  if (trimmed.length > DESIGN_BOARD_LIMITS.label) {
    return { error: `${field} must not exceed ${DESIGN_BOARD_LIMITS.label} characters` }
  }
  return { value: trimmed }
}

const color = (value, field) => (
  typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
    ? { value }
    : { error: `${field} must be a six-digit hex color in #RRGGBB format` }
)

const unsupportedKey = (entry, allowed, field) => {
  const key = Object.keys(entry).find((candidate) => !allowed.includes(candidate))
  return key ? `${field} contains unsupported field: ${key}` : null
}

const validateFinish = (value, field) => {
  if (!isPlainObject(value)) return { error: `${field} must be an object` }
  const keyError = unsupportedKey(value, ['label', 'color'], field)
  if (keyError) return { error: keyError }
  const label = text(value.label, `${field}.label`)
  if (label.error) return label
  const hex = color(value.color, `${field}.color`)
  if (hex.error) return hex
  return { value: { label: label.value, color: hex.value } }
}

const validateMaterials = (value) => {
  if (!Array.isArray(value)) return { error: 'materials must be an array' }
  // Zero materials is a legitimate brief — the app never blocks on this step.
  if (value.length > DESIGN_BOARD_LIMITS.materials) {
    return { error: `materials must not contain more than ${DESIGN_BOARD_LIMITS.materials} entries` }
  }

  const materials = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    const field = `materials[${index}]`
    if (!isPlainObject(entry)) return { error: `${field} must be an object` }
    const keyError = unsupportedKey(entry, ['name', 'color', 'image'], field)
    if (keyError) return { error: keyError }

    const name = text(entry.name, `${field}.name`)
    if (name.error) return name
    const hex = color(entry.color, `${field}.color`)
    if (hex.error) return hex

    // A material's identity is name AND colour (isSameMaterial in the app).
    if (materials.some((chosen) => chosen.name === name.value && chosen.color === hex.value)) {
      return { error: `${field} duplicates an earlier material` }
    }

    const material = { name: name.value, color: hex.value }

    if (entry.image !== undefined && entry.image !== '') {
      if (typeof entry.image !== 'string') return { error: `${field}.image must be a string` }
      const image = entry.image.trim()
      if (image.length > DESIGN_BOARD_LIMITS.image) {
        return { error: `${field}.image must not exceed ${DESIGN_BOARD_LIMITS.image} characters` }
      }
      if (image && !isHttpUrl(image)) return { error: `${field}.image must be empty or a valid HTTP(S) URL` }
      // Omitted rather than stored as '', matching the app's snapshot shape.
      if (image) material.image = image
    }

    materials.push(material)
  }
  return { value: materials }
}

const oneOf = (value, allowed, field) => (
  typeof value === 'string' && allowed.includes(value)
    ? { value }
    : { error: `${field} is not a recognised ${field}` }
)


export const validateDesignBoardPayload = (body, { allowClientId = false } = {}) => {
  if (!isPlainObject(body)) return { errors: ['Request body must be an object'], value: {} }

  const allowed = allowClientId ? [...BOARD_KEYS, 'clientId'] : BOARD_KEYS
  const unknown = Object.keys(body).find((key) => !allowed.includes(key))
  if (unknown) return { errors: [`Unsupported field: ${unknown}`], value: {} }

  const errors = []
  const value = {}
  const take = (key, result) => {
    if (result.error) errors.push(result.error)
    else value[key] = result.value
  }

  take('room', oneOf(body.room, DESIGN_ROOM_IDS, 'room'))
  take('style', oneOf(body.style, DESIGN_STYLE_IDS, 'style'))
  take('wall', validateFinish(body.wall, 'wall'))
  take('floor', validateFinish(body.floor, 'floor'))
  take('materials', validateMaterials(body.materials))
  take('lighting', oneOf(body.lighting, DESIGN_LIGHTING_IDS, 'lighting'))

  if (allowClientId && body.clientId !== undefined) {
    if (typeof body.clientId !== 'string' || !CLIENT_ID_PATTERN.test(body.clientId)) {
      errors.push('clientId must be 1-64 letters, digits, hyphens or underscores')
    } else {
      value.clientId = body.clientId
    }
  }

  return { errors, value }
}
