// The visualization prompt — built on the server, from the stored board
// snapshot, and from nothing else.
//
//   boardSnapshot (validated, immutable)
//         │
//         ▼
//   buildRoomVisualizationPrompt()      ← the only place prompt text is made
//         │
//         ▼
//   provider request                    (services/designGenerations/providers)
//
// The mobile app sends a board id and a photo id. It cannot send prompt text,
// so it cannot steer the model, and the prompt can be rewritten at any time
// without trusting anything already installed on a device.
//
// ── Why the TEXT is not stored ──────────────────────────────────────────
// Only `promptVersion` is recorded on a generation. The text is fully derived
// from the snapshot plus the builder at that version, so storing it would put
// a second copy of the user's design data in the database — and in logs and
// backups with it. Bump the version whenever the wording below changes, so an
// old generation still points at the logic that produced it.

/**
 * The version recorded on every generation this build creates.
 *
 * v1 is the first prompt used against a real provider. Any change to the
 * wording below must bump this.
 */
export const DESIGN_PROMPT_VERSION = 'room-restyle-v1'

/** Wording for each room id, so the model is told what kind of space this is. */
const ROOM_TEXT = {
  'living-room': 'living room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  office: 'home office',
}

/** Wording for each style id from the Design My Space vocabulary. */
const STYLE_TEXT = {
  contemporary: 'contemporary, clean-lined and uncluttered',
  warm: 'warm and natural, with soft textures and organic materials',
  coastal: 'coastal, light and airy, with a relaxed seaside feel',
  classic: 'classic and refined, with traditional detailing',
}

/** Wording for each lighting mood id. */
const LIGHTING_TEXT = {
  day: 'bright natural daylight coming from the room’s existing windows',
  warm: 'warm early-evening light from lamps, soft and inviting',
  cool: 'cool, even, neutral lighting',
  night: 'evening lighting: lamps and accent lights, with darkness outside the windows',
}

const finish = (value) => `${value.label} (${value.color})`

/**
 * The instructions for redesigning ONE photographed room.
 *
 * Two jobs: state the design choices exactly as the user made them, and insist
 * the photographed room stays the same room — the structure, the openings and
 * the camera position. A model that reinvents the space produces a picture the
 * user cannot act on.
 *
 * @param {object} snapshot a stored `boardSnapshot`
 * @returns {string}
 */
export function buildRoomVisualizationPrompt(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('A board snapshot is required to build a prompt')
  }

  const room = ROOM_TEXT[snapshot.room] ?? 'room'
  const style = STYLE_TEXT[snapshot.style] ?? snapshot.style
  const lighting = LIGHTING_TEXT[snapshot.lighting] ?? snapshot.lighting
  const materials = (snapshot.materials ?? []).map((material) => `${material.name} (${material.color})`)

  const lines = [
    `Redesign the ${room} in this photograph as a photorealistic interior visualization.`,
    '',
    'Apply exactly these design choices:',
    `- Overall style: ${style}.`,
    `- Walls: ${finish(snapshot.wall)}.`,
    `- Floor: ${finish(snapshot.floor)}.`,
    materials.length > 0
      ? `- Feature materials and finishes to include: ${materials.join('; ')}.`
      : '- No specific feature materials were chosen; keep additional finishes simple and consistent with the style.',
    `- Lighting mood: ${lighting}.`,
    '',
    'Keep the photographed room recognisably the same room:',
    '- Keep the camera position, viewing angle and framing of the original photograph.',
    '- Keep the room’s geometry: wall positions, proportions, ceiling height and floor plan.',
    '- Keep every window and door exactly where it is, at the same size and shape, and keep the view through the windows consistent with the lighting mood.',
    '- Keep fixed architectural features such as columns, beams, niches, radiators, staircases and built-in structures.',
    '- Do not add or remove walls, windows, doors or openings, and do not change the room’s size.',
    '',
    'Also:',
    '- Furnish and finish the room realistically for the chosen style, with plausible scale and perspective.',
    '- Do not include any people, pets, text, watermarks, logos, labels or user-interface elements.',
    '- Produce a single, clean interior photograph of the finished room.',
  ]

  return lines.filter((line) => line !== undefined).join('\n')
}
